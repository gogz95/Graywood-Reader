import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import AdmZip from 'adm-zip';
import { SqliteDb } from '../../sqlite-db';
import {
  mangaDatabase,
  userProfiles,
  syncConfig,
  appSettings,
  setUserProfiles,
  setSyncConfig,
  setAppSettings,
  setAutoUpdateLogs,
  reloadMangaFromSql,
  buildEncryptedProfiles,
  buildEncryptedSettings,
  saveDatabaseToDisk,
  flushStateNow,
} from '../appState';
import { APP_VERSION } from '../version';
import { logger } from '../logger';
import { createBackupNow, getBackupsDirectory } from './autoBackupService';

export interface MigrationManifest {
  formatVersion: number;
  appVersion: string;
  exportedAt: string;
  generator: string;
  tableCounts: {
    manga: number;
    categories: number;
    profiles: number;
    readingProgress: number;
    stickyNotes: number;
    activity: number;
  };
  checksums: Record<string, string>;
}

export interface MigrationRestoreResult {
  success: boolean;
  message: string;
  tableCounts?: {
    manga: number;
    categories: number;
    profiles: number;
    readingProgress: number;
    stickyNotes: number;
  };
  safetyBackupFile?: string;
  error?: string;
}

function calculateSha256(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Generates a complete server migration ZIP package containing SQLite DB,
 * full portable JSON table dumps, settings, extensions, and manifest.
 */
export async function createMigrationPackage(options: { customLabel?: string } = {}): Promise<{
  filename: string;
  filepath: string;
  buffer: Buffer;
  manifest: MigrationManifest;
}> {
  const backupsDir = getBackupsDirectory();
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const suffix = options.customLabel ? `_${options.customLabel.replace(/[^a-zA-Z0-9_-]/g, '')}` : '';
  const filename = `graywood_migration_${stamp}${suffix}.zip`;
  const filepath = path.join(backupsDir, filename);

  const zip = new AdmZip();
  const checksums: Record<string, string> = {};

  // 1. Export unified JSON database dump
  const fullDump = SqliteDb.exportFullDatabaseDump();
  const dumpJson = JSON.stringify(fullDump, null, 2);
  const dumpBuffer = Buffer.from(dumpJson, 'utf8');
  zip.addFile('database_dump.json', dumpBuffer);
  checksums['database_dump.json'] = calculateSha256(dumpBuffer);

  // 2. Binary live SQLite database backup (VACUUM/checkpoint safe)
  const tempDbPath = path.join(backupsDir, `temp_live_${Date.now()}.db`);
  try {
    await SqliteDb.createLiveDatabaseBackup(tempDbPath);
    if (fs.existsSync(tempDbPath)) {
      const dbBuffer = fs.readFileSync(tempDbPath);
      zip.addFile('manga.db', dbBuffer);
      checksums['manga.db'] = calculateSha256(dbBuffer);
    }
  } catch (err: any) {
    logger.warn('Migration', 'Could not create binary SQLite snapshot; relying on database_dump.json', { error: err.message });
  } finally {
    if (fs.existsSync(tempDbPath)) {
      try { fs.unlinkSync(tempDbPath); } catch {}
    }
  }

  // 3. System settings & sync configuration
  const settingsPayload = {
    appSettings: buildEncryptedSettings(),
    syncConfig,
    userProfiles: buildEncryptedProfiles(),
  };
  const settingsJson = JSON.stringify(settingsPayload, null, 2);
  const settingsBuffer = Buffer.from(settingsJson, 'utf8');
  zip.addFile('server_config.json', settingsBuffer);
  checksums['server_config.json'] = calculateSha256(settingsBuffer);

  // 4. Extensions if any exist in data/extensions
  const extDir = path.join(process.cwd(), 'data', 'extensions');
  if (fs.existsSync(extDir)) {
    try {
      const extFiles = fs.readdirSync(extDir);
      for (const ef of extFiles) {
        const fullEf = path.join(extDir, ef);
        if (fs.statSync(fullEf).isFile()) {
          const efBuf = fs.readFileSync(fullEf);
          zip.addFile(`extensions/${ef}`, efBuf);
        }
      }
    } catch {}
  }

  // 5. Manifest metadata
  const manifest: MigrationManifest = {
    formatVersion: 2,
    appVersion: APP_VERSION,
    exportedAt: now.toISOString(),
    generator: `Graywood-Reader Migration Engine v${APP_VERSION}`,
    tableCounts: {
      manga: fullDump.manga.length,
      categories: fullDump.categories.length,
      profiles: fullDump.profiles.length,
      readingProgress: fullDump.readingProgress.length,
      stickyNotes: fullDump.pageStickyNotes.length,
      activity: fullDump.readingActivity.length,
    },
    checksums,
  };

  const manifestBuffer = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');
  zip.addFile('manifest.json', manifestBuffer);

  const zipBuffer = zip.toBuffer();
  fs.writeFileSync(filepath, zipBuffer);

  logger.info('Migration', `Created full server migration package ${filename} (${zipBuffer.length} bytes, ${fullDump.manga.length} series)`);

  return {
    filename,
    filepath,
    buffer: zipBuffer,
    manifest,
  };
}

/**
 * Restores full server state from a migration package (.zip or .json).
 */
export async function restoreMigrationPackage(
  input: string | Buffer,
  options: { mode?: 'replace' | 'merge' } = { mode: 'replace' }
): Promise<MigrationRestoreResult> {
  // Step 1: Create an emergency safety snapshot before touching database
  let safetyBackupFile = '';
  try {
    const safety = createBackupNow('pre_migration_safety');
    if (safety.success && safety.filename) {
      safetyBackupFile = safety.filename;
    }
  } catch (err: any) {
    logger.warn('Migration', 'Could not create pre-migration safety snapshot:', { error: err.message });
  }

  try {
    let rawBuffer: Buffer;
    if (typeof input === 'string') {
      if (!fs.existsSync(input)) {
        return { success: false, message: `Migration package file not found: ${input}` };
      }
      rawBuffer = fs.readFileSync(input);
    } else {
      rawBuffer = input;
    }

    if (rawBuffer.length === 0) {
      return { success: false, message: 'Migration package is empty.' };
    }

    // Check if package is a ZIP or JSON
    const isZip = rawBuffer.length > 4 && rawBuffer[0] === 0x50 && rawBuffer[1] === 0x4b; // 'PK' magic number
    let dumpPayload: any = null;
    let configPayload: any = null;

    if (isZip) {
      const zip = new AdmZip(rawBuffer);
      const zipEntries = zip.getEntries();

      // Look for database_dump.json or manifest
      const dumpEntry = zipEntries.find((e) => e.entryName === 'database_dump.json');
      const configEntry = zipEntries.find((e) => e.entryName === 'server_config.json');

      if (dumpEntry) {
        const text = dumpEntry.getData().toString('utf8');
        dumpPayload = JSON.parse(text);
      } else {
        // Fallback: Check if there is a root json file
        const anyJson = zipEntries.find((e) => e.entryName.endsWith('.json') && !e.entryName.includes('/'));
        if (anyJson) {
          const text = anyJson.getData().toString('utf8');
          dumpPayload = JSON.parse(text);
        }
      }

      if (configEntry) {
        try {
          configPayload = JSON.parse(configEntry.getData().toString('utf8'));
        } catch {}
      }

      // Restore extensions if present in ZIP
      const extEntries = zipEntries.filter((e) => e.entryName.startsWith('extensions/') && !e.isDirectory);
      if (extEntries.length > 0) {
        const extDir = path.join(process.cwd(), 'data', 'extensions');
        if (!fs.existsSync(extDir)) fs.mkdirSync(extDir, { recursive: true });
        for (const entry of extEntries) {
          const baseName = path.basename(entry.entryName);
          if (baseName) {
            fs.writeFileSync(path.join(extDir, baseName), entry.getData());
          }
        }
      }
    } else {
      // Direct JSON file
      const text = rawBuffer.toString('utf8');
      dumpPayload = JSON.parse(text);
    }

    if (!dumpPayload) {
      return { success: false, message: 'Invalid migration package: No database dump found.' };
    }

    // Step 2: Import all tables into SQLite atomically
    const metrics = SqliteDb.importFullDatabaseDump(dumpPayload, { mode: options.mode || 'replace' });

    // Step 3: Refresh in-memory server state
    reloadMangaFromSql();

    const storedProfiles = SqliteDb.getAllProfiles();
    if (storedProfiles.length > 0) {
      setUserProfiles(storedProfiles);
    } else if (Array.isArray(dumpPayload.userProfiles) && dumpPayload.userProfiles.length > 0) {
      setUserProfiles(dumpPayload.userProfiles);
    }

    const storedSettingsRaw = SqliteDb.getSetting('appSettings');
    if (storedSettingsRaw) {
      try {
        const parsed = JSON.parse(storedSettingsRaw);
        setAppSettings({ ...appSettings, ...parsed });
      } catch {}
    } else if (configPayload?.appSettings) {
      setAppSettings({ ...appSettings, ...configPayload.appSettings });
    }

    const storedSyncConfigRaw = SqliteDb.getSetting('syncConfig');
    if (storedSyncConfigRaw) {
      try {
        const parsed = JSON.parse(storedSyncConfigRaw);
        setSyncConfig({ ...syncConfig, ...parsed, totalTracked: mangaDatabase.length });
      } catch {}
    } else if (configPayload?.syncConfig) {
      setSyncConfig({ ...syncConfig, ...configPayload.syncConfig, totalTracked: mangaDatabase.length });
    }

    const storedLogs = SqliteDb.getAllLogs();
    if (storedLogs.length > 0) {
      setAutoUpdateLogs(storedLogs);
    }

    // Flush and notify
    try { flushStateNow(); } catch { saveDatabaseToDisk(); }

    logger.info('Migration', `Server migration successfully restored: ${metrics.mangaCount} series, ${metrics.categoriesCount} categories, ${metrics.progressCount} progress records, ${metrics.notesCount} notes.`);

    return {
      success: true,
      message: `Successfully migrated server: restored ${metrics.mangaCount} series, ${metrics.categoriesCount} categories, ${metrics.progressCount} reading progress records, and ${metrics.notesCount} sticky notes.`,
      tableCounts: {
        manga: metrics.mangaCount,
        categories: metrics.categoriesCount,
        profiles: metrics.profilesCount,
        readingProgress: metrics.progressCount,
        stickyNotes: metrics.notesCount,
      },
      safetyBackupFile,
    };
  } catch (err: any) {
    logger.error('Migration', 'Migration restore failed:', { error: err.message });
    return {
      success: false,
      message: `Server migration failed: ${err.message}`,
      error: err.message,
      safetyBackupFile,
    };
  }
}
