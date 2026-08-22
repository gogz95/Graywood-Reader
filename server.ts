import express from "express";
import compression from "compression";
import path from "path";
import fs from "fs";
import { SqliteDb } from "./sqlite-db";
import { MangaItem, UserProfile, UserRole, isMangaDexSourceLink } from "./src/types";
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
  assertSafeProxyTarget,
  fetchWithSsrfGuard,
  MAX_PROXY_IMAGE_BYTES,
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
} from "./server/rateLimit";
import {
  detectChallenge,
  solveWithFlareSolverr,
  checkSolverBalance,
  fetchWithChallengeBypass,
} from "./server/captchaSolver";
import { challengeManager } from "./server/challengeManager";
import { sourceCircuitBreaker } from "./server/circuitBreaker";
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
import { categoriesRouter } from "./server/routes/categories";
import { mangaRouter, isContentPath, isNavText } from "./server/routes/manga";
import {
  readerRouter,
  resolveManga,
  isValidPanelImageUrl,
  parseSrcsetCandidate,
  extractPanelImages,
  handleImageProxyRequest,
} from "./server/routes/reader";
import {
  sourcesRouter,
  handleFlagSourceBroken,
} from "./server/routes/sources";
import {
  exploreRouter,
  integrateKotatsuSourcesAndMerge,
  updateDatabaseWithAllAvailableSeries,
} from "./server/routes/explore";
import {
  trackerRouter,
  autoUpdateLogs,
  autoUpdateStatus,
} from "./server/routes/tracker";
import {
  refreshSingleMangaMetadata,
  fetchMangaDex,
  calculateStringSimilarity,
  getMangaDexMetadataByTitle,
  parseGenericLiveSeriesMetadata,
  fetchLiveSeriesMetadata,
  purgeDisabledSourcesAndRefreshMetadata,
} from "./server/services/metadataService";
import { dispatchNewChapterWebhooks } from "./server/services/webhookNotifier";
import { startAutoBackupScheduler } from "./server/services/autoBackupService";
import { imageCacheService } from "./server/services/imageCache";
import {
  sourceHealthMap,
  updateSourceHealth,
  loadSourceHealthMap,
  detectBlockedResponse,
  sourceCookieJar,
} from "./server/services/sourceHealthService";
import {
  kotatsuImageEngine,
  matchLiveDomain,
  getLiveDomains,
  getEngineConfig,
  CURATED_ENGINE_SOURCES,
  ENGINE_SOURCE_REGISTRY,
  syncEngineRegistryFromCatalog,
  fetchLiveChapterList,
  normalizeLiveTargetUrl,
  matchResolvedChapter,
  autoDiscoverLiveSourceForManga,
  searchLiveSourcesForSeries,
  parseGenericChapterListFromHtml,
} from "./server/services/crawlerEngine";
import {
  scheduleExploreRefresher,
  probeSourceSeriesCount,
  auditAndDisableEmptySources,
} from "./server/services/exploreService";
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
  disabledSourceIds,
  isSourceAlive,
  isMetadataOnlySource,
  buildFullSourceInventory,
  ensureSourceInRegistry,
  getSourceById,
  isSeriesFromDisabledSource,
} from "./server/sources/sourcesCatalog";
import {
  mangaDatabase,
  userProfiles,
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
  resolveRequestUserId,
  resolveAuthUser,
  canWriteCatalog,
  canModifyManga,
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
  isSeriesFromDisabledSource,
  isContentPath,
  isNavText,
  isValidPanelImageUrl,
  parseSrcsetCandidate,
  extractPanelImages,
  parseGenericChapterListFromHtml,
  kotatsuImageEngine,
  matchLiveDomain,
  getLiveDomains,
  getEngineConfig,
  CURATED_ENGINE_SOURCES,
  ENGINE_SOURCE_REGISTRY,
  syncEngineRegistryFromCatalog,
  fetchLiveChapterList,
  normalizeLiveTargetUrl,
  matchResolvedChapter,
  autoDiscoverLiveSourceForManga,
  searchLiveSourcesForSeries,
  sourceHealthMap,
  updateSourceHealth,
  loadSourceHealthMap,
  detectBlockedResponse,
  sourceCookieJar,
  resolveManga,
  handleImageProxyRequest,
  integrateKotatsuSourcesAndMerge,
  updateDatabaseWithAllAvailableSeries,
  probeSourceSeriesCount,
  auditAndDisableEmptySources,
  parseGenericLiveSeriesMetadata,
  fetchLiveSeriesMetadata,
};

// Initialize Express
const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const HOST = process.env.HOST || "0.0.0.0";

app.set('trust proxy', (ip: string) => {
  const normalized = String(ip).toLowerCase().replace(/^::ffff:/, '');
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === 'localhost';
});

app.use(express.json({ limit: "10mb" }));
app.use(compression());

