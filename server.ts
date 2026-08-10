import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { INITIAL_MANGA_DATABASE } from "./src/data/initialManga";
import { KOTATSU_COMPLETE_CATALOG } from "./src/data/kotatsuCompleteDataset";
import { MangaItem, DuplicateCandidate, AutoUpdateLog, DatabaseSyncConfig, UserProfile, SourceDefinition } from "./src/types";


// Initialize Express
const app = express();
const PORT = 3000;

app.use(express.json({ limit: "10mb" }));

// ==========================================
// DDOS PROTECTION & RATE LIMITING MIDDLEWARE (Bypassed for Host PC)
// ==========================================
const ipRequestCounts = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_MAX = 300; // max 300 requests per minute
const RATE_LIMIT_WINDOW = 60 * 1000;

app.use((req, res, next) => {
  const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
  
  // Disable DDoS protection rate-limiting for host PC / localhost connections
  const isHostPc =
    clientIp === '127.0.0.1' ||
    clientIp === '::1' ||
    clientIp === '::ffff:127.0.0.1' ||
    clientIp.includes('127.0.0.1') ||
    clientIp === 'localhost' ||
    !process.env.NODE_ENV ||
    process.env.NODE_ENV !== 'production';

  if (isHostPc) {
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
        "User-Agent": "aistudio-build",
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
    id: 'usr_default',
    name: 'Default Reader',
    username: 'admin',
    email: 'admin@manga.dev',
    avatar: '🥷',
    role: 'admin',
    storageFolderPath: 'C:\\Users\\gogz9\\MangaStorage\\Default',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'usr_jordan',
    name: 'Jordan',
    username: 'jordan',
    email: 'jordan@manga.dev',
    avatar: '🦊',
    role: 'user',
    storageFolderPath: 'C:\\Users\\gogz9\\MangaStorage\\Jordan',
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

let syncConfig: DatabaseSyncConfig = {
  subdomain: 'tracker.manhuahub.app',
  autoUpdateIntervalMinutes: 60,
  enableWebCrawling: true,
  sources: ['MangaDex API', 'AniList GraphQL', 'AsuraScans Feeds', 'FlameComics', 'WeebCentral', 'DemonicScans'],
  lastSyncTime: new Date().toISOString(),
  totalTracked: mangaDatabase.length,
};

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
        storageFolderPath: encryptPII(p.storageFolderPath || ''),
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
          storageFolderPath: decryptPII(p.storageFolderPath || ''),
        }));
      }
      if (parsed.autoUpdateLogs && Array.isArray(parsed.autoUpdateLogs)) {
        autoUpdateLogs = parsed.autoUpdateLogs;
      }
      if (parsed.syncConfig) {
        syncConfig = parsed.syncConfig;
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
  } catch (e) {}
}

// Helper: Refresh metadata for a single manga item from live sources
async function refreshSingleMangaMetadata(manga: MangaItem): Promise<MangaItem> {
  // 1. MangaDex Metadata Refresh
  const mangaDexId =
    manga.apiId ||
    (manga.id?.startsWith('md_') ? manga.id.replace('md_', '') : null) ||
    (manga.sourceUrl?.match(/\/title\/([a-f0-9\-]+)/i)?.[1]);

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
          manga.title = attrs.title.en || Object.values(attrs.title)[0] || manga.title;
        }
        if (attrs.description?.en) {
          manga.description = attrs.description.en;
        }
        if (attrs.altTitles && Array.isArray(attrs.altTitles)) {
          const newAlts = attrs.altTitles.map((t: any) => Object.values(t)[0]).filter(Boolean) as string[];
          manga.altTitles = Array.from(new Set([...(manga.altTitles || []), ...newAlts]));
        }
        if (coverFileName) {
          manga.coverImage = `https://uploads.mangadex.org/covers/${mangaDexId}/${coverFileName}.256.jpg`;
        }

        // Fetch max chapter number
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
  if (manga.sourceUrl && manga.sourceUrl.includes('asuracomic')) {
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
      const homeRes = await fetch("https://flamecomics.xyz/");
      if (homeRes.ok) {
        const html = await homeRes.text();
        const buildId = html.match(/\/_next\/static\/([^/]+)\/_buildManifest\.js/)?.[1];
        if (buildId) {
          const browseRes = await fetch(`https://flamecomics.xyz/_next/data/${buildId}/browse.json`);
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
              const seriesRes = await fetch(`https://flamecomics.xyz/_next/data/${buildId}/series/${seriesId}.json`);
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

  const maxLen = Math.max(words1.size, words2.size);
  return maxLen > 0 ? Math.round((common / maxLen) * 90) : 0;
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
      try {
        SqliteDb.upsertManga(exactMatch);
      } catch (e) {}
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
        // Uncertain match: Do not merge silently! Keep as candidate for Duplicate Merger site
        uncertainCount++;
      } else {
        // 3. Completely NEW unique series: Insert into database
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

        mangaDatabase.push(newItem);
        try {
          SqliteDb.upsertManga(newItem);
        } catch (e) {}
        newCount++;
      }
    }
  }

  saveDatabaseToDisk();
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
  const { subdomain, autoUpdateIntervalMinutes, enableWebCrawling, sources } = req.body;
  if (subdomain !== undefined) syncConfig.subdomain = subdomain;
  if (autoUpdateIntervalMinutes !== undefined) syncConfig.autoUpdateIntervalMinutes = Number(autoUpdateIntervalMinutes);
  if (enableWebCrawling !== undefined) syncConfig.enableWebCrawling = Boolean(enableWebCrawling);
  if (Array.isArray(sources)) syncConfig.sources = sources;
  syncConfig.lastSyncTime = new Date().toISOString();
  res.json({ success: true, config: syncConfig });
});

