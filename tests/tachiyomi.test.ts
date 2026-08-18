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
