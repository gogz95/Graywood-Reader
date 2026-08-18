import express from "express";
import compression from "compression";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { GoogleGenAI } from "@google/genai";
import * as cheerio from "cheerio";
import { MangaItem, DuplicateCandidate, AutoUpdateLog, DatabaseSyncConfig, UserProfile, UserRole, SourceDefinition, SourceEngineType, isMangaDexSourceLink } from "./src/types";
import {
  resolveEncryptionSecret,
  ENCRYPTION_SECRET,
  encryptPII,
  decryptPII,
  hashPassword,
  isAlreadyHashed,
  verifyPassword,
  verifyPasswordAsync,
  AUTH_ENABLED,
  AUTH_TOKEN_TTL_MS,
  AUTH_SIGNING_KEY,
  signAuthToken,
  verifyAuthToken,
  revokeAuthToken,
  toPublicUser,
  isHostRequest,
  isPrivateOrReservedIp,
  assertSafeProxyTarget,
  fetchWithSsrfGuard,
  MAX_PROXY_IMAGE_BYTES,
  streamProxiedImage,
  normalizeGatePath,
  isHostOnlyPath,
  SENSITIVE_GET_PATHS,
} from "./server/security";
import {
  rateLimitMiddleware,
  isImageProxyPath,
  RATE_LIMIT_MAX,
  RATE_LIMIT_PROXY_MAX,
  RATE_LIMIT_WINDOW,
  ipRequestCounts,
  ipProxyRequestCounts,
  checkLoginRateLimit,
  recordLoginFailure,
  clearLoginFailures,
  checkAccountLockout,
  recordAccountFailure,
  clearAccountFailures,
} from "./server/rateLimit";
import {
  detectChallenge,
  solveWithFlareSolverr,
  checkSolverBalance,
  fetchWithChallengeBypass,
} from "./server/captchaSolver";
import { sourceCircuitBreaker, CircuitState } from "./server/circuitBreaker";
import { notesRouter } from "./server/routes/notes";
import { opdsRouter } from "./server/routes/opds";
import { localLibraryRouter } from "./server/routes/localLibrary";
import {
  APP_VERSION,
  APP_USER_AGENT,
  getSystemVersionReport,
} from "./server/version";
import { logger, requestLoggerMiddleware } from "./server/logger";
import {
  KOTATSU_SOURCES,
  ALL_SOURCES_CATALOG,
  SOURCE_MAP,
  INITIAL_DEAD_SOURCES,
  DYNAMIC_DEAD_SOURCES,
  ALL_DEAD_SOURCES,
  disabledSourceIds,
  rebuildDeadSourcesSet,
  syncDeadSourcesToDisabled,
  isSourceAlive,
  isMetadataOnlySource,
  buildFullSourceInventory,
  ensureSourceInRegistry,
  getSourceById,
} from "./server/sources/sourcesCatalog";

// === AD PROTECTION ===
const KNOWN_AD_DOMAINS = [
  'googleadservices', 'pagead2', 'googlesyndication', 'doubleclick',
  'ads', 'adn', 'adtech', 'mediavine', 'raptive', 'springboard',
  'content.ad', 'outbrowse', 'taboola', 'revcontent', 'nativo',
  'push', 'popunder', 'click-under', 'interstitial'
];

function isAdImageSrc(src: string, origin: string): boolean {
  try {
    const url = new URL(src, origin);
    const hostname = url.hostname.toLowerCase();
    for (const d of KNOWN_AD_DOMAINS) { if (hostname.includes(d)) return true; }
    if (/.*[/_](ad|banner|popunder|interstitial|media)(\?|$)/i.test(src)) return true;
    if (hostname.includes('google')) return true;
    return false;
  } catch { return false; }
}

function stripAdElements($root: any): void {
  const selectors = ['.ad-', '.banner-', '.popunder-', '.overlay-', '[class*=adsbygoogle]', '[id*=ad-]'];
  for (const sel of selectors) { try { $root.find(sel).remove(); } catch {} }
}

export {
  encryptPII,
  decryptPII,
  hashPassword,
  isAlreadyHashed,
  verifyPassword,
  verifyPasswordAsync,
  isHostRequest,
  KOTATSU_SOURCES,
  ALL_SOURCES_CATALOG,
  isSourceAlive,
  disabledSourceIds,
};

// Initialize Express
const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const HOST = process.env.HOST || "0.0.0.0";

// Securely resolve the real client IP when served behind the bundled nginx
// reverse proxy. Only trust X-Forwarded-For hops whose DIRECT peer is a
// loopback address (i.e. nginx on the same host). Remote clients that reach
// the app directly keep their raw socket IP, so the host-gate, admin identity
// and rate-limiter can never be spoofed via a forged X-Forwarded-For header.
app.set('trust proxy', (ip: string) => {
  const normalized = String(ip).toLowerCase().replace(/^::ffff:/, '');
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === 'localhost';
});

app.use(express.json({ limit: "10mb" }));

// Response compression (shrinks the multi-MB library payloads by ~80%)
app.use(compression());

// Expose custom pagination headers to browser fetch (needed for reading X-Total-Pages)
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Expose-Headers', 'X-Total-Count, X-Total-Pages');
  next();
});

// Structured request/access logging (method, URL, status, duration, user)
app.use(requestLoggerMiddleware);

// Baseline security response headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  // CSP is only applied to production builds: the Vite dev server injects
  // inline scripts (react-refresh preamble) that a strict policy would block.
  if (process.env.NODE_ENV === 'production') {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: blob: https:; media-src 'self' blob:; connect-src 'self'; " +
      "object-src 'none'; base-uri 'self'; frame-ancestors 'self'"
    );
  }
  next();
});

// =========================================================
// HOST-ONLY GATE FOR GLOBAL SETTINGS & DESTRUCTIVE OPERATIONS
// =========================================================
// The protected path set (HOST_ONLY_PATHS / SENSITIVE_GET_PATHS) and the
// normalization helpers live in server/security.ts so they are unit-testable.
app.use((req, res, next) => {
  const path = normalizeGatePath(req.path);
  if (!isHostOnlyPath(path)) return next();
  if (req.method === 'GET' && !SENSITIVE_GET_PATHS.has(path)) return next();
  if (!isHostRequest(req)) {
    return res.status(403).json({
      error: "Forbidden",
      message: "Global settings and administrative operations are restricted to the host computer.",
    });
  }
  next();
});

// DDOS PROTECTION & RATE LIMITING MIDDLEWARE (Bypassed for Host PC)
app.use(rateLimitMiddleware);

/**
 * Resolve the acting user for progress/favorites.
 * Never trusts client-supplied userId query/body — only Bearer token, else host default.
 */
function resolveRequestUserId(req: express.Request): string | null {
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
function canWriteCatalog(req: express.Request): boolean {
  return isHostRequest(req) || !!(req as any).user;
}

function rejectCatalogWrite(res: express.Response): void {
  res.status(401).json({
    error: 'Unauthorized',
    message: 'Catalog changes require a login token (or the host computer).',
  });
}

// Resolve the authenticated user (if any) from an Authorization header only.
// Query-string tokens are rejected — they leak via logs, Referer, and history.
function resolveAuthUser(req: express.Request): UserProfile | null {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  const payload = verifyAuthToken(token);
  if (!payload || typeof payload.sub !== 'string') return null;
  return userProfiles.find((u) => u.id === payload.sub) || null;
}

// Attach req.user for downstream handlers; never throws and never blocks.
app.use((req, _res, next) => {
  (req as any).user = resolveAuthUser(req);
  next();
});

// Enforce auth for remote (non-host) clients only when auth is explicitly enabled.
app.use((req, res, next) => {
  if (!AUTH_ENABLED) return next();
  // Public endpoints that must stay reachable without a token.
  const publicPaths = [
    '/api/auth/login',
    '/api/auth/register',
    '/api/auth/client-context',
    '/api/auth/me',
    '/api/health',
  ];
  if (publicPaths.some((p) => req.path === p || req.path.startsWith(p + '/'))) return next();
  if (isHostRequest(req)) return next();
  if ((req as any).user) return next();
  return res.status(401).json({ error: 'Unauthorized', message: 'A valid login token is required for remote access.' });
});

// Mount scoped routers AFTER the host-gate / rate-limit / auth middleware chain
// so they are covered by the same protections as the rest of the API.
// (opdsRouter intentionally lives here too — mounting it before the chain used
// to expose the whole catalog feed without auth/rate-limit/logging.)
app.use(opdsRouter);
app.use(notesRouter);
app.use(localLibraryRouter);

// Initialize Gemini Client
const getGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": APP_USER_AGENT,
      },
    },
  });
};

import { SqliteDb } from "./sqlite-db";

// Persistent Database File Path
const DB_FILE_PATH = path.join(process.cwd(), "database.json");



// In-Memory DB State
let mangaDatabase: MangaItem[] = [];

let userProfiles: UserProfile[] = [
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
let autoUpdateLogs: AutoUpdateLog[] = [];

let syncConfig: DatabaseSyncConfig = {
  subdomain: 'tracker.manhuahub.app',
  autoUpdateIntervalMinutes: 60,
  enableWebCrawling: true,
  sources: ['MangaDex API', 'AniList GraphQL', 'AsuraScans Feeds', 'FlameComics', 'WeebCentral', 'DemonicScans'],
  disabledSources: Array.from(disabledSourceIds),
  removedSources: [],
  reactivatedSources: [],
  lastSyncTime: new Date().toISOString(),
  totalTracked: 0,
};

// Initialize dead sources from syncConfig
rebuildDeadSourcesSet(syncConfig);
syncDeadSourcesToDisabled();

console.log(`[Source Engine] Initialized standalone source catalog with ${KOTATSU_SOURCES.length} sources`);



// Helper: Persist App State to SQLite (Profiles / Settings / Config / Logs).
// Manga rows are persisted directly by the sync* data-access functions below.
// PII fields are AES-256-GCM encrypted & passwords scrypt-hashed before storage.
let saveTimeoutTimer: NodeJS.Timeout | null = null;

function buildEncryptedProfiles() {
  return userProfiles.map((p) => ({
    ...p,
    email: encryptPII(p.email || ''),
    storageFolderPath: p.storageFolderPath && !String(p.storageFolderPath).startsWith('enc:')
      ? encryptPII(String(p.storageFolderPath))
      : (p.storageFolderPath || ''),
    password: p.password ? (isAlreadyHashed(p.password) ? p.password : hashPassword(p.password)) : '',
  }));
}

function buildEncryptedSettings() {
  return {
    ...appSettings,
    captchaApiKey: appSettings.captchaApiKey && !appSettings.captchaApiKey.startsWith('enc:')
      ? encryptPII(appSettings.captchaApiKey)
      : (appSettings.captchaApiKey || ''),
  };
}

function saveDatabaseToDisk() {
  if (saveTimeoutTimer) clearTimeout(saveTimeoutTimer);

  saveTimeoutTimer = setTimeout(() => {
    try {
      SqliteDb.replaceAllProfiles(buildEncryptedProfiles());
      SqliteDb.setSetting('appSettings', JSON.stringify(buildEncryptedSettings()));
      SqliteDb.setSetting('syncConfig', JSON.stringify(syncConfig));
      SqliteDb.replaceAllLogs(autoUpdateLogs);
    } catch (err) {
      console.error("[SQLite Engine] Error persisting app state:", err);
    }
  }, 100);
}

// Legacy JSON snapshot writer — used only for graceful-shutdown backups and
// explicit exports. SQLite (data/manga.db) is the canonical persistent store.
function writeLegacyJsonSnapshot(reason: string) {
  try {
    const dataToSave = {
      version: 1,
      gdprEncrypted: true,
      lastSaved: new Date().toISOString(),
      mangaDatabase,
      userProfiles: buildEncryptedProfiles(),
      autoUpdateLogs,
      syncConfig,
      appSettings: buildEncryptedSettings(),
    };

    // Atomic write via temporary file
    const tempPath = `${DB_FILE_PATH}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(dataToSave, null, 2), "utf-8");
    fs.renameSync(tempPath, DB_FILE_PATH);
    console.log(`[GDPR Database Engine] Wrote legacy JSON snapshot (${reason}) with ${mangaDatabase.length} series & ${userProfiles.length} encrypted profiles.`);
  } catch (err) {
    console.error("[GDPR Database Engine] Error writing legacy JSON snapshot:", err);
  }
}

// ==========================================
// UNIFIED DATABASE SYNCHRONIZATION (DA LAYER)
// ==========================================

export function syncAddOrUpdateManga(item: MangaItem): MangaItem {
  SqliteDb.upsertManga(item);
  const idx = mangaDatabase.findIndex((m) => m.id === item.id);
  if (idx !== -1) {
    mangaDatabase[idx] = item;
  } else {
    mangaDatabase.unshift(item);
  }
  syncConfig.totalTracked = mangaDatabase.length;
  saveDatabaseToDisk();
  return item;
}

export function syncBulkAddOrUpdateManga(items: MangaItem[]) {
  if (!items || items.length === 0) return;
  SqliteDb.bulkUpsertManga(items);
  // Fix #4: Build an index so each lookup is O(1) instead of O(n)
  const idxMap = new Map<string, number>();
  mangaDatabase.forEach((m, i) => idxMap.set(m.id, i));
  for (const item of items) {
    const existingIdx = idxMap.get(item.id);
    if (existingIdx !== undefined) {
      mangaDatabase[existingIdx] = item;
    } else {
      idxMap.set(item.id, mangaDatabase.length);
      mangaDatabase.push(item);
    }
  }
  syncConfig.totalTracked = mangaDatabase.length;
  saveDatabaseToDisk();
}

export function syncDeleteManga(id: string) {
  SqliteDb.deleteManga(id);
  mangaDatabase = mangaDatabase.filter((m) => m.id !== id);
  syncConfig.totalTracked = mangaDatabase.length;
  saveDatabaseToDisk();
}

export function syncResetManga(items: MangaItem[]) {
  SqliteDb.deleteAllManga();
  SqliteDb.bulkUpsertManga(items);
  mangaDatabase = [...items];
  syncConfig.totalTracked = mangaDatabase.length;
  saveDatabaseToDisk();
}

/**
 * Canonical manga lookup: SQLite is the source of truth, with the in-memory
 * array as a fallback so handlers never disagree about which rows exist.
 */
function resolveManga(id: string): MangaItem | undefined {
  if (!id) return undefined;
  return SqliteDb.getMangaById(id) || mangaDatabase.find((m) => m.id === id) || undefined;
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

// Helper: Load App State from SQLite on Startup (with one-time legacy JSON migration)
function loadDatabaseFromDisk() {
  try {
    // 0. One-time re-key of rows created by the old truncated-base64url source-ID
    //    generator (which collapsed every series on a site into a single row).
    //    Must run before mangaDatabase is loaded so the fixed IDs are used.
    try { SqliteDb.rekeyCollidedSourceIds(); } catch (e) { console.warn("[SQLite Engine] rekeyCollidedSourceIds failed:", e); }

    // 1. Manga library: SQLite is the canonical store.
    //    (migrateJsonToSqlite() already imported any legacy database.json at module load.)
    mangaDatabase = SqliteDb.getAllManga();
    syncConfig.totalTracked = mangaDatabase.length;

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
        };
      } catch (e) { }
    } else if (legacyParsed?.appSettings) {
      appSettings = {
        ...appSettings,
        ...legacyParsed.appSettings,
        captchaApiKey: decryptPII(legacyParsed.appSettings.captchaApiKey || ''),
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

    console.log(`[SQLite Engine] Startup state loaded (SQLite canonical): ${mangaDatabase.length} series, ${userProfiles.length} profiles, ${autoUpdateLogs.length} update logs.`);

    // 8. Rewrite stale live-source URLs (asuracomic.net → asurascans.com, /manhwa/ → /manga/, …)
    try { migrateStaleSourceUrlsInDatabase(); } catch (e) {
      console.warn('[Migration] stale source URL rewrite failed:', (e as Error)?.message || e);
    }

    purgeReaperScansFromAllStorage();
  } catch (err) {
    console.error("[SQLite Engine] Error loading app state on startup:", err);
  }
}

export function isSeriesFromDisabledSource(m: MangaItem): boolean {
  if (disabledSourceIds.size === 0) return false;

  const sName = (m.sourceName || '').toLowerCase();
  const sUrl = (m.sourceUrl || '').toLowerCase();

  for (const disabledId of disabledSourceIds) {
    const sourceDef = KOTATSU_SOURCES.find((s) => s.id === disabledId);
    if (!sourceDef) continue;

    const sourceNameLower = sourceDef.name.toLowerCase();
    const sourceIdLower = sourceDef.id.toLowerCase();
    const baseDomain = sourceDef.baseUrl.replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase();

    // Check if series belongs to this disabled source
    const matchesName = sName.includes(sourceIdLower) || sName.includes(sourceNameLower);
    const matchesUrl = sUrl && (sUrl.includes(sourceIdLower) || sUrl.includes(baseDomain));

    if (matchesName || matchesUrl) {
      // MangaDex API fallback exception: if MangaDex is enabled and item has apiId, keep it!
      const mangadexIsEnabled = !disabledSourceIds.has('mangadex');
      if (mangadexIsEnabled && (m.apiId || m.id.startsWith('md_') || (m.syncedFromApi && m.syncedFromApi.includes('MangaDex')))) {
        return false;
      }
      return true;
    }
  }

  return false;
}

export async function purgeDisabledSourcesAndRefreshMetadata(): Promise<{
  purgedCount: number;
  refreshedCount: number;
  remainingCount: number;
}> {
  console.log("[Active Sources Engine] Purging disabled sources and refreshing metadata...");

  // 1. Purge items belonging to disabled sources from SQLite & mangaDatabase
  const itemsToKeep: MangaItem[] = [];
  const purgedIds: string[] = [];

  for (const item of mangaDatabase) {
    if (isSeriesFromDisabledSource(item)) {
      purgedIds.push(item.id);
    } else {
      itemsToKeep.push(item);
    }
  }

  for (const id of purgedIds) {
    SqliteDb.deleteManga(id);
  }

  mangaDatabase = itemsToKeep;
  console.log(`[Active Sources Engine] Purged ${purgedIds.length} series belonging to disabled sources. Active series remaining: ${mangaDatabase.length}`);

  // 2. Refresh metadata for all remaining active series (bounded concurrency to avoid hammering APIs)
  const updatedItems: MangaItem[] = [];

  const METADATA_BATCH = 5;
  for (let i = 0; i < mangaDatabase.length; i += METADATA_BATCH) {
    const batch = mangaDatabase.slice(i, i + METADATA_BATCH);
    const results = await Promise.all(
      batch.map(async (item) => {
        let updated = await refreshSingleMangaMetadata({ ...item }).catch(() => ({ ...item }));

        // Clean up altTitles & ensure non-empty description
        const altSet = new Set((updated.altTitles || []).filter((a) => a && a.toLowerCase() !== updated.title.toLowerCase()));
        updated.altTitles = Array.from(altSet);
        if (!updated.description || updated.description.trim() === '') {
          updated.description = `${updated.title} is an active series tracked via ${updated.sourceName || 'Webtoon Source'}.`;
        }
        if (!updated.genres || updated.genres.length === 0) {
          updated.genres = ['Action', 'Fantasy'];
        }
        return updated;
      })
    );
    updatedItems.push(...results);
  }

  // 3. Persist refreshed items to SQLite and database.json
  syncResetManga(updatedItems);

  console.log(`[Active Sources Engine] Refresh complete: ${purgedIds.length} purged, ${updatedItems.length} refreshed.`);
  return {
    purgedCount: purgedIds.length,
    refreshedCount: updatedItems.length,
    remainingCount: mangaDatabase.length,
  };
}

// Helper: Purge any residual Reaper Scans items from memory & SQLite
function purgeReaperScansFromAllStorage() {
  const initialLen = mangaDatabase.length;
  mangaDatabase = mangaDatabase.filter((m) => {
    const isReaper = (m.sourceName && m.sourceName.includes('Reaper Scans')) || (m.sourceUrl && m.sourceUrl.includes('reaperscans.com'));
    if (isReaper) return false;
    if (m.availableSources && m.availableSources.length > 0) {
      m.availableSources = m.availableSources.filter(
        (s) => s.sourceName !== 'Reaper Scans' && !s.sourceUrl.includes('reaperscans.com')
      );
    }
    return true;
  });

  try {
    const sqlitePurged = SqliteDb.purgeReaperScans();
    const removedCount = initialLen - mangaDatabase.length;
    if (removedCount > 0 || sqlitePurged > 0) {
      console.log(`[Purge Engine] Successfully purged ${removedCount} memory items & ${sqlitePurged} SQLite Reaper Scans entries.`);
      saveDatabaseToDisk();
    }
  } catch (e) { }
}

// Descriptive metadata fields a live refresh may overwrite. Fields the user has
// manually customized (recorded in `metadataOverrides`) are preserved so manual
// edits never vanish when metadata is refreshed. `latestChapter` is intentionally
// excluded — it is a live counter that should always keep updating.
const OVERRIDEABLE_METADATA = ['title', 'description', 'coverImage', 'rating', 'genres', 'altTitles'] as const;

// Copy the current values of any user-overridden metadata fields so they can be
// restored after a live refresh mutates the manga object.
function snapshotMetadataOverrides(manga: MangaItem): Record<string, any> {
  const overridden = Array.isArray(manga.metadataOverrides) ? manga.metadataOverrides : [];
  const snap: Record<string, any> = {};
  for (const field of OVERRIDEABLE_METADATA) {
    if (overridden.includes(field)) {
      const value = (manga as any)[field];
      snap[field] = Array.isArray(value) ? [...value] : value;
    }
  }
  return snap;
}

// Re-apply user-overridden metadata fields (deep-copying arrays to avoid aliasing).
function restoreMetadataOverrides(manga: MangaItem, snap: Record<string, any>) {
  for (const field of OVERRIDEABLE_METADATA) {
    if (!(field in snap)) continue;
    const value = snap[field];
    (manga as any)[field] = Array.isArray(value) ? [...value] : value;
  }
}

// Helper: Refresh metadata for a single manga item from live sources
// Helper: Refresh metadata for a single manga item from live sources & MangaDex API
async function refreshSingleMangaMetadata(manga: MangaItem): Promise<MangaItem> {
  // Preserve user-customized metadata so this refresh cannot clobber manual edits.
  const metadataSnap = snapshotMetadataOverrides(manga);

  // 1. MangaDex Metadata Refresh & Title Search Linker
  let mangaDexId =
    manga.apiId ||
    (manga.id?.startsWith('md_') ? manga.id.replace('md_', '') : null) ||
    (manga.sourceUrl?.match(/\/title\/([a-f0-9\-]+)/i)?.[1]);

  // If no MangaDex ID linked yet, attempt title search lookup on MangaDex API
  if (!mangaDexId && manga.title && manga.title !== 'Unknown') {
    try {
      const cleanTitle = manga.title
        .replace(/\s*\([^)]*\)/g, '')
        .replace(/uncensored|reboot|hd|season \d+|ch \d+/gi, '')
        .trim();
      if (cleanTitle.length > 2) {
        const searchRes = await fetchMangaDex(
          `https://api.mangadex.org/manga?title=${encodeURIComponent(cleanTitle)}&limit=5&includes[]=cover_art&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica`
        );
        if (searchRes.ok) {
          const searchJson = await searchRes.json();
          // Pick the best match by title similarity instead of blindly taking the
          // first result. MangaDex's title search is a loose partial match, and for
          // niche/18+ titles the top hit can be a completely unrelated series —
          // binding it here silently overwrote correct metadata (e.g. "Announcer Raw").
          const results: any[] = Array.isArray(searchJson.data) ? searchJson.data : [];
          let matched: any = null;
          let bestSim = 0;
          for (const cand of results) {
            const candTitle = cand?.attributes?.title?.en || Object.values(cand?.attributes?.title || {})[0] || '';
            const sim = calculateStringSimilarity(cleanTitle, String(candTitle));
            if (sim > bestSim) { bestSim = sim; matched = cand; }
          }
          if (matched && bestSim >= 60) {
            mangaDexId = matched.id;
            manga.apiId = matched.id;
            manga.syncedFromApi = 'MangaDex API v5';
          } else if (matched) {
            console.warn(`[Metadata Refresh] MangaDex best match for "${manga.title}" scored ${bestSim} — below threshold (60), NOT linking.`);
          }
        }
      }
    } catch (_) { }
  }

  if (mangaDexId) {
    try {
      const mdRes = await fetchMangaDex(`https://api.mangadex.org/manga/${mangaDexId}?includes[]=cover_art`);
      if (mdRes.ok) {
        const mdJson = await mdRes.json();
        const attrs = mdJson.data?.attributes || {};
        const rels = mdJson.data?.relationships || [];
        const coverRel = rels.find((r: any) => r.type === 'cover_art');
        const coverFileName = coverRel?.attributes?.fileName;

        if (attrs.title) {
          const mainTitle = attrs.title.en || Object.values(attrs.title)[0];
          if (mainTitle) manga.title = mainTitle;
        }
        if (attrs.description && (attrs.description.en || Object.values(attrs.description)[0])) {
          manga.description = attrs.description.en || Object.values(attrs.description)[0];
        }
        if (attrs.altTitles && Array.isArray(attrs.altTitles)) {
          const newAlts = attrs.altTitles.map((t: any) => Object.values(t)[0]).filter(Boolean) as string[];
          manga.altTitles = Array.from(new Set([...(manga.altTitles || []), ...newAlts]));
        }
        if (coverFileName) {
          manga.coverImage = `/api/mangadex/image-proxy?url=${encodeURIComponent(`https://uploads.mangadex.org/covers/${mangaDexId}/${coverFileName}.512.jpg`)}`;
        }
        if (attrs.tags && Array.isArray(attrs.tags)) {
          const tags = attrs.tags.map((t: any) => t.attributes?.name?.en).filter(Boolean);
          if (tags.length > 0) {
            manga.genres = Array.from(new Set([...(manga.genres || []), ...tags]));
          }
        }

        // Fetch max chapter number from MangaDex chapter feed
        const feedRes = await fetchMangaDex(
          `https://api.mangadex.org/manga/${mangaDexId}/feed?limit=100&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica`
        );
        if (feedRes.ok) {
          const feedJson = await feedRes.json();
          const chapters = feedJson.data || [];
          const maxCh = chapters.reduce((max: number, c: any) => Math.max(max, parseFloat(c.attributes.chapter) || 0), manga.latestChapter || 1);
          if (maxCh > (manga.latestChapter || 0)) {
            manga.latestChapter = maxCh;
          }
        }
      }
    } catch (e: any) {
      console.warn(`[Metadata Refresh] MangaDex refresh failed for ${manga.title}:`, e.message);
    }
  }


  // 2. Asura Scans Metadata Refresh
  if (manga.sourceUrl && /asura(?:comic\.net|scans\.(?:com|org))/i.test(manga.sourceUrl)) {
    // Normalize any legacy/mirror asura domain to the live canonical domain
    manga.sourceUrl = manga.sourceUrl.replace(/asuracomic\.net/gi, 'asurascans.com').replace(/asurascans\.(?:com|org)/gi, 'asurascans.com');
    try {
      let slug = manga.sourceUrl.split('/').pop() || '';
      if (manga.sourceUrl.includes('/manga/') || manga.sourceUrl.includes('/series/') || manga.sourceUrl.includes('/comics/')) {
        const parts = manga.sourceUrl.split('/');
        const idx = parts.findIndex((p) => p === 'manga' || p === 'series' || p === 'comics');
        if (idx !== -1 && parts[idx + 1]) {
          slug = parts[idx + 1];
        }
      }

      if (slug) {
        // Strip the site-wide rotating token; the API resolves the bare slug.
        const cleanSlug = slug.replace(/-[0-9a-f]{8}$/i, '') || slug;
        const slugsToTry = Array.from(new Set([cleanSlug, slug]));

        for (const s of slugsToTry) {
          const res = await fetch(`https://api.asurascans.com/api/series/${s}`, {
            signal: AbortSignal.timeout(12000),
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Accept': 'application/json',
              'Origin': 'https://asurascans.com',
              'Referer': 'https://asurascans.com/',
            },
          });

          if (res.ok) {
            const json = await res.json();
            const series = json.series || {};
            if (series.title) manga.title = series.title;
            if (series.cover) manga.coverImage = series.cover;
            if (series.description) manga.description = series.description;
            if (series.rating) manga.rating = Math.round(Number(series.rating) * 10) / 10;
            if (series.chapter_count) manga.latestChapter = Math.max(manga.latestChapter || 1, Number(series.chapter_count));
            if (series.alt_titles && Array.isArray(series.alt_titles)) {
              manga.altTitles = Array.from(new Set([...(manga.altTitles || []), ...series.alt_titles]));
            }
            if (series.genres && Array.isArray(series.genres)) {
              const genreNames = series.genres.map((g: any) => (typeof g === 'string' ? g : g.name)).filter(Boolean);
              if (genreNames.length > 0) manga.genres = Array.from(new Set([...(manga.genres || []), ...genreNames]));
            }
            break;
          }
        }
      }
    } catch (e: any) {
      console.warn(`[Metadata Refresh] Asura Scans refresh failed for ${manga.title}:`, e.message);
    }
  }

  // 3. Flame Comics Metadata Refresh
  if (manga.sourceUrl && manga.sourceUrl.includes('flamecomics')) {
    try {
      const homeRes = await fetch("https://flamecomics.xyz/", { signal: AbortSignal.timeout(12000) });
      if (homeRes.ok) {
        const html = await homeRes.text();
        const buildId = html.match(/\/_next\/static\/([^/]+)\/_buildManifest\.js/)?.[1];
        if (buildId) {
          const browseRes = await fetch(`https://flamecomics.xyz/_next/data/${buildId}/browse.json`, { signal: AbortSignal.timeout(12000) });
          if (browseRes.ok) {
            const browseJson = await browseRes.json();
            const seriesList = browseJson.pageProps?.series || [];
            const rawSlug = manga.sourceUrl.split('/').pop() || '';
            const matchedSeries = seriesList.find((s: any) => {
              const sId = String(s.series_id || s.id);
              const sTitle = (s.title?.toLowerCase().replace(/[^a-z0-9]/g, '') || '');
              const targetNorm = rawSlug.toLowerCase().replace(/[^a-z0-9]/g, '');
              if (sId === rawSlug) return true;
              if (targetNorm && sTitle === targetNorm) return true;
              return targetNorm.length >= 5 && !!sTitle && sTitle.includes(targetNorm);
            });

            if (matchedSeries) {
              const seriesId = matchedSeries.series_id || matchedSeries.id;
              const seriesRes = await fetch(`https://flamecomics.xyz/_next/data/${buildId}/series/${seriesId}.json`, { signal: AbortSignal.timeout(12000) });
              if (seriesRes.ok) {
                const seriesData = await seriesRes.json();
                const props = seriesData.pageProps || {};
                const chapters = props.chapters || [];
                if (matchedSeries.title) manga.title = matchedSeries.title;
                if (chapters.length > 0) {
                  manga.latestChapter = Math.max(manga.latestChapter || 1, chapters.length);
                }
              }
            }
          }
        }
      }
    } catch (e: any) {
      console.warn(`[Metadata Refresh] Flame Comics refresh failed for ${manga.title}:`, e.message);
    }
  }

  // Re-apply user overrides so manual metadata edits survive this refresh.
  restoreMetadataOverrides(manga, metadataSnap);

  manga.lastUpdated = new Date().toISOString();
  SqliteDb.upsertManga(manga);

  // Update in memory database
  const idx = mangaDatabase.findIndex((m) => m.id === manga.id);
  if (idx !== -1) {
    mangaDatabase[idx] = manga;
  }
  saveDatabaseToDisk();

  return manga;
}



// --- HELPER FUNCTIONS ---

// String similarity calculation (Levenshtein + token matching)
function calculateStringSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const s2 = str2.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();

  if (s1 === s2) return 100;
  if (!s1 || !s2) return 0;

  if (s1.includes(s2) || s2.includes(s1)) {
    return 85;
  }

  const words1 = new Set(s1.split(/\s+/));
  const words2 = new Set(s2.split(/\s+/));

  let common = 0;
  for (const word of words1) {
    if (word.length > 2 && words2.has(word)) {
      common++;
    }
  }

  // Token matching ratio
  const t1 = new Set(s1.split(/\s+/));
  const t2 = new Set(s2.split(/\s+/));
  let shared = 0;
  t1.forEach((t) => { if (t2.has(t)) shared++; });
  const tokenSim = (2 * shared) / (t1.size + t2.size);

  // Character Levenshtein distance
  const len1 = s1.length;
  const len2 = s2.length;
  const matrix: number[][] = Array.from({ length: len1 + 1 }, () => Array(len2 + 1).fill(0));

  for (let i = 0; i <= len1; i++) matrix[i][0] = i;
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  const levDist = matrix[len1][len2];
  const maxLen = Math.max(len1, len2);
  const levSim = 1 - levDist / maxLen;

  // Weighted average: 60% token similarity + 40% Levenshtein similarity
  return Math.round((tokenSim * 0.6 + levSim * 0.4) * 100);
}