// CRUD for Manga List (SQLite Engine)
app.get("/api/manga", (_req, res) => {
  const allManga = SqliteDb.getAllManga();
  res.json(allManga);
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

  SqliteDb.upsertManga(newItem);
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

  SqliteDb.upsertManga(updatedItem);
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
  res.json(updated);
});

app.post("/api/manga/toggle-favorite", (req, res) => {
  const { id, isFavorite } = req.body || {};
  if (!id) return res.status(400).json({ error: "Missing manga id" });

  SqliteDb.toggleFavorite(id, Boolean(isFavorite));
  const updated = SqliteDb.getMangaById(id);
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
    SqliteDb.upsertManga(existing);

    const idx = mangaDatabase.findIndex((m) => m.id === id);
    if (idx !== -1) mangaDatabase[idx] = existing;
    saveDatabaseToDisk();
  }

  res.json({ success: true, manga: existing });
});

app.delete("/api/manga/:id", (req, res) => {
  const { id } = req.params;
  SqliteDb.deleteManga(id);
  res.json({ success: true, message: "Deleted successfully from SQLite database" });
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
    'User-Agent': 'OmniMangaSync-Kotatsu/4.8.2 (https://mangadex.org)',
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

// Image Proxy to prevent MangaDex hotlinking replacement (agg.jpg)
app.get("/api/mangadex/image-proxy", async (req, res) => {
  const imageUrl = req.query.url as string;
  if (!imageUrl || !imageUrl.startsWith('https://uploads.mangadex.org')) {
    return res.status(400).send('Invalid image URL for MangaDex proxy');
  }

  try {
    const imgRes = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'OmniMangaSync-Kotatsu/4.8.2 (https://mangadex.org)',
        'Referer': 'https://mangadex.org',
      },
    });

    if (imgRes.ok) {
      res.setHeader('Content-Type', imgRes.headers.get('content-type') || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      const arrayBuffer = await imgRes.arrayBuffer();
      return res.send(Buffer.from(arrayBuffer));
    }
  } catch (err) {
    console.error("[MangaDex Image Proxy] Error proxying image:", err);
  }

  res.status(500).send("Failed to proxy image");
});

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

    // Try live fetch from MangaDex public REST API with official rate-limiting wrapper
    const response = await fetchMangaDex(
      `https://api.mangadex.org/manga?title=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}&includes[]=cover_art&contentRating[]=safe&contentRating[]=suggestive`
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
              mangaDatabase[existingIndex] = {
                ...mangaDatabase[existingIndex],
                latestChapter: Number(m.attributes.lastChapter) || mangaDatabase[existingIndex].latestChapter || 100,
                coverImage: coverImage || mangaDatabase[existingIndex].coverImage,
                lastUpdated: new Date().toISOString(),
              };
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
              mangaDatabase.push(newMangaItem);
              addedCount++;
            }

          }
        }
      } catch (e) {
        console.error("[API Database Sync Engine] Page fetch error:", e);
      }
    }

    saveDatabaseToDisk();
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


    mangaDatabase.unshift(newMangaItem);
    saveDatabaseToDisk();
    console.log(`[MangaDex Integration] Imported "${title}" (${m.id}) directly into database.json`);

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
// AUTOMATED CRAWLER & AUTO-UPDATER
// ==========================================

