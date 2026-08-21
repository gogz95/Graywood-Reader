import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  createBackupNow,
  listLocalBackups,
  restoreLocalBackup,
  deleteLocalBackup,
  shouldRunAutoBackup,
  getBackupsDirectory,
} from '../server/services/autoBackupService';
import { appSettings, mangaDatabase, replaceMangaDatabase } from '../server/appState';

describe('Auto Backup Service', () => {
  const backupDir = getBackupsDirectory();
  const createdFiles: string[] = [];

  beforeEach(() => {
    appSettings.autoBackupEnabled = true;
    appSettings.autoBackupSchedule = 'daily';
    appSettings.autoBackupMaxCount = 5;
    appSettings.autoBackupLastRun = '';
  });

  afterAll(() => {
    for (const f of createdFiles) {
      try {
        const p = path.join(backupDir, f);
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch {}
    }
  });

  it('creates a local timestamped backup JSON', () => {
    const result = createBackupNow('test_run');
    expect(result.success).toBe(true);
    expect(result.filename).toBeDefined();
    if (result.filename) {
      createdFiles.push(result.filename);
      const filePath = path.join(backupDir, result.filename);
      expect(fs.existsSync(filePath)).toBe(true);

      const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      expect(content.version).toBe(2);
      expect(content.generator).toContain('Graywood-Reader');
    }
  });

  it('lists existing backups sorted by date', () => {
    const list = listLocalBackups();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThan(0);
    expect(list[0].filename).toBeDefined();
    expect(list[0].sizeBytes).toBeGreaterThan(0);
  });

  it('restores database state from a backup file', () => {
    const testItem = {
      id: 'test_backup_series_1',
      title: 'Solo Backup Leveling',
      sourceName: 'Asura Scans',
      sourceUrl: 'https://asurascans.com/comics/solo-backup-leveling',
      latestChapter: 100,
      currentChapter: 50,
      userProgress: 50,
      readingStatus: 'reading' as const,
      isFavorite: true,
      genres: ['Action', 'Fantasy'],
      type: 'manhwa' as const,
    };
    replaceMangaDatabase([testItem as any]);

    const created = createBackupNow('restore_test');
    expect(created.success).toBe(true);
    if (created.filename) createdFiles.push(created.filename);

    // Clear database
    replaceMangaDatabase([]);
    expect(mangaDatabase.length).toBe(0);

    // Restore
    if (created.filename) {
      const restored = restoreLocalBackup(created.filename);
      expect(restored.success).toBe(true);
      expect(mangaDatabase.length).toBe(1);
      expect(mangaDatabase[0].title).toBe('Solo Backup Leveling');
    }
  });

  it('deletes backup file successfully', () => {
    const created = createBackupNow('delete_test');
    expect(created.success).toBe(true);
    if (created.filename) {
      const del = deleteLocalBackup(created.filename);
      expect(del.success).toBe(true);
      const filePath = path.join(backupDir, created.filename);
      expect(fs.existsSync(filePath)).toBe(false);
    }
  });

  it('correctly calculates shouldRunAutoBackup', () => {
    appSettings.autoBackupEnabled = false;
    expect(shouldRunAutoBackup()).toBe(false);

    appSettings.autoBackupEnabled = true;
    appSettings.autoBackupLastRun = '';
    expect(shouldRunAutoBackup()).toBe(true);

    // Last run 2 hours ago with daily schedule -> false
    appSettings.autoBackupLastRun = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    appSettings.autoBackupSchedule = 'daily';
    expect(shouldRunAutoBackup()).toBe(false);

    // Last run 2 hours ago with hourly schedule -> true
    appSettings.autoBackupSchedule = 'hourly';
    expect(shouldRunAutoBackup()).toBe(true);
  });
});