app.use((_req, res, next) => {
  res.setHeader('Access-Control-Expose-Headers', 'X-Total-Count, X-Total-Pages');
  next();
});

app.use(requestLoggerMiddleware);

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
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

// Host-only gate for sensitive operations
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

app.use(rateLimitMiddleware);

app.use((req, _res, next) => {
  (req as any).user = resolveAuthUser(req);
  next();
});

// Mount scoped modular routers
app.use(progressRouter);
app.use(bugsRouter);
app.use(notesRouter);
app.use(opdsRouter);
app.use(localLibraryRouter);
app.use(authRouter);
app.use(adminRouter);
app.use(gdprRouter);
app.use(settingsRouter);
app.use(webhooksRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/manga', mangaRouter);
app.use(readerRouter);
app.use(sourcesRouter);
app.use(exploreRouter);
app.use(trackerRouter);

// ── Base Server Health, Version & Config Endpoints ────────────────────────────
app.get("/api/health", (req, res) => {
  const isHost = isHostRequest(req);
  res.json({
    status: "ok",
    version: APP_VERSION,
    uptime: Math.floor(process.uptime()),
    uptimeSeconds: Math.floor(process.uptime()),
    seriesCount: mangaDatabase.length,
    userCount: userProfiles.length,
    isHost,
  });
});

app.get("/api/version", (_req, res) => {
  res.json(getSystemVersionReport());
});

app.get("/api/config", (req, res) => {
  res.json({
    ...syncConfig,
    isHost: isHostRequest(req),
    authEnabled: AUTH_ENABLED,
  });
});

app.post("/api/config", (req, res) => {
  const { subdomain, autoUpdateIntervalMinutes } = req.body;
  if (subdomain !== undefined) syncConfig.subdomain = subdomain;
  if (autoUpdateIntervalMinutes !== undefined) {
    syncConfig.autoUpdateIntervalMinutes = Math.max(1, Number(autoUpdateIntervalMinutes));
  }
  saveDatabaseToDisk();
  res.json({ success: true, config: syncConfig });
});

// ── Challenge & Solver Endpoints ─────────────────────────────────────────────
app.get("/api/challenges", (_req, res) => {
  const challenges = challengeManager.getActiveChallenges();
  const config = challengeManager.getConfig();
  res.json({
    count: challenges.length,
    challenges,
    config,
    solverAvailable: !!appSettings.flareSolverrUrl || !!appSettings.captchaApiKey,
  });
});

app.post("/api/challenges/config", (req, res) => {
  const config = challengeManager.updateConfig(req.body || {});
  res.json({ success: true, config });
});

app.post("/api/challenges/:id/dismiss", (req, res) => {
  const dismissed = challengeManager.dismissChallenge(req.params.id);
  res.json({ success: dismissed });
});

app.post("/api/challenges/:id/solve-manual", (req, res) => {
  const { cookies, userAgent, sourceId: rawSourceId } = req.body || {};
  if (!cookies) return res.status(400).json({ error: "cookies array or header string is required" });

  const id = req.params.id;
  let sourceId = rawSourceId;
  if (!sourceId && id.startsWith('chn_')) {
    sourceId = id.replace(/^chn_/, '');
  }

  const cookieList: string[] = Array.isArray(cookies)
    ? cookies
    : String(cookies).split(';').map(c => c.trim()).filter(Boolean);

  if (sourceId) {
    sourceCookieJar.setCookies(sourceId, cookieList);
    if (userAgent) {
      sourceCustomUserAgents.set(sourceId, userAgent);
    }
    sourceCircuitBreaker.reset(sourceId);
    challengeManager.resolveChallenge(sourceId);
  } else {
    challengeManager.dismissChallenge(id);
  }

  res.json({
    success: true,
    message: `Applied ${cookieList.length} session cookie(s) for "${sourceId || id}". Circuit breaker reset.`,
  });
});

app.post("/api/challenges/test", (req, res) => {
  const { sourceId, sourceName, challengeType, pageUrl } = req.body || {};
  const notif = challengeManager.recordChallenge({
    sourceId: sourceId || "asurascans_test",
    sourceName: sourceName || "Asura Scans (Test)",
    sourceUrl: pageUrl || "https://asurascans.com",
    challengeType: challengeType || "cloudflare_turnstile",
    httpStatus: 403,
  });
  res.json({
    success: true,
    notification: notif,
    challengeId: notif.id,
    message: `Registered test challenge ${notif.id}.`,
  });
});

app.post('/api/crawler/bypass-fetch', async (req, res) => {
  const { targetUrl } = req.body;
  if (!targetUrl) return res.status(400).json({ error: 'targetUrl is required' });

  try {
    await assertSafeProxyTarget(String(targetUrl));
  } catch (err: any) {
    console.warn(`[Cloudflare Bypass Engine] Blocked unsafe crawler target: ${err?.message || err}`);
    return res.status(403).json({ error: 'Blocked crawler target', message: String(err?.message || err) });
  }

  try {
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
            return res.json({
              success: true,
              methodUsed: 'FlareSolverr Cloudflare Bypass',
              cookies: solverData.solution.cookies,
              userAgent: solverData.solution.userAgent,
              htmlContent: solverData.solution.response,
            });
          }
        }
      } catch {}
    }

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
    res.status(500).json({ error: 'Failed to bypass Cloudflare challenge', details: err.message });
  }
});

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
  if (!key) return res.status(400).json({ success: false, error: "No API key configured" });
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

