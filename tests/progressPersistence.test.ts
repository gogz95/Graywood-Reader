import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteDb } from '../sqlite-db';
import { parseKotatsuBackup } from '../src/utils/kotatsuImporter';
import { parseTachiyomiBackup } from '../src/utils/tachiyomiImporter';

describe('Reading Progress Persistence for Missing Metadata & Missing Library Series', () => {
  beforeEach(() => {
    // Clean state for test series
    try {
      SqliteDb.deleteManga('manga_untracked_test_123');
      SqliteDb.deleteManga('manga_missing_meta_456');
    } catch {}
  });

  describe('SqliteDb.ensureMangaPlaceholder', () => {
    it('creates a clean fallback MangaItem when series is missing from the database', () => {
      const placeholder = SqliteDb.ensureMangaPlaceholder({
        id: 'manga_untracked_test_123',
        title: 'Untracked Web Series',
        sourceName: 'AsuraScans',
        sourceUrl: 'https://asurascans.com/manga/untracked',
        coverImage: 'https://example.com/cover.jpg',
        currentChapter: 42,
      });

      expect(placeholder.id).toBe('manga_untracked_test_123');
      expect(placeholder.title).toBe('Untracked Web Series');
      expect(placeholder.currentChapter).toBe(42);
      expect(placeholder.isFavorite).toBe(false);

      // Verify that getMangaById now returns this record
      const fetched = SqliteDb.getMangaById('manga_untracked_test_123');
      expect(fetched).toBeDefined();
      expect(fetched?.title).toBe('Untracked Web Series');
    });

    it('preserves existing manga if already in database without overwriting', () => {
      SqliteDb.ensureMangaPlaceholder({
        id: 'manga_missing_meta_456',
        title: 'Original Title',
      });

      const again = SqliteDb.ensureMangaPlaceholder({
        id: 'manga_missing_meta_456',
        title: 'New Attempt Title',
      });

      expect(again.title).toBe('Original Title');
    });
  });

  describe('Kotatsu Backup Import with History for Non-Library Series', () => {
    it('synthesizes and preserves reading progress from history records not in favourites', async () => {
      const kotatsuBackup = {
        version: 1,
        categories: [{ id: 1, name: 'Default' }],
        favourites: [
          // Only Solo Leveling is in favourites
          {
            categoryId: 1,
            manga: {
              id: 101,
              title: 'Solo Leveling In Library',
              url: '/solo',
              publicUrl: 'https://asurascans.com/solo',
              chapters: [{ id: 1, number: 1 }],
            },
          },
        ],
        history: [
          // History contains Tower of God, which was never in favourites
          {
            mangaId: 999,
            manga: {
              id: 999,
              title: 'Tower of God (From History)',
              url: '/tog',
              publicUrl: 'https://asurascans.com/tog',
            },
            chapter: { id: 50, number: 50, name: 'Chapter 50' },
            page: 12,
            updatedAt: 1700000000000,
          },
        ],
      };

      const imported = await parseKotatsuBackup(JSON.stringify(kotatsuBackup), 'usr_test');
      expect(imported.length).toBe(2);

      const historyItem = imported.find((m) => m.title.includes('Tower of God'));
      expect(historyItem).toBeDefined();
      expect(historyItem?.currentChapter).toBe(50);
      expect(historyItem?.isFavorite).toBe(false);
      expect(historyItem?.status).toBe('reading');
    });
  });

  describe('Tachiyomi Backup Import with History for Non-Library Series', () => {
    it('synthesizes and preserves reading progress from standalone history records', () => {
      const tachiyomiBackup = {
        version: 2,
        mangas: [
          {
            manga: ['https://example.com/m/1', 'In Library Series', 1, '', '', '', ['Manhwa'], 1, ''],
            chapters: [{ chapter_number: 10, read: true }],
          },
        ],
        history: [
          {
            title: 'Standalone History Series',
            url: 'https://example.com/m/external',
            chapterNumber: 88,
          },
        ],
      };

      const imported = parseTachiyomiBackup(JSON.stringify(tachiyomiBackup), 'usr_test');
      expect(imported.length).toBe(2);

      const historyItem = imported.find((m) => m.title === 'Standalone History Series');
      expect(historyItem).toBeDefined();
      expect(historyItem?.currentChapter).toBe(88);
      expect(historyItem?.isFavorite).toBe(false);
    });
  });

  describe('Reading Progress Upsert & Retrieval for Arbitrary Series', () => {
    it('persists and retrieves chapter reading progress with last read position', () => {
      SqliteDb.upsertReadingProgress({
        manga_id: 'manga_untracked_test_123',
        user_id: 'usr_test',
        chapter_number: 15,
        page_index: 7,
        page_count: 20,
        percent: 35,
      });

      const progressRows = SqliteDb.getReadingProgress('manga_untracked_test_123', 'usr_test');
      expect(progressRows.length).toBe(1);
      expect(progressRows[0].chapter_number).toBe(15);
      expect(progressRows[0].page_index).toBe(7);
      expect(progressRows[0].percent).toBe(35);
    });
  });

  describe('bulkApplyUserImportState and reading_progress synchronization', () => {
    it('populates reading_progress rows during bulk backup import so continue reading shelf works', () => {
      SqliteDb.bulkApplyUserImportState('usr_test_bulk', [
        {
          id: 'manga_bulk_import_1',
          currentChapter: 33,
          isFavorite: true,
          status: 'reading',
        },
        {
          id: 'manga_bulk_import_2',
          currentChapter: 77,
          isFavorite: false,
          status: 'reading',
        },
      ]);

      const p1 = SqliteDb.getReadingProgress('manga_bulk_import_1', 'usr_test_bulk');
      expect(p1.length).toBe(1);
      expect(p1[0].chapter_number).toBe(33);
      expect(p1[0].percent).toBe(100);

      const p2 = SqliteDb.getReadingProgress('manga_bulk_import_2', 'usr_test_bulk');
      expect(p2.length).toBe(1);
      expect(p2[0].chapter_number).toBe(77);

      // Verify user library state is populated
      const states = SqliteDb.getAllUserLibraryStates('usr_test_bulk');
      const s1 = states.find((s) => s.manga_id === 'manga_bulk_import_1');
      expect(s1).toBeDefined();
      expect(s1.current_chapter).toBe(33);
    });
  });

  describe('User Overlay currentChapter preservation', () => {
    it('does not downgrade non-zero manga currentChapter when user state has uninitialized 0', () => {
      const baseManga: any = {
        id: 'manga_overlay_test',
        title: 'Overlay Test Manga',
        currentChapter: 25,
        latestChapter: 50,
        status: 'reading',
        isFavorite: false,
        altTitles: [],
        genres: [],
      };

      const overlaid = SqliteDb.applyUserOverlayOne(baseManga, 'usr_new_test');
      expect(overlaid.currentChapter).toBe(25);
    });
  });

  describe('Full Database Dump Restoration with camelCase and snake_case Schemas', () => {
    it('restores reading_progress and user_library_state from camelCase payload', () => {
      const camelDump = {
        mangaDatabase: [
          {
            id: 'manga_camel_1',
            title: 'Camel Case Series',
            currentChapter: 40,
            latestChapter: 80,
            status: 'reading',
            isFavorite: true,
          },
        ],
        readingProgress: [
          {
            mangaId: 'manga_camel_1',
            userId: 'usr_camel_test',
            chapterNumber: 40,
            pageIndex: 12,
            pageCount: 30,
            percent: 40,
          },
        ],
        userLibraryState: [
          {
            mangaId: 'manga_camel_1',
            userId: 'usr_camel_test',
            currentChapter: 40,
            status: 'reading',
          },
        ],
      };

      SqliteDb.importFullDatabaseDump(camelDump, { mode: 'merge' });

      const progress = SqliteDb.getReadingProgress('manga_camel_1', 'usr_camel_test');
      expect(progress.length).toBe(1);
      expect(progress[0].chapter_number).toBe(40);
      expect(progress[0].page_index).toBe(12);
      expect(progress[0].percent).toBe(40);

      const states = SqliteDb.getAllUserLibraryStates('usr_camel_test');
      const s = states.find((x) => x.manga_id === 'manga_camel_1');
      expect(s).toBeDefined();
      expect(s.current_chapter).toBe(40);
    });
  });
});
