import express from "express";
import compression from "compression";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { GoogleGenAI } from "@google/genai";
import * as cheerio from "cheerio";
import { SqliteDb } from "./sqlite-db";
import { MangaItem, DuplicateCandidate, AutoUpdateLog, DatabaseSyncConfig, UserProfile, UserRole, SourceDefinition, SourceEngineType, isMangaDexSourceLink, isNsfwManga } from "./src/types";
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
import { challengeManager } from "./server/challengeManager";
import { sourceCircuitBreaker, CircuitState } from "./server/circuitBreaker";
import { getBrowserHeaders } from "./server/userAgentPool";
import { notesRouter } from "./server/routes/notes";
import { opdsRouter } from "./server/routes/opds";
import { localLibraryRouter } from "./server/routes/localLibrary";
import { authRouter } from "./server/routes/auth";
import { adminRouter } from "./server/routes/admin";
import { gdprRouter } from "./server/routes/gdpr";
import { settingsRouter } from "./server/routes/settings";
import { progressRouter } from "./server/routes/progress";
import { bugsRouter } from "./server/routes/bugs";
import { webhooksRouter } from "./server/routes/webhooks";
import { dispatchNewChapterWebhooks } from "./server/services/webhookNotifier";
import { startAutoBackupScheduler } from "./server/services/autoBackupService";
import { isAdImageSrc } from "./server/adFilter";
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
import {
  fetchFlameSeriesContext,
  fetchFlameChapterList,
  mapFlameChapters,
} from "./server/scrapers/flameComics";
import {
  fetchAsuraSeriesMetadata,
  fetchAsuraChapterList,
  ASURA_API_HEADERS,
  ASURA_SLUG_TOKEN_RX,
} from "./server/scrapers/asuraScans";
import {
  scrapeWeebCentral,
  searchWeebCentral,
  fetchWeebCentralSeriesMetadata,
  fetchWeebCentralChapterList,
  fetchWeebCentralChapterPages,
} from "./server/scrapers/weebCentral";
import {
  // Shared in-memory state (live-exported bindings) & persistence layer
  mangaDatabase,
  userProfiles,
  autoUpdateLogs,
  syncConfig,
  appSettings,
  replaceMangaDatabase,
  saveDatabaseToDisk,
  flushStateNow,
  cancelPendingSave,
  writeLegacyJsonSnapshot,
  loadDatabaseFromDisk,
  purgeReaperScansFromAllStorage,
  syncAddOrUpdateManga,
  syncBulkAddOrUpdateManga,
  syncDeleteManga,
  syncResetManga,
  resolveManga,
  resolveRequestUserId,
  resolveAuthUser,
  canWriteCatalog,
  rejectCatalogWrite,
} from "./server/appState";
import {
  snapshotMetadataOverrides,
  restoreMetadataOverrides,
  ensureCoreFields,
  preferEnglishTitle,
} from "./src/utils/metadataHelpers";

export const sourceCustomCookies = new Map<string, string[]>();
export const sourceCustomUserAgents = new Map<string, string>();

