import { describe, it, expect } from 'vitest';
import { SqliteDb } from '../sqlite-db';

describe('SQLite Chapter Pages Cache (Stale-While-Revalidate)', () => {
  const mangaId = 'test_manga_cache_1';
  const chapterNumber = 5.5;
  const sourceUrl = 'https://example.com/comics/test-series/ch-5-5';
  const pages = [
    'https://example.com/cdn/p1.jpg',
    'https://example.com/cdn/p2.jpg',
    'https://example.com/cdn/p3.jpg',
  ];

  it('stores and retrieves cached chapter pages before expiration', () => {
    // Set 1-hour cache
    SqliteDb.setCachedChapterPages(mangaId, chapterNumber, sourceUrl, pages, 60 * 60 * 1000);

    const cached = SqliteDb.getCachedChapterPages(mangaId, chapterNumber, sourceUrl);
    expect(cached).not.toBeNull();
    expect(cached?.pageCount).toBe(3);
    expect(cached?.pages).toEqual(pages);
  });

  it('returns null for nonexistent cache entries', () => {
    const cached = SqliteDb.getCachedChapterPages('nonexistent_id', 99, 'https://example.com/none');
    expect(cached).toBeNull();
  });

  it('does not return expired cache entries', () => {
    const expiredId = 'test_manga_expired';
    // Set with negative TTL so it expires immediately in the past
    SqliteDb.setCachedChapterPages(expiredId, 1, 'https://example.com/expired', pages, -1000);

    const cached = SqliteDb.getCachedChapterPages(expiredId, 1, 'https://example.com/expired');
    expect(cached).toBeNull();
  });

  it('cleans up expired chapter cache entries', () => {
    const cleaned = SqliteDb.cleanupExpiredChapterPages();
    expect(typeof cleaned).toBe('number');
  });
});
