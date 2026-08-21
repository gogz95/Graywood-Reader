// ============================================================================
// SCHEDULED AUTO-BACKUP SERVICE
// Automatically generates and rotates JSON database snapshots to ./data/backups/
// ============================================================================

import fs from 'fs';
import path from 'path';
import { mangaDatabase, userProfiles, autoUpdateLogs, syncConfig, appSettings, saveDatabaseToDisk, replaceMangaDatabase } from '../appState';
import { SqliteDb } from '../../sqlite-db';

export interface BackupFileInfo {
  filename: string;
  sizeBytes: number;
  createdAt: string;
  seriesCount: number;
}

let schedulerTimer: NodeJS.Timeout | null = null;

export function getBackupsDirectory(): string {
  const dir = path.join(process.cwd(), 'data', 'backups');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function listLocalBackups(): BackupFileInfo[] {
  try {
    const dir = getBackupsDirectory();
    const files = fs.readdirSync(dir);
    const results: BackupFileInfo[] = [];

    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const fullPath = path.join(dir, f);
      try {
        const stat = fs.statSync(fullPath);
        let seriesCount = 0;
        try {
          const raw = fs.readFileSync(fullPath, 'utf8');
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed?.mangaDatabase)) {
            seriesCount = parsed.mangaDatabase.length;
          } else if (Array.isArray(parsed?.data)) {
            seriesCount = parsed.data.length;
          } else if (Array.isArray(parsed)) {
            seriesCount = parsed.length;
          }
        } catch {
          // non-critical parse failure for metadata
        }

        results.push({
          filename: f,
          sizeBytes: stat.size,
          createdAt: stat.mtime.toISOString(),
          seriesCount,
        });
      } catch {
        // file stat error
      }
    }

    return results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch (err: any) {
    console.error('[Auto Backup] Failed to list backups:', err.message);
    return [];
  }
}

export function createBackupNow(customLabel = ''): { success: boolean; filename?: string; error?: string } {
  try {
    const dir = getBackupsDirectory();
    const now = new Date();
    const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const suffix = customLabel ? `_${customLabel.replace(/[^a-zA-Z0-9_-]/g, '')}` : '';
    const filename = `graywood_backup_${stamp}${suffix}.json`;
    const fullPath = path.join(dir, filename);

    // Build complete export snapshot
    const payload = {
      version: 2,
      exportedAt: now.toISOString(),
      generator: 'Graywood-Reader Auto-Backup',
      totalSeries: mangaDatabase.length,
      mangaDatabase,
      userProfiles,
      syncConfig,
      autoUpdateLogs: autoUpdateLogs.slice(0, 100),
    };

    fs.writeFileSync(fullPath, JSON.stringify(payload, null, 2), 'utf8');
    appSettings.autoBackupLastRun = now.toISOString();

    // Enforce rolling retention limit
    const maxCount = Math.max(1, Number(appSettings.autoBackupMaxCount) || 10);
    const existing = listLocalBackups();
    if (existing.length > maxCount) {
      const toDelete = existing.slice(maxCount);
      for (const item of toDelete) {
        try {
          fs.unlinkSync(path.join(dir, item.filename));
          console.log(`[Auto Backup] Evicted old backup snapshot: ${item.filename}`);
        } catch {}
      }
    }

    console.log(`[Auto Backup] Created snapshot ${filename} (${(payload.totalSeries)} series)`);
    return { success: true, filename };
  } catch (err: any) {
    console.error('[Auto Backup] Creation error:', err.message);
    return { success: false, error: err.message };
  }
}

export function restoreLocalBackup(filename: string): { success: boolean; message: string; seriesCount?: number } {
  try {
    const safeName = path.basename(filename);
    const fullPath = path.join(getBackupsDirectory(), safeName);
    if (!fs.existsSync(fullPath)) {
      return { success: false, message: `Backup file ${safeName} does not exist.` };
    }

    const raw = fs.readFileSync(fullPath, 'utf8');
    const parsed = JSON.parse(raw);

    let itemsToRestore: any[] = [];
    if (Array.isArray(parsed?.mangaDatabase)) {
      itemsToRestore = parsed.mangaDatabase;
    } else if (Array.isArray(parsed?.data)) {
      itemsToRestore = parsed.data;
    } else if (Array.isArray(parsed)) {
      itemsToRestore = parsed;
    } else {
      return { success: false, message: 'Invalid backup structure: No manga database array found.' };
    }

    // Replace in-memory database
    replaceMangaDatabase(itemsToRestore);

    // Save to SQLite
    SqliteDb.bulkUpsertManga(itemsToRestore);

    // Save legacy JSON backup if configured
    saveDatabaseToDisk();

    console.log(`[Auto Backup] Restored ${itemsToRestore.length} series from ${safeName}`);
    return {
      success: true,
      message: `Successfully restored ${itemsToRestore.length} series from ${safeName}.`,
      seriesCount: itemsToRestore.length,
    };
  } catch (err: any) {
    console.error('[Auto Backup] Restore error:', err.message);
    return { success: false, message: `Failed to restore backup: ${err.message}` };
  }
}

export function deleteLocalBackup(filename: string): { success: boolean; error?: string } {
  try {
    const safeName = path.basename(filename);
    const fullPath = path.join(getBackupsDirectory(), safeName);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      return { success: true };
    }
    return { success: false, error: 'File not found' };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export function shouldRunAutoBackup(): boolean {
  if (!appSettings.autoBackupEnabled) return false;
  if (!appSettings.autoBackupLastRun) return true;

  const lastRunMs = new Date(appSettings.autoBackupLastRun).getTime();
  if (isNaN(lastRunMs)) return true;

  const nowMs = Date.now();
  const diffHours = (nowMs - lastRunMs) / (1000 * 60 * 60);

  const sched = appSettings.autoBackupSchedule || 'daily';
  if (sched === 'hourly' && diffHours >= 1) return true;
  if (sched === 'daily' && diffHours >= 24) return true;
  if (sched === 'weekly' && diffHours >= 168) return true;

  return false;
}

export function startAutoBackupScheduler(intervalMinutes = 30) {
  if (schedulerTimer) clearInterval(schedulerTimer);

  schedulerTimer = setInterval(() => {
    try {
      if (shouldRunAutoBackup()) {
        console.log('[Auto Backup] Running scheduled background snapshot...');
        createBackupNow('scheduled');
      }
    } catch (err: any) {
      console.error('[Auto Backup Scheduler] Error in periodic check:', err.message);
    }
  }, intervalMinutes * 60 * 1000);

  console.log(`[Auto Backup Scheduler] Initialized (interval ${intervalMinutes}m)`);
}