app.post("/api/settings/cache/clear", (_req, res) => {
  const before = kotatsuImageEngine.size();
  kotatsuImageEngine.clearCache();
  res.json({
    success: true,
    message: `All caches cleared: Kotatsu page-list cache flushed (${before} entries).`,
    clearedEntries: before,
  });
});

// ── Rate-Spaced Background Auto-Updater ───────────────────────────────────────
async function runLiveRateSpacedAutoUpdate() {
  if (autoUpdateStatus.isScanning) return;
  autoUpdateStatus.isScanning = true;
  autoUpdateStatus.scannedCount = 0;
  autoUpdateStatus.newReleasesFound = 0;
  autoUpdateStatus.lastScanTimestamp = new Date().toISOString();

  const activeSeries = mangaDatabase.filter((m) => m.autoUpdateEnabled && !isSeriesFromDisabledSource(m));
  autoUpdateStatus.totalCount = activeSeries.length;

  for (const manga of activeSeries) {
    try {
      autoUpdateStatus.currentSource = manga.sourceName || 'Live Source';
      const prevCh = manga.latestChapter || 1;
      const updated = await refreshSingleMangaMetadata(manga);
      autoUpdateStatus.scannedCount++;

      if (updated && (updated.latestChapter || 1) > prevCh) {
        autoUpdateStatus.newReleasesFound++;
        autoUpdateLogs.unshift({
          id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          timestamp: new Date().toISOString(),
          source: manga.sourceName || 'Live Source',
          mangaTitle: manga.title,
          status: 'updated',
          message: `Found new chapter! Updated from Ch. ${prevCh} to Ch. ${updated.latestChapter}`,
          oldChapter: prevCh,
          newChapter: updated.latestChapter,
        });
        dispatchNewChapterWebhooks(updated, updated.latestChapter || 1);
      }
      await new Promise((r) => setTimeout(r, 600));
    } catch {
      autoUpdateStatus.scannedCount++;
    }
  }

  autoUpdateStatus.isScanning = false;
  autoUpdateStatus.currentSource = '';
}

function scheduleBackgroundAutoUpdater() {
  const intervalMs = Math.max(1, syncConfig.autoUpdateIntervalMinutes || 30) * 60 * 1000;
  setInterval(() => {
    runLiveRateSpacedAutoUpdate().catch((e) => console.error("Background auto-update error:", e));
  }, intervalMs);
}

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
      try { syncAddOrUpdateManga(m); } catch {}
      changed++;
    }
  }
  return changed;
}

// ── HTTP Server Boot & Graceful Shutdown ─────────────────────────────────────
let httpServer: ReturnType<typeof app.listen> | null = null;
let isShuttingDown = false;

async function startServer() {
  loadDatabaseFromDisk();
  loadSourceHealthMap();
  syncEngineRegistryFromCatalog();

  try { migrateStaleSourceUrlsInDatabase(); } catch {}
  purgeReaperScansFromAllStorage();

  const distPath = path.join(process.cwd(), "dist");
  if (fs.existsSync(distPath)) {
    app.use('/assets', (_req, res, next) => {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      next();
    });
    app.use(express.static(distPath, { maxAge: "7d", etag: true, index: false }));
    app.use((req, res, next) => {
      if (req.method === 'GET' && !req.path.startsWith('/api/')) {
        return res.sendFile(path.join(distPath, "index.html"));
      }
      next();
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  httpServer = app.listen(PORT, HOST, () => {
    logger.info('Startup', `Graywood Reader v${APP_VERSION} running on http://${HOST}:${PORT}`);
    logger.info('Startup', `SQLite database ready (${mangaDatabase.length} series, ${userProfiles.length} users)`);
  });

  scheduleBackgroundAutoUpdater();
  scheduleExploreRefresher();
  startAutoBackupScheduler(30);
}

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  startServer();
}

function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info('Shutdown', `Received ${signal}. Flushing state & writing legacy JSON backup...`);
  try {
    cancelPendingSave();
    flushStateNow();
    writeLegacyJsonSnapshot(`graceful shutdown via ${signal}`);
    logger.flush();
  } catch (err) {
    logger.error('Shutdown', 'Error while flushing state', { error: String(err) });
  }
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
