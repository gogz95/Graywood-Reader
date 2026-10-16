// ============================================================================
// server/app.ts — Express Application Factory & Middleware Pipeline
// ============================================================================

import express from 'express';
import compression from 'compression';
import { SqliteDb } from '../db';
import {
  AUTH_ENABLED,
  isHostRequest,
  normalizeGatePath,
  isHostOnlyPath,
  SENSITIVE_GET_PATHS,
  csrfAndOriginGuard,
} from './security';
import { rateLimitMiddleware } from './rateLimit';
import { notesRouter } from './routes/notes';
import { opdsRouter } from './routes/opds';
import { localLibraryRouter } from './routes/localLibrary';
import { komgaCompatRouter } from './routes/komgaCompat';
import { authRouter } from './routes/auth';
import { adminRouter } from './routes/admin';
import { gdprRouter } from './routes/gdpr';
import { settingsRouter } from './routes/settings';
import { progressRouter } from './routes/progress';
import { bugsRouter } from './routes/bugs';
import { webhooksRouter } from './routes/webhooks';
import { categoriesRouter } from './routes/categories';
import { challengesRouter } from './routes/challenges';
import { downloadsRouter } from './routes/downloads';
import { readlistsRouter } from './routes/readlists';
import { roomsRouter } from './routes/rooms';
import { eventsRouter } from './routes/events';
import { mangaRouter, handleFullTextSearch } from './routes/manga';
import { readerRouter } from './routes/reader';
import { sourcesRouter } from './routes/sources';
import { exploreRouter } from './routes/explore';
import { trackerRouter } from './routes/tracker';
import { kotatsuImageEngine } from './services/crawlerEngine';
import { APP_VERSION, getSystemVersionReport } from './version';
import { logger, requestLoggerMiddleware } from './logger';
import {
  userProfiles,
  syncConfig,
  saveDatabaseToDisk,
  resolveAuthUser,
} from './appState';

export const sourceCustomCookies = new Map<string, string[]>();
export { sourceCustomUserAgents } from './userAgentPool';

export function createApp(): express.Application {
  const app = express();

  app.set('trust proxy', (ip: string) => {
    const normalized = String(ip).toLowerCase().replace(/^::ffff:/, '');
    return normalized === '127.0.0.1' || normalized === '::1' || normalized === 'localhost';
  });

  app.use(
    compression({
      filter: (req, res) => {
        if (
          req.path === '/api/events' ||
          req.path.startsWith('/api/events') ||
          req.path.includes('/progress/sse') ||
          req.headers.accept?.includes('text/event-stream')
        ) {
          return false;
        }
        return compression.filter(req, res);
      },
    })
  );

  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Expose-Headers', 'X-Total-Count, X-Total-Pages');
    next();
  });

  app.use(requestLoggerMiddleware);
  app.use(csrfAndOriginGuard);

  // Rate limiting mounted BEFORE body parsers to defend against resource exhaustion
  app.use(rateLimitMiddleware);

  // Bounded JSON body parsing: 1mb global default, 50mb for database/backup imports
  const largeJsonParser = express.json({ limit: "50mb" });
  const standardJsonParser = express.json({ limit: "1mb" });
  const LARGE_BODY_IMPORT_PATHS = new Set([
    '/api/db/import',
    '/api/settings/backup/import',
    '/api/settings/backup/import-kotatsu',
    '/api/tracker/import',
    '/api/progress/import-statistics',
  ]);

  app.use((req, res, next) => {
    if (LARGE_BODY_IMPORT_PATHS.has(req.path)) {
      largeJsonParser(req, res, next);
    } else {
      standardJsonParser(req, res, next);
    }
  });

  app.use(express.raw({ type: ['application/zip', 'application/octet-stream', 'application/x-zip-compressed'], limit: "100mb" }));

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

  app.use((req, _res, next) => {
    (req as any).user = resolveAuthUser(req);
    next();
  });

  // Host-only gate for sensitive operations (allows host computer OR authenticated admin)
  app.use((req, res, next) => {
    const path = normalizeGatePath(req.path);
    if (!isHostOnlyPath(path)) return next();
    if (req.method === 'GET' && !SENSITIVE_GET_PATHS.has(path)) return next();
    const user = (req as any).user;
    if (!isHostRequest(req) && !(AUTH_ENABLED && user && user.role === 'admin')) {
      return res.status(403).json({
        error: "Forbidden",
        message: "Global settings and administrative operations are restricted to the host computer or authenticated administrators.",
      });
    }
    next();
  });

  // Mount scoped modular routers
  app.get('/api/search/full-text', handleFullTextSearch);
  app.use(progressRouter);
  app.use(bugsRouter);
  app.use(notesRouter);
  app.use(opdsRouter);
  app.use(komgaCompatRouter);
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
  app.use(challengesRouter);
  app.use(downloadsRouter);
  app.use(readlistsRouter);
  app.use(roomsRouter);
  app.use('/api/events', eventsRouter);

  // ── Base Server Health, Version & Config Endpoints ──────────────────────────
  app.get("/api/health", (req, res) => {
    const isHost = isHostRequest(req);
    res.json({
      status: "ok",
      version: APP_VERSION,
      uptime: Math.floor(process.uptime()),
      uptimeSeconds: Math.floor(process.uptime()),
      seriesCount: SqliteDb.getMangaCount(),
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

  app.post("/api/settings/cache/clear", (_req, res) => {
    const before = kotatsuImageEngine.size();
    kotatsuImageEngine.clearCache();
    res.json({
      success: true,
      message: `All caches cleared: Kotatsu page-list cache flushed (${before} entries).`,
      clearedEntries: before,
    });
  });

  return app;
}

export const app = createApp();
