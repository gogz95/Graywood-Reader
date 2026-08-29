// ============================================================================
// SHARED IN-MEMORY APP STATE & PERSISTENCE LAYER
// ============================================================================
// Canonical holder for the server's mutable runtime state (manga library,
// user profiles, update logs, sync config, app settings) plus the SQLite
// persistence helpers, startup bootstrap and the unified data-access (DA)
// functions. Extracted from server.ts so scoped routers can operate on the
// exact same state via ES-module live bindings.
//
// SQLite (data/manga.db) remains the canonical persistent store; the legacy
// database.json file is only written for graceful-shutdown backups and
// explicit exports.
// ============================================================================

import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { MangaItem, AutoUpdateLog, DatabaseSyncConfig, UserProfile } from "../src/types";
import { SqliteDb } from "../sqlite-db";
import {
  encryptPII,
  decryptPII,
  hashPassword,
  isAlreadyHashed,
  verifyAuthToken,
  isHostRequest,
} from "./security";
import {
  KOTATSU_SOURCES,
  DYNAMIC_DEAD_SOURCES,
  disabledSourceIds,
  rebuildDeadSourcesSet,
  syncDeadSourcesToDisabled,
} from "./sources/sourcesCatalog";
import { notifyLibraryItemChanged } from "./services/libraryCacheService";

// ============================================================================
// REQUEST IDENTITY & WRITE-GATE HELPERS
// ============================================================================

/**
 * Resolve the acting user for progress/favorites.
 * Never trusts client-supplied userId query/body — only Bearer token, else host default.
 */
export function resolveRequestUserId(req: express.Request): string | null {
  const authed = (req as any).user as UserProfile | null | undefined;
  if (authed?.id) return authed.id;
  if (isHostRequest(req)) return 'usr_admin';
  return null;
}

/**
 * Shared-catalog write gate. The manga catalog is GLOBAL state: creating,
 * editing or deleting rows must never be possible for anonymous remote
 * clients. Allowed: the host machine, or any authenticated (token) user.
 */
export function canWriteCatalog(req: express.Request): boolean {
  return isHostRequest(req) || !!(req as any).user;
}

/**
 * Row-level ownership check on series modifications.
 * Admins and Host requests can modify any series. Non-admin users can only
 * modify series that are unowned (userId is null) or explicitly owned by their account.
 */
export function canModifyManga(req: express.Request, manga: MangaItem): boolean {
  if (isHostRequest(req)) return true;
  const user = (req as any).user as UserProfile | undefined;
  if (!user) return false;
  if (user.role === 'admin') return true;
  // Authenticated readers can modify and delete series in their library
  if (!manga.userId || manga.userId === 'usr_admin' || manga.userId === user.id) return true;
  return false;
}

export function rejectCatalogWrite(res: express.Response): void {
  res.status(401).json({
    error: 'Unauthorized',
    message: 'Catalog changes require a login token (or the host computer).',
  });
}

/**
 * Check if the request is permitted to access 18+ / NSFW adult content.
 * Guests (unauthenticated remote clients, or sessions with role='guest' / id='usr_guest')
 * are NOT allowed to access 18+ content without logging in.
 */
export function isNsfwAccessAllowed(req: express.Request): boolean {
  if (req.headers['x-guest-mode'] === '1' || req.headers['x-user-id'] === 'usr_guest') {
    return false;
  }

  const user = (req as any).user || resolveAuthUser(req);
  if (user) {
    if (user.id === 'usr_guest' || user.role === 'guest') {
      return false;
    }
    // Granular age ratings & explicit NSFW gate per account
    if (user.allowNsfw === false || user.maxAgeRating === 'pg' || user.maxAgeRating === 'pg13') {
      return false;
    }
    return true;
  }

  if (isHostRequest(req)) {
    return true;
  }

  return false;
}

