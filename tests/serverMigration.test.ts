import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { SqliteDb } from '../sqlite-db';
import {
  createMigrationPackage,
  restoreMigrationPackage,
} from '../server/services/migrationService';
import { getBackupsDirectory } from '../server/services/autoBackupService';
import {
  mangaDatabase,
  replaceMangaDatabase,
  userProfiles,
  setUserProfiles,
  appSettings,
  syncConfig,
} from '../server/appState';
import { MangaItem } from '../src/types';

describe('Server Migration & Disaster Recovery Engine', () => {
  const backupsDir = getBackupsDirectory();
  const createdFiles: string[] = [];

  const sampleSeries: any[] = [
    {
      id: 'manga_mig_1',
      title: 'Solo Leveling: Server Migration Edition',
      sourceName: 'Asura Scans',
      sourceUrl: 'https://asurascans.com/comics/solo-leveling-migration',
      latestChapter: 200,
      currentChapter: 150,
      status: 'reading',
      isFavorite: true,
      genres: ['Action', 'Fantasy'],
      type: 'manhwa',
      lastUpdated: new Date().toISOString(),
      categories: ['Action Favs'],
    },
    {
      id: 'manga_mig_2',
      title: 'Omniscient Reader: Server Move',
      sourceName: 'Flame Comics',
      sourceUrl: 'https://flamecomics.com/series/orv-move',
      latestChapter: 180,
      currentChapter: 90,
      status: 'completed',
      isFavorite: true,
      genres: ['Adventure', 'Supernatural'],
      type: 'manhwa',
      lastUpdated: new Date().toISOString(),
    },
  ];

  beforeEach(() => {
    // Clean prior test artifacts
    try { SqliteDb.deleteCategory('cat_mig_1', 'usr_admin'); } catch {}

    // Seed test series
    SqliteDb.bulkUpsertManga(sampleSeries as MangaItem[]);
    replaceMangaDatabase(sampleSeries as MangaItem[]);

    // Seed test category
    SqliteDb.createCategory({
      id: 'cat_mig_1',
      userId: 'usr_admin',
      name: 'Action Favs',
      color: '#3b82f6',
      icon: 'Bookmark',
      sortOrder: 1,
      createdAt: new Date().toISOString(),
      seriesCount: 1,
    });
    SqliteDb.setMangaCategories('manga_mig_1', ['cat_mig_1'], 'usr_admin');

    // Seed sticky note
    SqliteDb.saveStickyNote({
      id: 'note_mig_1',
      mangaId: 'manga_mig_1',
      chapterNumber: 150,
      pageIndex: 5,
      noteText: 'Critical plot twist on page 5 before migration',
      color: 'purple',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      userId: 'usr_admin',
    });

    // Seed reading progress
    SqliteDb.upsertReadingProgress({
      manga_id: 'manga_mig_1',
      user_id: 'usr_admin',
      chapter_number: 150,
      page_index: 5,
      page_count: 20,
      percent: 25,
    });
  });

  afterAll(() => {
    for (const f of createdFiles) {
      try {
        const p = path.join(backupsDir, f);
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch {}
    }
  });

  it('exports full database dump including all tables', () => {
    const dump = SqliteDb.exportFullDatabaseDump();
    expect(dump.version).toBe(2);
    expect(Array.isArray(dump.manga)).toBe(true);
    expect(dump.manga.some((m) => m.id === 'manga_mig_1')).toBe(true);

    expect(Array.isArray(dump.categories)).toBe(true);
    expect(dump.categories.some((c) => c.id === 'cat_mig_1')).toBe(true);

    expect(Array.isArray(dump.pageStickyNotes)).toBe(true);
    expect(dump.pageStickyNotes.some((n) => n.id === 'note_mig_1')).toBe(true);

    expect(Array.isArray(dump.readingProgress)).toBe(true);
    expect(dump.readingProgress.some((p) => p.manga_id === 'manga_mig_1')).toBe(true);
  });

  it('generates a full migration ZIP bundle with manifest and checksums', async () => {
    const pkg = await createMigrationPackage({ customLabel: 'test_migration' });
    expect(pkg.filename).toContain('graywood_migration_');
    expect(pkg.filename).toContain('test_migration.zip');
    expect(pkg.filepath).toBeDefined();
    expect(pkg.buffer.length).toBeGreaterThan(0);
    createdFiles.push(pkg.filename);

    expect(pkg.manifest.formatVersion).toBe(2);
    expect(pkg.manifest.tableCounts.manga).toBeGreaterThanOrEqual(2);
    expect(pkg.manifest.checksums['database_dump.json']).toBeDefined();
    expect(pkg.manifest.checksums['server_config.json']).toBeDefined();

    expect(fs.existsSync(pkg.filepath)).toBe(true);
  });

  it('completely restores database state from a migration ZIP package', async () => {
    // 1. Create migration package
    const pkg = await createMigrationPackage({ customLabel: 'restore_test' });
    createdFiles.push(pkg.filename);

    // 2. Wipe database tables
    SqliteDb.deleteAllManga();
    replaceMangaDatabase([]);
    expect(mangaDatabase.length).toBe(0);
    expect(SqliteDb.getMangaById('manga_mig_1')).toBeNull();

    // 3. Restore from migration package
    const result = await restoreMigrationPackage(pkg.filepath);
    expect(result.success).toBe(true);
    expect(result.tableCounts?.manga).toBeGreaterThanOrEqual(2);

    // 4. Verify series, categories, sticky notes, and progress were restored
    const restoredManga = SqliteDb.getMangaById('manga_mig_1');
    expect(restoredManga).not.toBeNull();
    expect(restoredManga?.title).toBe('Solo Leveling: Server Migration Edition');

    const cats = SqliteDb.getCategories('usr_admin');
    expect(cats.some((c) => c.name === 'Action Favs')).toBe(true);

    const notes = SqliteDb.getStickyNotes('manga_mig_1', 'usr_admin');
    expect(notes.some((n) => n.noteText.includes('plot twist'))).toBe(true);

    const progress = SqliteDb.getReadingProgressForChapter('manga_mig_1', 'usr_admin', 150);
    expect(progress).not.toBeNull();
    expect(progress?.page_index).toBe(5);
  });

  it('restores from a unified JSON dump payload', async () => {
    const dump = SqliteDb.exportFullDatabaseDump();
    const jsonBuffer = Buffer.from(JSON.stringify(dump), 'utf8');

    // Wipe database
    SqliteDb.deleteAllManga();
    replaceMangaDatabase([]);
    expect(mangaDatabase.length).toBe(0);

    // Restore from JSON buffer
    const result = await restoreMigrationPackage(jsonBuffer);
    expect(result.success).toBe(true);

    const restored = SqliteDb.getMangaById('manga_mig_1');
    expect(restored).not.toBeNull();
    expect(restored?.title).toBe('Solo Leveling: Server Migration Edition');
  });

  it('safely rejects corrupt or empty migration payload and takes safety snapshot', async () => {
    const corruptBuffer = Buffer.from('invalid non-json non-zip data');
    const result = await restoreMigrationPackage(corruptBuffer);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.safetyBackupFile).toBeDefined();
    if (result.safetyBackupFile) {
      createdFiles.push(result.safetyBackupFile);
    }
  });
});
