// ============================================================================
// server/jobs/jobRunner.ts — Centralized Background Job Runner & Scheduler Registry
// Manages life-cycle, status reporting, and graceful shutdown of background jobs.
// ============================================================================

import { SqliteDb } from '../../db';
import { logger } from '../logger';
import { syncConfig } from '../appState';
import { autoUpdateLogs, autoUpdateStatus } from '../routes/tracker';
import { refreshSingleMangaMetadata } from '../services/metadataService';
import { dispatchNewChapterWebhooks } from '../services/webhookNotifier';
import { isSeriesFromDisabledSource } from '../sources/sourcesCatalog';
import { scheduleExploreRefresher, stopExploreRefresher } from '../services/exploreService';
import {
  initLibraryCache,
  startWeeklyLibraryCacheScheduler,
  stopWeeklyLibraryCacheScheduler,
} from '../services/libraryCacheService';
import {
  startAutoBackupScheduler,
  stopAutoBackupScheduler,
} from '../services/autoBackupService';

export interface JobStatusReport {
  autoUpdater: {
    running: boolean;
    intervalMinutes: number;
    isScanning: boolean;
    lastScanTimestamp: string;
    scannedCount: number;
    totalCount: number;
    newReleasesFound: number;
  };
  databaseMaintenance: {
    running: boolean;
    intervalHours: number;
  };
  exploreRefresher: {
    running: boolean;
  };
  libraryCache: {
    running: boolean;
    intervalHours: number;
  };
  autoBackup: {
    running: boolean;
    intervalMinutes: number;
  };
}

let backgroundAutoUpdaterTimer: NodeJS.Timeout | null = null;
let dbMaintenanceTimer: NodeJS.Timeout | null = null;
let isExploreRunning = false;
let isLibraryCacheRunning = false;
let isAutoBackupRunning = false;

// ── Rate-Spaced Background Auto-Updater ───────────────────────────────────────
export async function runLiveRateSpacedAutoUpdate(): Promise<void> {
  if (autoUpdateStatus.isScanning) return;

  const lastRunStr = SqliteDb.getSystemState('auto_update_last_run');
  if (lastRunStr) {
    const lastRunTime = new Date(lastRunStr).getTime();
    if (!isNaN(lastRunTime) && Date.now() - lastRunTime < 20 * 60 * 60 * 1000) {
      logger.info('AutoUpdater', `Skipping execution: Last run was at ${lastRunStr} (< 20h elapsed).`);
      return;
    }
  }

  autoUpdateStatus.isScanning = true;
  autoUpdateStatus.scannedCount = 0;
  autoUpdateStatus.newReleasesFound = 0;
  const nowIso = new Date().toISOString();
  autoUpdateStatus.lastScanTimestamp = nowIso;
  SqliteDb.setSystemState('auto_update_last_run', nowIso);

  // Prioritize reading series & favorites over cold catalog entries via indexed SQL.
  const activeSeries = SqliteDb.getMangaForAutoUpdate(150)
    .filter((m) => !isSeriesFromDisabledSource(m))
    .slice(0, 120);
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
        if (autoUpdateLogs.length > 100) autoUpdateLogs.pop();
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

export function scheduleBackgroundAutoUpdater(): void {
  if (backgroundAutoUpdaterTimer) clearInterval(backgroundAutoUpdaterTimer);
  const intervalMs = Math.max(1, syncConfig.autoUpdateIntervalMinutes || 30) * 60 * 1000;
  backgroundAutoUpdaterTimer = setInterval(() => {
    runLiveRateSpacedAutoUpdate().catch((e) => logger.error('AutoUpdater', 'Background auto-update error', { error: String(e) }));
  }, intervalMs);
}

export function stopBackgroundAutoUpdater(): void {
  if (backgroundAutoUpdaterTimer) {
    clearInterval(backgroundAutoUpdaterTimer);
    backgroundAutoUpdaterTimer = null;
  }
}

// ── Database Maintenance Scheduler ──────────────────────────────────────────
export function scheduleDatabaseMaintenance(): void {
  if (dbMaintenanceTimer) clearInterval(dbMaintenanceTimer);
  // Run lightweight maintenance daily (cache purge, log trim, WAL checkpoint & PRAGMA optimize)
  dbMaintenanceTimer = setInterval(() => {
    try {
      SqliteDb.performDatabaseMaintenance({ vacuum: false, purgeExpiredCache: true, trimLogsDays: 30 });
    } catch (err) {
      logger.error('SQLite', 'Scheduled database maintenance failed', { error: String(err) });
    }
  }, 24 * 60 * 60 * 1000);
}

export function stopDatabaseMaintenance(): void {
  if (dbMaintenanceTimer) {
    clearInterval(dbMaintenanceTimer);
    dbMaintenanceTimer = null;
  }
}

// ── JobRunner Registry & Controller ─────────────────────────────────────────
export const JobRunner = {
  startAllJobs(): void {
    logger.info('JobRunner', 'Starting all background scheduled jobs');
    try {
      initLibraryCache();
      scheduleBackgroundAutoUpdater();
      scheduleExploreRefresher();
      isExploreRunning = true;
      startWeeklyLibraryCacheScheduler(1);
      isLibraryCacheRunning = true;
      startAutoBackupScheduler(30);
      isAutoBackupRunning = true;
      scheduleDatabaseMaintenance();
    } catch (err) {
      logger.error('JobRunner', 'Failed to start one or more background jobs', { error: String(err) });
    }
  },

  stopAllJobs(): void {
    logger.info('JobRunner', 'Stopping all background scheduled jobs');
    try {
      stopBackgroundAutoUpdater();
      stopDatabaseMaintenance();
      stopExploreRefresher();
      isExploreRunning = false;
      stopWeeklyLibraryCacheScheduler();
      isLibraryCacheRunning = false;
      stopAutoBackupScheduler();
      isAutoBackupRunning = false;
    } catch (schedErr) {
      logger.error('JobRunner', 'Error while stopping background schedulers', { error: String(schedErr) });
    }
  },

  getJobStatus(): JobStatusReport {
    return {
      autoUpdater: {
        running: backgroundAutoUpdaterTimer !== null,
        intervalMinutes: syncConfig.autoUpdateIntervalMinutes || 30,
        isScanning: autoUpdateStatus.isScanning,
        lastScanTimestamp: autoUpdateStatus.lastScanTimestamp,
        scannedCount: autoUpdateStatus.scannedCount,
        totalCount: autoUpdateStatus.totalCount,
        newReleasesFound: autoUpdateStatus.newReleasesFound,
      },
      databaseMaintenance: {
        running: dbMaintenanceTimer !== null,
        intervalHours: 24,
      },
      exploreRefresher: {
        running: isExploreRunning,
      },
      libraryCache: {
        running: isLibraryCacheRunning,
        intervalHours: 1,
      },
      autoBackup: {
        running: isAutoBackupRunning,
        intervalMinutes: 30,
      },
    };
  },
};