// Resolve the authenticated user (if any) from an Authorization header only.
// Query-string tokens are rejected — they leak via logs, Referer, and history.
export function resolveAuthUser(req: express.Request): UserProfile | null {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  const payload = verifyAuthToken(token);
  if (!payload || typeof payload.sub !== 'string') return null;
  // eslint-disable-next-line @typescript-eslint/no-use-before-define -- live binding (declared below)
  const inMem = userProfiles.find((u) => u.id === payload.sub);
  if (inMem) return inMem;
  const fromDb = SqliteDb.getProfileById(payload.sub);
  if (fromDb) return fromDb;
  return {
    id: payload.sub,
    name: (payload.username as string) || (payload.name as string) || payload.sub,
    username: (payload.username as string) || payload.sub,
    role: (payload.role as any) || 'user',
  } as UserProfile;
}

// ============================================================================
// IN-MEMORY DB STATE (live-exported: importers always see the current value)
// ============================================================================

// Persistent Database File Path (isolated under data/backups/ as canonical persistent storage)
export const DB_BACKUP_DIR = path.join(process.cwd(), "data", "backups");
export const DB_FILE_PATH = path.join(DB_BACKUP_DIR, "legacy-snapshot.json");

/**
 * Direct SQLite reader returning full catalog array for explicit backups/exports.
 */
export function getMangaDatabase(): MangaItem[] {
  return SqliteDb.getAllManga();
}

/**
 * Backward-compatible live proxy delegating directly to SQLite WAL store.
 * Eliminates duplicate in-memory RAM allocations while preserving array ergonomics.
 */
export const mangaDatabase: MangaItem[] = new Proxy([] as MangaItem[], {
  get(_target, prop) {
    if (prop === 'length') {
      return SqliteDb.getMangaCount();
    }
    if (prop === Symbol.iterator) {
      return function* () {
        yield* SqliteDb.getAllManga();
      };
    }
    const all = SqliteDb.getAllManga();
    if (typeof prop === 'string' && /^\d+$/.test(prop)) {
      return all[Number(prop)];
    }
    const val = (all as any)[prop];
    return typeof val === 'function' ? val.bind(all) : val;
  },
});

export let userProfiles: UserProfile[] = [
  {
    id: 'usr_admin',
    name: 'Host Administrator',
    username: 'admin',
    email: 'admin@manga.dev',
    avatar: '🛡️',
    role: 'admin',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'usr_guest',
    name: 'Guest Reader',
    username: 'guest',
    email: 'guest@graywood.app',
    avatar: '👤',
    role: 'user',
    createdAt: new Date().toISOString(),
  },
];

// No fabricated demo entries: the update log starts empty and only ever
// contains real scan results produced by this server.
export let autoUpdateLogs: AutoUpdateLog[] = [];

export let syncConfig: DatabaseSyncConfig = {
  subdomain: 'tracker.manhuahub.app',
  autoUpdateIntervalMinutes: 60,
  enableWebCrawling: true,
  sources: ['MangaDex API', 'AniList GraphQL', 'AsuraScans Feeds', 'FlameComics', 'WeebCentral', 'DemonicScans'],
  disabledSources: disabledSourceIds ? Array.from(disabledSourceIds) : [],
  removedSources: [],
  reactivatedSources: [],
  lastSyncTime: new Date().toISOString(),
  totalTracked: 0,
};

// Initialize dead sources from syncConfig
rebuildDeadSourcesSet(syncConfig);
syncDeadSourcesToDisabled();

console.log(`[Source Engine] Initialized standalone source catalog with ${KOTATSU_SOURCES.length} sources`);

// Reassignment seams: these setters are the ONLY place the exported `let`
// bindings may be swapped; every other module mutates them in place or reads
// them through the live binding.
export function setUserProfiles(next: UserProfile[]): void { userProfiles = next; }
export function setAutoUpdateLogs(next: AutoUpdateLog[]): void { autoUpdateLogs = next; }
export function setSyncConfig(next: DatabaseSyncConfig): void { syncConfig = next; }

// ============================================================================
// PERSISTENCE HELPERS (SQLite canonical store + legacy JSON snapshots)
// ============================================================================

// Helper: Persist App State to SQLite (Profiles / Settings / Config / Logs).
// Manga rows are persisted directly by the sync* data-access functions below.
// PII fields are AES-256-GCM encrypted & passwords scrypt-hashed before storage.
let saveTimeoutTimer: NodeJS.Timeout | null = null;

