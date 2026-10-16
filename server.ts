// ============================================================================
// server.ts — Graywood Reader Server Bootstrap & Process Lifecycle
// ============================================================================

import express from "express";
import path from "path";
import fs from "fs";
import { SqliteDb } from "./db";
import { app, createApp, sourceCustomCookies, sourceCustomUserAgents } from "./server/app";
import { closeAllProgressSseClients } from "./server/routes/progress";
import { closeAllEventsSseClients } from "./server/routes/events";
import { loadSourceHealthMap } from "./server/services/sourceHealthService";
import { syncEngineRegistryFromCatalog, normalizeLiveTargetUrl } from "./server/services/crawlerEngine";
import { APP_VERSION } from "./server/version";
import { logger } from "./server/logger";
import { JobRunner } from "./server/jobs/jobRunner";
import {
  userProfiles,
  saveDatabaseToDisk,
  flushStateNow,
  cancelPendingSave,
  loadDatabaseFromDisk,
  purgeReaperScansFromAllStorage,
  syncAddOrUpdateManga,
} from "./server/appState";

export { app, createApp, sourceCustomCookies, sourceCustomUserAgents, JobRunner };

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const HOST = process.env.HOST || "0.0.0.0";

function migrateStaleSourceUrlsInDatabase(): number {
  let changed = 0;
  for (const m of SqliteDb.getAllManga()) {
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

// ── Versioned One-Time Startup Migrations ──────────────────────────────────
function runOnceStartupMigrations() {
  const currentVersion = parseInt(SqliteDb.getSetting('migration_version') || '0', 10);
  let nextVersion = currentVersion;

  if (currentVersion < 1) {
    try { purgeReaperScansFromAllStorage(); } catch {}
    nextVersion = 1;
  }
  if (currentVersion < 2) {
    try { migrateStaleSourceUrlsInDatabase(); } catch {}
    nextVersion = 2;
  }
  if (currentVersion < 3) {
    try { migrateStaleSourceUrlsInDatabase(); } catch {}
    nextVersion = 3;
  }

  if (nextVersion > currentVersion) {
    SqliteDb.setSetting('migration_version', String(nextVersion));
    logger.info('Migrations', `Ran startup migrations v${currentVersion} → v${nextVersion}`);
  }
}

// ── HTTP Server Boot & Graceful Shutdown ─────────────────────────────────────
let httpServer: ReturnType<typeof app.listen> | null = null;
let isShuttingDown = false;

export async function startServer() {
  loadDatabaseFromDisk();
  loadSourceHealthMap();
  syncEngineRegistryFromCatalog();
  runOnceStartupMigrations();

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

  // Global Express Error Handler Middleware
  app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || 'Internal Server Error';
    logger.error('UnhandledError', `${req.method} ${req.originalUrl || req.url} failed: ${message}`, {
      status,
      stack: err.stack,
      path: req.path,
    });
    if (res.headersSent) return;
    res.status(status).json({
      error: message,
      status,
      timestamp: new Date().toISOString(),
    });
  });

  httpServer = app.listen(PORT, HOST, () => {
    logger.info('Startup', `Graywood Reader v${APP_VERSION} running on http://${HOST}:${PORT}`);
    logger.info('Startup', `SQLite database ready (${SqliteDb.getMangaCount()} series, ${userProfiles.length} users)`);
  });

  JobRunner.startAllJobs();
}

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  startServer().catch((err) => {
    logger.error('Startup', 'Fatal error during server startup', { error: String(err) });
    process.exit(1);
  });
}

process.on('unhandledRejection', (reason) => {
  logger.error('System', 'Unhandled promise rejection', { reason: String(reason) });
});

function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info('Shutdown', `Received ${signal}. Closing active connections & flushing state to SQLite...`);

  // Stop all background scheduler timers
  try {
    JobRunner.stopAllJobs();
  } catch (schedErr) {
    logger.error('Shutdown', 'Error while stopping background schedulers', { error: String(schedErr) });
  }

  try {
    closeAllProgressSseClients('Server is shutting down');
    closeAllEventsSseClients('Server is shutting down');
  } catch (err) {
    logger.error('Shutdown', 'Error while closing SSE connections', { error: String(err) });
  }
  try {
    cancelPendingSave();
    flushStateNow();
    logger.flush();
  } catch (err) {
    logger.error('Shutdown', 'Error while flushing state', { error: String(err) });
  }

  try {
    SqliteDb.close();
  } catch (err) {
    logger.error('Shutdown', 'Error while closing SQLite database', { error: String(err) });
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