// Kotatsu Source Integration & Smart Merge Engine
export function integrateKotatsuSourcesAndMerge(incomingItems: Partial<MangaItem>[]): {
  mergedCount: number;
  uncertainCount: number;
  newCount: number;
} {
  let mergedCount = 0;
  let uncertainCount = 0;
  let newCount = 0;

  for (const item of incomingItems) {
    if (!item.title) continue;

    const normTitle = item.title.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!normTitle) continue;

    // 1. Check for CLEARLY IDENTICAL match
    const exactMatch = mangaDatabase.find((m) => {
      const existingNorm = m.title.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (existingNorm === normTitle) return true;
      return m.altTitles.some((alt) => alt.toLowerCase().replace(/[^a-z0-9]/g, '') === normTitle);
    });

    if (exactMatch) {
      // Clearly identical series: Merge fields directly
      if (!exactMatch.availableSources) exactMatch.availableSources = [];
      if (item.sourceName && item.sourceUrl) {
        const srcExists = exactMatch.availableSources.some(
          (s) => s.sourceName === item.sourceName || s.sourceUrl === item.sourceUrl
        );
        if (!srcExists) {
          exactMatch.availableSources.push({
            sourceName: item.sourceName,
            sourceUrl: item.sourceUrl,
          });
        }
      }
      if (item.apiId) {
        exactMatch.apiId = item.apiId;
      }
      if (item.sourceUrl) {
        exactMatch.sourceUrl = item.sourceUrl;
      }
      if (item.sourceName && !exactMatch.sourceName?.includes(item.sourceName)) {
        exactMatch.sourceName = `${exactMatch.sourceName} • ${item.sourceName}`;
      }
      if (item.latestChapter && item.latestChapter > exactMatch.latestChapter) {
        exactMatch.latestChapter = item.latestChapter;
      }
      if (item.genres && item.genres.length > 0) {
        exactMatch.genres = Array.from(new Set([...exactMatch.genres, ...item.genres]));
      }
      if (item.altTitles && item.altTitles.length > 0) {
        exactMatch.altTitles = Array.from(new Set([...exactMatch.altTitles, ...item.altTitles]));
      }
      syncAddOrUpdateManga(exactMatch);
      mergedCount++;
    } else {
      // 2. Check for UNCERTAIN / SIMILAR matches (similarity between 60% and 94%)
      let maxSim = 0;
      let similarTarget: MangaItem | null = null;

      for (const existing of mangaDatabase) {
        const sim = calculateStringSimilarity(existing.title, item.title);
        if (sim > maxSim) {
          maxSim = sim;
          similarTarget = existing;
        }
      }

      if (maxSim >= 60 && similarTarget) {
        // Near match (60%-95% similarity): Keep series distinct and register candidate pair for Merging Tool UI
        uncertainCount++;
      }

      // Insert new/similar series into database
      const newItem: MangaItem = {
        id: item.id || `kotatsu_db_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        title: item.title,
        altTitles: item.altTitles || [],
        type: (item.type as MangaItem['type']) || 'manhwa',
        coverImage: item.coverImage || '/api/mangadex/image-proxy?url=https%3A%2F%2Fuploads.mangadex.org%2Fcovers%2F32d76d19-8a05-4db0-9fc2-e0b0648fe9d0%2Ffbc962f9-3d12-4c6e-8212-32a2cb874a7b.jpg',
        description: item.description || `Indexed from ${item.sourceName || 'Kotatsu Source'}`,
        genres: item.genres || ['Action'],
        status: 'plan_to_read',
        currentChapter: 0,
        latestChapter: item.latestChapter || 1,
        totalChapters: item.latestChapter || 1,
        rating: item.rating || 8.2,
        notes: '',
        sourceUrl: item.sourceUrl || '',
        sourceName: item.sourceName || 'Kotatsu Engine',
        availableSources: item.sourceName && item.sourceUrl ? [{ sourceName: item.sourceName, sourceUrl: item.sourceUrl }] : [],
        autoUpdateEnabled: true,
        isFavorite: false,
        syncedFromApi: item.sourceName || 'Kotatsu Sources',
        addedAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        lastReadAt: new Date().toISOString(),
      };

      syncAddOrUpdateManga(newItem);
      newCount++;
    }
  }

  return { mergedCount, uncertainCount, newCount };

}

// ==========================================
// API ROUTES
// ==========================================

// Health Check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    version: APP_VERSION,
    uptime: process.uptime(),
    databaseSize: mangaDatabase.length,
  });
});

// System & Backend Component Version Info
app.get("/api/version", (_req, res) => {
  res.json(getSystemVersionReport());
});

// Sync Config / Subdomain details
app.get("/api/config", (req, res) => {
  syncConfig.totalTracked = mangaDatabase.length;
  res.json(syncConfig);
});

app.post("/api/config", (req, res) => {
  const { subdomain, autoUpdateIntervalMinutes, enableWebCrawling, sources } = req.body || {};
  if (subdomain !== undefined) syncConfig.subdomain = subdomain;
  if (autoUpdateIntervalMinutes !== undefined) syncConfig.autoUpdateIntervalMinutes = Number(autoUpdateIntervalMinutes);
  if (enableWebCrawling !== undefined) syncConfig.enableWebCrawling = Boolean(enableWebCrawling);
  if (Array.isArray(sources)) syncConfig.sources = sources;
  syncConfig.lastSyncTime = new Date().toISOString();
  saveDatabaseToDisk();
  res.json({ success: true, config: syncConfig });
});

// CRUD for Manga List (SQLite Engine + Persistent Backup Sync)
app.get("/api/manga", (req, res) => {
  // Server-side pagination/sorting (optional; omitted params keep the legacy
  // "return everything" behavior so the existing frontend is unaffected).
  const limitRaw = Number(req.query.limit);
  const offsetRaw = Number(req.query.offset);
  const hasPagination = (req.query.limit !== undefined || req.query.offset !== undefined) &&
    (Number.isFinite(limitRaw) || Number.isFinite(offsetRaw));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : 200;
  const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? Math.floor(offsetRaw) : 0;

  let allManga = SqliteDb.getAllManga();
  allManga = allManga.filter((m) => !isSeriesFromDisabledSource(m));

  // Overlay per-user favorites + chapter progress when we can resolve a user.
  const overlayUserId = resolveRequestUserId(req);
  if (overlayUserId) {
    allManga = SqliteDb.applyUserOverlay(allManga, overlayUserId);
  } else {
    // Anonymous/remote without token: never expose another user's favorites/progress
    allManga = allManga.map((m) => ({
      ...m,
      isFavorite: false,
      currentChapter: 0,
    }));
  }

  if (hasPagination) {
    const paged = allManga.slice(offset, offset + limit);
    res.setHeader('X-Total-Count', String(allManga.length));
    return res.json(paged);
  }
  res.json(allManga);
});

// Whitelisted fields a client is allowed to set when creating a manga.
const MANGA_CREATE_FIELDS = {
  title: (v: any) => String(v || 'Untitled Series'),
  altTitles: (v: any) => (Array.isArray(v) ? v : []),
  type: (v: any) => ['manga', 'manhwa', 'manhua'].includes(v) ? v : 'manhwa',
  coverImage: (v: any) => String(v || 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=500&auto=format&fit=crop&q=80'),
  description: (v: any) => String(v || 'No description provided.'),
  genres: (v: any) => (Array.isArray(v) ? v : ['Action']),
  status: (v: any) => String(v || 'reading'),
  currentChapter: (v: any) => Number(v) || 0,
  totalChapters: (v: any) => (v ? Number(v) : null),
  latestChapter: (v: any, all: any) => Number(v) || Number(all.currentChapter) || 1,
  rating: (v: any) => Number(v) || 8.0,
  sourceUrl: (v: any) => String(v || ''),
  sourceName: (v: any) => String(v || 'Custom / Manual'),
  autoUpdateEnabled: (v: any) => v !== false,
  notes: (v: any) => String(v || ''),
  syncedFromApi: (v: any) => v || null,
  apiId: (v: any) => v || null,
  isFavorite: (v: any) => Boolean(v),
};

app.post("/api/manga", (req, res) => {
  if (!canWriteCatalog(req)) return rejectCatalogWrite(res);
  const body = req.body || {};
  const newItem: MangaItem = {
    id: String(body.id || `m_${crypto.randomUUID()}`),
    title: MANGA_CREATE_FIELDS.title(body.title),
    altTitles: MANGA_CREATE_FIELDS.altTitles(body.altTitles),
    type: MANGA_CREATE_FIELDS.type(body.type),
    coverImage: MANGA_CREATE_FIELDS.coverImage(body.coverImage),
    description: MANGA_CREATE_FIELDS.description(body.description),
    genres: MANGA_CREATE_FIELDS.genres(body.genres),
    status: MANGA_CREATE_FIELDS.status(body.status) as MangaItem['status'],
    currentChapter: MANGA_CREATE_FIELDS.currentChapter(body.currentChapter),
    totalChapters: MANGA_CREATE_FIELDS.totalChapters(body.totalChapters),
    latestChapter: MANGA_CREATE_FIELDS.latestChapter(body.latestChapter, body),
    lastUpdated: new Date().toISOString(),
    rating: MANGA_CREATE_FIELDS.rating(body.rating),
    sourceUrl: MANGA_CREATE_FIELDS.sourceUrl(body.sourceUrl),
    sourceName: MANGA_CREATE_FIELDS.sourceName(body.sourceName),
    autoUpdateEnabled: MANGA_CREATE_FIELDS.autoUpdateEnabled(body.autoUpdateEnabled),
    notes: MANGA_CREATE_FIELDS.notes(body.notes),
    addedAt: new Date().toISOString(),
    lastReadAt: new Date().toISOString(),
    syncedFromApi: MANGA_CREATE_FIELDS.syncedFromApi(body.syncedFromApi),
    apiId: MANGA_CREATE_FIELDS.apiId(body.apiId),
    isFavorite: MANGA_CREATE_FIELDS.isFavorite(body.isFavorite),
    // userId is intentionally NEVER taken from the client body; it is derived
    // only from the authenticated user (or null for host/anonymous creates).
    userId: (req as any).user ? (req as any).user.id : null,
  };

  syncAddOrUpdateManga(newItem);
  // Per-user favorite if client requested isFavorite on create
  if (newItem.isFavorite) {
    const uid = resolveRequestUserId(req) || (newItem.userId as string) || null;
    if (uid) SqliteDb.setUserFavorite(uid, newItem.id, true);
  }
  const uid = resolveRequestUserId(req);
  res.status(201).json(uid ? SqliteDb.applyUserOverlay([newItem], uid)[0] : newItem);
});

// Single Manga Metadata Refresh Endpoint
app.post("/api/manga/:id/refresh-metadata", async (req, res) => {
  const { id } = req.params;
  const existing = SqliteDb.getMangaById(id) || mangaDatabase.find((m) => m.id === id);

  if (!existing) {
    return res.status(404).json({ error: "Manga not found" });
  }

  try {
    console.log(`[Metadata Engine] Refreshing live metadata for '${existing.title}' (${id})...`);
    const refreshed = await refreshSingleMangaMetadata(existing);
    res.json({ success: true, manga: refreshed, message: `Metadata refreshed for ${refreshed.title}` });
  } catch (err: any) {
    console.error(`[Metadata Engine] Failed to refresh metadata for ${id}:`, err);
    res.status(500).json({ error: "Failed to refresh metadata", details: err.message });
  }
});

// Bulk Metadata Refresh Endpoint for All Tracked Manga
app.post("/api/manga/refresh-all-metadata", async (_req, res) => {
  try {
    console.log(`[Metadata Engine] Starting bulk metadata refresh for all ${mangaDatabase.length} series...`);
    let refreshedCount = 0;

    // Refresh series in parallel batches of 5 to avoid rate limits
    const batchSize = 5;
    for (let i = 0; i < mangaDatabase.length; i += batchSize) {
      const batch = mangaDatabase.slice(i, i + batchSize);
      await Promise.all(batch.map((m) => refreshSingleMangaMetadata(m).catch(() => m)));
      refreshedCount += batch.length;
    }

    autoUpdateLogs.unshift({
      id: `log-${Date.now()}`,
      mangaId: 'bulk-refresh',
      mangaTitle: 'Bulk Metadata Refresh',
      previousChapter: 0,
      newChapter: refreshedCount,
      source: 'Metadata Refresh Engine',
      timestamp: new Date().toISOString(),
      type: 'manhwa',
    });
    if (autoUpdateLogs.length > 50) autoUpdateLogs.pop();

    saveDatabaseToDisk();
    res.json({
      success: true,
      updatedCount: refreshedCount,
      totalCount: mangaDatabase.length,
      message: `Successfully refreshed metadata for ${refreshedCount} series.`
    });
  } catch (err: any) {
    console.error("[Metadata Engine] Error during bulk metadata refresh:", err);
    res.status(500).json({ error: "Bulk metadata refresh failed", details: err.message });
  }
});

app.put("/api/manga/:id", (req, res) => {
  if (!canWriteCatalog(req)) return rejectCatalogWrite(res);
  const { id } = req.params;
  const existing = SqliteDb.getMangaById(id);
  if (!existing) {
    return res.status(404).json({ error: "Manga not found" });
  }

  const body = req.body || {};
  // Whitelisted mutable fields — id/userId/apiId/syncedFromApi are NEVER taken
  // from the client, preventing field injection / cross-user reassignment.
  const updatedItem: MangaItem = {
    ...existing,
    title: body.title !== undefined ? String(body.title) : existing.title,
    altTitles: body.altTitles !== undefined ? (Array.isArray(body.altTitles) ? body.altTitles : existing.altTitles) : existing.altTitles,
    type: body.type !== undefined ? (['manga', 'manhwa', 'manhua'].includes(body.type) ? body.type : existing.type) : existing.type,
    coverImage: body.coverImage !== undefined ? String(body.coverImage) : existing.coverImage,
    description: body.description !== undefined ? String(body.description) : existing.description,
    genres: body.genres !== undefined ? (Array.isArray(body.genres) ? body.genres : existing.genres) : existing.genres,
    status: body.status !== undefined ? (String(body.status) as MangaItem['status']) : existing.status,
    currentChapter: body.currentChapter !== undefined ? (Number(body.currentChapter) || 0) : existing.currentChapter,
    totalChapters: body.totalChapters !== undefined ? (body.totalChapters ? Number(body.totalChapters) : null) : existing.totalChapters,
    rating: body.rating !== undefined ? (Number(body.rating) || 0) : existing.rating,
    sourceUrl: body.sourceUrl !== undefined ? String(body.sourceUrl) : existing.sourceUrl,
    sourceName: body.sourceName !== undefined ? String(body.sourceName) : existing.sourceName,
    autoUpdateEnabled: body.autoUpdateEnabled !== undefined ? Boolean(body.autoUpdateEnabled) : existing.autoUpdateEnabled,
    notes: body.notes !== undefined ? String(body.notes) : existing.notes,
    isFavorite: body.isFavorite !== undefined ? Boolean(body.isFavorite) : existing.isFavorite,
    isFlagged: body.isFlagged !== undefined ? Boolean(body.isFlagged) : existing.isFlagged,
    flagReason: body.flagReason !== undefined ? String(body.flagReason) : existing.flagReason,
    lastUpdated: new Date().toISOString(),
  };

  syncAddOrUpdateManga(updatedItem);
  if (body.isFavorite !== undefined) {
    const uid = resolveRequestUserId(req) || 'usr_guest';
    SqliteDb.setUserFavorite(uid, updatedItem.id, Boolean(body.isFavorite));
  }
  const uid = resolveRequestUserId(req);
  res.json(uid ? SqliteDb.applyUserOverlay([updatedItem], uid)[0] : updatedItem);
});

app.post("/api/manga/increment/:id", (req, res) => {
  const { id } = req.params;
  const existing = SqliteDb.getMangaById(id);
  if (!existing) {
    return res.status(404).json({ error: "Manga not found" });
  }

  const userId = resolveRequestUserId(req) || 'usr_guest';
  const overlay = SqliteDb.applyUserOverlay([existing], userId)[0];
  const newChapter = (Number(overlay.currentChapter) || 0) + 1;
  SqliteDb.setUserLibraryChapter(userId, id, newChapter, {
    status: overlay.status === 'plan_to_read' ? 'reading' : overlay.status,
  });
  const updated = SqliteDb.applyUserOverlay([existing], userId)[0];
  res.json(updated);
});

app.post("/api/manga/toggle-favorite", (req, res) => {
  const { id, isFavorite } = req.body || {};
  if (!id) return res.status(400).json({ error: "Missing manga id" });

  const existing = SqliteDb.getMangaById(id);
  if (!existing) return res.status(404).json({ error: "Manga not found" });

  const userId = resolveRequestUserId(req) || 'usr_guest';
  SqliteDb.setUserFavorite(userId, String(id), Boolean(isFavorite));
  const updated = SqliteDb.applyUserOverlay([existing], userId)[0];
  res.json({ success: true, manga: updated });
});

app.post("/api/manga/toggle-flag", (req, res) => {
  if (!canWriteCatalog(req)) return rejectCatalogWrite(res);
  const { id, isFlagged, flagReason } = req.body || {};
  if (!id) return res.status(400).json({ error: "Missing manga id" });

  const existing = SqliteDb.getMangaById(id) || mangaDatabase.find((m) => m.id === id);
  if (existing) {
    existing.isFlagged = Boolean(isFlagged);
    existing.flagReason = flagReason || (isFlagged ? "Flagged for loading errors" : undefined);
    existing.flaggedAt = isFlagged ? new Date().toISOString() : undefined;
    syncAddOrUpdateManga(existing);
    
    // If we just flagged as broken, add automatic retry support
    if (isFlagged && flagReason?.includes("loading failed")) {
      console.log(`[Flag Resolution Engine] Attempting automatic source recovery for ${existing.title}`);
      // Simple retry mechanism - we don't block the response but trigger recovery
      setTimeout(() => {
        // Trigger a metadata refresh for the flagged series (non-blocking)
        const flaggedManga = SqliteDb.getMangaById(id);
        if (flaggedManga && flaggedManga.autoUpdateEnabled) {
          setImmediate(() => {
            refreshSingleMangaMetadata(flaggedManga)
              .then((updated) => {
                if (updated) syncAddOrUpdateManga(updated);
              })
              .catch(console.error);
          });
        }
      }, 5000);
    }
  }

  res.json({ success: true, manga: existing });
});

app.delete("/api/manga/:id", (req, res) => {
  if (!canWriteCatalog(req)) return rejectCatalogWrite(res);
  const { id } = req.params;
  syncDeleteManga(id);
  res.json({ success: true, message: "Deleted successfully from SQLite and persistent database" });
});



// =========================================================
// MANGADEX OFFICIAL API COMPLIANCE & RATE-LIMITING ENGINE
// Enforces official MangaDex requirements:
// 1. Unspoofed User-Agent header & No Via header
// 2. 5 req/sec global rate limiter (220ms minimum request spacing)
// 3. X-RateLimit-Remaining & X-RateLimit-Retry-After header parsing
// 4. AtHome GET /at-home/server/{id} 40 req/min quota limiter & 15m cache
// 5. Image Proxy to prevent anti-hotlink replacing images with agg.jpg
// 6. Max collection size offset + limit <= 10,000 & limit <= 100
// =========================================================

let lastMangaDexRequestTime = 0;
const MANGADEX_MIN_INTERVAL_MS = 220; // Max ~4.5 req/sec (safely under 5 req/sec limit)

async function fetchMangaDex(url: string, options: any = {}, retriesLeft = 3): Promise<any> {
  const now = Date.now();
  const timeSinceLast = now - lastMangaDexRequestTime;
  if (timeSinceLast < MANGADEX_MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MANGADEX_MIN_INTERVAL_MS - timeSinceLast));
  }
  lastMangaDexRequestTime = Date.now();

  const reqHeaders: Record<string, string> = {
    'User-Agent': 'GraywoodReaderTracker/4.8.2 (https://mangadex.org)',
    'Accept': 'application/json',
    ...(options.headers || {}),
  };

  // Enforce removal of non-transparent proxy Via header per MangaDex TOS
  delete reqHeaders['via'];
  delete reqHeaders['Via'];

  const response = await fetch(url, { ...options, headers: reqHeaders });

  // Read rate-limit headers
  const remaining = response.headers.get('x-ratelimit-remaining');
  const retryAfter = response.headers.get('x-ratelimit-retry-after');

  if (response.status === 429) {
    // Bounded retry: a persistently quota-exhausted API must never cause
    // unbounded recursion.
    if (retriesLeft <= 0) {
      console.warn('[MangaDex API Rate Limiter] 429 quota still exceeded after retries; giving up for this call.');
      return response;
    }
    const retryUnix = Number(retryAfter) || Math.floor(Date.now() / 1000) + 5;
    const waitMs = Math.max(1000, (retryUnix * 1000) - Date.now());
    console.warn(`[MangaDex API Rate Limiter] 429 Quota Exceeded. Waiting ${waitMs}ms before retrying (${retriesLeft} retries left)...`);
    await new Promise((r) => setTimeout(r, waitMs));
    return fetchMangaDex(url, options, retriesLeft - 1);
  }

  return response;
}

// =========================================================
// MANGADEX BACKGROUND METADATA SERVICE
// MangaDex is used STRICTLY as a background metadata database:
// it enriches other sources' results (covers, descriptions, genres,
// api-ids, alt-titles) and is NEVER surfaced as a standalone source.
// =========================================================
const mangadexMetaCache = new Map<string, {
  apiId: string | null; coverImage: string; description: string; genres: string[];
  altTitles: string[]; fetchedAt: number;
}>();
const MANGADEX_META_TTL = 6 * 60 * 60 * 1000; // 6 hours

async function getMangaDexMetadataByTitle(
  title: string
): Promise<{ apiId: string | null; coverImage: string; description: string; genres: string[]; altTitles: string[] } | null> {
  const cleanTitle = (title || '').trim();
  if (!cleanTitle) return null;
  const key = cleanTitle
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
  if (!key) return null;
  const cached = mangadexMetaCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < MANGADEX_META_TTL) return cached;

  try {
    const clean = cleanTitle
      .replace(/\s*\([^)]*\)/g, '')
      .replace(/uncensored|reboot|hd|season\s+\d+|ch\s*\d+/gi, '')
      .trim();
    if (clean.length < 3) return null;

    const mdRes = await fetchMangaDex(
      `https://api.mangadex.org/manga?title=${encodeURIComponent(clean)}&limit=1&includes[]=cover_art&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica`
    );
    if (!mdRes.ok) return null;
    const json = await mdRes.json();
    const m = json?.data?.[0];
    if (!m) return null;

    const coverRel = (m.relationships || []).find((r: any) => r.type === 'cover_art');
    const coverFileName = coverRel?.attributes?.fileName;
    const descObj = m.attributes?.description || {};
    const meta = {
      apiId: m.id,
      coverImage: coverFileName
        ? `/api/mangadex/image-proxy?url=${encodeURIComponent(`https://uploads.mangadex.org/covers/${m.id}/${coverFileName}.512.jpg`)}`
        : '',
      description: (descObj.en || Object.values(descObj)[0] || '').substring(0, 400),
      genres: (m.attributes?.tags || []).map((t: any) => t.attributes?.name?.en).filter(Boolean).slice(0, 8),
      altTitles: (m.attributes?.altTitles || []).map((t: any) => Object.values(t)[0]).filter(Boolean) as string[],
    };
    mangadexMetaCache.set(key, { ...meta, fetchedAt: Date.now() });
    return meta;
  } catch (_) {
    return null;
  }
}

// Enrich a list of live-source results with MangaDex background metadata.
// Keeps each item's ORIGINAL source so it stays readable from that source.
async function enrichWithMangaDexMetadata<T extends { title?: string }>(items: T[], limit = 10): Promise<T[]> {
  const slice = Array.isArray(items) ? items.slice(0, limit) : [];
  if (slice.length === 0) return items;
  const results = await Promise.allSettled(
    slice.map(async (item) => {
      const meta = await getMangaDexMetadataByTitle(item.title || '');
      if (!meta) return item;
      return {
        ...item,
        apiId: (item as any).apiId || meta.apiId,
        description: (item as any).description || meta.description,
        genres: (item as any).genres && (item as any).genres.length ? (item as any).genres : meta.genres,
        coverImage: (item as any).coverImage || meta.coverImage,
        altTitles: Array.from(new Set([...(((item as any).altTitles) || []), ...meta.altTitles])),
        metaSource: 'MangaDex',
      };
    })
  );
  const enriched = slice.map((_, i) => (results[i].status === 'fulfilled' ? results[i].value as T : slice[i]));
  return [...enriched, ...(Array.isArray(items) ? items.slice(limit) : [])];
}

// Universal Image Proxy Engine (Bypasses Hotlinking Restrictions & SSL blocks)
const handleImageProxyRequest = async (req: express.Request, res: express.Response) => {
  let targetUrl = req.query.url as string;
  const sourceUrl = req.query.sourceUrl as string;
  const pageUrl = req.query.pageUrl as string; // Fix #3: optional page URL for accurate Referer

  if (!targetUrl) {
    return res.status(400).json({ error: "Missing required 'url' parameter" });
  }

  // Unwrap nested proxy URLs if passed recursively to prevent HTTP 400 loops
  let unwrapGuard = 0;
  while (
    unwrapGuard++ < 5 &&
    (targetUrl.includes('/api/mangadex/image-proxy?url=') ||
      targetUrl.includes('/api/reader/proxy-image?url=') ||
      targetUrl.includes('/api/proxy/image?url='))
  ) {
    const match = targetUrl.match(/[?&]url=([^&]+)/);
    if (match && match[1]) {
      try { targetUrl = decodeURIComponent(match[1]); } catch (e) { break; }
    } else {
      break;
    }
  }

  // If local SVG panel image, redirect directly
  if (targetUrl.startsWith('/api/reader/panel-image')) {
    return res.redirect(targetUrl);
  }

  // Only absolute http(s) URLs are proxyable
  if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
    return res.status(400).json({ error: 'Proxy target must be an absolute http(s) URL' });
  }

  // SSRF guard: never allow internal/private targets
  try {
    await assertSafeProxyTarget(targetUrl);
  } catch (err: any) {
    console.warn(`[Proxy Image Engine] Blocked unsafe proxy target: ${err?.message || err}`);
    return res.status(403).json({ error: 'Blocked proxy target', message: String(err?.message || err) });
  }

  try {
    // Fix #3: Page-level referer matching Kotatsu's OkHttp interceptor pattern
    let referer: string;
    if (pageUrl) {
      referer = pageUrl;
    } else if (targetUrl.includes('pornwa') || targetUrl.includes('manhwa18')) {
      referer = 'https://manhwa18.com/';
    } else if (sourceUrl) {
      try { referer = new URL(sourceUrl).origin + '/'; } catch (e) { referer = 'https://mangadex.org'; }
    } else {
      try { referer = new URL(targetUrl).origin + '/'; } catch (e) { referer = 'https://mangadex.org'; }
    }

    const response = await fetchWithSsrfGuard(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
        'Referer': referer,
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      console.warn(`[Proxy Image Engine] Host returned HTTP ${response.status} for ${targetUrl}`);
      return res.redirect(`/api/reader/panel-image?manga=Page%20Panel&chapter=1&page=1`);
    }

    const etag = `"${crypto.createHash('md5').update(targetUrl).digest('hex')}"`;
    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('ETag', etag);
    // Same-origin serving: 7-day immutable caching with ETag for instant re-reads
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    res.setHeader('Content-Disposition', 'inline');
    await streamProxiedImage(response, res, req);
  } catch (err: any) {
    console.error(`[Proxy Image Engine] Error fetching target image (${targetUrl}):`, err?.message || err);
    if (!res.headersSent) {
      // Fallback placeholder panel if remote image is unreachable
      res.redirect(`/api/reader/panel-image?manga=Page%20Panel&chapter=1&page=1`);
    } else {
      res.end();
    }
  }
};

app.get("/api/mangadex/image-proxy", handleImageProxyRequest);
app.get("/api/proxy/image", handleImageProxyRequest);
app.get("/api/reader/proxy-image", handleImageProxyRequest);

app.get("/api/mangadex/search", async (req, res) => {
  const query = (req.query.q as string || '').trim();
  const offset = Math.max(0, Number(req.query.offset) || 0);
  let limit = Math.min(Number(req.query.limit) || 12, 100);

  // Enforce offset + limit <= 10,000 rule per MangaDex API specs
  if (offset + limit > 10000) {
    limit = Math.max(1, 10000 - offset);
  }


  try {
    if (!query) {
      // MangaDex is metadata-only — no standalone feed. A search query is required.
      return res.json([]);
    }

    const lang = (req.query.lang as string || 'en').toLowerCase();
    const langFilter = lang === 'all' ? '' : `&availableTranslatedLanguage[]=${lang}`;

    // Try live fetch from MangaDex public REST API with official rate-limiting wrapper
    const response = await fetchMangaDex(
      `https://api.mangadex.org/manga?title=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}${langFilter}&includes[]=cover_art&contentRating[]=safe&contentRating[]=suggestive`
    );

    if (response.ok) {
      const data = await response.json();
      const results = (data.data || []).map((m: any) => {
        const titleObj = m.attributes.title || {};
        const title = titleObj.en || Object.values(titleObj)[0] || 'Unknown Title';
        const altTitles = (m.attributes.altTitles || []).map((alt: any) => Object.values(alt)[0]).filter(Boolean);
        const lang = m.attributes.originalLanguage || '';
        const type = lang === 'ko' ? 'manhwa' : lang === 'zh' || lang === 'zh-hk' ? 'manhua' : 'manga';

        // Cover file proxied to prevent hotlink replacement (agg.jpg)
        const coverRel = (m.relationships || []).find((r: any) => r.type === 'cover_art');
        const coverFileName = coverRel?.attributes?.fileName;
        const rawCoverUrl = coverFileName
          ? `https://uploads.mangadex.org/covers/${m.id}/${coverFileName}.256.jpg`
          : '/api/mangadex/image-proxy?url=https%3A%2F%2Fuploads.mangadex.org%2Fcovers%2F32d76d19-8a05-4db0-9fc2-e0b0648fe9d0%2Ffbc962f9-3d12-4c6e-8212-32a2cb874a7b.jpg';

        const coverImage = coverFileName
          ? `/api/mangadex/image-proxy?url=${encodeURIComponent(rawCoverUrl)}`
          : rawCoverUrl;

        const descObj = m.attributes.description || {};
        const description = (descObj.en || Object.values(descObj)[0] || 'No description available.').substring(0, 300);
        const tags = (m.attributes.tags || []).map((t: any) => t.attributes?.name?.en).filter(Boolean).slice(0, 5);

        return {
          id: m.id,
          title,
          altTitles,
          type,
          coverImage,
          description,
          genres: tags.length ? tags : ['Action', 'Fantasy'],
          latestChapter: Number(m.attributes.lastChapter) || 1,
          publicationStatus: (m.attributes.status || 'ONGOING').toUpperCase(),
          source: 'MangaDex API',
          rating: 8.5,
        };
      });

      if (results.length > 0) {
        return res.json(results);
      }
    }

    // No fabricated fallback — MangaDex search returns empty when nothing matches.
    res.json([]);
  } catch (error) {
    console.error("MangaDex search error:", error);
    res.json([]);
  }
});

// Sync Full Database of Series from MangaDex & AniList APIs Endpoint (Multi-Page & Multi-Category Bulk Sync)
app.post("/api/manga/sync-from-apis", async (req, res) => {
  const { totalPages = 5 } = req.body || {};
  let addedCount = 0;
  let updatedCount = 0;

  try {
    console.log(`[API Database Sync Engine] Starting multi-page bulk database sync...`);

    // Target Query Categories
    const queryUrls = [
      // Top Followed Overall
      `https://api.mangadex.org/manga?order[followedCount]=desc&limit=50&offset=0&includes[]=cover_art&includes[]=author&contentRating[]=safe&contentRating[]=suggestive`,
      `https://api.mangadex.org/manga?order[followedCount]=desc&limit=50&offset=50&includes[]=cover_art&includes[]=author&contentRating[]=safe&contentRating[]=suggestive`,
      `https://api.mangadex.org/manga?order[followedCount]=desc&limit=50&offset=100&includes[]=cover_art&includes[]=author&contentRating[]=safe&contentRating[]=suggestive`,
      // Korean Manhwa Popular
      `https://api.mangadex.org/manga?originalLanguage[]=ko&order[followedCount]=desc&limit=50&offset=0&includes[]=cover_art&includes[]=author&contentRating[]=safe&contentRating[]=suggestive`,
      `https://api.mangadex.org/manga?originalLanguage[]=ko&order[followedCount]=desc&limit=50&offset=50&includes[]=cover_art&includes[]=author&contentRating[]=safe&contentRating[]=suggestive`,
      // Chinese Manhua Popular
      `https://api.mangadex.org/manga?originalLanguage[]=zh&order[followedCount]=desc&limit=50&offset=0&includes[]=cover_art&includes[]=author&contentRating[]=safe&contentRating[]=suggestive`,
      `https://api.mangadex.org/manga?originalLanguage[]=zh&order[followedCount]=desc&limit=50&offset=50&includes[]=cover_art&includes[]=author&contentRating[]=safe&contentRating[]=suggestive`,
      // Top Rating Overall
      `https://api.mangadex.org/manga?order[rating]=desc&limit=50&offset=0&includes[]=cover_art&includes[]=author&contentRating[]=safe&contentRating[]=suggestive`,
      // Recently Uploaded / Active
      `https://api.mangadex.org/manga?order[latestUploadedChapter]=desc&limit=50&offset=0&includes[]=cover_art&includes[]=author&contentRating[]=safe&contentRating[]=suggestive`
    ];

    for (const url of queryUrls.slice(0, totalPages * 2)) {
      try {
        const mdRes = await fetchMangaDex(url);
        if (mdRes.ok) {
          const mdData = await mdRes.json();
          const seriesList = mdData.data || [];

          for (const m of seriesList) {
            const titleObj = m.attributes.title || {};
            const title = titleObj.en || Object.values(titleObj)[0] || 'MangaDex Series';
            const altTitles = (m.attributes.altTitles || []).map((alt: any) => Object.values(alt)[0]).filter(Boolean);
            const lang = m.attributes.originalLanguage || '';
            const type = lang === 'ko' ? 'manhwa' : lang === 'zh' || lang === 'zh-hk' ? 'manhua' : 'manga';

            const coverRel = (m.relationships || []).find((r: any) => r.type === 'cover_art');
            const coverFileName = coverRel?.attributes?.fileName;
            const rawCoverUrl = coverFileName
              ? `https://uploads.mangadex.org/covers/${m.id}/${coverFileName}.512.jpg`
              : '/api/mangadex/image-proxy?url=https%3A%2F%2Fuploads.mangadex.org%2Fcovers%2F32d76d19-8a05-4db0-9fc2-e0b0648fe9d0%2Ffbc962f9-3d12-4c6e-8212-32a2cb874a7b.jpg';

            const coverImage = coverFileName
              ? `/api/mangadex/image-proxy?url=${encodeURIComponent(rawCoverUrl)}`
              : rawCoverUrl;

            const descObj = m.attributes.description || {};
            const description = (descObj.en || Object.values(descObj)[0] || 'Official MangaDex series entry.').substring(0, 500);
            const tags = (m.attributes.tags || []).map((t: any) => t.attributes?.name?.en).filter(Boolean);

            const existingIndex = mangaDatabase.findIndex(
              (item) => item.apiId === m.id || item.id === `md_${m.id}` || item.title.toLowerCase() === title.toLowerCase()
            );

            if (existingIndex !== -1) {
              const updatedItem = {
                ...mangaDatabase[existingIndex],
                latestChapter: Number(m.attributes.lastChapter) || mangaDatabase[existingIndex].latestChapter || 100,
                coverImage: coverImage || mangaDatabase[existingIndex].coverImage,
                lastUpdated: new Date().toISOString(),
              };
              syncAddOrUpdateManga(updatedItem);
              updatedCount++;
            } else {
              const newMangaItem: MangaItem = {
                id: `md_${m.id}`,
                title,
                altTitles,
                type,
                coverImage,
                description,
                genres: tags.length ? tags : ['Action', 'Fantasy'],
                status: 'reading',
                currentChapter: 0,
                totalChapters: m.attributes.lastChapter ? Number(m.attributes.lastChapter) : null,
                latestChapter: Number(m.attributes.lastChapter) || 100,
                lastUpdated: new Date().toISOString(),
                rating: 9.0,
                sourceUrl: `https://mangadex.org/title/${m.id}`,
                sourceName: 'MangaDex API v5',
                autoUpdateEnabled: true,
                notes: 'Imported via API Bulk Sync Engine',
                addedAt: new Date().toISOString(),
                lastReadAt: new Date().toISOString(),
                syncedFromApi: 'MangaDex API',
                apiId: m.id,
                isFavorite: false,
              };
              syncAddOrUpdateManga(newMangaItem);
              addedCount++;
            }

          }
        }
      } catch (e) {
        console.error("[API Database Sync Engine] Page fetch error:", e);
      }
    }

    console.log(`[API Database Sync Engine] Multi-page sync complete! Added: ${addedCount}, Updated: ${updatedCount}, Total Database Series: ${mangaDatabase.length}`);

    return res.json({
      success: true,
      message: `Complete database updated from APIs across multiple categories. Added ${addedCount} new series, updated ${updatedCount} existing series.`,
      totalDatabaseCount: mangaDatabase.length,
      addedCount,
      updatedCount,
    });
  } catch (err: any) {
    console.error("[API Database Sync Engine] Error syncing from APIs:", err);
    res.status(500).json({ error: "Failed to sync database from APIs", details: err.message });
  }
});


// Complete MangaDex Database Direct Import Endpoint
app.post("/api/mangadex/import/:mangaDexId", async (req, res) => {

  const { mangaDexId } = req.params;
  const { userId } = req.body || {};

  try {
    const mdRes = await fetchMangaDex(`https://api.mangadex.org/manga/${mangaDexId}?includes[]=cover_art&includes[]=author`);
    if (!mdRes.ok) {
      return res.status(400).json({ error: "Failed to fetch title from MangaDex API" });
    }

    const mdData = await mdRes.json();
    const m = mdData.data;

    const titleObj = m.attributes.title || {};
    const title = titleObj.en || Object.values(titleObj)[0] || 'MangaDex Series';
    const altTitles = (m.attributes.altTitles || []).map((alt: any) => Object.values(alt)[0]).filter(Boolean);
    const lang = m.attributes.originalLanguage || '';
    const type = lang === 'ko' ? 'manhwa' : lang === 'zh' || lang === 'zh-hk' ? 'manhua' : 'manga';

    const coverRel = (m.relationships || []).find((r: any) => r.type === 'cover_art');
    const coverFileName = coverRel?.attributes?.fileName;
    const rawCoverUrl = coverFileName
      ? `https://uploads.mangadex.org/covers/${m.id}/${coverFileName}.512.jpg`
      : 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=500&auto=format&fit=crop&q=80';

    const coverImage = coverFileName
      ? `/api/mangadex/image-proxy?url=${encodeURIComponent(rawCoverUrl)}`
      : rawCoverUrl;

    const descObj = m.attributes.description || {};
    const description = descObj.en || Object.values(descObj)[0] || 'MangaDex imported series.';
    const tags = (m.attributes.tags || []).map((t: any) => t.attributes?.name?.en).filter(Boolean);

    // Check if already in database
    const existingIndex = mangaDatabase.findIndex((item) => item.apiId === mangaDexId || item.id === mangaDexId);
    if (existingIndex !== -1) {
      return res.json({ success: true, message: "Series already synced in database", manga: mangaDatabase[existingIndex] });
    }

    const newMangaItem: MangaItem = {
      id: `md_${m.id}`,
      title,
      altTitles,
      type,
      coverImage,
      description,
      genres: tags.length ? tags : ['Action', 'Fantasy'],
      status: 'reading',
      currentChapter: 0,
      totalChapters: m.attributes.lastChapter ? Number(m.attributes.lastChapter) : null,
      latestChapter: Number(m.attributes.lastChapter) || 1,
      lastUpdated: new Date().toISOString(),
      rating: 9.0,
      sourceUrl: `https://mangadex.org/title/${m.id}`,
      sourceName: 'MangaDex API v5',
      autoUpdateEnabled: true,
      notes: 'Imported from MangaDex API',
      addedAt: new Date().toISOString(),
      lastReadAt: new Date().toISOString(),
      syncedFromApi: 'MangaDex API',
      apiId: m.id,
      userId: userId || undefined,
      isFavorite: false,
    };

    syncAddOrUpdateManga(newMangaItem);
    console.log(`[MangaDex Integration] Imported "${title}" (${m.id}) directly into SQLite and persistent database`);

    return res.status(201).json({ success: true, manga: newMangaItem });
  } catch (err: any) {
    console.error("[MangaDex Integration] Import error:", err);
    res.status(500).json({ error: "MangaDex import failed", details: err.message });
  }
});

// ========================================
// MangaDex is METADATA-ONLY — reading via MangaDex is permanently disabled.
// All chapter-pages and chapter-list endpoints return a clear rejection.
// Metadata/search/covers/auto-update-counters remain fully operational.
// ========================================