export function buildEncryptedProfiles() {
  return userProfiles.map((p) => ({
    ...p,
    email: encryptPII(p.email || ''),
    storageFolderPath: p.storageFolderPath && !String(p.storageFolderPath).startsWith('enc:')
      ? encryptPII(String(p.storageFolderPath))
      : (p.storageFolderPath || ''),
    password: p.password ? (isAlreadyHashed(p.password) ? p.password : hashPassword(p.password)) : '',
  }));
}

export function buildEncryptedSettings() {
  return {
    ...appSettings,
    captchaApiKey: appSettings.captchaApiKey && !appSettings.captchaApiKey.startsWith('enc:')
      ? encryptPII(appSettings.captchaApiKey)
      : (appSettings.captchaApiKey || ''),
    mangaUpdatesPassword: appSettings.mangaUpdatesPassword && !appSettings.mangaUpdatesPassword.startsWith('enc:')
      ? encryptPII(appSettings.mangaUpdatesPassword)
      : (appSettings.mangaUpdatesPassword || ''),
    discordWebhookUrl: (appSettings as any).discordWebhookUrl && !(appSettings as any).discordWebhookUrl.startsWith('enc:')
      ? encryptPII((appSettings as any).discordWebhookUrl)
      : ((appSettings as any).discordWebhookUrl || ''),
    telegramBotToken: (appSettings as any).telegramBotToken && !(appSettings as any).telegramBotToken.startsWith('enc:')
      ? encryptPII((appSettings as any).telegramBotToken)
      : ((appSettings as any).telegramBotToken || ''),
  };
}

// Immediate synchronous SQLite flush of the non-manga app state. Used by the
// debounced save, graceful shutdown and any "persist right now" code path.
export function flushStateNow(): void {
  SqliteDb.replaceAllProfiles(buildEncryptedProfiles());
  SqliteDb.setSetting('appSettings', JSON.stringify(buildEncryptedSettings()));
  SqliteDb.setSetting('syncConfig', JSON.stringify(syncConfig));
  SqliteDb.replaceAllLogs(autoUpdateLogs);
}

export function saveDatabaseToDisk() {
  if (saveTimeoutTimer) clearTimeout(saveTimeoutTimer);

  saveTimeoutTimer = setTimeout(() => {
    try {
      flushStateNow();
    } catch (err) {
      console.error("[SQLite Engine] Error persisting app state:", err);
    }
  }, 100);
}

// Cancel any pending debounced save (graceful shutdown drains state itself).
export function cancelPendingSave(): void {
  if (saveTimeoutTimer) {
    clearTimeout(saveTimeoutTimer);
    saveTimeoutTimer = null;
  }
}

