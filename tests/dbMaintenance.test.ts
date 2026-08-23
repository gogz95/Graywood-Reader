import { describe, it, expect } from 'vitest';
import { SqliteDb } from '../sqlite-db';

describe('Database Maintenance & Vacuum Engine', () => {
  it('executes performDatabaseMaintenance without errors and returns valid metrics', () => {
    const result = SqliteDb.performDatabaseMaintenance({
      vacuum: false,
      purgeExpiredCache: true,
      trimLogsDays: 30,
    });

    expect(result.success).toBe(true);
    expect(result.walCheckpointed).toBe(true);
    expect(typeof result.initialSizeBytes).toBe('number');
    expect(typeof result.finalSizeBytes).toBe('number');
    expect(typeof result.expiredCachePurged).toBe('number');
    expect(typeof result.logsTrimmed).toBe('number');
  });

  it('purges expired cache entries when running maintenance', () => {
    const pages = ['https://example.com/cdn/p1.jpg', 'https://example.com/cdn/p2.jpg'];

    // Expired cache with negative TTL
    SqliteDb.setCachedChapterPages('test_manga_maint_1', 1, 'https://example.com/1', pages, -1000);
    // Valid cache with positive TTL
    SqliteDb.setCachedChapterPages('test_manga_maint_2', 1, 'https://example.com/2', pages, 60 * 60 * 1000);

    const result = SqliteDb.performDatabaseMaintenance({
      vacuum: false,
      purgeExpiredCache: true,
    });

    expect(result.success).toBe(true);
    expect(result.expiredCachePurged).toBeGreaterThanOrEqual(1);

    const valid = SqliteDb.getCachedChapterPages('test_manga_maint_2', 1, 'https://example.com/2');
    expect(valid).not.toBeNull();
    expect(valid?.pages).toEqual(pages);
  });

  it('handles VACUUM option safely', () => {
    const result = SqliteDb.performDatabaseMaintenance({
      vacuum: true,
      purgeExpiredCache: true,
      trimLogsDays: 30,
    });

    expect(result.success).toBe(true);
    expect(result.vacuumExecuted).toBe(true);
    expect(result.pageCount).toBeGreaterThan(0);
  });
});