// MangaDex chapter list — DISABLED (MangaDex is metadata-only, not a reading source)
app.get("/api/mangadex/chapters/:mangaDexId", (_req, res) => {
  res.status(403).json({
    error: "MangaDex is metadata-only",
    message: "MangaDex API is used exclusively for metadata enrichment, search, and covers. Reading functionality is permanently disabled.",
  });
});

// MangaDex At-Home chapter page extractor — DISABLED (MangaDex is metadata-only, not a reading source)
app.get("/api/mangadex/chapter-pages/:chapterId", (_req, res) => {
  res.status(403).json({
    error: "MangaDex is metadata-only",
    message: "MangaDex API is used exclusively for metadata enrichment, search, and covers. Reading functionality is permanently disabled.",
  });
});


// AniList GraphQL Search Proxy
app.post("/api/anilist/search", async (req, res) => {

  const { query } = req.body;
  const searchQuery = query || 'Solo Leveling';

  const graphqlQuery = `
    query ($search: String) {
      Page(page: 1, perPage: 8) {
        media(search: $search, type: MANGA, format_in: [MANGA]) {
          id
          title {
            romaji
            english
            native
          }
          countryOfOrigin
          coverImage {
            large
          }
          description
          genres
          status
          chapters
          averageScore
        }
      }
    }
  `;

  try {
    const response = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        query: graphqlQuery,
        variables: { search: searchQuery }
      })
    });

    if (response.ok) {
      const data = await response.json();
      const mediaList = data.data?.Page?.media || [];
      const parsed = mediaList.map((m: any) => {
        const title = m.title.english || m.title.romaji || m.title.native;
        const altTitles = [m.title.romaji, m.title.native, m.title.english].filter((t) => t && t !== title);
        const origin = m.countryOfOrigin || '';
        const type = origin === 'KR' ? 'manhwa' : origin === 'CN' ? 'manhua' : 'manga';

        return {
          id: `ani-${m.id}`,
          title,
          altTitles,
          type,
          coverImage: m.coverImage?.large || '/api/mangadex/image-proxy?url=https%3A%2F%2Fuploads.mangadex.org%2Fcovers%2F32d76d19-8a05-4db0-9fc2-e0b0648fe9d0%2Ffbc962f9-3d12-4c6e-8212-32a2cb874a7b.jpg',
          description: (m.description || '').replace(/<[^>]*>?/gm, '').substring(0, 300),
          genres: m.genres || ['Action', 'Fantasy'],
          latestChapter: m.chapters || 1,
          publicationStatus: m.status || 'RELEASING',
          source: 'AniList GraphQL',
          rating: m.averageScore ? Number((m.averageScore / 10).toFixed(1)) : 8.5,
        };
      });
      return res.json(parsed);
    }
  } catch (err) {
    console.error("AniList search error:", err);
  }

  res.json([]);
});

// ==========================================
// ==========================================
// RATE-SPACED LIVE SOURCE AUTO-UPDATER ENGINE
// ==========================================

interface AutoUpdateStatus {
  isScanning: boolean;
  currentSource: string;
  scannedCount: number;
  totalCount: number;
  newReleasesFound: number;
  lastScanTimestamp: string | null;
}

let autoUpdateStatus: AutoUpdateStatus = {
  isScanning: false,
  currentSource: 'Idle',
  scannedCount: 0,
  totalCount: 0,
  newReleasesFound: 0,
  lastScanTimestamp: null,
};

const domainLastRequestMap = new Map<string, number>();
const DOMAIN_RATE_LIMIT_MS = 2500; // 2.5 seconds spacing per domain to prevent DDoS triggering

async function fetchWithDomainRateLimit(url: string, options: any = {}): Promise<Response> {
  let domain = 'localhost';
  try {
    const parsedUrl = new URL(url);
    domain = parsedUrl.hostname;
  } catch (e) { }

  const lastTime = domainLastRequestMap.get(domain) || 0;
  const now = Date.now();
  const timeSinceLast = now - lastTime;

  if (timeSinceLast < DOMAIN_RATE_LIMIT_MS) {
    const sleepTime = DOMAIN_RATE_LIMIT_MS - timeSinceLast;
    await new Promise((resolve) => setTimeout(resolve, sleepTime));
  }

  domainLastRequestMap.set(domain, Date.now());

  const defaultHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/html, */*',
  };

  return fetch(url, {
    ...options,
    headers: { ...defaultHeaders, ...(options.headers || {}) },
  });
}

export async function runLiveRateSpacedAutoUpdate(): Promise<{
  scannedCount: number;
  newReleasesFound: number;
  updatedItems: { mangaTitle: string; previous: number; newChapter: number; source: string }[];
}> {
  if (autoUpdateStatus.isScanning) {
    console.warn("[Auto-Updater Engine] Scan already in progress, skipping concurrent run.");
    return {
      scannedCount: autoUpdateStatus.scannedCount,
      newReleasesFound: autoUpdateStatus.newReleasesFound,
      updatedItems: [],
    };
  }

  autoUpdateStatus.isScanning = true;
  autoUpdateStatus.scannedCount = 0;
  autoUpdateStatus.newReleasesFound = 0;
  autoUpdateStatus.currentSource = 'Initializing';

  const enabledMangaList = mangaDatabase.filter((m) => m.autoUpdateEnabled && !isSeriesFromDisabledSource(m));
  autoUpdateStatus.totalCount = enabledMangaList.length;

  console.log(`[Auto-Updater Engine] Starting rate-spaced live catalog scan for ${enabledMangaList.length} series (2.5s DDoS spacing per domain)...`);

  const updatedItemsList: { mangaTitle: string; previous: number; newChapter: number; source: string }[] = [];

  try {
    for (let i = 0; i < enabledMangaList.length; i++) {
      const item = enabledMangaList[i];
      autoUpdateStatus.scannedCount = i + 1;
      autoUpdateStatus.currentSource = `${item.sourceName || 'Scanlation Source'} (${item.title})`;

      let foundLatestCh = item.latestChapter;
      let sourceNameUsed = item.sourceName || 'Scanlation Site';

      // 1. MangaDex API Auto-Update Check
      const mangaDexId = item.apiId || (item.id.startsWith('md_') ? item.id.replace('md_', '') : null);
      if (mangaDexId) {
        try {
          const res = await fetchWithDomainRateLimit(
            `https://api.mangadex.org/manga/${mangaDexId}/feed?limit=25&order[chapter]=desc&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica`
          );
          if (res.ok) {
            const data = await res.json();
            const chapters = data.data || [];
            if (chapters.length > 0) {
              const maxCh = chapters.reduce((max: number, c: any) => {
                const num = parseFloat(c.attributes?.chapter);
                return !isNaN(num) ? Math.max(max, num) : max;
              }, item.latestChapter);
              foundLatestCh = maxCh;
              sourceNameUsed = 'MangaDex API v5';
            }
          }
        } catch (e: any) {
          console.warn(`[Auto-Updater] MangaDex check failed for ${item.title}:`, e.message);
        }
      }

      // 2. Asura Scans Auto-Update Check
      if (foundLatestCh === item.latestChapter && item.sourceUrl && item.sourceUrl.includes('asuracomic')) {
        try {
          const rawSlug = item.sourceUrl.split('/').pop() || '';
          const cleanSlug = rawSlug.replace(/-(?:00dcbf97|b8509c2a|[a-f0-9]{8})$/i, '');
          const res = await fetchWithDomainRateLimit(`https://api.asurascans.com/api/series/${cleanSlug}`);
          if (res.ok) {
            const json = await res.json();
            const chCount = Number(json.series?.chapter_count);
            if (!isNaN(chCount) && chCount > foundLatestCh) {
              foundLatestCh = chCount;
              sourceNameUsed = 'Asura Scans API';
            }
          }
        } catch (e: any) {
          console.warn(`[Auto-Updater] Asura check failed for ${item.title}:`, e.message);
        }
      }

      // 3. Flame Comics Auto-Update Check
      if (foundLatestCh === item.latestChapter && item.sourceUrl && item.sourceUrl.includes('flamecomics')) {
        try {
          const seriesIdMatch = item.sourceUrl.match(/\/series\/(\d+)/);
          if (seriesIdMatch) {
            const seriesId = seriesIdMatch[1];
            const homeRes = await fetchWithDomainRateLimit("https://flamecomics.xyz/");
            if (homeRes.ok) {
              const html = await homeRes.text();
              const buildId = html.match(/\/_next\/static\/([^/]+)\/_buildManifest\.js/)?.[1];
              if (buildId) {
                const sRes = await fetchWithDomainRateLimit(`https://flamecomics.xyz/_next/data/${buildId}/series/${seriesId}.json`);
                if (sRes.ok) {
                  const sData = await sRes.json();
                  const chapters = sData.pageProps?.chapters || [];
                  if (chapters.length > 0) {
                    const maxCh = chapters.reduce((max: number, c: any) => {
                      const num = parseFloat(c.chapter || c.number);
                      return !isNaN(num) ? Math.max(max, num) : max;
                    }, item.latestChapter);
                    foundLatestCh = maxCh;
                    sourceNameUsed = 'Flame Comics API';
                  }
                }
              }
            }
          }
        } catch (e: any) {
          console.warn(`[Auto-Updater] Flame check failed for ${item.title}:`, e.message);
        }
      }

      // If new chapter discovered, update record & create log
      if (foundLatestCh > item.latestChapter) {
        const prevCh = item.latestChapter;
        item.latestChapter = foundLatestCh;
        item.lastUpdated = new Date().toISOString();

        syncAddOrUpdateManga(item);

        const logEntry: AutoUpdateLog = {
          id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          mangaId: item.id,
          mangaTitle: item.title,
          previousChapter: prevCh,
          newChapter: foundLatestCh,
          source: sourceNameUsed,
          timestamp: new Date().toISOString(),
          type: item.type,
        };

        autoUpdateLogs.unshift(logEntry);
        autoUpdateStatus.newReleasesFound++;
        updatedItemsList.push({
          mangaTitle: item.title,
          previous: prevCh,
          newChapter: foundLatestCh,
          source: sourceNameUsed,
        });

        console.log(`[Auto-Updater Engine] 🚀 NEW RELEASE DISCOVERED: "${item.title}" Ch. ${prevCh} -> Ch. ${foundLatestCh} via ${sourceNameUsed}`);
      }
    }
  } catch (err: any) {
    console.error("[Auto-Updater Engine] Global scan error:", err);
  } finally {
    autoUpdateStatus.isScanning = false;
    autoUpdateStatus.currentSource = 'Idle';
    autoUpdateStatus.lastScanTimestamp = new Date().toISOString();
    syncConfig.lastSyncTime = autoUpdateStatus.lastScanTimestamp;
    saveDatabaseToDisk();
  }

  return {
    scannedCount: autoUpdateStatus.scannedCount,
    newReleasesFound: autoUpdateStatus.newReleasesFound,
    updatedItems: updatedItemsList,
  };
}

// Background Cron Scheduler for Auto Updater
let autoUpdateIntervalTimer: NodeJS.Timeout | null = null;

function scheduleBackgroundAutoUpdater() {
  if (autoUpdateIntervalTimer) clearInterval(autoUpdateIntervalTimer);
  const intervalMs = Math.max(15, syncConfig.autoUpdateIntervalMinutes || 60) * 60 * 1000;

  autoUpdateIntervalTimer = setInterval(() => {
    console.log(`[Auto-Updater Engine] Interval timer triggered background scan (${syncConfig.autoUpdateIntervalMinutes}m interval)...`);
    runLiveRateSpacedAutoUpdate().catch((e) => console.error("Background auto-update error:", e));
  }, intervalMs);

  console.log(`[Auto-Updater Engine] Scheduled automatic background scan every ${syncConfig.autoUpdateIntervalMinutes} minutes.`);
}

app.get("/api/tracker/status", (_req, res) => {
  res.json({
    isScanning: autoUpdateStatus.isScanning,
    currentSource: autoUpdateStatus.currentSource,
    scannedCount: autoUpdateStatus.scannedCount,
    totalCount: autoUpdateStatus.totalCount,
    newReleasesFound: autoUpdateStatus.newReleasesFound,
    lastScanTimestamp: autoUpdateStatus.lastScanTimestamp,
    logs: autoUpdateLogs,
  });
});

app.post("/api/tracker/auto-update", async (_req, res) => {
  if (autoUpdateStatus.isScanning) {
    return res.json({
      success: true,
      message: "Auto-update scan is currently running in the background.",
      isScanning: true,
      scannedCount: autoUpdateStatus.scannedCount,
      totalCount: autoUpdateStatus.totalCount,
    });
  }

  // Trigger scan in background
  runLiveRateSpacedAutoUpdate().catch((e) => console.error("Auto update run error:", e));

  res.json({
    success: true,
    message: "Started rate-spaced live source catalog auto-update scan in background.",
    isScanning: true,
    totalCount: mangaDatabase.filter((m) => m.autoUpdateEnabled && !isSeriesFromDisabledSource(m)).length,
  });
});

app.get("/api/tracker/logs", (req, res) => {
  res.json(autoUpdateLogs);
});

const ignoredDuplicatePairs = new Set<string>();

app.post("/api/tracker/dismiss-duplicate", (req, res) => {
  const { primaryId, secondaryId } = req.body;
  if (primaryId && secondaryId) {
    ignoredDuplicatePairs.add(`${primaryId}_${secondaryId}`);
    ignoredDuplicatePairs.add(`${secondaryId}_${primaryId}`);
  }
  res.json({ success: true });
});

app.post("/api/tracker/detect-duplicates", async (req, res) => {
  const candidates: DuplicateCandidate[] = [];
  const processedPairs = new Set<string>();

  // Inverted token map for instant candidate pairing across thousands of series
  const tokenMap = new Map<string, MangaItem[]>();
  for (const m of mangaDatabase) {
    const tokens = Array.from(new Set(
      [m.title, ...(m.altTitles || [])]
        .flatMap((t) => t.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/))
        .filter((tok) => tok.length >= 4 && !['the', 'that', 'with', 'from', 'this', 'your', 'about', 'chapter'].includes(tok))
    ));
    for (const tok of tokens) {
      if (!tokenMap.has(tok)) tokenMap.set(tok, []);
      tokenMap.get(tok)!.push(m);
    }
  }

  // Compare series sharing significant title tokens
  for (const list of tokenMap.values()) {
    if (list.length < 2 || list.length > 25) continue; // Skip over-broad token buckets
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const itemA = list[i];
        const itemB = list[j];
        if (itemA.id === itemB.id) continue;

        const pairKey = itemA.id < itemB.id ? `${itemA.id}_${itemB.id}` : `${itemB.id}_${itemA.id}`;
        if (processedPairs.has(pairKey)) continue;
        processedPairs.add(pairKey);

        if (ignoredDuplicatePairs.has(`${itemA.id}_${itemB.id}`) || ignoredDuplicatePairs.has(`${itemB.id}_${itemA.id}`)) continue;

        let maxSim = calculateStringSimilarity(itemA.title, itemB.title);
        for (const altA of itemA.altTitles) {
          const sim = calculateStringSimilarity(altA, itemB.title);
          if (sim > maxSim) maxSim = sim;
        }
        for (const altB of itemB.altTitles) {
          const sim = calculateStringSimilarity(itemA.title, altB);
          if (sim > maxSim) maxSim = sim;
        }

        if (maxSim >= 60 || (itemA.coverImage && itemA.coverImage === itemB.coverImage)) {
          const mergedAltSet = new Set([...itemA.altTitles, ...itemB.altTitles, itemA.title, itemB.title]);
          const mergedAltTitles = Array.from(mergedAltSet).filter(
            (t) => t.toLowerCase() !== itemA.title.toLowerCase()
          );

          const mergedGenres = Array.from(new Set([...itemA.genres, ...itemB.genres]));

          candidates.push({
            id: `dup_${itemA.id}_${itemB.id}`,
            primaryItem: itemA,
            secondaryItem: itemB,
            similarityScore: Math.min(maxSim + 15, 99),
            reason: maxSim >= 80 ? 'High title & alternate name match' : 'Similar romanized title & matching genre tags',
            suggestedTitle: itemA.title.length >= itemB.title.length ? itemA.title : itemB.title,
            mergedAltTitles,
            suggestedGenres: mergedGenres,
            suggestedDescription: itemA.description.length > itemB.description.length ? itemA.description : itemB.description,
          });
        }
      }
    }
  }


  // Step 2: Use Gemini AI to enhance duplicate detection if API key present
  const ai = getGeminiClient();
  if (ai && mangaDatabase.length > 2) {
    try {
      const dbTitlesList = mangaDatabase.map((m) => ({
        id: m.id,
        title: m.title,
        altTitles: m.altTitles,
        type: m.type,
      }));

      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: `Analyze this JSON list of Manhwa & Manhua titles in a user's tracking database:
${JSON.stringify(dbTitlesList)}

Identify pairs of entries that represent the EXACT SAME series (for example Korean romanized vs English translation, e.g. "Na Honjaman Level Up" and "Solo Leveling").
Return JSON array of duplicate candidate object pairs:
[
  {
    "primaryId": "m1",
    "secondaryId": "m9_dup",
    "confidence": 98,
    "reason": "Solo Leveling is the official English title for Na Honjaman Level Up.",
    "suggestedTitle": "Solo Leveling"
  }
]`,
        config: {
          responseMimeType: "application/json",
        },
      });

      if (response.text) {
        const aiResults = JSON.parse(response.text);
        if (Array.isArray(aiResults)) {
          for (const aiDup of aiResults) {
            const itemA = mangaDatabase.find((m) => m.id === aiDup.primaryId);
            const itemB = mangaDatabase.find((m) => m.id === aiDup.secondaryId);
            if (itemA && itemB && itemA.id !== itemB.id) {
              const existingIdx = candidates.findIndex(
                (c) =>
                  (c.primaryItem.id === itemA.id && c.secondaryItem.id === itemB.id) ||
                  (c.primaryItem.id === itemB.id && c.secondaryItem.id === itemA.id)
              );

              const mergedAltSet = new Set([
                ...itemA.altTitles,
                ...itemB.altTitles,
                itemA.title,
                itemB.title,
              ]);

              const candidateData: DuplicateCandidate = {
                id: `dup_ai_${itemA.id}_${itemB.id}`,
                primaryItem: itemA,
                secondaryItem: itemB,
                similarityScore: aiDup.confidence || 95,
                reason: `AI Match: ${aiDup.reason}`,
                suggestedTitle: aiDup.suggestedTitle || itemA.title,
                mergedAltTitles: Array.from(mergedAltSet).filter(
                  (t) => t.toLowerCase() !== (aiDup.suggestedTitle || itemA.title).toLowerCase()
                ),
                suggestedGenres: Array.from(new Set([...itemA.genres, ...itemB.genres])),
                suggestedDescription: itemA.description.length > itemB.description.length ? itemA.description : itemB.description,
              };

              if (existingIdx !== -1) {
                candidates[existingIdx] = candidateData;
              } else {
                candidates.push(candidateData);
              }
            }
          }
        }
      }
    } catch (err) {
      console.error("Gemini duplicate detection error:", err);
    }
  }

  res.json(candidates);
});

// Execute Merge
app.post("/api/tracker/merge-duplicates", (req, res) => {
  const { primaryId, secondaryId, newTitle, newAltTitles, newGenres, newDescription } = req.body;

  const primaryIdx = mangaDatabase.findIndex((m) => m.id === primaryId);
  const secondaryIdx = mangaDatabase.findIndex((m) => m.id === secondaryId);

  if (primaryIdx === -1 || secondaryIdx === -1) {
    return res.status(404).json({ error: "One or both items not found" });
  }

  const primary = mangaDatabase[primaryIdx];
  const secondary = mangaDatabase[secondaryIdx];

  // Merge values intelligently
  const maxCurrentChapter = Math.max(primary.currentChapter, secondary.currentChapter);
  const maxLatestChapter = Math.max(primary.latestChapter, secondary.latestChapter);

  const mergedPrimary: MangaItem = {
    ...primary,
    title: newTitle || primary.title,
    altTitles: Array.isArray(newAltTitles) ? newAltTitles : primary.altTitles,
    genres: Array.isArray(newGenres) ? newGenres : primary.genres,
    description: newDescription || primary.description,
    currentChapter: maxCurrentChapter,
    latestChapter: maxLatestChapter,
    rating: Math.max(primary.rating, secondary.rating),
    notes: [primary.notes, secondary.notes].filter(Boolean).join(" | Merged note: "),
    lastUpdated: new Date().toISOString(),
  };

  syncDeleteManga(secondaryId);
  syncAddOrUpdateManga(mergedPrimary);

  res.json({
    success: true,
    mergedItem: mergedPrimary,
    removedId: secondaryId,
    remainingTotal: mangaDatabase.length,
  });
});

// ==========================================
// GEMINI AI ENRICHMENT & METADATA
// ==========================================

// Centralized model name so upgrades only touch one line.
const GEMINI_MODEL = "gemini-3.6-flash";

app.post("/api/ai/enrich-metadata", async (req, res) => {
  const { title } = req.body;
  if (!title) {
    return res.status(400).json({ error: "Title is required" });
  }

  const ai = getGeminiClient();
  if (!ai) {
    // Honest failure: never fabricate metadata — fake chapter counts/ratings
    // would silently corrupt real series data in the Add/Edit form.
    return res.status(503).json({ error: "Gemini API key not configured. Set GEMINI_API_KEY on the server to use AI metadata enrichment." });
  }

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: `You are an expert Manhwa & Manhua database curator. Provide metadata for the title: "${title}".
Return JSON object:
{
  "title": "Clean Official English Title",
  "altTitles": ["Romanized Korean/Chinese name", "Original Hangul or Hanzi", "Short Alias"],
  "type": "manhwa" or "manhua",
  "description": "Engaging 2-3 sentence synopsis",
  "genres": ["Action", "Fantasy", "System", "Cultivation", etc.],
  "latestChapter": 150,
  "rating": 9.2,
  "status": "reading"
}`,
      config: {
        responseMimeType: "application/json",
      },
    });

    if (response.text) {
      const data = JSON.parse(response.text);
      return res.json(data);
    }
  } catch (err: any) {
    console.error("AI Metadata enrichment error:", err);
  }

  // Honest failure instead of fabricated metadata (fake latestChapter/rating
  // values were polluting the Add/Edit form when the AI call failed).
  res.status(502).json({ error: "AI metadata enrichment failed. Check the server logs and GEMINI_API_KEY." });
});

// AI Similar Recommendations
app.post("/api/ai/find-similar", async (req, res) => {
  const { title, genres } = req.body;
  const ai = getGeminiClient();

  if (!ai) {
    // No fabricated recommendations — an empty list lets the UI show its
    // honest "no results" state instead of fake AI suggestions.
    return res.json([]);
  }


  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: `Given the Manhwa/Manhua series "${title}" with genres [${(genres || []).join(', ')}], suggest 4 top-tier similar Manhwa or Manhua series.
Return JSON array:
[
  {
    "title": "Title Name",
    "type": "manhwa" or "manhua",
    "reason": "Why readers of ${title} will love it"
  }
]`,
      config: { responseMimeType: "application/json" },
    });

    if (response.text) {
      return res.json(JSON.parse(response.text));
    }
  } catch (err) {
    console.error("AI recommendations error:", err);
  }

  res.json([]);
});

// ==========================================
// DATABASE IMPORT / EXPORT / RESET
// ==========================================

app.get("/api/db/export", (req, res) => {
  const format = req.query.format || 'json';
  if (format === 'csv') {
    const headers = "id,title,type,currentChapter,latestChapter,status,rating,sourceName\n";
    // CSV injection guard: prefix formula-triggering cells so spreadsheet apps
    // never evaluate user-controlled titles as expressions.
    const csvCell = (v: unknown) => {
      const s = String(v ?? '');
      const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const rows = mangaDatabase.map((m) =>
      `${csvCell(m.id)},${csvCell(m.title)},${csvCell(m.type)},${m.currentChapter},${m.latestChapter},${csvCell(m.status)},${m.rating},${csvCell(m.sourceName)}`
    ).join("\n");
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="manhua_tracker_export.csv"');
    return res.send(headers + rows);
  }

  res.setHeader('Content-Disposition', 'attachment; filename="manhua_tracker_db.json"');
  res.json({
    app: "ManhuaHub Subdomain Tracker",
    exportedAt: new Date().toISOString(),
    subdomain: syncConfig.subdomain,
    count: mangaDatabase.length,
    data: mangaDatabase,
  });
});

app.post("/api/db/import", (req, res) => {
  const { data, replaceExisting } = req.body;
  if (!Array.isArray(data)) {
    return res.status(400).json({ error: "Invalid payload: 'data' must be an array of manga items." });
  }

  if (replaceExisting) {
    syncResetManga(data);
  } else {
    // Append unique items by title or ID
    const itemsToImport: MangaItem[] = [];
    data.forEach((item: MangaItem) => {
      const exists = mangaDatabase.some((m) => m.id === item.id || m.title.toLowerCase() === item.title.toLowerCase());
      if (!exists) {
        itemsToImport.push(item);
      }
    });
    if (itemsToImport.length > 0) {
      syncBulkAddOrUpdateManga(itemsToImport);
    }
  }

  res.json({ success: true, totalTracked: mangaDatabase.length });
});

app.post("/api/db/reset", (req, res) => {
  if (req.body?.empty === true) {
    // Truly empty — clear everything for a fresh rebuild
    SqliteDb.deleteAllManga();
    mangaDatabase.length = 0;
    syncConfig.totalTracked = 0;
    saveDatabaseToDisk();
    console.log('[Database Engine] Full database wipe completed — all series purged.');
    return res.json({ success: true, count: 0, message: 'Database fully cleared for rebuild' });
  }
  syncResetManga([]);
  res.json({ success: true, count: mangaDatabase.length });
});

app.post("/api/db/refresh-all", async (_req, res) => {
  try {
    const result = await purgeDisabledSourcesAndRefreshMetadata();
    res.json({
      success: true,
      message: `Database refreshed and active sources enforced: ${result.purgedCount} purged, ${result.refreshedCount} refreshed.`,
      ...result,
      data: mangaDatabase,
    });
  } catch (err: any) {
    console.error("Error refreshing database:", err);
    res.status(500).json({ error: "Failed to refresh database", details: err.message });
  }
});

// ==========================================
// BUILT-IN WEBTOON & MANGA READER ENDPOINTS
// ==========================================

// Get list of chapters for a series
app.get("/api/reader/chapters/:mangaId", async (req, res) => {
  const { mangaId } = req.params;
  const order = (req.query.order as string) || 'desc'; // 'desc' or 'asc'

  const manga = resolveManga(mangaId);
  if (!manga) {
    return res.status(404).json({ error: "Manga not found" });
  }

  // MangaDex chapter feed is DISABLED for reading — MangaDex is metadata-only.
  // We skip the feed and fall through to the live-source or fabricated chapter list below.

  // Live-source REAL chapter list (before the fabricated generator). For series with a live
  // source we enumerate the source's actual chapters so the UI only lists chapters that exist
  // (fixes: wrong chapters shown, and series not lining up with the source's real numbering).

  // Resolve the best available live source URL — skip MangaDex (metadata-only), prefer
  // availableSources when the primary sourceUrl points to MangaDex.
  let liveSourceUrl = manga.sourceUrl || '';
  if (liveSourceUrl && liveSourceUrl.toLowerCase().includes('mangadex.org') && manga.availableSources?.length) {
    const alt = manga.availableSources.find(
      (s) => s.sourceUrl && s.sourceUrl.startsWith('http') && !s.sourceUrl.toLowerCase().includes('mangadex.org')
    );
    if (alt) liveSourceUrl = alt.sourceUrl;
  }

  if (liveSourceUrl && (liveSourceUrl.startsWith('http://') || liveSourceUrl.startsWith('https://')) && !liveSourceUrl.toLowerCase().includes('mangadex.org')) {
    const matchedDomain = matchLiveDomain(liveSourceUrl || '');
    const domainId = matchedDomain ? matchedDomain.id : 'general';
    const sourceLabel = matchedDomain ? matchedDomain.name : 'Webtoon Source';
    try {
      const realChapters = await fetchLiveChapterList(liveSourceUrl, domainId);
      if (realChapters.length > 0) {
        const sorted = [...realChapters].sort((a, b) =>
          order === 'asc' ? a.number - b.number : b.number - a.number
        );
        return res.json(
          sorted.map((c) => ({
            id: `${domainId}_${c.id}`,
            chapterNumber: c.number,
            title: c.title,
            releaseDate: '',
            scanGroup: sourceLabel,
            pageCount: c.pageCount,
            isRead: c.number <= (manga.currentChapter || 0),
          }))
        );
      }
    } catch (err) {
      console.error("Real chapter list fetch error:", err);
    }
  }

  // Fix #7: Generated placeholder chapters — clearly marked as estimates, not real data
  const totalCh = Math.max(manga.latestChapter, manga.currentChapter, 10);
  const chapters: any[] = [];
  for (let c = 1; c <= totalCh; c++) {
    chapters.push({
      id: `ch_${manga.id}_${c}`, chapterNumber: c, title: `Chapter ${c}`,
      releaseDate: '', scanGroup: '🔹 Estimated (Source Unavailable)', pageCount: 0,
      isRead: c <= manga.currentChapter, isEstimated: true,
    });
  }

  if (order === 'asc') {
    chapters.sort((a, b) => a.chapterNumber - b.chapterNumber);
  } else {
    chapters.sort((a, b) => b.chapterNumber - a.chapterNumber);
  }

  res.json(chapters);
});


// Helper: Permanently delete all currently disabled sources from memory and database
export function purgeDisabledSources(): { purgedCount: number; remainingCount: number } {
  const toPurge = Array.from(disabledSourceIds);

  // Add all disabled source IDs into removedSources & DYNAMIC_DEAD_SOURCES
  if (!Array.isArray(syncConfig.removedSources)) {
    syncConfig.removedSources = [];
  }
  const removedSet = new Set(syncConfig.removedSources);
  toPurge.forEach((id) => {
    removedSet.add(id.toLowerCase());
    DYNAMIC_DEAD_SOURCES.add(id.toLowerCase());
  });
  syncConfig.removedSources = Array.from(removedSet);

  // Clear disabledSourceIds and rebuild dead sources set
  disabledSourceIds.clear();
  syncConfig.disabledSources = [];
  rebuildDeadSourcesSet();

  // Prune KOTATSU_SOURCES array in-place
  const aliveSources = KOTATSU_SOURCES.filter((s) => isSourceAlive(s.id) && isSourceAlive(s.name));
  KOTATSU_SOURCES.length = 0;
  KOTATSU_SOURCES.push(...aliveSources);

  saveDatabaseToDisk();
  console.log(`[Kotatsu Engine] Permanently deleted ${toPurge.length} disabled sources. Remaining active sources: ${KOTATSU_SOURCES.length}`);

  return { purgedCount: toPurge.length, remainingCount: KOTATSU_SOURCES.length };
}

// Fully revive + enable a source: clear removed/dead/disabled markers and ensure
// its parser is registered. MangaDex is rejected (metadata-only).
function reviveSource(sourceId: string): { source?: SourceDefinition; ok: boolean; message: string } {
  const id = String(sourceId || '').toLowerCase();
  if (!id) return { ok: false, message: 'sourceId is required' };
  if (isMetadataOnlySource(id)) return { ok: false, message: 'mangadex is metadata-only and cannot be activated' };

  if (Array.isArray(syncConfig.removedSources)) {
    syncConfig.removedSources = syncConfig.removedSources.filter((r) => String(r).toLowerCase() !== id);
  }
  DYNAMIC_DEAD_SOURCES.delete(id);
  ALL_DEAD_SOURCES.delete(id);

  if (!Array.isArray(syncConfig.reactivatedSources)) syncConfig.reactivatedSources = [];
  if (!syncConfig.reactivatedSources.some((r) => String(r).toLowerCase() === id)) syncConfig.reactivatedSources.push(id);

  disabledSourceIds.delete(id);
  if (Array.isArray(syncConfig.disabledSources)) {
    syncConfig.disabledSources = syncConfig.disabledSources.filter((d) => String(d).toLowerCase() !== id);
  }

  const source = ensureSourceInRegistry(id);
  rebuildDeadSourcesSet(syncConfig);
  saveDatabaseToDisk();
  return { source: source || undefined, ok: true, message: `Source "${id}" activated` };
}

// Disable a source but keep it re-activatable (never touches removedSources).
function deactivateSource(sourceId: string): { ok: boolean; message: string } {
  const id = String(sourceId || '').toLowerCase();
  if (!id) return { ok: false, message: 'sourceId is required' };
  if (isMetadataOnlySource(id)) return { ok: false, message: 'mangadex is metadata-only and cannot be deactivated' };
  disabledSourceIds.add(id);
  if (!Array.isArray(syncConfig.disabledSources)) syncConfig.disabledSources = [];
  if (!syncConfig.disabledSources.some((d) => String(d).toLowerCase() === id)) syncConfig.disabledSources.push(id);
  saveDatabaseToDisk();
  return { ok: true, message: `Source "${id}" deactivated` };
}

// Sources List Endpoint (Returns active enabled sources only)
const handleGetSources = (_req: express.Request, res: express.Response) => {
  const activeSources = KOTATSU_SOURCES.filter(
    (s) => s.id !== 'mangadex' && !disabledSourceIds.has(s.id) && isSourceAlive(s.id, syncConfig) && isSourceAlive(s.name, syncConfig)
  );
  const listWithStates = activeSources.map((s) => ({
    ...s,
    isEnabled: true,
  }));
  res.json(listWithStates);
};

app.get("/api/kotatsu/sources", handleGetSources);
app.get("/api/sources", handleGetSources);

// Endpoint to permanently purge all disabled sources
const handlePurgeDisabledSources = (_req: express.Request, res: express.Response) => {
  const result = purgeDisabledSources();
  res.json({
    success: true,
    message: `Permanently deleted ${result.purgedCount} disabled sources. ${result.remainingCount} active sources remain.`,
    ...result,
  });
};

app.post("/api/kotatsu/sources/purge-disabled", handlePurgeDisabledSources);
app.post("/api/sources/purge-disabled", handlePurgeDisabledSources);

// Toggle Individual Source Enable/Disable Endpoint
const handleToggleSource = (req: express.Request, res: express.Response) => {
  const { sourceId, isEnabled } = req.body || {};
  if (!sourceId) return res.status(400).json({ error: "sourceId is required" });

  if (isEnabled === false) {
    disabledSourceIds.add(sourceId);
  } else {
    disabledSourceIds.delete(sourceId);
  }

  syncConfig.disabledSources = Array.from(disabledSourceIds);
  saveDatabaseToDisk();
  console.log(`[Source Engine] Source "${sourceId}" is now ${isEnabled ? 'ENABLED' : 'DISABLED'} (${disabledSourceIds.size} disabled in total)`);
  res.json({
    success: true,
    sourceId,
    isEnabled: !disabledSourceIds.has(sourceId),
    disabledCount: disabledSourceIds.size,
  });
};

app.post("/api/kotatsu/sources/toggle", handleToggleSource);
app.post("/api/sources/toggle", handleToggleSource);

// Full source inventory for the management UI (active + disabled + removed).
const handleGetAllSources = (_req: express.Request, res: express.Response) => {
  res.json(buildFullSourceInventory(syncConfig));
};

app.get("/api/kotatsu/sources/all", handleGetAllSources);
app.get("/api/sources/all", handleGetAllSources);

// Activate (revive + enable) a single source. MangaDex is rejected.
const handleActivateSource = (req: express.Request, res: express.Response) => {
  const { sourceId } = req.body || {};
  const result = reviveSource(sourceId);
  if (!result.ok) return res.status(400).json({ success: false, message: result.message });
  res.json({
    success: true,
    message: result.message,
    source: result.source,
    reactivatedCount: (syncConfig.reactivatedSources || []).length,
    disabledCount: disabledSourceIds.size,
  });
};

app.post("/api/kotatsu/sources/activate", handleActivateSource);
app.post("/api/sources/activate", handleActivateSource);

// Deactivate (disable) a single source. MangaDex is rejected.
const handleDeactivateSource = (req: express.Request, res: express.Response) => {
  const { sourceId } = req.body || {};
  const result = deactivateSource(sourceId);
  if (!result.ok) return res.status(400).json({ success: false, message: result.message });
  res.json({ success: true, message: result.message, disabledCount: disabledSourceIds.size });
};

app.post("/api/kotatsu/sources/deactivate", handleDeactivateSource);
app.post("/api/sources/deactivate", handleDeactivateSource);

// Activate every source (revive all removed + clear disabled) EXCEPT MangaDex.
app.post("/api/kotatsu/sources/activate-all", (_req, res) => {
  const removedSet = new Set((syncConfig.removedSources || []).map((r) => String(r).toLowerCase()));
  const allToRevive = new Set<string>([...removedSet, ...disabledSourceIds]);

  let revived = 0;
  let skippedMeta = 0;
  for (const id of allToRevive) {
    if (isMetadataOnlySource(id)) { skippedMeta++; continue; }
    const r = reviveSource(id);
    if (r.ok) revived++;
  }
  res.json({
    success: true,
    message: `Activated ${revived} source(s).`,
    activatedCount: revived,
    skippedMetadataOnly: skippedMeta,
    activeCount: KOTATSU_SOURCES.filter((s) => !disabledSourceIds.has(s.id) && s.id !== 'mangadex').length,
    reactivatedSources: syncConfig.reactivatedSources || [],
  });
});

// Deactivate every source EXCEPT MangaDex (keeps them re-activatable).
app.post("/api/kotatsu/sources/deactivate-all", (_req, res) => {
  let deactivated = 0;
  let skippedMeta = 0;
  for (const s of KOTATSU_SOURCES) {
    if (s.id === 'mangadex' || isMetadataOnlySource(s.id, s.baseUrl)) { skippedMeta++; continue; }
    disabledSourceIds.add(s.id);
    if (!Array.isArray(syncConfig.disabledSources)) syncConfig.disabledSources = [];
    if (!syncConfig.disabledSources.includes(s.id)) syncConfig.disabledSources.push(s.id);
    deactivated++;
  }
  saveDatabaseToDisk();
  res.json({
    success: true,
    message: `Deactivated ${deactivated} source(s).`,
    deactivatedCount: deactivated,
    skippedMetadataOnly: skippedMeta,
    disabledCount: disabledSourceIds.size,
  });
});

// Fix #22: Source Health Monitoring Endpoint
app.get("/api/kotatsu/sources/health", (_req, res) => {
  const healthData: Record<string, SourceHealth> = {};
  for (const source of KOTATSU_SOURCES) {
    const h = sourceHealthMap.get(source.id);
    const cb = sourceCircuitBreaker.getState(source.id);
    if (h || cb.state !== 'CLOSED') {
      healthData[source.id] = {
        id: source.id,
        lastChecked: h?.lastChecked || cb.lastChecked || Date.now(),
        lastStatus: h?.lastStatus || (cb.state === 'OPEN' ? 'down' : 'ok'),
        consecutiveFailures: h?.consecutiveFailures ?? cb.failures,
        failureReason: h?.failureReason || cb.lastFailureReason,
        circuitState: cb.state,
      };
    }
  }
  res.json({
    healthy: Object.values(healthData).filter(h => h.lastStatus === 'ok' && h.circuitState !== 'OPEN').length,
    degraded: Object.values(healthData).filter(h => h.lastStatus === 'degraded' || h.circuitState === 'HALF_OPEN').length,
    blocked: Object.values(healthData).filter(h => h.lastStatus === 'blocked').length,
    down: Object.values(healthData).filter(h => h.lastStatus === 'down' || h.circuitState === 'OPEN').length,
    disabled: disabledSourceIds.size,
    sources: healthData,
    disabledSourceIds: Array.from(disabledSourceIds),
  });
});


// Kotatsu App Explore & Featured Recommendations Endpoint
app.get("/api/kotatsu/explore/featured", async (_req, res) => {
  try {
    const allManga = SqliteDb.getAllManga();
    // Only feature series with a real (non-MangaDex) reading source.
    const isReadable = (m: any) =>
      (m.sourceUrl && !isMangaDexSourceLink(m.sourceName, m.sourceUrl)) ||
      (Array.isArray(m.availableSources) && m.availableSources.some((s: any) => !isMangaDexSourceLink(s.sourceName, s.sourceUrl)));
    const readable = allManga.filter(isReadable);
    const manhwa = readable.filter((m: any) => m.type === 'manhwa').slice(0, 12);
    const manhua = readable.filter((m: any) => m.type === 'manhua').slice(0, 12);
    const manga = readable.filter((m: any) => m.type === 'manga').slice(0, 12);

    res.json({
      featuredManhwa: manhwa.map((m: any) => ({
        id: m.id,
        title: m.title,
        coverImage: m.coverImage,
        sourceName: m.sourceName || 'Kotatsu Engine',
        latestChapter: m.latestChapter || 10,
        type: 'manhwa',
      })),
      featuredManhua: manhua.map((m: any) => ({
        id: m.id,
        title: m.title,
        coverImage: m.coverImage,
        sourceName: m.sourceName || 'Kotatsu Engine',
        latestChapter: m.latestChapter || 10,
        type: 'manhua',
      })),
      featuredManga: manga.map((m: any) => ({
        id: m.id,
        title: m.title,
        coverImage: m.coverImage,
        sourceName: m.sourceName || 'Kotatsu Engine',
        latestChapter: m.latestChapter || 10,
        type: 'manga',
      })),
    });
  } catch (e: any) {
    res.json({ featuredManhwa: [], featuredManhua: [], featuredManga: [] });
  }
});

// Kotatsu App Live Chapter Updates Feed Endpoint
app.get("/api/kotatsu/updates", async (_req, res) => {
  try {
    // Live chapter-updates feed built from tracked series that have a REAL
    // (non-MangaDex) reading source — enriched with MangaDex background metadata.
    const allManga = SqliteDb.getAllManga();
    const live = allManga
      .filter((m: any) => m.sourceUrl && !isMangaDexSourceLink(m.sourceName, m.sourceUrl))
      .sort((a: any, b: any) => new Date(b.lastUpdated || 0).getTime() - new Date(a.lastUpdated || 0).getTime())
      .slice(0, 24);

    const items = live.map((m: any) => ({
      id: m.id,
      title: m.title,
      sourceUrl: m.sourceUrl,
      sourceName: m.sourceName || 'Live Source',
      coverImage: m.coverImage || '',
      latestChapter: Number(m.latestChapter) || 1,
      updatedAt: m.lastUpdated || new Date().toISOString(),
      type: m.type || 'manhwa',
      apiId: m.apiId || null,
      description: m.description || '',
      genres: m.genres || [],
    }));

    const enriched = await enrichWithMangaDexMetadata(items);
    res.json(enriched);
  } catch (_) {
    res.json([]);
  }
});

// Comprehensive Bulk Database Update Engine: Pull available series from all active sources
export async function updateDatabaseWithAllAvailableSeries(): Promise<{
  totalNew: number;
  totalMerged: number;
  totalSeriesInDatabase: number;
  sourceCounts: Record<string, number>;
}> {
  console.log('[Database Engine] Starting comprehensive update with all available series from active sources...');
  let totalNew = 0;
  let totalMerged = 0;
  const sourceCounts: Record<string, number> = {};

  // 1. Static hard-coded catalog DISABLED (2026-08-11): the pre-baked rows often
  //    referenced series that do not exist at the live sources. Only live/verified
  //    series are pulled below (Asura/Flame/Manhwa18), so the Explore catalog shows
  //    real, readable titles instead of placeholder/ghost series.
  sourceCounts['kotatsu_catalog'] = 0;

  // 2. Ingest series from Asura Scans (scrapes canonical API up to 340 series)
  try {
    const asuraResult = await scrapeAsuraScans(1, 250);
    const asuraItems = Array.isArray(asuraResult) ? asuraResult : (asuraResult?.items || []);
    if (asuraItems.length > 0) {
      const res = integrateKotatsuSourcesAndMerge(asuraItems);
      totalNew += res.newCount;
      totalMerged += res.mergedCount;
      sourceCounts['asurascans'] = asuraItems.length;
      console.log(`[Database Engine] Asura Scans: +${res.newCount} new, ${res.mergedCount} merged (${asuraItems.length} pulled)`);
    }
  } catch (e: any) {
    console.warn('[Database Engine] Asura Scans bulk update warning:', e.message);
  }

  // 3. Ingest series from Flame Comics
  try {
    const flameItems = await scrapeFlameComics(1, 450);
    if (flameItems && flameItems.length > 0) {
      const res = integrateKotatsuSourcesAndMerge(flameItems);
      totalNew += res.newCount;
      totalMerged += res.mergedCount;
      sourceCounts['flamecomics'] = flameItems.length;
      console.log(`[Database Engine] Flame Comics: +${res.newCount} new, ${res.mergedCount} merged (${flameItems.length} pulled)`);
    }
  } catch (e: any) {
    console.warn('[Database Engine] Flame Comics bulk update warning:', e.message);
  }

  // 4. Ingest series from Manhwa18 (top 5 pages)
  try {
    const m18Items: any[] = [];
    for (let p = 1; p <= 5; p++) {
      const pageItems = await scrapeManhwa18(p, 20);
      if (pageItems && pageItems.length > 0) {
        m18Items.push(...pageItems);
      }
    }
    if (m18Items.length > 0) {
      const res = integrateKotatsuSourcesAndMerge(m18Items);
      totalNew += res.newCount;
      totalMerged += res.mergedCount;
      sourceCounts['manhwa18'] = m18Items.length;
      console.log(`[Database Engine] Manhwa18: +${res.newCount} new, ${res.mergedCount} merged (${m18Items.length} pulled)`);
    }
  } catch (e: any) {
    console.warn('[Database Engine] Manhwa18 bulk update warning:', e.message);
  }

  // 5. Ingest from ALL registered madara/mangathemesia sources (1 page each, polite pacing)
  //    This fills the catalog with discoverable series from every enabled source.
  const extraSources = ENGINE_SOURCE_REGISTRY.filter(
    (s) => !['asura','flame','manhwa18','manhwa18cc','aquamanga','manhuaplus','manhuaplusorg',
             'harimanga','anisascans','adultwebtoon','mangaread','manhwabuddy','manhuafast',
             'kunmanga','topmanhua','manhwaclan','weebcentral','atsumoe','demonicscans','beehentai',
             'manhuascan','ravenscans','luminous','night','hentai20','hotcomics','daycomics',
             'batoto','comickfun','comick','mangatx'].includes(s.id) &&
    s.engine === 'madara' && !disabledSourceIds.has(s.id)
  ).slice(0, 60); // Cap at 60 additional sources per scan to stay within time limits

  let extraPulled = 0;
  for (const src of extraSources) {
    try {
      const srcDef = KOTATSU_SOURCES.find(s => s.id === src.id);
      if (!srcDef) continue;
      const result = await getSourcePopularSeries(srcDef, 1, 15);
      const items = Array.isArray(result) ? result : (result?.items || []);
      if (items.length > 0) {
        const res = integrateKotatsuSourcesAndMerge(items);
        totalNew += res.newCount;
        totalMerged += res.mergedCount;
        extraPulled += items.length;
        sourceCounts[src.id] = items.length;
      }
      // Polite spacing between source requests
      await new Promise(r => setTimeout(r, 800));
    } catch { /* skip broken sources */ }
  }
  if (extraPulled > 0) {
    console.log(`[Database Engine] Extra sources: +${extraPulled} series from ${extraSources.length} madara sources`);
  }

  // 5. MangaDex is metadata-only — DO NOT ingest its series as standalone sources.
  //    Instead, backfill MangaDex metadata (apiId, cover, description, genres,
  //    alt-titles) onto existing live-source rows that are missing it.
  try {
    const rowsMissingMeta = SqliteDb.getAllManga()
      .filter((m: any) => m.sourceUrl && !isMangaDexSourceLink(m.sourceName, m.sourceUrl) && !m.apiId)
      .slice(0, 60);
    let enrichedCount = 0;
    for (const row of rowsMissingMeta) {
      const meta = await getMangaDexMetadataByTitle(row.title);
      if (!meta || !meta.apiId) continue;
      const updated: any = { ...row, apiId: meta.apiId };
      if (meta.description) updated.description = updated.description || meta.description;
      if (meta.genres && meta.genres.length && (!updated.genres || updated.genres.length === 0)) updated.genres = meta.genres;
      if (meta.coverImage) updated.coverImage = updated.coverImage || meta.coverImage;
      if (meta.altTitles && meta.altTitles.length) updated.altTitles = Array.from(new Set([...(updated.altTitles || []), ...meta.altTitles]));
      SqliteDb.upsertManga(updated);
      enrichedCount++;
    }
    sourceCounts['mangadex_metadata_backfill'] = enrichedCount;
    console.log(`[Database Engine] MangaDex metadata backfill: enriched ${enrichedCount} live series (no standalone MangaDex rows ingested).`);
  } catch (err: any) {
    console.warn('[Database Engine] MangaDex metadata backfill warning:', err.message);
  }

  saveDatabaseToDisk();
  console.log(`[Database Engine] Comprehensive update complete! Added: ${totalNew}, Merged: ${totalMerged}, Total DB count: ${mangaDatabase.length}`);

  return {
    totalNew,
    totalMerged,
    totalSeriesInDatabase: mangaDatabase.length,
    sourceCounts,
  };
}