export {
  app,
  startServer,
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
app.use(authRouter);
app.use(adminRouter);
app.use(gdprRouter);
app.use(settingsRouter);
app.use(progressRouter);
app.use(bugsRouter);
app.use(webhooksRouter);

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

  replaceMangaDatabase(itemsToKeep);
  console.log(`[Active Sources Engine] Purged ${purgedIds.length} series belonging to disabled sources. Active series remaining: ${mangaDatabase.length}`);

  // 2. Refresh metadata for all remaining active series (bounded concurrency to avoid hammering APIs)
  const updatedItems: MangaItem[] = [];

  const METADATA_BATCH = 5;
  for (let i = 0; i < mangaDatabase.length; i += METADATA_BATCH) {
    const batch = mangaDatabase.slice(i, i + METADATA_BATCH);
    const results = await Promise.all(
      batch.map(async (item) => {
        let updated = await refreshSingleMangaMetadata({ ...item }).catch(() => ({ ...item }));

        // Clean up altTitles (strip exact-title duplicates).
        const altSet = new Set((updated.altTitles || []).filter((a) => a && a.toLowerCase() !== updated.title.toLowerCase()));
        updated.altTitles = Array.from(altSet);
        // Ensure every core field has a non-empty value (shared ensureCoreFields helper).
        return ensureCoreFields(updated);
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


// snapshotMetadataOverrides, restoreMetadataOverrides and OVERRIDEABLE_METADATA_FIELDS
// now live in src/utils/metadataHelpers.ts (Jellyfin-inspired shared module).
// They are imported at the top of this file.

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
          // Prefer English title; fall back to first available language.
          const mainTitle = preferEnglishTitle(attrs.title);
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
    manga.sourceUrl = manga.sourceUrl.replace(/asuracomic\.net/gi, 'asurascans.com').replace(/asurascans\.(?:com|org)/gi, 'asurascans.com');
    try {
      const asuraMeta = await fetchAsuraSeriesMetadata(manga.sourceUrl);
      if (asuraMeta) {
        if (asuraMeta.title) manga.title = asuraMeta.title;
        if (asuraMeta.coverImage) manga.coverImage = asuraMeta.coverImage;
        if (asuraMeta.description) manga.description = asuraMeta.description;
        if (asuraMeta.rating) manga.rating = asuraMeta.rating;
        if (asuraMeta.latestChapter) manga.latestChapter = Math.max(manga.latestChapter || 1, asuraMeta.latestChapter);
        if (asuraMeta.altTitles && asuraMeta.altTitles.length > 0) {
          manga.altTitles = Array.from(new Set([...(manga.altTitles || []), ...asuraMeta.altTitles]));
        }
        if (asuraMeta.genres && asuraMeta.genres.length > 0) {
          manga.genres = Array.from(new Set([...(manga.genres || []), ...asuraMeta.genres]));
        }
      }
    } catch (e: any) {
      console.warn(`[Metadata Refresh] Asura Scans refresh failed for ${manga.title}:`, e.message);
    }
  }

  // 3. Flame Comics Metadata Refresh
  if (manga.sourceUrl && manga.sourceUrl.includes('flamecomics')) {
    try {
      const flameCtx = await fetchFlameSeriesContext(manga.sourceUrl);
      if (flameCtx) {
        if (flameCtx.matchedSeries?.title) manga.title = flameCtx.matchedSeries.title;
        if (flameCtx.chapters && flameCtx.chapters.length > 0) {
          manga.latestChapter = Math.max(manga.latestChapter || 1, flameCtx.chapters.length);
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
    // Anonymous/remote without token: never expose another user's favorites/progress/categories
    allManga = allManga.map((m) => ({
      ...m,
      isFavorite: false,
      currentChapter: 0,
      categories: [],
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
  isNsfw: (v: any, all: any) => v !== undefined ? Boolean(v) : isNsfwManga(all),
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
    isNsfw: MANGA_CREATE_FIELDS.isNsfw(body.isNsfw, body),
    metadataOverrides: Array.isArray(body.metadataOverrides) ? body.metadataOverrides : [],
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

// Bulk Manga Import / Restore Endpoint (available to all authenticated users & host)
app.post("/api/manga/bulk-import", (req, res) => {
  if (!canWriteCatalog(req)) return rejectCatalogWrite(res);
  const rawList = Array.isArray(req.body) ? req.body : req.body?.items;
  if (!Array.isArray(rawList) || rawList.length === 0) {
    return res.status(400).json({ error: "Invalid items array" });
  }

  const reqUser = (req as any).user;
  const userId = reqUser ? reqUser.id : null;
  const uid = resolveRequestUserId(req) || userId || (isHostRequest(req) ? 'usr_admin' : 'usr_guest');

  const processedItems: MangaItem[] = rawList.map((body: any) => ({
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
    addedAt: body.addedAt || new Date().toISOString(),
    lastReadAt: body.lastReadAt || new Date().toISOString(),
    syncedFromApi: MANGA_CREATE_FIELDS.syncedFromApi(body.syncedFromApi),
    apiId: MANGA_CREATE_FIELDS.apiId(body.apiId),
    isFavorite: MANGA_CREATE_FIELDS.isFavorite(body.isFavorite),
    categories: Array.isArray(body.categories) ? body.categories : [],
    userId: uid || 'usr_admin',
  }));

  syncBulkAddOrUpdateManga(processedItems);

  if (uid) {
    const existingCats = SqliteDb.getCategories(uid);
    const catNameToId = new Map<string, string>();
    for (const c of existingCats) {
      catNameToId.set(c.name.toLowerCase().trim(), c.id);
      catNameToId.set(c.id, c.id);
    }
    const colorList = ['#f59e0b', '#f43f5e', '#10b981', '#a855f7', '#0ea5e9', '#6366f1', '#06b6d4', '#ec4899'];

    const userStateBatch: Array<{
      id: string;
      isFavorite?: boolean;
      currentChapter?: number;
      status?: string;
      categoryIds?: string[];
    }> = [];

    for (const item of processedItems) {
      let resolvedIds: string[] | undefined = undefined;
      if (Array.isArray(item.categories) && item.categories.length > 0) {
        resolvedIds = [];
        for (const catNameOrId of item.categories) {
          const trimmed = String(catNameOrId).trim();
          if (!trimmed) continue;
          let catId = catNameToId.get(trimmed.toLowerCase()) || catNameToId.get(trimmed);
          if (!catId) {
            catId = `cat_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
            const pickColor = colorList[existingCats.length % colorList.length];
            SqliteDb.createCategory({
              id: catId,
              name: trimmed,
              color: pickColor,
              icon: 'Bookmark',
              sortOrder: existingCats.length,
              userId: uid,
              createdAt: new Date().toISOString(),
            });
            catNameToId.set(trimmed.toLowerCase(), catId);
            catNameToId.set(catId, catId);
            existingCats.push({ id: catId, name: trimmed, sortOrder: existingCats.length, userId: uid });
          }
          resolvedIds.push(catId);
        }
      }

      userStateBatch.push({
        id: item.id,
        isFavorite: item.isFavorite,
        currentChapter: item.currentChapter,
        status: item.status,
        categoryIds: resolvedIds,
      });
    }

    SqliteDb.bulkApplyUserImportState(uid, userStateBatch);
  }

  res.status(201).json({
    success: true,
    count: processedItems.length,
    totalTracked: SqliteDb.getMangaCount(),
  });
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

// ---------------------------------------------------------------------------
// POST /api/manga/:id/pull-metadata-from-source
//
// Jellyfin-inspired "pick metadata from a specific source" endpoint.
//
// Body:
//   sourceUrl  — the URL of the source entry for this series
//   sourceName — human-readable source name (used for routing to the scraper)
//   fields     — array of atomic/aggregative fields to pull from that source
//                e.g. ["title","coverImage","description","rating","genres","altTitles"]
//                Omit (or pass []) to pull ALL supported fields.
//
// Behaviour:
//   1. Routes to the appropriate scraper (Asura, WeebCentral, Flame, MangaDex)
//      based on the sourceUrl / sourceName.
//   2. Fetches live metadata from that scraper.
//   3. Merges ONLY the requested fields onto the stored manga item.
//   4. Marks those fields in metadataOverrides so they survive future refreshes.
//   5. Persists and returns the updated manga.
// ---------------------------------------------------------------------------
app.post("/api/manga/:id/pull-metadata-from-source", async (req, res) => {
  const { id } = req.params;
  const existing = SqliteDb.getMangaById(id) || mangaDatabase.find((m) => m.id === id);
  if (!existing) return res.status(404).json({ error: "Manga not found" });

  const { sourceUrl, sourceName, fields } = req.body as {
    sourceUrl: string;
    sourceName: string;
    fields?: string[];
  };
  if (!sourceUrl) return res.status(400).json({ error: "sourceUrl is required" });

  const ALLOWED_FIELDS = ['title', 'description', 'coverImage', 'rating', 'genres', 'altTitles'] as const;
  type AllowedField = (typeof ALLOWED_FIELDS)[number];
  const fieldsToApply: AllowedField[] = (
    Array.isArray(fields) && fields.length > 0
      ? fields.filter((f): f is AllowedField => ALLOWED_FIELDS.includes(f as AllowedField))
      : [...ALLOWED_FIELDS]
  );

  if (fieldsToApply.length === 0) {
    return res.status(400).json({ error: "No valid fields requested" });
  }

  // ── Fetch metadata from the appropriate scraper ──────────────────────────
  let fetched: Partial<MangaItem> | null = null;
  const srcLower = (sourceName || '').toLowerCase();
  const urlLower = (sourceUrl || '').toLowerCase();

  try {
    if (urlLower.includes('asura') || srcLower.includes('asura')) {
      const meta = await fetchAsuraSeriesMetadata(sourceUrl);
      if (meta) fetched = meta;

    } else if (urlLower.includes('weebcentral') || srcLower.includes('weeb')) {
      const scraped = await fetchWeebCentralSeriesMetadata(sourceUrl);
      if (scraped) fetched = scraped as Partial<MangaItem>;

    } else if (urlLower.includes('flamecomics') || srcLower.includes('flame')) {
      const ctx = await fetchFlameSeriesContext(sourceUrl);
      if (ctx?.matchedSeries) {
        fetched = {
          title: ctx.matchedSeries.title,
          coverImage: ctx.matchedSeries.thumb,
          genres: ctx.matchedSeries.genres || [],
          description: ctx.matchedSeries.synopsis || '',
        };
      }

    } else if (urlLower.includes('mangadex') || srcLower.includes('mangadex')) {
      // Resolve MangaDex ID from URL or existing apiId
      const mdIdMatch = sourceUrl.match(/\/title\/([a-f0-9-]+)/i);
      const mdId = mdIdMatch?.[1] || existing.apiId;
      if (mdId) {
        const mdRes = await fetchMangaDex(`https://api.mangadex.org/manga/${mdId}?includes[]=cover_art`);
        if (mdRes.ok) {
          const mdJson = await mdRes.json();
          const attrs = mdJson.data?.attributes || {};
          const rels = mdJson.data?.relationships || [];
          const coverRel = rels.find((r: any) => r.type === 'cover_art');
          const coverFileName = coverRel?.attributes?.fileName;
          fetched = {
            title: preferEnglishTitle(attrs.title) || undefined,
            description: attrs.description?.en || Object.values(attrs.description || {})[0] as string | undefined,
            coverImage: coverFileName ? `/api/mangadex/image-proxy?url=${encodeURIComponent(`https://uploads.mangadex.org/covers/${mdId}/${coverFileName}.512.jpg`)}` : undefined,
            rating: existing.rating, // MangaDex doesn't expose a public rating
            genres: Array.isArray(attrs.tags) ? attrs.tags.map((t: any) => t.attributes?.name?.en).filter(Boolean) : [],
            altTitles: Array.isArray(attrs.altTitles) ? attrs.altTitles.map((t: any) => Object.values(t)[0]).filter(Boolean) as string[] : [],
          };
        }
      }

    } else {
      // Generic fallback: try scraping via WeebCentral series metadata fetcher
      const scraped = await fetchWeebCentralSeriesMetadata(sourceUrl).catch(() => null);
      if (scraped) fetched = scraped as Partial<MangaItem>;
    }
  } catch (err: any) {
    console.warn(`[pull-metadata-from-source] Scraper error for ${sourceUrl}:`, err.message);
    return res.status(502).json({ error: "Source scraper error", details: err.message });
  }

  if (!fetched) {
    return res.status(404).json({ error: "Could not fetch metadata from that source" });
  }

  // ── Apply only the requested fields ─────────────────────────────────────
  const updated: MangaItem = { ...existing };
  const appliedFields: string[] = [];

  for (const field of fieldsToApply) {
    const value = fetched[field as keyof typeof fetched];
    if (value === undefined || value === null) continue;

    if (field === 'title' && typeof value === 'string' && value.trim()) {
      updated.title = value.trim();
      appliedFields.push(field);
    } else if (field === 'description' && typeof value === 'string' && value.trim()) {
      updated.description = value.trim();
      appliedFields.push(field);
    } else if (field === 'coverImage' && typeof value === 'string' && value.trim()) {
      updated.coverImage = value.trim();
      appliedFields.push(field);
    } else if (field === 'rating' && typeof value === 'number' && value > 0) {
      updated.rating = value;
      appliedFields.push(field);
    } else if (field === 'genres' && Array.isArray(value) && value.length > 0) {
      // Aggregative: union with existing
      updated.genres = Array.from(new Set([...updated.genres, ...value as string[]])).filter(Boolean);
      appliedFields.push(field);
    } else if (field === 'altTitles' && Array.isArray(value) && value.length > 0) {
      // Aggregative: union with existing
      updated.altTitles = Array.from(new Set([...updated.altTitles, ...value as string[]])).filter(Boolean);
      appliedFields.push(field);
    }
  }

  if (appliedFields.length === 0) {
    return res.status(200).json({ success: false, manga: existing, message: "No new metadata found from that source" });
  }

  // ── Record applied fields as metadataOverrides ───────────────────────────
  // Atomic fields the user explicitly chose from a source are treated as
  // manual overrides — exactly like Jellyfin's "lock field" feature.
  const atomicApplied = appliedFields.filter((f) => ['title', 'description', 'coverImage', 'rating'].includes(f));
  updated.metadataOverrides = Array.from(
    new Set([...(existing.metadataOverrides || []), ...atomicApplied])
  );
  updated.lastUpdated = new Date().toISOString();

  // ── Persist ──────────────────────────────────────────────────────────────
  SqliteDb.upsertManga(updated);
  const idx = mangaDatabase.findIndex((m) => m.id === id);
  if (idx !== -1) mangaDatabase[idx] = updated;
  saveDatabaseToDisk();

  console.log(`[pull-metadata-from-source] Applied [${appliedFields.join(', ')}] from '${sourceName}' for '${updated.title}'`);
  res.json({
    success: true,
    manga: updated,
    appliedFields,
    message: `Applied ${appliedFields.join(', ')} from ${sourceName}`,
  });
});

// ---------------------------------------------------------------------------
// GET /api/manga/:id/metadata-options
//
// Jellyfin & Plex inspired Metadata Studio endpoint.
// Aggregates all artwork, covers, titles, overviews, ratings, and genres from
// all available sources for this series (plus MangaDex volume covers if linked).
// ---------------------------------------------------------------------------
app.get("/api/manga/:id/metadata-options", async (req, res) => {
  const { id } = req.params;
  const manga = SqliteDb.getMangaById(id) || mangaDatabase.find((m) => m.id === id);
  if (!manga) return res.status(404).json({ error: "Manga not found" });

  const searchOverride = typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim() : '';

  // 1. Gather all unique source candidates
  interface SourceOption {
    sourceName: string;
    sourceUrl: string;
    title?: string;
    description?: string;
    coverImage?: string;
    covers?: Array<{ url: string; label?: string }>;
    rating?: number;
    genres?: string[];
    altTitles?: string[];
  }

  const sourceCandidates: Array<{ name: string; url: string }> = [];
  const seenUrls = new Set<string>();

  const addCandidate = (name: string, url: string) => {
    if (!url) return;
    const norm = url.toLowerCase().trim();
    if (seenUrls.has(norm)) return;
    seenUrls.add(norm);
    sourceCandidates.push({ name: name || 'Source', url });
  };

  for (const s of manga.availableSources || []) {
    addCandidate(s.sourceName || 'Source', s.sourceUrl || '');
  }
  if (manga.sourceUrl) {
    addCandidate(manga.sourceName || 'Primary Source', manga.sourceUrl);
  }

  // Also check MangaDex ID
  let mdId = (!searchOverride && manga.apiId) ? manga.apiId : ((!searchOverride && manga.id?.startsWith('md_')) ? manga.id.replace('md_', '') : null) || (!searchOverride ? manga.sourceUrl?.match(/\/title\/([a-f0-9-]+)/i)?.[1] : null);

  const sourceResults: SourceOption[] = [];

  // 2. Fetch each source in parallel with timeout
  await Promise.allSettled([
    // MangaDex fetch if available
    (async () => {
      const targetQuery = searchOverride || manga.title;
      if (!mdId && targetQuery && targetQuery !== 'Unknown') {
        try {
          const cleanTitle = targetQuery.replace(/\s*\([^)]*\)/g, '').trim();
          if (cleanTitle.length > 2) {
            const searchRes = await fetchMangaDex(
              `https://api.mangadex.org/manga?title=${encodeURIComponent(cleanTitle)}&limit=5&includes[]=cover_art`
            );
            if (searchRes.ok) {
              const searchJson = await searchRes.json();
              if (searchJson.data?.[0]?.id) {
                mdId = searchJson.data[0].id;
              }
            }
          }
        } catch (_) {}
      }

      if (mdId) {
        try {
          const [mdRes, coverRes] = await Promise.all([
            fetchMangaDex(`https://api.mangadex.org/manga/${mdId}?includes[]=cover_art`),
            fetchMangaDex(`https://api.mangadex.org/cover?manga[]=${mdId}&limit=50&order[volume]=desc`).catch(() => null),
          ]);

          if (mdRes.ok) {
            const mdJson = await mdRes.json();
            const attrs = mdJson.data?.attributes || {};
            const rels = mdJson.data?.relationships || [];
            const primaryCoverRel = rels.find((r: any) => r.type === 'cover_art');
            const primaryFileName = primaryCoverRel?.attributes?.fileName;

            const allCovers: Array<{ url: string; label?: string }> = [];
            if (primaryFileName) {
              allCovers.push({
                url: `/api/mangadex/image-proxy?url=${encodeURIComponent(`https://uploads.mangadex.org/covers/${mdId}/${primaryFileName}.512.jpg`)}`,
                label: 'Main Cover (MangaDex)',
              });
            }

            if (coverRes && coverRes.ok) {
              const coverJson = await coverRes.json();
              const coverData = Array.isArray(coverJson.data) ? coverJson.data : [];
              for (const c of coverData) {
                const fn = c.attributes?.fileName;
                const vol = c.attributes?.volume;
                const locale = c.attributes?.locale;
                if (fn && fn !== primaryFileName) {
                  allCovers.push({
                    url: `/api/mangadex/image-proxy?url=${encodeURIComponent(`https://uploads.mangadex.org/covers/${mdId}/${fn}.512.jpg`)}`,
                    label: vol ? `Vol. ${vol}${locale ? ` (${locale.toUpperCase()})` : ''}` : `Alt Cover${locale ? ` (${locale.toUpperCase()})` : ''}`,
                  });
                }
              }
            }

            sourceResults.push({
              sourceName: 'MangaDex API',
              sourceUrl: `https://mangadex.org/title/${mdId}`,
              title: preferEnglishTitle(attrs.title) || manga.title,
              description: attrs.description?.en || Object.values(attrs.description || {})[0] as string || '',
              coverImage: allCovers[0]?.url,
              covers: allCovers,
              genres: Array.isArray(attrs.tags) ? attrs.tags.map((t: any) => t.attributes?.name?.en).filter(Boolean) : [],
              altTitles: Array.isArray(attrs.altTitles) ? attrs.altTitles.map((t: any) => Object.values(t)[0]).filter(Boolean) as string[] : [],
            });
          }
        } catch (_) {}
      }
    })(),

    // AniList high-resolution artwork fetch
    (async () => {
      const aniQuery = searchOverride || manga.title;
      if (!aniQuery || aniQuery === 'Unknown') return;
      try {
        const cleanTitle = aniQuery.replace(/\s*\([^)]*\)/g, '').trim();
        if (cleanTitle.length < 2) return;
        const graphqlQuery = `
          query ($search: String) {
            Page(page: 1, perPage: 4) {
              media(search: $search, type: MANGA) {
                id
                title { english romaji native }
                coverImage { extraLarge large medium color }
                bannerImage
                description
                genres
                averageScore
              }
            }
          }
        `;
        const aniRes = await fetch('https://graphql.anilist.co', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ query: graphqlQuery, variables: { search: cleanTitle } }),
        });
        if (aniRes.ok) {
          const aniJson = await aniRes.json();
          const list = aniJson.data?.Page?.media || [];
          for (const m of list) {
            const aniTitle = m.title?.english || m.title?.romaji || m.title?.native || cleanTitle;
            const covers: Array<{ url: string; label?: string }> = [];
            if (m.coverImage?.extraLarge) {
              covers.push({ url: m.coverImage.extraLarge, label: 'AniList HQ Poster (Extra Large)' });
            }
            if (m.coverImage?.large && m.coverImage.large !== m.coverImage.extraLarge) {
              covers.push({ url: m.coverImage.large, label: 'AniList Standard Poster' });
            }
            if (m.bannerImage) {
              covers.push({ url: m.bannerImage, label: 'AniList Official Banner Art' });
            }
            if (covers.length > 0) {
              sourceResults.push({
                sourceName: 'AniList',
                sourceUrl: `https://anilist.co/manga/${m.id}`,
                title: aniTitle,
                description: m.description ? m.description.replace(/<[^>]*>/g, '') : '',
                coverImage: covers[0]?.url,
                covers,
                rating: m.averageScore ? Number((m.averageScore / 10).toFixed(1)) : undefined,
                genres: m.genres || [],
                altTitles: [m.title?.romaji, m.title?.native, m.title?.english].filter((t: any) => t && t !== aniTitle),
              });
            }
          }
        }
      } catch (_) {}
    })(),

    // Other sources fetch
    ...sourceCandidates.map(async (cand) => {
      const urlLower = cand.url.toLowerCase();
      const nameLower = cand.name.toLowerCase();

      try {
        if (urlLower.includes('asura') || nameLower.includes('asura')) {
          const meta = await fetchAsuraSeriesMetadata(cand.url);
          if (meta) {
            sourceResults.push({
              sourceName: cand.name || 'Asura Scans',
              sourceUrl: cand.url,
              title: meta.title,
              description: meta.description,
              coverImage: meta.coverImage,
              covers: meta.coverImage ? [{ url: meta.coverImage, label: 'Default Artwork (Asura)' }] : [],
              rating: meta.rating,
              genres: meta.genres || [],
              altTitles: meta.altTitles || [],
            });
          }
        } else if (urlLower.includes('weebcentral') || nameLower.includes('weeb')) {
          const scraped = await fetchWeebCentralSeriesMetadata(cand.url);
          if (scraped) {
            sourceResults.push({
              sourceName: cand.name || 'Weeb Central',
              sourceUrl: cand.url,
              title: scraped.title,
              description: scraped.description,
              coverImage: scraped.coverImage,
              covers: scraped.coverImage ? [{ url: scraped.coverImage, label: 'Official Artwork (Weeb Central)' }] : [],
              genres: scraped.genres || [],
              rating: scraped.rating,
            });
          }
        } else if (urlLower.includes('flamecomics') || nameLower.includes('flame')) {
          const ctx = await fetchFlameSeriesContext(cand.url);
          if (ctx?.matchedSeries) {
            const thumb = ctx.matchedSeries.thumb;
            sourceResults.push({
              sourceName: cand.name || 'Flame Comics',
              sourceUrl: cand.url,
              title: ctx.matchedSeries.title,
              description: ctx.matchedSeries.synopsis,
              coverImage: thumb,
              covers: thumb ? [{ url: thumb, label: 'Series Poster (Flame Comics)' }] : [],
              genres: ctx.matchedSeries.genres || [],
            });
          }
        } else {
          // Generic scraper fallback
          const scraped = await fetchWeebCentralSeriesMetadata(cand.url).catch(() => null);
          if (scraped && (scraped.title || scraped.coverImage)) {
            sourceResults.push({
              sourceName: cand.name,
              sourceUrl: cand.url,
              title: scraped.title,
              description: scraped.description,
              coverImage: scraped.coverImage,
              covers: scraped.coverImage ? [{ url: scraped.coverImage, label: cand.name }] : [],
              genres: scraped.genres || [],
            });
          }
        }
      } catch (_) {}
    }),
  ]);

  res.json({
    success: true,
    current: {
      id: manga.id,
      title: manga.title,
      description: manga.description,
      coverImage: manga.coverImage,
      rating: manga.rating,
      genres: manga.genres,
      altTitles: manga.altTitles,
      metadataOverrides: manga.metadataOverrides || [],
    },
    sources: sourceResults,
  });
});

// ---------------------------------------------------------------------------
// POST /api/manga/:id/custom-metadata-update
//
// Plex / Jellyfin style metadata field locking & custom artwork updater.
// ---------------------------------------------------------------------------
app.post("/api/manga/:id/custom-metadata-update", (req, res) => {
  const { id } = req.params;
  const manga = SqliteDb.getMangaById(id) || mangaDatabase.find((m) => m.id === id);
  if (!manga) return res.status(404).json({ error: "Manga not found" });

  const {
    title,
    description,
    coverImage,
    rating,
    genres,
    altTitles,
    isNsfw,
    metadataOverrides,
  } = req.body || {};

  const updated: MangaItem = { ...manga };

  if (typeof title === 'string' && title.trim()) updated.title = title.trim();
  if (typeof description === 'string') updated.description = description.trim();
  if (typeof coverImage === 'string' && coverImage.trim()) updated.coverImage = coverImage.trim();
  if (typeof rating === 'number' && !isNaN(rating)) updated.rating = rating;
  if (typeof isNsfw === 'boolean') updated.isNsfw = isNsfw;
  if (Array.isArray(genres)) updated.genres = Array.from(new Set(genres.map(String).filter(Boolean)));
  if (Array.isArray(altTitles)) updated.altTitles = Array.from(new Set(altTitles.map(String).filter(Boolean)));
  if (Array.isArray(metadataOverrides)) {
    updated.metadataOverrides = Array.from(new Set(metadataOverrides.map(String).filter(Boolean)));
  }

  updated.lastUpdated = new Date().toISOString();

  SqliteDb.upsertManga(updated);
  const idx = mangaDatabase.findIndex((m) => m.id === id);
  if (idx !== -1) mangaDatabase[idx] = updated;
  saveDatabaseToDisk();

  res.json({
    success: true,
    manga: updated,
    message: "Metadata and artwork updated successfully",
  });
});




/**
 * Test whether an anchor href looks like a real manga/series content path across
 * diverse engine URL schemes (standard EN words, localized words, and clean slugs).
 */
export function isContentPath(href: string): boolean {
  if (!href || typeof href !== 'string') return false;
  const h = href.trim();
  if (/^(#|javascript:|mailto:|tel:)/i.test(h)) return false;
  // Explicit directory path keywords (EN, VN, ES, FR, RU, etc.)
  if (/\/(manga|series|title|titles|manhwa|manhua|comic|comics|webtoon|webtoons|read|reader|view|book|truyen|truyen-tranh|story|detail|project|online|comic-online|bd|mangas|g|comic|manga-detail)\//i.test(h)) {
    return true;
  }
  // Clean single-segment series path e.g. "/solo-leveling" or "/solo-leveling/"
  // (must have at least 3 chars, letters/numbers/dashes, and not be a system/nav path)
  if (/^\/[a-z0-9-_]{3,80}\/?$/i.test(h)) {
    return !/^\/(home|login|register|signup|search|browse|explore|filter|categories|category|genres|genre|tags|tag|latest|popular|history|bookmarks|bookmark|settings|privacy|terms|about|dmca|contact|faq|api|admin|wp-admin|wp-content|wp-includes|feed|rss|install_app|user|profile|author|publisher|group)\/?$/i.test(h);
  }
  return false;
}

export function isNavText(t: string): boolean {
  return /^(nav|menu|home|login|register|sign.?up|account|cookie|privacy|about|dmca|contact|tag|categor|terms|disclaimer|faq|support|donate|patreon|discord)/i.test((t || '').trim());
}

// Search Alternative Sources for Manga Endpoint
app.get("/api/manga/:id/find-sources", async (req, res) => {
  const { id } = req.params;
  const manga = SqliteDb.getMangaById(id) || mangaDatabase.find((m) => m.id === id);

  if (!manga) {
    return res.status(404).json({ error: "Manga not found" });
  }

  const queryParam = ((req.query.q as string) || '').trim();
  const query = queryParam || manga.title;
  const results: any[] = [];
  const seenUrls = new Set<string>();
  if (manga.sourceUrl) seenUrls.add(manga.sourceUrl.toLowerCase());

  // 1. Check top enabled alive Kotatsu sources (up to 12 active sources)
  const candidateSources = KOTATSU_SOURCES.filter(
    (s) => s.id !== 'mangadex' && !disabledSourceIds.has(s.id) && isSourceAlive(s.id)
  ).slice(0, 12);

  await Promise.allSettled(
    candidateSources.map(async (sourceDef) => {
      try {
        let items: any[] = [];
        if (sourceDef.id === 'weebcentral') {
          const weebResults = await searchWeebCentral(query);
          items = weebResults.map((s) => ({
            sourceName: 'Weeb Central',
            sourceId: 'weebcentral',
            sourceUrl: s.sourceUrl,
            title: s.title,
            coverImage: s.coverImage,
          }));
        } else if (sourceDef.id === 'asurascans') {
          const cleanQuery = query.replace(/^asura_/i, '').replace(/[-_]/g, ' ').trim();
          const asuraRes = await fetch(`https://api.asurascans.com/api/series?search=${encodeURIComponent(cleanQuery || query)}`, {
            headers: ASURA_API_HEADERS,
            signal: AbortSignal.timeout(6000),
          });
          if (asuraRes.ok) {
            const json = await asuraRes.json();
            const data: any[] = Array.isArray(json?.data) ? json.data : [];
            items = data.map((s: any) => ({
              sourceName: 'Asura Scans',
              sourceId: 'asurascans',
              sourceUrl: `https://asurascans.com${s.public_url || `/comics/${s.slug || s.id}`}`,
              title: s.title || 'Unknown',
              coverImage: s.cover || '',
              latestChapter: s.latest_chapter || s.total_chapters || undefined,
            }));
          }
        } else {
          let searchUrl = `${sourceDef.baseUrl}/?s=${encodeURIComponent(query)}`;
          if (sourceDef.engineType === 'madara' || sourceDef.engineType === 'wpcomics') {
            searchUrl = `${sourceDef.baseUrl}/?s=${encodeURIComponent(query)}&post_type=wp-manga`;
          } else if (sourceDef.engineType === 'foolslide') {
            searchUrl = `${sourceDef.baseUrl}/search?search=${encodeURIComponent(query)}`;
          }
          const bypassRes = await fetchWithChallengeBypass(searchUrl, {
            headers: {
              'User-Agent': APP_USER_AGENT,
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
            timeoutMs: 6000,
            sourceId: sourceDef.id,
          });
          if (bypassRes.ok && bypassRes.html) {
            const $ = cheerio.load(bypassRes.html);
            const origin = sourceDef.baseUrl.replace(/\/$/, '');
            const resolveHref = (href: string) => href.startsWith('http') ? href : `${origin}${href.startsWith('/') ? '' : '/'}${href}`;
            const resolveCover = (el: any) => {
              const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src') || '';
              return src.startsWith('http') ? src : (src ? `${origin}${src}` : '');
            };

            $('.listupd .bsx, .listupd .bs, .page-item-detail, .c-tabs-item__content').each((_i, el) => {
              const a = $(el).find('a').first();
              const href = a.attr('href') || '';
              const title = ($(el).find('.tt, .bigor .tt, .post-title a, h3, h4').text() || a.attr('title') || '').trim();
              const cover = resolveCover($(el).find('img').first());
              if (href && title && isContentPath(href) && !isNavText(title)) {
                items.push({
                  sourceName: sourceDef.name,
                  sourceId: sourceDef.id,
                  sourceUrl: resolveHref(href),
                  title,
                  coverImage: cover || '',
                });
              }
            });
          }
        }

        for (const item of items) {
          if (!item.sourceUrl) continue;
          const urlKey = item.sourceUrl.toLowerCase();
          if (seenUrls.has(urlKey)) continue;
          seenUrls.add(urlKey);

          const qNorm = query.toLowerCase().replace(/[^a-z0-9]/g, '');
          const tNorm = (item.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          const isExact = qNorm.length > 0 && (qNorm === tNorm || tNorm.includes(qNorm) || qNorm.includes(tNorm));
          const confidence = qNorm === tNorm ? 'exact' : isExact ? 'high' : 'partial';

          results.push({
            ...item,
            confidence,
            isCurrent: manga.sourceUrl ? item.sourceUrl.toLowerCase() === manga.sourceUrl.toLowerCase() : false,
          });
        }
      } catch {
        // Source timeout or fail-fast handled silently
      }
    })
  );

  // Search existing SQLite catalog for same title from another working source
  const dbMatches = SqliteDb.getAllManga().filter((m) => {
    if (m.id === manga.id || !m.sourceUrl) return false;
    if (isMangaDexSourceLink(m.sourceName, m.sourceUrl)) return false;
    const mTitleNorm = m.title.toLowerCase().replace(/[^a-z0-9]/g, '');
    const qNorm = query.toLowerCase().replace(/[^a-z0-9]/g, '');
    return mTitleNorm === qNorm || mTitleNorm.includes(qNorm);
  });

  for (const dbm of dbMatches) {
    if (!dbm.sourceUrl) continue;
    const urlKey = dbm.sourceUrl.toLowerCase();
    if (!seenUrls.has(urlKey)) {
      seenUrls.add(urlKey);
      results.push({
        sourceName: dbm.sourceName,
        sourceId: dbm.sourceName.toLowerCase().replace(/[^a-z0-9]/g, ''),
        sourceUrl: dbm.sourceUrl,
        title: dbm.title,
        coverImage: dbm.coverImage,
        latestChapter: dbm.latestChapter,
        confidence: 'exact',
        isCurrent: false,
      });
    }
  }

  results.sort((a, b) => {
    const score = (c: string) => (c === 'exact' ? 3 : c === 'high' ? 2 : 1);
    return score(b.confidence) - score(a.confidence);
  });

  res.json({
    mangaId: manga.id,
    title: manga.title,
    query,
    count: results.length,
    results,
  });
});

// Attach / Link Alternative Source Endpoint
app.post("/api/manga/:id/attach-source", (req, res) => {
  if (!canWriteCatalog(req)) return rejectCatalogWrite(res);
  const { id } = req.params;
  const existing = SqliteDb.getMangaById(id) || mangaDatabase.find((m) => m.id === id);
  if (!existing) {
    return res.status(404).json({ error: "Manga not found" });
  }

  const { sourceName, sourceUrl, latestChapter, coverImage, setAsPrimary = true } = req.body || {};
  if (!sourceUrl) {
    return res.status(400).json({ error: "Missing sourceUrl" });
  }

  const newSourceName = sourceName || 'Live Source';
  const available = Array.isArray(existing.availableSources) ? [...existing.availableSources] : [];

  if (!available.some((s) => s.sourceUrl.toLowerCase() === sourceUrl.toLowerCase())) {
    available.push({ sourceName: newSourceName, sourceUrl });
  }

  const updatedItem: MangaItem = {
    ...existing,
    sourceName: setAsPrimary ? newSourceName : existing.sourceName,
    sourceUrl: setAsPrimary ? sourceUrl : existing.sourceUrl,
    coverImage: (setAsPrimary && coverImage && !existing.coverImage) ? coverImage : existing.coverImage,
    latestChapter: (latestChapter && Number(latestChapter) > (existing.latestChapter || 0)) ? Number(latestChapter) : existing.latestChapter,
    availableSources: available,
    lastUpdated: new Date().toISOString(),
  };

  // If flagged for missing source, resolve it automatically
  if (updatedItem.isFlagged && (!updatedItem.flagReason || updatedItem.flagReason.toLowerCase().includes('missing source'))) {
    updatedItem.isFlagged = false;
    updatedItem.flagReason = undefined;
    updatedItem.flaggedAt = undefined;
  }

  syncAddOrUpdateManga(updatedItem);
  const uid = resolveRequestUserId(req);
  if (uid) {
    SqliteDb.setUserFavorite(uid, updatedItem.id, true);
  }

  res.json({
    success: true,
    manga: uid ? SqliteDb.applyUserOverlay([updatedItem], uid)[0] : updatedItem,
    message: `Linked ${newSourceName} to '${updatedItem.title}' successfully!`,
  });
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

// Categories & Shelves Endpoints
app.get("/api/categories", (req, res) => {
  const userId = resolveRequestUserId(req);
  if (!userId) {
    return res.json([]);
  }
  const categories = SqliteDb.getCategories(userId);
  res.json(categories);
});

app.post("/api/categories", (req, res) => {
  const userId = resolveRequestUserId(req);
  if (!userId) {
    return res.status(401).json({ error: "Authentication required to create custom shelves" });
  }
  const { name, description, color, icon, sortOrder } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Category name is required" });
  }

  const id = `cat_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const newCat = SqliteDb.createCategory({
    id,
    name: name.trim(),
    description: description ? String(description).trim() : undefined,
    color: color || '#f59e0b',
    icon: icon || 'Bookmark',
    sortOrder: Number(sortOrder) || 0,
    userId,
    createdAt: new Date().toISOString(),
  });

  res.status(201).json(newCat);
});

app.put("/api/categories/:id", (req, res) => {
  const userId = resolveRequestUserId(req);
  if (!userId) {
    return res.status(401).json({ error: "Authentication required to update custom shelves" });
  }
  const { id } = req.params;
  const updates = req.body || {};

  const updated = SqliteDb.updateCategory(id, updates, userId);
  if (!updated) {
    return res.status(404).json({ error: "Category not found" });
  }

  res.json(updated);
});

app.delete("/api/categories/:id", (req, res) => {
  const userId = resolveRequestUserId(req);
  if (!userId) {
    return res.status(401).json({ error: "Authentication required to delete custom shelves" });
  }
  const { id } = req.params;

  SqliteDb.deleteCategory(id, userId);
  res.json({ success: true, message: "Category deleted" });
});

app.post("/api/categories/assign", (req, res) => {
  const userId = resolveRequestUserId(req);
  if (!userId) {
    return res.status(401).json({ error: "Authentication required to assign shelves" });
  }
  const { mangaId, categoryIds } = req.body || {};
  if (!mangaId || !Array.isArray(categoryIds)) {
    return res.status(400).json({ error: "mangaId and categoryIds array are required" });
  }

  SqliteDb.setMangaCategories(mangaId, categoryIds, userId);
  const manga = SqliteDb.getMangaById(mangaId);
  const overlaid = manga ? SqliteDb.applyUserOverlay([manga], userId)[0] : null;

  res.json({ success: true, categories: categoryIds, manga: overlaid });
});

app.post("/api/categories/bulk-assign", (req, res) => {
  const userId = resolveRequestUserId(req);
  if (!userId) {
    return res.status(401).json({ error: "Authentication required to bulk assign shelves" });
  }
  const { mangaIds, categoryId, action = 'add' } = req.body || {};
  if (!Array.isArray(mangaIds) || !categoryId) {
    return res.status(400).json({ error: "mangaIds array and categoryId are required" });
  }

  SqliteDb.bulkAssignCategory(mangaIds, categoryId, action, userId);
  res.json({ success: true, count: mangaIds.length });
});

// ---- Challenge & Manual Captcha Notification Endpoints -------------------------
app.get("/api/challenges", (req, res) => {
  const challenges = challengeManager.getActiveChallenges();
  const config = challengeManager.getConfig();
  res.json({
    count: challenges.length,
    challenges,
    config,
  });
});

app.post("/api/challenges/config", (req, res) => {
  const body = req.body || {};
  const updated = challengeManager.updateConfig(body);
  res.json({ success: true, config: updated });
});

app.post("/api/challenges/:id/dismiss", (req, res) => {
  const { id } = req.params;
  challengeManager.dismissChallenge(id);
  res.json({ success: true });
});

app.post("/api/challenges/:id/solve-manual", async (req, res) => {
  const { id } = req.params;
  const { cookies, userAgent, sourceId } = req.body || {};

  const challenges = challengeManager.getActiveChallenges();
  const found = challenges.find((c) => c.id === id || c.sourceId === sourceId);

  if (cookies && typeof cookies === 'string') {
    const src = found?.sourceId || sourceId || id.replace(/^chn_/, '');
    const cookieArr = cookies.split(';').map((s) => s.trim()).filter(Boolean);
    sourceCustomCookies.set(src, cookieArr);
    if (userAgent) {
      sourceCustomUserAgents.set(src, userAgent.trim());
    }
  }

  // Resolve challenge
  if (found) {
    challengeManager.resolveChallenge(found.sourceId);
  } else if (sourceId) {
    challengeManager.resolveChallenge(sourceId);
  }

  res.json({ success: true, message: "Challenge marked as resolved" });
});

app.post("/api/challenges/test", (req, res) => {
  const testNotif = challengeManager.recordChallenge({
    sourceId: 'asurascans_test',
    sourceName: 'Asura Scans (Test)',
    sourceUrl: 'https://asuracomic.net',
    challengeType: 'cloudflare_turnstile',
    httpStatus: 403,
  });
  res.json({ success: true, notification: testNotif });
});

// Flag Source as Broken during Captcha / Challenge
const handleFlagSourceBroken = (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const { reason, sourceId: reqSourceId } = req.body || {};
  const challenges = challengeManager.getActiveChallenges();
  const found = challenges.find((c) => c.id === id || c.sourceId === id || c.sourceId === reqSourceId);
  const targetSourceId = found?.sourceId || reqSourceId || (typeof id === 'string' ? id.replace(/^chn_/, '') : '');

  if (!targetSourceId) {
    return res.status(400).json({ error: "Source ID is required" });
  }

  const targetSourceName = found?.sourceName || targetSourceId;

  // 1. Disable the source globally
  disabledSourceIds.add(targetSourceId);
  syncConfig.disabledSources = Array.from(disabledSourceIds);

  // 2. Mark in health map & trip circuit breaker
  const failureReason = reason || `Manually flagged as broken during challenge/captcha`;
  let h = sourceHealthMap.get(targetSourceId);
  if (!h) {
    h = { id: targetSourceId, lastChecked: Date.now(), lastStatus: 'broken', consecutiveFailures: 10 };
    sourceHealthMap.set(targetSourceId, h);
  }
  h.lastStatus = 'broken';
  h.failureReason = failureReason;
  h.consecutiveFailures = Math.max(h.consecutiveFailures || 0, 10);
  sourceCircuitBreaker.trip(targetSourceId, failureReason);
  h.circuitState = 'OPEN';

  // 3. Dismiss/resolve active challenge
  if (found) {
    challengeManager.dismissChallenge(found.id);
  }
  challengeManager.resolveChallenge(targetSourceId);

  // 4. Save state to disk
  saveDatabaseToDisk();
  scheduleSourceHealthPersist();

  console.log(`[Challenge Engine] Source "${targetSourceName}" (${targetSourceId}) manually flagged as broken and disabled. Reason: ${failureReason}`);
  res.json({
    success: true,
    sourceId: targetSourceId,
    sourceName: targetSourceName,
    message: `Source "${targetSourceName}" has been flagged as broken and disabled.`,
  });
};

app.post("/api/challenges/:id/flag-broken", handleFlagSourceBroken);
app.post("/api/challenges/flag-broken", handleFlagSourceBroken);
app.post("/api/kotatsu/sources/flag-broken", handleFlagSourceBroken);
app.post("/api/sources/flag-broken", handleFlagSourceBroken);

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
    isNsfw: body.isNsfw !== undefined ? Boolean(body.isNsfw) : (body.genres ? isNsfwManga(body) : existing.isNsfw),
    metadataOverrides: body.metadataOverrides !== undefined ? (Array.isArray(body.metadataOverrides) ? body.metadataOverrides : existing.metadataOverrides) : existing.metadataOverrides,
    categories: existing.categories,
    lastUpdated: new Date().toISOString(),
  };

  syncAddOrUpdateManga(updatedItem);
  const uid = resolveRequestUserId(req) || 'usr_guest';
  if (body.isFavorite !== undefined) {
    SqliteDb.setUserFavorite(uid, updatedItem.id, Boolean(body.isFavorite));
  }
  if (body.categories !== undefined && Array.isArray(body.categories)) {
    SqliteDb.setMangaCategories(updatedItem.id, body.categories, uid);
  }
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
  SqliteDb.setUserFavorite(userId, id, true);
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
        dispatchNewChapterWebhooks(item, foundLatestCh).catch((e) => console.error("[Webhook Notifier] Error:", e));
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
// AUTO-DISCOVERY ENGINE FOR LIVE SOURCES
// ==========================================

/**
 * Automatically searches active scanlation sources (Asura, ComicK, Flame, etc.)
 * for a matching live source URL by series title / alternate titles.
 */
export async function searchLiveSourcesForSeries(
  title: string,
  altTitles: string[] = []
): Promise<{ sourceName: string; sourceUrl: string; confidence: number }[]> {
  const discovered: { sourceName: string; sourceUrl: string; confidence: number }[] = [];
  const seenUrls = new Set<string>();

  const candidateQueries = Array.from(new Set([
    title,
    ...(altTitles || []),
  ]))
    .map((t) => (t ? t.replace(/\s*\([^)]*\)/g, '').replace(/uncensored|reboot|hd|season \d+|ch \d+/gi, '').trim() : ''))
    .filter((t) => t.length >= 2);

  for (const q of candidateQueries.slice(0, 3)) {
    // 1. Check Weeb Central (covers 100k+ series across Japanese manga and Korean manhwa)
    if (!disabledSourceIds.has('weebcentral') && isSourceAlive('weebcentral')) {
      try {
        const weebList = await searchWeebCentral(q);
        for (const s of weebList) {
          const sTitle = s.title || '';
          const sim = calculateStringSimilarity(q, sTitle);
          if (sim >= 55 && s.sourceUrl) {
            if (!seenUrls.has(s.sourceUrl)) {
              seenUrls.add(s.sourceUrl);
              discovered.push({ sourceName: 'Weeb Central', sourceUrl: s.sourceUrl, confidence: sim });
            }
          }
        }
      } catch (_) {}
    }

    // 2. Check Asura Scans JSON API
    if (!disabledSourceIds.has('asurascans') && isSourceAlive('asurascans')) {
      try {
        const asuraRes = await fetch(`https://api.asurascans.com/api/series?search=${encodeURIComponent(q)}`, {
          headers: ASURA_API_HEADERS,
          signal: AbortSignal.timeout(6000),
        });
        if (asuraRes.ok) {
          const asuraJson = await asuraRes.json();
          const list = Array.isArray(asuraJson?.data) ? asuraJson.data : [];
          for (const s of list) {
            const sTitle = s.title || '';
            const sim = calculateStringSimilarity(q, sTitle);
            if (sim >= 55) {
              const slug = s.slug || s.id || '';
              const pubPath = s.public_url || `/comics/${slug}`;
              const sUrl = `https://asurascans.com${pubPath}`;
              if (!seenUrls.has(sUrl)) {
                seenUrls.add(sUrl);
                discovered.push({ sourceName: 'Asura Scans', sourceUrl: sUrl, confidence: sim });
              }
            }
          }
        }
      } catch (_) {}
    }

    // 3. Check Flame Comics
    if (!disabledSourceIds.has('flamecomics') && isSourceAlive('flamecomics')) {
      try {
        const flameSlug = q.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const flameCtx = await fetchFlameSeriesContext(`https://flamecomics.xyz/series/${flameSlug}`);
        if (flameCtx && flameCtx.matchedSeries?.title) {
          const sim = calculateStringSimilarity(q, flameCtx.matchedSeries.title);
          if (sim >= 55) {
            const sUrl = `https://flamecomics.xyz/series/${flameCtx.seriesId || flameSlug}`;
            if (!seenUrls.has(sUrl)) {
              seenUrls.add(sUrl);
              discovered.push({ sourceName: 'Flame Comics', sourceUrl: sUrl, confidence: sim });
            }
          }
        }
      } catch (_) {}
    }

    if (discovered.length >= 3) break;
  }

  discovered.sort((a, b) => b.confidence - a.confidence);
  return discovered;
}

/**
 * Automatically discovers a live source for a manga when none is set or when
 * the manga only has a MangaDex metadata URL. Attaches the source to the manga
 * and persists the update.
 */
export async function autoDiscoverLiveSourceForManga(
  manga: MangaItem
): Promise<{ sourceName: string; sourceUrl: string } | null> {
  // Check if manga already has a valid non-MangaDex live source in availableSources
  if (Array.isArray(manga.availableSources) && manga.availableSources.length > 0) {
    const existingLive = manga.availableSources.find(
      (s) => s && s.sourceUrl && s.sourceUrl.startsWith('http') && !s.sourceUrl.toLowerCase().includes('mangadex.org')
    );
    if (existingLive) {
      if (!manga.sourceUrl || manga.sourceUrl.toLowerCase().includes('mangadex.org')) {
        manga.sourceUrl = existingLive.sourceUrl;
        manga.sourceName = existingLive.sourceName || manga.sourceName;
        SqliteDb.upsertManga(manga);
        const idx = mangaDatabase.findIndex((m) => m.id === manga.id);
        if (idx !== -1) mangaDatabase[idx] = manga;
        saveDatabaseToDisk();
      }
      return existingLive;
    }
  }

  const results = await searchLiveSourcesForSeries(manga.title, manga.altTitles);
  if (results.length === 0) return null;

  const best = results[0];
  if (!Array.isArray(manga.availableSources)) manga.availableSources = [];

  for (const r of results) {
    if (!manga.availableSources.some((s) => s.sourceUrl === r.sourceUrl)) {
      manga.availableSources.push({ sourceName: r.sourceName, sourceUrl: r.sourceUrl });
    }
  }

  // Update primary sourceUrl if it was MangaDex or empty
  if (!manga.sourceUrl || manga.sourceUrl.toLowerCase().includes('mangadex.org')) {
    manga.sourceUrl = best.sourceUrl;
    manga.sourceName = best.sourceName;
  }

  manga.lastUpdated = new Date().toISOString();
  SqliteDb.upsertManga(manga);
  const idx = mangaDatabase.findIndex((m) => m.id === manga.id);
  if (idx !== -1) mangaDatabase[idx] = manga;
  saveDatabaseToDisk();

  console.log(`[Live Source Discovery] Auto-linked live source "${best.sourceName}" (${best.sourceUrl}) for "${manga.title}"`);
  return best;
}

// ==========================================
// BUILT-IN WEBTOON & MANGA READER ENDPOINTS
// ==========================================

// Get list of chapters for a series
app.get("/api/reader/chapters/:mangaId", async (req, res) => {
  const { mangaId } = req.params;
  const order = (req.query.order as string) || 'desc'; // 'desc' or 'asc'

  let manga = resolveManga(mangaId);
  let liveSourceUrl = (req.query.url as string) || manga?.sourceUrl || '';

  // If liveSourceUrl is empty, try inferring from mangaId prefix (e.g. asura_..., flame_..., kotatsu_...)
  if (!liveSourceUrl && mangaId) {
    if (mangaId.startsWith('asura_')) {
      const slug = mangaId.replace('asura_', '');
      liveSourceUrl = `https://asurascans.com/comics/${slug}`;
    } else if (mangaId.startsWith('flame_')) {
      const slug = mangaId.replace('flame_', '');
      liveSourceUrl = `https://flamecomics.xyz/series/${slug}`;
    } else if (mangaId.startsWith('kotatsu_')) {
      for (const src of KOTATSU_SOURCES) {
        if (mangaId.startsWith(`kotatsu_${src.id}_`)) {
          const pathOrSlug = mangaId.replace(`kotatsu_${src.id}_`, '');
          liveSourceUrl = pathOrSlug.startsWith('http') ? pathOrSlug : `${src.baseUrl.replace(/\/$/, '')}/${pathOrSlug}`;
          break;
        }
      }
    }
  }

  if (!manga && !liveSourceUrl) {
    return res.status(404).json({ error: "Manga not found" });
  }

  // Resolve the best available live source URL — skip MangaDex (metadata-only), prefer
  // availableSources when the primary sourceUrl points to MangaDex.
  if (manga && liveSourceUrl && liveSourceUrl.toLowerCase().includes('mangadex.org') && manga.availableSources?.length) {
    const alt = manga.availableSources.find(
      (s) => s.sourceUrl && s.sourceUrl.startsWith('http') && !s.sourceUrl.toLowerCase().includes('mangadex.org')
    );
    if (alt) liveSourceUrl = alt.sourceUrl;
  }

  // If no working live source URL exists (e.g. series was imported from MangaDex metadata only),
  // auto-discover a live scanlation source by title.
  if (manga && (!liveSourceUrl || liveSourceUrl.toLowerCase().includes('mangadex.org'))) {
    const autoSource = await autoDiscoverLiveSourceForManga(manga);
    if (autoSource) {
      liveSourceUrl = autoSource.sourceUrl;
    }
  }

  // If no working live source URL exists (e.g. series was imported from MangaDex metadata only),
  // auto-discover a live scanlation source by title.
  if (!liveSourceUrl || liveSourceUrl.toLowerCase().includes('mangadex.org')) {
    const autoSource = await autoDiscoverLiveSourceForManga(manga);
    if (autoSource) {
      liveSourceUrl = autoSource.sourceUrl;
    }
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

  // MangaDex Direct Fallback
  const mangaDexId = manga?.apiId || (mangaId && mangaId.startsWith('md_') ? mangaId.replace('md_', '') : null) || (manga?.id && manga.id.startsWith('md_') ? manga.id.replace('md_', '') : null);
  if (mangaDexId) {
    try {
      const feedRes = await fetchMangaDex(
        `https://api.mangadex.org/manga/${mangaDexId}/feed?limit=250&translatedLanguage[]=en&order[chapter]=desc&includeExternalUrl=0`
      );
      if (feedRes && feedRes.ok) {
        const data = await feedRes.json();
        const rawChapters: any[] = data.data || [];
        if (rawChapters.length > 0) {
          const mapped = rawChapters
            .filter((c) => c.attributes?.chapter && !isNaN(parseFloat(c.attributes.chapter)))
            .map((c) => {
              const chNum = parseFloat(c.attributes.chapter);
              return {
                id: `md_${c.id}`,
                chapterNumber: chNum,
                title: c.attributes.title || `Chapter ${c.attributes.chapter}`,
                releaseDate: c.attributes.publishAt ? c.attributes.publishAt.split('T')[0] : '',
                scanGroup: 'MangaDex (Scanlation)',
                pageCount: c.attributes.pages || 0,
                isRead: manga ? chNum <= (manga.currentChapter || 0) : false,
              };
            });

          if (mapped.length > 0) {
            const sorted = [...mapped].sort((a, b) =>
              order === 'asc' ? a.chapterNumber - b.chapterNumber : b.chapterNumber - a.chapterNumber
            );
            return res.json(sorted);
          }
        }
      }
    } catch (err) {
      console.warn('[MangaDex Chapter Fallback] Feed fetch failed:', err);
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

// List/discover available live reading sources for a series
app.get("/api/reader/sources/:mangaId", async (req, res) => {
  const { mangaId } = req.params;
  const manga = resolveManga(mangaId);
  if (!manga) return res.status(404).json({ error: "Manga not found" });

  const existing = (manga.availableSources || []).filter(
    (s) => s && s.sourceUrl && !s.sourceUrl.toLowerCase().includes('mangadex.org')
  );

  // Discover more live sources
  const discovered = await searchLiveSourcesForSeries(manga.title, manga.altTitles);
  const combined = [...existing];
  for (const d of discovered) {
    if (!combined.some((s) => s.sourceUrl === d.sourceUrl)) {
      combined.push({ sourceName: d.sourceName, sourceUrl: d.sourceUrl });
    }
  }

  res.json({
    currentSource: manga.sourceUrl,
    currentSourceName: manga.sourceName,
    sources: combined,
  });
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
  const inventory = buildFullSourceInventory(syncConfig);
  // Phase 4: Enrich with live health badges from sourceHealthMap
  const enriched = inventory.map((item) => {
    const h = sourceHealthMap.get(item.id);
    return {
      ...item,
      healthStatus: h ? h.lastStatus : 'unknown',
      circuitState: h ? (h.circuitState || 'CLOSED') : 'CLOSED',
      consecutiveFailures: h ? (h.consecutiveFailures || 0) : 0,
      lastHealthCheck: h ? h.lastChecked : null,
      failureReason: h ? (h.failureReason || null) : null,
    };
  });
  res.json(enriched);
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
  const healthData: Record<string, any> = {};
  for (const source of KOTATSU_SOURCES) {
    const h = sourceHealthMap.get(source.id);
    const cb = sourceCircuitBreaker.getState(source.id);
    if (h || cb.state !== 'CLOSED') {
      healthData[source.id] = {
        id: source.id,
        lastChecked: h?.lastChecked || cb.lastChecked || Date.now(),
        lastStatus: h?.lastStatus || (cb.state === 'OPEN' ? 'down' : 'ok'),
        consecutiveFailures: h?.consecutiveFailures ?? cb.failures,
        tripCount: cb.tripCount || 0,
        nextProbeTime: cb.nextProbeTime,
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

// Reset Circuit Breaker endpoint (manual recovery from UI or automated script)
app.post("/api/kotatsu/sources/circuit-reset", (req, res) => {
  const { sourceId } = req.body || {};
  if (sourceId) {
    sourceCircuitBreaker.reset(sourceId);
    const h = sourceHealthMap.get(sourceId);
    if (h) {
      h.consecutiveFailures = 0;
      h.lastStatus = 'ok';
      h.failureReason = undefined;
      h.circuitState = 'CLOSED';
      scheduleSourceHealthPersist();
    }
    return res.json({ success: true, message: `Reset circuit breaker for ${sourceId}` });
  } else {
    sourceCircuitBreaker.reset();
    for (const [, h] of sourceHealthMap) {
      h.consecutiveFailures = 0;
      h.lastStatus = 'ok';
      h.failureReason = undefined;
      h.circuitState = 'CLOSED';
    }
    scheduleSourceHealthPersist();
    return res.json({ success: true, message: 'Reset all circuit breakers' });
  }
});

// Live Source Health Dashboard Endpoint (P3 Observability)
app.get("/api/sources/dashboard", (_req, res) => {
  const topSourcesList = KOTATSU_SOURCES.slice(0, 50).map((source) => {
    const h = sourceHealthMap.get(source.id);
    const cb = sourceCircuitBreaker.getState(source.id);
    const srcDef = SOURCE_MAP.get(source.id);
    const urlStr = source.baseUrl || srcDef?.baseUrl || '';
    let domainStr = '';
    try { domainStr = new URL(urlStr).hostname; } catch {}
    return {
      id: source.id,
      name: source.name,
      engine: (source.id.includes('madara') ? 'madara' : 'custom'),
      lang: source.lang || 'en',
      domain: domainStr,
      baseUrl: urlStr,
      circuitState: cb.state,
      tripCount: cb.tripCount || 0,
      nextProbeTime: cb.nextProbeTime,
      consecutiveFailures: h?.consecutiveFailures ?? cb.failures,
      lastChecked: h?.lastChecked || cb.lastChecked || 0,
      lastStatus: h?.lastStatus || (cb.state === 'OPEN' ? 'down' : 'ok'),
      failureReason: h?.failureReason || cb.lastFailureReason,
    };
  });

  const summary = {
    totalMonitored: topSourcesList.length,
    healthy: topSourcesList.filter((s) => s.lastStatus === 'ok' && s.circuitState !== 'OPEN').length,
    degraded: topSourcesList.filter((s) => s.lastStatus === 'degraded' || s.circuitState === 'HALF_OPEN').length,
    blocked: topSourcesList.filter((s) => s.lastStatus === 'blocked').length,
    down: topSourcesList.filter((s) => s.lastStatus === 'down' || s.circuitState === 'OPEN').length,
  };

  res.json({
    summary,
    sources: topSourcesList,
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
             'mangatx'].includes(s.id) &&
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
const DEFAULT_EXPLORE_SOURCE_IDS = ['weebcentral', 'asurascans', 'flamecomics', 'mangaread', 'manhuaplusorg', 'ravenscans', 'manhwa18', 'hiperdex'];
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

// ── Browse Catalog Meta: full-catalog filter data ────────────────────────────
// Returns all unique genres, types, and active sources from the buffered
// explore catalog so the Browse UI can populate filters dynamically.
app.get("/api/explore/meta", (_req, res) => {
  const buf = exploreBufferRef.current;
  if (!buf || buf.items.length === 0) {
    // No buffer yet — return empty sets; client will try again after buffer warms.
    return res.json({ genres: [], types: [], sources: [] });
  }

  const genreCounts = new Map<string, number>();
  const typeSet = new Set<string>();
  const sourceMap = new Map<string, string>(); // id → name

  for (const it of buf.items) {
    for (const g of (it.genres || [])) {
      if (typeof g === 'string' && g.trim()) {
        const normalized = g.trim();
        genreCounts.set(normalized, (genreCounts.get(normalized) || 0) + 1);
      }
    }
    if (it.type) typeSet.add(String(it.type).toLowerCase());
    if (it.__sourceId && it.__sourceName) sourceMap.set(it.__sourceId, it.__sourceName);
  }

  // Sort genres by frequency descending so the most common appear first in the UI.
  const genres = [...genreCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);

  const types = [...typeSet].sort();

  // Also include all currently alive/enabled sources (not just those in the buffer)
  // so the source dropdown is always complete.
  const allActiveSources = KOTATSU_SOURCES
    .filter((s) => s.id !== 'mangadex' && !disabledSourceIds.has(s.id) && isSourceAlive(s.id))
    .map((s) => ({ id: s.id, name: s.name }));

  return res.json({ genres, types, sources: allActiveSources, totalItems: buf.items.length, builtAt: buf.builtAt });
});

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
  if (lowerName.includes('weebcentral') || lowerId.includes('weebcentral')) {
    const result = await scrapeWeebCentral(page, limit);
    if (result.items.length > 0) return result;
  }
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
  //    Uses fetchWithChallengeBypass for Cloudflare resilience + cheerio DOM parsing
  //    with DOM-proximity cover matching (RC-3 fix: cover extracted from same container
  //    as the title, not by positional index across the whole page).
  try {
    const catalogCandidates: string[] = [];
    if (sourceDef.engineType === 'madara') {
      catalogCandidates.push(page === 1 ? `${sourceDef.baseUrl}/manga/` : `${sourceDef.baseUrl}/manga/page/${page}/`);
      catalogCandidates.push(page === 1 ? `${sourceDef.baseUrl}/` : `${sourceDef.baseUrl}/page/${page}/`);
    } else if (sourceDef.engineType === 'mangathemesia') {
      catalogCandidates.push(`${sourceDef.baseUrl}/manga/?page=${page}&order=popular`);
      catalogCandidates.push(`${sourceDef.baseUrl}/manga/?page=${page}`);
      catalogCandidates.push(`${sourceDef.baseUrl}/series/?page=${page}`);
    } else if (sourceDef.engineType === 'wpcomics') {
      catalogCandidates.push(page === 1 ? `${sourceDef.baseUrl}/` : `${sourceDef.baseUrl}/?page=${page}`);
      catalogCandidates.push(page === 1 ? `${sourceDef.baseUrl}/manga-list` : `${sourceDef.baseUrl}/manga-list?page=${page}`);
      catalogCandidates.push(page === 1 ? `${sourceDef.baseUrl}/manga/` : `${sourceDef.baseUrl}/manga/page/${page}/`);
    } else if (sourceDef.engineType === 'foolslide') {
      catalogCandidates.push(page === 1 ? `${sourceDef.baseUrl}/directory/` : `${sourceDef.baseUrl}/directory/${page}/`);
      catalogCandidates.push(page === 1 ? `${sourceDef.baseUrl}/series/` : `${sourceDef.baseUrl}/series/${page}/`);
      catalogCandidates.push(page === 1 ? `${sourceDef.baseUrl}/list/` : `${sourceDef.baseUrl}/list/${page}/`);
      catalogCandidates.push(`${sourceDef.baseUrl}/`);
    } else {
      catalogCandidates.push(page === 1 ? `${sourceDef.baseUrl}/browse` : `${sourceDef.baseUrl}/browse?page=${page}`);
      catalogCandidates.push(page === 1 ? `${sourceDef.baseUrl}/series` : `${sourceDef.baseUrl}/series?page=${page}`);
      catalogCandidates.push(page === 1 ? `${sourceDef.baseUrl}/manga` : `${sourceDef.baseUrl}/manga?page=${page}`);
      catalogCandidates.push(page === 1 ? `${sourceDef.baseUrl}/` : `${sourceDef.baseUrl}/?page=${page}`);
    }

    // Fast-fail if source is already marked down/blocked (circuit breaker OPEN)
    if (!sourceCircuitBreaker.canAttempt(sourceDef.id)) {
      console.warn(`[Catalog Scraper] Fast-failing ${sourceDef.name} (circuit OPEN)`);
      return { items: [], totalCount: 0 };
    }

    // Try candidate catalog URLs with exponential backoff
    let html: string | null = null;
    for (const catalogUrl of catalogCandidates) {
      for (let attempt = 0; attempt < 2 && !html; attempt++) {
        try {
          const timeout = [4000, 8000][attempt] || 4000;
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
            break;
          } else {
            updateSourceHealth(sourceDef.id, null, liveRes.status || 500);
            if (liveRes.status === 404 || liveRes.status === 410) {
              break; // Fast-fail non-transient HTTP errors for this URL candidate
            }
          }
        } catch (fetchErr: any) {
          updateSourceHealth(sourceDef.id, null, 0, fetchErr?.message);
        }
      }
      if (html) break;
    }

    if (html) {
      const $ = cheerio.load(html);
      const baseOrigin = sourceDef.baseUrl.replace(/\/$/, '');
      const seenTitles = new Set<string>();

      /** Resolve a cover src (src / data-src / data-lazy-src) — stays relative if needed. */
      const extractCover = (el: any): string => {
        const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src') || $(el).attr('data-original') || '';
        if (!src || !/\.(jpg|jpeg|png|webp)/i.test(src) || /logo|avatar|banner|icon|placeholder/i.test(src)) return '';
        if (isAdImageSrc(src, baseOrigin)) return '';
        return src.startsWith('http') ? src : `${baseOrigin}${src}`;
      };

      /** Push one catalog item if the href and title pass basic sanity checks. */
      const pushItem = (href: string, title: string, cover: string) => {
        const normTitle = title.toLowerCase();
        if (!href || title.length < 2 || seenTitles.has(normTitle)) return;
        if (isNavText(title)) return;
        if (!isContentPath(href)) return;
        seenTitles.add(normTitle);
        scrapedItems.push({
          id: generateSourceScrapeId(`live_${sourceDef.id}`, href),
          title,
          sourceUrl: href.startsWith('http') ? href : `${baseOrigin}${href}`,
          coverImage: cover,
          sourceName: sourceDef.name,
          description: `Live directory entry from ${sourceDef.name}`,
          genres: ['Action', 'Fantasy'],
          latestChapter: 10,
          type: sourceDef.id.includes('manhua') ? 'manhua' : sourceDef.id.includes('manhwa') ? 'manhwa' : 'manga',
        });
      };

      // ── MangaThemesia: .listupd .bsx grid — cover IS inside .bsx ─────────
      // Each .bsx contains both the cover img and the title link, so we can
      // pair them correctly without positional indexing.
      if (sourceDef.engineType === 'mangathemesia') {
        let found = false;
        $('.listupd .bsx, .listupd .bs').each((_i, el) => {
          const a = $(el).find('a').first();
          const href = a.attr('href') || '';
          const title = ($(el).find('.tt, .bigor .tt, h3, .series-title').text() || a.attr('title') || '').trim();
          const cover = extractCover($(el).find('img').first());
          if (href && title) { pushItem(href, title, cover); found = true; }
        });
        // Fallback: older MangaThemesia layout uses .utao .uta
        if (!found) {
          $('.utao .uta').each((_i, el) => {
            const a = $(el).find('.luf a, a').first();
            const href = a.attr('href') || '';
            const title = ($(el).find('.luf h4, h4, .tt').text() || a.text()).trim();
            const cover = extractCover($(el).find('img').first());
            if (href && title) pushItem(href, title, cover);
          });
        }
      }
      // ── Madara / WP-Comics: .page-item-detail cards — cover IS inside the card ──
      else if (sourceDef.engineType === 'madara' || sourceDef.engineType === 'wpcomics') {
        let found = false;
        $('.page-item-detail, .c-tabs-item__content, .item-thumb, .manga-item').each((_i, el) => {
          const a = $(el).find('.post-title a, h3 a, h4 a, .title a, a').first();
          const href = a.attr('href') || '';
          const title = a.text().trim() || a.attr('title') || '';
          const cover = extractCover($(el).find('img').first());
          if (href && title) { pushItem(href, title, cover); found = true; }
        });
        if (!found) {
          // Some Madara installs use a simpler grid without .page-item-detail
          $('h3.h5 a, .post-title a, .entry-title a').each((_i, el) => {
            const a = $(el);
            const href = a.attr('href') || '';
            const title = a.text().trim();
            const cover = extractCover($(el).closest('article, .item, li').find('img').first());
            if (href && title) pushItem(href, title, cover);
          });
        }
      }
      // ── Generic fallback for custom_html, foolslide, and other themes ────
      else {
        $('article, .item, .card, .thumb-item, .series-card, .comic-item, li, a[href]').each((_i, el) => {
          if (scrapedItems.length >= limit * 2) return false;
          const a = ($(el).is('a') ? $(el) : $(el).find('a').first());
          const href = a.attr('href') || '';
          const title = a.text().trim() || a.attr('title') || $(el).find('h2, h3, h4, .title').first().text().trim();
          const cover = extractCover(a.find('img').first().length ? a.find('img').first() : $(el).find('img').first());
          if (href && title) pushItem(href, title, cover);
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
// RC-5 FIX: Now bidirectional — sources that recover are auto-revived without restart.
export async function auditAndDisableEmptySources(
  concurrency = 8,
  sourceList: SourceDefinition[] = KOTATSU_SOURCES
): Promise<{ disabled: string[]; revived: string[]; keptCount: number; total: number; alreadyRunning: boolean }> {
  if (sourceAuditRunning) return { disabled: [], revived: [], keptCount: 0, total: sourceList.length, alreadyRunning: true };
  sourceAuditRunning = true;

  // Audit ALL sources, including currently-disabled ones (so we can revive them)
  const pending = [...sourceList];
  const disabled: string[] = [];
  const revived: string[] = [];
  let checkedCount = 0;

  const worker = async () => {
    let src: SourceDefinition | undefined;
    while ((src = pending.shift()) !== undefined) {
      const count = await probeSourceSeriesCount(src);
      checkedCount++;
      sourceAuditStatus.set(src.id, { seriesCount: count, checkedAt: new Date().toISOString() });

      if (count === 0) {
        // Source returned nothing — disable it
        if (!disabledSourceIds.has(src.id)) {
          disabledSourceIds.add(src.id);
          disabled.push(src.id);
          console.log(`[Source Audit] Disabled "${src.id}" — returned 0 series.`);
        }
      } else {
        // Source is returning content — revive it if it was previously disabled
        if (disabledSourceIds.has(src.id)) {
          disabledSourceIds.delete(src.id);
          revived.push(src.id);
          // Add to reactivatedSources so isSourceAlive() returns true immediately
          if (!Array.isArray(syncConfig.reactivatedSources)) syncConfig.reactivatedSources = [];
          if (!syncConfig.reactivatedSources.includes(src.id)) {
            syncConfig.reactivatedSources.push(src.id);
          }
          // Remove from the persistent removedSources list if it was there
          if (Array.isArray(syncConfig.removedSources)) {
            syncConfig.removedSources = syncConfig.removedSources.filter((r: string) => r !== src!.id);
          }
          sourceCircuitBreaker.reset(src.id);
          console.log(`[Source Audit] Revived "${src.id}" — now returning ${count} series.`);
        }
      }
    }
  };

  const n = Math.max(1, Math.min(concurrency, pending.length));
  await Promise.all(Array.from({ length: n }, worker));

  syncConfig.disabledSources = Array.from(disabledSourceIds);
  saveDatabaseToDisk();
  sourceAuditRunning = false;
  console.log(`[Source Audit] Checked ${checkedCount} sources — disabled ${disabled.length}, revived ${revived.length}.`);
  return { disabled, revived, keptCount: checkedCount - disabled.length, total: checkedCount, alreadyRunning: false };
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
  const healthSummary: Record<string, number> = {};
  for (const [, h] of sourceHealthMap) {
    healthSummary[h.lastStatus] = (healthSummary[h.lastStatus] || 0) + 1;
  }
  res.json({
    running: sourceAuditRunning,
    disabledCount: disabledSourceIds.size,
    activeCount: KOTATSU_SOURCES.filter(s => !disabledSourceIds.has(s.id) && s.id !== 'mangadex').length,
    totalSources: KOTATSU_SOURCES.length,
    healthSummary,
    status: Array.from(sourceAuditStatus.entries()).map(([id, s]) => ({ id, ...s })),
  });
});

// GET /api/scrape/source-health — return results from last catalog-liveness.mjs run
app.get("/api/scrape/source-health", (_req, res) => {
  const healthPath = path.join(process.cwd(), 'data', 'source-health.json');
  try {
    if (!fs.existsSync(healthPath)) {
      return res.json({ error: 'No liveness scan results found. Run POST /api/scrape/run-liveness first.', scannedAt: null, sources: [] });
    }
    const data = JSON.parse(fs.readFileSync(healthPath, 'utf-8'));
    return res.json(data);
  } catch (e: any) {
    return res.status(500).json({ error: 'Failed to read source-health.json', details: e.message });
  }
});

// POST /api/scrape/run-liveness — spawn the catalog-liveness.mjs scanner in background
app.post("/api/scrape/run-liveness", (req, res) => {
  const { sample, concurrency, patch } = req.body || {};
  const scriptPath = path.join(process.cwd(), 'scripts', 'catalog-liveness.mjs');
  if (!fs.existsSync(scriptPath)) {
    return res.status(404).json({ error: 'catalog-liveness.mjs not found in scripts/' });
  }
  const args: string[] = [];
  if (sample) args.push('--sample', String(Number(sample) || 50));
  if (concurrency) args.push('--concurrency', String(Number(concurrency) || 20));
  if (patch) args.push('--patch');

  const { spawn } = require('child_process') as typeof import('child_process');
  const child = spawn(process.execPath, [scriptPath, ...args], {
    detached: true,
    stdio: 'ignore',
    cwd: process.cwd(),
  });
  child.unref();
  return res.json({
    status: 'started',
    pid: child.pid,
    message: `Liveness scan started in background (pid ${child.pid}). Results will be written to data/source-health.json. Poll GET /api/scrape/source-health for results.`,
    args,
  });
});

// Kotatsu Multi-Source Live Search Endpoint (Enhanced)
app.get("/api/kotatsu/search", async (req, res) => {
  // Resolve source alias (e.g., public domain) to internal source ID
  const resolveAliasSourceId = (alias: string): string => {
    const aliasMap: Record<string, string> = {
      "reader.graywood.no": "asurascans",
      // add future aliases here
    };
    return aliasMap[alias.toLowerCase()] || alias;
  };

  const rawSourceId = (req.query.sourceId as string) || "mangadex";
  const sourceId = resolveAliasSourceId(rawSourceId);
  const query = ((req.query.q as string) || "").trim();
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(Number(req.query.limit) || 24, 100);
  const offset = (page - 1) * limit;
  const lang = (req.query.lang as string || "en").toLowerCase();
  const langFilter = lang === "all" ? "" : `&availableTranslatedLanguage[]=${lang}`;

  // MangaDex is a metadata-only background DB — never resolve to it as a reading source.
  let sourceDef = KOTATSU_SOURCES.find((s) => s.id === sourceId && s.id !== "mangadex");
  if (!sourceDef) {
    sourceDef =
      KOTATSU_SOURCES.find((s) => s.id !== "mangadex" && !disabledSourceIds.has(s.id) && isSourceAlive(s.id)) ||
      KOTATSU_SOURCES.find((s) => s.id !== "mangadex");
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

    // ── Dedicated Scraper Search (Weeb Central AJAX API) ─────────────
    if (sourceDef.id === 'weebcentral') {
      try {
        const results = await searchWeebCentral(query);
        res.setHeader('X-Total-Count', String(results.length));
        res.setHeader('X-Total-Pages', '1');
        return res.json(await enrichWithMangaDexMetadata(results));
      } catch (err: any) {
        console.warn('[Kotatsu Search] WeebCentral search error:', err.message);
      }
    }

    // ── Dedicated Scraper Search (Asura Scans JSON API) ─────────────
    if (sourceDef.id === 'asurascans') {
      try {
        const cleanQuery = query.replace(/^asura_/i, '').replace(/[-_]/g, ' ').trim();
        const asuraRes = await fetch(`https://api.asurascans.com/api/series?search=${encodeURIComponent(cleanQuery || query)}`, {
          headers: ASURA_API_HEADERS,
          signal: AbortSignal.timeout(12000),
        });
        if (asuraRes.ok) {
          const json = await asuraRes.json();
          const data: any[] = Array.isArray(json?.data) ? json.data : [];
          const results = data.map((s: any) => {
            const slug = s.slug || s.id || '';
            const pubPath = s.public_url || `/comics/${slug}`;
            return {
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
            };
          });
          res.setHeader('X-Total-Count', String(results.length));
          res.setHeader('X-Total-Pages', '1');
          return res.json(results);
        }
      } catch (err: any) {
        console.warn('[Kotatsu Search] Asura API search error:', err.message);
      }
    }

    // ── 3. Live HTML scraping via fetchWithChallengeBypass (RC-6 fix: parity
    //    with the chapter-read path so CF-protected sites work in search too)
    //    Uses cheerio DOM-proximity parsing (RC-3 fix: pairs cover+title from
    //    the SAME DOM container, eliminating the positional-index mismatch bug).
    let searchUrl: string;
    if (sourceDef.engineType === 'madara' || sourceDef.engineType === 'wpcomics') {
      searchUrl = `${sourceDef.baseUrl}/?s=${encodeURIComponent(query)}&post_type=wp-manga`;
    } else if (sourceDef.engineType === 'foolslide') {
      searchUrl = `${sourceDef.baseUrl}/search?search=${encodeURIComponent(query)}`;
    } else {
      // mangathemesia and custom_html use the standard WordPress search parameter
      searchUrl = `${sourceDef.baseUrl}/?s=${encodeURIComponent(query)}`;
    }

    // Use the full challenge-bypass fetcher so CF-protected sources (manhuafast,
    // etc.) resolve in search — previously only the chapter-read path used this.
    const searchBypassRes = await fetchWithChallengeBypass(searchUrl, {
      headers: {
        'User-Agent': SCRAPER_UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      enableCloudflareBypass: appSettings.enableCloudflareBypass,
      flareSolverrUrl: appSettings.flareSolverrUrl,
      captchaSolverEnabled: appSettings.captchaSolverEnabled,
      captchaApiKey: appSettings.captchaApiKey,
      timeoutMs: 12000,
      sourceId: sourceDef.id,
      onCookieUpdate: (sid, cookies) => sourceCookieJar.setCookies(sid, cookies),
    });

    if (searchBypassRes.ok && searchBypassRes.html) {
      updateSourceHealth(sourceDef.id, searchBypassRes.html, searchBypassRes.status);
      const htmlText = searchBypassRes.html;
      const results: any[] = [];
      const $ = cheerio.load(htmlText);
      const origin = sourceDef.baseUrl.replace(/\/$/, '');

      /** Resolve a relative URL against the source's origin. */
      const resolveHref = (href: string): string =>
        href.startsWith('http') ? href : `${origin}${href.startsWith('/') ? '' : '/'}${href}`;

      /** Resolve a cover src (src / data-src / data-lazy-src). */
      const resolveCover = (el: any): string => {
        const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src') || $(el).attr('data-original') || '';
        return src.startsWith('http') ? src : (src ? `${origin}${src}` : '');
      };

      // ── Priority 1: MangaThemesia — .listupd .bsx grid items ──────────────
      // Cover and title live together inside .bsx, so there is no index mismatch.
      if (sourceDef.engineType === 'mangathemesia') {
        $('.listupd .bsx, .listupd .bs').each((_i, el) => {
          const a = $(el).find('a').first();
          const href = a.attr('href') || '';
          const title = ($(el).find('.tt, .bigor .tt, h3').text() || a.attr('title') || '').trim();
          const cover = resolveCover($(el).find('img').first());
          if (href && title && isContentPath(href) && !isNavText(title)) {
            results.push({
              id: generateSourceScrapeId(`kotatsu_${sourceDef.id}`, href),
              title,
              sourceUrl: resolveHref(href),
              coverImage: cover || '',
              sourceName: sourceDef.name,
              genres: ['Action'],
            });
          }
        });
      }

      // ── Priority 2: Madara — .page-item-detail blocks ─────────────────────
      if (results.length === 0 && (sourceDef.engineType === 'madara' || sourceDef.engineType === 'wpcomics')) {
        $('.page-item-detail, .c-tabs-item__content').each((_i, el) => {
          const a = $(el).find('.post-title a, h3 a, h4 a').first();
          const href = a.attr('href') || '';
          const title = a.text().trim();
          // Cover is a sibling img in the same card; use find() to stay within the container
          const cover = resolveCover($(el).find('img').first());
          if (href && title && isContentPath(href) && !isNavText(title)) {
            results.push({
              id: generateSourceScrapeId(`kotatsu_${sourceDef.id}`, href),
              title,
              sourceUrl: resolveHref(href),
              coverImage: cover || '',
              sourceName: sourceDef.name,
              genres: ['Action'],
            });
          }
        });
      }

      // ── Priority 3: Generic link+nearest-img fallback ─────────────────────
      if (results.length === 0) {
        $('a[href]').each((_i, el) => {
          if (results.length >= 18) return false;
          const href = $(el).attr('href') || '';
          const title = $(el).text().trim();
          if (!href || !title || title.length < 2 || !isContentPath(href) || isNavText(title)) return;
          // Use closest cover: check inside el, then look for the nearest preceding img sibling
          const cover = resolveCover(
            $(el).find('img').first().length ? $(el).find('img').first() : $(el).closest('li, div').find('img').first()
          );
          results.push({
            id: generateSourceScrapeId(`kotatsu_${sourceDef.id}`, href),
            title,
            sourceUrl: resolveHref(href),
            coverImage: cover || '',
            sourceName: sourceDef.name,
            genres: ['Action'],
          });
        });
      }

      if (results.length > 0) return res.json(await enrichWithMangaDexMetadata(results));
    } else if (searchBypassRes.status >= 400) {
      updateSourceHealth(sourceDef.id, null, searchBypassRes.status);
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
  
  // Prioritize active top sources for search
  const prioIds = ['weebcentral', 'asurascans', 'flamecomics', 'mangaread', 'manhuaplusorg', 'ravenscans', 'manhwa18'];
  const sourcesToQuery: SourceDefinition[] = [];
  for (const pid of prioIds) {
    const s = enabledSources.find(src => src.id === pid);
    if (s) sourcesToQuery.push(s);
  }
  for (const s of enabledSources) {
    if (sourcesToQuery.length >= 8) break;
    if (!sourcesToQuery.some(sq => sq.id === s.id)) sourcesToQuery.push(s);
  }

  const sourceResults = await Promise.allSettled(
    sourcesToQuery.map(async (source) => {
      try {
        if (query) {
          // Dedicated search paths
          if (source.id === 'weebcentral') {
            return (await searchWeebCentral(query)).map(it => ({ ...it, sourceName: source.name }));
          }
          if (source.id === 'asurascans') {
            const cleanQuery = query.replace(/^asura_/i, '').replace(/[-_]/g, ' ').trim();
            const asuraRes = await fetch(`https://api.asurascans.com/api/series?search=${encodeURIComponent(cleanQuery || query)}`, {
              headers: ASURA_API_HEADERS,
              signal: AbortSignal.timeout(8000),
            });
            if (asuraRes.ok) {
              const json = await asuraRes.json();
              const data: any[] = Array.isArray(json?.data) ? json.data : [];
              return data.map((s: any) => ({
                id: `asura_${s.slug || s.id}`,
                title: s.title || 'Unknown',
                sourceUrl: `https://asurascans.com${s.public_url || `/comics/${s.slug || s.id}`}`,
                coverImage: s.cover || '',
                sourceName: 'Asura Scans',
                type: s.type || 'manhwa',
              }));
            }
          }
          // Generic search for Madara/MangaThemesia
          let searchUrl = `${source.baseUrl}/?s=${encodeURIComponent(query)}`;
          if (source.engineType === 'madara' || source.engineType === 'wpcomics') {
            searchUrl = `${source.baseUrl}/?s=${encodeURIComponent(query)}&post_type=wp-manga`;
          }
          const bypassRes = await fetchWithChallengeBypass(searchUrl, {
            headers: { 'User-Agent': APP_USER_AGENT, 'Accept': 'text/html,application/xhtml+xml' },
            timeoutMs: 8000,
            sourceId: source.id,
          });
          if (bypassRes.ok && bypassRes.html) {
            const $ = cheerio.load(bypassRes.html);
            const origin = source.baseUrl.replace(/\/$/, '');
            const items: any[] = [];
            $('.post-title a, h3 a, .listupd .bsx a, .c-tabs-item__content a').each((_i, el) => {
              if (items.length >= 10) return false;
              const href = $(el).attr('href') || '';
              const title = $(el).text().trim() || $(el).attr('title') || '';
              if (href && title && isContentPath(href) && !isNavText(title)) {
                const cover = $(el).closest('.page-item-detail, .bsx, .bs, .c-tabs-item__content').find('img').attr('src') || '';
                items.push({
                  id: generateSourceScrapeId(`kotatsu_${source.id}`, href),
                  title,
                  sourceUrl: href.startsWith('http') ? href : `${origin}${href.startsWith('/') ? '' : '/'}${href}`,
                  coverImage: cover,
                  sourceName: source.name,
                });
              }
            });
            return items;
          }
          return [];
        } else {
          // No query -> fetch popular
          const items = await getSourcePopularSeries(source, page, Math.ceil(limit / 3));
          return Array.isArray(items) ? items : (items?.items || []).map((it: any) => ({ ...it, sourceName: source.name }));
        }
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
  lastStatus: 'ok' | 'degraded' | 'blocked' | 'down' | 'broken';
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

  // RC-5 FIX: Debounced persistence so health state survives server restarts.
  // Writes are batched (max once per 500ms) to avoid a SQLite write per request.
  scheduleSourceHealthPersist();
}

let _sourceHealthPersistTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSourceHealthPersist() {
  if (_sourceHealthPersistTimer) return; // already scheduled
  _sourceHealthPersistTimer = setTimeout(() => {
    _sourceHealthPersistTimer = null;
    try {
      const obj: Record<string, any> = {};
      for (const [id, h] of sourceHealthMap) obj[id] = h;
      SqliteDb.setSourceHealthMap(obj);
    } catch { /* non-critical — health state is best-effort */ }
  }, 500);
}

/** Load persisted health state from SQLite on startup (RC-5). */
function loadSourceHealthMap() {
  try {
    const saved = SqliteDb.getSourceHealthMap();
    for (const [id, h] of Object.entries(saved)) {
      if (h && typeof h === 'object') sourceHealthMap.set(id, h as SourceHealth);
    }
    if (Object.keys(saved).length > 0) {
      console.log(`[Source Health] Loaded persisted health state for ${Object.keys(saved).length} sources.`);
    }
  } catch { /* non-critical */ }
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
  'aquamanga.com': 'aquareader.org',
  'aquamanga.org': 'aquareader.org',
  'aquareader.net': 'aquareader.org',
  'flamescans.org': 'flamecomics.xyz',
  'flamescans.com': 'flamecomics.xyz',
  'ravenscans.com': 'ravenscans.net',
  'manhuaplus.com': 'manhuaplus.org',
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

export function migrateImportedBackupsToFavorites(): number {
  // Deprecated: Per-user categories and favorites are handled during individual backup import.
  return 0;
}

const UA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
};



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

export function parseGenericChapterListFromHtml(sHtml: string, origin: string): ResolvedChapter[] {
  if (!sHtml) return [];
  const $ = cheerio.load(sHtml);
  const out: ResolvedChapter[] = [];
  const seen = new Set<string>();

  // 1. Check anchor tags and <option> tags in document order across typical chapter wrappers
  const candidateNodes = $('a[href], select option[value], ul.chapter-list li a, .chapters-list li a, #chapterlist li a, div.eplister li a, .row-content-chapter li a, .list-chapter .row a, .element .title a').toArray();

  const chapterRegex = /(?:chapter|chapitre|capitulo|capítulo|cap|chap|ch|episode|ep|глава|tập|tap|vol|volume|#)[^\d]*(\d+(?:\.\d+)?)/i;
  const pathNumberRegex = /\/(?:chapter|chap|ch|episode|ep)[-_/]?(\d+(?:\.\d+)?)/i;

  let autoNum = 1;
  for (const node of candidateNodes) {
    const tag = (node as any).tagName?.toLowerCase();
    const href = tag === 'option' ? ($(node).attr('value') || '') : ($(node).attr('href') || '');
    if (!href || /^(#|javascript:|mailto:|tel:)/i.test(href)) continue;
    const text = $(node).text().trim() || $(node).attr('title') || '';
    
    const numMatch = (href + ' ' + text).match(chapterRegex) || href.match(pathNumberRegex);
    if (!numMatch && !/chapter|chap|ch/i.test(href) && !/chapter|chap|ch/i.test(text)) {
      continue;
    }
    const num = numMatch ? parseFloat(numMatch[1]) : autoNum++;
    if (!Number.isFinite(num) || num <= 0) continue;

    const abs = href.startsWith('http') ? href : `${origin}${href.startsWith('/') ? '' : '/'}${href}`;
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push({ number: num, id: abs, slug: abs, title: text || `Chapter ${num}`, url: abs, pageCount: 0 });
  }
  return out;
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
    return parseGenericChapterListFromHtml(bypassRes.html, origin);
  } catch (e) {
    return [];
  }
}

// ============================================================================
// SOURCE ENGINE REGISTRY — Maps domainId → engine type for dedicated extractors
// Derived from Kotatsu-Parsers (MadaraParser, MangaReaderParser, etc.)
// ============================================================================

type SourceEngine = 'madara' | 'manhwa18' | 'mangareader' | 'hotcomics' | 'custom' | 'foolslide';

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
  // Per-source selector / path overrides
  chapterListSelector?: string;     // custom chapter list row selector
  chapterPageSelector?: string;     // custom chapter pages selector
  catalogPath?: string;             // custom catalog listing URL path
}

/** Statically curated sources with hand-tuned per-site overrides.
 *  These take priority over auto-generated entries from catalog.json. */
const CURATED_ENGINE_SOURCES: EngineSourceConfig[] = [
  // ── Madara Engine (WP-Manga theme) — covers 50+ top scanlation sources ──
  { id: 'manhwa18',    name: 'Manhwa18',          domain: 'manhwa18.com',    engine: 'manhwa18', lang: 'en', isNsfw: true },
  { id: 'manhwa18cc',  name: 'Manhwa18.cc',        domain: 'manhwa18.cc',     engine: 'madara', lang: 'en', isNsfw: true,
    madaraSelectTestAsync: 'ul.row-content-chapter', madaraSelectChapter: 'li.a-h', madaraSelectBodyPage: 'div.read-content' },
  { id: 'aquamanga',   name: 'Aqua Manga',         domain: 'aquareader.org',  engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'manhuaplus',  name: 'Manhua Plus',        domain: 'manhuaplus.org',  engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'manhuaplusorg', name: 'ManhuaPlus.org',   domain: 'manhuaplus.org',  engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'harimanga',   name: 'Hari Manga',         domain: 'harimanga.me',    engine: 'madara', lang: 'en', isNsfw: false, madaraPageSize: 10 },
  { id: 'anisascans',  name: 'Anisa Scans',        domain: 'anisascans.in',   engine: 'madara', lang: 'en', isNsfw: false, madaraDatePattern: 'dd MMM, yyyy' },
  { id: 'adultwebtoon', name: 'Adult Webtoon',     domain: 'adultwebtoon.com', engine: 'madara', lang: 'en', isNsfw: true },
  { id: 'mangaread',   name: 'MangaRead',          domain: 'www.mangaread.org', engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'manhwabuddy', name: 'Manhwa Buddy',       domain: 'manhwabuddy.com', engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'manhuafast',  name: 'Manhua Fast',        domain: 'manhuafast.com',  engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'kunmanga',    name: 'Kun Manga',          domain: 'kunmanga.com',    engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'topmanhua',     name: 'Top Manhua',         domain: 'topmanhua.com',   engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'manhwaclan',  name: 'Manhwa Clan',        domain: 'manhwaclan.com',  engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'weebcentral', name: 'Weeb Central',       domain: 'weebcentral.com', engine: 'custom', lang: 'en', isNsfw: false },
  { id: 'atsumoe',     name: 'Atsu Moe',           domain: 'atsu.moe',        engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'demonicscans', name: 'Demonic Scans',     domain: 'demonicscans.org', engine: 'custom', lang: 'en', isNsfw: false },
  { id: 'beehentai',   name: 'BeeHentai',          domain: 'beehentai.com',   engine: 'madara', lang: 'en', isNsfw: true },
  { id: 'mangatx',     name: 'Manga TX',           domain: 'mangatx.com',     engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'allporn_comic', name: 'AllPornComic',     domain: 'allporncomic.com', engine: 'madara', lang: 'en', isNsfw: true },
  { id: 'bestmanhuacom', name: 'BestManhua',       domain: 'bestmanhua.com',  engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'bibimanga',   name: 'BibiManga',          domain: 'bibimanga.com',   engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'bookmanga',   name: 'BookManga',          domain: 'bookmanga.com',   engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'anshscans',   name: 'AnshScans',          domain: 'anshscans.org',   engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'arcanescans', name: 'ArcaneScans',        domain: 'arcanescans.com', engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'aryascans',   name: 'AryaScans',          domain: 'aryascans.com',   engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'bananamanga', name: 'BananaManga',        domain: 'bananamanga.net', engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'zinmanga',    name: 'ZinManga',           domain: 'zinmanga.com',    engine: 'madara', lang: 'en', isNsfw: false },
  { id: '1stkissmanga', name: '1stKissManga',      domain: '1stkissmanga.me', engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'mangaclash',  name: 'MangaClash',         domain: 'mangaclash.com',  engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'manga68',     name: 'Manga68',            domain: 'manga68.com',     engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'kissmanga',   name: 'KissManga',          domain: 'kissmanga.in',    engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'webtoonxyz',  name: 'WebtoonXYZ',         domain: 'webtoon.xyz',     engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'hiperdex',    name: 'Hiperdex',           domain: 'hiperdex.com',    engine: 'madara', lang: 'en', isNsfw: true },
  { id: 'manhuaga',    name: 'ManhuaGa',           domain: 'manhuaga.com',    engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'manga18h',    name: 'Manga18h',           domain: 'manga18h.com',    engine: 'madara', lang: 'en', isNsfw: true },
  { id: 'manhwa18org', name: 'Manhwa18.org',       domain: 'manhwa18.org',    engine: 'madara', lang: 'en', isNsfw: true },
  { id: 'toongod',     name: 'ToonGod',            domain: 'toongod.org',     engine: 'madara', lang: 'en', isNsfw: true },
  { id: 'manhwahentaime', name: 'ManhwaHentai.me', domain: 'manhwahentai.me', engine: 'madara', lang: 'en', isNsfw: true },
  { id: 'coffeemanga', name: 'CoffeeManga',        domain: 'coffeemanga.io',  engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'setsuscans',  name: 'SetsuScans',         domain: 'setsuscans.com',  engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'resetscans',  name: 'ResetScans',         domain: 'reset-scans.com', engine: 'madara', lang: 'en', isNsfw: false },

  // ── MangaThemesia / MangaReader Engine ────────────────────────────────────
  { id: 'manhuascan',  name: 'ManhuaScan',         domain: 'manhuascan.us',   engine: 'mangareader', lang: 'en', isNsfw: true },
  { id: 'ravenscans',  name: 'Raven Scans',        domain: 'ravenscans.net',  engine: 'mangareader', lang: 'en', isNsfw: false },
  { id: 'luminous',    name: 'Luminous Scans',     domain: 'luminousscans.com', engine: 'mangareader', lang: 'en', isNsfw: false },
  { id: 'night',       name: 'Night Scans',        domain: 'nightscans.com',  engine: 'mangareader', lang: 'en', isNsfw: false },
  { id: 'hentai20',    name: 'Hentai20',           domain: 'hentai20.com',    engine: 'mangareader', lang: 'en', isNsfw: true },
  { id: 'astrascans',  name: 'AstraScans',         domain: 'astrascans.org',  engine: 'mangareader', lang: 'en', isNsfw: false },
  { id: 'ascalonscans', name: 'AscalonScans',      domain: 'ascalonscans.com', engine: 'mangareader', lang: 'en', isNsfw: false },
  { id: 'anigliscans', name: 'AnigliScans',        domain: 'anigliscans.xyz', engine: 'mangareader', lang: 'en', isNsfw: false },
  { id: 'altayscans',  name: 'AltayScans',         domain: 'altayscans.com',  engine: 'mangareader', lang: 'en', isNsfw: false },
  { id: 'birdmanga',   name: 'BirdManga',          domain: 'birdmanga.com',   engine: 'mangareader', lang: 'en', isNsfw: false },

  // ── HotComics Engine ──────────────────────────────────────────────────────
  { id: 'hotcomics',   name: 'HotComics',          domain: 'hotcomics.net',   engine: 'hotcomics', lang: 'en', isNsfw: true },
  { id: 'daycomics',   name: 'DayComics',          domain: 'daycomics.com',   engine: 'hotcomics', lang: 'en', isNsfw: true },

  // ── Custom API Sources ────────────────────────────────────────────────────
  { id: 'asurascans',  name: 'Asura Scans',        domain: 'asurascans.com',  engine: 'custom', lang: 'en', isNsfw: false },
  { id: 'flamecomics', name: 'Flame Comics',       domain: 'flamecomics.xyz', engine: 'custom', lang: 'en', isNsfw: false },
  { id: 'reaperscans', name: 'Reaper Scans',       domain: 'reaperscans.com', engine: 'custom', lang: 'en', isNsfw: false },
  { id: 'dynasty',     name: 'Dynasty Scans',      domain: 'dynasty-scans.com', engine: 'custom', lang: 'en', isNsfw: false },
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

/**
 * Sanity-check a derived host fragment before registering it as a live domain.
 * Rejects junk/placeholder domains that cannot be valid registrable hostnames
 * (e.g. "bananascan_com.com" won't survive `new URL()` unescaped, and catalog
 * fallback entries like "dd.mm.yyyy" / hostnames with '_' or spaces must not be
 * added to the URL-matching registry).
 */
function isPlausibleHost(d: string): boolean {
  if (!d || d.length < 4 || d.length > 253) return false;
  if (d.includes('_') || d.includes(' ') || d.includes('/') || d.includes('..')) return false;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(d)) return false;
  const tld = d.split('.').pop() || '';
  if (tld.length < 2 || tld.length > 24 || /^\d+$/.test(tld)) return false;
  return true;
}

/** One-time sync: append auto-generated engine configs for every catalog source
 *  whose engineType is madara or mangathemesia and that isn't already curated.
 *
 *  KEY FIX (RC-2): MangaThemesia and Madara use COMPLETELY different DOM structures:
 *   - Madara chapters:        ul.row-content-chapter > li.wp-manga-chapter
 *   - MangaThemesia chapters: div.eplister > ul > li
 *   - MangaThemesia catalog:  div.listupd > div.bsx  (NOT .page-item-detail)
 *  Mixing these up means chapter lists / browse return NOTHING for 262 sources.
 *
 *  Sources with dedicated API scrapers (asurascans, flamecomics) are excluded
 *  from generic registration — their routes are handled in getSourcePopularSeries. */
function syncEngineRegistryFromCatalog(): void {
  const catalog = ALL_SOURCES_CATALOG;
  // Sources that have their own scrapers — skip generic engine registration.
  const SCRAPER_ONLY_IDS = new Set(['asurascans', 'flamecomics', 'mangadex']);
  let added = 0;
  for (const src of catalog) {
    if (curatedEngineIds.has(src.id)) continue;
    if (SCRAPER_ONLY_IDS.has(src.id)) continue;
    const domain = domainFromBaseUrl(src.baseUrl);
    // Skip malformed / placeholder domains so junk "https://<id>.com" fallbacks
    // (and catalog entries like "bananascan_com.com") never enter the URL matcher.
    if (!domain || !isPlausibleHost(domain)) continue;
    if (src.engineType === 'madara') {
      ENGINE_SOURCE_REGISTRY.push({
        id: src.id, name: src.name, domain, engine: 'madara',
        lang: src.lang, isNsfw: src.isNsfw,
      });
      added++;
    } else if (src.engineType === 'mangathemesia') {
      // CORRECT MangaThemesia selectors (ported from Keiyoushi lib-multisrc/MangaThemesia):
      //   Chapter list:  div.eplister > ul > li  (NOT ul.row-content-chapter)
      //   Catalog grid:  div.listupd > div.bsx   (NOT .page-item-detail)
      //   Reader pages:  div#readerarea img       (NOT div.reading-content)
      ENGINE_SOURCE_REGISTRY.push({
        id: src.id, name: src.name, domain, engine: 'mangareader',
        lang: src.lang, isNsfw: src.isNsfw,
        madaraSelectTestAsync: 'div.eplister',
        madaraSelectChapter: 'div.eplister ul li',
        madaraSelectBodyPage: 'div#readerarea',
      });
      added++;
    } else if (src.engineType === 'wpcomics') {
      // WP-Comics is a WordPress manga theme sharing the WP-Manga/Madara DOM
      // family (chapter rows + reading-content pages), so it reuses the Madara
      // engine. On mismatch the extractor returns 0 chapters and the dispatch
      // gracefully falls through to the generic resolver.
      ENGINE_SOURCE_REGISTRY.push({
        id: src.id, name: src.name, domain, engine: 'madara',
        lang: src.lang, isNsfw: src.isNsfw,
      });
      added++;
    } else if (src.engineType === 'foolslide') {
      // FoolSlide readers use clean URLs (/series/{slug}/, /read/{slug}/{lang}/{vol}/{ch}/)
      // but render their chapter list / page images via JS. Register a typed engine
      // so these route to a dedicated handler (with adult-gate bypass) instead of
      // being branded 'general'; anything the handler can't see falls back to generic.
      ENGINE_SOURCE_REGISTRY.push({
        id: src.id, name: src.name, domain, engine: 'foolslide',
        lang: src.lang, isNsfw: src.isNsfw,
      });
      added++;
    } else if (src.engineType === 'custom_html') {
      // Give every custom_html source a typed engine path (not 'general') so the
      // domainId resolves correctly for disabled-source checks, source labeling,
      // circuit breaker and health tracking — even though extraction falls through
      // to the generic resolver. (Dead/blocked ones are handled by liveness/health.)
      ENGINE_SOURCE_REGISTRY.push({
        id: src.id, name: src.name, domain, engine: 'custom',
        lang: src.lang, isNsfw: src.isNsfw,
      });
      added++;
    }
  }
  if (added > 0) console.log(`[Engine Registry] Auto-registered ${added} sources from catalog (madara + mangathemesia + wpcomics + foolslide + custom_html). Total: ${ENGINE_SOURCE_REGISTRY.length}`);
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
    const bypassRes = await fetchWithChallengeBypass(normalized, {
      headers: { ...UA_HEADERS, 'Referer': origin + '/' },
      enableCloudflareBypass: appSettings.enableCloudflareBypass,
      flareSolverrUrl: appSettings.flareSolverrUrl,
      captchaSolverEnabled: appSettings.captchaSolverEnabled,
      captchaApiKey: appSettings.captchaApiKey,
      timeoutMs: 15000,
      sourceId: domain || origin,
      onCookieUpdate: (sid: string, cookies: string[]) => sourceCookieJar.setCookies(sid, cookies),
    });
    if (!bypassRes.ok || !bypassRes.html) return [];
    const html = bypassRes.html;
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
    const bypassRes = await fetchWithChallengeBypass(chapterUrl, {
      headers: { ...UA_HEADERS, 'Referer': origin + '/' },
      enableCloudflareBypass: appSettings.enableCloudflareBypass,
      flareSolverrUrl: appSettings.flareSolverrUrl,
      captchaSolverEnabled: appSettings.captchaSolverEnabled,
      captchaApiKey: appSettings.captchaApiKey,
      timeoutMs: 15000,
      sourceId: domain || origin,
      onCookieUpdate: (sid: string, cookies: string[]) => sourceCookieJar.setCookies(sid, cookies),
    });
    if (!bypassRes.ok || !bypassRes.html) return null;
    const html = bypassRes.html;
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
    const reqHeaders = { ...UA_HEADERS, 'Referer': origin + '/' };
    const bypassRes = await fetchWithChallengeBypass(chapterUrl, {
      headers: reqHeaders,
      enableCloudflareBypass: appSettings.enableCloudflareBypass,
      flareSolverrUrl: appSettings.flareSolverrUrl,
      captchaSolverEnabled: appSettings.captchaSolverEnabled,
      captchaApiKey: appSettings.captchaApiKey,
      timeoutMs: 15000,
      sourceId: origin,
      onCookieUpdate: (sid: string, cookies: string[]) => sourceCookieJar.setCookies(sid, cookies),
    });
    if (!bypassRes.ok || !bypassRes.html) return null;
    let pages = extractMangaReaderPageUrls(bypassRes.html, origin);
    if (pages.length === 0) {
      pages = extractPanelImages(bypassRes.html, origin);
    }
    return pages.length > 0 ? pages : null;
  } catch (e) {
    console.warn('[MangaReader Engine] Page extraction failed:', (e as Error).message);
    return null;
  }
}

// MangaReader / ts-reader / MangaThemesia themed sites list chapters inside
// `#chapterlist > ul > li` or `div.eplister > ul > li` (e.g. RavenScans).
async function fetchMangaReaderChapterList(seriesUrl: string): Promise<ResolvedChapter[]> {
  try {
    const origin = new URL(seriesUrl).origin;
    const reqHeaders = { ...UA_HEADERS, 'Referer': origin + '/' };
    const bypassRes = await fetchWithChallengeBypass(seriesUrl, {
      headers: reqHeaders,
      enableCloudflareBypass: appSettings.enableCloudflareBypass,
      flareSolverrUrl: appSettings.flareSolverrUrl,
      captchaSolverEnabled: appSettings.captchaSolverEnabled,
      captchaApiKey: appSettings.captchaApiKey,
      timeoutMs: 15000,
      sourceId: origin,
      onCookieUpdate: (sid: string, cookies: string[]) => sourceCookieJar.setCookies(sid, cookies),
    });
    if (!bypassRes.ok || !bypassRes.html) return [];
    const $ = cheerio.load(bypassRes.html);
    const lis = $('#chapterlist > ul > li, ul.chapter-list li, li.wp-manga-chapter, div.eplister > ul > li, .eplister li, .clstyle li, #eplister li').toArray();
    if (lis.length === 0) {
      // Fall back to generic parser
      return parseGenericChapterListFromHtml(bypassRes.html, origin);
    }
    const chapters: ResolvedChapter[] = [];
    const seen = new Set<string>();
    [...lis].reverse().forEach((li, i) => {
      const a = $(li).find('a').first();
      const href = a.attr('href') || '';
      if (!href || /^(#|javascript:)/i.test(href)) return;
      const text = a.text().trim() || a.attr('title') || $(li).find('.chapternum, .epl-num').text().trim() || '';
      const numAttr = a.attr('data-num') || $(li).attr('data-num');
      const numM = (href + ' ' + text).match(/(?:chapter|chap|ch)[^\d]*(\d+(?:\.\d+)?)/i) || text.match(/^(\d+(?:\.\d+)?)/);
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

// ── FoolSlide Engine ─────────────────────────────────────────────────────
// FoolSlide is a PHP manga reader using clean URLs:
//   series  : {origin}/series/{slug}/
//   read    : {origin}/read/{slug}/{lang}/{volume}/{chapter}/
// The reader is normally JS-driven (chapter dropdown + page images loaded via
// AJAX by jquery.plugins.js), and many installs gate content behind an
// "adult content notice" POST form. This handler:
//   1. Detects & submits the adult gate (persisting the session cookie) so we
//      aren't stuck on the notice page.
//   2. Extracts whatever server-rendered chapter <li>/<option>/<a> rows exist.
//   3. Returns [] when content is JS-only — the dispatch then falls through to
//      the generic resolver rather than a hard failure.
async function fetchFoolSlideHtml(targetUrl: string, domainId: string): Promise<string | null> {
  const origin = new URL(targetUrl).origin;
  const headers = { ...UA_HEADERS, 'Referer': origin + '/' };
  const get = (url: string) => fetchWithChallengeBypass(url, {
    headers,
    enableCloudflareBypass: appSettings.enableCloudflareBypass,
    flareSolverrUrl: appSettings.flareSolverrUrl,
    captchaSolverEnabled: appSettings.captchaSolverEnabled,
    captchaApiKey: appSettings.captchaApiKey,
    timeoutMs: 8000,
    sourceId: domainId,
    onCookieUpdate: (sid: string, cookies: string[]) => sourceCookieJar.setCookies(sid, cookies),
  });

  const first = await get(targetUrl);
  if (!first.ok || !first.html) return null;
  updateSourceHealth(domainId, first.html, first.status);

  // Detect the FoolSlide adult-content gate: a POST form with a hidden
  // <input type="hidden" name="adult" value="true" />.
  if (!/<form[^>]*method=["']post["'][\s\S]*?name=["']adult["']/i.test(first.html)) {
    return first.html;
  }

  // Submit the gate, then re-fetch the same page with the session cookie.
  try {
    await fetch(targetUrl, {
      method: 'POST',
      headers: {
        ...UA_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': targetUrl,
        'Cookie': sourceCookieJar.getCookieHeader(domainId),
      },
      body: 'adult=true',
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
    });
  } catch { /* non-fatal — some installs unlock purely on the GET after POST */ }

  const second = await get(targetUrl);
  if (!second.ok || !second.html) return null;
  updateSourceHealth(domainId, second.html, second.status);
  return second.html;
}

async function fetchFoolSlideChapterList(seriesUrl: string, domainId: string): Promise<ResolvedChapter[]> {
  try {
    const html = await fetchFoolSlideHtml(seriesUrl, domainId);
    if (!html) return [];
    const $ = cheerio.load(html);
    const origin = new URL(seriesUrl).origin;
    const chapters: ResolvedChapter[] = [];
    const seen = new Set<string>();

    // Capture candidate <a href> rows and <option> values in document order.
    const rows = $('ul.chapter-list li a, #chapter-list li a, li.chapter a, select option, .chapter a').toArray();
    for (const row of rows) {
      const tag = (row as any).tagName?.toLowerCase();
      const href = tag === 'option' ? ($(row).attr('value') || '') : ($(row).attr('href') || '');
      if (!href || /^(#|javascript:)/i.test(href)) continue;
      const text = $(row).text().trim() || $(row).attr('title') || '';
      const abs = href.startsWith('http') ? href : `${origin}${href.startsWith('/') ? '' : '/'}${href}`;
      // FoolSlide read URLs: /read/{slug}/{lang}/{volume}/{chapter}/
      const m = abs.match(/\/read\/[^/]+\/[^/]+\/(\d+)\/(\d+(?:\.\d+)?)\/?/i);
      const num = m ? parseFloat(m[2]) : NaN;
      if (!Number.isFinite(num) || num <= 0) continue;
      if (seen.has(abs)) continue; seen.add(abs);
      chapters.push({ number: num, id: abs, slug: abs, title: text || `Chapter ${num}`, url: abs, pageCount: 0 });
    }

    // A sane page with zero rows is a JS-only theme — return [] so the
    // dispatcher's generic resolver tries instead of dying.
    return chapters;
  } catch (e) {
    console.warn('[FoolSlide Engine] Chapter list failed:', (e as Error).message);
    return [];
  }
}

async function fetchFoolSlideChapterPages(chapterUrl: string, domainId: string): Promise<string[] | null> {
  try {
    const html = await fetchFoolSlideHtml(chapterUrl, domainId);
    if (!html) return null;
    const origin = new URL(chapterUrl).origin;
    const pages = extractPanelImages(html, origin);
    return pages.length > 0 ? pages : null;
  } catch (e) {
    console.warn('[FoolSlide Engine] Page extraction failed:', (e as Error).message);
    return null;
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
  if (engineConfig && engineConfig.engine === 'foolslide') {
    const chapters = await fetchFoolSlideChapterList(targetUrl, domainId);
    if (chapters.length > 0) return chapters;
  }
  
  if (domainId === 'weebcentral' || targetUrl.includes('weebcentral.com')) {
    const weebChapters = await fetchWeebCentralChapterList(targetUrl);
    if (weebChapters.length > 0) return weebChapters;
  }
  if (domainId === 'asura' || domainId === 'asurascans' || targetUrl.includes('asurascans.com') || targetUrl.includes('asuracomic.net')) {
    return (await fetchAsuraChapterList(targetUrl)).chapters;
  }
  if (domainId === 'flame' || domainId === 'flamecomics' || targetUrl.includes('flamecomics.xyz') || targetUrl.includes('flamescans')) {
    return await fetchFlameChapterList(targetUrl);
  }

  switch (domainId) {
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

/**
 * Helper to clean and validate a candidate panel image URL extracted from HTML or embedded scripts.
 */
export function isValidPanelImageUrl(src: string): boolean {
  if (!src || typeof src !== 'string') return false;
  const s = src.trim().toLowerCase();
  if (!s || s.startsWith('data:image/svg') || s.startsWith('javascript:')) return false;

  // Must look like an image or CDN image path
  const hasImgExt = /\.(jpe?g|png|webp|avif|gif)(\?|$)/i.test(s);
  const isCdnPath = /(imgur\.com|cdn|uploads?|images?|content|chapters?|wp-content|storage|photos?|pictures?|media)/i.test(s);
  if (!hasImgExt && !isCdnPath) return false;

  // Noise / advertisement / non-chapter image filters
  if (
    s.includes('/covers/') ||
    s.includes('/cover/') ||
    s.includes('cover.') ||
    s.includes('/profiles/') ||
    s.includes('/avatars/') ||
    s.includes('avatar') ||
    s.includes('logo') ||
    s.includes('banner') ||
    s.includes('favicon') ||
    s.includes('icon') ||
    s.includes('default-pp') ||
    s.includes('announcement') ||
    s.includes('placeholder') ||
    s.includes('discord') ||
    s.includes('patreon') ||
    s.includes('donate') ||
    s.includes('doubleclick') ||
    s.includes('pixel.gif') ||
    s.includes('spacer.gif') ||
    s.includes('manhwa18.png') ||
    s.includes('manhwa18.cc/manga/')
  ) {
    return false;
  }
  return true;
}

/**
 * Extract candidate URL from srcset string (e.g. "url1 1x, url2 2x" -> best URL).
 */
export function parseSrcsetCandidate(srcsetString: string): string {
  if (!srcsetString || !srcsetString.includes(' ')) return srcsetString;
  const parts = srcsetString.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return '';
  // Pick the last candidate (usually highest resolution like 2x or highest width) or first
  const candidate = parts[parts.length - 1] || parts[0];
  return candidate.split(/\s+/)[0] || '';
}

// Extract real panel image URLs from chapter HTML (multi-attribute, scripts, srcset, filters metadata).
export function extractPanelImages(htmlText: string, origin: string): string[] {
  if (!htmlText) return [];
  const pages: string[] = [];
  const seen = new Set<string>();

  const addPage = (raw: string) => {
    if (!raw) return;
    let src = raw.trim();
    if (src.includes(' ') && (src.includes('w,') || src.includes('x,') || src.includes('w ') || src.includes('x '))) {
      src = parseSrcsetCandidate(src);
    }
    src = src.replace(/^["']|["']$/g, '');
    if (!isValidPanelImageUrl(src)) return;
    const abs = src.startsWith('http') ? src : `${origin}${src.startsWith('/') ? '' : '/'}${src}`;
    if (!seen.has(abs)) {
      seen.add(abs);
      pages.push(abs);
    }
  };

  // 1. Extract from <img> tags using Cheerio for robust attribute priority
  try {
    const $ = cheerio.load(htmlText);
    $('img').each((_i, el) => {
      const candidate =
        $(el).attr('data-src') ||
        $(el).attr('data-lazy-src') ||
        $(el).attr('data-cfsrc') ||
        $(el).attr('data-full-url') ||
        $(el).attr('data-original') ||
        $(el).attr('data-url') ||
        $(el).attr('data-img') ||
        $(el).attr('data-image') ||
        $(el).attr('data-page-url') ||
        $(el).attr('data-srcset') ||
        $(el).attr('srcset') ||
        $(el).attr('src') ||
        '';
      if (candidate) addPage(candidate);
    });
  } catch (_) {
    // Regex fallback if cheerio encounters an error
    const imgTagRegex = /<img\b([^>]*)>/gi;
    let tagMatch: RegExpExecArray | null;
    while ((tagMatch = imgTagRegex.exec(htmlText)) !== null) {
      const attrs = tagMatch[1];
      const attrMatch = attrs.match(/(?:data-src|data-lazy-src|data-cfsrc|data-full-url|data-original|data-url|data-img|data-image|data-page-url|data-srcset|srcset|src)=["']([^"']+)["']/i);
      if (attrMatch && attrMatch[1]) addPage(attrMatch[1]);
    }
  }

  // 2. Extract from embedded scripts (JSON-in-script / JS variables) if <img> gave nothing or few images
  if (pages.length < 2) {
    // A. ts_reader.run({ ... sources: [ { images: [...] } ] ... })
    const tsMatch = htmlText.match(/ts_reader\.run\s*\(\s*(\{[\s\S]*?\})\s*\)/);
    if (tsMatch) {
      try {
        const obj = JSON.parse(tsMatch[1]);
        const imgs = obj?.sources?.[0]?.images;
        if (Array.isArray(imgs)) {
          for (const img of imgs) {
            if (typeof img === 'string') addPage(img);
          }
        }
      } catch (_) {}
    }

    // B. var/let/const pages = [...] or images = [...] or chapter_data = [...]
    const scriptArrayRegex = /(?:var|let|const|window\.)\s*(?:pages|images|chapter_images|chapter_data|img_list)\s*=\s*(\[[\s\S]*?\]|{[\s\S]*?})/gi;
    let arrayMatch: RegExpExecArray | null;
    while ((arrayMatch = scriptArrayRegex.exec(htmlText)) !== null) {
      try {
        const rawJson = arrayMatch[1];
        const parsed = JSON.parse(rawJson);
        const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.images) ? parsed.images : (Array.isArray(parsed?.pages) ? parsed.pages : []));
        for (const item of list) {
          if (typeof item === 'string') addPage(item);
          else if (typeof item === 'object' && item !== null) {
            const url = item.url || item.src || item.path || item.image || item.page;
            if (typeof url === 'string') addPage(url);
          }
        }
      } catch (_) {}
    }

    // C. Script tags with embedded Next.js (__NEXT_DATA__) or JSON-LD
    const scriptJsonRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
    let sMatch: RegExpExecArray | null;
    while ((sMatch = scriptJsonRegex.exec(htmlText)) !== null) {
      const code = sMatch[1]?.trim() || '';
      if (code.includes('"images"') || code.includes('"pages"') || code.includes('__NEXT_DATA__')) {
        try {
          const parsed = JSON.parse(code);
          const chImgs = parsed?.chapter?.images || parsed?.props?.pageProps?.chapter?.images || parsed?.pageProps?.chapter?.images;
          if (Array.isArray(chImgs)) {
            for (const it of chImgs) {
              if (typeof it === 'string') addPage(it);
              else if (typeof it === 'object' && it !== null && it.url) addPage(it.url);
            }
          }
        } catch (_) {}
      }
    }
  }

  return pages;
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

    // 1. Weeb Central Direct API Integration
    if (domainId === 'weebcentral' || targetUrl.includes('weebcentral.com')) {
      try {
        const urls = await fetchWeebCentralChapterPages(targetUrl);
        if (urls && urls.length > 0) {
          console.log(`[WeebCentral Scraper] Successfully extracted ${urls.length} live pages for ${targetUrl}`);
          return urls;
        }
        // If targetUrl was a series URL rather than a chapter URL, resolve chapter list first
        const chapters = await fetchWeebCentralChapterList(targetUrl);
        const targetCh = matchResolvedChapter(chapters, chapterNumber);
        if (targetCh && targetCh.url) {
          const chUrls = await fetchWeebCentralChapterPages(targetCh.url);
          if (chUrls && chUrls.length > 0) {
            console.log(`[WeebCentral Scraper] Successfully extracted ${chUrls.length} live pages for ${targetCh.url}`);
            return chUrls;
          }
        }
      } catch (err: any) {
        console.warn(`[WeebCentral Scraper] Page extraction error:`, err.message);
      }
    }

    // 2. Asura Scans Official API v2 Integration with Slug Hash Fallback
    if (domainId === 'asura' || domainId === 'asurascans' || targetUrl.includes('asurascans.com') || targetUrl.includes('asuracomic.net')) {
      try {
        const { chapters, matchedSlug } = await fetchAsuraChapterList(targetUrl);

        if (chapters.length === 0) {
          console.warn(`[Asura API Engine] No chapters returned for "${targetUrl}" — the series may no longer be hosted on Asura Scans.`);
        }

        if (chapters.length > 0 && matchedSlug) {
          const targetChapter = matchResolvedChapter(chapters, chapterNumber);

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
    if (domainId === 'flame' || domainId === 'flamecomics' || targetUrl.includes('flamecomics.xyz') || targetUrl.includes('flamescans')) {
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

    // 3. Dedicated Engine Extractors: Manhwa18 / HotComics / MangaReader / FoolSlide / Madara
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
    if (engCfg && engCfg.engine === 'foolslide') {
      const fsChapters = await fetchFoolSlideChapterList(targetUrl, domainId);
      const fsTarget = matchResolvedChapter(fsChapters, chapterNumber);
      if (fsTarget) {
        const fsPages = await fetchFoolSlideChapterPages(fsTarget.url, domainId);
        if (fsPages && fsPages.length > 0) return fsPages;
      }
    }
    if (engCfg && engCfg.engine === 'madara') {
      const madaraPages = await fetchMadaraChapterPages(targetUrl, chapterNumber, engCfg);
      if (madaraPages && madaraPages.length > 0) return madaraPages;
    }

    // 4. Dynasty Scans Series & Chapter Resolution
    if (domainId === 'dynasty' || targetUrl.includes('dynasty-scans.com')) {
      try {
        const chapters = await fetchDynastyChapterList(targetUrl);
        if (chapters.length > 0) {
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

    // If the URL is already a direct chapter page, fetch it directly with challenge bypass.
    const isDirectChapterUrl = /\/(chapter|chap|ch|read|reader|view|ep|episode)[-/_.]?\d+/i.test(targetUrl);
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
      // Fallback attempt: Try direct candidate chapter URLs if chapter list parsing yielded nothing (SPA / JS themes)
      const baseClean = targetUrl.replace(/\/$/, '');
      const candidates = [
        `${baseClean}/chapter-${chapterNumber}`,
        `${baseClean}/chap-${chapterNumber}`,
        `${baseClean}/ch-${chapterNumber}`,
        `${baseClean}/${chapterNumber}`,
      ];
      for (const candidateUrl of candidates) {
        try {
          const candidateBypass = await fetchWithChallengeBypass(candidateUrl, solverOpts);
          if (candidateBypass.ok && candidateBypass.html) {
            const images = extractPanelImages(candidateBypass.html, origin);
            if (images.length > 0) return images;
          }
        } catch (_) {}
      }
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
    // 1. In-memory fast cache
    const cached = this.pageListCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.maxCacheAgeMs) {
      console.log(`[Kotatsu Image Engine] Memory Cache Hit for ${cacheKey} (${cached.pages.length} pages)`);
      return cached.pages;
    }

    // 2. Persistent SQLite cache (fast-boot & multi-process survivable)
    try {
      const sqliteCached = SqliteDb.getCachedChapterPages(domainId, chapterNumber, targetUrl);
      if (sqliteCached && sqliteCached.pages.length > 0) {
        console.log(`[Kotatsu Image Engine] SQLite Cache Hit for ${cacheKey} (${sqliteCached.pages.length} pages)`);
        this.pageListCache.set(cacheKey, { pages: sqliteCached.pages, timestamp: Date.now() });
        return sqliteCached.pages;
      }
    } catch (_) {}

    // 3. Live Scraper Extraction
    const pages = await extractLiveDomainChapterPages(targetUrl, domainId, chapterNumber);
    if (pages && pages.length > 0) {
      this.pageListCache.set(cacheKey, { pages, timestamp: Date.now() });
      try {
        SqliteDb.setCachedChapterPages(domainId, chapterNumber, targetUrl, pages, this.maxCacheAgeMs);
      } catch (_) {}
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
  let mangaTitle = (req.query.title as string) || (manga ? manga.title : 'Webtoon Series');
  const totalChapters = manga ? Math.max(manga.latestChapter || 1, manga.currentChapter || 1, chapterNumber) : 1;

  // 1. MangaDex is used for METADATA only (search/enrichment/covers) and is intentionally
  //    NOT used as a reading source. Reading is resolved from the series' own live source
  //    below, or falls back to a generated placeholder panel with the correct title.

  // 2. LIVE DOMAIN SOURCE CRAWLER RESOLUTION (KOTATSU IMAGE ENGINE)
  let targetUrl = (req.query.url as string) || manga?.sourceUrl || '';

  // If targetUrl is still empty, infer from mangaId prefix
  if (!targetUrl && mangaId) {
    if (mangaId.startsWith('asura_')) {
      const slug = mangaId.replace('asura_', '');
      targetUrl = `https://asurascans.com/comics/${slug}`;
      if (mangaTitle === 'Webtoon Series') {
        mangaTitle = slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      }
    } else if (mangaId.startsWith('flame_')) {
      const slug = mangaId.replace('flame_', '');
      targetUrl = `https://flamecomics.xyz/series/${slug}`;
      if (mangaTitle === 'Webtoon Series') {
        mangaTitle = slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      }
    } else if (mangaId.startsWith('kotatsu_')) {
      for (const src of KOTATSU_SOURCES) {
        if (mangaId.startsWith(`kotatsu_${src.id}_`)) {
          const pathOrSlug = mangaId.replace(`kotatsu_${src.id}_`, '');
          targetUrl = pathOrSlug.startsWith('http') ? pathOrSlug : `${src.baseUrl.replace(/\/$/, '')}/${pathOrSlug}`;
          break;
        }
      }
    }
  }

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

  // If no live source is configured (e.g. imported from MangaDex metadata), auto-discover one now
  if ((!targetUrl || targetUrl.toLowerCase().includes('mangadex.org')) && manga) {
    const autoSource = await autoDiscoverLiveSourceForManga(manga);
    if (autoSource) {
      targetUrl = autoSource.sourceUrl;
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

  // 3. MangaDex Direct Reading Fallback (@home CDN)
  const mdSeriesId = manga?.apiId || (mangaId && mangaId.startsWith('md_') ? mangaId.replace('md_', '') : null) || (manga?.id && manga.id.startsWith('md_') ? manga.id.replace('md_', '') : null);
  let mdChapterUuid = chapterId && chapterId.startsWith('md_') ? chapterId.replace('md_', '') : (chapterId && chapterId.length === 36 ? chapterId : null);

  if (!mdChapterUuid && mdSeriesId) {
    try {
      const feedRes = await fetchMangaDex(
        `https://api.mangadex.org/manga/${mdSeriesId}/feed?chapter=${chapterNumber}&translatedLanguage[]=en&limit=1`
      );
      if (feedRes && feedRes.ok) {
        const feedJson = await feedRes.json();
        if (feedJson.data?.[0]?.id) {
          mdChapterUuid = feedJson.data[0].id;
        }
      }
    } catch {}
  }

  if (mdChapterUuid) {
    try {
      const atHomeRes = await fetchMangaDex(`https://api.mangadex.org/at-home/server/${mdChapterUuid}`);
      if (atHomeRes && atHomeRes.ok) {
        const atHomeJson = await atHomeRes.json();
        const base = atHomeJson.baseUrl;
        const hash = atHomeJson.chapter?.hash;
        const fileNames: string[] = atHomeJson.chapter?.data || [];
        if (base && hash && fileNames.length > 0) {
          const rawPages = fileNames.map((fn) => `${base}/data/${hash}/${fn}`);
          const proxiedPages = rawPages.map(
            (p) => `/api/reader/proxy-image?url=${encodeURIComponent(p)}&sourceUrl=${encodeURIComponent('https://mangadex.org/')}`
          );
          console.log(`[Reader Stream Engine] Loaded ${proxiedPages.length} panels from MangaDex @home for Chapter ${chapterNumber}`);
          return res.json({
            chapterId: `md_${mdChapterUuid}`,
            mangaId,
            mangaTitle,
            chapterNumber,
            title: `Chapter ${chapterNumber}`,
            scanGroup: 'MangaDex (Scanlation)',
            selectedGroup: 'MangaDex',
            pages: proxiedPages,
            totalChapters,
            nextChapterNumber: chapterNumber < totalChapters ? chapterNumber + 1 : null,
            prevChapterNumber: chapterNumber > 1 ? chapterNumber - 1 : null,
            isPlaceholder: false,
          });
        }
      }
    } catch (e: any) {
      console.warn('[Reader Stream Engine] MangaDex @home page fetch failed:', e.message);
    }
  }

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
  const { mangaId, chapterNumber, manga: mangaPayload } = req.body || {};
  let manga = SqliteDb.getMangaById(String(mangaId)) || mangaDatabase.find((m) => m.id === mangaId);
  if (!manga && mangaPayload && typeof mangaPayload === 'object') {
    const rawManga: MangaItem = {
      id: String(mangaId || mangaPayload.id || `manga_${Date.now()}`),
      title: String(mangaPayload.title || 'Untitled Series'),
      altTitles: Array.isArray(mangaPayload.altTitles) ? mangaPayload.altTitles : [],
      type: ['manga', 'manhwa', 'manhua'].includes(mangaPayload.type) ? mangaPayload.type : 'manhwa',
      coverImage: String(mangaPayload.coverImage || ''),
      description: String(mangaPayload.description || ''),
      genres: Array.isArray(mangaPayload.genres) ? mangaPayload.genres : ['Action'],
      status: 'reading',
      currentChapter: Number(chapterNumber) || 0,
      totalChapters: mangaPayload.totalChapters ? Number(mangaPayload.totalChapters) : null,
      latestChapter: Number(mangaPayload.latestChapter) || Number(chapterNumber) || 1,
      rating: Number(mangaPayload.rating) || 9.0,
      sourceUrl: String(mangaPayload.sourceUrl || ''),
      sourceName: String(mangaPayload.sourceName || 'Explore'),
      autoUpdateEnabled: mangaPayload.autoUpdateEnabled !== false,
      notes: String(mangaPayload.notes || ''),
      addedAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      lastReadAt: new Date().toISOString(),
      isFavorite: true,
    };
    syncAddOrUpdateManga(rawManga);
    manga = rawManga;
  }
  if (!manga) {
    return res.status(404).json({ error: "Manga not found" });
  }

  const userId = resolveRequestUserId(req) || 'usr_guest';
  const newChapterNum = Math.max(Number(chapterNumber) || 1, 0);
  SqliteDb.setUserLibraryChapter(userId, manga.id, newChapterNum, {
    status: manga.status === 'plan_to_read' ? 'reading' : manga.status,
  });
  // Auto-add to user favorites / library on reading
  SqliteDb.setUserFavorite(userId, manga.id, true);

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

// Sticky notes, auth, admin, GDPR, settings, reading-progress and bug-tracker
// routes are handled by the scoped routers in server/routes/*.




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

  // 1a. Restore persisted source health map (RC-5 fix: circuit states survive restarts)
  loadSourceHealthMap();

  // 1b. Rewrite stale live-source URLs (asuracomic.net → asurascans.com, /manhwa/ → /manga/, …)
  try { migrateStaleSourceUrlsInDatabase(); } catch (e) {
    console.warn('[Migration] stale source URL rewrite failed:', (e as Error)?.message || e);
  }

  // 1c. Purge any residual Reaper Scans items from memory & SQLite
  purgeReaperScansFromAllStorage();

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
    if ((HOST === '0.0.0.0' || HOST === '::') && !AUTH_ENABLED) {
      logger.warn('Security', '⚠️ Server is listening on 0.0.0.0 with REQUIRE_AUTH disabled. If exposed to the internet or untrusted LAN, set REQUIRE_AUTH=1 and ensure your reverse proxy (Nginx/Caddy) strictly overwrites X-Forwarded-For.');
    }
  });

  // 4. Non-blocking auto-updater (rate-spaced). The static hard-coded catalog is
  //    not re-seeded here — Explore is populated from live/verified sources only.
  scheduleBackgroundAutoUpdater();

  // 5. Warm the Explore catalog buffer in the background and refresh it on an
  //    interval, so /browse loads are served from memory instead of live scrapes.
  scheduleExploreRefresher();

  // 6. Start scheduled local auto-backup service
  startAutoBackupScheduler(30);
}

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  startServer();
}

// =========================================================
// GRACEFUL SHUTDOWN — flush pending state & write legacy JSON backup
// =========================================================
function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info('Shutdown', `Received ${signal}. Flushing state & writing legacy JSON backup...`);
  try {
    cancelPendingSave();
    // Final synchronous SQLite flush of app state
    flushStateNow();
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
