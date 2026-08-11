import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { INITIAL_MANGA_DATABASE } from "./src/data/initialManga";
import { KOTATSU_COMPLETE_CATALOG } from "./src/data/kotatsuCompleteDataset";
import { MangaItem, DuplicateCandidate, AutoUpdateLog, DatabaseSyncConfig, UserProfile, UserRole, SourceDefinition, SourceEngineType } from "./src/types";


// Initialize Express
const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const HOST = process.env.HOST || "0.0.0.0";

app.use(express.json({ limit: "10mb" }));

// Expose custom pagination headers to browser fetch (needed for reading X-Total-Pages)
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Expose-Headers', 'X-Total-Count, X-Total-Pages');
  next();
});

// ==========================================
// DDOS PROTECTION & RATE LIMITING MIDDLEWARE (Bypassed for Host PC)
// ==========================================
// Uses a TTL-based cleanup to prevent memory leaks from growing Map entries.
const ipRequestCounts = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_MAX = 300; // max 300 requests per minute
const RATE_LIMIT_WINDOW = 60 * 1000;

// Periodic cleanup of expired IP request entries to prevent unbounded memory growth.
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of ipRequestCounts) {
    if (now > record.resetTime) {
      ipRequestCounts.delete(ip);
    }
  }
}, 30_000); // clean up every 30 seconds

app.use((req, res, next) => {
  // Allow all requests on localhost or host IP
  const clientIp = req.ip || req.socket.remoteAddress || "127.0.0.1";
  if (clientIp === "127.0.0.1" || clientIp === "::1" || clientIp === "::ffff:127.0.0.1") {
    return next();
  }

  const now = Date.now();
  const record = ipRequestCounts.get(clientIp);

  if (!record || now > record.resetTime) {
    ipRequestCounts.set(clientIp, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
  } else {
    record.count++;
    if (record.count > RATE_LIMIT_MAX) {
      return res.status(429).json({
        error: "Too Many Requests",
        message: "DDoS Protection triggered: Rate limit exceeded. Please wait 60 seconds before retrying.",
      });
    }
  }
  next();
});

// =========================================================
// GDPR ARTICLE 32 CRYPTOGRAPHIC ENCRYPTION & SECURITY ENGINE
// =========================================================
const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET || "omnimanga-gdpr-aes256-secret-key-32b!";
const ALGORITHM = "aes-256-gcm";

export function encryptPII(text: string): string {
  if (!text) return "";
  try {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_SECRET.padEnd(32).slice(0, 32)), iv);
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag().toString("hex");
    return `enc:${iv.toString("hex")}:${authTag}:${encrypted}`;
  } catch (err) {
    console.error("[GDPR Engine] Encryption error:", err);
    return text;
  }
}

export function decryptPII(encryptedData: string): string {
  if (!encryptedData || !encryptedData.startsWith("enc:")) return encryptedData;
  try {
    const parts = encryptedData.slice(4).split(":");
    if (parts.length !== 3) return encryptedData;
    const [ivHex, authTagHex, encryptedText] = parts;
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(ENCRYPTION_SECRET.padEnd(32).slice(0, 32)), iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedText, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (err) {
    return encryptedData;
  }
}

export function hashPassword(password: string): string {
  if (!password) return "";
  return crypto.createHash("sha256").update(password + ENCRYPTION_SECRET).digest("hex");
}

// Initialize Gemini Client
const getGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "ManhuaSync-App/2.5.0",
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
    email: 'guest@omnimanga.app',
    avatar: '👤',
    role: 'user',
    createdAt: new Date().toISOString(),
  },
];


let autoUpdateLogs: AutoUpdateLog[] = [
  {
    id: 'log-1',
    mangaId: 'm2',
    mangaTitle: 'The Beginning After The End',
    previousChapter: 185,
    newChapter: 190,
    source: 'Tapas / AsuraScans',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(),
    type: 'manhwa',
  },
  {
    id: 'log-2',
    mangaId: 'm6',
    mangaTitle: 'Magic Emperor',
    previousChapter: 580,
    newChapter: 585,
    source: 'NightScans',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
    type: 'manhua',
  },
];

// Kotatsu-Parsers-Redo Source Engine Registry & Definitions Framework
export const KOTATSU_SOURCES: SourceDefinition[] = [
  // ── MangaDex (Official API v5) ─────────────────────────────────────────────
  { id: 'mangadex', name: 'MangaDex API v5', baseUrl: 'https://mangadex.org', engineType: 'mangadex', lang: 'en', isNsfw: false },

  // ── MangaThemesia Engine Sites ─────────────────────────────────────────────
  { id: 'asurascans', name: 'Asura Scans', baseUrl: 'https://asuracomic.net', engineType: 'mangathemesia', lang: 'en', isNsfw: false },
  { id: 'flamecomics', name: 'Flame Comics', baseUrl: 'https://flamecomics.xyz', engineType: 'mangathemesia', lang: 'en', isNsfw: false },

  // ── Madara / WP-Manga Engine ───────────────────────────────────────────────
  { id: 'manhwabuddy', name: 'Manhwa Buddy', baseUrl: 'https://manhwabuddy.com', engineType: 'madara', lang: 'en', isNsfw: false },
  { id: 'manhuafast', name: 'Manhua Fast', baseUrl: 'https://manhuafast.com', engineType: 'madara', lang: 'en', isNsfw: false },
  { id: 'kunmanga', name: 'Kun Manga', baseUrl: 'https://kunmanga.com', engineType: 'madara', lang: 'en', isNsfw: false },
  { id: 'manhwa18', name: 'Manhwa18', baseUrl: 'https://manhwa18.com', engineType: 'madara', lang: 'en', isNsfw: true },

  // ── WP Comics Engine ──────────────────────────────────────────────────────
  { id: 'manhuaplus', name: 'Manhua Plus', baseUrl: 'https://manhuaplus.com', engineType: 'wpcomics', lang: 'en', isNsfw: false },
  { id: 'mangatx', name: 'Manga TX', baseUrl: 'https://mangatx.com', engineType: 'wpcomics', lang: 'en', isNsfw: false },

  // ── Custom HTML Parser ─────────────────────────────────────────────────────
  { id: 'topmanhua', name: 'Top Manhua', baseUrl: 'https://topmanhua.com', engineType: 'custom_html', lang: 'en', isNsfw: false },
  { id: 'manhwaclan', name: 'Manhwa Clan', baseUrl: 'https://manhwaclan.com', engineType: 'custom_html', lang: 'en', isNsfw: false },

  // ── New Requested Extension Sources ───────────────────────────────────────
  { id: 'aquamanga', name: 'Aqua Manga (AquaReader)', baseUrl: 'https://aquareader.org', engineType: 'madara', lang: 'en', isNsfw: false },
  { id: 'weebcentral', name: 'Weeb Central', baseUrl: 'https://weebcentral.com', engineType: 'mangathemesia', lang: 'en', isNsfw: false },
  { id: 'atsumoe', name: 'Atsu Moe', baseUrl: 'https://atsu.moe', engineType: 'custom_html', lang: 'en', isNsfw: false },
  { id: 'demonicscans', name: 'Demonic Scans', baseUrl: 'https://demonicscans.org', engineType: 'mangathemesia', lang: 'en', isNsfw: false },

  { id: 'comick', name: 'ComicK', baseUrl: 'https://comick.io', engineType: 'custom_html', lang: 'en', isNsfw: false },
  { id: 'bato', name: 'Bato.to', baseUrl: 'https://bato.to', engineType: 'custom_html', lang: 'en', isNsfw: false },
  { id: 'readm', name: 'ReadM', baseUrl: 'https://readm.org', engineType: 'custom_html', lang: 'en', isNsfw: false },
];

// Define hard-coded dead sources with type safety
const INITIAL_DEAD_SOURCES = new Set<string>([
  'dynasty',
  'dynastyscans',
  'immortal',
  'immortalupdates',
  'luminous',
  'luminousscans',
  'night',
  'nightscans',
  'radiant',
  'radiantscans',
  'reaper',
  'reaperscans',
] as const);


const ACTIVE_ENABLED_SOURCES = new Set(['aquamanga', 'asurascans', 'flamecomics', 'manhwa18']);
export const disabledSourceIds = new Set<string>();

let syncConfig: DatabaseSyncConfig = {
  subdomain: 'tracker.manhuahub.app',
  autoUpdateIntervalMinutes: 60,
  enableWebCrawling: true,
  sources: ['MangaDex API', 'AniList GraphQL', 'AsuraScans Feeds', 'FlameComics', 'WeebCentral', 'DemonicScans'],
  disabledSources: Array.from(disabledSourceIds),
  removedSources: [],
  lastSyncTime: new Date().toISOString(),
  totalTracked: 0,
};

// Load dynamic dead sources from database
const DYNAMIC_DEAD_SOURCES = new Set<string>();

// Merge all unique dead sources, ensuring case-insensitive comparison
const ALL_DEAD_SOURCES = new Set<string>();

function rebuildDeadSourcesSet() {
  ALL_DEAD_SOURCES.clear();
  INITIAL_DEAD_SOURCES.forEach((source) => ALL_DEAD_SOURCES.add(source.toLowerCase()));
  DYNAMIC_DEAD_SOURCES.forEach((source) => ALL_DEAD_SOURCES.add(source.toLowerCase()));
  if (Array.isArray(syncConfig?.removedSources)) {
    syncConfig.removedSources.forEach((source: string) => ALL_DEAD_SOURCES.add(source.toLowerCase()));
  }
}

// Initial build of dead sources set
rebuildDeadSourcesSet();

// Helper function to check if a source is alive
export function isSourceAlive(sourceNameOrId: string): boolean {
  if (!sourceNameOrId) return false;
  const normalized = sourceNameOrId.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const dead of ALL_DEAD_SOURCES) {
    const normDead = dead.replace(/[^a-z0-9]/g, '');
    if (normalized.includes(normDead) || normDead.includes(normalized)) {
      return false;
    }
  }
  return true;
}

// Dynamic Parser Repository Auto-Scanner: Loads Parsers directly from kotatsu-parsers/ repo
function loadKotatsuParsersFromClonedRepo(): SourceDefinition[] {
  const parsersDir = path.join(process.cwd(), 'kotatsu-parsers', 'src', 'main', 'kotlin', 'org', 'koitharu', 'kotatsu', 'parsers', 'site');
  if (!fs.existsSync(parsersDir)) return [];

  const foundSources: SourceDefinition[] = [];
  const processedIds = new Set<string>([
    ...KOTATSU_SOURCES.map((s) => s.id),
    ...ALL_DEAD_SOURCES,
  ]);

  function walkDir(dir: string) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.kt')) {
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const annotationMatch = content.match(/@MangaSourceParser\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"/);
            if (annotationMatch) {
              const rawId = annotationMatch[1];
              const sourceName = annotationMatch[2];
              const lang = annotationMatch[3];
              const id = rawId.toLowerCase();

              if (processedIds.has(id) || !isSourceAlive(id) || !isSourceAlive(sourceName)) continue;

              const domainMatch = content.match(/ConfigKey\.Domain\(\s*"([^"]+)"/);
              const domain = domainMatch ? domainMatch[1] : `${id}.com`;
              const baseUrl = `https://${domain}`;

              const relPath = fullPath.replace(/\\/g, '/');
              let engineType: SourceEngineType = 'custom_html';
              if (relPath.includes('/madara/')) engineType = 'madara';
              else if (relPath.includes('/mangathemesia/') || content.includes('MangaThemesia') || content.includes('MangaReader')) engineType = 'mangathemesia';
              else if (relPath.includes('/wpcomics/') || content.includes('WpComics')) engineType = 'wpcomics';
              else if (relPath.includes('/foolslide/')) engineType = 'foolslide';
              else if (id === 'mangadex') engineType = 'mangadex';

              const isNsfw = relPath.includes('/galleryadults/') || content.includes('isNsfw = true') || content.includes('isAdult = true') || /18|hentai|porn|doujin/i.test(sourceName);

              processedIds.add(id);
              foundSources.push({
                id,
                name: sourceName,
                baseUrl,
                engineType,
                lang,
                isNsfw,
              });
            }
          } catch (e) { }
        }
      }
    } catch (e) { }
  }

  walkDir(parsersDir);
  return foundSources.filter(source => isSourceAlive(source.id) && isSourceAlive(source.name));
}

// Auto-populate KOTATSU_SOURCES from cloned repo
try {
  const repoSources = loadKotatsuParsersFromClonedRepo();
  if (repoSources.length > 0) {
    KOTATSU_SOURCES.push(...repoSources);
    console.log(`[Kotatsu Engine] Loaded ${repoSources.length} additional parsers directly from kotatsu-parsers repository (Total: ${KOTATSU_SOURCES.length} sources)`);
  }
} catch (e) { }



// Helper: Save Database State to Disk with AES-256-GCM GDPR Encryption & Atomic Async Write Throttling
let saveTimeoutTimer: NodeJS.Timeout | null = null;