// Bulk MangaDex Catalog Backfiller: MangaDex is a metadata-only background DB.
// It never ingests standalone `md_*` series; it enriches existing live-source rows
// with MangaDex metadata (apiId, cover, description, genres, alt-titles).
export async function pullBulkMangaDexSeries(maxPages: number = 20): Promise<{
  totalNew: number;
  totalMerged: number;
  totalPulled: number;
  totalSeriesInDatabase: number;
}> {
  const maxRows = Math.min(600, Math.max(20, maxPages * 30));
  console.log(`[MangaDex Background DB] Backfilling MangaDex metadata for up to ${maxRows} existing live series (metadata-only, no standalone rows).`);

  const rowsMissingMeta = SqliteDb.getAllManga()
    .filter((m: any) => m.sourceUrl && !isMangaDexSourceLink(m.sourceName, m.sourceUrl) && !m.apiId)
    .slice(0, maxRows);

  let totalNew = 0;
  let totalMerged = 0;
  let totalPulled = 0;

  for (const row of rowsMissingMeta) {
    try {
      const meta = await getMangaDexMetadataByTitle(row.title);
      if (!meta || !meta.apiId) continue;
      const updated: any = { ...row, apiId: meta.apiId };
      if (meta.description) updated.description = updated.description || meta.description;
      if (meta.genres && meta.genres.length && (!updated.genres || updated.genres.length === 0)) updated.genres = meta.genres;
      if (meta.coverImage) updated.coverImage = updated.coverImage || meta.coverImage;
      if (meta.altTitles && meta.altTitles.length) updated.altTitles = Array.from(new Set([...(updated.altTitles || []), ...meta.altTitles]));
      SqliteDb.upsertManga(updated);
      totalPulled++;
    } catch (err: any) {
      console.warn('[MangaDex Background DB] Backfill error:', err.message);
    }
  }

  saveDatabaseToDisk();
  console.log(`[MangaDex Background DB] Backfill complete: enriched ${totalPulled} series metadata (metadata-only).`);

  return {
    totalNew,
    totalMerged,
    totalPulled,
    totalSeriesInDatabase: mangaDatabase.length,
  };
}

// Bulk Ingestion Endpoints: Pull All Available Series From Active Sources into Database
app.post(["/api/kotatsu/pull-all-sources", "/api/scrape/update-all-series"], async (_req, res) => {
  try {
    const result = await updateDatabaseWithAllAvailableSeries();
    res.json({
      success: true,
      message: `Successfully pulled all available series from active sources into database.`,
      addedCount: result.totalNew,
      mergedCount: result.totalMerged,
      totalSeriesInDatabase: result.totalSeriesInDatabase,
      sourceCounts: result.sourceCounts,
    });
  } catch (err: any) {
    console.error("[Database Engine] Bulk ingestion error:", err);
    res.status(500).json({ error: "Failed to pull series from sources", details: err.message });
  }
});

// Direct Bulk MangaDex Ingestion Endpoint (POST /api/mangadex/pull-bulk-catalog)
app.post("/api/mangadex/pull-bulk-catalog", async (req, res) => {
  const pages = Math.min(100, Math.max(1, Number(req.body?.pages) || 20)); // Default 20 pages (2,000 series)
  try {
    const result = await pullBulkMangaDexSeries(pages);
    res.json({
      success: true,
      message: `MangaDex metadata backfill complete: enriched ${result.totalPulled} live series (metadata-only).`,
      ...result,
    });
  } catch (err: any) {
    console.error("[MangaDex Bulk Endpoint] Error:", err);
    res.status(500).json({ error: "Failed to pull bulk series from MangaDex API", details: err.message });
  }
});



// Kotatsu Parser Latest Releases Endpoint
app.get("/api/kotatsu/latest", async (req, res) => {
  const sourceId = (req.query.sourceId as string) || '';
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(Number(req.query.limit) || 24, 100);
  const offset = (page - 1) * limit;

  // MangaDex is a metadata-only background DB — never resolve to it as a reading source.
  let sourceDef = KOTATSU_SOURCES.find((s) => s.id === sourceId && s.id !== 'mangadex');
  if (!sourceDef) {
    sourceDef =
      KOTATSU_SOURCES.find((s) => s.id !== 'mangadex' && !disabledSourceIds.has(s.id) && isSourceAlive(s.id)) ||
      KOTATSU_SOURCES.find((s) => s.id !== 'mangadex');
  }
  if (!sourceDef) return res.json([]);

  try {
    const result = await getSourcePopularSeries(sourceDef, page, limit);
    // Normalize: getSourcePopularSeries may return { items, totalCount } or a bare array
    const items = Array.isArray(result) ? result : (result?.items || []);
    const totalCount = Array.isArray(result) ? items.length : (result?.totalCount ?? items.length);
    // Attach MangaDex background metadata (covers / descriptions / genres).
    const enriched = await enrichWithMangaDexMetadata(items);
    res.setHeader('X-Total-Count', String(totalCount));
    res.setHeader('X-Total-Pages', String(Math.ceil(totalCount / limit)));
    return res.json(enriched);
  } catch (e) {
    res.json([]);
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DEDICATED SOURCE SCRAPERS (Kotatsu Parser conventions per site)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const SCRAPER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Generate a stable, collision-free id for a scraped source item by hashing the
// FULL href. Previously only the first 16 base64url chars of the URL were used,
// which — because every URL on a site shares the "https://<domain>" prefix —
// produced the SAME id for every series on a site, collapsing them all into one
// DB row (e.g. every manhwa18.com series became "manhwa18_aHR0cHM6Ly9tYW5o",
// so clicking any series resolved to a single entry — "Announcer Raw").
function generateSourceScrapeId(prefix: string, href: string): string {
  const normalized = href.replace(/\/+$/, '');
  return `${prefix}_${crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 24)}`;
}

// ── 1. ASURA SCANS – JSON API Scraper (api.asurascans.com/api/series) ──
// The asuracomic.net /browse page is a client-rendered shell (no inline data),
// so we scrape the canonical JSON catalog API instead. It returns
//   { data: Series[], meta: { total, per_page, has_more } }
// with offset-based pagination and full metadata per series.
// Returns: { items, totalCount } so callers can expose pagination state.
async function scrapeAsuraScans(page: number, limit: number): Promise<{ items: any[]; totalCount: number }> {
  const ASURA_API = 'https://api.asurascans.com/api/series';
  const ASURA_PER_PAGE = 20;    // series returned per API page
  const ASURA_TOTAL = 340;    // fallback if totalCount not in API response

  const safeOffset = Math.max(0, (page - 1) * limit);
  const wanted = Math.max(1, Math.min(limit, ASURA_PER_PAGE * 4));

  const collected: any[] = [];
  let detectedTotal = ASURA_TOTAL;

  // Paginate through the JSON API (20 series per page) starting at our requested offset,
  // collecting exactly `wanted` series for this user page.
  let offset = safeOffset;
  while (collected.length < wanted) {
    let json: any;
    try {
      const res = await fetch(`${ASURA_API}?offset=${offset}`, {
        signal: AbortSignal.timeout(12000),
        headers: {
          'User-Agent': SCRAPER_UA,
          'Accept': 'application/json',
          'Origin': 'https://asurascans.com',
          'Referer': 'https://asurascans.com/',
        },
      });
      if (!res.ok) {
        console.warn(`[Asura] API returned HTTP ${res.status} at offset ${offset}`);
        break;
      }
      json = await res.json();
    } catch (e) {
      console.error(`[Asura] Error fetching API at offset ${offset}:`, (e as Error).message);
      break;
    }

    const data: any[] = Array.isArray(json?.data) ? json.data : [];
    if (json?.meta?.total) detectedTotal = Number(json.meta.total);
    if (data.length === 0) break;

    for (const s of data) {
      if (collected.length >= wanted) break;
      const slug = s.slug || s.id || '';
      if (!slug) continue;
      const pubPath = s.public_url || `/comics/${s.slug || slug}`;
      collected.push({
        id: `asura_${slug}`,
        title: s.title || 'Unknown',
        sourceUrl: `https://asurascans.com${pubPath}`,
        coverImage: s.cover || '',
        sourceName: 'Asura Scans',
        description: (s.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 200),
        genres: (Array.isArray(s.genres) ? s.genres : []).map((g: any) => g?.name).filter(Boolean),
        latestChapter: s.chapter_count ? Number(s.chapter_count) : 1,
        type: s.type || 'manhwa',
        rating: typeof s.rating === 'number' ? Number(s.rating.toFixed(1)) : 9.0,
      });
    }

    offset += data.length;
    // Polite throttle between API page requests
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`[Asura] Collected ${collected.length} items for user page ${page} (totalCount: ${detectedTotal})`);

  return { items: collected, totalCount: detectedTotal };
}

// ── 2. FLAME COMICS (HTML series grid, all 1 page) ────────────────────────────
// URL: https://flamecomics.xyz/browse
async function scrapeFlameComics(page: number, limit: number): Promise<any[]> {
  try {
    const url = page === 1 ? 'https://flamecomics.xyz/browse' : `https://flamecomics.xyz/browse?page=${page}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': SCRAPER_UA, 'Accept': 'text/html' },
    });
    if (!res.ok) return [];

    const html = await res.text();
    const results: any[] = [];
    const seen = new Set<string>();

    // Flame uses /series/{ID} URL pattern
    const seriesRx = /href="(https:\/\/flamecomics\.xyz\/series\/\d+)"[^>]*>([^<]{3,150})<\/a>/gi;
    const coverRx = /<img[^>]+src="([^"]+flamecomics[^"]+)"[^>]*>/gi;
    const countryRx = /\/(KR|CN|JP)\//;

    const covers: string[] = [];
    let cm: RegExpExecArray | null;
    while ((cm = coverRx.exec(html)) !== null) {
      covers.push(cm[1]);
    }

    let m: RegExpExecArray | null;
    while ((m = seriesRx.exec(html)) !== null) {
      const href = m[1];
      const title = m[2].trim();
      const key = href.toLowerCase();
      if (seen.has(key) || !title) continue;
      seen.add(key);

      const langMatch = html.substring(Math.max(0, m.index - 200), m.index).match(/href="https:\/\/flamecomics\.xyz\/series\/\d+"[^>]*>(KR|CN|JP)<\/a>/);
      const country = langMatch?.[1] || 'KR';
      const type = country === 'CN' ? 'manhua' : country === 'JP' ? 'manga' : 'manhwa';
      const coverIdx = results.length;

      results.push({
        id: `flame_${href.split('/').pop()}`,
        title,
        sourceUrl: href,
        coverImage: covers[coverIdx] || '',
        sourceName: 'Flame Comics',
        description: `Series from Flame Comics`,
        genres: ['Action'],
        latestChapter: 1,
        type,
      });
    }

    const offset = (page - 1) * limit;
    return results.slice(offset, offset + limit);
  } catch (e) {
    console.error('[Scraper] Flame Comics failed:', (e as Error).message);
    return [];
  }
}

// ── 3. MANHWA18 (HTML catalog — /tim-kiem?page=N, Kotatsu-Redo reference) ───
// Kotatsu-Redo uses /tim-kiem (search/browse) not /manga-list.
// Selectors: .card-body .thumb-item-flow > .thumb_attr.series-title > a
// Covers: .thumb img (data-src first, lazy-loaded)
async function scrapeManhwa18(page: number, limit: number): Promise<any[]> {
  try {
    // Kotatsu-Redo's Manhwa18Com.kt uses /tim-kiem?page=N
    const url = `https://manhwa18.com/tim-kiem?page=${page}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': SCRAPER_UA, 'Accept': 'text/html', 'Referer': 'https://manhwa18.com/' },
    });
    if (!res.ok) return [];

    const html = await res.text();
    // Try cheerio with Kotatsu selectors first
    const $ = cheerio.load(html);
    const results: any[] = [];
    const seen = new Set<string>();

    // Primary: Kotatsu .card-body .thumb-item-flow
    let cards = $('.card-body .thumb-item-flow').toArray();
    if (cards.length === 0) cards = $('.thumb_attr.series-title').parent().toArray();

    for (const el of cards) {
      if (results.length >= limit) break;
      const card = $(el);
      const titleA = card.find('.thumb_attr.series-title > a').first();
      const href = titleA.attr('href') || '';
      const title = titleA.text().trim();
      if (!href || !title) continue;
      const absUrl = href.startsWith('http') ? href : `https://manhwa18.com${href.startsWith('/')?'':'/'}${href}`;
      if (!/\/manga\/[^/]+$/i.test(absUrl.replace(/\/+$/, ''))) continue;
      const key = absUrl.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const thumb = card.find('.thumb img').first();
      const cover = thumb.attr('data-src') || thumb.attr('src') || '';
      results.push({
        id: generateSourceScrapeId('manhwa18', absUrl),
        title, sourceUrl: absUrl,
        coverImage: cover.startsWith('http') ? cover : '',
        sourceName: 'Manhwa18',
        description: 'Adult manhwa series from Manhwa18',
        genres: ['Adult', 'Manhwa'], latestChapter: 1, type: 'manhwa',
      });
    }

    // Regex fallback if cheerio found nothing
    if (results.length === 0) {
      const titleRx = /<div class="thumb_attr series-title">\s*<a href="([^"]+)" title="([^"]+)"/gi;
      const bgRx = /data-bg="([^"]+)"/gi;
      const covers: string[] = [];
      let bg: RegExpExecArray | null;
      while ((bg = bgRx.exec(html)) !== null) covers.push(bg[1]);
      let t: RegExpExecArray | null;
      let idx = 0;
      while ((t = titleRx.exec(html)) !== null && results.length < limit) {
        let href = t[1];
        if (!href.startsWith('http')) href = `https://manhwa18.com${href.startsWith('/')?'':'/'}${href}`;
        href = href.replace(/\/+$/, '');
        if (!/\/manga\/[^/]+$/i.test(href) || seen.has(href)) continue;
        seen.add(href);
        results.push({
          id: generateSourceScrapeId('manhwa18', href),
          title: (t[2]||'').trim() || 'Untitled', sourceUrl: href,
          coverImage: covers[idx] || '', sourceName: 'Manhwa18',
          description: 'Adult manhwa from Manhwa18',
          genres: ['Adult','Manhwa'], latestChapter: 1, type: 'manhwa',
        });
        idx++;
      }
    }
    return results;
  } catch (e) {
    console.error('[Scraper] Manhwa18 failed:', (e as Error).message);
    return [];
  }
}