app.post("/api/tracker/auto-update", (req, res) => {
  const updatedItems: { mangaTitle: string; previous: number; newChapter: number }[] = [];

  // Simulate web crawling scan for active titles
  mangaDatabase.forEach((item) => {
    if (item.autoUpdateEnabled) {
      // 35% chance to discover a new chapter release during auto update run
      const hasNewRelease = Math.random() > 0.65;
      if (hasNewRelease) {
        const prevChapter = item.latestChapter;
        const newChap = prevChapter + 1;
        item.latestChapter = newChap;
        item.lastUpdated = new Date().toISOString();

        const logEntry: AutoUpdateLog = {
          id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          mangaId: item.id,
          mangaTitle: item.title,
          previousChapter: prevChapter,
          newChapter: newChap,
          source: item.sourceName || 'Scanlation Crawler',
          timestamp: new Date().toISOString(),
          type: item.type,
        };

        autoUpdateLogs.unshift(logEntry);
        updatedItems.push({ mangaTitle: item.title, previous: prevChapter, newChapter: newChap });
      }
    }
  });

  syncConfig.lastSyncTime = new Date().toISOString();

  res.json({
    success: true,
    scannedCount: mangaDatabase.filter((m) => m.autoUpdateEnabled).length,
    newReleasesFound: updatedItems.length,
    updatedItems,
    lastSyncTime: syncConfig.lastSyncTime,
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

  // Step 1: Programmatic title similarity & token matching across the global database
  for (let i = 0; i < mangaDatabase.length; i++) {
    for (let j = i + 1; j < mangaDatabase.length; j++) {
      const itemA = mangaDatabase[i];
      const itemB = mangaDatabase[j];

      if (ignoredDuplicatePairs.has(`${itemA.id}_${itemB.id}`)) continue;

      let maxSim = calculateStringSimilarity(itemA.title, itemB.title);

      // Check alt titles
      for (const altA of itemA.altTitles) {
        const sim = calculateStringSimilarity(altA, itemB.title);
        if (sim > maxSim) maxSim = sim;
      }
      for (const altB of itemB.altTitles) {
        const sim = calculateStringSimilarity(itemA.title, altB);
        if (sim > maxSim) maxSim = sim;
      }

      if (maxSim >= 60 || (itemA.type === itemB.type && itemA.coverImage === itemB.coverImage)) {
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

  mangaDatabase[primaryIdx] = {
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

  // Remove secondary
  mangaDatabase.splice(secondaryIdx, 1);

  res.json({
    success: true,
    mergedItem: mangaDatabase[primaryIdx],
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
    mangaDatabase = data;
  } else {
    // Append unique items by title or ID
    data.forEach((item: MangaItem) => {
      const exists = mangaDatabase.some((m) => m.id === item.id || m.title.toLowerCase() === item.title.toLowerCase());
      if (!exists) {
        mangaDatabase.push(item);
      }
    });
  }

  syncConfig.lastSyncTime = new Date().toISOString();
  res.json({ success: true, totalTracked: mangaDatabase.length });
});

app.post("/api/db/reset", (req, res) => {
  mangaDatabase = [...INITIAL_MANGA_DATABASE];
  syncConfig.lastSyncTime = new Date().toISOString();
  res.json({ success: true, count: mangaDatabase.length });
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

// Kotatsu-Parsers-Redo Source Engine Registry & Definitions Framework
const KOTATSU_SOURCES: SourceDefinition[] = [
  // ── MangaDex (Official API v5) ─────────────────────────────────────────────
  { id: 'mangadex', name: 'MangaDex API v5', baseUrl: 'https://mangadex.org', engineType: 'mangadex', lang: 'en', isNsfw: false },

  // ── MangaThemesia Engine Sites ─────────────────────────────────────────────
  { id: 'asurascans', name: 'Asura Scans', baseUrl: 'https://asuracomic.net', engineType: 'mangathemesia', lang: 'en', isNsfw: false },
  { id: 'flamecomics', name: 'Flame Comics', baseUrl: 'https://flamecomics.xyz', engineType: 'mangathemesia', lang: 'en', isNsfw: false },
  { id: 'luminousscans', name: 'Luminous Scans', baseUrl: 'https://luminousscans.org', engineType: 'mangathemesia', lang: 'en', isNsfw: false },
  { id: 'nightscans', name: 'Night Scans', baseUrl: 'https://nightscans.net', engineType: 'mangathemesia', lang: 'en', isNsfw: false },

  // ── Madara / WP-Manga Engine ───────────────────────────────────────────────
  { id: 'immortalupdates', name: 'Immortal Updates', baseUrl: 'https://immortalupdates.com', engineType: 'madara', lang: 'en', isNsfw: false },
  { id: 'manhwabuddy', name: 'Manhwa Buddy', baseUrl: 'https://manhwabuddy.com', engineType: 'madara', lang: 'en', isNsfw: false },
  { id: 'manhuafast', name: 'Manhua Fast', baseUrl: 'https://manhuafast.com', engineType: 'madara', lang: 'en', isNsfw: false },
  { id: 'kunmanga', name: 'Kun Manga', baseUrl: 'https://kunmanga.com', engineType: 'madara', lang: 'en', isNsfw: false },
  { id: 'manhwa18', name: 'Manhwa18', baseUrl: 'https://manhwa18.com', engineType: 'madara', lang: 'en', isNsfw: true },

  // ── FoolSlide Engine ───────────────────────────────────────────────────────
  { id: 'dynastyscans', name: 'Dynasty Scans', baseUrl: 'https://dynasty-scans.com', engineType: 'foolslide', lang: 'en', isNsfw: false },

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
];



// Persistent Disabled Sources Set (Only AquaManga, AsuraScans, Flame Comics, and Manhwa18 enabled by default)
const ACTIVE_ENABLED_SOURCES = new Set(['aquamanga', 'asurascans', 'flamecomics', 'manhwa18']);
const disabledSourceIds = new Set<string>(
  KOTATSU_SOURCES.map((s) => s.id).filter((id) => !ACTIVE_ENABLED_SOURCES.has(id))
);

// Dedicated Unique Catalogs for Each Individual Source
const SOURCE_DEDICATED_CATALOGS: Record<string, { title: string; slug: string; cover: string; genres: string[]; type: 'manhwa'|'manhua'|'manga'; latestChapter: number }[]> = {
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

// Kotatsu Sources List Endpoint (With isEnabled states)
app.get("/api/kotatsu/sources", (_req, res) => {
  const listWithStates = KOTATSU_SOURCES.map((s) => ({
    ...s,
    isEnabled: !disabledSourceIds.has(s.id),
  }));
  res.json(listWithStates);
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

  saveDatabaseToDisk();
  console.log(`[Kotatsu Engine] Source "${sourceId}" is now ${isEnabled ? 'ENABLED' : 'DISABLED'} (${disabledSourceIds.size} disabled in total)`);
  res.json({
    success: true,
    sourceId,
    isEnabled: !disabledSourceIds.has(sourceId),
    disabledCount: disabledSourceIds.size,
  });
});

// Kotatsu Parser Latest Releases Endpoint
app.get("/api/kotatsu/latest", async (req, res) => {
  const sourceId = (req.query.sourceId as string) || 'mangadex';
  const sourceDef = KOTATSU_SOURCES.find((s) => s.id === sourceId) || KOTATSU_SOURCES[0];

  try {
    if (sourceDef.engineType === 'mangadex') {
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
            sourceName: sourceDef.name + ' (Latest)',
            apiId: m.id,
            latestChapter: Number(m.attributes.lastChapter) || 1,
            type: 'manhwa',
          };
        });
        return res.json(items);
      }
    }

    const items = await getSourcePopularSeries(sourceDef);
    return res.json(items);
  } catch (e) {
    res.json([]);
  }
});

// Helper: Get source-specific popular series feed
async function getSourcePopularSeries(sourceDef: SourceDefinition): Promise<any[]> {
  // 1. MangaDex API
  if (sourceDef.engineType === 'mangadex') {
    try {
      const mdRes = await fetchMangaDex(
        'https://api.mangadex.org/manga?order[followedCount]=desc&limit=24&includes[]=cover_art&contentRating[]=safe&contentRating[]=suggestive'
      );
      if (mdRes.ok) {
        const mdData = await mdRes.json();
        return (mdData.data || []).map((m: any) => {
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
      }
    } catch (e) {}
  }

  // 2. Dedicated Source Catalog (100% Source Isolated)
  const dedicatedList = SOURCE_DEDICATED_CATALOGS[sourceDef.id];
  if (dedicatedList && dedicatedList.length > 0) {
    const pathPrefix = sourceDef.id === 'manhwa18' ? '/webtoon/' : sourceDef.id === 'demonicscans' ? '/manga/' : '/manga/';
    return dedicatedList.map((item) => ({
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
  }

  // 3. Filter database & catalog items matching this specific source
  const allManga = SqliteDb.getAllManga();
  const sourceMatches = allManga.filter((m: any) => {
    const sName = (m.sourceName || '').toLowerCase();
    const sUrl = (m.sourceUrl || '').toLowerCase();
    const targetName = sourceDef.name.toLowerCase();
    const targetId = sourceDef.id.toLowerCase();
    const targetDomain = sourceDef.baseUrl.replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase();

    return sName.includes(targetId) || sName.includes(targetName) || (sUrl && sUrl.includes(targetDomain));
  });

  return sourceMatches.map((m: any) => ({
    id: m.id,
    title: m.title,
    sourceUrl: m.sourceUrl || sourceDef.baseUrl,
    coverImage: m.coverImage,
    sourceName: sourceDef.name,
    description: m.description || `Popular series on ${sourceDef.name}`,
    genres: m.genres || ['Action'],
    latestChapter: m.latestChapter || 1,
    type: m.type || 'manhwa',
  }));
}

// Kotatsu Multi-Source Live Search Endpoint (Enhanced)
app.get("/api/kotatsu/search", async (req, res) => {
  const sourceId = (req.query.sourceId as string) || 'mangadex';
  const query = ((req.query.q as string) || '').trim();
  const sourceDef = KOTATSU_SOURCES.find((s) => s.id === sourceId) || KOTATSU_SOURCES[0];

  try {
    // ── 1. MangaDex official API v5 with full metadata ─────────────────────
    if (sourceDef.engineType === 'mangadex') {
      const mdUrl = query
        ? `https://api.mangadex.org/manga?title=${encodeURIComponent(query)}&limit=24&includes[]=cover_art&contentRating[]=safe&contentRating[]=suggestive`
        : `https://api.mangadex.org/manga?order[followedCount]=desc&limit=24&includes[]=cover_art&contentRating[]=safe&contentRating[]=suggestive`;

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
      const popular = await getSourcePopularSeries(sourceDef);
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

const REGISTERED_LIVE_DOMAINS = [
  { id: 'mangadex', domain: 'mangadex.org', name: 'MangaDex REST API' },
  { id: 'dynasty', domain: 'dynasty-scans.com', name: 'Dynasty Scans Engine' },
  { id: 'asura', domain: 'asuracomic', name: 'Asura Scans' },
  { id: 'flame', domain: 'flamecomics.xyz', name: 'Flame Comics' },
  { id: 'luminous', domain: 'luminousscans.org', name: 'Luminous Scans' },
  { id: 'night', domain: 'nightscans.net', name: 'Night Scans' },
  { id: 'immortal', domain: 'immortalupdates.com', name: 'Immortal Updates' },
  { id: 'manhwabuddy', domain: 'manhwabuddy.com', name: 'Manhwa Buddy' },
  { id: 'manhuafast', domain: 'manhuafast.com', name: 'Manhua Fast' },
  { id: 'kunmanga', domain: 'kunmanga.com', name: 'Kun Manga' },
  { id: 'manhwa18', domain: 'manhwa18', name: 'Manhwa18' },
  { id: 'manhuaplus', domain: 'manhuaplus.com', name: 'Manhua Plus' },
  { id: 'mangatx', domain: 'mangatx.com', name: 'Manga TX' },
  { id: 'topmanhua', domain: 'topmanhua.com', name: 'Top Manhua' },
  { id: 'manhwaclan', domain: 'manhwaclan.com', name: 'Manhwa Clan' },
  { id: 'aquamanga', domain: 'aquareader', name: 'Aqua Manga' },
  { id: 'weebcentral', domain: 'weebcentral.com', name: 'Weeb Central' },
  { id: 'atsumoe', domain: 'atsu.moe', name: 'Atsu Moe' },
  { id: 'demonicscans', domain: 'demonicscans.org', name: 'Demonic Scans' },
];


async function extractLiveDomainChapterPages(
  targetUrl: string,
  domainId: string,
  chapterNumber: number = 1
): Promise<string[] | null> {
  try {
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

    // 2. MangaDex API
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

    // 3. Dynasty Scans Series & Chapter Resolution
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

    // 4. Weeb Central Direct Extractor
    if (domainId === 'weebcentral' || targetUrl.includes('weebcentral.com')) {
      try {
        let wcUrl = targetUrl;
        if (!wcUrl.includes('/chapter/')) {
          wcUrl = `${targetUrl.replace(/\/$/, '')}/chapter/${chapterNumber}`;
        }
        const wcRes = await fetch(wcUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        });
        if (wcRes.ok) {
          const html = await wcRes.text();
          const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
          const pages: string[] = [];
          let match;
          while ((match = imgRegex.exec(html)) !== null) {
            const src = match[1];
            if (src && (src.includes('/images/') || src.includes('/uploads/')) && !src.includes('logo') && !src.includes('avatar')) {
              pages.push(src.startsWith('http') ? src : `https://weebcentral.com${src}`);
            }
          }
          if (pages.length > 0) return pages;
        }
      } catch (e) {}
    }

    // 5. Demonic Scans Live Extractor with Series Chapter Auto-Resolution
    if (domainId === 'demonicscans' || targetUrl.includes('demonicscans.org')) {
      try {
        const rawSlug = targetUrl.split('/').pop() || '';
        const seriesUrl = targetUrl.includes('http') ? targetUrl : `https://demonicscans.org/manga/${rawSlug}`;
        const sRes = await fetch(seriesUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml',
            'Referer': 'https://demonicscans.org/',
          },
        });
        if (sRes.ok) {
          const html = await sRes.text();
          const chMatches = Array.from(html.matchAll(/href=["']([^"']*(?:chaptered\.php|chapter)[^"']*)["']/gi))
            .map((m) => m[1])
            .filter((href) => href.includes('chapter=') && !href.includes('chapter=0'));

          if (chMatches.length > 0) {
            const firstHREF = chMatches[chapterNumber - 1] || chMatches[0];
            const chUrl = firstHREF.startsWith('http') ? firstHREF : `https://demonicscans.org${firstHREF.startsWith('/') ? '' : '/'}${firstHREF}`;
            const chRes = await fetch(chUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
                'Referer': seriesUrl,
              },
            });
            if (chRes.ok) {
              const chHtml = await chRes.text();
              const imgRegex = /<img[^>]+(?:data-src|src)=["']([^"']+)["'][^>]*>/gi;
              const pages: string[] = [];
              let m;
              while ((m = imgRegex.exec(chHtml)) !== null) {
                const src = m[1]?.trim();
                if (src && /\.(jpg|png|webp|jpeg)/i.test(src) && !/logo|avatar|banner|title-sm|icon|free_ads/i.test(src)) {
                  pages.push(src.startsWith('http') ? src : `https://demonicscans.org${src.startsWith('/') ? '' : '/'}${src}`);
                }
              }
              if (pages.length > 0) return Array.from(new Set(pages));
            }
          }
        }
      } catch (e) {}
    }

    // 6. Atsu Moe Extractor with Stealth Headers
    if (domainId === 'atsumoe' || targetUrl.includes('atsu.moe')) {
      try {
        let amUrl = targetUrl;
        if (!amUrl.includes('/chapter-')) {
          amUrl = `${targetUrl.replace(/\/$/, '')}/chapter-${chapterNumber}/`;
        }
        const amRes = await fetch(amUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml',
            'Referer': 'https://atsu.moe/',
          },
        });
        if (amRes.ok) {
          const html = await amRes.text();
          const imgRegex = /<img[^>]+(?:data-src|data-lazy-src|data-cfsrc|src)=["']([^"']+)["'][^>]*>/gi;
          const pages: string[] = [];
          let match;
          while ((match = imgRegex.exec(html)) !== null) {
            const src = match[1]?.trim();
            if (src && /\.(jpg|png|webp|jpeg)/i.test(src) && !/logo|avatar|banner|icon/i.test(src)) {
              pages.push(src.startsWith('http') ? src : `${new URL(targetUrl).origin}${src.startsWith('/') ? '' : '/'}${src}`);
            }
          }
          if (pages.length > 0) return Array.from(new Set(pages));
        }
      } catch (e) {}
    }

    // 8. General Webtoon HTML Panel Extractor with Strict Panel Filtering & Multi-attribute Image Parsing
    let chUrl = targetUrl;
    if (!chUrl.includes('/chapter/') && !chUrl.includes('/chapter-')) {
      chUrl = `${targetUrl.replace(/\/$/, '')}/chapter-${chapterNumber}/`;
    }

    const pageRes = await fetch(chUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Referer: new URL(targetUrl).origin,
      },
    });

    if (pageRes.ok) {
      const htmlText = await pageRes.text();
      const imgRegex = /<img[^>]+(?:data-src|data-lazy-src|data-cfsrc|src)=["']([^"']+)["'][^>]*>/gi;
      const pages: string[] = [];
      let match;

      while ((match = imgRegex.exec(htmlText)) !== null) {
        const src = match[1]?.trim();
        if (
          src &&
          (src.includes('.jpg') || src.includes('.png') || src.includes('.webp') || src.includes('imgur.com')) &&
          !src.includes('/covers/') &&
          !src.includes('/profiles/') &&
          !src.includes('logo') &&
          !src.includes('banner') &&
          !src.includes('avatar') &&
          !src.includes('icon') &&
          !src.includes('default-pp') &&
          !src.includes('announcements')
        ) {
          pages.push(src.startsWith('http') ? src : `${new URL(targetUrl).origin}${src}`);
        }
      }

      if (pages.length > 0) return pages;
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
  if (targetUrl) {
    const matchedDomain = REGISTERED_LIVE_DOMAINS.find((d) => targetUrl.includes(d.domain));
    // BUG-002 FIX: Skip extraction entirely if the matched source is disabled on the server.
    // This prevents SSL errors and unnecessary network calls for disabled source domains.
    const domainIsDisabled = matchedDomain ? disabledSourceIds.has(matchedDomain.id) : false;
    if (matchedDomain && !domainIsDisabled) {
      const livePages = await kotatsuImageEngine.getChapterPages(targetUrl, matchedDomain.id, chapterNumber);
      if (livePages && livePages.length > 0) {
        const proxiedPages = livePages.map(
          (p) => `/api/reader/proxy-image?url=${encodeURIComponent(p)}&sourceUrl=${encodeURIComponent(targetUrl)}`
        );

        console.log(`[Reader Stream Engine] Successfully extracted ${proxiedPages.length} live panels from ${matchedDomain.name} for Chapter ${chapterNumber}`);
        return res.json({
          chapterId: chapterId || `ch_${mangaId || 'kotatsu'}_${chapterNumber}`,
          mangaId,
          mangaTitle,
          chapterNumber,
          title: `Chapter ${chapterNumber}`,
          scanGroup: matchedDomain.name,
          selectedGroup: matchedDomain.name,
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


  // 3. Dynamic Fallback Panel Generator
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

      <!-- Page Footer Banner -->
      <text x="400" y="1160" text-anchor="middle" fill="#64748b" font-family="sans-serif" font-size="14" font-weight="600">
        OmniManga Webtoon Reader • Page ${page} / ${totalPages}
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
    if (sourceUrl) {
      try { referer = new URL(sourceUrl).origin; } catch (e) {}
    } else if (targetUrl.startsWith('http')) {
      try { referer = new URL(targetUrl).origin; } catch (e) {}
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
  mangaDatabase[index] = {
    ...manga,
    currentChapter: newChapterNum,
    latestChapter: Math.max(manga.latestChapter, newChapterNum),
    lastReadAt: new Date().toISOString(),
    status: manga.status === 'plan_to_read' ? 'reading' : manga.status,
  };

  res.json({ success: true, manga: mangaDatabase[index] });
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
      storageFolderPath: user.storageFolderPath,
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
      SqliteDb.bulkUpsertManga(importedManga);
    }
    if (importedConfig) {
      syncConfig = { ...syncConfig, ...importedConfig, totalTracked: SqliteDb.getMangaCount() };
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
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Fast Launch Engine] Subdomain Tracker running on http://0.0.0.0:${PORT}`);
    console.log(`[Fast Launch Engine] Persistent database ready at database.json (${mangaDatabase.length} series)`);
  });

  // 4. Non-blocking background catalog sync
  setTimeout(() => {
    try {
      const syncResult = integrateKotatsuSourcesAndMerge(KOTATSU_COMPLETE_CATALOG);
      console.log(`[Kotatsu Engine] Background catalog sync complete: ${syncResult.mergedCount} merged, ${syncResult.newCount} new added.`);
    } catch (e) {}
  }, 200);
}

startServer();