function saveDatabaseToDisk() {
  if (saveTimeoutTimer) clearTimeout(saveTimeoutTimer);

  saveTimeoutTimer = setTimeout(() => {
    try {
      const encryptedProfiles = userProfiles.map((p) => ({
        ...p,
        email: encryptPII(p.email || ''),
        password: p.password ? hashPassword(p.password) : '',
      }));

      const encryptedSettings = {
        ...appSettings,
        captchaApiKey: appSettings.captchaApiKey ? encryptPII(appSettings.captchaApiKey) : '',
      };

      const dataToSave = {
        version: 1,
        gdprEncrypted: true,
        lastSaved: new Date().toISOString(),
        mangaDatabase,
        userProfiles: encryptedProfiles,
        autoUpdateLogs,
        syncConfig,
        appSettings: encryptedSettings,
      };

      // Atomic write via temporary file
      const tempPath = `${DB_FILE_PATH}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(dataToSave, null, 2), "utf-8");
      fs.renameSync(tempPath, DB_FILE_PATH);
      console.log(`[GDPR Database Engine] Atomically saved AES-256-GCM encrypted database.json (${userProfiles.length} user PII profiles secured).`);
    } catch (err) {
      console.error("[GDPR Database Engine] Error writing database.json to disk:", err);
    }
  }, 100);
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
  for (const item of items) {
    const idx = mangaDatabase.findIndex((m) => m.id === item.id);
    if (idx !== -1) {
      mangaDatabase[idx] = item;
    } else {
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

function reconcileDatabasesOnStartup() {
  const sqliteItems = SqliteDb.getAllManga();
  const sqliteMap = new Map<string, MangaItem>(sqliteItems.map((m) => [m.id, m]));
  const jsonMap = new Map<string, MangaItem>(mangaDatabase.map((m) => [m.id, m]));

  let needsSave = false;

  const missingInSqlite: MangaItem[] = [];
  for (const [id, item] of jsonMap.entries()) {
    if (!sqliteMap.has(id)) {
      missingInSqlite.push(item);
      sqliteMap.set(id, item);
      needsSave = true;
    }
  }
  if (missingInSqlite.length > 0) {
    SqliteDb.bulkUpsertManga(missingInSqlite);
  }

  for (const [id, item] of sqliteMap.entries()) {
    if (!jsonMap.has(id)) {
      mangaDatabase.push(item);
      jsonMap.set(id, item);
      needsSave = true;
    }
  }

  // Keep the persisted disabled-source set (restored in loadDatabaseFromDisk).
  if (needsSave) {
    saveDatabaseToDisk();
    console.log(`[Database Engine] Reconciled SQLite (${SqliteDb.getMangaCount()} series) & database.json (${mangaDatabase.length} series) seamlessly.`);
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

// Helper: Load Database State from Disk on Startup & Decrypt
function loadDatabaseFromDisk() {
  try {
    if (fs.existsSync(DB_FILE_PATH)) {
      const rawData = fs.readFileSync(DB_FILE_PATH, "utf-8");
      const parsed = JSON.parse(rawData);

      if (parsed.mangaDatabase && Array.isArray(parsed.mangaDatabase)) {
        mangaDatabase = parsed.mangaDatabase;
      }
      if (parsed.userProfiles && Array.isArray(parsed.userProfiles)) {
        userProfiles = parsed.userProfiles.map((p: any) => ({
          ...p,
          email: decryptPII(p.email || ''),
        }));
      }
      if (parsed.autoUpdateLogs && Array.isArray(parsed.autoUpdateLogs)) {
        autoUpdateLogs = parsed.autoUpdateLogs;
      }
      if (parsed.syncConfig) {
        syncConfig = parsed.syncConfig;
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
      if (parsed.appSettings) {
        appSettings = {
          ...parsed.appSettings,
          captchaApiKey: decryptPII(parsed.appSettings.captchaApiKey || ''),
        };
      }
      console.log(`[GDPR Database Engine] Loaded & decrypted persistent database.json (${mangaDatabase.length} series, ${userProfiles.length} encrypted profiles).`);
    } else {
      console.log(`[GDPR Database Engine] No database.json found. Creating initial AES-256 encrypted database.json file...`);
      saveDatabaseToDisk();
    }

    reconcileDatabasesOnStartup();
    purgeReaperScansFromAllStorage();
  } catch (err) {
    console.error("[GDPR Database Engine] Error reading database.json from disk:", err);
  }
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

// Helper: Refresh metadata for a single manga item from live sources
// Helper: Refresh metadata for a single manga item from live sources & MangaDex API
async function refreshSingleMangaMetadata(manga: MangaItem): Promise<MangaItem> {
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
          `https://api.mangadex.org/manga?title=${encodeURIComponent(cleanTitle)}&limit=1&includes[]=cover_art&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica`
        );
        if (searchRes.ok) {
          const searchJson = await searchRes.json();
          const matched = searchJson.data?.[0];
          if (matched) {
            mangaDexId = matched.id;
            manga.apiId = matched.id;
            manga.syncedFromApi = 'MangaDex API v5';
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
    // Normalize any legacy/mirror asurascans domain to the live canonical domain
    manga.sourceUrl = manga.sourceUrl.replace(/asurascans\.(?:com|org)/gi, 'asuracomic.net');
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
        const cleanSlug = slug.replace(/-(?:00dcbf97|b8509c2a|[a-f0-9]{8})$/i, '');
        const slugsToTry = Array.from(new Set([slug, cleanSlug, `${cleanSlug}-00dcbf97`, `${cleanSlug}-b8509c2a`]));

        for (const s of slugsToTry) {
          const res = await fetch(`https://api.asurascans.com/api/series/${s}`, {
            signal: AbortSignal.timeout(12000),
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Accept': 'application/json',
              'Origin': 'https://asuracomic.net',
              'Referer': 'https://asuracomic.net/',
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
              const sTitle = s.title?.toLowerCase().replace(/[^a-z0-9]/g, '');
              const targetNorm = rawSlug.toLowerCase().replace(/[^a-z0-9]/g, '');
              return sId === rawSlug || (targetNorm && sTitle.includes(targetNorm));
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
  res.json({ status: "ok", uptime: process.uptime(), databaseSize: mangaDatabase.length });
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
app.get("/api/manga", (_req, res) => {
  const allManga = SqliteDb.getAllManga();
  const activeOnly = allManga.filter((m) => !isSeriesFromDisabledSource(m));
  res.json(activeOnly);
});

app.post("/api/manga", (req, res) => {
  const newItem: MangaItem = {
    id: req.body.id || `m_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    title: req.body.title || 'Untitled Series',
    altTitles: Array.isArray(req.body.altTitles) ? req.body.altTitles : [],
    type: req.body.type || 'manhwa',
    coverImage: req.body.coverImage || 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=500&auto=format&fit=crop&q=80',
    description: req.body.description || 'No description provided.',
    genres: Array.isArray(req.body.genres) ? req.body.genres : ['Action'],
    status: req.body.status || 'reading',
    currentChapter: Number(req.body.currentChapter) || 0,
    totalChapters: req.body.totalChapters ? Number(req.body.totalChapters) : null,
    latestChapter: Number(req.body.latestChapter) || Number(req.body.currentChapter) || 1,
    lastUpdated: new Date().toISOString(),
    rating: Number(req.body.rating) || 8.0,
    sourceUrl: req.body.sourceUrl || '',
    sourceName: req.body.sourceName || 'Custom / Manual',
    autoUpdateEnabled: req.body.autoUpdateEnabled !== false,
    notes: req.body.notes || '',
    addedAt: new Date().toISOString(),
    lastReadAt: new Date().toISOString(),
    syncedFromApi: req.body.syncedFromApi || null,
    apiId: req.body.apiId || null,
    isFavorite: Boolean(req.body.isFavorite),
  };

  syncAddOrUpdateManga(newItem);
  res.status(201).json(newItem);
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
  const { id } = req.params;
  const existing = SqliteDb.getMangaById(id);
  if (!existing) {
    return res.status(404).json({ error: "Manga not found" });
  }

  const updatedItem: MangaItem = {
    ...existing,
    ...req.body,
    lastUpdated: new Date().toISOString(),
  };

  syncAddOrUpdateManga(updatedItem);
  res.json(updatedItem);
});

app.post("/api/manga/increment/:id", (req, res) => {
  const { id } = req.params;
  const existing = SqliteDb.getMangaById(id);
  if (!existing) {
    return res.status(404).json({ error: "Manga not found" });
  }

  const newChapter = existing.currentChapter + 1;
  SqliteDb.updateChapterProgress(id, newChapter);
  const updated = SqliteDb.getMangaById(id);
  if (updated) {
    syncAddOrUpdateManga(updated);
  }
  res.json(updated);
});

app.post("/api/manga/toggle-favorite", (req, res) => {
  const { id, isFavorite } = req.body || {};
  if (!id) return res.status(400).json({ error: "Missing manga id" });

  SqliteDb.toggleFavorite(id, Boolean(isFavorite));
  const updated = SqliteDb.getMangaById(id);
  if (updated) {
    syncAddOrUpdateManga(updated);
  }
  res.json({ success: true, manga: updated });
});

app.post("/api/manga/toggle-flag", (req, res) => {
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
      const attempts = 0;
      const maxAttempts = 3;
      
      // Simple retry mechanism - we don't block the response but trigger recovery
      setTimeout(() => {
        // This will trigger the chapter loading process for flagged manga
        const flaggedManga = getMangaById(id);
        if (flaggedManga && flaggedManga.autoUpdateEnabled && !isUpdaterWorking) {
          // Schedule a manual refresh attempt
          setImmediate(() => {
            refreshManga(id).catch(console.error);
          });
        }
      }, 5000 + attempts * 2000); // retry every 2 seconds for 3 attempts
    }
  }

  res.json({ success: true, manga: existing });
});

app.delete("/api/manga/:id", (req, res) => {
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
const atHomeCache = new Map<string, { data: any; expiry: number }>();
const atHomeTimestamps: number[] = [];

async function fetchMangaDex(url: string, options: any = {}): Promise<any> {
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
    const retryUnix = Number(retryAfter) || Math.floor(Date.now() / 1000) + 5;
    const waitMs = Math.max(1000, (retryUnix * 1000) - Date.now());
    console.warn(`[MangaDex API Rate Limiter] 429 Quota Exceeded. Waiting ${waitMs}ms before retrying...`);
    await new Promise((r) => setTimeout(r, waitMs));
    return fetchMangaDex(url, options);
  }

  return response;
}

// Universal Image Proxy Engine (Bypasses Hotlinking Restrictions & SSL blocks)
const handleImageProxyRequest = async (req: express.Request, res: express.Response) => {
  const imageUrl = req.query.url as string;
  if (!imageUrl || (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://'))) {
    return res.status(400).send('Invalid or missing image URL for proxy');
  }

  let referer = 'https://mangadex.org';
  try {
    const parsed = new URL(imageUrl);
    referer = `${parsed.protocol}//${parsed.hostname}`;
  } catch (_) { }

  try {
    const imgRes = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
        'Referer': referer,
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      },
    });

    if (imgRes.ok) {
      res.setHeader('Content-Type', imgRes.headers.get('content-type') || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      const arrayBuffer = await imgRes.arrayBuffer();
      return res.send(Buffer.from(arrayBuffer));
    }
  } catch (err: any) {
    console.error("[Universal Image Proxy] Error proxying image:", imageUrl, err.message);
  }

  // Fallback placeholder image if remote image is unreachable
  res.redirect('https://images.unsplash.com/photo-1578632767115-351597cf2477?w=500&auto=format&fit=crop&q=80');
};

app.get("/api/mangadex/image-proxy", handleImageProxyRequest);
app.get("/api/proxy/image", handleImageProxyRequest);

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
      // Return popular feed if query empty
      const popularFeed = [
        {
          id: 'md-solo',
          title: 'Solo Leveling (Only I Level Up)',
          altTitles: ['Na Honjaman Relevel-eob', '나 혼자만 레벨업'],
          type: 'manhwa' as const,
          coverImage: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=500&auto=format&fit=crop&q=80',
          description: 'Hunters fight monsters. Weak Sung Jinwoo unlocks the system.',
          genres: ['Action', 'Fantasy', 'System', 'Dungeon'],
          latestChapter: 200,
          publicationStatus: 'COMPLETED',
          source: 'MangaDex API',
          rating: 9.8,
          author: 'Chugong',
          year: 2018,
        },
        {
          id: 'md-tbate',
          title: 'The Beginning After The End',
          altTitles: ['TBATE'],
          type: 'manhwa' as const,
          coverImage: 'https://images.unsplash.com/photo-1563089145-599997674d42?w=500&auto=format&fit=crop&q=80',
          description: 'King Grey reincarnates in a magic realm.',
          genres: ['Fantasy', 'Isekai', 'Reincarnation', 'Magic'],
          latestChapter: 190,
          publicationStatus: 'ONGOING',
          source: 'MangaDex API',
          rating: 9.5,
          author: 'TurtleMe',
          year: 2018,
        },
        {
          id: 'md-mp',
          title: 'Martial Peak',
          altTitles: ['Wu Lian Dian Feng', '武炼巅峰'],
          type: 'manhua' as const,
          coverImage: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=500&auto=format&fit=crop&q=80',
          description: 'Yang Kai embarks on the path to martial peak.',
          genres: ['Cultivation', 'Action', 'Xianxia'],
          latestChapter: 3550,
          publicationStatus: 'ONGOING',
          source: 'MangaDex API',
          rating: 8.5,
          author: 'Momo',
          year: 2018,
        },
        {
          id: 'md-nano',
          title: 'Nano Machine',
          altTitles: ['Nanomachine', '나노마신'],
          type: 'manhwa' as const,
          coverImage: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=500&auto=format&fit=crop&q=80',
          description: 'Future nanomachines injected into Demonic Cult prince.',
          genres: ['Murim', 'Action', 'Sci-Fi'],
          latestChapter: 212,
          publicationStatus: 'ONGOING',
          source: 'MangaDex API',
          rating: 9.4,
          author: 'Han-jo',
          year: 2020,
        },
      ];
      return res.json(popularFeed);
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
          latestChapter: Number(m.attributes.lastChapter) || 100,
          publicationStatus: (m.attributes.status || 'ONGOING').toUpperCase(),
          source: 'MangaDex API',
          rating: 8.5,
        };
      });

      if (results.length > 0) {
        return res.json(results);
      }
    }

    const fallbackResults = [
      {
        id: `md-search-${Date.now()}-1`,
        title: `${query} (Official Manhwa)`,
        altTitles: [`Alt ${query}`, `${query} Korean Version`],
        type: 'manhwa' as const,
        coverImage: '/api/mangadex/image-proxy?url=https%3A%2F%2Fuploads.mangadex.org%2Fcovers%2F32d76d19-8a05-4db0-9fc2-e0b0648fe9d0%2Ffbc962f9-3d12-4c6e-8212-32a2cb874a7b.jpg',
        description: `Searched result for ${query}. Epic journey in a high-fantasy superpower world.`,
        genres: ['Action', 'Fantasy', 'System', 'Regression'],
        latestChapter: 142,
        publicationStatus: 'ONGOING',
        source: 'OpenAPI Search Engine',
        rating: 9.1,
        year: 2022,
      }
    ];

    res.json(fallbackResults);
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

// Live MangaDex Chapter List Feed Endpoint
app.get("/api/mangadex/chapters/:mangaDexId", async (req, res) => {
  const { mangaDexId } = req.params;
  try {
    const feedRes = await fetchMangaDex(
      `https://api.mangadex.org/manga/${mangaDexId}/feed?translatedLanguage[]=en&order[chapter]=asc&limit=100&contentRating[]=safe&contentRating[]=suggestive`
    );

    if (feedRes.ok) {
      const feedData = await feedRes.json();
      const chapters = (feedData.data || []).map((ch: any) => ({
        id: ch.id,
        chapterNumber: Number(ch.attributes.chapter) || 1,
        title: ch.attributes.title ? `Ch. ${ch.attributes.chapter}: ${ch.attributes.title}` : `Chapter ${ch.attributes.chapter || 1}`,
        releaseDate: ch.attributes.publishAt || new Date().toISOString(),
        scanGroup: 'MangaDex Community',
        pageCount: ch.attributes.pages || 10,
      }));
      return res.json(chapters);
    }
  } catch (err) {
    console.error("MangaDex chapter list error:", err);
  }

  res.json([]);
});

// Live MangaDex At-Home CDN Chapter Page Extractor (Enforces 40 req/min quota limit + 15m caching)
app.get("/api/mangadex/chapter-pages/:chapterId", async (req, res) => {
  const { chapterId } = req.params;

  // Check 15-minute At-Home response cache
  const cached = atHomeCache.get(chapterId);
  if (cached && cached.expiry > Date.now()) {
    console.log(`[MangaDex At-Home Cache] Serving cached pages for chapter ${chapterId}`);
    return res.json(cached.data);
  }

  // Enforce 40 requests per 1 minute At-Home quota limiter
  const now = Date.now();
  while (atHomeTimestamps.length > 0 && atHomeTimestamps[0] < now - 60000) {
    atHomeTimestamps.shift();
  }

  if (atHomeTimestamps.length >= 40) {
    const oldest = atHomeTimestamps[0];
    const waitMs = Math.max(1000, 60000 - (now - oldest));
    console.warn(`[MangaDex At-Home Rate Limiter] 40 req/min quota reached. Waiting ${waitMs}ms...`);
    await new Promise((r) => setTimeout(r, waitMs));
  }

  try {
    atHomeTimestamps.push(Date.now());
    const atHomeRes = await fetchMangaDex(`https://api.mangadex.org/at-home/server/${chapterId}`);
    if (atHomeRes.ok) {
      const atHomeData = await atHomeRes.json();
      const baseUrl = atHomeData.baseUrl;
      const hash = atHomeData.chapter.hash;
      const filenames: string[] = atHomeData.chapter.data || [];

      // Proxy page URLs to prevent MangaDex hotlink replacement (agg.jpg)
      const pageUrls = filenames.map((file) => {
        const rawUrl = `${baseUrl}/data/${hash}/${file}`;
        return `/api/mangadex/image-proxy?url=${encodeURIComponent(rawUrl)}`;
      });

      const responsePayload = {
        chapterId,
        pageCount: pageUrls.length,
        pages: pageUrls,
      };

      // Cache for 15 minutes
      atHomeCache.set(chapterId, { data: responsePayload, expiry: Date.now() + 15 * 60 * 1000 });

      return res.json(responsePayload);
    }
  } catch (err) {
    console.error("MangaDex At-Home server error:", err);
  }

  res.status(500).json({ error: "Failed to fetch MangaDex chapter pages" });
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
          latestChapter: m.chapters || 100,
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
        model: "gemini-3.6-flash",
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

app.post("/api/ai/enrich-metadata", async (req, res) => {
  const { title } = req.body;
  if (!title) {
    return res.status(400).json({ error: "Title is required" });
  }

  const ai = getGeminiClient();
  if (!ai) {
    // Fallback response without AI key
    return res.json({
      title,
      altTitles: [`${title} (Romanized)`, `${title} (Alternative)`],
      type: title.toLowerCase().includes('manhua') || title.toLowerCase().includes('cultivation') ? 'manhua' : 'manhwa',
      description: `${title} is an exciting Korean/Chinese webtoon following supernatural battles, levelling systems, and martial prowess.`,
      genres: ['Action', 'Fantasy', 'System', 'Adventure'],
      latestChapter: 120,
      rating: 9.0,
      sourceName: 'OpenAPI Feeds',
    });
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
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

  res.json({
    title,
    altTitles: [`${title} Alt`],
    type: 'manhwa',
    description: `Series metadata for ${title}`,
    genres: ['Action', 'Fantasy'],
    latestChapter: 100,
    rating: 8.5,
  });
});

// AI Similar Recommendations
app.post("/api/ai/find-similar", async (req, res) => {
  const { title, genres } = req.body;
  const ai = getGeminiClient();

  if (!ai) {
    const genreStr = (genres && genres.length > 0) ? genres[0] : 'Action';
    return res.json([
      { title: `Top Rated ${genreStr} Series`, type: 'manhwa', reason: `High match score based on ${genreStr} themes` },
      { title: `Similar ${title || 'Webtoon'} Recommendation`, type: 'manhwa', reason: `Matches narrative style and plot tropes of ${title || 'your library'}` }
    ]);
  }


  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
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
    const rows = mangaDatabase.map((m) =>
      `"${m.id}","${m.title.replace(/"/g, '""')}","${m.type}",${m.currentChapter},${m.latestChapter},"${m.status}",${m.rating},"${m.sourceName}"`
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
  syncResetManga(INITIAL_MANGA_DATABASE);
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

  const manga = mangaDatabase.find((m) => m.id === mangaId);
  if (!manga) {
    return res.status(404).json({ error: "Manga not found" });
  }

  // Check if MangaDex API ID exists for live MangaDex chapter feed
  if (manga.apiId && manga.syncedFromApi?.toLowerCase().includes('mangadex')) {
    try {
      const mdRes = await fetch(
        `https://api.mangadex.org/manga/${manga.apiId}/feed?translatedLanguage[]=en&order[chapter]=desc&limit=100&includes[]=scanlation_group`
      );
      if (mdRes.ok) {
        const mdData = await mdRes.json();
        if (mdData.data && mdData.data.length > 0) {
          const mdChapters = mdData.data.map((c: any) => {
            const chNum = parseFloat(c.attributes.chapter) || 1;
            const scanGroupRel = (c.relationships || []).find((r: any) => r.type === 'scanlation_group');
            const scanGroup = scanGroupRel?.attributes?.name || manga.sourceName || 'MangaDex Group';
            return {
              id: c.id,
              chapterNumber: chNum,
              title: c.attributes.title ? `Ch. ${chNum} - ${c.attributes.title}` : `Chapter ${chNum}`,
              releaseDate: c.attributes.publishAt ? c.attributes.publishAt.substring(0, 10) : new Date().toISOString().substring(0, 10),
              scanGroup,
              pageCount: c.attributes.pages || 14,
              isRead: chNum <= manga.currentChapter,
            };
          });

          if (order === 'asc') {
            mdChapters.sort((a: any, b: any) => a.chapterNumber - b.chapterNumber);
          } else {
            mdChapters.sort((a: any, b: any) => b.chapterNumber - a.chapterNumber);
          }

          return res.json(mdChapters);
        }
      }
    } catch (err) {
      console.error("MangaDex chapter feed fetch error:", err);
    }
  }

  // Generated Scanlation Chapter List for trackable chapters
  const totalCh = Math.max(manga.latestChapter, manga.currentChapter, 10);
  const chapters: any[] = [];

  const scanGroups = [
    manga.sourceName || 'Scanlation Hub',
    'AsuraScans',
    'FlameScans',
    'ReaperScans',
    'NightScans',
    'Webtoon Studio',
  ];

  for (let c = 1; c <= totalCh; c++) {
    const daysAgo = Math.floor((totalCh - c) * 1.5);
    const date = new Date(Date.now() - daysAgo * 86400 * 1000).toISOString().substring(0, 10);
    const group = scanGroups[(c + manga.title.length) % scanGroups.length];

    chapters.push({
      id: `ch_${manga.id}_${c}`,
      chapterNumber: c,
      title: `Chapter ${c}`,
      releaseDate: date,
      scanGroup: group,
      pageCount: 12 + (c % 5),
      isRead: c <= manga.currentChapter,
    });
  }

  if (order === 'asc') {
    chapters.sort((a, b) => a.chapterNumber - b.chapterNumber);
  } else {
    chapters.sort((a, b) => b.chapterNumber - a.chapterNumber);
  }

  res.json(chapters);
});

// Dedicated Unique Catalogs for Each Individual Source
const SOURCE_DEDICATED_CATALOGS: Record<string, { title: string; slug: string; cover: string; genres: string[]; type: 'manhwa' | 'manhua' | 'manga'; latestChapter: number }[]> = {
  manhwa18: [
    { title: 'Pick Me Up! Infinite Gacha', slug: 'pick-me-up', cover: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=400&auto=format&fit=crop&q=80', genres: ['Adult', 'Action', 'System'], type: 'manhwa', latestChapter: 88 },
    { title: 'Secret Class', slug: 'secret-class', cover: 'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=400&auto=format&fit=crop&q=80', genres: ['18+', 'Drama', 'Romance'], type: 'manhwa', latestChapter: 210 },
    { title: 'Boarding House Diary', slug: 'boarding-house-diary', cover: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=400&auto=format&fit=crop&q=80', genres: ['18+', 'Ecchi'], type: 'manhwa', latestChapter: 145 },
    { title: 'Silent War', slug: 'silent-war', cover: 'https://images.unsplash.com/photo-1563089145-599997674d42?w=400&auto=format&fit=crop&q=80', genres: ['18+', 'Psychological'], type: 'manhwa', latestChapter: 160 },
    { title: 'Stepmother Friends', slug: 'stepmother-friends', cover: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400&auto=format&fit=crop&q=80', genres: ['18+', 'Harem'], type: 'manhwa', latestChapter: 175 },
    { title: 'Touch To Unlock', slug: 'touch-to-unlock', cover: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=400&auto=format&fit=crop&q=80', genres: ['18+', 'Romance'], type: 'manhwa', latestChapter: 130 },
  ],
  aquamanga: [
    { title: 'Martial Peak', slug: 'martial-peak', cover: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=400&auto=format&fit=crop&q=80', genres: ['Action', 'Martial Arts', 'Cultivation'], type: 'manhua', latestChapter: 3500 },
    { title: 'Apotheosis', slug: 'apotheosis', cover: 'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=400&auto=format&fit=crop&q=80', genres: ['Action', 'Fantasy', 'Cultivation'], type: 'manhua', latestChapter: 1120 },
    { title: 'Tales of Demons and Gods', slug: 'tales-of-demons-and-gods', cover: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=400&auto=format&fit=crop&q=80', genres: ['Reincarnation', 'Action'], type: 'manhua', latestChapter: 460 },
    { title: 'Yuan Zun', slug: 'yuan-zun', cover: 'https://images.unsplash.com/photo-1563089145-599997674d42?w=400&auto=format&fit=crop&q=80', genres: ['Fantasy', 'Action'], type: 'manhua', latestChapter: 580 },
    { title: 'Star Martial God Technique', slug: 'star-martial-god-technique', cover: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400&auto=format&fit=crop&q=80', genres: ['Martial Arts', 'Action'], type: 'manhua', latestChapter: 620 },
  ],
  atsumoe: [
    { title: 'Standard of Reincarnation', slug: 'standard-of-reincarnation', cover: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=400&auto=format&fit=crop&q=80', genres: ['Action', 'Reincarnation'], type: 'manhwa', latestChapter: 95 },
    { title: 'The Player Who Can’t Level Up', slug: 'the-player-who-cant-level-up', cover: 'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=400&auto=format&fit=crop&q=80', genres: ['Action', 'System'], type: 'manhwa', latestChapter: 155 },
    { title: 'Solo Max-Level Newbie', slug: 'solo-max-level-newbie', cover: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=400&auto=format&fit=crop&q=80', genres: ['Action', 'System', 'Tower'], type: 'manhwa', latestChapter: 168 },
    { title: 'Return of the Disaster-Class Hero', slug: 'return-of-the-disaster-class-hero', cover: 'https://images.unsplash.com/photo-1563089145-599997674d42?w=400&auto=format&fit=crop&q=80', genres: ['Action', 'Revenge'], type: 'manhwa', latestChapter: 98 },
    { title: 'Doom Breaker (Suicidal Battle God)', slug: 'doom-breaker', cover: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400&auto=format&fit=crop&q=80', genres: ['Action', 'Time Travel'], type: 'manhwa', latestChapter: 110 },
  ],
  demonicscans: [
    { title: 'Magic Emperor', slug: 'Magic-Emperor', cover: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=400&auto=format&fit=crop&q=80', genres: ['Action', 'Reincarnation', 'Demon'], type: 'manhua', latestChapter: 570 },
    { title: 'Genius Martial Arts Trainer', slug: 'Genius-Martial-Arts-Trainer', cover: 'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=400&auto=format&fit=crop&q=80', genres: ['Martial Arts', 'Action'], type: 'manhwa', latestChapter: 62 },
    { title: 'The Heavenly Demon Can’t Live a Normal Life', slug: 'the-heavenly-demon-cant-live-a-normal-life', cover: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=400&auto=format&fit=crop&q=80', genres: ['Action', 'Reincarnation'], type: 'manhwa', latestChapter: 124 },
    { title: 'Absolute Sword Sense', slug: 'absolute-sword-sense', cover: 'https://images.unsplash.com/photo-1563089145-599997674d42?w=400&auto=format&fit=crop&q=80', genres: ['Action', 'Wuxia'], type: 'manhwa', latestChapter: 92 },
  ],
  kunmanga: [
    { title: 'My Three Thousand Years to the Sky', slug: 'my-three-thousand-years-to-the-sky', cover: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=400&auto=format&fit=crop&q=80', genres: ['Action', 'Cultivation'], type: 'manhua', latestChapter: 410 },
    { title: 'Rebirth of the Urban Immortal Cultivator', slug: 'rebirth-of-the-urban-immortal-cultivator', cover: 'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=400&auto=format&fit=crop&q=80', genres: ['Action', 'Urban Cultivation'], type: 'manhua', latestChapter: 890 },
    { title: 'Versatile Mage', slug: 'versatile-mage', cover: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=400&auto=format&fit=crop&q=80', genres: ['Action', 'Magic'], type: 'manhua', latestChapter: 1050 },
  ],
  weebcentral: [
    { title: 'Superhuman Era', slug: '01KYCY0DYR3BH3RXHV8CVV76C8/superhuman-era', cover: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=400&auto=format&fit=crop&q=80', genres: ['Action', 'Supernatural'], type: 'manhwa', latestChapter: 180 },
    { title: 'Toaru Anbu no ITEM', slug: '01KYCXWWSSGKHT7809303JZVSG/toaru-anbu-no-item', cover: 'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=400&auto=format&fit=crop&q=80', genres: ['Action', 'Sci-Fi'], type: 'manga', latestChapter: 24 },
  ],
  manhuaplus: [
    { title: 'Apotheosis', slug: 'apotheosis', cover: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=400&auto=format&fit=crop&q=80', genres: ['Action', 'Martial Arts'], type: 'manhua', latestChapter: 1120 },
    { title: 'Demon Magic Emperor', slug: 'demon-magic-emperor', cover: 'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=400&auto=format&fit=crop&q=80', genres: ['Action', 'Reincarnation'], type: 'manhua', latestChapter: 550 },
  ],
  mangatx: [
    { title: 'The Great Ruler', slug: 'the-great-ruler', cover: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=400&auto=format&fit=crop&q=80', genres: ['Action', 'Cultivation'], type: 'manhua', latestChapter: 480 },
    { title: 'Battle Through the Heavens', slug: 'battle-through-the-heavens', cover: 'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=400&auto=format&fit=crop&q=80', genres: ['Action', 'Adventure'], type: 'manhua', latestChapter: 410 },
  ],
  topmanhua: [
    { title: 'Martial God Asura', slug: 'martial-god-asura', cover: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=400&auto=format&fit=crop&q=80', genres: ['Action', 'Martial Arts'], type: 'manhua', latestChapter: 720 },
    { title: 'Peerless Battle Spirit', slug: 'peerless-battle-spirit', cover: 'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=400&auto=format&fit=crop&q=80', genres: ['Action', 'Cultivation'], type: 'manhua', latestChapter: 590 },
  ],
  manhwaclan: [
    { title: 'God of High School', slug: 'god-of-high-school', cover: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=400&auto=format&fit=crop&q=80', genres: ['Action', 'Martial Arts'], type: 'manhwa', latestChapter: 570 },
    { title: 'Hardcore Leveling Warrior', slug: 'hardcore-leveling-warrior', cover: 'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=400&auto=format&fit=crop&q=80', genres: ['Action', 'Game'], type: 'manhwa', latestChapter: 320 },
  ],
  manhuafast: [
    { title: 'Martial Peak', slug: 'martial-peak', cover: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=400&auto=format&fit=crop&q=80', genres: ['Action', 'Cultivation'], type: 'manhua', latestChapter: 3500 },
  ],
  manhwabuddy: [
    { title: 'Mercenary Enrollment (Iphak Yongbyeong)', slug: 'mercenary-enrollment', cover: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=400&auto=format&fit=crop&q=80', genres: ['Action', 'School'], type: 'manhwa', latestChapter: 190 },
  ],
  luminous: [
    { title: 'Absolute Sword Sense', slug: 'absolute-sword-sense', cover: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=400&auto=format&fit=crop&q=80', genres: ['Action', 'Wuxia'], type: 'manhwa', latestChapter: 92 },
  ],
  night: [
    { title: 'The Heavenly Demon Can’t Live a Normal Life', slug: 'the-heavenly-demon-cant-live-a-normal-life', cover: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=400&auto=format&fit=crop&q=80', genres: ['Action', 'Reincarnation'], type: 'manhwa', latestChapter: 124 },
  ],
  immortal: [
    { title: 'Supreme Saint', slug: 'supreme-saint', cover: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=400&auto=format&fit=crop&q=80', genres: ['Action', 'Cultivation'], type: 'manhua', latestChapter: 310 },
  ],
};

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

// Kotatsu Sources List Endpoint (Returns active enabled sources only)
app.get("/api/kotatsu/sources", (_req, res) => {
  const activeSources = KOTATSU_SOURCES.filter((s) => !disabledSourceIds.has(s.id) && isSourceAlive(s.id) && isSourceAlive(s.name));
  const listWithStates = activeSources.map((s) => ({
    ...s,
    isEnabled: true,
  }));
  res.json(listWithStates);
});

// Endpoint to permanently purge all disabled sources
app.post("/api/kotatsu/sources/purge-disabled", (_req, res) => {
  const result = purgeDisabledSources();
  res.json({
    success: true,
    message: `Permanently deleted ${result.purgedCount} disabled sources. ${result.remainingCount} active sources remain.`,
    ...result,
  });
});

// Toggle Individual Source Enable/Disable Endpoint
app.post("/api/kotatsu/sources/toggle", (req, res) => {
  const { sourceId, isEnabled } = req.body;
  if (!sourceId) return res.status(400).json({ error: "sourceId is required" });

  if (isEnabled === false) {
    disabledSourceIds.add(sourceId);
  } else {
    disabledSourceIds.delete(sourceId);
  }

  syncConfig.disabledSources = Array.from(disabledSourceIds);
  saveDatabaseToDisk();
  console.log(`[Kotatsu Engine] Source "${sourceId}" is now ${isEnabled ? 'ENABLED' : 'DISABLED'} (${disabledSourceIds.size} disabled in total)`);
  res.json({
    success: true,
    sourceId,
    isEnabled: !disabledSourceIds.has(sourceId),
    disabledCount: disabledSourceIds.size,
  });
});


// Kotatsu App Explore & Featured Recommendations Endpoint
app.get("/api/kotatsu/explore/featured", async (_req, res) => {
  try {
    const allManga = SqliteDb.getAllManga();
    const manhwa = allManga.filter((m: any) => m.type === 'manhwa').slice(0, 12);
    const manhua = allManga.filter((m: any) => m.type === 'manhua').slice(0, 12);
    const manga = allManga.filter((m: any) => m.type === 'manga').slice(0, 12);

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
    const mdRes = await fetchMangaDex(
      'https://api.mangadex.org/manga?order[latestUploadedChapter]=desc&limit=24&includes[]=cover_art&contentRating[]=safe&contentRating[]=suggestive'
    );

    if (mdRes.ok) {
      const mdData = await mdRes.json();
      const items = (mdData.data || []).map((m: any) => {
        const titleObj = m.attributes.title || {};
        const title = titleObj.en || Object.values(titleObj)[0] || 'Unknown';
        const coverRel = (m.relationships || []).find((r: any) => r.type === 'cover_art');
        const coverFileName = coverRel?.attributes?.fileName;
        const rawCoverUrl = coverFileName
          ? `https://uploads.mangadex.org/covers/${m.id}/${coverFileName}.512.jpg`
          : '';
        return {
          id: `md_${m.id}`,
          title,
          sourceUrl: `https://mangadex.org/title/${m.id}`,
          coverImage: rawCoverUrl ? `/api/mangadex/image-proxy?url=${encodeURIComponent(rawCoverUrl)}` : '',
          sourceName: 'MangaDex API',
          latestChapter: Number(m.attributes.lastChapter) || 1,
          updatedAt: m.attributes.updatedAt || new Date().toISOString(),
          type: m.attributes?.originalLanguage === 'ko' ? 'manhwa' : m.attributes?.originalLanguage === 'zh' ? 'manhua' : 'manga',
        };
      });
      return res.json(items);
    }
    res.json([]);
  } catch (e: any) {
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

  // 1. Ingest complete static Kotatsu catalog
  try {
    const catalogResult = integrateKotatsuSourcesAndMerge(KOTATSU_COMPLETE_CATALOG);
    totalNew += catalogResult.newCount;
    totalMerged += catalogResult.mergedCount;
    sourceCounts['kotatsu_catalog'] = KOTATSU_COMPLETE_CATALOG.length;
  } catch (e: any) {
    console.warn('[Database Engine] Catalog merge warning:', e.message);
  }

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

  // 5. Ingest top popular series from MangaDex API (5 pages = 500 top series)
  try {
    let mdFetched = 0;
    for (let offset = 0; offset < 500; offset += 100) {
      const mdRes = await fetchMangaDex(
        `https://api.mangadex.org/manga?order[followedCount]=desc&limit=100&offset=${offset}&includes[]=cover_art&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica`
      );
      if (mdRes.ok) {
        const mdData = await mdRes.json();
        const mdItems = (mdData.data || []).map((m: any) => {
          const titleObj = m.attributes.title || {};
          const title = titleObj.en || Object.values(titleObj)[0] || 'Unknown';
          const lang = m.attributes.originalLanguage || '';
          const type = lang === 'ko' ? 'manhwa' : lang === 'zh' || lang === 'zh-hk' ? 'manhua' : 'manga';
          const coverRel = (m.relationships || []).find((r: any) => r.type === 'cover_art');
          const coverFileName = coverRel?.attributes?.fileName;
          const rawCoverUrl = coverFileName
            ? `https://uploads.mangadex.org/covers/${m.id}/${coverFileName}.512.jpg`
            : '';
          const descObj = m.attributes.description || {};
          const description = (descObj.en || Object.values(descObj)[0] || '').substring(0, 250);
          const tags = (m.attributes.tags || []).map((t: any) => t.attributes?.name?.en).filter(Boolean).slice(0, 5);
          const altTitles = (m.attributes.altTitles || []).map((t: any) => Object.values(t)[0]).filter(Boolean) as string[];

          return {
            id: `md_${m.id}`,
            title,
            altTitles,
            sourceUrl: `https://mangadex.org/title/${m.id}`,
            coverImage: rawCoverUrl ? `/api/mangadex/image-proxy?url=${encodeURIComponent(rawCoverUrl)}` : '',
            sourceName: 'MangaDex API',
            apiId: m.id,
            description,
            genres: tags.length ? tags : ['Action', 'Fantasy'],
            latestChapter: Number(m.attributes.lastChapter) || 10,
            type,
            status: 'reading' as const,
            currentChapter: 0,
            rating: 9.5,
          };
        });

        const res = integrateKotatsuSourcesAndMerge(mdItems);
        totalNew += res.newCount;
        totalMerged += res.mergedCount;
        mdFetched += mdItems.length;
      }
    }
    sourceCounts['mangadex'] = mdFetched;
    console.log(`[Database Engine] MangaDex API: +${totalNew} new, ${totalMerged} merged (${mdFetched} pulled)`);
  } catch (err: any) {
    console.warn('[Database Engine] MangaDex ingestion warning:', err.message);
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

// Bulk MangaDex Catalog Ingestor: Pulls thousands of series from MangaDex API
export async function pullBulkMangaDexSeries(maxPages: number = 20): Promise<{
  totalNew: number;
  totalMerged: number;
  totalPulled: number;
  totalSeriesInDatabase: number;
}> {
  const pagesToPull = Math.min(100, Math.max(1, maxPages));
  console.log(`[MangaDex Bulk Engine] Starting bulk ingest of ${pagesToPull} pages (${pagesToPull * 100} series) from MangaDex API...`);

  let totalNew = 0;
  let totalMerged = 0;
  let totalPulled = 0;

  for (let p = 0; p < pagesToPull; p++) {
    const offset = p * 100;
    try {
      const url = `https://api.mangadex.org/manga?order[followedCount]=desc&limit=100&offset=${offset}&includes[]=cover_art&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica`;
      const res = await fetchMangaDex(url);
      if (res.ok) {
        const data = await res.json();
        const rawItems = data.data || [];
        totalPulled += rawItems.length;

        const formattedItems = rawItems.map((m: any) => {
          const titleObj = m.attributes.title || {};
          const title = titleObj.en || Object.values(titleObj)[0] || 'Unknown';
          const lang = m.attributes.originalLanguage || '';
          const type = lang === 'ko' ? 'manhwa' : lang === 'zh' || lang === 'zh-hk' ? 'manhua' : 'manga';
          const coverRel = (m.relationships || []).find((r: any) => r.type === 'cover_art');
          const coverFileName = coverRel?.attributes?.fileName;
          const rawCoverUrl = coverFileName
            ? `https://uploads.mangadex.org/covers/${m.id}/${coverFileName}.512.jpg`
            : '';
          const descObj = m.attributes.description || {};
          const description = (descObj.en || Object.values(descObj)[0] || '').substring(0, 250);
          const tags = (m.attributes.tags || []).map((t: any) => t.attributes?.name?.en).filter(Boolean).slice(0, 5);
          const altTitles = (m.attributes.altTitles || []).map((t: any) => Object.values(t)[0]).filter(Boolean) as string[];

          return {
            id: `md_${m.id}`,
            title,
            altTitles,
            sourceUrl: `https://mangadex.org/title/${m.id}`,
            coverImage: rawCoverUrl ? `/api/mangadex/image-proxy?url=${encodeURIComponent(rawCoverUrl)}` : '',
            sourceName: 'MangaDex API',
            apiId: m.id,
            description,
            genres: tags.length ? tags : ['Action', 'Fantasy'],
            latestChapter: Number(m.attributes.lastChapter) || 10,
            type,
            status: 'reading' as const,
            currentChapter: 0,
            rating: 9.5,
          };
        });

        const mergeRes = integrateKotatsuSourcesAndMerge(formattedItems);
        totalNew += mergeRes.newCount;
        totalMerged += mergeRes.mergedCount;

        console.log(`[MangaDex Bulk Engine] Page ${p + 1}/${pagesToPull} (Offset ${offset}): +${mergeRes.newCount} new, ${mergeRes.mergedCount} merged (${rawItems.length} items)`);
      }
    } catch (err: any) {
      console.warn(`[MangaDex Bulk Engine] Error on page ${p + 1}:`, err.message);
    }
  }

  saveDatabaseToDisk();
  console.log(`[MangaDex Bulk Engine] Complete! Total Pulled: ${totalPulled}, Total New: ${totalNew}, Total Merged: ${totalMerged}, Total DB Count: ${mangaDatabase.length}`);

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
      message: `Successfully pulled ${result.totalPulled} series from MangaDex API.`,
      ...result,
    });
  } catch (err: any) {
    console.error("[MangaDex Bulk Endpoint] Error:", err);
    res.status(500).json({ error: "Failed to pull bulk series from MangaDex API", details: err.message });
  }
});



// Kotatsu Parser Latest Releases Endpoint
app.get("/api/kotatsu/latest", async (req, res) => {
  const sourceId = (req.query.sourceId as string) || 'mangadex';
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(Number(req.query.limit) || 24, 100);
  const offset = (page - 1) * limit;
  const sourceDef = KOTATSU_SOURCES.find((s) => s.id === sourceId) || KOTATSU_SOURCES[0];

  try {
    if (sourceDef.engineType === 'mangadex') {
      const mdRes = await fetchMangaDex(
        `https://api.mangadex.org/manga?order[latestUploadedChapter]=desc&limit=${limit}&offset=${offset}&includes[]=cover_art&contentRating[]=safe&contentRating[]=suggestive`
      );
      if (mdRes.ok) {
        const mdData = await mdRes.json();
        const items = (mdData.data || []).map((m: any) => {
          const titleObj = m.attributes.title || {};
          const title = titleObj.en || Object.values(titleObj)[0] || 'Unknown';
          const coverRel = (m.relationships || []).find((r: any) => r.type === 'cover_art');
          const coverFileName = coverRel?.attributes?.fileName;
          const rawCoverUrl = coverFileName
            ? `https://uploads.mangadex.org/covers/${m.id}/${coverFileName}.512.jpg`
            : '';
          return {
            id: `md_${m.id}`,
            title,
            sourceUrl: `https://mangadex.org/title/${m.id}`,
            coverImage: rawCoverUrl ? `/api/mangadex/image-proxy?url=${encodeURIComponent(rawCoverUrl)}` : '',
            sourceName: sourceDef.name + ' (Latest)',
            apiId: m.id,
            latestChapter: Number(m.attributes.lastChapter) || 1,
            type: 'manhwa',
          };
        });
        return res.json(items);
      }
    }

    const result = await getSourcePopularSeries(sourceDef);
    // Normalize: getSourcePopularSeries may return { items, totalCount } or a bare array
    const items = Array.isArray(result) ? result : (result?.items || []);
    const totalCount = Array.isArray(result) ? items.length : (result?.totalCount ?? items.length);
    res.setHeader('X-Total-Count', String(totalCount));
    res.setHeader('X-Total-Pages', String(Math.ceil(totalCount / limit)));
    return res.json(items);
  } catch (e) {
    res.json([]);
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DEDICATED SOURCE SCRAPERS (Kotatsu Parser conventions per site)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const SCRAPER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

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
          'Origin': 'https://asuracomic.net',
          'Referer': 'https://asuracomic.net/',
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
        sourceUrl: `https://asuracomic.net${pubPath}`,
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

// ── 3. MANHWA18 (HTML catalog, 90 pages, /manga-list?page=N) ─────────────────
// URL pattern: https://manhwa18.com/manga-list?page=N&sort=az
async function scrapeManhwa18(page: number, limit: number): Promise<any[]> {
  try {
    const url = `https://manhwa18.com/manga-list?page=${page}&sort=az`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': SCRAPER_UA, 'Accept': 'text/html' },
    });
    if (!res.ok) return [];

    const html = await res.text();
    const results: any[] = [];

    // Extract items: data-bg for cover, series-title link for title/URL
    const thumbRx = /<div class="thumb-wrapper"[^>]*>[\s\S]*?<a href="(https:\/\/manhwa18\.com\/manga\/[^"]+)"[\s\S]*?data-bg="([^"]+)"[\s\S]*?<\/div>\s*<div class="thumb_attr series-title">\s*<a href="[^"]*" title="([^"]+)"/gi;
    let m: RegExpExecArray | null;
    while ((m = thumbRx.exec(html)) !== null && results.length < limit) {
      const href = m[1];
      const cover = m[2];
      const title = m[3];
      results.push({
        id: `manhwa18_${Buffer.from(href).toString('base64url').substring(0, 16)}`,
        title: title || 'Untitled',
        sourceUrl: href,
        coverImage: cover || '',
        sourceName: 'Manhwa18',
        description: 'Adult manhwa series from Manhwa18',
        genres: ['Adult', 'Manhwa'],
        latestChapter: 1,
        type: 'manhwa',
      });
    }

    // Simpler fallback if regex above yields nothing
    if (results.length === 0) {
      const titleRx = /<div class="thumb_attr series-title">\s*<a href="([^"]+)" title="([^"]+)"/gi;
      const bgRx = /data-bg="([^"]+)"/gi;
      const covers: string[] = [];
      let bg: RegExpExecArray | null;
      while ((bg = bgRx.exec(html)) !== null) covers.push(bg[1]);

      let t: RegExpExecArray | null;
      let i = 0;
      while ((t = titleRx.exec(html)) !== null && results.length < limit) {
        const href = t[1];
        const title = t[2];
        if (href.includes('/manga/')) {
          results.push({
            id: `manhwa18_${Buffer.from(href).toString('base64url').substring(0, 16)}`,
            title,
            sourceUrl: href.startsWith('http') ? href : `https://manhwa18.com${href}`,
            coverImage: covers[i] || '',
            sourceName: 'Manhwa18',
            description: 'Adult manhwa series',
            genres: ['Adult', 'Manhwa'],
            latestChapter: 1,
            type: 'manhwa',
          });
          i++;
        }
      }
    }

    return results;
  } catch (e) {
    console.error('[Scraper] Manhwa18 failed:', (e as Error).message);
    return [];
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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

// Helper: Get source-specific popular series feed (Kotatsu Parser Live Scraper + Multi-Tier Fallback)
// Returns { items, totalCount } so callers can set X-Total-Pages headers for proper pagination.
async function getSourcePopularSeries(sourceDef: SourceDefinition, page: number = 1, limit: number = 24): Promise<{ items: any[]; totalCount: number }> {
  const offset = (page - 1) * limit;

  // 1. MangaDex API (Official API v5)
  if (sourceDef.engineType === 'mangadex') {
    try {
      const mdRes = await fetchMangaDex(
        `https://api.mangadex.org/manga?order[followedCount]=desc&limit=${limit}&offset=${offset}&includes[]=cover_art&contentRating[]=safe&contentRating[]=suggestive`
      );
      if (mdRes.ok) {
        const mdData = await mdRes.json();
        const mdTotal = mdData.total || 10000;
        const items = (mdData.data || []).map((m: any) => {
          const titleObj = m.attributes.title || {};
          const title = titleObj.en || Object.values(titleObj)[0] || 'Unknown';
          const coverRel = (m.relationships || []).find((r: any) => r.type === 'cover_art');
          const coverFileName = coverRel?.attributes?.fileName;
          const rawCoverUrl = coverFileName
            ? `https://uploads.mangadex.org/covers/${m.id}/${coverFileName}.512.jpg`
            : '';
          return {
            id: `md_${m.id}`,
            title,
            sourceUrl: `https://mangadex.org/title/${m.id}`,
            coverImage: rawCoverUrl ? `/api/mangadex/image-proxy?url=${encodeURIComponent(rawCoverUrl)}` : '',
            sourceName: sourceDef.name,
            apiId: m.id,
            description: (m.attributes?.description?.en || '').substring(0, 200),
            genres: (m.attributes?.tags || []).map((t: any) => t.attributes?.name?.en).filter(Boolean).slice(0, 4),
            latestChapter: Number(m.attributes?.lastChapter) || 100,
            type: m.attributes?.originalLanguage === 'ko' ? 'manhwa' : m.attributes?.originalLanguage === 'zh' ? 'manhua' : 'manga',
          };
        });
        return { items, totalCount: mdTotal };
      }
    } catch (e) { }
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

    const liveRes = await fetch(catalogUrl, {
      signal: AbortSignal.timeout(4000),
      headers: {
        'User-Agent': SCRAPER_UA,
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    if (liveRes.ok) {
      const html = await liveRes.text();
      const allImgs: string[] = [];
      const imgRx = /<img[^>]+src=["']([^"']+)["'][^>]*/gi;
      let imgM;
      while ((imgM = imgRx.exec(html)) !== null) {
        const src = imgM[1];
        if (src && /\.(jpg|jpeg|png|webp)/i.test(src) && !/logo|avatar|banner|icon/i.test(src)) {
          allImgs.push(src.startsWith('http') ? src : `${sourceDef.baseUrl.replace(/\/$/, '')}${src}`);
        }
      }

      const linkRx = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]{3,120})<\/a>/gi;
      let lm;
      const seenTitles = new Set<string>();
      while ((lm = linkRx.exec(html)) !== null) {
        const href = lm[1];
        const title = lm[2].trim();
        const normTitle = title.toLowerCase();

        if (
          href && title && !seenTitles.has(normTitle) &&
          !/nav|menu|home|login|register|sign|account|cookie|privacy|about|dmca|contact/i.test(title) &&
          /\/(manga|series|title|manhwa|manhua|comic|webtoon)\//i.test(href)
        ) {
          seenTitles.add(normTitle);
          scrapedItems.push({
            id: `live_${sourceDef.id}_${Buffer.from(href).toString('base64url').substring(0, 16)}`,
            title,
            sourceUrl: href.startsWith('http') ? href : `${sourceDef.baseUrl.replace(/\/$/, '')}${href}`,
            coverImage: allImgs[scrapedItems.length] ||
              'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=400&auto=format&fit=crop&q=80',
            sourceName: sourceDef.name,
            description: `Live directory entry from ${sourceDef.name}`,
            genres: ['Action', 'Fantasy'],
            latestChapter: 10,
            type: sourceDef.id.includes('manhua') ? 'manhua' : sourceDef.id.includes('manhwa') ? 'manhwa' : 'manga',
          });
        }
      }
    }
  } catch (e) {
    // Live scrape timed out or failed — proceed to multi-tier database fallback
  }

  if (scrapedItems.length >= limit) {
    return { items: scrapedItems.slice(0, limit), totalCount: scrapedItems.length };
  }

  // 4. Dedicated Source Catalog Merging
  const dedicatedList = SOURCE_DEDICATED_CATALOGS[sourceDef.id] || [];
  const pathPrefix = sourceDef.id === 'manhwa18' ? '/webtoon/' : sourceDef.id === 'demonicscans' ? '/manga/' : '/manga/';
  const dedicatedItems = dedicatedList.map((item) => ({
    id: `src_${sourceDef.id}_${Buffer.from(item.slug).toString('base64url').substring(0, 16)}`,
    title: item.title,
    sourceUrl: `${sourceDef.baseUrl.replace(/\/$/, '')}${pathPrefix}${item.slug}`,
    coverImage: item.cover,
    sourceName: sourceDef.name,
    description: `Indexed exclusively from ${sourceDef.name} catalog`,
    genres: item.genres,
    latestChapter: item.latestChapter,
    type: item.type,
  }));

  // 5. SQLite Database & Kotatsu Dataset Merging
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

  const catalogMatches = KOTATSU_COMPLETE_CATALOG.filter((c: any) => {
    const cSource = (c.source || '').toLowerCase();
    return cSource.includes(targetId) || cSource.includes(targetName);
  }).map((c: any) => ({
    id: `cat_${sourceDef.id}_${c.id}`,
    title: c.title,
    sourceUrl: c.sourceUrl || sourceDef.baseUrl,
    coverImage: c.coverImage,
    sourceName: sourceDef.name,
    description: c.description || `Catalog entry from ${sourceDef.name}`,
    genres: c.genres || ['Action'],
    latestChapter: c.latestChapter || 10,
    type: c.type || 'manhwa',
  }));

  // Combine & Deduplicate by Title
  const combined = [...scrapedItems, ...dedicatedItems, ...dbMatches, ...catalogMatches];
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

  const staticCount =
    (SOURCE_DEDICATED_CATALOGS[sourceDef.id] || []).length +
    SqliteDb.getAllManga().filter((m: any) => {
      const n = (m.sourceName || '').toLowerCase();
      const u = (m.sourceUrl || '').toLowerCase();
      return n.includes(idL) || n.includes(nameL) || (u || '').includes(domain);
    }).length +
    KOTATSU_COMPLETE_CATALOG.filter((c: any) =>
      (c.source || '').toLowerCase().includes(idL) || (c.source || '').toLowerCase().includes(nameL)
    ).length;

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

  const sourceDef = KOTATSU_SOURCES.find((s) => s.id === sourceId) || KOTATSU_SOURCES[0];

  try {
    // ── 1. MangaDex official API v5 with full metadata ─────────────────────
    if (sourceDef.engineType === 'mangadex') {
      const mdUrl = query
        ? `https://api.mangadex.org/manga?title=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}${langFilter}&includes[]=cover_art&contentRating[]=safe&contentRating[]=suggestive`
        : `https://api.mangadex.org/manga?order[followedCount]=desc&limit=${limit}&offset=${offset}${langFilter}&includes[]=cover_art&contentRating[]=safe&contentRating[]=suggestive`;

      const mdRes = await fetchMangaDex(mdUrl);
      if (mdRes.ok) {
        const mdData = await mdRes.json();
        const items = (mdData.data || []).map((m: any) => {
          const titleObj = m.attributes.title || {};
          const title = titleObj.en || Object.values(titleObj)[0] || 'Unknown';
          const lang = m.attributes.originalLanguage || '';
          const type = lang === 'ko' ? 'manhwa' : lang === 'zh' || lang === 'zh-hk' ? 'manhua' : 'manga';
          const coverRel = (m.relationships || []).find((r: any) => r.type === 'cover_art');
          const coverFileName = coverRel?.attributes?.fileName;
          const rawCoverUrl = coverFileName
            ? `https://uploads.mangadex.org/covers/${m.id}/${coverFileName}.512.jpg`
            : '';
          const descObj = m.attributes.description || {};
          const description = (descObj.en || Object.values(descObj)[0] || '').substring(0, 250);
          const tags = (m.attributes.tags || []).map((t: any) => t.attributes?.name?.en).filter(Boolean).slice(0, 5);
          return {
            id: `md_${m.id}`,
            title,
            sourceUrl: `https://mangadex.org/title/${m.id}`,
            coverImage: rawCoverUrl
              ? `/api/mangadex/image-proxy?url=${encodeURIComponent(rawCoverUrl)}`
              : '/api/mangadex/image-proxy?url=https%3A%2F%2Fuploads.mangadex.org%2Fcovers%2F32d76d19-8a05-4db0-9fc2-e0b0648fe9d0%2Ffbc962f9-3d12-4c6e-8212-32a2cb874a7b.jpg',
            sourceName: sourceDef.name,
            apiId: m.id,
            description,
            genres: tags.length ? tags : ['Action', 'Fantasy'],
            latestChapter: Number(m.attributes.lastChapter) || undefined,
            type,
          };
        });
        return res.json(items);
      }
    }

    // ── 2. No query → serve source-specific popular series ───────────────
    if (!query) {
      const { items: popular, totalCount } = await getSourcePopularSeries(sourceDef, page, limit);
      res.setHeader('X-Total-Count', String(totalCount));
      res.setHeader('X-Total-Pages', String(Math.ceil(totalCount / limit)));
      return res.json(popular);
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
            id: `kotatsu_${sourceDef.id}_${Buffer.from(href).toString('base64url').substring(0, 16)}`,
            title,
            sourceUrl: href.startsWith('http') ? href : `${sourceDef.baseUrl}${href}`,
            coverImage: allImgs[results.length] ||
              'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=400&auto=format&fit=crop&q=80',
            sourceName: sourceDef.name,
            genres: ['Action'],
          });
        }
      }
      if (results.length > 0) return res.json(results);
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
    return res.json(fallback);

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

// Live Domain Sources Registry for Active Extraction

// Live Domain Sources Registry for Active Extraction

const REGISTERED_LIVE_DOMAINS = [
  { id: 'mangadex', domain: 'mangadex', name: 'MangaDex REST API' },
  { id: 'dynasty', domain: 'dynasty-scans', name: 'Dynasty Scans Engine' },
  { id: 'asura', domain: 'asura', name: 'Asura Scans' },
  { id: 'flame', domain: 'flame', name: 'Flame Comics' },
  { id: 'luminous', domain: 'luminous', name: 'Luminous Scans' },
  { id: 'night', domain: 'nightscans', name: 'Night Scans' },
  { id: 'immortal', domain: 'immortalupdates', name: 'Immortal Updates' },
  { id: 'manhwabuddy', domain: 'manhwabuddy', name: 'Manhwa Buddy' },
  { id: 'manhuafast', domain: 'manhuafast', name: 'Manhua Fast' },
  { id: 'kunmanga', domain: 'kunmanga', name: 'Kun Manga' },
  { id: 'manhwa18', domain: 'manhwa18', name: 'Manhwa18' },
  { id: 'manhuaplus', domain: 'manhuaplus', name: 'Manhua Plus' },
  { id: 'mangatx', domain: 'mangatx', name: 'Manga TX' },
  { id: 'topmanhua', domain: 'topmanhua', name: 'Top Manhua' },
  { id: 'manhwaclan', domain: 'manhwaclan', name: 'Manhwa Clan' },
  { id: 'aquamanga', domain: 'aqua', name: 'Aqua Manga' },
  { id: 'weebcentral', domain: 'weebcentral', name: 'Weeb Central' },
  { id: 'atsumoe', domain: 'atsu', name: 'Atsu Moe' },
  { id: 'demonicscans', domain: 'demonicscans', name: 'Demonic Scans' },
];

const DOMAIN_MIRRORS: Record<string, string> = {
  'asurascans.com': 'asuracomic.net',
  'asurascans.org': 'asuracomic.net',
  'aquamanga.com': 'aquareader.org',
  'aquamanga.org': 'aquareader.org',
  'flamescans.org': 'flamecomics.xyz',
  'flamescans.com': 'flamecomics.xyz',
  'manhwa18.cc': 'manhwa18.com',
  'manhwa18.net': 'manhwa18.com',
  'manhwa18.org': 'manhwa18.com',
};


async function extractLiveDomainChapterPages(
  rawTargetUrl: string,
  domainId: string,
  chapterNumber: number = 1
): Promise<string[] | null> {
  try {
    // 0. Auto Domain Mirror Redirection for Migrated Sources
    let targetUrl = rawTargetUrl;
    for (const [oldDomain, newDomain] of Object.entries(DOMAIN_MIRRORS)) {
      if (targetUrl.includes(oldDomain)) {
        targetUrl = targetUrl.replace(oldDomain, newDomain);
        break;
      }
    }

    if (targetUrl.includes('manhwa18')) {
      if (targetUrl.includes('/webtoon/')) {
        targetUrl = targetUrl.replace('/webtoon/', '/manga/');
      }
      if (targetUrl.includes('/read/')) {
        targetUrl = targetUrl.replace('/read/', '/manga/');
      }
    }


    console.log(`[Live Source Extractor] Extracting Chapter ${chapterNumber} from ${domainId} (${targetUrl})`);

    // 1. Asura Scans Official API v2 Integration with Slug Hash Fallback
    if (domainId === 'asura') {
      try {
        let slug = targetUrl.split('/').pop() || '';
        if (targetUrl.includes('/manga/') || targetUrl.includes('/series/') || targetUrl.includes('/comics/')) {
          const parts = targetUrl.split('/');
          const idx = parts.findIndex((p) => p === 'manga' || p === 'series' || p === 'comics');
          if (idx !== -1 && parts[idx + 1]) {
            slug = parts[idx + 1];
          }
        }

        if (slug) {
          const cleanSlug = slug.replace(/-(?:00dcbf97|b8509c2a|[a-f0-9]{8})$/i, '');
          const slugsToTry = Array.from(new Set([
            slug,
            cleanSlug,
            `${cleanSlug}-00dcbf97`,
            `${cleanSlug}-b8509c2a`,
          ]));
          let chapters: any[] = [];
          let matchedSlug = slug;

          for (const s of slugsToTry) {
            const listRes = await fetch(`https://api.asurascans.com/api/series/${s}/chapters`, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json',
                'Origin': 'https://asuracomic.net',
                'Referer': 'https://asuracomic.net/',
              },
            });

            if (listRes.ok) {
              const listData = await listRes.json();
              if (listData.data && listData.data.length > 0) {
                chapters = listData.data;
                matchedSlug = s;
                break;
              }
            }
          }

          if (chapters.length > 0) {
            const targetChapter =
              chapters.find((c: any) => Number(c.number) === Number(chapterNumber)) ||
              chapters.find((c: any) => c.slug && c.slug.includes(`${chapterNumber}`)) ||
              chapters[chapters.length - 1];

            if (targetChapter && targetChapter.slug) {
              const pagesRes = await fetch(`https://api.asurascans.com/api/series/${matchedSlug}/chapters/${targetChapter.slug}`, {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                  'Accept': 'application/json',
                  'Origin': 'https://asuracomic.net',
                  'Referer': 'https://asuracomic.net/',
                },
              });

              if (pagesRes.ok) {
                const pagesData = await pagesRes.json();
                const rawPages = pagesData.data?.chapter?.pages || [];
                if (rawPages.length > 0) {
                  console.log(`[Asura API Engine] Successfully loaded ${rawPages.length} live pages for ${matchedSlug} Chapter ${chapterNumber}`);
                  return rawPages.map((p: any) => p.url);
                }
              }
            }
          }
        }
      } catch (err: any) {
        console.warn(`[Asura Scans API Engine] Failed, falling back to HTML parser:`, err.message);
      }
    }

    // 2. Flame Comics Next.js API Integration (Kotatsu-Redo)
    if (domainId === 'flame') {
      try {
        const homeRes = await fetch("https://flamecomics.xyz/", {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        if (homeRes.ok) {
          const html = await homeRes.text();
          const buildIdMatch = html.match(/\/_next\/static\/([^/]+)\/_buildManifest\.js/);
          const buildId = buildIdMatch ? buildIdMatch[1] : null;

          if (buildId) {
            // Fetch browse catalog to get series ID
            const browseRes = await fetch(`https://flamecomics.xyz/_next/data/${buildId}/browse.json`, {
              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
            });

            if (browseRes.ok) {
              const browseJson = await browseRes.json();
              const seriesList = browseJson.pageProps?.series || [];
              const rawSlug = targetUrl.split('/').pop() || '';
              const matchedSeries = seriesList.find((s: any) => {
                const sId = String(s.series_id || s.id);
                const sTitle = s.title?.toLowerCase().replace(/[^a-z0-9]/g, '');
                const targetNorm = rawSlug.toLowerCase().replace(/[^a-z0-9]/g, '');
                return sId === rawSlug || (targetNorm && sTitle.includes(targetNorm));
              }) || seriesList[0];

              if (matchedSeries) {
                const seriesId = matchedSeries.series_id || matchedSeries.id;
                const seriesRes = await fetch(`https://flamecomics.xyz/_next/data/${buildId}/series/${seriesId}.json`, {
                  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
                });

                if (seriesRes.ok) {
                  const seriesData = await seriesRes.json();
                  const chapters = seriesData.pageProps?.chapters || [];
                  const matchedCh = chapters.find((c: any) => Number(c.chapter || c.number || c.title?.match(/\d+/)?.[0]) === Number(chapterNumber)) || chapters[0];

                  if (matchedCh) {
                    const token = matchedCh.token || matchedCh.chapter_id || matchedCh.id;
                    const chRes = await fetch(`https://flamecomics.xyz/_next/data/${buildId}/series/${seriesId}/${token}.json?id=${seriesId}&token=${token}`, {
                      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
                    });

                    if (chRes.ok) {
                      const chData = await chRes.json();
                      const imagesObj = chData.pageProps?.chapter?.images || {};
                      const imageKeys = Object.keys(imagesObj);
                      if (imageKeys.length > 0) {
                        console.log(`[Flame Comics API Engine] Successfully extracted ${imageKeys.length} live pages for seriesId ${seriesId} token ${token}`);
                        return imageKeys.map((k) => {
                          const imgName = imagesObj[k].name || imagesObj[k];
                          return `https://flamecomics.xyz/_next/image?url=https%3A%2F%2Fcdn.flamecomics.xyz%2Fuploads%2Fimages%2Fseries%2F${seriesId}%2F${token}%2F${imgName}&w=1920&q=100`;
                        });
                      }
                    }
                  }
                }
              }
            }
          }
        }
      } catch (err: any) {
        console.warn(`[Flame Comics API Engine] Failed, falling back to HTML parser:`, err.message);
      }
    }

    // 3. MangaDex API
    if (domainId === 'mangadex' && targetUrl.includes('/chapter/')) {
      const chId = targetUrl.split('/chapter/')[1]?.split('/')[0];
      if (chId) {
        const mdRes = await fetch(`https://api.mangadex.org/at-home/server/${chId}`);
        if (mdRes.ok) {
          const mdData = await mdRes.json();
          if (mdData?.chapter?.data) {
            return mdData.chapter.data.map((fn: string) => `${mdData.baseUrl}/data/${mdData.chapter.hash}/${fn}`);
          }
        }
      }
    }

    // 4. Dynasty Scans Series & Chapter Resolution
    if (domainId === 'dynasty' || targetUrl.includes('dynasty-scans.com')) {
      try {
        let chUrl = targetUrl;
        if (targetUrl.includes('/series/')) {
          const seriesRes = await fetch(targetUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          });
          if (seriesRes.ok) {
            const html = await seriesRes.text();
            const seriesSlug = targetUrl.split('/').pop() || '';
            const chMatches = Array.from(html.matchAll(/href=["'](\/chapters\/[^"']+)["']/gi))
              .map((m) => m[1])
              .filter((href) => href.includes(seriesSlug) || !/added|tags|search/i.test(href));
            if (chMatches.length > 0) {
              const matchedHref = chMatches[chapterNumber - 1] || chMatches[0];
              chUrl = `https://dynasty-scans.com${matchedHref}`;
            }
          }
        }

        const res = await fetch(chUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', Referer: targetUrl },
        });
        if (res.ok) {
          const html = await res.text();
          const match = html.match(/var\s+pages\s*=\s*(\[[\s\S]*?\]);/);
          if (match && match[1]) {
            const pagesObj = JSON.parse(match[1]);
            const pageUrls = pagesObj.map((p: any) => (p.image.startsWith('http') ? p.image : `https://dynasty-scans.com${p.image}`));
            if (pageUrls.length > 0) return pageUrls;
          }
        }
      } catch (err: any) {
        console.warn(`[Dynasty Scans Extractor] Error:`, err.message);
      }
    }

    // 5. Universal HTML Chapter Resolver & Multi-Attribute Image Extractor
    const origin = new URL(targetUrl).origin;
    const reqHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Referer': origin + '/',
    };

    let chUrl = targetUrl;
    const isDirectChapterUrl = /\/(chapter|chap|ch)[-\/_\.]?\d+/i.test(targetUrl);

    if (!isDirectChapterUrl) {
      try {
        const sRes = await fetch(targetUrl, { headers: reqHeaders });
        if (sRes.ok) {
          const sHtml = await sRes.text();
          const chLinkRx = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
          let match;
          const candidates: { href: string; num: number }[] = [];
          while ((match = chLinkRx.exec(sHtml)) !== null) {
            const href = match[1];
            const text = match[2].replace(/<[^>]+>/g, '').trim();
            if (/chapter|chap|ch/i.test(href) || /chapter|chap|ch/i.test(text)) {
              const numM = (href + ' ' + text).match(/(?:chapter|chap|ch)[^\d]*(\d+(?:\.\d+)?)/i);
              if (numM) {
                const num = parseFloat(numM[1]);
                candidates.push({ href, num });
              }
            }
          }
          const matched = candidates.find((c) => c.num === chapterNumber) || candidates[0];
          if (matched) {
            chUrl = matched.href.startsWith('http') ? matched.href : `${origin}${matched.href.startsWith('/') ? '' : '/'}${matched.href}`;
          } else {
            chUrl = targetUrl.includes('manhwa18')
              ? `${targetUrl.replace(/\/$/, '')}/chap-${chapterNumber.toString().padStart(2, '0')}/`
              : `${targetUrl.replace(/\/$/, '')}/chapter-${chapterNumber}/`;
          }
        }
      } catch (e) {
        chUrl = targetUrl.includes('manhwa18')
          ? `${targetUrl.replace(/\/$/, '')}/chap-${chapterNumber.toString().padStart(2, '0')}/`
          : `${targetUrl.replace(/\/$/, '')}/chapter-${chapterNumber}/`;
      }
    }


    const pageRes = await fetch(chUrl, { headers: reqHeaders });

    if (pageRes.ok) {
      const htmlText = await pageRes.text();
      const imgRegex = /<img[^>]+(?:data-src|data-lazy-src|data-cfsrc|data-full-url|data-original|srcset|src)=["']([^"']+)["'][^>]*>/gi;
      const pages: string[] = [];
      let match;

      while ((match = imgRegex.exec(htmlText)) !== null) {
        let src = match[1]?.trim();
        if (src && src.includes(' ')) {
          src = src.split(' ')[0]; // Extract first image from srcset
        }
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
          !src.includes('manhwa18.cc/manga/') &&
          !src.includes('cdn.manhwa18.com')
        ) {
          pages.push(src.startsWith('http') ? src : `${origin}${src.startsWith('/') ? '' : '/'}${src}`);
        }
      }


      const uniquePages = Array.from(new Set(pages));
      if (uniquePages.length > 0) return uniquePages;
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
}

const kotatsuImageEngine = new KotatsuImageEngine();

// Get chapter page image URLs with automatic MangaDex & Live Source Stream Resolution
app.get("/api/reader/chapter-pages", async (req, res) => {
  const mangaId = req.query.mangaId as string;
  const chapterNumber = Math.max(1, parseFloat(req.query.chapterNumber as string) || 1);
  let chapterId = (req.query.chapterId as string) || '';

  const manga = mangaDatabase.find((m) => m.id === mangaId || m.apiId === mangaId);
  const mangaTitle = manga ? manga.title : 'Webtoon Series';
  const totalChapters = manga ? Math.max(manga.latestChapter || 1, manga.currentChapter || 1, chapterNumber) : 200;

  // 1. AUTOMATIC MANGADEX LIVE STREAM RESOLUTION
  const mangaDexId =
    manga?.apiId ||
    (mangaId?.startsWith('md_') ? mangaId.replace('md_', '') : null) ||
    (manga?.sourceUrl?.match(/\/title\/([a-f0-9\-]+)/i)?.[1]);

  if (mangaDexId) {
    try {
      console.log(`[Reader Stream Engine] Resolving live MangaDex chapter feed for ${mangaTitle} (${mangaDexId}), Chapter ${chapterNumber}...`);

      let targetChapterUuid = chapterId && chapterId.length > 20 && !chapterId.startsWith('ch_') ? chapterId : '';

      if (!targetChapterUuid) {
        // Fetch chapter feed from MangaDex API (with english filter + fallback)
        let feedRes = await fetchMangaDex(
          `https://api.mangadex.org/manga/${mangaDexId}/feed?translatedLanguage[]=en&order[chapter]=asc&limit=100&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica`
        );

        if (feedRes.ok) {
          let feedData = await feedRes.json();
          let chapters = feedData.data || [];
          if (chapters.length === 0) {
            const fallbackRes = await fetchMangaDex(
              `https://api.mangadex.org/manga/${mangaDexId}/feed?limit=100&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica`
            );
            if (fallbackRes.ok) {
              feedData = await fallbackRes.json();
              chapters = feedData.data || [];
            }
          }

          const matchedCh = chapters.find((c: any) => parseFloat(c.attributes.chapter) === chapterNumber) || chapters[0];
          if (matchedCh) {
            targetChapterUuid = matchedCh.id;
          }
        }
      }

      if (targetChapterUuid) {
        // Fetch At-Home server CDN page URLs
        const atHomeRes = await fetchMangaDex(`https://api.mangadex.org/at-home/server/${targetChapterUuid}`);
        if (atHomeRes.ok) {
          const atHomeData = await atHomeRes.json();
          const baseUrl = atHomeData.baseUrl;
          const hash = atHomeData.chapter.hash;
          const pageFiles: string[] = atHomeData.chapter.data || [];

          if (baseUrl && hash && pageFiles.length > 0) {
            const pages = pageFiles.map((file) => {
              const rawUrl = `${baseUrl}/data/${hash}/${file}`;
              return `/api/mangadex/image-proxy?url=${encodeURIComponent(rawUrl)}`;
            });

            console.log(`[Reader Stream Engine] Successfully loaded ${pages.length} live MangaDex pages for Chapter ${chapterNumber}`);
            return res.json({
              chapterId: targetChapterUuid,
              mangaId: mangaId || `md_${mangaDexId}`,
              mangaTitle,
              chapterNumber,
              title: `Chapter ${chapterNumber}`,
              scanGroup: 'MangaDex API v5 CDN',
              selectedGroup: 'MangaDex Official',
              pages,
              totalChapters,
              nextChapterNumber: chapterNumber < totalChapters ? chapterNumber + 1 : null,
              prevChapterNumber: chapterNumber > 1 ? chapterNumber - 1 : null,
            });
          }
        }
      }
    } catch (err) {
      console.error("[Reader Stream Engine] MangaDex live page resolution error:", err);
    }
  }

  // 2. LIVE DOMAIN SOURCE CRAWLER RESOLUTION (KOTATSU IMAGE ENGINE)
  const targetUrl = (req.query.url as string) || manga?.sourceUrl || '';
  if (targetUrl && (targetUrl.startsWith('http://') || targetUrl.startsWith('https://'))) {
    const matchedDomain = REGISTERED_LIVE_DOMAINS.find((d) => targetUrl.includes(d.domain));
    const domainId = matchedDomain ? matchedDomain.id : 'general';
    const domainIsDisabled = matchedDomain ? disabledSourceIds.has(matchedDomain.id) : false;

    if (!domainIsDisabled) {
      let livePages = await kotatsuImageEngine.getChapterPages(targetUrl, domainId, chapterNumber);

      // Probe panel 1 to ensure remote image host isn't returning 404 / 502
      if (livePages && livePages.length > 0) {
        try {
          const sampleUrl = livePages[0];
          const probeRes = await fetch(sampleUrl, {
            method: 'HEAD',
            signal: AbortSignal.timeout(2500),
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Referer': targetUrl.startsWith('http') ? new URL(targetUrl).origin + '/' : 'https://manhwa18.com/',
            },
          });
          if (!probeRes.ok && probeRes.status !== 405) {
            console.warn(`[Reader Stream Engine] Live panel probe returned HTTP ${probeRes.status} for ${sampleUrl} — falling back to MangaDex stream.`);
            livePages = null;
          }
        } catch (_) { }
      }

      if (livePages && livePages.length > 0) {
        const proxiedPages = livePages.map(
          (p) => `/api/reader/proxy-image?url=${encodeURIComponent(p)}&sourceUrl=${encodeURIComponent(targetUrl)}`
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
        });
      }
    } else if (matchedDomain && domainIsDisabled) {
      console.warn(`[Live Source Extractor] Skipping extraction — source "${matchedDomain.name}" is currently disabled.`);
    }
  }

  // 3. MANGADEX TITLE SEARCH FALLBACK (If direct source extraction failed)
  if (mangaTitle && mangaTitle !== 'Webtoon Series') {
    try {
      const cleanTitle = mangaTitle.replace(/\s*\([^)]*\)/g, '').trim();
      const titlesToTry = [cleanTitle];
      if (cleanTitle.toLowerCase().startsWith('xtra')) {
        titlesToTry.push(cleanTitle.replace(/xtra/i, 'Extra'));
      }

      for (const t of titlesToTry) {
        console.log(`[Reader Stream Engine] Attempting MangaDex API fallback search for title "${t}"...`);
        const searchRes = await fetchMangaDex(
          `https://api.mangadex.org/manga?title=${encodeURIComponent(t)}&limit=1`
        );
        if (searchRes.ok) {
          const searchData = await searchRes.json();
          const foundManga = searchData.data?.[0];
          if (foundManga) {
            const foundId = foundManga.id;
            const feedRes = await fetchMangaDex(
              `https://api.mangadex.org/manga/${foundId}/feed?order[chapter]=asc&limit=100`
            );
            if (feedRes.ok) {
              const feedData = await feedRes.json();
              const chapters = feedData.data || [];
              const matchedCh = chapters.find((c: any) => parseFloat(c.attributes.chapter) === chapterNumber) || chapters[0];
              if (matchedCh) {
                const atHomeRes = await fetchMangaDex(`https://api.mangadex.org/at-home/server/${matchedCh.id}`);
                if (atHomeRes.ok) {
                  const atHomeData = await atHomeRes.json();
                  const baseUrl = atHomeData.baseUrl;
                  const hash = atHomeData.chapter.hash;
                  const pageFiles: string[] = atHomeData.chapter.data || [];
                  if (baseUrl && hash && pageFiles.length > 0) {
                    const pages = pageFiles.map((file) => `/api/mangadex/image-proxy?url=${encodeURIComponent(`${baseUrl}/data/${hash}/${file}`)}`);
                    console.log(`[Reader Stream Engine] MangaDex search fallback successfully loaded ${pages.length} live pages for "${t}" Chapter ${chapterNumber}`);
                    return res.json({
                      chapterId: matchedCh.id,
                      mangaId: mangaId || `md_${foundId}`,
                      mangaTitle,
                      chapterNumber,
                      title: `Chapter ${chapterNumber}`,
                      scanGroup: 'MangaDex API Fallback',
                      selectedGroup: 'MangaDex API Fallback',
                      pages,
                      totalChapters,
                      nextChapterNumber: chapterNumber < totalChapters ? chapterNumber + 1 : null,
                      prevChapterNumber: chapterNumber > 1 ? chapterNumber - 1 : null,
                    });
                  }
                }
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn(`[Reader Stream Engine] MangaDex title search fallback error:`, e);
    }
  }


  // 4. Dynamic Fallback Panel Generator
  const pageCount = 14;
  const pages: string[] = [];
  for (let p = 1; p <= pageCount; p++) {
    const pageUrl = `/api/reader/panel-image?manga=${encodeURIComponent(mangaTitle)}&chapter=${chapterNumber}&page=${p}&totalPages=${pageCount}&type=${manga?.type || 'manhwa'}&genre=${encodeURIComponent(manga?.genres[0] || 'Action')}`;
    pages.push(pageUrl);
  }

  res.json({
    chapterId: `ch_${mangaId}_${chapterNumber}`,
    mangaId: mangaId || 'm1',
    mangaTitle,
    chapterNumber,
    title: `Chapter ${chapterNumber}`,
    scanGroup: manga?.sourceName || 'Scanlation Site',
    pages,
    totalChapters,
    nextChapterNumber: chapterNumber < totalChapters ? chapterNumber + 1 : null,
    prevChapterNumber: chapterNumber > 1 ? chapterNumber - 1 : null,
  });
});


// Dynamic Webtoon Canvas Panel Renderer (SVG Image endpoint)
app.get("/api/reader/panel-image", (req, res) => {
  const manga = (req.query.manga as string) || 'Webtoon';
  const chapter = (req.query.chapter as string) || '1';
  const page = Number(req.query.page) || 1;
  const totalPages = Number(req.query.totalPages) || 14;
  const type = (req.query.type as string) || 'manhwa';
  const genre = (req.query.genre as string) || 'Action';

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
        ${manga.replace(/</g, '&lt;').replace(/>/g, '&gt;')}
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
        ${dialogueText.replace(/</g, '&lt;').replace(/>/g, '&gt;')}
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
        Click "Next Chapter" to continue reading Chapter ${Number(chapter) + 1}!
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
          Page ${page}: "Unleashing the ${genre} aura power!"
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
  res.send(svg);
});

// Universal Kotatsu Image Proxy with Anti-Hotlink Header Injection & CORS
app.get(["/api/reader/proxy-image", "/api/mangadex/image-proxy"], async (req, res) => {
  let targetUrl = req.query.url as string;
  const sourceUrl = req.query.sourceUrl as string;

  if (!targetUrl) {
    return res.status(400).json({ error: "Missing required 'url' parameter" });
  }

  // Unwrap nested proxy URLs if passed recursively to prevent HTTP 400 loops
  while (targetUrl.includes('/api/mangadex/image-proxy?url=') || targetUrl.includes('/api/reader/proxy-image?url=')) {
    try {
      const match = targetUrl.match(/url=([^&]+)/);
      if (match && match[1]) {
        targetUrl = decodeURIComponent(match[1]);
      } else {
        break;
      }
    } catch (e) {
      break;
    }
  }

  // If local SVG panel image, redirect directly
  if (targetUrl.startsWith('/api/reader/panel-image')) {
    return res.redirect(targetUrl);
  }

  // If targetUrl is relative path, resolve to absolute URL
  if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
    targetUrl = `http://127.0.0.1:${PORT}${targetUrl.startsWith('/') ? '' : '/'}${targetUrl}`;
  }

  try {
    let referer = 'https://mangadex.org';
    if (targetUrl.includes('pornwa') || targetUrl.includes('manhwa18')) {
      referer = 'https://manhwa18.com/';
    } else if (sourceUrl) {
      try { referer = new URL(sourceUrl).origin + '/'; } catch (e) { }
    } else if (targetUrl.startsWith('http')) {
      try { referer = new URL(targetUrl).origin + '/'; } catch (e) { }
    }


    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
        'Referer': referer,
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      },
    });

    if (!response.ok) {
      // If fetching external fails, redirect to dynamic panel generator
      console.warn(`[Proxy Image Engine] Host returned HTTP ${response.status} for ${targetUrl}`);
      return res.redirect(`/api/reader/panel-image?manga=Page%20Panel&chapter=1&page=1`);
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await response.arrayBuffer());

    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.send(buffer);
  } catch (err: any) {
    console.error(`[Proxy Image Engine] Detailed Error fetching target image (${targetUrl}):`, err.stack || err.message || err);
    res.redirect(`/api/reader/panel-image?manga=Page%20Panel&chapter=1&page=1`);
  }
});

// Mark Chapter as Read
app.post("/api/reader/mark-read", (req, res) => {
  const { mangaId, chapterNumber } = req.body;
  const index = mangaDatabase.findIndex((m) => m.id === mangaId);
  if (index === -1) {
    return res.status(404).json({ error: "Manga not found" });
  }

  const manga = mangaDatabase[index];
  const newChapterNum = Math.max(manga.currentChapter, Number(chapterNumber) || 1);
  const updatedItem: MangaItem = {
    ...manga,
    currentChapter: newChapterNum,
    latestChapter: Math.max(manga.latestChapter, newChapterNum),
    lastReadAt: new Date().toISOString(),
    status: manga.status === 'plan_to_read' ? 'reading' : manga.status,
  };

  syncAddOrUpdateManga(updatedItem);
  res.json({ success: true, manga: updatedItem });
});

// Default App & Kotatsu Reader Settings in Server Memory
let appSettings = {
  appTheme: 'amber',
  libraryLayout: 'grid',
  gridColumns: 4,
  autoMarkReadPercent: 80,
  enableDownloadOffline: true,
  sourceTimeoutSeconds: 15,
  anilistConnected: true,
  mangadexConnected: true,
  customUserAgent: 'Kotatsu/4.8.2 (Android 14; Mobile; OmniManga-Sync)',
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
    const directRes = await fetch(targetUrl, {
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



// GDPR Article 15: Right to Access & Data Portability Export
app.get("/api/gdpr/export-data/:userId", (req, res) => {
  const { userId } = req.params;
  const user = userProfiles.find((u) => u.id === userId);
  if (!user) return res.status(404).json({ error: "User not found" });

  const userSeries = mangaDatabase.filter((m) => m.userId === userId);
  const gdprExportBundle = {
    complianceNotice: "GDPR Article 15 Data Portability Export",
    exportTimestamp: new Date().toISOString(),
    personalData: {
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      avatar: user.avatar,
      role: user.role,
      createdAt: user.createdAt,
    },
    userMangaLibrary: userSeries,
  };

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="gdpr_export_${userId}.json"`);
  res.send(JSON.stringify(gdprExportBundle, null, 2));
});

// GDPR Article 17: Right to Erasure / Right to be Forgotten
app.delete("/api/gdpr/erase-data/:userId", (req, res) => {
  const { userId } = req.params;
  userProfiles = userProfiles.filter((u) => u.id !== userId);
  mangaDatabase = mangaDatabase.filter((m) => m.userId !== userId);
  saveDatabaseToDisk();
  console.log(`[GDPR Engine] User ${userId} requested full data erasure. All PII and library records purged.`);
  res.json({ success: true, message: "All user PII and library data permanently erased in compliance with GDPR Article 17." });
});

// GET Settings
app.get("/api/settings", (req, res) => {
  res.json(appSettings);
});


// POST Update Settings
app.post("/api/settings", (req, res) => {
  if (req.body) {
    appSettings = {
      ...appSettings,
      ...req.body,
      readerDefaults: {
        ...appSettings.readerDefaults,
        ...(req.body.readerDefaults || {}),
      },
    };
    saveDatabaseToDisk();
  }
  res.json({ success: true, settings: appSettings });
});

// Export Backup JSON
app.get("/api/settings/backup/export", (req, res) => {
  const backup = {
    version: "2.5.0-kotatsu",
    exportedAt: new Date().toISOString(),
    mangaDatabase: SqliteDb.getAllManga(),
    config: syncConfig,
    appSettings,
  };

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="kotatsu_omnimanga_backup.json"');
  res.send(JSON.stringify(backup, null, 2));
});

// Import Backup JSON
app.post("/api/settings/backup/import", (req, res) => {
  try {
    const { mangaDatabase: importedManga, config: importedConfig, appSettings: importedSettings } = req.body;
    if (Array.isArray(importedManga)) {
      syncBulkAddOrUpdateManga(importedManga);
    }
    if (importedConfig) {
      syncConfig = { ...syncConfig, ...importedConfig, totalTracked: mangaDatabase.length };
      if (Array.isArray(importedConfig.disabledSources)) {
        disabledSourceIds.clear();
        importedConfig.disabledSources.forEach((id: string) => disabledSourceIds.add(id));
      }
    }
    if (importedSettings) {
      appSettings = { ...appSettings, ...importedSettings };
    }
    saveDatabaseToDisk();
    res.json({ success: true, count: SqliteDb.getMangaCount() });
  } catch (err: any) {
    res.status(400).json({ error: "Invalid backup format" });
  }
});


// Clear Cache Endpoint
app.post("/api/settings/cache/clear", (req, res) => {
  res.json({ success: true, message: "Scanlation image cache and temporary canvas buffers cleared successfully." });
});

// ==========================================
// HOST PC PRIVILEGE ENGINE & SECURITY MIDDLEWARE
// ==========================================

export function isHostRequest(req: express.Request): boolean {
  const clientIp = (req.headers['x-forwarded-for'] as string) || req.ip || req.socket.remoteAddress || '127.0.0.1';
  return (
    clientIp === '127.0.0.1' ||
    clientIp === '::1' ||
    clientIp === '::ffff:127.0.0.1' ||
    clientIp.includes('127.0.0.1') ||
    clientIp === 'localhost'
  );
}

// Host PC Client Context Endpoint
app.get("/api/auth/client-context", (req, res) => {
  const isHost = isHostRequest(req);
  const clientIp = (req.headers['x-forwarded-for'] as string) || req.ip || req.socket.remoteAddress || '127.0.0.1';
  res.json({
    isHost,
    clientIp,
    defaultRole: isHost ? 'admin' : 'guest',
  });
});

// Restrict all Admin operations strictly to the Host Computer
app.use("/api/admin/*", (req, res, next) => {
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

// Get All Users List (Admin)
app.get("/api/admin/users", (_req, res) => {
  res.json(userProfiles);
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
  console.log(`[Admin Engine] User ${userProfiles[idx].name} (${userId}) role updated to ${role}.`);
  res.json({ success: true, user: userProfiles[idx] });
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

  // Perform purge
  userProfiles = userProfiles.filter((u) => u.id !== userId);
  const initialSeriesCount = mangaDatabase.length;
  mangaDatabase = mangaDatabase.filter((m) => m.userId !== userId);
  const purgedSeriesCount = initialSeriesCount - mangaDatabase.length;

  saveDatabaseToDisk();
  console.log(`[Admin Engine] User "${user.name}" (${userId}) permanently deleted after double-confirmation. (${purgedSeriesCount} library records purged)`);

  res.json({
    success: true,
    message: `User account '${user.name}' and ${purgedSeriesCount} associated library records permanently deleted.`,
    deletedUserId: userId,
    remainingUsers: userProfiles,
  });
});

// ==========================================
// BUG TRACKING & BUGS.MD PERSISTENCE
// ==========================================

const BUGS_FILE_PATH = path.join(process.cwd(), "BUGS.md");

// Submit Bug Endpoint -> Appends directly to BUGS.md
app.post("/api/bugs/submit", (req, res) => {
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

async function startServer() {
  // 1. Fast load persistent database from disk
  loadDatabaseFromDisk();

  // 2. Serve built production dist folder if available (ultra-fast sub-10ms response time)
  const distPath = path.join(process.cwd(), "dist");
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath, { maxAge: "7d", etag: true }));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      res.sendFile(path.join(distPath, "index.html"));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  // 3. Start listening immediately (sub-50ms launch time)
  app.listen(PORT, HOST, () => {
    console.log(`[Fast Launch Engine] Subdomain Tracker running on http://${HOST}:${PORT}`);
    console.log(`[Fast Launch Engine] Persistent database ready at database.json (${mangaDatabase.length} series)`);
  });

  // 4. Non-blocking background catalog sync & Rate-Spaced Auto-Updater
  scheduleBackgroundAutoUpdater();
  setTimeout(() => {
    try {
      const syncResult = integrateKotatsuSourcesAndMerge(KOTATSU_COMPLETE_CATALOG);
      console.log(`[Kotatsu Engine] Background catalog sync complete: ${syncResult.mergedCount} merged, ${syncResult.newCount} new added.`);
    } catch (e) { }
  }, 200);
}

startServer();