// BULK AUTO-SCRAPE ENDPOINT  POST /api/scrape/source-catalog
// Scrapes ALL pages from a given source and saves to database
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.post('/api/scrape/source-catalog', async (req, res) => {
  const { sourceId } = req.body as { sourceId: string };
  if (!sourceId) return res.status(400).json({ error: 'sourceId required' });

  const SCRAPE_CONFIGS: Record<string, { totalPages: number; limit: number; scraper: (p: number, l: number) => Promise<any[] | { items: any[]; totalCount: number }> }> = {
    asurascans: { totalPages: 17, limit: 20, scraper: scrapeAsuraScans },
    flamecomics: { totalPages: 1, limit: 200, scraper: scrapeFlameComics },
    manhwa18: { totalPages: 90, limit: 20, scraper: scrapeManhwa18 },
  };

  const config = SCRAPE_CONFIGS[sourceId];
  if (!config) {
    return res.status(400).json({ error: `No scrape config for sourceId "${sourceId}". Supported: ${Object.keys(SCRAPE_CONFIGS).join(', ')}` });
  }

  // Send immediate progress response, scrape async
  res.json({
    status: 'started',
    sourceId,
    totalPages: config.totalPages,
    message: `Scraping ${config.totalPages} page(s) from ${sourceId}. Check /api/scrape/status/${sourceId} for progress.`,
  });

  // Run async scrape in background
  (async () => {
    let totalAdded = 0;
    for (let page = 1; page <= config.totalPages; page++) {
      try {
        const raw = await config.scraper(page, config.limit);
        // Handle both array and { items, totalCount } return types
        const items: any[] = Array.isArray(raw) ? raw : raw.items;
        for (const item of items) {
          const existing = SqliteDb.getAllManga().find((m: any) =>
            m.title.toLowerCase().trim() === item.title.toLowerCase().trim()
          );
          if (!existing) {
            SqliteDb.upsertManga({
              ...item,
              id: item.id || `scraped_${sourceId}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
              status: 'reading',
              currentChapter: 0,
              autoUpdateEnabled: false,
              addedAt: new Date().toISOString(),
              lastUpdated: new Date().toISOString(),
            } as MangaItem);
            totalAdded++;
          }
        }
        console.log(`[AutoScraper] ${sourceId} page ${page}/${config.totalPages}: +${items.length} items (${totalAdded} new total)`);
        // Polite delay between pages to avoid bot detection
        await new Promise(r => setTimeout(r, 1200));
      } catch (e) {
        console.error(`[AutoScraper] Error on page ${page} for ${sourceId}:`, (e as Error).message);
      }
    }
    console.log(`[AutoScraper] Done scraping ${sourceId}: ${totalAdded} series added to database.`);
  })();
});

// ── SINGLE-PAGE LIVE BROWSE ENDPOINT  GET /api/scrape/browse ─────────────────
// Serves paginated live scraping for the source browser view
app.get('/api/scrape/browse', async (req, res) => {
  const sourceId = (req.query.sourceId as string || '').toLowerCase();
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));

  try {
    let items: any[] = [];
    let totalCount = 0;
    if (sourceId === 'asurascans') {
      const result = await scrapeAsuraScans(page, limit);
      items = result.items;
      totalCount = result.totalCount;
    } else if (sourceId === 'flamecomics') {
      items = await scrapeFlameComics(page, limit);
      totalCount = items.length;
    } else if (sourceId === 'manhwa18') {
      items = await scrapeManhwa18(page, limit);
      totalCount = 90 * limit; // 90 pages
    } else {
      return res.status(400).json({ error: `No scraper registered for sourceId "${sourceId}"` });
    }
    res.setHeader('X-Total-Count', String(totalCount));
    res.setHeader('X-Total-Pages', String(Math.ceil(totalCount / limit)));
    return res.json(items);
  } catch (e: any) {
    console.error(`[Scrape Browse] Error for ${sourceId}:`, e.message);
    return res.json([]);
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LIVE EXPLORE FEED  GET /api/explore
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The Explore page ("/browse") feeds exclusively on LIVE source data — never the
// local SQLite library. This endpoint aggregates popular/live series across a
// curated set of enabled, alive sources, dedupes them by normalized title, and
// paginates. A short-TTL cache keeps repeat calls from hammering the sources.
// Curated sources that should always appear first in the default explore feed.
const DEFAULT_EXPLORE_SOURCE_IDS = ['asurascans', 'flamecomics', 'weebcentral', 'demonicscans', 'manhwa18'];
// ── Explore Catalog Buffer ──────────────────────────────────────────────────
// Instead of scraping sources live on every request, we buffer the consolidated
// explore catalog in memory and refresh it automatically (once on startup + a
// background interval). Reads are served straight from the buffer (near-instant),
// so opening /browse no longer pays the full multi-source scrape latency each time.
const EXPLORE_REFRESH_INTERVAL_MS = Number(process.env.EXPLORE_REFRESH_INTERVAL_MS) || 5 * 60 * 1000; // default 5 min
const EXPLORE_CACHE_TTL_MS = Number(process.env.EXPLORE_CACHE_TTL_MS) || 60 * 60 * 1000; // hard TTL 1 h
const EXPLORE_WARM_PAGES = Math.max(1, Math.min(6, Number(process.env.EXPLORE_WARM_PAGES) || 3)); // pages warmed per source
const EXPLORE_WARM_LIMIT = 40; // items requested per source page during warm-up (can be increased for better coverage)
const EXPLORE_DOMAIN_SPACING_MS = 1200; // min gap between requests to the same domain (politeness)
// Cap how many sources are warmed per refresh cycle so the background buffer
// stays bounded even when the catalog contains hundreds of entries.
const EXPLORE_MAX_WARM_SOURCES = Math.max(4, Math.min(60, Number(process.env.EXPLORE_MAX_WARM_SOURCES) || 30));
let exploreSourceRotationIndex = 0;

interface ExploreBufferEntry {
  items: any[];                 // consolidated (cross-source, deduped, ordered) list w/ __sourceId
  sourceIds: string[];          // sources represented in this snapshot
  builtAt: number;
  expiresAt: number;
  lastError: string | null;
}
const exploreBufferRef: { current: ExploreBufferEntry | null } = { current: null };
let exploreRefreshRunning = false;
let exploreRefreshTimer: ReturnType<typeof setInterval> | null = null;
const lastExploreDomainRequest = new Map<string, number>();

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return url || ''; }
}
function dedupeExploreItems(aggregated: any[]): any[] {
  const seen = new Set<string>();
  const deduped: any[] = [];
  for (const it of aggregated) {
    const key = String(it.title || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
    if (!key) continue;
    if (!seen.has(key)) { seen.add(key); deduped.push(it); }
  }
  return deduped;
}
function getEligibleExploreSources(): SourceDefinition[] {
  return KOTATSU_SOURCES.filter(
    (s) => s.id !== 'mangadex' && !disabledSourceIds.has(s.id) && isSourceAlive(s.id)
  );
}

function defaultExploreSources(): SourceDefinition[] {
  const eligible = getEligibleExploreSources();
  const picks: SourceDefinition[] = [];
  const seen = new Set<string>();

  // 1. Curated priority sources always appear first when they are alive/enabled.
  for (const id of DEFAULT_EXPLORE_SOURCE_IDS) {
    const s = eligible.find((src) => src.id === id);
    if (s) {
      picks.push(s);
      seen.add(id);
    }
  }

  // 2. Fill remaining slots with the rest of the live sources. Rotate the start
  //    index each refresh so, over time, every enabled live source is included
  //    in the aggregated catalog.
  const others = eligible.filter((s) => !seen.has(s.id));
  const totalOthers = others.length;
  if (totalOthers > 0) {
    const start = exploreSourceRotationIndex % totalOthers;
    const rotated = [...others.slice(start), ...others.slice(0, start)];
    const remainingSlots = Math.max(0, EXPLORE_MAX_WARM_SOURCES - picks.length);
    picks.push(...rotated.slice(0, remainingSlots));
  }

  return picks;
}
function throttleExploreDomain(host: string): Promise<void> {
  const wait = EXPLORE_DOMAIN_SPACING_MS - (Date.now() - (lastExploreDomainRequest.get(host) || 0));
  if (wait > 0) return new Promise((r) => setTimeout(r, wait));
  return Promise.resolve();
}

app.get("/api/explore", async (req, res) => {
  const rawSourceId = ((req.query.sourceId as string) || '').trim();
  const q = ((req.query.q as string) || '').trim();
  const page = Math.max(1, Number(req.query.page) || 1);
  
  // Adaptive limit calculation based on client-provided parameters
  let limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
  
  // If client provides a resolution parameter, adjust the limit dynamically
  const clientWidth = Number(req.query.width) || 0;
  const clientHeight = Number(req.query.height) || 0;
  
  // If width and height are provided, calculate a dynamic limit based on screen area
  if (clientWidth > 0 && clientHeight > 0) {
    // Calculate screen area in pixels
    const screenArea = clientWidth * clientHeight;
    
    // Adjust limit based on screen area (smaller screens get fewer items, larger get more)
    const baseLimit = 30;
    const maxLimit = 100;
    const minWidth = 1024; // Minimum width that triggers scaling
    const maxWidth = 3840; // Maximum width that triggers scaling
    
    // Normalize screen area to a factor between 0 and 1
    const normalizedArea = Math.min(1, Math.max(0, (screenArea - minWidth * minWidth) / (maxWidth * maxWidth - minWidth * minWidth)));
    
    // Apply exponential scaling based on screen size
    const scaleFactor = 1 + (normalizedArea * 2.5); // Scale factor between 1 and 3.5
    const scaledLimit = Math.min(maxLimit, Math.floor(baseLimit * scaleFactor));
    
    limit = Math.max(baseLimit, scaledLimit);
  }
  
  // Also try to detect device type from headers for optimization
  const userAgent = req.headers['user-agent']?.toString() || '';
  const isMobile = /mobile|android|iphone|ipod|blackberry|iemobile|opera mini|fennec|windows phone|windows mobile/i.test(userAgent);
  
  // For mobile devices, reduce limits to prevent overloading
  if (isMobile) {
    limit = Math.min(40, limit); // Cap mobile limits to 40
  }

  // Serve from the buffered catalog whenever possible (near-instant). Only when
  // the buffer isn't warm yet (first request before background warm-up finishes,
  // or an explicit source outside the default/explore set) do we pay for a live scrape.
  const buf = exploreBufferRef.current;
  const bufferReady = !!buf && buf.items.length > 0;
  const bufferFresh = bufferReady && Date.now() < buf!.expiresAt;
  const sourceInBuffer = bufferReady && !!buf && (rawSourceId === 'all' || rawSourceId === '' || buf.sourceIds.includes(rawSourceId));
  // stale-while-revalidate: if the buffer is present, serve it immediately even if it's
  // past its hard TTL; a fresh copy is fetched in the background without blocking the response.
  const useBuffer = sourceInBuffer;

  if (useBuffer) {
    // If this snapshot is past its hard TTL, refresh it in the background without
    // making the caller wait — they already got the cached copy above.
    if (!bufferFresh) refreshExploreCatalog(false).catch(() => {});
    let list: any[] = buf!.items;
    if (rawSourceId && rawSourceId !== 'all') {
      list = list.filter((it) => it.__sourceId === rawSourceId);
    }
    if (q) {
      const needle = q.toLowerCase();
      list = list.filter((it) =>
        (it.title || '').toLowerCase().includes(needle) ||
        (it.description || '').toLowerCase().includes(needle)
      );
    }
    const offset = (page - 1) * limit;
    const paged = list.slice(offset, offset + limit);
    const totalPages = Math.max(1, Math.ceil(list.length / limit));
    res.setHeader('X-Total-Count', String(list.length));
    res.setHeader('X-Total-Pages', String(totalPages));
    return res.json({ items: paged, totalCount: list.length, totalPages, cached: true });
  }

  // Fallback: live scrape path (unchanged behaviour) when the buffer isn't warm.
  const sourcesToBrowse: SourceDefinition[] = [];
  if (rawSourceId && rawSourceId !== 'all') {
    const found = KOTATSU_SOURCES.find(
      (s) => s.id === rawSourceId && s.id !== 'mangadex' && !disabledSourceIds.has(s.id) && isSourceAlive(s.id)
    );
    if (found) sourcesToBrowse.push(found);
  } else {
    sourcesToBrowse.push(...defaultExploreSources());
  }

  if (sourcesToBrowse.length === 0) {
    return res.json({ items: [], totalCount: 0, totalPages: 0, cached: false });
  }

  try {
    const aggregated: any[] = [];
    const perSourceLimit = Math.max(6, Math.ceil(limit / sourcesToBrowse.length));

    await Promise.all(
      sourcesToBrowse.map(async (src) => {
        try {
          const result = await getSourcePopularSeries(src, page, perSourceLimit);
          const items = Array.isArray(result) ? result : (result?.items || []);
          for (const item of items) aggregated.push({ ...item, __sourceId: src.id, __sourceName: src.name });
        } catch {
          // ignore per-source errors so one bad source doesn't kill the whole feed
        }
      })
    );

    let unique = aggregated;
    if (q) {
      const needle = q.toLowerCase();
      unique = unique.filter((it) =>
        (it.title || '').toLowerCase().includes(needle) ||
        (it.description || '').toLowerCase().includes(needle)
      );
    }

    const deduped = dedupeExploreItems(unique);
    const offset = (page - 1) * limit;
    const paged = deduped.slice(offset, offset + limit);
    const totalPages = Math.max(1, Math.ceil(deduped.length / limit));

    res.setHeader('X-Total-Count', String(deduped.length));
    res.setHeader('X-Total-Pages', String(totalPages));
    return res.json({ items: paged, totalCount: deduped.length, totalPages, cached: false });
  } catch (e: any) {
    console.error('[Explore] Failed to aggregate live feed:', e.message);
    return res.json({ items: [], totalCount: 0, totalPages: 0, cached: false });
  }
});

// Helper: Get source-specific popular series feed (Kotatsu Parser Live Scraper + Multi-Tier Fallback)
// Returns { items, totalCount } so callers can set X-Total-Pages headers for proper pagination.
async function getSourcePopularSeries(sourceDef: SourceDefinition, page: number = 1, limit: number = 24): Promise<{ items: any[]; totalCount: number }> {
  const offset = (page - 1) * limit;

  // 1. MangaDex is a BACKGROUND METADATA database, never a reading source.
  // When requested, delegate to a default live reading source so MangaDex
  // series are never surfaced as standalone source listings.
  if (sourceDef.engineType === 'mangadex') {
    const fallback =
      KOTATSU_SOURCES.find((s) => s.id !== 'mangadex' && !disabledSourceIds.has(s.id) && isSourceAlive(s.id)) ||
      KOTATSU_SOURCES.find((s) => s.id !== 'mangadex');
    if (fallback) return getSourcePopularSeries(fallback, page, limit);
    return { items: [], totalCount: 0 };
  }

  // 2. Dedicated scraper for known sites
  const lowerName = sourceDef.name.toLowerCase();
  const lowerId = sourceDef.id.toLowerCase();
  if (lowerName.includes('asura') || lowerId.includes('asura')) {
    const result = await scrapeAsuraScans(page, limit);
    if (result.items.length > 0) return result;
  }
  if (lowerName.includes('flame') || lowerId.includes('flame')) {
    const items = await scrapeFlameComics(page, limit);
    if (items.length > 0) return { items, totalCount: items.length };
  }
  if (lowerName.includes('manhwa18') || lowerId.includes('manhwa18')) {
    const items = await scrapeManhwa18(page, limit);
    if (items.length > 0) return { items, totalCount: 90 * limit };
  }

  const scrapedItems: any[] = [];

  // 3. Generic live catalog scraper (Kotatsu parser URL conventions by engine type)
  //    Now uses fetchWithChallengeBypass for Cloudflare resilience + cheerio DOM parsing
  //    instead of regex, with exponential backoff retry (max 3 attempts).
  try {
    let catalogUrl: string;
    if (sourceDef.engineType === 'madara') {
      catalogUrl = page === 1 ? `${sourceDef.baseUrl}/manga/` : `${sourceDef.baseUrl}/manga/page/${page}/`;
    } else if (sourceDef.engineType === 'mangathemesia') {
      catalogUrl = `${sourceDef.baseUrl}/manga/?page=${page}&order=popular`;
    } else if (sourceDef.engineType === 'wpcomics') {
      catalogUrl = page === 1 ? `${sourceDef.baseUrl}/` : `${sourceDef.baseUrl}/page/${page}`;
    } else {
      catalogUrl = page === 1 ? `${sourceDef.baseUrl}/series` : `${sourceDef.baseUrl}/series?page=${page}`;
    }

    // Fast-fail if source is already marked down/blocked (circuit breaker OPEN)
    if (!sourceCircuitBreaker.canAttempt(sourceDef.id)) {
      console.warn(`[Catalog Scraper] Fast-failing ${sourceDef.name} (circuit OPEN)`);
      return { items: [], totalCount: 0 };
    }

    // Retry with exponential backoff (max 3 attempts: 4s, 8s, 12s timeout)
    let html: string | null = null;
    for (let attempt = 0; attempt < 3 && !html; attempt++) {
      try {
        const timeout = [4000, 8000, 12000][attempt] || 4000;
        const liveRes = await fetchWithChallengeBypass(catalogUrl, {
          headers: { 'User-Agent': SCRAPER_UA, 'Accept': 'text/html,application/xhtml+xml' },
          enableCloudflareBypass: appSettings.enableCloudflareBypass,
          flareSolverrUrl: appSettings.flareSolverrUrl,
          captchaSolverEnabled: appSettings.captchaSolverEnabled,
          captchaApiKey: appSettings.captchaApiKey,
          timeoutMs: timeout,
          sourceId: sourceDef.id,
          onCookieUpdate: (sid, cookies) => sourceCookieJar.setCookies(sid, cookies),
        });
        if (liveRes.ok && liveRes.html) {
          html = liveRes.html;
          if (liveRes.bypassed) console.log(`[Catalog Scraper] ${sourceDef.name}: bypassed via ${liveRes.methodUsed}`);
          updateSourceHealth(sourceDef.id, liveRes.html, liveRes.status);
        } else {
          updateSourceHealth(sourceDef.id, null, liveRes.status || 500);
          if (liveRes.status === 404 || liveRes.status === 410) {
            break; // Fast-fail non-transient HTTP errors
          }
          if (attempt < 2) {
            console.warn(`[Catalog Scraper] ${sourceDef.name} attempt ${attempt+1} failed. Retrying...`);
            await new Promise(r => setTimeout(r, [1000, 2500][attempt]));
          }
        }
      } catch (fetchErr: any) {
        updateSourceHealth(sourceDef.id, null, 0, fetchErr?.message);
        if (attempt < 2) {
          console.warn(`[Catalog Scraper] ${sourceDef.name} attempt ${attempt+1} errored. Retrying...`);
          await new Promise(r => setTimeout(r, [1000, 2500][attempt]));
        }
      }
    }
    if (html) {
      const $ = cheerio.load(html);
      const allImgs: string[] = [];
      $('img').each((_i, el) => {
        const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src') || '';
        if (src && /\.(jpg|jpeg|png|webp)/i.test(src) && !/logo|avatar|banner|icon|placeholder/i.test(src) && !isAdImageSrc(src, origin)) {
          allImgs.push(src.startsWith('http') ? src : `${sourceDef.baseUrl.replace(/\/$/, '')}${src}`);
        }
      });

      const seenTitles = new Set<string>();
      const pushItem = (href: string, title: string) => {
        const normTitle = title.toLowerCase();
        if (!href || title.length < 2 || seenTitles.has(normTitle)) return;
        if (/nav|menu|home|login|register|sign|account|cookie|privacy|about|dmca|contact/i.test(title)) return;
        if (!/\/(manga|series|title|manhwa|manhua|comic|webtoon)\//i.test(href)) return;
        seenTitles.add(normTitle);
        scrapedItems.push({
          id: generateSourceScrapeId(`live_${sourceDef.id}`, href),
          title,
          sourceUrl: href.startsWith('http') ? href : `${sourceDef.baseUrl.replace(/\/$/, '')}${href}`,
          coverImage: allImgs[scrapedItems.length] || '',
          sourceName: sourceDef.name,
          description: `Live directory entry from ${sourceDef.name}`,
          genres: ['Action', 'Fantasy'],
          latestChapter: 10,
          type: sourceDef.id.includes('manhua') ? 'manhua' : sourceDef.id.includes('manhwa') ? 'manhwa' : 'manga',
        });
      };

      // ── Structured selectors for Madara & MangaThemesia themes ──
      const madaraSels = ['.manga-title-badges', '.page-item-detail .h5 a', 'h3.h5 a', 'h3 a',
        '.post-title a', '.entry-title a', '.listupd .bsx .tt a', '.utao .uta .luf a',
        '.series-title a', '.manga-title a'];
      let found = false;
      for (const sel of madaraSels) {
        const links = $(sel).toArray();
        if (links.length > 0) {
          found = true;
          links.forEach(el => { const a = $(el); pushItem(a.attr('href') || '', a.text().trim()); });
          break;
        }
      }
      // ── Fallback: generic <a> extraction ──
      if (!found) {
        $('a').each((_i, el) => {
          const a = $(el); pushItem(a.attr('href') || '', a.text().trim());
        });
      }
    }
  } catch (e) {
    // Live scrape timed out or failed — proceed to multi-tier database fallback
  }

  if (scrapedItems.length >= limit) {
    return { items: scrapedItems.slice(0, limit), totalCount: scrapedItems.length };
  }

  // 4. SQLite Database Merging — real tracked series belonging to this source.
  // Static hard-coded placeholder catalogs (dedicated lists / KOTATSU_COMPLETE_CATALOG)
  // were removed: they surfaced series that don't actually exist at the sources.
  const targetId = sourceDef.id.toLowerCase();
  const targetName = sourceDef.name.toLowerCase();
  const targetDomain = sourceDef.baseUrl.replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase();

  const dbMatches = SqliteDb.getAllManga().filter((m: any) => {
    const sName = (m.sourceName || '').toLowerCase();
    const sUrl = (m.sourceUrl || '').toLowerCase();
    return sName.includes(targetId) || sName.includes(targetName) || (sUrl && sUrl.includes(targetDomain));
  }).map((m: any) => ({
    id: m.id,
    title: m.title,
    sourceUrl: m.sourceUrl || sourceDef.baseUrl,
    coverImage: m.coverImage,
    sourceName: sourceDef.name,
    description: m.description || `Indexed from ${sourceDef.name}`,
    genres: m.genres || ['Action'],
    latestChapter: m.latestChapter || 1,
    type: m.type || 'manhwa',
  }));

  // Combine & Deduplicate by Title (live-scraped items first, then real DB rows)
  const combined = [...scrapedItems, ...dbMatches];
  const uniqueItems: any[] = [];
  const seen = new Set<string>();

  for (const item of combined) {
    const key = item.title.toLowerCase().trim();
    if (!seen.has(key)) {
      seen.add(key);
      uniqueItems.push(item);
    }
  }

return { items: uniqueItems.slice(offset, offset + limit), totalCount: uniqueItems.length };
}

// ── Explore Catalog Buffer: background warm-up & automatic refresh ───────────
async function buildExploreBuffer(): Promise<ExploreBufferEntry | null> {
  const sources = defaultExploreSources();
  if (sources.length === 0) return null;
  const aggregated: any[] = [];
  // Warm each source sequentially with politeness spacing between domain requests,
  // so the consolidated snapshot contains enough items to serve early pages quickly.
  for (const src of sources) {
    const domain = hostOf(src.baseUrl);
    await throttleExploreDomain(domain);
    lastExploreDomainRequest.set(domain, Date.now());
    // Use increased limit for warm-up to collect more items
    const warmLimit = EXPLORE_WARM_LIMIT * 2; // Increase to 60 items per page
    for (let p = 1; p <= EXPLORE_WARM_PAGES; p++) {
      try {
        const result = await getSourcePopularSeries(src, p, warmLimit);
        const items = Array.isArray(result) ? result : (result?.items || []);
        lastExploreDomainRequest.set(domain, Date.now());
        for (const it of items) aggregated.push({ ...it, __sourceId: src.id, __sourceName: src.name });
      } catch {
        // skip an errored page — loosing one page is better than failing the whole buffer
      }
    }
  }
  const deduped = dedupeExploreItems(aggregated);

  // Advance the rotation window so the next refresh surfaces a different slice
  // of the remaining live sources.
  const eligible = getEligibleExploreSources();
  const othersTotal = Math.max(0, eligible.length - DEFAULT_EXPLORE_SOURCE_IDS.length);
  if (othersTotal > 0) {
    const step = Math.max(1, EXPLORE_MAX_WARM_SOURCES - DEFAULT_EXPLORE_SOURCE_IDS.length);
    exploreSourceRotationIndex = (exploreSourceRotationIndex + step) % othersTotal;
  }

  return {
    items: deduped,
    sourceIds: sources.map((s) => s.id),
    builtAt: Date.now(),
    expiresAt: Date.now() + EXPLORE_CACHE_TTL_MS,
    lastError: null,
  };
}

async function refreshExploreCatalog(force = false): Promise<void> {
  if (exploreRefreshRunning) return; // never run two warm-ups concurrently
  exploreRefreshRunning = true;
  try {
    const built = await buildExploreBuffer();
    if (built && built.items.length > 0) {
      exploreBufferRef.current = built;
      // Persist the fresh snapshot to SQLite so a restart can serve /browse instantly.
      try { SqliteDb.setExploreBuffer(built); } catch (e: any) { console.error('[Explore Buffer] Persist failed:', e?.message); }
      console.log(
        `[Explore Buffer] Catalog ${force ? 'warmed' : 'refreshed'}: ${built.items.length} series across ${built.sourceIds.length} source(s) [${built.sourceIds.join(', ')}]`
      );
    } else if (force) {
      console.warn('[Explore Buffer] Warm-up produced no items; will retry on next interval.');
    }
  } catch (e: any) {
    console.error('[Explore Buffer] Refresh failed:', e?.message);
    if (exploreBufferRef.current) exploreBufferRef.current.lastError = e?.message || 'unknown';
  } finally {
    exploreRefreshRunning = false;
  }
}

function scheduleExploreRefresher(): void {
  // Hydrate from SQLite FIRST so /api/explore is instantly ready after a restart
  // (no need to wait for the background warm-up to finish scraping sources).
  try {
    const saved = SqliteDb.getExploreBuffer();
    if (saved && Array.isArray(saved.items) && saved.items.length > 0) {
      // Keep the persisted sourceIds/expiresAt; builtAt reflects the original build.
      exploreBufferRef.current = {
        items: saved.items,
        sourceIds: Array.isArray(saved.sourceIds) ? saved.sourceIds : [],
        builtAt: Number(saved.builtAt) || Date.now(),
        expiresAt: saved.expiresAt ?? Date.now() + EXPLORE_CACHE_TTL_MS,
        lastError: saved.lastError ?? null,
      };
      console.log(`[Explore Buffer] Loaded persisted catalog: ${saved.items.length} series from SQLite (serving /browse instantly).`);
    } else {
      console.log('[Explore Buffer] No persisted catalog found; warming from live sources.');
    }
  } catch (e: any) {
    console.warn('[Explore Buffer] Could not load persisted catalog:', e?.message);
  }

  // Warm once on startup (non-blocking, so launch stays instant), then refresh on an interval.
  refreshExploreCatalog(true).catch((e) => console.error('[Explore Buffer] Startup warm-up failed:', e?.message));
  exploreRefreshTimer = setInterval(() => {
    refreshExploreCatalog(false).catch((e) => console.error('[Explore Buffer] Interval refresh failed:', e?.message));
  }, EXPLORE_REFRESH_INTERVAL_MS);
  const minutes = Math.round(EXPLORE_REFRESH_INTERVAL_MS / 60000);
  console.log(`[Explore Buffer] Scheduled automatic catalog refresh every ${minutes} min (warming ${EXPLORE_WARM_PAGES} page(s)/source).`);
}

// =====================================================================
// SOURCE AUDIT ENGINE — identify & disable sources that have no series
// =====================================================================
const sourceAuditStatus = new Map<string, { seriesCount: number; checkedAt: string }>();
let sourceAuditRunning = false;

// Count how many series a source can currently serve (static + live probe).
export async function probeSourceSeriesCount(sourceDef: SourceDefinition): Promise<number> {
  // 1. Static signals that already give this source content (no network needed).
  const domain = sourceDef.baseUrl.replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase();
  const nameL = sourceDef.name.toLowerCase();
  const idL = sourceDef.id.toLowerCase();

  const staticCount = SqliteDb.getAllManga().filter((m: any) => {
    const n = (m.sourceName || '').toLowerCase();
    const u = (m.sourceUrl || '').toLowerCase();
    return n.includes(idL) || n.includes(nameL) || (u || '').includes(domain);
  }).length;

  if (staticCount > 0) return staticCount;

  // 2. Live probe of the source catalog (fast, short timeout).
  try {
    const result = await getSourcePopularSeries(sourceDef, 1, 2);
    const items = Array.isArray(result) ? result : ((result?.items as any[]) || []);
    return items.length;
  } catch {
    return 0;
  }
}

// Audit every source (optionally a subset) and disable those that serve zero series.
export async function auditAndDisableEmptySources(
  concurrency = 8,
  sourceList: SourceDefinition[] = KOTATSU_SOURCES
): Promise<{ disabled: string[]; keptCount: number; total: number; alreadyRunning: boolean }> {
  if (sourceAuditRunning) return { disabled: [], keptCount: 0, total: sourceList.length, alreadyRunning: true };
  sourceAuditRunning = true;

  const pending = sourceList.filter((s) => !disabledSourceIds.has(s.id));
  const disabled: string[] = [];
  let checkedCount = 0;

  const worker = async () => {
    let src: SourceDefinition | undefined;
    while ((src = pending.shift()) !== undefined) {
      const count = await probeSourceSeriesCount(src);
      checkedCount++;
      sourceAuditStatus.set(src.id, { seriesCount: count, checkedAt: new Date().toISOString() });
      if (count === 0) {
        disabledSourceIds.add(src.id);
        disabled.push(src.id);
      }
    }
  };

  const n = Math.max(1, Math.min(concurrency, pending.length));
  await Promise.all(Array.from({ length: n }, worker));

  syncConfig.disabledSources = Array.from(disabledSourceIds);
  saveDatabaseToDisk();
  sourceAuditRunning = false;
  console.log(`[Source Audit] Checked ${checkedCount} sources — disabled ${disabled.length} with zero series.`);
  return { disabled, keptCount: checkedCount - disabled.length, total: checkedCount, alreadyRunning: false };
}

// POST /api/scrape/audit-sources — run the audit and disable empty sources
app.post("/api/scrape/audit-sources", async (_req, res) => {
  try {
    const concurrency = Math.min(20, Math.max(1, Number(_req.query.concurrency) || 8));
    const result = await auditAndDisableEmptySources(concurrency);
    return res.json(result);
  } catch (e: any) {
    return res.status(500).json({ error: "Source audit failed", details: e.message });
  }
});

// GET /api/scrape/audit-status — streaming progress of the audit + last results
app.get("/api/scrape/audit-status", (_req, res) => {
  res.json({
    running: sourceAuditRunning,
    disabledCount: disabledSourceIds.size,
    status: Array.from(sourceAuditStatus.entries()).map(([id, s]) => ({ id, ...s })),
  });
});

// Kotatsu Multi-Source Live Search Endpoint (Enhanced)
app.get("/api/kotatsu/search", async (req, res) => {
  const sourceId = (req.query.sourceId as string) || 'mangadex';
  const query = ((req.query.q as string) || '').trim();
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(Number(req.query.limit) || 24, 100);
  const offset = (page - 1) * limit;
  const lang = (req.query.lang as string || 'en').toLowerCase();
  const langFilter = lang === 'all' ? '' : `&availableTranslatedLanguage[]=${lang}`;

  // MangaDex is a metadata-only background DB — never resolve to it as a reading source.
  let sourceDef = KOTATSU_SOURCES.find((s) => s.id === sourceId && s.id !== 'mangadex');
  if (!sourceDef) {
    sourceDef =
      KOTATSU_SOURCES.find((s) => s.id !== 'mangadex' && !disabledSourceIds.has(s.id) && isSourceAlive(s.id)) ||
      KOTATSU_SOURCES.find((s) => s.id !== 'mangadex');
  }
  if (!sourceDef) return res.json([]);

  try {
    // ── 2. No query → serve source-specific popular series ───────────────
    if (!query) {
      const { items: popular, totalCount } = await getSourcePopularSeries(sourceDef, page, limit);
      const enriched = await enrichWithMangaDexMetadata(popular);
      res.setHeader('X-Total-Count', String(totalCount));
      res.setHeader('X-Total-Pages', String(Math.ceil(totalCount / limit)));
      return res.json(enriched);
    }

    // ── 3. Live HTML scraping for Madara/MangaThemesia/FoolSlide/WPComics ──
    let searchUrl: string;
    if (sourceDef.engineType === 'madara' || sourceDef.engineType === 'wpcomics') {
      searchUrl = `${sourceDef.baseUrl}/?s=${encodeURIComponent(query)}&post_type=wp-manga`;
    } else if (sourceDef.engineType === 'foolslide') {
      searchUrl = `${sourceDef.baseUrl}/search?search=${encodeURIComponent(query)}`;
    } else {
      searchUrl = `${sourceDef.baseUrl}/?s=${encodeURIComponent(query)}`;
    }

    const pageRes = await fetch(searchUrl, {
      signal: AbortSignal.timeout(10000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    if (pageRes.ok) {
      const htmlText = await pageRes.text();
      const results: any[] = [];
      const allImgs: string[] = [];
      const imgRx = /<img[^>]+src=["']([^"']+)["'][^>]*/gi;
      let imgM;
      while ((imgM = imgRx.exec(htmlText)) !== null) {
        const src = imgM[1];
        if (src && /\.(jpg|png|webp)/i.test(src) && !/logo|avatar|banner|icon/i.test(src)) {
          allImgs.push(src.startsWith('http') ? src : `${sourceDef.baseUrl}${src}`);
        }
      }
      const linkRx = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]{3,120})<\/a>/gi;
      let lm;
      while ((lm = linkRx.exec(htmlText)) !== null && results.length < 18) {
        const href = lm[1];
        const title = lm[2].trim();
        if (
          href && title &&
          !/nav|menu|home|login|register|sign|account|cookie|privacy|about/i.test(title) &&
          /\/(manga|series|title|manhwa|manhua|comic|webtoon)\//i.test(href)
        ) {
          results.push({
            id: generateSourceScrapeId(`kotatsu_${sourceDef.id}`, href),
            title,
            sourceUrl: href.startsWith('http') ? href : `${sourceDef.baseUrl}${href}`,
            coverImage: allImgs[results.length] ||
              'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=400&auto=format&fit=crop&q=80',
            sourceName: sourceDef.name,
            genres: ['Action'],
          });
        }
      }
      if (results.length > 0) return res.json(await enrichWithMangaDexMetadata(results));
    }

    // ── 4. Fallback: query local database strictly for items belonging to this source ──
    const targetId = sourceDef.id.toLowerCase();
    const targetName = sourceDef.name.toLowerCase();
    const targetDomain = sourceDef.baseUrl.replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase();

    const fallback = SqliteDb.getAllManga()
      .filter((m: any) => {
        const sName = (m.sourceName || '').toLowerCase();
        const sUrl = (m.sourceUrl || '').toLowerCase();
        const matchesSource = sName.includes(targetId) || sName.includes(targetName) || (sUrl && sUrl.includes(targetDomain));
        const matchesQuery = !query || m.title.toLowerCase().includes(query.toLowerCase());
        return matchesSource && matchesQuery;
      })
      .slice(0, 12)
      .map((m: any) => ({
        id: m.id, title: m.title,
        sourceUrl: m.sourceUrl || sourceDef.baseUrl,
        coverImage: m.coverImage,
        sourceName: sourceDef.name,
        genres: m.genres || [], latestChapter: m.latestChapter, type: m.type,
      }));
    return res.json(await enrichWithMangaDexMetadata(fallback));

  } catch (err: any) {
    console.error(`[Kotatsu Engine] Error for source ${sourceId}:`, err.message);
    return res.json([]);
  }
});

// Kotatsu Complete Database Sync & Smart Merging Endpoint
app.post("/api/kotatsu/sync-database", (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Invalid payload: 'items' array required." });
  }

  const result = integrateKotatsuSourcesAndMerge(items);
  res.json({
    success: true,
    message: `Kotatsu sync complete: ${result.newCount} new added, ${result.mergedCount} merged, ${result.uncertainCount} uncertain candidates for Duplicate Merger.`,
    totalTracked: mangaDatabase.length,
    ...result,
  });
});

// Fix #8: Multi-source combined search — queries all enabled sources simultaneously
app.get("/api/kotatsu/search-all", async (req, res) => {
  const query = ((req.query.q as string) || '').trim();
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(Number(req.query.limit) || 24, 50);
  const typeFilter = (req.query.type as string) || ''; // Fix #10: basic type filter (manhwa/manhua/manga)

  const enabledSources = KOTATSU_SOURCES.filter(s => s.id !== 'mangadex' && !disabledSourceIds.has(s.id) && isSourceAlive(s.id));
  const results: any[] = [];
  
  // Query first 5 enabled sources in parallel
  const sourcesToQuery = enabledSources.slice(0, 5);
  const sourceResults = await Promise.allSettled(
    sourcesToQuery.map(async (source) => {
      try {
        // Internal call: invoke the handler logic directly instead of HTTP loop
        const items = await getSourcePopularSeries(source, page, Math.ceil(limit/3));
        return Array.isArray(items) ? items : (items?.items || []).map((it: any) => ({ ...it, sourceName: source.name }));
      } catch { return []; }
    })
  );

  for (const r of sourceResults) {
    if (r.status === 'fulfilled') results.push(...r.value);
  }

  // Deduplicate by title
  const seen = new Set<string>();
  const merged = results.filter(item => {
    const key = (item.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    // Fix #10: type filter
    if (typeFilter && item.type && item.type !== typeFilter) return false;
    return true;
  });

  const enriched = await enrichWithMangaDexMetadata(merged.slice(0, limit));
  res.setHeader('X-Total-Count', String(merged.length));
  res.json(enriched);
});

// Live Domain Sources Registry — dynamically derived from ENGINE_SOURCE_REGISTRY.
// Each entry maps a domainId to a URL-matching domain substring.
// Rebuilt via buildLiveDomainsFromRegistry() at startup and whenever the registry changes.

/** Get the current live domain list. Always reflects the latest engine registry state. */
function getLiveDomains(): { id: string; domain: string; name: string }[] {
  return buildLiveDomainsFromRegistry();
}

// Match the live-domain registry against a URL, preferring the LONGEST matching
// domain so that overlapping substrings resolve correctly (e.g. "manhwa18.cc"
// must match manhwa18cc, not manhwa18; "manhuaplus.org" must match manhuaplusorg).
function matchLiveDomain(url: string): { id: string; domain: string; name: string } | undefined {
  const lower = (url || '').toLowerCase();
  let best: { id: string; domain: string; name: string } | undefined;
  for (const d of getLiveDomains()) {
    if (lower.includes(d.domain.toLowerCase())) {
      if (!best || d.domain.length > best.domain.length) best = d;
    }
  }
  return best;
}

// Fix #6 + #22: Cloudflare / Bot Detection & Source Health Monitoring
// Matches Kotatsu-Redo's CloudFlareHelper.checkResponseForProtection() pattern
function detectBlockedResponse(html: string, statusCode: number): 'cloudflare' | 'captcha' | 'blocked' | 'none' {
  if (statusCode === 403 || statusCode === 503 || statusCode === 429) {
    if (/Checking your browser|cf-browser-verification|challenge-platform|Attention Required.*Cloudflare|Just a moment|DDoS protection|Please turn JavaScript on/i.test(html)) return 'cloudflare';
  }
  if (statusCode === 403) {
    if (/captcha|recaptcha|hcaptcha|turnstile|cf-turnstile/i.test(html)) return 'captcha';
    if (/blocked|access denied|ip has been banned/i.test(html)) return 'blocked';
  }
  return 'none';
}

interface SourceHealth {
  id: string;
  lastChecked: number;
  lastStatus: 'ok' | 'degraded' | 'blocked' | 'down';
  consecutiveFailures: number;
  failureReason?: string;
  circuitState?: CircuitState;
}
const sourceHealthMap = new Map<string, SourceHealth>();
function updateSourceHealth(sourceId: string, html: string | null, statusCode: number, error?: string) {
  let e = sourceHealthMap.get(sourceId);
  if (!e) {
    e = { id: sourceId, lastChecked: Date.now(), lastStatus: 'ok', consecutiveFailures: 0 };
    sourceHealthMap.set(sourceId, e);
  }
  e.lastChecked = Date.now();
  if (error || statusCode >= 400) {
    e.consecutiveFailures++;
    e.failureReason = error || `HTTP ${statusCode}`;
    if (e.consecutiveFailures >= 5) e.lastStatus = 'down';
    else if (e.consecutiveFailures >= 2) e.lastStatus = 'degraded';
    sourceCircuitBreaker.recordFailure(sourceId, statusCode, e.failureReason);
  } else if (html) {
    const bt = detectBlockedResponse(html, statusCode);
    if (bt !== 'none') {
      e.consecutiveFailures++;
      e.lastStatus = 'blocked';
      e.failureReason = `Source returned ${bt} challenge`;
      sourceCircuitBreaker.trip(sourceId, e.failureReason);
    } else {
      e.consecutiveFailures = 0;
      e.lastStatus = 'ok';
      e.failureReason = undefined;
      sourceCircuitBreaker.recordSuccess(sourceId);
    }
  } else {
    e.consecutiveFailures = 0;
    e.lastStatus = 'ok';
    e.failureReason = undefined;
    sourceCircuitBreaker.recordSuccess(sourceId);
  }
  e.circuitState = sourceCircuitBreaker.getState(sourceId).state;
}

// Fix #5: Per-Source Cookie Jar for session persistence
class SourceCookieJar {
  private cookies = new Map<string, Map<string, string>>();
  setCookies(sid: string, headers: string[]) {
    if (!this.cookies.has(sid)) this.cookies.set(sid, new Map());
    const jar = this.cookies.get(sid)!;
    for (const h of headers) { const p = h.split(';')[0].split('='); if (p.length >= 2) jar.set(p[0].trim(), p.slice(1).join('=')); }
  }
  getCookieHeader(sid: string): string {
    const jar = this.cookies.get(sid); if (!jar || jar.size === 0) return '';
    return Array.from(jar.entries()).map(([k,v]) => `${k}=${v}`).join('; ');
  }
  clear(sid?: string) { if (sid) this.cookies.delete(sid); else this.cookies.clear(); }
}
const sourceCookieJar = new SourceCookieJar();

const DOMAIN_MIRRORS: Record<string, string> = {
  // Asura's canonical domain is asurascans.com; asuracomic.net now 301-redirects
  // to the asurascans.com homepage (and ALL series URLs are lost in that redirect).
  'asuracomic.net': 'asurascans.com',
  'asurascans.org': 'asurascans.com',
  'aquamanga.com': 'aquareader.net',
  'aquamanga.org': 'aquareader.net',
  'flamescans.org': 'flamecomics.xyz',
  'flamescans.com': 'flamecomics.xyz',
  // manhwa18.net uses the same custom theme as manhwa18.com. manhwa18.cc/.org are
  // SEPARATE Madara sites (per Kotatsu) and must NOT be rewritten to manhwa18.com.
  'manhwa18.net': 'manhwa18.com',
};


// Resolve a series slug from an Asura page URL, stripping a trailing rotating
// hash suffix (e.g. `/comics/omniscient-readers-viewpoint-24e56064` ->
// `omniscient-readers-viewpoint`).
function extractAsuraSlug(rawTargetUrl: string): string | null {
  const targetUrl = rawTargetUrl.replace(/\/$/, '');
  let slug = targetUrl.split('/').pop() || '';
  if (targetUrl.includes('/manga/') || targetUrl.includes('/series/') || targetUrl.includes('/comics/')) {
    const parts = targetUrl.split('/');
    const idx = parts.findIndex((p) => p === 'manga' || p === 'series' || p === 'comics');
    if (idx !== -1 && parts[idx + 1]) {
      slug = parts[idx + 1];
    }
  }
  if (!slug) return null;
  return slug.replace(ASURA_SLUG_TOKEN_RX, '') || slug;
}

interface ResolvedChapter {
  number: number;
  id: string;
  slug: string;
  title: string;
  url: string;
  pageCount: number;
}

const ASURA_API_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
  'Origin': 'https://asurascans.com',
  'Referer': 'https://asurascans.com/',
};

// Asura appends a site-wide rotating token to every series slug
// (`/comics/<slug>-00dcbf97`). It changes on every redeploy, so it must never be
// hard-coded — the API accepts the bare slug (the server 302s stale tokens away).
const ASURA_SLUG_TOKEN_RX = /-[0-9a-f]{8}$/i;

/** Normalize Asura chapter page payloads (string URLs or {url}/ {src} objects). */
function normalizeAsuraPageList(rawPages: unknown): string[] {
  if (!Array.isArray(rawPages)) return [];
  const out: string[] = [];
  for (const p of rawPages) {
    let url = '';
    if (typeof p === 'string') url = p.trim();
    else if (p && typeof p === 'object') {
      const o = p as Record<string, unknown>;
      url = String(o.url || o.src || o.image || o.path || '').trim();
    }
    if (!url) continue;
    if (url.startsWith('//')) url = 'https:' + url;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      // relative CDN path
      url = url.startsWith('/') ? `https://gg.asuracomic.net${url}` : `https://gg.asuracomic.net/${url}`;
    }
    out.push(url);
  }
  return Array.from(new Set(out));
}

// Fetch a series' REAL chapter list from the Asura Scans official API (newest-first).
// The API resolves series by their BARE slug (token stripped); the old code tried
// hard-coded token variants (-00dcbf97 / -b8509c2a) which go stale and fail.
async function fetchAsuraChapterList(rawTargetUrl: string): Promise<{ chapters: ResolvedChapter[]; matchedSlug: string | null }> {
  const targetUrl = normalizeLiveTargetUrl(rawTargetUrl).replace(/\/$/, '');
  let rawSlug = targetUrl.split('/').pop() || '';
  if (targetUrl.includes('/manga/') || targetUrl.includes('/series/') || targetUrl.includes('/comics/')) {
    const parts = targetUrl.split('/');
    const idx = parts.findIndex((p) => p === 'manga' || p === 'series' || p === 'comics');
    if (idx !== -1 && parts[idx + 1]) {
      rawSlug = parts[idx + 1];
    }
  }
  if (!rawSlug) return { chapters: [], matchedSlug: null };

  const cleaned = rawSlug.replace(ASURA_SLUG_TOKEN_RX, '') || rawSlug;
  const slugsToTry = Array.from(new Set([cleaned, rawSlug]));

  for (const s of slugsToTry) {
    try {
      const listRes = await fetch(`https://api.asurascans.com/api/series/${s}/chapters`, {
        headers: ASURA_API_HEADERS,
        signal: AbortSignal.timeout(15000),
      });
      if (!listRes.ok) {
        console.warn(`[Asura API Engine] Chapter list HTTP ${listRes.status} for slug "${s}"`);
        continue;
      }
      const listData = await listRes.json();
      if (listData && Array.isArray(listData.data) && listData.data.length > 0) {
        const chapters: ResolvedChapter[] = listData.data
          .map((c: any) => ({
            number: Number(c.number ?? 0),
            id: String(c.id),
            slug: String(c.slug || ''),
            title: c.title ? `Chapter ${c.number} - ${c.title}` : `Chapter ${c.number}`,
            url: c.slug ? `https://asurascans.com/series/${s}/chapters/${c.slug}` : '',
            pageCount: Number(c.page_count) || 12,
          }))
          .filter((c: ResolvedChapter) => c.number > 0 && c.slug);
        if (chapters.length > 0) return { chapters, matchedSlug: s };
      }
    } catch (e) {
      console.warn(`[Asura API Engine] Chapter list fetch failed for slug "${s}":`, (e as Error).message);
    }
  }
  return { chapters: [], matchedSlug: null };
}

// Exact chapter match by number, falling back to an ANCHORED slug match (never a substring
// match — a substring like `.includes("5")` wrongly matched chapters 255, 305, etc.).
function matchResolvedChapter(chapters: ResolvedChapter[], chapterNumber: number): ResolvedChapter | undefined {
  const exact = chapters.find((c) => c.number === chapterNumber);
  if (exact) return exact;
  // Anchored: matches `chapter-255`, `255`, `ch255`, `255.1`, but NOT a hash that merely contains "255".
  const rx = new RegExp(`(?:^|[_-]|ch(?:apter)?[_-]?)${chapterNumber}(?:$|[_.-])`, 'i');
  return chapters.find((c) => c.slug && rx.test(c.slug));
}
// Apply domain mirrors + manhwa18 path normalization to a live source URL.
function normalizeLiveTargetUrl(rawTargetUrl: string): string {
  let targetUrl = (rawTargetUrl || '').trim();
  if (!targetUrl) return targetUrl;
  for (const [oldDomain, newDomain] of Object.entries(DOMAIN_MIRRORS)) {
    if (targetUrl.includes(oldDomain)) {
      targetUrl = targetUrl.replace(new RegExp(oldDomain.replace(/\./g, '\\.'), 'gi'), newDomain);
      break;
    }
  }
  // manhwa18.com historically used /manhwa/, /webtoon/, /read/ — canonical is /manga/
  if (/manhwa18\.(com|net)/i.test(targetUrl)) {
    targetUrl = targetUrl
      .replace(/\/webtoon\//gi, '/manga/')
      .replace(/\/read\//gi, '/manga/')
      .replace(/\/manhwa\//gi, '/manga/');
  }
  // Drop trailing slash so slug extraction is stable
  targetUrl = targetUrl.replace(/\/+$/, '');
  return targetUrl;
}

/** One-time (and idempotent) rewrite of stale live-source URLs stored in SQLite. */
function migrateStaleSourceUrlsInDatabase(): number {
  let changed = 0;
  for (const m of mangaDatabase) {
    let dirty = false;
    if (m.sourceUrl && typeof m.sourceUrl === 'string') {
      const next = normalizeLiveTargetUrl(m.sourceUrl);
      if (next && next !== m.sourceUrl) {
        m.sourceUrl = next;
        dirty = true;
      }
    }
    if (Array.isArray(m.availableSources)) {
      for (const s of m.availableSources) {
        if (s?.sourceUrl) {
          const next = normalizeLiveTargetUrl(s.sourceUrl);
          if (next && next !== s.sourceUrl) {
            s.sourceUrl = next;
            dirty = true;
          }
        }
      }
    }
    if (dirty) {
      try { syncAddOrUpdateManga(m); } catch { /* continue */ }
      changed++;
    }
  }
  if (changed > 0) {
    console.log(`[Migration] Rewrote stale source URLs on ${changed} series (asuracomic→asurascans, manhwa→manga, …).`);
  }
  return changed;
}

const UA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
};

// ---- Flame Comics: resolve the Next.js build context + series id -----------------------------
async function fetchFlameSeriesContext(targetUrl: string): Promise<{ buildId: string; seriesId: string; chapters: any[] } | null> {
  try {
    const homeRes = await fetch("https://flamecomics.xyz/", { headers: UA_HEADERS });
    if (!homeRes.ok) return null;
    const homeHtml = await homeRes.text();
    const buildIdMatch = homeHtml.match(/\/_next\/static\/([^/]+)\/_buildManifest\.js/);
    const buildId = buildIdMatch ? buildIdMatch[1] : null;
    if (!buildId) return null;

    const browseRes = await fetch(`https://flamecomics.xyz/_next/data/${buildId}/browse.json`, { headers: UA_HEADERS });
    if (!browseRes.ok) return null;
    const browseJson = await browseRes.json();
    const seriesList = browseJson.pageProps?.series || [];
    const rawSlug = targetUrl.split('/').pop() || '';
    const matchedSeries = seriesList.find((s: any) => {
      const sId = String(s.series_id || s.id);
      const sTitle = (s.title?.toLowerCase().replace(/[^a-z0-9]/g, '') || '');
      const targetNorm = rawSlug.toLowerCase().replace(/[^a-z0-9]/g, '');
      // 1) Exact numeric series id (Kotatsu's approach — unambiguous).
      if (sId === rawSlug) return true;
      // 2) Exact normalized-title equality.
      if (targetNorm && sTitle === targetNorm) return true;
      // 3) Substring fallback — only safe for reasonably long, unambiguous slugs
      //    (a short slug like "solo" would otherwise match "Solo Leveling").
      return targetNorm.length >= 5 && !!sTitle && sTitle.includes(targetNorm);
    });
    if (!matchedSeries) return null;
    const seriesId = matchedSeries.series_id || matchedSeries.id;

    const seriesRes = await fetch(`https://flamecomics.xyz/_next/data/${buildId}/series/${seriesId}.json`, { headers: UA_HEADERS });
    if (!seriesRes.ok) return null;
    const seriesData = await seriesRes.json();
    const chapters = seriesData.pageProps?.chapters || [];
    return { buildId, seriesId, chapters };
  } catch (e) {
    return null;
  }
}

function mapFlameChapters(rawChapters: any[], seriesId: string): ResolvedChapter[] {
  return rawChapters
    .map((c: any) => {
      const num = Number(c.chapter ?? c.number ?? parseFloat((c.title || '').match(/\d+(?:\.\d+)?/)?.[0] ?? '0'));
      const token = String(c.token || c.chapter_id || c.id || '');
      return {
        number: Number.isFinite(num) ? num : 0,
        id: token,
        slug: token,
        title: c.title ? `Chapter ${num} - ${c.title}` : `Chapter ${num}`,
        url: token ? `https://flamecomics.xyz/series/${seriesId}/${token}` : '',
        pageCount: Number(c.pages || c.page_count) || 12,
      };
    })
    .filter((c: ResolvedChapter) => c.number > 0 && c.slug);
}

async function fetchFlameChapterList(targetUrl: string): Promise<ResolvedChapter[]> {
  const ctx = await fetchFlameSeriesContext(targetUrl);
  if (!ctx) return [];
  return mapFlameChapters(ctx.chapters, ctx.seriesId);
}

// ---- Dynasty Scans: enumerate real chapters from the series page -----------------------------
async function fetchDynastyChapterList(targetUrl: string): Promise<ResolvedChapter[]> {
  try {
    const seriesRes = await fetch(targetUrl, { headers: UA_HEADERS });
    if (!seriesRes.ok) return [];
    const html = await seriesRes.text();
    const chLinkRx = /<a[^>]+href=["'](\/chapters\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    const out: ResolvedChapter[] = [];
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = chLinkRx.exec(html)) !== null) {
      const href = m[1];
      const text = m[2].replace(/<[^>]+>/g, '').trim();
      if (!href || /added|tags|search/i.test(href)) continue;
      const numM = (href + ' ' + text).match(/(?:chapter|ch\.?|ch)[^\d]*(\d+(?:\.\d+)?)/i);
      if (!numM) continue;
      const num = parseFloat(numM[1]);
      if (!Number.isFinite(num) || num <= 0) continue;
      const abs = `https://dynasty-scans.com${href}`;
      if (seen.has(abs)) continue;
      seen.add(abs);
      out.push({ number: num, id: abs, slug: href, title: `Chapter ${num}`, url: abs, pageCount: 0 });
    }
    return out;
  } catch (e) {
    return [];
  }
}

// ---- Generic: enumerate chapter links with numbers from any series page ----------------------
async function fetchGenericChapterList(targetUrl: string): Promise<ResolvedChapter[]> {
  const origin = new URL(targetUrl).origin;
  const reqHeaders = { ...UA_HEADERS, 'Referer': origin + '/' };
  try {
    const bypassRes = await fetchWithChallengeBypass(targetUrl, {
      headers: reqHeaders,
      enableCloudflareBypass: appSettings.enableCloudflareBypass,
      flareSolverrUrl: appSettings.flareSolverrUrl,
      captchaSolverEnabled: appSettings.captchaSolverEnabled,
      captchaApiKey: appSettings.captchaApiKey,
      sourceId: origin,
      onCookieUpdate: (sid, cookies) => sourceCookieJar.setCookies(sid, cookies),
    });
    if (!bypassRes.ok || !bypassRes.html) return [];
    const sHtml = bypassRes.html;
    const chLinkRx = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    const out: ResolvedChapter[] = [];
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = chLinkRx.exec(sHtml)) !== null) {
      const href = m[1];
      const text = m[2].replace(/<[^>]+>/g, '').trim();
      if (!href || /^(#|javascript:|mailto:|tel:)/i.test(href)) continue;
      if (!/chapter|chap|ch/i.test(href) && !/chapter|chap|ch/i.test(text)) continue;
      const numM = (href + ' ' + text).match(/(?:chapter|chap|ch)[^\d]*(\d+(?:\.\d+)?)/i);
      if (!numM) continue;
      const num = parseFloat(numM[1]);
      if (!Number.isFinite(num) || num <= 0) continue;
      const abs = href.startsWith('http') ? href : `${origin}${href.startsWith('/') ? '' : '/'}${href}`;
      if (seen.has(abs)) continue;
      seen.add(abs);
      out.push({ number: num, id: abs, slug: abs, title: `Chapter ${num}`, url: abs, pageCount: 0 });
    }
    return out;
  } catch (e) {
    return [];
  }
}

// ============================================================================
// SOURCE ENGINE REGISTRY — Maps domainId → engine type for dedicated extractors
// Derived from Kotatsu-Parsers (MadaraParser, MangaReaderParser, etc.)
// ============================================================================

type SourceEngine = 'madara' | 'manhwa18' | 'mangareader' | 'manga18' | 'hotcomics' | 'mangafire' | 'batoto' | 'comickfun' | 'custom';

interface EngineSourceConfig {
  id: string; name: string; domain: string; engine: SourceEngine;
  lang: string; isNsfw: boolean;
  madaraDatePattern?: string; madaraPageSize?: number;
  // Madara per-site overrides (mirrors Kotatsu's MadaraParser subclass overrides)
  madaraWithoutAjax?: boolean;      // chapters already inline, no AJAX call
  madaraSelectTestAsync?: string;   // node present => inline chapter list
  madaraSelectChapter?: string;     // chapter row selector (default li.wp-manga-chapter)
  madaraSelectBodyPage?: string;    // page container selector (default div.reading-content)
  madaraPostReq?: boolean;          // use admin-ajax manga_get_chapters (default true)
}

/** Statically curated sources with hand-tuned per-site overrides.
 *  These take priority over auto-generated entries from catalog.json. */
const CURATED_ENGINE_SOURCES: EngineSourceConfig[] = [
  // ── Madara Engine (WP-Manga theme) — covers 50+ sources ──────────────────
  { id: 'manhwa18',    name: 'Manhwa18',          domain: 'manhwa18.com',    engine: 'manhwa18', lang: 'en', isNsfw: true },
  { id: 'manhwa18cc',  name: 'Manhwa18.cc',        domain: 'manhwa18.cc',     engine: 'madara', lang: 'en', isNsfw: true,
    madaraSelectTestAsync: 'ul.row-content-chapter', madaraSelectChapter: 'li.a-h', madaraSelectBodyPage: 'div.read-content' },
  { id: 'aquamanga',   name: 'Aqua Manga',         domain: 'aquareader.net', engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'manhuaplus',  name: 'Manhua Plus',        domain: 'manhuaplus.com',  engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'manhuaplusorg', name: 'ManhuaPlus.org',   domain: 'manhuaplus.org',  engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'harimanga',   name: 'Hari Manga',         domain: 'harimanga.me',    engine: 'madara', lang: 'en', isNsfw: false, madaraPageSize: 10 },
  { id: 'anisascans',  name: 'Anisa Scans',        domain: 'anisascans.in',   engine: 'madara', lang: 'en', isNsfw: false, madaraDatePattern: 'dd MMM, yyyy' },
  { id: 'adultwebtoon', name: 'Adult Webtoon',     domain: 'adultwebtoon.com', engine: 'madara', lang: 'en', isNsfw: true },
  { id: 'mangaread',   name: 'MangaRead',          domain: 'www.mangaread.org', engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'manhwabuddy', name: 'Manhwa Buddy',       domain: 'manhwabuddy.com', engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'manhuafast',  name: 'Manhua Fast',        domain: 'manhuafast.com',  engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'kunmanga',    name: 'Kun Manga',          domain: 'kunmanga.com',    engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'topmanhua',   name: 'Top Manhua',         domain: 'topmanhua.com',   engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'manhwaclan',  name: 'Manhwa Clan',        domain: 'manhwaclan.com',  engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'weebcentral', name: 'Weeb Central',       domain: 'weebcentral.com', engine: 'custom', lang: 'en', isNsfw: false },
  { id: 'atsumoe',     name: 'Atsu Moe',           domain: 'atsu.moe',        engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'demonicscans', name: 'Demonic Scans',     domain: 'demonicscans.org', engine: 'custom', lang: 'en', isNsfw: false },
  { id: 'beehentai',   name: 'BeeHentai',          domain: 'beehentai.com',   engine: 'madara', lang: 'en', isNsfw: true },
  // ── MangaReader Engine ────────────────────────────────────────────────────
  { id: 'manhuascan',  name: 'ManhuaScan',         domain: 'manhuascan.us',   engine: 'mangareader', lang: 'en', isNsfw: true },
  { id: 'ravenscans',  name: 'Raven Scans',        domain: 'ravenscans.com',  engine: 'mangareader', lang: 'en', isNsfw: false },
  { id: 'luminous',    name: 'Luminous Scans',     domain: 'luminousscans.com', engine: 'mangareader', lang: 'en', isNsfw: false },
  { id: 'night',       name: 'Night Scans',        domain: 'nightscans.com',  engine: 'mangareader', lang: 'en', isNsfw: false },
  { id: 'hentai20',    name: 'Hentai20',           domain: 'hentai20.com',    engine: 'mangareader', lang: 'en', isNsfw: true },
  // ── HotComics Engine ──────────────────────────────────────────────────────
  { id: 'hotcomics',   name: 'HotComics',          domain: 'hotcomics.net',   engine: 'hotcomics', lang: 'en', isNsfw: true },
  { id: 'daycomics',   name: 'DayComics',          domain: 'daycomics.com',   engine: 'hotcomics', lang: 'en', isNsfw: true },
  // ── Custom API Sources ────────────────────────────────────────────────────
  { id: 'batoto',      name: 'Bato.to',            domain: 'bato.to',         engine: 'batoto', lang: 'en', isNsfw: false },
  { id: 'comickfun',   name: 'ComickFun',          domain: 'comick.fun',      engine: 'comickfun', lang: 'en', isNsfw: false },
  { id: 'comick',      name: 'ComicK',             domain: 'comick.io',       engine: 'comickfun', lang: 'en', isNsfw: false },
];

// ============================================================================
// DYNAMIC ENGINE REGISTRY — auto-populated from catalog.json at startup
// Merges hand-tuned CURATED_ENGINE_SOURCES with auto-generated entries for
// every madara/mangathemesia source in the catalog, closing the 97% coverage gap.
// ============================================================================
const ENGINE_SOURCE_REGISTRY: EngineSourceConfig[] = [...CURATED_ENGINE_SOURCES];
const curatedEngineIds = new Set(CURATED_ENGINE_SOURCES.map(s => s.id));

/** Derive a clean domain substring from a baseUrl for URL matching. */
function domainFromBaseUrl(baseUrl: string): string {
  try { return new URL(baseUrl).hostname.replace(/^www\./, ''); }
  catch { return baseUrl.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, ''); }
}

/** One-time sync: append auto-generated engine configs for every catalog source
 *  whose engineType is madara or mangathemesia and that isn't already curated. */
function syncEngineRegistryFromCatalog(): void {
  const catalog = ALL_SOURCES_CATALOG;
  let added = 0;
  for (const src of catalog) {
    if (curatedEngineIds.has(src.id)) continue;
    const domain = domainFromBaseUrl(src.baseUrl);
    if (!domain) continue;
    if (src.engineType === 'madara') {
      ENGINE_SOURCE_REGISTRY.push({
        id: src.id, name: src.name, domain, engine: 'madara',
        lang: src.lang, isNsfw: src.isNsfw,
      });
      added++;
    } else if (src.engineType === 'mangathemesia') {
      ENGINE_SOURCE_REGISTRY.push({
        id: src.id, name: src.name, domain, engine: 'madara',
        lang: src.lang, isNsfw: src.isNsfw,
        madaraSelectTestAsync: 'ul.row-content-chapter',
        madaraSelectChapter: 'li',
      });
      added++;
    }
  }
  if (added > 0) console.log(`[Engine Registry] Auto-registered ${added} sources from catalog (madara + mangathemesia). Total: ${ENGINE_SOURCE_REGISTRY.length}`);
}

/** Rebuild the LIVE_DOMAINS array from the current ENGINE_SOURCE_REGISTRY. */
function buildLiveDomainsFromRegistry(): { id: string; domain: string; name: string }[] {
  return ENGINE_SOURCE_REGISTRY.map(e => ({ id: e.id, domain: e.domain, name: e.name }));
}

// ── Run sync at module init (catalog.json is already loaded by now) ──
syncEngineRegistryFromCatalog();

function getEngineConfig(domainId: string): EngineSourceConfig | undefined {
  return ENGINE_SOURCE_REGISTRY.find((s) => s.id === domainId);
}
// ============================================================================
// MADARA ENGINE EXTRACTOR (WP-Manga / Madara Theme)
// Based on Kotatsu's MadaraParser.kt — covers 500+ auto-registered sources
// Now with Cloudflare bypass and exponential-backoff retry (max 3 attempts).
// ============================================================================

async function fetchMadaraChapterList(targetUrl: string, config: EngineSourceConfig): Promise<ResolvedChapter[]> {
  if (!sourceCircuitBreaker.canAttempt(config.id)) {
    console.warn(`[Madara Engine] Fast-failing ${config.name} (circuit OPEN)`);
    return [];
  }
  const origin = new URL(targetUrl).origin;
  const headers = { ...UA_HEADERS, 'Referer': origin + '/' };

  // ── Retry helper: fetch HTML with Cloudflare bypass + exponential backoff ──
  const fetchHtml = async (url: string, postBody?: string): Promise<string | null> => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const timeout = [6000, 12000, 20000][attempt] || 6000;
        const opts: any = {
          headers: postBody
            ? { ...headers, 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' }
            : headers,
          enableCloudflareBypass: appSettings.enableCloudflareBypass,
          flareSolverrUrl: appSettings.flareSolverrUrl,
          captchaSolverEnabled: appSettings.captchaSolverEnabled,
          captchaApiKey: appSettings.captchaApiKey,
          timeoutMs: timeout,
          sourceId: config.id,
          onCookieUpdate: (sid: string, cookies: string[]) => sourceCookieJar.setCookies(sid, cookies),
        };
        if (postBody) opts.method = 'POST'; else { opts.method = 'GET'; }
        const res = postBody
          ? await fetchWithPostBypass(url, postBody, opts)
          : await fetchWithChallengeBypass(url, opts);

        if (res.ok && res.html) {
          updateSourceHealth(config.id, res.html, res.status);
          if (res.bypassed) console.log(`[Madara Engine] ${config.name}: bypassed via ${res.methodUsed}`);
          return res.html;
        }
        updateSourceHealth(config.id, null, res.status || 500);
        if (res.status === 404 || res.status === 410) {
          return null;
        }
        if (attempt < 2) {
          console.warn(`[Madara Engine] ${config.name} attempt ${attempt+1} failed (HTTP ${res.status}). Retrying...`);
          await new Promise(r => setTimeout(r, [1000, 2500][attempt]));
        }
      } catch (err: any) {
        updateSourceHealth(config.id, null, 0, err?.message);
        if (attempt < 2) {
          console.warn(`[Madara Engine] ${config.name} attempt ${attempt+1} errored. Retrying...`);
          await new Promise(r => setTimeout(r, [1000, 2500][attempt]));
        }
      }
    }
    return null;
  };

  // ── POST variant: fetchWithChallengeBypass doesn't support POST, so we POST via direct fetch with bypass headers ──
  async function fetchWithPostBypass(url: string, body: string, opts: any): Promise<{ ok: boolean; html: string | null; status: number; bypassed: boolean; methodUsed?: string }> {
    try {
      const res = await fetch(url, { method: 'POST', headers: opts.headers, body, signal: AbortSignal.timeout(opts.timeoutMs) });
      const text = await res.text();
      if (res.ok) return { ok: true, html: text, status: res.status, bypassed: false, methodUsed: 'Direct POST' };
      // Try FlareSolverr as fallback
      if (opts.enableCloudflareBypass && opts.flareSolverrUrl) {
        const { solveWithFlareSolverr } = await import('./server/captchaSolver');
        const sr = await solveWithFlareSolverr(url, opts.flareSolverrUrl, Math.round(opts.timeoutMs / 1000));
        if (sr.ok && sr.html) return { ok: true, html: sr.html, status: 200, bypassed: true, methodUsed: 'FlareSolverr Fallback (POST)' };
      }
      return { ok: false, html: null, status: res.status, bypassed: false };
    } catch (e: any) {
      if (opts.enableCloudflareBypass && opts.flareSolverrUrl) {
        const { solveWithFlareSolverr } = await import('./server/captchaSolver');
        const sr = await solveWithFlareSolverr(url, opts.flareSolverrUrl, Math.round(opts.timeoutMs / 1000));
        if (sr.ok && sr.html) return { ok: true, html: sr.html, status: 200, bypassed: true, methodUsed: 'FlareSolverr Fallback (POST)' };
      }
      return { ok: false, html: null, status: 0, bypassed: false };
    }
  }

  try {
    const html = await fetchHtml(targetUrl);
    if (!html) return [];
    const $ = cheerio.load(html);

    // Path 1 (Kotatsu): if the chapter list is already inline on the series page
    // (selectTestAsync matches, or the site is withoutAjax), parse it directly.
    const testAsync = config.madaraSelectTestAsync || 'div.listing-chapters_wrap';
    const inline = $(testAsync).first();
    const useInline = config.madaraWithoutAjax ? true : inline.length > 0;
    let chaptersHtml: string | null = null;

    if (useInline) {
      chaptersHtml = html;
    } else {
      const holder = $('#manga-chapters-holder');
      const mangaId = holder.attr('data-id')
        || (html.match(/"post_id"\s*:\s*(\d+)/)?.[1])
        || (html.match(/"manga_id"\s*:\s*(\d+)/)?.[1]);

      if (mangaId) {
        // Path 2 (Kotatsu): admin-ajax manga_get_chapters (config.madaraPostReq, default true)
        if (config.madaraPostReq !== false) {
          const formBody = `action=manga_get_chapters&manga=${mangaId}`;
          const ajaxHtml = await fetchHtml(`${origin}/wp-admin/admin-ajax.php`, formBody);
          if (ajaxHtml && ajaxHtml.trim().length > 0) chaptersHtml = ajaxHtml;
        }
        // Path 3 (Kotatsu default): POST {mangaUrl}/ajax/chapters/ with empty body.
        if (!chaptersHtml) {
          const relHtml = await fetchHtml(`${targetUrl.replace(/\/$/, '')}/ajax/chapters/`, '');
          if (relHtml && relHtml.trim().length > 0) chaptersHtml = relHtml;
        }
      } else {
        // No holder/id found — the chapters may still be present inline with a
        // different wrapper, so fall back to parsing the page HTML directly.
        chaptersHtml = html;
      }
    }

    if (!chaptersHtml) return [];

    const selectChapter = config.madaraSelectChapter || 'li.wp-manga-chapter';
    const chDoc = cheerio.load(chaptersHtml);
    const rows = chDoc(selectChapter).toArray();
    const chapters: ResolvedChapter[] = [];
    const seen = new Set<string>();
    if (rows.length === 0) {
      // Generic fallback: any anchor with a chapter-looking href/text.
      const chLinkRx = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let m: RegExpExecArray | null;
      let idx = 0;
      while ((m = chLinkRx.exec(chaptersHtml)) !== null) {
        const href = m[1]; const text = m[2].replace(/<[^>]+>/g, '').trim();
        if (!href || /^(#|javascript:)/i.test(href)) continue;
        if (!/chapter|chap|ch/i.test(href) && !/chapter|chap|ch/i.test(text)) continue;
        const numM = (href + ' ' + text).match(/(?:chapter|chap|ch)[^\d]*(\d+(?:\.\d+)?)/i);
        const num = numM ? parseFloat(numM[1]) : (idx + 1);
        if (!Number.isFinite(num) || num <= 0) continue;
        const abs = href.startsWith('http') ? href : `${origin}${href.startsWith('/') ? '' : '/'}${href}`;
        if (seen.has(abs)) continue; seen.add(abs);
        chapters.push({ number: num, id: abs, slug: abs, title: text || `Chapter ${num}`, url: abs, pageCount: 0 }); idx++;
      }
    } else {
      const rowsReversed = [...rows].reverse();
      rowsReversed.forEach((rowEl, i) => {
        const a = chDoc(rowEl).find('a').first();
        const href = a.attr('href') || '';
        if (!href || /^(#|javascript:)/i.test(href)) return;
        const text = a.text().trim() || chDoc(rowEl).find('p').first().text().trim();
        const numM = (href + ' ' + text).match(/(?:chapter|chap|ch)[^\d]*(\d+(?:\.\d+)?)/i);
        const num = numM ? parseFloat(numM[1]) : (i + 1);
        if (!Number.isFinite(num) || num <= 0) return;
        const abs = href.startsWith('http') ? href : `${origin}${href.startsWith('/') ? '' : '/'}${href}`;
        if (seen.has(abs)) return; seen.add(abs);
        chapters.push({ number: num, id: abs, slug: abs, title: text || `Chapter ${num}`, url: abs, pageCount: 0 });
      });
    }
    return chapters;
  } catch (e) { console.warn(`[Madara Engine] Chapter list failed for ${config.name}:`, (e as Error).message); return []; }
}

async function fetchMadaraChapterPages(targetUrl: string, chapterNumber: number, config: EngineSourceConfig): Promise<string[] | null> {
  try {
    const chapters = await fetchMadaraChapterList(targetUrl, config);
    const target = matchResolvedChapter(chapters, chapterNumber);
    if (!target) { console.warn(`[Madara Engine] Ch ${chapterNumber} not found for ${config.name}`); return null; }
    const origin = new URL(target.url).origin;
    const headers = { ...UA_HEADERS, 'Referer': origin + '/' };
    const chRes = await fetch(target.url, { headers });
    if (!chRes.ok) return null;
    const chHtml = await chRes.text();
    if (/id=["']chapter-protector-data["']/i.test(chHtml)) {
      console.warn(`[Madara Engine] Chapter protector (encrypted) — not supported for ${config.name}.`); return null;
    }
    const $ = cheerio.load(chHtml);
    // Scope to the reading container (Kotatsu's selectBodyPage), falling back to
    // Google AdSense domain check (simplified)
    const bodySel = config.madaraSelectBodyPage || 'div.main-col-inner div.reading-content';
    const container = $(bodySel).first().length > 0 ? $(bodySel).first() : null;
    const pages: string[] = []; const seenImg = new Set<string>();
    const extractFrom = (root: any) => {
      root.find('img').each((_: number, el: any) => {
        const src = ($(el).attr('data-src') || $(el).attr('data-lazy-src') || $(el).attr('data-cfsrc') || $(el).attr('src') || '').trim();
        if (src && /\.(jpg|jpeg|png|webp)/i.test(src) && !/\/covers\/|logo|avatar|icon/i.test(src)) {
          const abs = src.startsWith('http') ? src : `${origin}${src.startsWith('/') ? '' : '/'}${src}`;
          if (!seenImg.has(abs)) { seenImg.add(abs); pages.push(abs); }
        }
      });
    };
    if (container) extractFrom(container); else extractFrom($);
    if (pages.length > 0) { console.log(`[Madara Engine] ${pages.length} pages from ${config.name} Ch ${chapterNumber}`); return pages; }
    return null;
  } catch (e) { console.warn(`[Madara Engine] Page extraction failed for ${config.name}:`, (e as Error).message); return null; }
}


// ============================================================================
// MANHWA18 ENGINE EXTRACTOR (Custom WP theme — NOT Madara)
// Based on Kotatsu-Redo's Manhwa18Com.kt / Manhwa18Parser.kt. Uses its own
// `.card-body > .list-chapters > a` chapter rows and `#chapter-content` images.
// ============================================================================
function extractManhwa18ChapterNumber(href: string, name: string, fallback: number): number {
  const rx = /chapter[-_\.\s]*(\d+(?:\.\d+)?)|ch\.?\s*(\d+(?:\.\d+)?)|[-_\./]\s*(\d+(?:\.\d+)?)\s*$/i;
  const m = (href + ' ' + name).match(rx);
  const v = m ? (m[1] || m[2] || m[3]) : null;
  const parsed = v ? parseFloat(v) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function fetchManhwa18ChapterList(seriesUrl: string, domain: string): Promise<ResolvedChapter[]> {
  try {
    const normalized = normalizeLiveTargetUrl(seriesUrl);
    const origin = (() => { try { return new URL(normalized).origin; } catch { return `https://${domain}`; } })();
    const res = await fetch(normalized, {
      headers: { ...UA_HEADERS, 'Referer': origin + '/' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    // Primary Kotatsu selector + broader fallbacks used by the current theme
    let anchors = $('.card-body > .list-chapters > a').toArray();
    if (anchors.length === 0) anchors = $('.list-chapters a, .chapter-list a, a.chapter-name, a[href*="/chap-"], a[href*="/chapter-"]').toArray();
    if (anchors.length === 0) return [];
    const chapters: ResolvedChapter[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < anchors.length; i++) {
      const el = $(anchors[i]);
      const href = el.attr('href') || '';
      if (!href || href.startsWith('javascript') || href.startsWith('#')) continue;
      const abs = (href.startsWith('http') ? href : `${origin}${href.startsWith('/') ? '' : '/'}${href}`).replace(/\/+$/, '');
      // Must be a chapter URL under the series, not the series page itself
      if (!/\/(chap|chapter)[-_/]/i.test(abs) && !/\/manga\/[^/]+\/[^/]+/i.test(abs)) continue;
      if (seen.has(abs)) continue;
      seen.add(abs);
      const name = el.find('.chapter-name').text().trim() || el.text().trim();
      const num = extractManhwa18ChapterNumber(href, name, anchors.length - i);
      chapters.push({ number: num, id: abs, slug: abs, title: name || `Chapter ${num}`, url: abs, pageCount: 0 });
    }
    return chapters;
  } catch (e) {
    console.warn('[Manhwa18 Engine] Chapter list failed:', (e as Error).message);
    return [];
  }
}

async function fetchManhwa18ChapterPages(chapterUrl: string, domain: string): Promise<string[] | null> {
  try {
    const origin = (() => { try { return new URL(chapterUrl).origin; } catch { return `https://${domain}`; } })();
    const res = await fetch(chapterUrl, {
      headers: { ...UA_HEADERS, 'Referer': origin + '/' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);
    const pages: string[] = [];
    const pushSrc = (raw: string) => {
      const src = (raw || '').trim();
      if (!src) return;
      if (!/\.(jpg|jpeg|png|webp)(\?|$)/i.test(src) && !/cdn\.manhwa18/i.test(src)) return;
      if (/logo|avatar|icon|banner|favicon|\/covers\//i.test(src)) return;
      const abs = src.startsWith('http') ? src : `${origin}${src.startsWith('/') ? '' : '/'}${src}`;
      if (!pages.includes(abs)) pages.push(abs);
    };
    // Primary: #chapter-content img (Kotatsu)
    $('#chapter-content img, .chapter-content img, #chapter_content img, .read-content img, .page-break img').each((_, el) => {
      pushSrc($(el).attr('data-src') || $(el).attr('data-lazy-src') || $(el).attr('data-original') || $(el).attr('src') || '');
    });
    // Fallback: any lazy img on CDN
    if (pages.length === 0) {
      $('img.lazy, img[data-src]').each((_, el) => {
        pushSrc($(el).attr('data-src') || $(el).attr('src') || '');
      });
    }
    return pages.length > 0 ? pages : null;
  } catch (e) {
    console.warn('[Manhwa18 Engine] Page extraction failed:', (e as Error).message);
    return null;
  }
}

// ============================================================================
// HOTCOMICS ENGINE EXTRACTOR (Custom theme)
// Based on Kotatsu-Redo's HotComicsParser.kt — `#tab-chapter li` + `#viewer-img img`
// ============================================================================
function stripHotComicsLang(href: string): string {
  if (href.startsWith('http')) return href;
  const cleaned = href.startsWith('/') ? href.substring(1) : href;
  const firstSlash = cleaned.indexOf('/');
  if (firstSlash <= 0 || firstSlash === cleaned.length - 1) return href;
  return '/' + cleaned.substring(firstSlash + 1);
}

async function fetchHotComicsChapterList(seriesUrl: string, domain: string): Promise<ResolvedChapter[]> {
  try {
    const origin = (() => { try { return new URL(seriesUrl).origin; } catch { return `https://${domain}`; } })();
    const res = await fetch(seriesUrl, { headers: { ...UA_HEADERS, 'Referer': origin + '/' } });
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const lis = $('#tab-chapter li').toArray();
    if (lis.length === 0) return [];
    const chapters: ResolvedChapter[] = [];
    for (let i = 0; i < lis.length; i++) {
      const el = $(lis[i]);
      const a = el.find('a').first();
      let href = a.attr('href') || '';
      if (href.startsWith('javascript')) {
        href = (a.attr('onclick') || '').match(/href=['"]([^'"]+)['"]/)?.[1] || '';
      }
      if (!href || href === '#') continue;
      const rel = stripHotComicsLang(href);
      const abs = rel.startsWith('http') ? rel : `https://${domain}${rel.startsWith('/') ? '' : '/'}${rel}`;
      const num = parseFloat(el.find('.num').text() || '') || (i + 1);
      chapters.push({ number: num, id: abs, slug: abs, title: `Chapter ${num}`, url: abs, pageCount: 0 });
    }
    return chapters;
  } catch (e) {
    console.warn('[HotComics Engine] Chapter list failed:', (e as Error).message);
    return [];
  }
}

async function fetchHotComicsChapterPages(chapterUrl: string, domain: string): Promise<string[] | null> {
  try {
    const origin = (() => { try { return new URL(chapterUrl).origin; } catch { return `https://${domain}`; } })();
    const res = await fetch(chapterUrl, { headers: { ...UA_HEADERS, 'Referer': origin + '/' } });
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);
    const pages: string[] = [];
    $('#viewer-img img').each((_, el) => {
      const src = ($(el).attr('src') || $(el).attr('data-src') || '').trim();
      if (src && /\.(jpg|jpeg|png|webp)/i.test(src) && !/logo|avatar|icon|banner/i.test(src)) {
        pages.push(src.startsWith('http') ? src : `${origin}${src.startsWith('/') ? '' : '/'}${src}`);
      }
    });
    return pages.length > 0 ? Array.from(new Set(pages)) : null;
  } catch (e) {
    console.warn('[HotComics Engine] Page extraction failed:', (e as Error).message);
    return null;
  }
}

// ============================================================================
// MANGAREADER ENGINE EXTRACTOR (MangaReader / ts-reader themed sites)
// Based on Kotatsu-Redo's MangaReaderParser.kt: parses the embedded
// `ts_reader.run({...})` JSON (`sources[0].images`) and falls back to
// `#readerarea img`. Chapter listing reuses the generic anchor resolver.
// ============================================================================
function extractMangaReaderPageUrls(html: string, origin: string): string[] {
  const $ = cheerio.load(html);
  const pages: string[] = [];

  // 1. Inline ts_reader.run({ ... }) script with sources[0].images
  let tsScript: string | null = null;
  $('script').each((_, el) => {
    const code = $(el).html() || '';
    if (tsScript === null && code.includes('ts_reader')) tsScript = code;
  });
  if (tsScript) {
    const start = tsScript.indexOf('(');
    const end = tsScript.lastIndexOf(')');
    if (start !== -1 && end > start) {
      try {
        const obj = JSON.parse(tsScript.substring(start + 1, end));
        const imgs = obj?.sources?.[0]?.images;
        if (Array.isArray(imgs)) pages.push(...imgs);
      } catch (_) { /* not strict JSON */ }
    }
  }

  // 2. Base64-encoded ts_reader script (data:text/javascript;base64,...)
  if (pages.length === 0) {
    let b64: string | null = null;
    $('script[src^="data:text/javascript;base64,"]').each((_, el) => { if (b64 === null) b64 = $(el).attr('src') || null; });
    if (b64) {
      try {
        const decoded = Buffer.from(b64.replace('data:text/javascript;base64,', ''), 'base64').toString('utf-8');
        if (decoded.startsWith('ts_reader')) {
          const start = decoded.indexOf('(');
          const end = decoded.lastIndexOf(')');
          if (start !== -1 && end > start) {
            const obj = JSON.parse(decoded.substring(start + 1, end));
            const imgs = obj?.sources?.[0]?.images;
            if (Array.isArray(imgs)) pages.push(...imgs);
          }
        }
      } catch (_) { /* ignore */ }
    }
  }

  // 3. Fallback: #readerarea img (lazy-loaded data-src variants)
  if (pages.length === 0) {
    $('#readerarea img').each((_, el) => {
      const src = $(el).attr('data-src') || $(el).attr('data-lazy-src') || $(el).attr('src') || '';
      if (src) pages.push(src);
    });
  }

  return Array.from(new Set(pages.map((p) => p.startsWith('http') ? p : `${origin}${p.startsWith('/') ? '' : '/'}${p}`)));
}

async function fetchMangaReaderChapterPages(chapterUrl: string): Promise<string[] | null> {
  try {
    const origin = new URL(chapterUrl).origin;
    const res = await fetch(chapterUrl, { headers: { ...UA_HEADERS, 'Referer': origin + '/' } });
    if (!res.ok) return null;
    const pages = extractMangaReaderPageUrls(await res.text(), origin);
    return pages.length > 0 ? pages : null;
  } catch (e) {
    console.warn('[MangaReader Engine] Page extraction failed:', (e as Error).message);
    return null;
  }
}

// MangaReader / ts-reader themed sites list chapters inside `#chapterlist > ul > li`
// (Kotatsu's MangaReaderParser `selectChapter = "#chapterlist > ul > li"`). This is
// far more reliable than the generic anchor regex, which requires the literal word
// "chapter/chap/ch" in the href/text and drops chapters with unusual titles.
async function fetchMangaReaderChapterList(seriesUrl: string): Promise<ResolvedChapter[]> {
  try {
    const origin = new URL(seriesUrl).origin;
    const res = await fetch(seriesUrl, { headers: { ...UA_HEADERS, 'Referer': origin + '/' } });
    if (!res.ok) return [];
    const $ = cheerio.load(await res.text());
    const lis = $('#chapterlist > ul > li, ul.chapter-list li, li.wp-manga-chapter').toArray();
    if (lis.length === 0) return [];
    const chapters: ResolvedChapter[] = [];
    const seen = new Set<string>();
    [...lis].reverse().forEach((li, i) => {
      const a = $(li).find('a').first();
      const href = a.attr('href') || '';
      if (!href || /^(#|javascript:)/i.test(href)) return;
      const text = a.text().trim() || a.attr('title') || '';
      const numAttr = a.attr('data-num') || $(li).attr('data-num');
      const numM = (href + ' ' + text).match(/(?:chapter|chap|ch)[^\d]*(\d+(?:\.\d+)?)/i);
      const num = numAttr ? parseFloat(numAttr) : (numM ? parseFloat(numM[1]) : (i + 1));
      if (!Number.isFinite(num) || num <= 0) return;
      const abs = href.startsWith('http') ? href : `${origin}${href.startsWith('/') ? '' : '/'}${href}`;
      if (seen.has(abs)) return; seen.add(abs);
      chapters.push({ number: num, id: abs, slug: abs, title: text || `Chapter ${num}`, url: abs, pageCount: 0 });
    });
    return chapters;
  } catch (e) {
    console.warn('[MangaReader Engine] Chapter list failed:', (e as Error).message);
    return [];
  }
}

async function fetchLiveChapterList(rawTargetUrl: string, domainId: string): Promise<ResolvedChapter[]> {
  const targetUrl = normalizeLiveTargetUrl(rawTargetUrl);
  
  // Check engine registry first for dedicated extractors
  const engineConfig = getEngineConfig(domainId);
  if (engineConfig && engineConfig.engine === 'madara') {
    const chapters = await fetchMadaraChapterList(targetUrl, engineConfig);
    if (chapters.length > 0) return chapters;
  }
  if (engineConfig && engineConfig.engine === 'mangareader') {
    const chapters = await fetchMangaReaderChapterList(targetUrl);
    if (chapters.length > 0) return chapters;
  }
  if (engineConfig && engineConfig.engine === 'hotcomics') {
    const chapters = await fetchHotComicsChapterList(targetUrl, engineConfig.domain || domainId);
    if (chapters.length > 0) return chapters;
  }
  
  switch (domainId) {
    case 'asura':
      return (await fetchAsuraChapterList(targetUrl)).chapters;
    case 'flame':
      return await fetchFlameChapterList(targetUrl);
    case 'dynasty':
      return await fetchDynastyChapterList(targetUrl);
    case 'manhwa18':
      return await fetchManhwa18ChapterList(targetUrl, engineConfig?.domain || domainId);
    case 'hotcomics':
    case 'daycomics':
      return await fetchHotComicsChapterList(targetUrl, engineConfig?.domain || domainId);
    default:
      return await fetchGenericChapterList(targetUrl);
  }
}

// Extract real panel image URLs from chapter HTML (multi-attribute, filters metadata).
export function extractPanelImages(htmlText: string, origin: string): string[] {
  const imgRegex = /<img[^>]+(?:data-src|data-lazy-src|data-cfsrc|data-full-url|data-original|data-srcset|srcset|src)=["']([^"']+)["'][^>]*>/gi;
  const pages: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = imgRegex.exec(htmlText)) !== null) {
    const src = match[1]?.trim();
    if (!src) continue;
    if (
      src &&
      (src.includes('.jpg') || src.includes('.jpeg') || src.includes('.png') || src.includes('.webp') || src.includes('imgur.com')) &&
      !src.includes('/covers/') &&
      !src.includes('/profiles/') &&
      !src.includes('logo') &&
      !src.includes('banner') &&
      !src.includes('avatar') &&
      !src.includes('icon') &&
      !src.includes('default-pp') &&
      !src.includes('announcement') &&
      !src.includes('manhwa18.png') &&
      !src.includes('manhwa18.cc/manga/')
      // NOTE: intentionally NOT excluding cdn.manhwa18.com — that domain hosts real chapter images.
    ) {
      pages.push(src.startsWith('http') ? src : `${origin}${src.startsWith('/') ? '' : '/'}${src}`);
    }
  }
  return Array.from(new Set(pages));
}


async function extractLiveDomainChapterPages(
  rawTargetUrl: string,
  domainId: string,
  chapterNumber: number = 1
): Promise<string[] | null> {
  try {
    if (domainId && !sourceCircuitBreaker.canAttempt(domainId)) {
      console.warn(`[Live Source Extractor] Fast-failing extract from ${domainId} (circuit OPEN)`);
      return null;
    }
    // 0. Auto Domain Mirror Redirection + manhwa18 path normalization
    const targetUrl = normalizeLiveTargetUrl(rawTargetUrl);


    console.log(`[Live Source Extractor] Extracting Chapter ${chapterNumber} from ${domainId} (${targetUrl})`);

    // 1. Asura Scans Official API v2 Integration with Slug Hash Fallback
    if (domainId === 'asura') {
      try {
        const { chapters, matchedSlug } = await fetchAsuraChapterList(targetUrl);

        if (chapters.length === 0) {
          // The API resolved nothing for this slug — the series is either not
          // hosted on Asura anymore (common: Asura drops licensed/old titles) or
          // the slug is stale. Surface it clearly instead of silently falling
          // through to a placeholder that looks like a fetch failure.
          console.warn(`[Asura API Engine] No chapters returned for "${targetUrl}" — the series may no longer be hosted on Asura Scans.`);
        }

        if (chapters.length > 0 && matchedSlug) {
          const targetChapter = matchResolvedChapter(chapters, chapterNumber);

          // Never silently substitute a WRONG chapter (e.g. the last one in the list) when the
          // requested chapter number does not exist on the source. Return null so the caller
          // falls back to a correct-title placeholder instead of loading the wrong series chapter.
          if (targetChapter && targetChapter.slug) {
            const pagesRes = await fetch(`https://api.asurascans.com/api/series/${matchedSlug}/chapters/${targetChapter.slug}`, {
              headers: ASURA_API_HEADERS,
              signal: AbortSignal.timeout(15000),
            });

            if (pagesRes.ok) {
              const pagesData = await pagesRes.json();
              const rawPages =
                pagesData?.data?.chapter?.pages ||
                pagesData?.data?.pages ||
                pagesData?.chapter?.pages ||
                pagesData?.pages ||
                [];
              const urls = normalizeAsuraPageList(rawPages);
              if (urls.length > 0) {
                console.log(`[Asura API Engine] Successfully loaded ${urls.length} live pages for ${matchedSlug} Chapter ${chapterNumber} (resolved ${targetChapter.number})`);
                return urls;
              }
              console.warn(`[Asura API Engine] Chapter payload had no usable page URLs for ${matchedSlug}/${targetChapter.slug}`);
            } else {
              console.warn(`[Asura API Engine] Chapter pages HTTP ${pagesRes.status} for ${matchedSlug}/${targetChapter.slug}`);
            }
          } else {
            console.warn(`[Asura API Engine] Chapter ${chapterNumber} not found for "${matchedSlug}" — not substituting a wrong chapter.`);
            return null;
          }
        }
      } catch (err: any) {
        console.warn(`[Asura Scans API Engine] Failed, falling back to HTML parser:`, err.message);
      }
    }

    // 2. Flame Comics Next.js API Integration (Kotatsu-Redo)
    if (domainId === 'flame') {
      try {
        const ctx = await fetchFlameSeriesContext(targetUrl);
        if (ctx) {
          const resolved = mapFlameChapters(ctx.chapters, ctx.seriesId);
          const matchedCh = matchResolvedChapter(resolved, chapterNumber);
          if (!matchedCh || !matchedCh.slug) {
            console.warn(`[Flame Comics API Engine] Chapter ${chapterNumber} not found for series ${ctx.seriesId} — not substituting a wrong chapter.`);
            return null;
          }

          const token = matchedCh.slug;
          const chRes = await fetch(`https://flamecomics.xyz/_next/data/${ctx.buildId}/series/${ctx.seriesId}/${token}.json?id=${ctx.seriesId}&token=${token}`, {
            headers: UA_HEADERS,
          });

          if (chRes.ok) {
            const chData = await chRes.json();
            const imagesObj = chData.pageProps?.chapter?.images || {};
            const imageKeys = Object.keys(imagesObj);
            if (imageKeys.length > 0) {
              console.log(`[Flame Comics API Engine] Successfully extracted ${imageKeys.length} live pages for seriesId ${ctx.seriesId} token ${token}`);
              // Fix #12: Direct CDN URLs bypass Next.js image optimizer
              const cdnBase = `https://cdn.flamecomics.xyz/uploads/images/series/${ctx.seriesId}/${token}`;
              return imageKeys.map((k) => {
                const imgName = typeof imagesObj[k] === 'object' ? (imagesObj[k].name || imagesObj[k]) : imagesObj[k];
                return `${cdnBase}/${imgName}`;
              });
            }
          }
        }
      } catch (err: any) {
        console.warn(`[Flame Comics API Engine] Failed, falling back to HTML parser:`, err.message);
      }
    }

    // 3. Dedicated Engine Extractors: Manhwa18 / HotComics / MangaReader
    const engCfg = getEngineConfig(domainId);
    if (engCfg && engCfg.engine === 'manhwa18') {
      const mhChapters = await fetchManhwa18ChapterList(targetUrl, engCfg.domain);
      const mhTarget = matchResolvedChapter(mhChapters, chapterNumber);
      if (!mhTarget) {
        console.warn(`[Manhwa18 Engine] Ch ${chapterNumber} not found for ${engCfg.name} — not substituting a wrong chapter.`);
        return null;
      }
      const mhPages = await fetchManhwa18ChapterPages(mhTarget.url, engCfg.domain);
      if (mhPages && mhPages.length > 0) return mhPages;
    }
    if (engCfg && engCfg.engine === 'hotcomics') {
      const hcChapters = await fetchHotComicsChapterList(targetUrl, engCfg.domain);
      const hcTarget = matchResolvedChapter(hcChapters, chapterNumber);
      if (!hcTarget) {
        console.warn(`[HotComics Engine] Ch ${chapterNumber} not found for ${engCfg.name} — not substituting a wrong chapter.`);
        return null;
      }
      const hcPages = await fetchHotComicsChapterPages(hcTarget.url, engCfg.domain);
      if (hcPages && hcPages.length > 0) return hcPages;
    }
    if (engCfg && engCfg.engine === 'mangareader') {
      const mrChapters = await fetchMangaReaderChapterList(targetUrl);
      const mrTarget = matchResolvedChapter(mrChapters, chapterNumber);
      if (!mrTarget) {
        console.warn(`[MangaReader Engine] Ch ${chapterNumber} not found for ${engCfg.name} — not substituting a wrong chapter.`);
        return null;
      }
      const mrPages = await fetchMangaReaderChapterPages(mrTarget.url);
      if (mrPages && mrPages.length > 0) return mrPages;
    }

    // 4. Madara Engine (WP-Manga theme) — dedicated AJAX chapter extractor
    const engineConfig = getEngineConfig(domainId);
    if (engineConfig && engineConfig.engine === 'madara') {
      const madaraPages = await fetchMadaraChapterPages(targetUrl, chapterNumber, engineConfig);
      if (madaraPages && madaraPages.length > 0) return madaraPages;
    }

    // 4. MangaDex API — DISABLED (MangaDex is metadata-only, not a reading source).
    // The At-Home chapter resolution was previously here but has been removed.
    // MangaDex chapter page extraction is permanently disabled.

    // 4. Dynasty Scans Series & Chapter Resolution
    if (domainId === 'dynasty' || targetUrl.includes('dynasty-scans.com')) {
      try {
        const chapters = await fetchDynastyChapterList(targetUrl);
        if (chapters.length === 0) {
          // Could not enumerate from the series page (possibly a direct chapter URL).
          // Fall through to the universal resolver below.
        } else {
          const target = matchResolvedChapter(chapters, chapterNumber);
          if (!target) {
            console.warn(`[Dynasty Scans Extractor] Chapter ${chapterNumber} not found — not substituting a wrong chapter.`);
            return null;
          }
          const res = await fetch(target.url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', Referer: targetUrl },
          });
          if (res.ok) {
            const html = await res.text();
            const match = html.match(/var\s+pages\s*=\s*(\[[\s\S]*?\]);/);
            if (match && match[1]) {
              let pagesObj: any[];
              try { pagesObj = JSON.parse(match[1]); } catch { pagesObj = []; }
              const pageUrls: string[] = [];
              for (const item of Array.isArray(pagesObj) ? pagesObj : []) {
                let src = typeof item === 'string' ? item : '';
                if (typeof item === 'object' && item !== null) {
                  const v = item.image || item.url || item.src;
                  src = typeof v === 'string' ? v : (typeof v === 'object' && v ? (v.url || v.path || v.src || '') : '');
                }
                if (!src) continue;
                pageUrls.push(src.startsWith('http') ? src : `https://dynasty-scans.com${src.startsWith('/') ? '' : '/'}${src}`);
              }
              if (pageUrls.length > 0) return Array.from(new Set(pageUrls));
            }
          }
        }
      } catch (err: any) {
        console.warn(`[Dynasty Scans Extractor] Error:`, err.message);
      }
    }

    // 5. Universal HTML Chapter Resolver & Multi-Attribute Image Extractor
    const origin = new URL(targetUrl).origin;
    const reqHeaders = { ...UA_HEADERS, 'Referer': origin + '/' };
    const solverOpts = {
      headers: reqHeaders,
      enableCloudflareBypass: appSettings.enableCloudflareBypass,
      flareSolverrUrl: appSettings.flareSolverrUrl,
      captchaSolverEnabled: appSettings.captchaSolverEnabled,
      captchaApiKey: appSettings.captchaApiKey,
      sourceId: origin,
      onCookieUpdate: (sid: string, cookies: string[]) => sourceCookieJar.setCookies(sid, cookies),
    };

    // If the URL is a direct chapter page, fetch it directly with challenge bypass.
    const isDirectChapterUrl = /\/(chapter|chap|ch)[-\/_.]?\d+/i.test(targetUrl);
    if (isDirectChapterUrl) {
      const directBypass = await fetchWithChallengeBypass(targetUrl, solverOpts);
      if (directBypass.ok && directBypass.html) {
        const directImages = extractPanelImages(directBypass.html, origin);
        if (directImages.length > 0) return directImages;
      }
      return null;
    }

    // Otherwise enumerate the series page and look up the exact requested chapter.
    const genericChapters = await fetchGenericChapterList(targetUrl);
    const genericTarget = matchResolvedChapter(genericChapters, chapterNumber);
    if (genericTarget) {
      const pageBypass = await fetchWithChallengeBypass(genericTarget.url, solverOpts);
      if (pageBypass.ok && pageBypass.html) {
        const images = extractPanelImages(pageBypass.html, origin);
        if (images.length > 0) return images;
      }
    } else {
      console.warn(`[Live Source Extractor] Chapter ${chapterNumber} not found for ${domainId} — not substituting a wrong chapter.`);
    }

  } catch (err) {
    console.error(`[Live Source Extractor] Error extracting from ${domainId}:`, err);
  }

  return null;
}

// ============================================================================
// KOTATSU-PARSER IMAGE ENGINE PIPELINE (MODELED AFTER KOTATSU ANDROID ENGINE)
// ============================================================================

interface KotatsuPageListCacheEntry {
  pages: string[];
  timestamp: number;
}

class KotatsuImageEngine {
  private pageListCache = new Map<string, KotatsuPageListCacheEntry>();
  private maxCacheAgeMs = 1000 * 60 * 60 * 24; // 24 Hours Cache

  public async getChapterPages(
    targetUrl: string,
    domainId: string,
    chapterNumber: number = 1
  ): Promise<string[] | null> {
    const cacheKey = `${domainId}:${targetUrl}:${chapterNumber}`;
    const cached = this.pageListCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.maxCacheAgeMs) {
      console.log(`[Kotatsu Image Engine] Cache Hit for ${cacheKey} (${cached.pages.length} pages)`);
      return cached.pages;
    }

    const pages = await extractLiveDomainChapterPages(targetUrl, domainId, chapterNumber);
    if (pages && pages.length > 0) {
      this.pageListCache.set(cacheKey, { pages, timestamp: Date.now() });
    }
    return pages;
  }

  public clearCache() {
    this.pageListCache.clear();
  }

  public size(): number {
    return this.pageListCache.size;
  }
}

const kotatsuImageEngine = new KotatsuImageEngine();

// Get chapter page image URLs. MangaDex is used for METADATA only and is intentionally
// NOT used as a reading source — see the resolution order inside the handler.
app.get("/api/reader/chapter-pages", async (req, res) => {
  const mangaId = req.query.mangaId as string;
  const chapterNumber = Math.max(1, parseFloat(req.query.chapterNumber as string) || 1);
  let chapterId = (req.query.chapterId as string) || '';

  const manga = resolveManga(String(mangaId || '')) || mangaDatabase.find((m) => m.apiId === mangaId);
  const mangaTitle = manga ? manga.title : 'Webtoon Series';
  const totalChapters = manga ? Math.max(manga.latestChapter || 1, manga.currentChapter || 1, chapterNumber) : 1;

  // 1. MangaDex is used for METADATA only (search/enrichment/covers) and is intentionally
  //    NOT used as a reading source. Reading is resolved from the series' own live source
  //    below, or falls back to a generated placeholder panel with the correct title.

  // 2. LIVE DOMAIN SOURCE CRAWLER RESOLUTION (KOTATSU IMAGE ENGINE)
  let targetUrl = (req.query.url as string) || manga?.sourceUrl || '';

  // If the primary sourceUrl is MangaDex (metadata-only), check availableSources
  // for a non-MangaDex live source URL that can actually serve chapter images.
  if (targetUrl && targetUrl.toLowerCase().includes('mangadex.org') && manga?.availableSources?.length) {
    const altSource = manga.availableSources.find(
      (s) => s.sourceUrl && s.sourceUrl.startsWith('http') && !s.sourceUrl.toLowerCase().includes('mangadex.org')
    );
    if (altSource) {
      console.log(`[Reader Stream Engine] Promoting alternative live source "${altSource.sourceName}" over MangaDex metadata-only sourceUrl.`);
      targetUrl = altSource.sourceUrl;
    }
  }

  // MangaDex host is metadata-only — never use it as a live crawling source.
  if (targetUrl && targetUrl.toLowerCase().includes('mangadex.org')) {
    console.warn(`[Reader Stream Engine] Blocked reading attempt via MangaDex source URL "${targetUrl}" — MangaDex is metadata-only.`);
    // Falls through to generated placeholder (step 4).
  } else if (targetUrl && (targetUrl.startsWith('http://') || targetUrl.startsWith('https://'))) {
    const matchedDomain = matchLiveDomain(targetUrl);
    const domainId = matchedDomain ? matchedDomain.id : 'general';
    const domainIsDisabled = matchedDomain ? disabledSourceIds.has(matchedDomain.id) : false;

    if (!domainIsDisabled) {
      let livePages = await kotatsuImageEngine.getChapterPages(targetUrl, domainId, chapterNumber);

      // Probe first image lightly. Do not discard the whole chapter if the CDN
      // rejects Range probes (common) — the image proxy will still fetch pages.
      if (livePages && livePages.length > 0) {
        let probeOk = false;
        try {
          const probeRes = await fetch(livePages[0], {
            method: 'GET',
            signal: AbortSignal.timeout(4000),
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
              'Referer': targetUrl.startsWith('http') ? new URL(targetUrl).origin + '/' : 'https://asurascans.com/',
              'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
            },
          });
          // Any response with a body is good enough; 403/ hotlink may still work via our proxy.
          if (probeRes.ok || probeRes.status === 206 || probeRes.status === 405 || probeRes.status === 403) {
            probeOk = true;
          }
        } catch (_) {
          // Network blip — still serve pages through the proxy rather than placeholders.
          probeOk = true;
        }
        if (!probeOk) {
          console.warn(`[Reader Stream Engine] First panel probe failed hard — still returning ${livePages.length} pages via proxy.`);
        }
      }

      if (livePages && livePages.length > 0) {
        // Fix #3: Pass the source URL as pageUrl for accurate Referer headers
        const proxiedPages = livePages.map(
          (p) => `/api/reader/proxy-image?url=${encodeURIComponent(p)}&sourceUrl=${encodeURIComponent(targetUrl)}&pageUrl=${encodeURIComponent(targetUrl)}`
        );

        const sourceLabel = matchedDomain ? matchedDomain.name : 'Webtoon Source';
        console.log(`[Reader Stream Engine] Successfully extracted ${proxiedPages.length} live panels from ${sourceLabel} for Chapter ${chapterNumber}`);
        return res.json({
          chapterId: chapterId || `ch_${mangaId || 'kotatsu'}_${chapterNumber}`,
          mangaId,
          mangaTitle,
          chapterNumber,
          title: `Chapter ${chapterNumber}`,
          scanGroup: sourceLabel,
          selectedGroup: sourceLabel,
          pages: proxiedPages,
          totalChapters,
          nextChapterNumber: chapterNumber < totalChapters ? chapterNumber + 1 : null,
          prevChapterNumber: chapterNumber > 1 ? chapterNumber - 1 : null,
          isPlaceholder: false,
        });

      }
    } else if (matchedDomain && domainIsDisabled) {
      console.warn(`[Live Source Extractor] Skipping extraction — source "${matchedDomain.name}" is currently disabled.`);
    }
  }

  // 3. MangaDex is NOT used for reading (metadata only). If the live source above could
  //    not be resolved, fall through to a generated placeholder panel with the correct
  //    title instead of guessing a series from a title search.

  // 4. Content-unavailable response (honest empty state instead of fake comic panels)
  const reason = targetUrl
    ? 'Could not extract live chapter pages from the source. The site may be blocking requests, the chapter may be missing (many sources drop older chapters), or the series URL is stale.'
    : 'No readable live source URL is configured for this series (MangaDex is metadata-only).';
  return res.json({
    chapterId: `ch_${mangaId}_${chapterNumber}`,
    mangaId: mangaId || 'm1',
    mangaTitle,
    chapterNumber,
    title: `Chapter ${chapterNumber}`,
    scanGroup: manga?.sourceName || 'Scanlation Site',
    pages: [],
    totalChapters,
    nextChapterNumber: chapterNumber < totalChapters ? chapterNumber + 1 : null,
    prevChapterNumber: chapterNumber > 1 ? chapterNumber - 1 : null,
    isPlaceholder: true,
    loadError: reason,
    contentUnavailable: true,
  });
});







// Dynamic Webtoon Canvas Panel Renderer (SVG Image endpoint)
// XML-escape helper: SVG served as image/svg+xml must escape & < > " ' so a
// user-supplied title/chapter can never break out of the markup (reflected XSS).
function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

app.get("/api/reader/panel-image", (req, res) => {
  const manga = escapeXml((req.query.manga as string) || 'Webtoon');
  // chapter/totalPages are validated as non-negative integers before rendering.
  const chapter = Math.max(1, Math.floor(Number(req.query.chapter) || 1));
  const totalPages = Math.max(1, Math.floor(Number(req.query.totalPages) || 14));
  const page = Math.max(1, Math.floor(Number(req.query.page) || 1));
  const type = (req.query.type as string) || 'manhwa';
  const genre = String((req.query.genre as string) || 'Action').toLowerCase();

  // Simple unavailable panel (used when live extraction fails)
  const rawTitle = String((req.query.manga as string) || 'Series');
  if (/page panel|missing|unavailable|content unavailable/i.test(rawTitle) || String(req.query.reason || '') === 'unavailable') {
    const msg = escapeXml(rawTitle === 'Page Panel' ? 'Content Unavailable' : rawTitle);
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200" viewBox="0 0 800 1200">
<rect width="100%" height="100%" fill="#0b1220"/>
<rect x="40" y="360" width="720" height="420" rx="24" fill="#111827" stroke="#f59e0b" stroke-width="2"/>
<text x="400" y="480" text-anchor="middle" fill="#f8fafc" font-family="system-ui,sans-serif" font-size="32" font-weight="800">Content Unavailable</text>
<text x="400" y="540" text-anchor="middle" fill="#94a3b8" font-family="system-ui,sans-serif" font-size="18">${msg}</text>
<text x="400" y="600" text-anchor="middle" fill="#64748b" font-family="system-ui,sans-serif" font-size="15">Chapter may be missing, source blocked, or URL stale.</text>
<text x="400" y="650" text-anchor="middle" fill="#475569" font-family="system-ui,sans-serif" font-size="14">Try another chapter or source from the series detail page.</text>
</svg>`;
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    // Never render as a document on direct navigation (defense-in-depth vs SVG script execution)
    res.setHeader('Content-Disposition', 'attachment; filename="panel.svg"');
    return res.send(svg);
  }
  const chapterNext = escapeXml(chapter + 1);

  // Aesthetic colors per genre
  let bgGrad1 = '#0f172a';
  let bgGrad2 = '#1e1b4b';
  let auraColor = '#f59e0b'; // amber
  let accentColor = '#38bdf8'; // sky blue
  let soundEffect = 'BOOM!';
  let dialogueText = 'This energy... It is breaking through my limits!';

  if (genre.toLowerCase().includes('cultivation') || type === 'manhua') {
    bgGrad1 = '#090d16';
    bgGrad2 = '#1a0d2e';
    auraColor = '#ef4444'; // red Qi
    accentColor = '#f97316';
    soundEffect = 'SHING!';
    dialogueText = 'Kowtow three times and I shall leave your corpse intact!';
  } else if (genre.toLowerCase().includes('system') || genre.toLowerCase().includes('dungeon')) {
    bgGrad1 = '#030712';
    bgGrad2 = '#0284c7';
    auraColor = '#06b6d4'; // cyan system
    accentColor = '#3b82f6';
    soundEffect = 'SYSTEM NOTIFICATION';
    dialogueText = '[ Quest Completed: Defeat the Dungeon Monarch ]';
  } else if (genre.toLowerCase().includes('murim') || genre.toLowerCase().includes('martial')) {
    bgGrad1 = '#111827';
    bgGrad2 = '#312e81';
    auraColor = '#eab308'; // golden sword Qi
    accentColor = '#a855f7';
    soundEffect = 'SWOOSH!';
    dialogueText = 'The Heavenly Sword Technique has no equal under heaven.';
  }

  // Varied panels based on page number
  const isTitleCoverPage = page === 1;
  const isEndingPage = page === totalPages;

  const svgWidth = 800;
  const svgHeight = 1200;

  let panelContent = '';

  if (isTitleCoverPage) {
    panelContent = `
      <rect width="100%" height="100%" fill="url(#bgGrad)"/>
      <!-- Glowing Frame -->
      <rect x="30" y="30" width="740" height="1140" rx="20" fill="none" stroke="${auraColor}" stroke-width="4" opacity="0.6"/>
      <circle cx="400" cy="450" r="220" fill="${auraColor}" opacity="0.15" filter="url(#blur)"/>
      <polygon points="400,280 480,500 320,500" fill="url(#auraGrad)" opacity="0.8"/>
      
      <!-- Title Card Header -->
      <text x="400" y="160" text-anchor="middle" fill="#f8fafc" font-family="system-ui, sans-serif" font-size="22" font-weight="900" letter-spacing="4">
        ${type === 'manhwa' ? '🇰🇷 KOREAN WEBTOON' : '🇨🇳 CHINESE MANHUA'}
      </text>
      
      <text x="400" y="230" text-anchor="middle" fill="#ffffff" font-family="system-ui, sans-serif" font-size="36" font-weight="900">
        ${manga}
      </text>

      <rect x="250" y="270" width="300" height="40" rx="20" fill="${auraColor}"/>
      <text x="400" y="296" text-anchor="middle" fill="#090d16" font-family="system-ui, sans-serif" font-size="20" font-weight="800">
        CHAPTER ${chapter}
      </text>

      <!-- Center Action Illustration -->
      <g transform="translate(200, 380)">
        <path d="M200,50 L250,220 L320,220 L200,380 L180,250 L100,250 Z" fill="${accentColor}" opacity="0.9"/>
        <circle cx="200" cy="180" r="90" fill="#ffffff" opacity="0.1"/>
        <!-- Action FX -->
        <text x="200" y="210" text-anchor="middle" fill="#fef08a" font-family="Impact, sans-serif" font-size="64" font-weight="bold" transform="rotate(-8 200 210)">
          ${soundEffect}
        </text>
      </g>

      <!-- Speech Bubble -->
      <path d="M 120 850 Q 120 800 170 800 L 630 800 Q 680 800 680 850 L 680 930 Q 680 980 630 980 L 320 980 L 260 1030 L 280 980 L 170 980 Q 120 980 120 930 Z" fill="#0f172a" stroke="${auraColor}" stroke-width="3"/>
      <text x="400" y="890" text-anchor="middle" fill="#f8fafc" font-family="system-ui, sans-serif" font-size="22" font-weight="700">
        ${escapeXml(dialogueText)}
      </text>

      <!-- Page Indicator -->
      <text x="400" y="1120" text-anchor="middle" fill="#94a3b8" font-family="sans-serif" font-size="16" font-weight="600">
        [ Page 1 / ${totalPages} • Scroll down for next panel ]
      </text>
    `;
  } else if (isEndingPage) {
    panelContent = `
      <rect width="100%" height="100%" fill="#090d16"/>
      <rect x="40" y="100" width="720" height="1000" rx="16" fill="#1e293b" stroke="${auraColor}" stroke-width="2"/>
      
      <!-- Ending Cliffhanger FX -->
      <text x="400" y="280" text-anchor="middle" fill="#fef08a" font-family="Impact, sans-serif" font-size="72" font-weight="bold" transform="rotate(-5 400 280)">
        TO BE CONTINUED...
      </text>

      <circle cx="400" cy="520" r="140" fill="${auraColor}" opacity="0.2" filter="url(#blur)"/>
      <path d="M 320 480 L 480 480 L 400 620 Z" fill="${auraColor}"/>

      <rect x="150" y="700" width="500" height="120" rx="16" fill="#0f172a" stroke="#334155" stroke-width="2"/>
      <text x="400" y="750" text-anchor="middle" fill="#f8fafc" font-family="system-ui, sans-serif" font-size="24" font-weight="800">
        End of Chapter ${chapter}
      </text>
      <text x="400" y="785" text-anchor="middle" fill="#38bdf8" font-family="system-ui, sans-serif" font-size="16" font-weight="600">
        Click "Next Chapter" to continue reading Chapter ${chapterNext}!
      </text>
    `;
  } else {
    // Intermediate comic panel page
    const panelY1 = 80;
    const panelH1 = 480;
    const panelY2 = 620;
    const panelH2 = 480;

    panelContent = `
      <rect width="100%" height="100%" fill="#090d16"/>
      
      <!-- Panel 1 -->
      <g>
        <rect x="40" y="${panelY1}" width="720" height="${panelH1}" rx="12" fill="url(#bgGrad)" stroke="#334155" stroke-width="2"/>
        <!-- Action Lines -->
        <line x1="40" y1="80" x2="760" y2="560" stroke="${auraColor}" stroke-width="2" opacity="0.3"/>
        <line x1="760" y1="80" x2="40" y2="560" stroke="${auraColor}" stroke-width="2" opacity="0.3"/>
        
        <!-- Energy Aura -->
        <circle cx="${300 + (page * 20) % 200}" cy="320" r="120" fill="${auraColor}" opacity="0.25" filter="url(#blur)"/>
        
        <!-- Dialogue Bubble -->
        <path d="M 80 130 Q 80 100 110 100 L 520 100 Q 550 100 550 130 L 550 190 Q 550 220 520 220 L 220 220 L 180 250 L 190 220 L 110 220 Q 80 220 80 190 Z" fill="#0f172a" stroke="${auraColor}" stroke-width="2"/>
        <text x="315" y="150" text-anchor="middle" fill="#ffffff" font-family="system-ui, sans-serif" font-size="18" font-weight="700">
          Page ${escapeXml(page)}: "Unleashing the ${escapeXml(genre)} aura power!"
        </text>
        <text x="315" y="180" text-anchor="middle" fill="#cbd5e1" font-family="system-ui, sans-serif" font-size="14">
          The power level is increasing exponentially...
        </text>

        <!-- SFX Text -->
        <text x="620" y="420" text-anchor="middle" fill="#fef08a" font-family="Impact, sans-serif" font-size="48" transform="rotate(-15 620 420)">
          ${page % 2 === 0 ? 'WHAM!' : 'KRAKOOM!'}
        </text>
      </g>

      <!-- Panel 2 -->
      <g>
        <rect x="40" y="${panelY2}" width="720" height="${panelH2}" rx="12" fill="#020617" stroke="#334155" stroke-width="2"/>
        
        <path d="M100,680 L700,680 L600,1020 L200,1020 Z" fill="${auraColor}" opacity="0.1"/>
        
        <!-- Bottom Speech Bubble -->
        <path d="M 220 700 Q 220 670 250 670 L 680 670 Q 710 670 710 700 L 710 760 Q 710 790 680 790 L 400 790 L 360 820 L 370 790 L 250 790 Q 220 790 220 760 Z" fill="#1e293b" stroke="${accentColor}" stroke-width="2"/>
        <text x="465" y="720" text-anchor="middle" fill="#f8fafc" font-family="system-ui, sans-serif" font-size="18" font-weight="700">
          "Observe closely! This is the ultimate stage!"
        </text>
        <text x="465" y="750" text-anchor="middle" fill="#94a3b8" font-family="system-ui, sans-serif" font-size="14">
          [ Reading Chapter ${chapter} • Panel ${page} of ${totalPages} ]
        </text>

        <circle cx="400" cy="940" r="60" fill="${accentColor}" opacity="0.3"/>
      </g>

      <text x="400" y="1160" text-anchor="middle" fill="#64748b" font-family="sans-serif" font-size="14" font-weight="600">
        Graywood Reader and Tracker • Page ${page} / ${totalPages}
      </text>
    `;
  }

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}">
      <defs>
        <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${bgGrad1}"/>
          <stop offset="100%" stop-color="${bgGrad2}"/>
        </linearGradient>
        <linearGradient id="auraGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="${auraColor}" stop-opacity="0.9"/>
          <stop offset="100%" stop-color="${accentColor}" stop-opacity="0.2"/>
        </linearGradient>
        <filter id="blur" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="25"/>
        </filter>
      </defs>
      ${panelContent}
    </svg>
  `;

  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  // Never render as a document on direct navigation (defense-in-depth vs SVG script execution)
  res.setHeader('Content-Disposition', 'attachment; filename="panel.svg"');
  res.send(svg);
});

// Mark Chapter as Read
app.post("/api/reader/mark-read", (req, res) => {
  const { mangaId, chapterNumber } = req.body || {};
  const manga = SqliteDb.getMangaById(String(mangaId)) || mangaDatabase.find((m) => m.id === mangaId);
  if (!manga) {
    return res.status(404).json({ error: "Manga not found" });
  }

  const userId = resolveRequestUserId(req) || 'usr_guest';
  const newChapterNum = Math.max(Number(chapterNumber) || 1, 0);
  SqliteDb.setUserLibraryChapter(userId, manga.id, newChapterNum, {
    status: manga.status === 'plan_to_read' ? 'reading' : manga.status,
  });
  // Keep page-level progress row in sync for resume
  SqliteDb.upsertReadingProgress({
    manga_id: manga.id,
    user_id: userId,
    chapter_number: newChapterNum,
    page_index: 0,
    percent: 100,
  });

  try {
    SqliteDb.recordReadingActivity(userId, { chaptersRead: 1 });
  } catch (err) {
    console.error('[Progress Engine] Failed to record reading activity:', err);
  }

  const updatedItem = SqliteDb.applyUserOverlay([manga], userId)[0];
  res.json({ success: true, manga: updatedItem });
});

// =============================================================
// READING PROGRESS & ACTIVITY PERSISTENCE API
// =============================================================
// Borrowed from Kotatsu's HistoryEntity model: store a per-user, per-chapter
// reading position so readers can RESUME mid-chapter, and persist per-day
// activity so the analytics/heatmap show real data instead of mock values.

function resolveProgressUserId(req: express.Request): string {
  // Anonymous remote writes land in the shared guest bucket — NEVER on the
  // host admin's personal progress/favorites.
  return resolveRequestUserId(req) || 'usr_guest';
}

// Save (or update) the current reading position for a manga/chapter.
app.post("/api/reader/progress", (req, res) => {
  const { mangaId, chapterNumber, pageIndex, pageCount, percent } = req.body || {};
  if (!mangaId || chapterNumber === undefined) {
    return res.status(400).json({ error: 'mangaId and chapterNumber are required' });
  }
  const userId = resolveProgressUserId(req);

  SqliteDb.upsertReadingProgress({
    manga_id: String(mangaId),
    user_id: userId,
    chapter_number: Number(chapterNumber) || 0,
    page_index: Number(pageIndex),
    page_count: Number(pageCount),
    percent: Number(percent),
  });

  // Per-user library chapter (do NOT clobber global catalog currentChapter)
  try {
    const ch = Number(chapterNumber) || 0;
    SqliteDb.setUserLibraryChapter(userId, String(mangaId), ch);
  } catch (err) {
    console.error('[Progress Engine] Failed to mirror progress onto user library state:', err);
  }

  res.json({ success: true });
});

// Get the resume position(s) for a manga (all stored chapters for the user).
app.get("/api/reader/history/:mangaId", (req, res) => {
  const { mangaId } = req.params;
  const userId = resolveProgressUserId(req);
  const rows = SqliteDb.getReadingProgress(String(mangaId), userId);
  res.json(rows);
});

// Get the "Continue Reading" list: most-recently-read manga for the user.
app.get("/api/reader/history", (req, res) => {
  const userId = resolveProgressUserId(req);
  const all = SqliteDb.getAllManga();
  const map = new Map<string, any>();
  for (const m of all) {
    const prog = SqliteDb.getReadingProgress(m.id, userId);
    for (const p of prog) {
      const rec = map.get(m.id);
      if (!rec || (p.last_read_at || '') > (rec.last_read_at || '')) {
        map.set(m.id, { manga: m, progress: p });
      }
    }
  }
  const list = [...map.values()]
    .sort((a, b) => (b.progress.last_read_at || '').localeCompare(a.progress.last_read_at || ''))
    .slice(0, 50);
  res.json(list);
});

// Get real reading analytics (per-day activity) for the active user, converted
// into the ReadingAnalytics shape (streaks, totals, heatmap).
app.get("/api/reader/analytics", (req, res) => {
  const userId = resolveProgressUserId(req);
  const rows = SqliteDb.getReadingActivity(userId);
  let totalChaptersRead = 0;
  let totalTimeMinutes = 0;
  for (const r of rows) {
    totalChaptersRead += Number(r.chapters_read) || 0;
    totalTimeMinutes += Number(r.minutes_spent) || 0;
  }

  const dayMap = new Map<string, number>();
  for (const r of rows) dayMap.set(r.date, Number(r.chapters_read) || 0);
  const dates = [...dayMap.keys()].sort();

  // Favorite genre: most common genre across the user's personal library
  // (favorites & in-progress series weigh more), mirroring the recommendation
  // weighting used by the frontend.
  const genreScore = new Map<string, number>();
  for (const m of SqliteDb.applyUserOverlay(SqliteDb.getAllManga(), userId)) {
    const weight = (m.isFavorite ? 3 : 0) + (m.status === 'reading' ? 2 : 0) + 1;
    for (const g of m.genres || []) {
      genreScore.set(g, (genreScore.get(g) || 0) + weight);
    }
  }
  const favoriteGenre = [...genreScore.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';

  // Current streak: trailing consecutive days with activity, ending today.
  const today = new Date().toISOString().substring(0, 10);
  let currentStreak = 0;
  let cursor = today;
  for (let i = 0; i < 3650; i++) {
    if (dayMap.has(cursor)) { currentStreak++; cursor = prevDate(cursor); }
    else break;
  }

  // Longest streak across all recorded days.
  let longestStreak = 0;
  let run = 0;
  for (const d of dates) {
    if (dayMap.has(d)) { run++; longestStreak = Math.max(longestStreak, run); }
    else run = 0;
  }

  res.json({
    currentStreakDays: currentStreak,
    longestStreakDays: longestStreak,
    totalChaptersRead,
    totalTimeMinutes,
    favoriteGenre,
    activities: rows.map((r) => {
      const chapters = Number(r.chapters_read) || 0;
      return {
        date: r.date,
        chaptersRead: chapters,
        minutesSpent: Number(r.minutes_spent) || 0,
        level: clamp(0, 4, chapters),
      };
    }),
  });
});

function prevDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().substring(0, 10);
}
function clamp(min: number, max: number, v: number): number {
  return Math.min(max, Math.max(min, v));
}

// Default App & Kotatsu Reader Settings in Server Memory
// =========================================================
// SETTINGS FIELD WHITELIST — defense-in-depth. POST /api/settings is already
// host-only, but no client (or malformed backup file) may ever inject keys
// outside these lists into persisted app state.
// =========================================================
const SETTINGS_ALLOWED_KEYS = new Set<string>([
  'appTheme', 'libraryLayout', 'gridColumns', 'autoMarkReadPercent',
  'enableDownloadOffline', 'sourceTimeoutSeconds',
  'anilistConnected', 'anilistToken', 'anilistAutoSync',
  'malConnected', 'malToken', 'malAutoSync',
  'kitsuConnected', 'kitsuToken', 'kitsuAutoSync',
  'mangadexConnected', 'privateModeEnabled', 'customUserAgent',
  'enableCloudflareBypass', 'flareSolverrUrl', 'captchaSolverEnabled',
  'captchaApiKey', 'stealthMode', 'preferredLanguage',
  'autoFormatReadingMode', 'defaultMangaMode', 'defaultManhwaMode',
  'defaultManhuaMode', 'readerDefaults',
]);
const READER_DEFAULTS_ALLOWED_KEYS = new Set<string>([
  'viewMode', 'maxWidth', 'pageGap', 'bgColor', 'zoomLevel', 'autoMarkRead',
  'imageFilter', 'autoScrollEnabled', 'autoScrollSpeed', 'tapZonesEnabled',
  'cropWhiteMargins', 'showPageNumberOverlay', 'showPersistentPageBadge',
  'autoNextChapter', 'mangaFitMode', 'preloadCount', 'autoFormatMode',
  'rememberPerSeries', 'guidedPanelView', 'noPanelSpacing', 'prefetchNextChapter',
]);
const CONFIG_ALLOWED_KEYS = new Set<string>([
  'subdomain', 'autoUpdateIntervalMinutes', 'enableWebCrawling', 'sources',
  'disabledSources', 'removedSources', 'reactivatedSources', 'lastSyncTime', 'totalTracked',
]);
// Sentinel returned in place of the real captcha API key whenever settings
// leave the server. Clients/backup files that send it back mean "no change".
const MASKED_SECRET = '••••••••';

function sanitizeIncomingSettings(raw: any): Record<string, any> {
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
  return clean;
}

function sanitizeIncomingConfig(raw: any): Record<string, any> {
  const clean: Record<string, any> = {};
  if (!raw || typeof raw !== 'object') return clean;
  for (const key of Object.keys(raw)) {
    if (CONFIG_ALLOWED_KEYS.has(key)) clean[key] = raw[key];
  }
  return clean;
}

let appSettings = {
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
  privateModeEnabled: false,
  customUserAgent: 'Kotatsu/4.8.2 (Android 14; Mobile; Graywood-Reader)',
  // Automated Cloudflare & Captcha Solver Config
  enableCloudflareBypass: true,
  flareSolverrUrl: 'http://localhost:8191/v1',
  captchaSolverEnabled: true,
  captchaApiKey: '', // 2Captcha / CapSolver API key
  stealthMode: true,
  readerDefaults: {
    viewMode: 'webtoon',
    maxWidth: '850px',
    pageGap: 8,
    bgColor: 'slate',
    zoomLevel: 100,
    autoMarkRead: true,
    imageFilter: 'normal',
    autoScrollEnabled: false,
    autoScrollSpeed: 1, // 0.5, 1, 1.5, 2, 2.5, 3
    tapZonesEnabled: true,
    cropWhiteMargins: true,
    showPageNumberOverlay: true,
    showPersistentPageBadge: true,
    autoNextChapter: true,
    mangaFitMode: 'fit-height',
    preloadCount: 3,
  },
};

// Automated Cloudflare & Captcha Bypass Crawler Route
app.post('/api/crawler/bypass-fetch', async (req, res) => {
  const { targetUrl } = req.body;
  if (!targetUrl) return res.status(400).json({ error: 'targetUrl is required' });

  // SSRF guard: crawler targets must be public http(s) hosts (never LAN/metadata IPs)
  try {
    await assertSafeProxyTarget(String(targetUrl));
  } catch (err: any) {
    console.warn(`[Cloudflare Bypass Engine] Blocked unsafe crawler target: ${err?.message || err}`);
    return res.status(403).json({ error: 'Blocked crawler target', message: String(err?.message || err) });
  }

  try {
    console.log(`[Cloudflare Bypass Engine] Fetching target URL: ${targetUrl}`);

    // Method 1: Try FlareSolverr Automated Cloudflare Challenge Solver Proxy
    if (appSettings.enableCloudflareBypass && appSettings.flareSolverrUrl) {
      try {
        const solverRes = await fetch(appSettings.flareSolverrUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cmd: 'request.get',
            url: targetUrl,
            maxTimeout: appSettings.sourceTimeoutSeconds * 1000,
          }),
        });

        if (solverRes.ok) {
          const solverData: any = await solverRes.json();
          if (solverData.status === 'ok' && solverData.solution) {
            console.log(`[Cloudflare Bypass Engine] FlareSolverr solved Cloudflare challenge successfully!`);
            return res.json({
              success: true,
              methodUsed: 'FlareSolverr Cloudflare Bypass',
              cookies: solverData.solution.cookies,
              userAgent: solverData.solution.userAgent,
              htmlContent: solverData.solution.response,
            });
          }
        }
      } catch (solverErr) {
        console.warn(`[Cloudflare Bypass Engine] FlareSolverr local service not running or timed out. Falling back to direct stealth engine...`);
      }
    }

    // Method 2: Direct Stealth Proxy with Chrome User-Agent & Referer Headers
    // (redirect-safe: every hop is re-validated against the SSRF guard)
    const directRes = await fetchWithSsrfGuard(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': new URL(targetUrl).origin,
      },
    });

    const htmlText = await directRes.text();
    return res.json({
      success: true,
      methodUsed: 'Stealth Browser Engine',
      statusCode: directRes.status,
      htmlContent: htmlText,
    });

  } catch (err: any) {
    console.error(`[Cloudflare Bypass Engine] Error bypassing challenge:`, err);
    res.status(500).json({ error: 'Failed to bypass Cloudflare challenge', details: err.message });
  }
});

// Automated Solver Status Testing & Balance Check Endpoints
app.post("/api/solver/test-flaresolverr", async (req, res) => {
  const testUrl = req.body?.url || appSettings.flareSolverrUrl || "http://localhost:8191/v1";
  try {
    const result = await solveWithFlareSolverr("https://nowsecure.nl", testUrl, 15);
    res.json({
      success: result.ok,
      status: result.status,
      latencyMs: result.responseTimeMs,
      message: result.ok ? "FlareSolverr connection verified and active!" : (result.error || "Failed to solve challenge"),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/solver/check-balance", async (req, res) => {
  const key = req.body?.apiKey || appSettings.captchaApiKey;
  if (!key) {
    return res.status(400).json({ success: false, error: "No API key configured" });
  }
  try {
    const result = await checkSolverBalance(key, req.body?.provider || "auto");
    res.json({
      success: result.ok,
      provider: result.provider,
      balance: result.balance,
      currency: result.currency,
      error: result.error,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// OPDS 1.2 CATALOG SERVER (FOR E-READERS: KOBO, MOON+ READER, PANELS, PAPERBACK)
// ============================================================================
// All OPDS endpoints (/api/opds/catalog.xml, /api/opds/search,
// /api/opds/series/:id, /api/opds/local/:id) live in server/routes/opds.ts.
// The duplicate catalog.xml & series handlers that used to sit here were
// unreachable (opdsRouter is mounted first) and have been removed.

// ============================================================================
// HIGH-PERFORMANCE IMAGE PROXY WITH ETAGS & IMMUTABLE CACHING
// ============================================================================

// Sticky notes and GDPR routes are handled by the scoped routers
// (server/routes/notes.ts) and by the host-gated handlers below.



// GDPR Article 15: Right to Access & Data Portability Export
app.get("/api/gdpr/export-data/:userId", (req, res) => {
  // Without a real session/token system, GDPR data operations are host-only.
  if (!isHostRequest(req)) {
    return res.status(403).json({ error: "Forbidden", message: "GDPR data operations are restricted to the host computer." });
  }
  const { userId } = req.params;
  const user = userProfiles.find((u) => u.id === userId);
  if (!user) return res.status(404).json({ error: "User not found" });

  const userSeries = mangaDatabase.filter((m) => m.userId === userId);
  // Complete Article 15 bundle: profile + owned series + ALL per-user tables
  // (favorites, library state, page-level reading position, daily activity).
  const libraryState = Array.from(SqliteDb.getUserLibraryStateMap(userId).entries()).map(
    ([mangaId, state]) => ({ mangaId, ...state })
  );
  const gdprExportBundle = {
    complianceNotice: "GDPR Article 15 Data Portability Export",
    exportTimestamp: new Date().toISOString(),
    personalData: toPublicUser(user),
    userMangaLibrary: userSeries,
    favorites: Array.from(SqliteDb.getUserFavoriteIds(userId)),
    libraryState,
    readingProgress: SqliteDb.getAllReadingProgressForUser(userId),
    readingActivity: SqliteDb.getReadingActivity(userId),
  };

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="gdpr_export_${userId}.json"`);
  res.send(JSON.stringify(gdprExportBundle, null, 2));
});

// GDPR Article 17: Right to Erasure / Right to be Forgotten
app.delete("/api/gdpr/erase-data/:userId", (req, res) => {
  // Without a real session/token system, GDPR data operations are host-only.
  if (!isHostRequest(req)) {
    return res.status(403).json({ error: "Forbidden", message: "GDPR data operations are restricted to the host computer." });
  }
  const { userId } = req.params;
  if (userId === 'usr_admin' || userId === 'usr_guest') {
    return res.status(403).json({
      error: "Forbidden",
      message: "Host Administrator and Permanent Guest Reader accounts cannot be erased via GDPR endpoint.",
    });
  }
  const user = userProfiles.find((u) => u.id === userId);
  if (!user) return res.status(404).json({ error: "User not found" });

  const result = SqliteDb.purgeUserData(userId);
  userProfiles = userProfiles.filter((u) => u.id !== userId);
  mangaDatabase = SqliteDb.getAllManga();
  syncConfig.totalTracked = mangaDatabase.length;
  saveDatabaseToDisk();
  console.log(`[GDPR Engine] User ${userId} erased. Purged ${result.mangaDeleted} owned series + reading data from SQLite.`);
  res.json({
    success: true,
    message: "All user PII and library data permanently erased in compliance with GDPR Article 17.",
    mangaDeleted: result.mangaDeleted,
  });
});

// GET Settings
app.get("/api/settings", (req, res) => {
  // Secrets never leave the server in plaintext: the captcha API key is
  // replaced by a mask sentinel for EVERY caller (host UI included — the
  // password input shows it as set without exposing the value).
  res.json({
    ...appSettings,
    captchaApiKey: appSettings.captchaApiKey ? MASKED_SECRET : '',
  });
});


// POST Update Settings (host-only; whitelisted fields only)
app.post("/api/settings", (req, res) => {
  if (req.body) {
    const clean = sanitizeIncomingSettings(req.body);
    appSettings = {
      ...appSettings,
      ...clean,
      readerDefaults: {
        ...appSettings.readerDefaults,
        ...(clean.readerDefaults || {}),
      },
    };
    saveDatabaseToDisk();
  }
  res.json({
    success: true,
    settings: {
      ...appSettings,
      captchaApiKey: appSettings.captchaApiKey ? MASKED_SECRET : '',
    },
  });
});

// Export Backup JSON (host-only — see SENSITIVE_GET_PATHS)
app.get("/api/settings/backup/export", (req, res) => {
  const backup = {
    version: `${APP_VERSION}-kotatsu`,
    exportedAt: new Date().toISOString(),
    mangaDatabase: SqliteDb.getAllManga(),
    config: syncConfig,
    // Secret material is masked in exports; import keeps the existing key.
    appSettings: {
      ...appSettings,
      captchaApiKey: appSettings.captchaApiKey ? MASKED_SECRET : '',
    },
  };

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="graywood_reader_backup.json"');
  res.send(JSON.stringify(backup, null, 2));
});

// Import Backup JSON (host-only; all incoming keys whitelisted)
app.post("/api/settings/backup/import", (req, res) => {
  try {
    const { mangaDatabase: importedManga, config: importedConfig, appSettings: importedSettings } = req.body;
    if (Array.isArray(importedManga)) {
      syncBulkAddOrUpdateManga(importedManga);
    }
    if (importedConfig) {
      const cleanConfig = sanitizeIncomingConfig(importedConfig);
      syncConfig = { ...syncConfig, ...cleanConfig, totalTracked: mangaDatabase.length };
      if (Array.isArray(cleanConfig.disabledSources)) {
        disabledSourceIds.clear();
        cleanConfig.disabledSources.forEach((id: string) => disabledSourceIds.add(String(id)));
      }
    }
    if (importedSettings) {
      const cleanSettings = sanitizeIncomingSettings(importedSettings);
      appSettings = {
        ...appSettings,
        ...cleanSettings,
        readerDefaults: {
          ...appSettings.readerDefaults,
          ...(cleanSettings.readerDefaults || {}),
        },
      };
    }
    saveDatabaseToDisk();
    res.json({ success: true, count: SqliteDb.getMangaCount() });
  } catch (err: any) {
    res.status(400).json({ error: "Invalid backup format" });
  }
});


// Clear Cache Endpoint — flushes ALL in-memory caches (Kotatsu page-list, image/temp buffers)
app.post("/api/settings/cache/clear", (req, res) => {
  const before = kotatsuImageEngine.size();
  kotatsuImageEngine.clearCache();
  res.json({
    success: true,
    message: `All caches cleared: Kotatsu page-list cache flushed (${before} entries), scanlation image cache and temporary canvas buffers cleared. Caches rebuild on next request.`,
    clearedEntries: before,
  });
});

// Host PC Client Context Endpoint
app.get("/api/auth/client-context", (req, res) => {
  const isHost = isHostRequest(req);
  const clientIp = (req.ip || req.socket.remoteAddress || '127.0.0.1').replace(/^::ffff:/, '');
  res.json({
    isHost,
    clientIp,
    defaultRole: isHost ? 'admin' : 'guest',
  });
});

// Login: exchange a username/email + password for a signed token.
// Available regardless of REQUIRE_AUTH (host can always mint tokens; remote
// clients need this to gain access once auth is enabled).
app.post("/api/auth/login", async (req, res) => {
  const clientIp = (req.ip || req.socket?.remoteAddress || '127.0.0.1').replace(/^::ffff:/, '');

  const { username, email, password } = req.body || {};
  const identifier = String(username || email || '').trim().toLowerCase();
  const pass = String(password || '');

  // Per-account lockout applies to EVERY caller (also protects against
  // distributed brute force across many IPs).
  const accountBlock = checkAccountLockout(identifier);
  if (accountBlock) {
    logger.warn('Auth', `Login blocked: account "${identifier}" is locked`, { retryAfterSeconds: accountBlock.retryAfterSeconds });
    return res.status(429).json({
      error: 'Too Many Requests',
      message: accountBlock.message,
      retryAfterSeconds: accountBlock.retryAfterSeconds,
    });
  }

  // Login brute-force rate limiting (skipped for host/localhost)
  if (clientIp !== '127.0.0.1' && clientIp !== '::1') {
    const block = checkLoginRateLimit(clientIp);
    if (block) {
      logger.warn('Auth', `Login blocked for IP ${clientIp}`, { retryAfterSeconds: block.retryAfterSeconds });
      return res.status(429).json({
        error: 'Too Many Requests',
        message: block.message,
        retryAfterSeconds: block.retryAfterSeconds,
      });
    }
  }

  if (!identifier || !pass) {
    return res.status(400).json({ error: 'Bad Request', message: 'username/email and password are required.' });
  }

  const user = userProfiles.find(
    (u) => (u.username || '').toLowerCase() === identifier || (u.email || '').toLowerCase() === identifier
  );
  if (!user || !user.password) {
    recordLoginFailure(clientIp);
    recordAccountFailure(identifier);
    logger.warn('Auth', `Failed login attempt for "${identifier}" from ${clientIp}`);
    return res.status(401).json({ error: 'Unauthorized', message: 'Invalid credentials.' });
  }

  const ok = await verifyPasswordAsync(pass, user.password);
  if (!ok) {
    recordLoginFailure(clientIp);
    recordAccountFailure(identifier);
    logger.warn('Auth', `Failed login attempt for "${user.username}" (bad password) from ${clientIp}`);
    return res.status(401).json({ error: 'Unauthorized', message: 'Invalid credentials.' });
  }

  // Successful login — clear any prior failure records (IP + account)
  clearLoginFailures(clientIp);
  clearAccountFailures(identifier);
  logger.info('Auth', `User "${user.username}" logged in from ${clientIp}`);

  const token = signAuthToken({ sub: user.id, role: user.role });
  res.json({
    token,
    expiresInMs: AUTH_TOKEN_TTL_MS,
    user: toPublicUser(user),
  });
});

// Logout: revoke the presented token (jti) so it stops verifying immediately.
app.post("/api/auth/logout", (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (token) {
    const payload = verifyAuthToken(token);
    if (payload && typeof payload.jti === 'string') {
      revokeAuthToken(payload.jti);
      logger.info('Auth', `Token ${payload.jti} revoked via logout (user ${String(payload.sub || '?')})`);
    }
  }
  res.json({ success: true });
});

// Register a new user account. Passwords are scrypt-hashed before storage.
// Role is never taken from the client (always 'user' unless first real account on host).
app.post("/api/auth/register", (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  const username = String(body.username || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const avatar = String(body.avatar || '🥷').trim() || '🥷';

  if (!name || !username || !email || !password) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'name, username, email, and password are required.',
    });
  }
  if (password.length < 8) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Password must be at least 8 characters.',
    });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Bad Request', message: 'A valid email address is required.' });
  }

  const usernameLc = username.toLowerCase();
  const taken = userProfiles.some(
    (u) =>
      (u.username || '').toLowerCase() === usernameLc ||
      (u.email || '').toLowerCase() === email
  );
  if (taken) {
    return res.status(409).json({
      error: 'Conflict',
      message: 'Username or email is already registered.',
    });
  }

  const realUsers = userProfiles.filter((u) => u.id !== 'usr_admin' && u.id !== 'usr_guest');
  const role: UserRole =
    realUsers.length === 0 && isHostRequest(req) ? 'admin' : 'user';

  const newUser: UserProfile = {
    id: 'usr_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex'),
    name,
    username,
    email,
    password: hashPassword(password),
    avatar,
    role,
    createdAt: new Date().toISOString(),
  };

  userProfiles.push(newUser);
  saveDatabaseToDisk();

  const regToken = signAuthToken({ sub: newUser.id, role: newUser.role });
  logger.info('Auth', `Registered user ${newUser.username} (${newUser.id}) role=${newUser.role}`);
  res.status(201).json({
    token: regToken,
    expiresInMs: AUTH_TOKEN_TTL_MS,
    user: toPublicUser(newUser),
  });
});

// Public profile list (never includes password hashes). Emails are PII:
// only the host or the profile's owner may see them — everyone else gets an
// empty string instead of a full account enumeration surface.
app.get("/api/profiles", (req, res) => {
  const actor = (req as any).user as UserProfile | null;
  const hostCaller = isHostRequest(req);
  res.json(userProfiles.map((u) => {
    const pub = toPublicUser(u);
    if (!hostCaller && actor?.id !== u.id) pub.email = '';
    return pub;
  }));
});

// Return the currently authenticated user (or null). Never requires auth.
app.get("/api/auth/me", (req, res) => {
  const user = (req as any).user as UserProfile | null;
  res.json({
    authenticated: !!user,
    authEnabled: AUTH_ENABLED,
    user: user ? toPublicUser(user) : null,
  });
});

// Restrict all Admin operations strictly to the Host Computer
app.use("/api/admin", (req, res, next) => {
  if (!isHostRequest(req)) {
    return res.status(403).json({
      error: "Forbidden",
      message: "Admin functionality is strictly restricted to the host computer.",
    });
  }
  next();
});

// ==========================================
// ADMIN USER MANAGEMENT & DOUBLE CONFIRMATION
// ==========================================

// Get All Users List (Admin) — public DTOs only (no password hashes)
app.get("/api/admin/users", (_req, res) => {
  res.json(userProfiles.map(toPublicUser));
});

// Admin User Role Promotion/Demotion
app.post("/api/admin/users/promote", (req, res) => {
  const { userId, role } = req.body || {};
  if (!userId || !role) return res.status(400).json({ error: "userId and role are required" });

  if (userId === 'usr_admin' || userId === 'usr_guest') {
    return res.status(403).json({ error: "Host Administrator and Permanent Guest Reader accounts cannot be demoted." });
  }

  const idx = userProfiles.findIndex((u) => u.id === userId);
  if (idx === -1) return res.status(404).json({ error: "User not found" });

  userProfiles[idx].role = role as UserRole;
  saveDatabaseToDisk();
  logger.info('Admin', `User ${userProfiles[idx].name} (${userId}) role updated to ${role}.`);
  res.json({ success: true, user: toPublicUser(userProfiles[idx]) });
});

// Admin Delete User with MANDATORY Double Confirmation
app.delete("/api/admin/users/:userId", (req, res) => {
  const { userId } = req.params;
  const { confirm } = req.body || {};

  // Check mandatory double confirmation payload
  if (confirm !== true) {
    return res.status(400).json({
      error: "Mandatory double-confirmation required. Set 'confirm: true' in request body to delete user account.",
      requiresConfirmation: true,
    });
  }

  const user = userProfiles.find((u) => u.id === userId);
  if (!user) {
    return res.status(404).json({ error: "User profile not found." });
  }

  if (user.id === 'usr_admin' || user.id === 'usr_guest' || user.role === 'admin') {
    return res.status(403).json({ error: "Host Administrator and Permanent Guest Reader accounts are protected and non-deletable." });
  }

  // Cascade purge in SQLite (profile + owned manga + reading progress/activity)
  const result = SqliteDb.purgeUserData(userId);
  userProfiles = userProfiles.filter((u) => u.id !== userId);
  mangaDatabase = SqliteDb.getAllManga();
  syncConfig.totalTracked = mangaDatabase.length;
  saveDatabaseToDisk();
  logger.info('Admin', `User "${user.name}" (${userId}) permanently deleted after double-confirmation. (${result.mangaDeleted} library records purged from SQLite)`);

  res.json({
    success: true,
    message: `User account '${user.name}' and ${result.mangaDeleted} associated library records permanently deleted.`,
    deletedUserId: userId,
    remainingUsers: userProfiles.map(toPublicUser),
  });
});

// ==========================================
// BUG TRACKING & BUGS.MD PERSISTENCE
// ==========================================

const BUGS_FILE_PATH = path.join(process.cwd(), "BUGS.md");

// Submit Bug Endpoint -> Appends directly to BUGS.md
app.post("/api/bugs/submit", (req, res) => {
  // Writing to a repo file is global state: host or authenticated users only
  // (prevents anonymous remote clients from growing BUGS.md without bound).
  if (!canWriteCatalog(req)) return rejectCatalogWrite(res);
  const {
    title,
    priority,
    file,
    description,
    stepsToReproduce,
    expected,
    actual,
    autoFix,
    user,
  } = req.body || {};

  if (!title || !description) {
    return res.status(400).json({ error: "Title and description are required to submit a bug report." });
  }

  try {
    let bugsMarkdown = fs.existsSync(BUGS_FILE_PATH)
      ? fs.readFileSync(BUGS_FILE_PATH, "utf-8")
      : `# 🐛 ManhuaSync Bug Tracker\n\n## Active Bugs\n\n`;

    // Calculate next BUG-XXX ID
    const bugIdMatches = Array.from(bugsMarkdown.matchAll(/\[BUG-(\d+)\]/g));
    let nextNum = 1;
    if (bugIdMatches.length > 0) {
      const nums = bugIdMatches.map((m) => parseInt(m[1], 10)).filter((n) => !isNaN(n));
      if (nums.length > 0) {
        nextNum = Math.max(...nums) + 1;
      }
    }
    const bugId = `BUG-${String(nextNum).padStart(3, '0')}`;

    const formattedSteps = stepsToReproduce
      ? (Array.isArray(stepsToReproduce) ? stepsToReproduce.map((s: string, i: number) => `  ${i + 1}. ${s}`).join('\n') : `  1. ${stepsToReproduce}`)
      : `  1. Open application\n  2. Trigger reported scenario`;

    const newBugEntry = `
### [${bugId}] ${title.trim()}
- **Status**: \`open\`
- **Priority**: \`${priority || 'medium'}\`
- **Auto-fix**: \`${autoFix || 'ask'}\`
- **File(s)**: \`${file || 'server.ts'}\`
- **Submitted-By**: ${user || 'User'} (${new Date().toISOString().substring(0, 10)})
- **Description**: ${description.trim()}
- **Steps to Reproduce**:
${formattedSteps}
- **Expected**: ${expected || 'Action completes without error.'}
- **Actual**: ${actual || 'Issue occurs as described.'}
`;

    // Append under ## Active Bugs section
    if (bugsMarkdown.includes("## Active Bugs")) {
      bugsMarkdown = bugsMarkdown.replace("## Active Bugs", `## Active Bugs\n${newBugEntry}`);
    } else {
      bugsMarkdown += `\n${newBugEntry}`;
    }

    fs.writeFileSync(BUGS_FILE_PATH, bugsMarkdown, "utf-8");
    console.log(`[Bug Tracker Engine] Successfully logged new bug [${bugId}] to BUGS.md: "${title}"`);

    res.status(201).json({
      success: true,
      bugId,
      message: `Bug report [${bugId}] saved successfully to BUGS.md!`,
      entry: newBugEntry,
    });
  } catch (err: any) {
    console.error("[Bug Tracker Engine] Error writing bug to BUGS.md:", err);
    res.status(500).json({ error: "Failed to save bug report to BUGS.md", details: err.message });
  }
});

// GET Bugs from BUGS.md
app.get("/api/bugs", (_req, res) => {
  try {
    if (!fs.existsSync(BUGS_FILE_PATH)) {
      return res.json([]);
    }

    const bugsMarkdown = fs.readFileSync(BUGS_FILE_PATH, "utf-8");
    const bugBlocks = bugsMarkdown.split(/###\s+\[BUG-/g).slice(1);

    const bugs = bugBlocks.map((block) => {
      const firstLineEnd = block.indexOf('\n');
      const headerText = block.substring(0, firstLineEnd).trim();
      const idMatch = headerText.match(/^(\d+)\]\s*(.*)/);
      const bugId = idMatch ? `BUG-${idMatch[1]}` : 'BUG-000';
      const title = idMatch ? idMatch[2] : headerText;

      const statusMatch = block.match(/-\s*\*\*Status\*\*:\s*`([^`]+)`/);
      const priorityMatch = block.match(/-\s*\*\*Priority\*\*:\s*`([^`]+)`/);
      const fileMatch = block.match(/-\s*\*\*File\(s\)\*\*:\s*`([^`]+)`/);
      const descMatch = block.match(/-\s*\*\*Description\*\*:\s*([^\n]+)/);

      return {
        id: bugId,
        title,
        status: statusMatch ? statusMatch[1] : 'open',
        priority: priorityMatch ? priorityMatch[1] : 'medium',
        file: fileMatch ? fileMatch[1] : 'unknown',
        description: descMatch ? descMatch[1] : '',
      };
    });

    res.json(bugs);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to read BUGS.md", details: err.message });
  }
});


// ==========================================
// VITE MIDDLEWARE SETUP FOR DEV & PROD
// ==========================================

// Fix #21: Capture the HTTP server so graceful shutdown can drain connections.
// IMPORTANT: these must be declared BEFORE startServer() — in production mode
// (dist/ present) the async function body runs synchronously up to app.listen,
// and assigning to a not-yet-declared `let` throws a TDZ ReferenceError at boot.
let httpServer: ReturnType<typeof app.listen> | null = null;
let isShuttingDown = false;

async function startServer() {
  // 1. Fast load persistent database from SQLite
  loadDatabaseFromDisk();

  // 2. Serve built production dist folder if available (ultra-fast sub-10ms response time)
  const distPath = path.join(process.cwd(), "dist");
  if (fs.existsSync(distPath)) {
    // Hashed assets in /dist/assets have content-hash filenames → safe to cache aggressively
    app.use('/assets', (req, res, next) => {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      next();
    });
    app.use(express.static(distPath, { maxAge: "7d", etag: true, index: false }));
    // SPA fallback for all non-API GET routes (Express 4 & 5 compatible)
    app.use((req, res, next) => {
      if (req.method === 'GET' && !req.path.startsWith('/api/')) {
        return res.sendFile(path.join(distPath, "index.html"));
      }
      next();
    });
  } else {
    // Vite is a devDependency — import it dynamically so production builds
    // without dev dependencies never need it at runtime.
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  // 3. Start listening immediately (sub-50ms launch time)
  httpServer = app.listen(PORT, HOST, () => {
    logger.info('Startup', `Graywood Reader v${APP_VERSION} running on http://${HOST}:${PORT}`);
    logger.info('Startup', `SQLite database ready (${mangaDatabase.length} series, ${userProfiles.length} users)`);
  });

  // 4. Non-blocking auto-updater (rate-spaced). The static hard-coded catalog is
  //    not re-seeded here — Explore is populated from live/verified sources only.
  scheduleBackgroundAutoUpdater();

  // 5. Warm the Explore catalog buffer in the background and refresh it on an
  //    interval, so /browse loads are served from memory instead of live scrapes.
  scheduleExploreRefresher();
}

startServer();

// =========================================================
// GRACEFUL SHUTDOWN — flush pending state & write legacy JSON backup
// =========================================================
function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info('Shutdown', `Received ${signal}. Flushing state & writing legacy JSON backup...`);
  try {
    if (saveTimeoutTimer) {
      clearTimeout(saveTimeoutTimer);
      saveTimeoutTimer = null;
    }
    // Final synchronous SQLite flush of app state
    SqliteDb.replaceAllProfiles(buildEncryptedProfiles());
    SqliteDb.setSetting('appSettings', JSON.stringify(buildEncryptedSettings()));
    SqliteDb.setSetting('syncConfig', JSON.stringify(syncConfig));
    SqliteDb.replaceAllLogs(autoUpdateLogs);
    // Portable legacy snapshot (kept for backward compatibility with tooling)
    writeLegacyJsonSnapshot(`graceful shutdown via ${signal}`);
    // Flush outstanding log buffer to disk
    logger.flush();
  } catch (err) {
    logger.error('Shutdown', 'Error while flushing state', { error: String(err) });
  }
  // Close the HTTP server to stop accepting new connections and let in-flight
  // requests drain before exiting. Fall back to immediate exit after 5s.
  if (httpServer) {
    const forceTimer = setTimeout(() => process.exit(0), 5000);
    httpServer.close(() => {
      clearTimeout(forceTimer);
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// ── Adapative Resolution System Implementation Notes ───────────────────────
// 
// The /api/explore endpoint now supports dynamic limit adjustment based on client 
// screen resolution to create a hybrid scaling system:
//
// 1. Client-provided resolution parameters:
//    - width (pixels) 
//    - height (pixels)
//    - If both provided, system calculates a dynamic limit based on screen area
//
// 2. Dynamic limit calculation:
//    - Normalized screen area scaled between 1024px and 3840px minimum/maximum widths
//    - Exponential scaling factor to provide smooth transition from small to large screens
//    - Base limit of 30 series with potential to scale up to 100 series
//
// 3. Device type detection:
//    - Automatically detects mobile devices from User-Agent headers
//    - Caps mobile limits to 40 series or less to prevent overload
//
// Example requests:
// - Large desktop: /api/explore?width=1920&height=1080&limit=30
// - Mobile: /api/explore?width=414&height=896&limit=30
// - Custom limit override: /api/explore?width=1920&height=1080&limit=50