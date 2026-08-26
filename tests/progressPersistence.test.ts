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
});
