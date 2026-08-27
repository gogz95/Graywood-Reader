import { describe, it, expect } from 'vitest';
import { parseTachiyomiBackup, exportToTachiyomiBackup } from '../src/utils/tachiyomiImporter';

describe('Tachiyomi v2 import', () => {
  const backup = {
    version: 2,
    mangas: [
      {
        // Standard v2 tuple order:
        // [url, title, source, artist, author, description, genre, status, thumbnail_url, ...]
        manga: [
          'https://example.com/manga/1',
          'Solo Leveling',
          123,
          'Artist',
          'Author',
          'A great story',
          ['Action', 'Fantasy'],
          2, // status = COMPLETED
          'https://example.com/cover.jpg',
          1700000000000,
        ],
        categories: ['Favorites'],
        chapters: [
          { url: '/1', name: 'Chapter 1', chapter_number: 1, read: true, last_page_read: 10 },
          { url: '/2', name: 'Chapter 2', chapter_number: 2, read: true, last_page_read: 10 },
          { url: '/3', name: 'Chapter 3', chapter_number: 3, read: false },
        ],
      },
    ],
  };

  it('maps tuple fields to the correct metadata (no off-by-one)', () => {
    const items = parseTachiyomiBackup(JSON.stringify(backup), 'usr_test');
    expect(items).toHaveLength(1);
    const item = items[0];
    expect(item.title).toBe('Solo Leveling');
    expect(item.description).toBe('A great story');
    expect(item.genres).toEqual(['Action', 'Fantasy']);
    expect(item.status).toBe('completed'); // status code 2 -> completed
    expect(item.coverImage).toBe('https://example.com/cover.jpg');
    expect(item.isFavorite).toBe(true);
    expect(item.currentChapter).toBe(2);
    expect(item.totalChapters).toBe(3);
  });

  it('resolves category names from backupCategories index references', () => {
    const backupWithCategories = {
      version: 2,
      backupCategories: [
        { name: 'Reading List', order: 0 },
        { name: 'Top Tier Manhwa', order: 1 },
      ],
      backupManga: [
        {
          manga: ['https://example.com/manga/2', 'Omniscient Reader', 1, '', '', '', ['Manhwa'], 1, ''],
          categories: [0, 1],
        },
      ],
    };

    const items = parseTachiyomiBackup(JSON.stringify(backupWithCategories), 'usr_test');
    expect(items).toHaveLength(1);
    expect(items[0].categories).toContain('Reading List');
    expect(items[0].categories).toContain('Top Tier Manhwa');
  });

  it('correctly restores reading progress from tuple-based chapter lists', () => {
    const backupWithTupleChapters = {
      version: 2,
      mangas: [
        {
          manga: ['https://example.com/manga/tuple', 'Tuple Manga', 1, '', '', '', ['Action'], 1, ''],
          // Tuple format: [url, name, scanlator, read, bookmark, last_page_read, date_fetch, date_upload, chapter_number, source_order]
          chapters: [
            ['/c1', 'Chapter 1', '', true, false, 0, 0, 0, 1, 0],
            ['/c2', 'Chapter 2', '', true, false, 5, 0, 0, 2, 1],
            ['/c3', 'Chapter 3', '', false, false, 0, 0, 0, 3, 2],
          ],
        },
      ],
    };

    const items = parseTachiyomiBackup(JSON.stringify(backupWithTupleChapters), 'usr_test');
    expect(items).toHaveLength(1);
    expect(items[0].currentChapter).toBe(2);
    expect(items[0].totalChapters).toBe(3);
  });

  it('restores reading progress from tracking entries in Tachiyomi backups', () => {
    const backupWithTracks = {
      version: 2,
      mangas: [
        {
          manga: ['https://example.com/manga/tracked', 'Tracked Manga', 1, '', '', '', ['Action'], 1, ''],
          tracking: [
            { sync_id: 1, media_id: 999, last_chapter_read: 85, total_chapters: 150 },
          ],
        },
      ],
    };

    const items = parseTachiyomiBackup(JSON.stringify(backupWithTracks), 'usr_test');
    expect(items).toHaveLength(1);
    expect(items[0].currentChapter).toBe(85);
  });

  it('throws on invalid JSON / empty backup', () => {
    expect(() => parseTachiyomiBackup('not json')).toThrow();
    expect(() => parseTachiyomiBackup('{"mangas":[]}')).toThrow();
  });
});

describe('Tachiyomi export', () => {
  it('serializes valid JSON with a finite updated timestamp', () => {
    const out = exportToTachiyomiBackup([
      {
        id: 'x',
        title: 'Series',
        genres: ['Action'],
        status: 'completed',
        sourceUrl: '/manga/x',
        coverImage: '',
        lastUpdated: 'not-a-date',
        currentChapter: 0,
        totalChapters: 1,
      } as any,
    ]);
    const parsed = JSON.parse(out);
    expect(parsed.version).toBe(2);
    // manga[11] is the last_update timestamp field.
    expect(Number.isFinite(parsed.mangas[0].manga[11])).toBe(true);
  });
});