// Legacy JSON snapshot writer — used only for graceful-shutdown backups and
// explicit exports. SQLite (data/manga.db) is the canonical persistent store.
export function writeLegacyJsonSnapshot(reason: string) {
  if (process.env.NODE_ENV === 'test' || process.env.DISABLE_DISK_SNAPSHOTS === 'true') {
    return;
  }
  try {
    if (!fs.existsSync(DB_BACKUP_DIR)) {
      fs.mkdirSync(DB_BACKUP_DIR, { recursive: true });
    }
    const allManga = SqliteDb.getAllManga();
    const dataToSave = {
      version: 1,
      gdprEncrypted: true,
      lastSaved: new Date().toISOString(),
      mangaDatabase: allManga,
      userProfiles: buildEncryptedProfiles(),
      autoUpdateLogs,
      syncConfig,
      appSettings: buildEncryptedSettings(),
    };

    // Atomic write via temporary file
    const tempPath = `${DB_FILE_PATH}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(dataToSave, null, 2), "utf-8");
    fs.renameSync(tempPath, DB_FILE_PATH);
    console.log(`[GDPR Database Engine] Wrote legacy JSON snapshot (${reason}) with ${allManga.length} series & ${userProfiles.length} encrypted profiles.`);
  } catch (err) {
    console.error("[GDPR Database Engine] Error writing legacy JSON snapshot:", err);
  }
}

// ============================================================================
// UNIFIED DATABASE SYNCHRONIZATION (DA LAYER)
// ============================================================================

export function syncAddOrUpdateManga(item: MangaItem): MangaItem {
  SqliteDb.upsertManga(item);
  syncConfig.totalTracked = SqliteDb.getMangaCount();
  try { notifyLibraryItemChanged(item); } catch {}
  return item;
}

export function syncBulkAddOrUpdateManga(items: MangaItem[]) {
  if (!items || items.length === 0) return;
  SqliteDb.bulkUpsertManga(items);
  syncConfig.totalTracked = SqliteDb.getMangaCount();
  for (const item of items) {
    try { notifyLibraryItemChanged(item); } catch {}
  }
}

export function syncDeleteManga(id: string) {
  SqliteDb.deleteManga(id);
  syncConfig.totalTracked = SqliteDb.getMangaCount();
  try { notifyLibraryItemChanged({ id }); } catch {}
}

export function syncBulkDeleteManga(ids: string[]): void {
  if (!ids || ids.length === 0) return;
  SqliteDb.bulkDeleteManga(ids);
  syncConfig.totalTracked = SqliteDb.getMangaCount();
  for (const id of ids) {
    try { notifyLibraryItemChanged({ id }); } catch {}
  }
}

export function syncResetManga(items: MangaItem[]) {
  SqliteDb.deleteAllManga();
  SqliteDb.bulkUpsertManga(items);
  syncConfig.totalTracked = SqliteDb.getMangaCount();
}

// Wholesale replacement seams used by admin/GDPR erasure & dead-source purge.
export function replaceMangaDatabase(items: MangaItem[]): void {
  SqliteDb.deleteAllManga();
  SqliteDb.bulkUpsertManga(items);
  syncConfig.totalTracked = SqliteDb.getMangaCount();
}

export function reloadMangaFromSql(): void {
  syncConfig.totalTracked = SqliteDb.getMangaCount();
}

/**
 * Canonical manga lookup: SQLite is the sole source of truth.
 */
export function resolveManga(id: string): MangaItem | undefined {
  if (!id) return undefined;
  return SqliteDb.getMangaById(id) || undefined;
}


function applySyncConfigRestored(config: DatabaseSyncConfig) {
  syncConfig = config;
  // Restore the persisted disabled-source set so toggles survive restarts.
  disabledSourceIds.clear();
  if (Array.isArray(syncConfig.disabledSources)) {
    syncConfig.disabledSources.forEach((id: string) => disabledSourceIds.add(id));
  }
  if (Array.isArray(syncConfig.removedSources)) {
    syncConfig.removedSources.forEach((id: string) => DYNAMIC_DEAD_SOURCES.add(id));
  }
  rebuildDeadSourcesSet();
}

/**
 * Whitelisted patch of syncConfig used by the backup-import endpoint
 * (mirrors the restore semantics minus the removed-sources reviver).
 */
export function applySyncConfigPatch(cleanConfig: Record<string, any>): void {
  syncConfig = { ...syncConfig, ...cleanConfig, totalTracked: SqliteDb.getMangaCount() };
  if (Array.isArray(cleanConfig.disabledSources)) {
    disabledSourceIds.clear();
    cleanConfig.disabledSources.forEach((id: string) => disabledSourceIds.add(String(id)));
  }
}

/**
 * Ensure usr_admin has a scrypt password so /api/auth/login works.
 * Priority: existing hash > ADMIN_PASSWORD env > data/.admin-bootstrap-password (create once).
 */
function ensureAdminPasswordBootstrap() {
  const idx = userProfiles.findIndex((p) => p.id === 'usr_admin');
  if (idx === -1) return;
  const admin = userProfiles[idx];
  if (admin.password && isAlreadyHashed(admin.password)) return;

  let plain = (process.env.ADMIN_PASSWORD || '').trim();
  const bootstrapPath = path.join(process.cwd(), 'data', '.admin-bootstrap-password');
  if (!plain) {
    try {
      if (fs.existsSync(bootstrapPath)) {
        plain = fs.readFileSync(bootstrapPath, 'utf8').trim();
      }
    } catch { /* ignore */ }
  }
  if (!plain) {
    plain = crypto.randomBytes(12).toString('base64url');
    try {
      fs.mkdirSync(path.dirname(bootstrapPath), { recursive: true });
      fs.writeFileSync(bootstrapPath, plain + '\n', { mode: 0o600 });
      console.warn(
        `[Auth Engine] Generated one-time admin password for username "admin". ` +
        `Saved to data/.admin-bootstrap-password — change it after first login. ` +
        `Or set ADMIN_PASSWORD in the environment before next start.`
      );
    } catch (err) {
      console.error('[Auth Engine] Failed to write admin bootstrap password file:', err);
    }
  } else if (process.env.ADMIN_PASSWORD) {
    console.log('[Auth Engine] Applying ADMIN_PASSWORD from environment to usr_admin.');
  }

  userProfiles[idx] = { ...admin, password: hashPassword(plain), username: admin.username || 'admin' };
  try {
    saveDatabaseToDisk();
  } catch (err) {
    console.error('[Auth Engine] Failed to persist bootstrapped admin password:', err);
  }
}


// ============================================================================
// STARTUP LOAD — SQLite canonical store with one-time legacy JSON migration
// ============================================================================

// Helper: Load App State from SQLite on Startup (with one-time legacy JSON migration)
export function loadDatabaseFromDisk() {
  try {
    // 0. One-time row fixups that MUST run before getAllManga() loads data.
    //    Gated by migration_version so they only execute once.
    const preLoadVersion = parseInt(SqliteDb.getSetting('migration_version') || '0', 10);
    if (preLoadVersion < 3) {
      try { SqliteDb.rekeyCollidedSourceIds(); } catch (e) { console.warn("[SQLite Engine] rekeyCollidedSourceIds failed:", e); }
      try { SqliteDb.purgeTestRemnants(); } catch (e) { console.warn("[SQLite Engine] purgeTestRemnants failed:", e); }
      SqliteDb.setSetting('migration_version', String(Math.max(preLoadVersion, 3)));
    }

    // 1. Manga library: SQLite is the canonical store.
    syncConfig.totalTracked = SqliteDb.getMangaCount();

    // 2. Detect whether app state already lives in SQLite; otherwise perform a
    //    one-time migration of profiles/settings/config/logs from database.json.
    const storedProfiles = SqliteDb.getAllProfiles();
    const storedSettingsJson = SqliteDb.getSetting('appSettings');
    const storedConfigJson = SqliteDb.getSetting('syncConfig');
    const storedLogs = SqliteDb.getAllLogs();

    let legacyParsed: any = null;
    const needsLegacyMigration = storedProfiles.length === 0 && !storedSettingsJson;
    if (needsLegacyMigration && fs.existsSync(DB_FILE_PATH)) {
      try {
        legacyParsed = JSON.parse(fs.readFileSync(DB_FILE_PATH, "utf-8"));
        console.log(`[SQLite Engine] Performing one-time legacy migration from database.json...`);
      } catch (err) {
        console.error("[SQLite Engine] Failed to parse legacy database.json:", err);
      }
    }

    // 3. User Profiles
    if (storedProfiles.length > 0) {
      userProfiles = storedProfiles.map((p: any) => ({
        ...p,
        email: decryptPII(p.email || ''),
        storageFolderPath: p.storageFolderPath ? decryptPII(p.storageFolderPath) : undefined,
      }));
    } else if (legacyParsed?.userProfiles && Array.isArray(legacyParsed.userProfiles)) {
      userProfiles = legacyParsed.userProfiles.map((p: any) => ({
        ...p,
        email: decryptPII(p.email || ''),
        storageFolderPath: p.storageFolderPath ? decryptPII(p.storageFolderPath) : undefined,
      }));
    }

    // Ensure seed admin/guest always exist
    if (!userProfiles.some((p) => p.id === 'usr_admin')) {
      userProfiles.unshift({
        id: 'usr_admin',
        name: 'Host Administrator',
        username: 'admin',
        email: 'admin@manga.dev',
        avatar: '🛡️',
        role: 'admin',
        createdAt: new Date().toISOString(),
      });
    }
    if (!userProfiles.some((p) => p.id === 'usr_guest')) {
      userProfiles.push({
        id: 'usr_guest',
        name: 'Guest Reader',
        username: 'guest',
        email: 'guest@graywood.app',
        avatar: '👤',
        role: 'user',
        createdAt: new Date().toISOString(),
      });
    }

    // Bootstrap admin password if missing (env ADMIN_PASSWORD or one-time generated file)
    ensureAdminPasswordBootstrap();



    // 4. Sync Config (subdomain, update interval, disabled sources...)
    if (storedConfigJson) {
      try { applySyncConfigRestored({ ...syncConfig, ...JSON.parse(storedConfigJson) }); } catch (e) { }
    } else if (legacyParsed?.syncConfig) {
      applySyncConfigRestored({ ...syncConfig, ...legacyParsed.syncConfig });
    }

    // 5. App Settings (reader defaults, network, AI keys...)
    if (storedSettingsJson) {
      try {
        const parsedSettings = JSON.parse(storedSettingsJson);
        appSettings = {
          ...appSettings,
          ...parsedSettings,
          captchaApiKey: decryptPII(parsedSettings.captchaApiKey || ''),
          discordWebhookUrl: decryptPII(parsedSettings.discordWebhookUrl || ''),
          telegramBotToken: decryptPII(parsedSettings.telegramBotToken || ''),
        };
      } catch (e) { }
    } else if (legacyParsed?.appSettings) {
      appSettings = {
        ...appSettings,
        ...legacyParsed.appSettings,
        captchaApiKey: decryptPII(legacyParsed.appSettings.captchaApiKey || ''),
        discordWebhookUrl: decryptPII(legacyParsed.appSettings.discordWebhookUrl || ''),
        telegramBotToken: decryptPII(legacyParsed.appSettings.telegramBotToken || ''),
      };
    }

    // 6. Auto-Update Logs
    if (storedLogs.length > 0) {
      autoUpdateLogs = storedLogs.map((l: any) => ({
        id: l.id,
        mangaId: l.mangaId || '',
        mangaTitle: l.mangaTitle || '',
        previousChapter: Number(l.previousChapter) || 0,
        newChapter: Number(l.newChapter) || 0,
        source: l.sourceName || '',
        timestamp: l.timestamp || new Date().toISOString(),
        type: l.type || 'manhwa',
      }));
    } else if (legacyParsed?.autoUpdateLogs && Array.isArray(legacyParsed.autoUpdateLogs)) {
      autoUpdateLogs = legacyParsed.autoUpdateLogs;
    }

    // 7. Persist migrated legacy state into SQLite immediately.
    if (legacyParsed) {
      saveDatabaseToDisk();
    }

    // Auto-mark setup completed if database already contains existing series or settings
    const currentMangaCount = SqliteDb.getMangaCount();
    if (!appSettings.initialSetupCompleted && (storedSettingsJson || currentMangaCount > 0)) {
      appSettings.initialSetupCompleted = true;
    }

    console.log(`[SQLite Engine] Startup state loaded (SQLite canonical): ${currentMangaCount} series, ${userProfiles.length} profiles, ${autoUpdateLogs.length} update logs.`);
  } catch (err) {
    console.error("[SQLite Engine] Error loading app state on startup:", err);
  }
}

// Helper: Purge any residual Reaper Scans items from SQLite
export function purgeReaperScansFromAllStorage() {
  try {
    const sqlitePurged = SqliteDb.purgeReaperScans();
    syncConfig.totalTracked = SqliteDb.getMangaCount();
    if (sqlitePurged > 0) {
      console.log(`[Purge Engine] Successfully purged ${sqlitePurged} SQLite Reaper Scans entries.`);
      saveDatabaseToDisk();
    }
  } catch (e) { }
}


// ============================================================================
// SETTINGS FIELD WHITELIST — defense-in-depth. POST /api/settings is already
// host-only, but no client (or malformed backup file) may ever inject keys
// outside these lists into persisted app state.
// ============================================================================

export const SETTINGS_ALLOWED_KEYS = new Set<string>([
  'appTheme', 'libraryLayout', 'gridColumns', 'autoMarkReadPercent',
  'enableDownloadOffline', 'sourceTimeoutSeconds',
  'anilistConnected', 'anilistToken', 'anilistAutoSync',
  'malConnected', 'malToken', 'malAutoSync',
  'kitsuConnected', 'kitsuToken', 'kitsuAutoSync',
  'mangadexConnected', 'privateModeEnabled', 'customUserAgent',
  // Multi-provider metadata enrichers & toggles
  'mangadexMetadataEnabled', 'anilistMetadataEnabled', 'malEnabled',
  'kitsuMetadataEnabled', 'mangaUpdatesEnabled', 'mangaUpdatesUsername',
  'mangaUpdatesPassword', 'openlibraryEnabled', 'googleBooksEnabled',
  'enableCloudflareBypass', 'flareSolverrUrl', 'captchaSolverEnabled',
  'captchaApiKey', 'stealthMode', 'preferredLanguage',
  'autoFormatReadingMode', 'defaultMangaMode', 'defaultManhwaMode',
  'defaultManhuaMode', 'readerDefaults',
  // Webhook & Push Notifications
  'discordWebhookUrl', 'discordWebhookEnabled',
  'telegramBotToken', 'telegramChatId', 'telegramWebhookEnabled',
  'notifyOnlyReadingStatus',
  // App Lock
  'appLockEnabled', 'appLockPinHash', 'appLockType', 'appLockTimeoutMinutes',
  // Scheduled Auto-Backups
  'autoBackupEnabled', 'autoBackupSchedule', 'autoBackupMaxCount', 'autoBackupLastRun',
  // Ambient Soundscapes & Polish
  'ambientSoundEnabled', 'ambientSoundPreset', 'ambientSoundVolume',
  'pageTurnSfxEnabled', 'magnifierEnabled',
  // System Initial Setup & Pinned Sources
  'initialSetupCompleted', 'initialSetupTimestamp', 'pinnedSources',
]);
export const READER_DEFAULTS_ALLOWED_KEYS = new Set<string>([
  'viewMode', 'maxWidth', 'pageGap', 'bgColor', 'zoomLevel', 'autoMarkRead',
  'imageFilter', 'autoScrollEnabled', 'autoScrollSpeed', 'tapZonesEnabled',
  'cropWhiteMargins', 'showPageNumberOverlay', 'showPersistentPageBadge',
  'autoNextChapter', 'mangaFitMode', 'preloadCount', 'autoFormatMode',
  'rememberPerSeries', 'guidedPanelView', 'noPanelSpacing', 'prefetchNextChapter',
]);
export const CONFIG_ALLOWED_KEYS = new Set<string>([
  'subdomain', 'autoUpdateIntervalMinutes', 'enableWebCrawling', 'sources',
  'disabledSources', 'removedSources', 'reactivatedSources', 'lastSyncTime', 'totalTracked',
  'pinnedSources',
]);
// Sentinel returned in place of secrets whenever settings
// leave the server. Clients/backup files that send it back mean "no change".
export const MASKED_SECRET = '••••••••';

export function sanitizeIncomingSettings(raw: any): Record<string, any> {
  const clean: Record<string, any> = {};
  if (!raw || typeof raw !== 'object') return clean;
  for (const key of Object.keys(raw)) {
    if (!SETTINGS_ALLOWED_KEYS.has(key)) continue; // drop unknown/injected keys
    clean[key] = raw[key];
  }
  if (clean.readerDefaults && typeof clean.readerDefaults === 'object') {
    const rd: Record<string, any> = {};
    for (const key of Object.keys(clean.readerDefaults)) {
      if (READER_DEFAULTS_ALLOWED_KEYS.has(key)) rd[key] = clean.readerDefaults[key];
    }
    clean.readerDefaults = rd;
  } else {
    delete clean.readerDefaults;
  }
  // Secret handling: empty or masked values mean "keep the existing key".
  if (clean.captchaApiKey === undefined || clean.captchaApiKey === '' || clean.captchaApiKey === MASKED_SECRET) {
    delete clean.captchaApiKey;
  }
  if (clean.mangaUpdatesPassword === undefined || clean.mangaUpdatesPassword === '' || clean.mangaUpdatesPassword === MASKED_SECRET) {
    delete clean.mangaUpdatesPassword;
  }
  if (clean.discordWebhookUrl === undefined || clean.discordWebhookUrl === '' || clean.discordWebhookUrl === MASKED_SECRET) {
    delete clean.discordWebhookUrl;
  }
  if (clean.telegramBotToken === undefined || clean.telegramBotToken === '' || clean.telegramBotToken === MASKED_SECRET) {
    delete clean.telegramBotToken;
  }
  return clean;
}

export function sanitizeIncomingConfig(raw: any): Record<string, any> {
  const clean: Record<string, any> = {};
  if (!raw || typeof raw !== 'object') return clean;
  for (const key of Object.keys(raw)) {
    if (CONFIG_ALLOWED_KEYS.has(key)) clean[key] = raw[key];
  }
  return clean;
}

// Default App & Kotatsu Reader Settings in Server Memory
export let appSettings = {
  appTheme: 'amber',
  libraryLayout: 'grid',
  gridColumns: 4,
  autoMarkReadPercent: 80,
  enableDownloadOffline: true,
  sourceTimeoutSeconds: 15,
  anilistConnected: true,
  mangadexConnected: true,
  malConnected: false,
  malAutoSync: false,
  kitsuConnected: false,
  kitsuAutoSync: false,
  // Multi-provider metadata enrichers (all free / no-read-key APIs)
  mangadexMetadataEnabled: true,
  anilistMetadataEnabled: true,
  malEnabled: true,
  kitsuMetadataEnabled: true,
  mangaUpdatesEnabled: true,
  mangaUpdatesUsername: '',
  mangaUpdatesPassword: '',
  openlibraryEnabled: true,
  googleBooksEnabled: true,
  privateModeEnabled: false,
  customUserAgent: 'Kotatsu/4.8.2 (Android 14; Mobile; Graywood-Reader)',
  // Automated Cloudflare & Captcha Solver Config
  enableCloudflareBypass: true,
  flareSolverrUrl: 'http://localhost:8191/v1',
  captchaSolverEnabled: true,
  captchaApiKey: '', // 2Captcha / CapSolver API key
  stealthMode: true,
  // Webhooks & Notifications
  discordWebhookUrl: '',
  discordWebhookEnabled: false,
  telegramBotToken: '',
  telegramChatId: '',
  telegramWebhookEnabled: false,
  notifyOnlyReadingStatus: true,
  // App Lock
  appLockEnabled: false,
  appLockPinHash: '',
  appLockType: 'pin' as 'pin' | 'password' | 'biometric',
  appLockTimeoutMinutes: 5,
  // Scheduled Auto-Backups
  autoBackupEnabled: false,
  autoBackupSchedule: 'daily' as 'hourly' | 'daily' | 'weekly',
  autoBackupMaxCount: 10,
  autoBackupLastRun: '',
  // Ambient Soundscapes
  ambientSoundEnabled: false,
  ambientSoundPreset: 'off' as 'rain' | 'campfire' | 'waves' | 'cafe' | 'off',
  ambientSoundVolume: 0.5,
  pageTurnSfxEnabled: true,
  magnifierEnabled: true,
  initialSetupCompleted: false,
  initialSetupTimestamp: '',
  pinnedSources: ['asurascans', 'flamecomics', 'weebcentral', 'manhwa18'],
  readerDefaults: {
    viewMode: 'webtoon' as const,
    maxWidth: '850px',
    pageGap: 8,
    bgColor: 'slate' as const,
    zoomLevel: 100,
    autoMarkRead: true,
    imageFilter: 'normal' as const,
    autoScrollEnabled: false,
    autoScrollSpeed: 1, // 0.5, 1, 1.5, 2, 2.5, 3
    tapZonesEnabled: true,
    cropWhiteMargins: true,
    showPageNumberOverlay: true,
    showPersistentPageBadge: true,
    autoNextChapter: true,
    mangaFitMode: 'fit-height' as const,
    preloadCount: 3,
  },
};

export type AppSettings = typeof appSettings;

export function setAppSettings(next: AppSettings): void {
  appSettings = next;
}

let geminiClient: any = null;
export function getGeminiClient(): any {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  if (!geminiClient) {
    try {
      const { GoogleGenAI } = require("@google/genai");
      geminiClient = new GoogleGenAI({ apiKey: key });
    } catch {
      return null;
    }
  }
  return geminiClient;
}
