import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { db, SqliteDb, closeDatabase } from '../db';
import { normalizeChapterUrl, resolveChapterUrl } from '../server/sources/sourcesCatalog';
import { app } from '../server';

describe('Stage 3: Chapter Aggregation & Smart Mirror Fallback Engine', () => {
  const testMangaId = 'manga_mirror_test_1';

  beforeEach(() => {
    // Ensure clean state
    db.prepare('DELETE FROM manga_chapters WHERE manga_id = ?').run(testMangaId);
    db.prepare('DELETE FROM manga WHERE id = ?').run(testMangaId);

    // Insert test manga
    db.prepare(`
      INSERT INTO manga (id, title, sourceName, sourceUrl)
      VALUES (?, ?, ?, ?)
    `).run(
      testMangaId,
      'Solo Leveling Ragnarok',
      'Asura Scans',
      'https://asurascans.com/comics/solo-leveling-ragnarok'
    );
  });

  afterEach(() => {
    db.prepare('DELETE FROM manga_chapters WHERE manga_id = ?').run(testMangaId);
    db.prepare('DELETE FROM manga WHERE id = ?').run(testMangaId);
  });

  describe('Database Schema & Chapters DAL (db/chapters.ts)', () => {
    it('verifies manga_chapters table exists with expected schema and indices', () => {
      const tableInfo = db.prepare("PRAGMA table_info('manga_chapters')").all() as any[];
      const cols = tableInfo.map((c) => c.name);
      expect(cols).toContain('id');
      expect(cols).toContain('manga_id');
      expect(cols).toContain('source_id');
      expect(cols).toContain('chapter_number');
      expect(cols).toContain('title');
      expect(cols).toContain('url');
      expect(cols).toContain('scanlator');
      expect(cols).toContain('upload_date');
      expect(cols).toContain('created_at');

      const indexList = db.prepare("PRAGMA index_list('manga_chapters')").all() as any[];
      const indexNames = indexList.map((i) => i.name);
      expect(indexNames).toContain('idx_manga_chapters_lookup');
    });

    it('upserts chapters and retrieves them sorted by chapter_number DESC', () => {
      SqliteDb.upsertChapters([
        {
          id: `${testMangaId}_asura_1`,
          manga_id: testMangaId,
          source_id: 'asurascans',
          chapter_number: 1,
          title: 'Chapter 1: The Awakening',
          url: '/comics/solo-leveling-ragnarok/chapter-1',
          scanlator: 'Asura Scans',
          upload_date: '2026-01-01',
        },
        {
          id: `${testMangaId}_asura_2`,
          manga_id: testMangaId,
          source_id: 'asurascans',
          chapter_number: 2,
          title: 'Chapter 2: The Dungeon',
          url: '/comics/solo-leveling-ragnarok/chapter-2',
          scanlator: 'Asura Scans',
          upload_date: '2026-01-08',
        },
        {
          id: `${testMangaId}_flame_1`,
          manga_id: testMangaId,
          source_id: 'flamecomics',
          chapter_number: 1,
          title: 'Chapter 1: Awakening (Flame)',
          url: '/series/solo-leveling-ragnarok/chapter-1',
          scanlator: 'Flame Comics',
          upload_date: '2026-01-02',
        },
      ]);

      const chapters = SqliteDb.getChaptersByMangaId(testMangaId);
      expect(chapters.length).toBe(3);
      expect(chapters[0].chapter_number).toBe(2);
      expect(chapters[1].chapter_number).toBe(1);

      // Verify ON CONFLICT DO UPDATE
      SqliteDb.upsertChapters([
        {
          id: `${testMangaId}_asura_1`,
          manga_id: testMangaId,
          source_id: 'asurascans',
          chapter_number: 1,
          title: 'Chapter 1: Updated Title',
          url: '/comics/solo-leveling-ragnarok/chapter-1-revised',
        },
      ]);

      const updatedCh = SqliteDb.getChapterByNumberAndSource(testMangaId, 1, 'asurascans');
      expect(updatedCh?.title).toBe('Chapter 1: Updated Title');
      expect(updatedCh?.url).toBe('/comics/solo-leveling-ragnarok/chapter-1-revised');
    });

    it('finds alternative mirrors for a chapter excluding current source', () => {
      SqliteDb.upsertChapters([
        {
          id: `${testMangaId}_asura_10`,
          manga_id: testMangaId,
          source_id: 'asurascans',
          chapter_number: 10,
          title: 'Ch 10 Asura',
          url: '/comics/slr/10',
        },
        {
          id: `${testMangaId}_flame_10`,
          manga_id: testMangaId,
          source_id: 'flamecomics',
          chapter_number: 10,
          title: 'Ch 10 Flame',
          url: '/series/slr/10',
        },
        {
          id: `${testMangaId}_weeb_10`,
          manga_id: testMangaId,
          source_id: 'weebcentral',
          chapter_number: 10,
          title: 'Ch 10 Weeb',
          url: '/chapters/slr/10',
        },
      ]);

      const mirrors = SqliteDb.getAlternativeMirrorsForChapter(testMangaId, 10, 'asurascans');
      expect(mirrors.length).toBe(2);
      const mirrorSources = mirrors.map((m) => m.source_id);
      expect(mirrorSources).toContain('flamecomics');
      expect(mirrorSources).toContain('weebcentral');
      expect(mirrorSources).not.toContain('asurascans');
    });

    it('cascades deletion of manga_chapters when manga is deleted', () => {
      SqliteDb.upsertChapters([
        {
          id: `${testMangaId}_asura_99`,
          manga_id: testMangaId,
          source_id: 'asurascans',
          chapter_number: 99,
          title: 'Chapter 99',
          url: '/comics/slr/99',
        },
      ]);

      expect(SqliteDb.getChaptersByMangaId(testMangaId).length).toBe(1);

      // Delete manga
      db.prepare('DELETE FROM manga WHERE id = ?').run(testMangaId);

      // Verify trigger and FK cascade cleaned up manga_chapters
      expect(SqliteDb.getChaptersByMangaId(testMangaId).length).toBe(0);
    });
  });

  describe('Relative URL & Domain Resolution (server/sources/sourcesCatalog.ts)', () => {
    it('normalizes full URLs to relative paths matching source base', () => {
      const rel1 = normalizeChapterUrl('https://asurascans.com/comics/my-series/chapter-5', 'https://asurascans.com');
      expect(rel1).toBe('/comics/my-series/chapter-5');

      const rel2 = normalizeChapterUrl('https://weebcentral.com/chapters/01J76XY', 'https://weebcentral.com');
      expect(rel2).toBe('/chapters/01J76XY');

      // Already relative
      const rel3 = normalizeChapterUrl('/series/action/ch-1', 'https://flamecomics.xyz');
      expect(rel3).toBe('/series/action/ch-1');

      // Relative without leading slash
      const rel4 = normalizeChapterUrl('chapter-3?page=1');
      expect(rel4).toBe('/chapter-3?page=1');
    });

    it('dynamically resolves relative paths against source base or sourceId', () => {
      const fullAsura = resolveChapterUrl('/comics/slr/ch-1', 'asurascans');
      expect(fullAsura).toBe('https://asurascans.com/comics/slr/ch-1');

      const fullCustom = resolveChapterUrl('/read/chap-10', 'https://mycustommanga.org');
      expect(fullCustom).toBe('https://mycustommanga.org/read/chap-10');

      // Already absolute
      const alreadyAbs = resolveChapterUrl('https://other.com/ch-1', 'asurascans');
      expect(alreadyAbs).toBe('https://other.com/ch-1');
    });
  });

  describe('Reader Chapter Mirrors & Failover Endpoints', () => {
    it('returns chapter mirrors in GET /api/reader/sources/:mangaId?chapterNumber=X', async () => {
      SqliteDb.upsertChapters([
        {
          id: `${testMangaId}_asura_5`,
          manga_id: testMangaId,
          source_id: 'asurascans',
          chapter_number: 5,
          title: 'Chapter 5',
          url: '/comics/slr/ch-5',
        },
        {
          id: `${testMangaId}_flame_5`,
          manga_id: testMangaId,
          source_id: 'flamecomics',
          chapter_number: 5,
          title: 'Chapter 5 Flame',
          url: '/series/slr/ch-5',
        },
      ]);

      const res = await request(app)
        .get(`/api/reader/sources/${testMangaId}?chapterNumber=5`)
        .expect(200);

      expect(res.body.mangaId).toBe(testMangaId);
      expect(Array.isArray(res.body.chapterMirrors)).toBe(true);
      expect(res.body.chapterMirrors.length).toBeGreaterThanOrEqual(2);
      expect(res.body.chapterMirrors[0].chapterNumber).toBe(5);
    });

    it('returns chapter mirrors from dedicated GET /api/reader/chapter-mirrors', async () => {
      SqliteDb.upsertChapters([
        {
          id: `${testMangaId}_weeb_15`,
          manga_id: testMangaId,
          source_id: 'weebcentral',
          chapter_number: 15,
          title: 'Chapter 15',
          url: '/chapters/slr/15',
        },
      ]);

      const res = await request(app)
        .get(`/api/reader/chapter-mirrors?mangaId=${testMangaId}&chapterNumber=15`)
        .expect(200);

      expect(res.body.mangaId).toBe(testMangaId);
      expect(res.body.chapterNumber).toBe(15);
      expect(res.body.mirrors.length).toBe(1);
      expect(res.body.mirrors[0].sourceId).toBe('weebcentral');
      expect(res.body.mirrors[0].url).toContain('https://weebcentral.com');
    });

    it('automatically fails over to alternative mirror and attaches x-mirror-fallback header', async () => {
      const { kotatsuImageEngine } = await import('../server/services/crawlerEngine');
      const spy = vi.spyOn(kotatsuImageEngine, 'getChapterPages');
      spy.mockImplementation(async (targetUrl, domainId) => {
        if (domainId === 'asurascans' || domainId === 'asura') {
          // Primary source fails (e.g. 503 or 0 pages)
          return [];
        }
        if (domainId === 'flamecomics' || domainId === 'flame') {
          return [
            'https://flamecomics.xyz/images/page1.jpg',
            'https://flamecomics.xyz/images/page2.jpg',
          ];
        }
        return null;
      });

      SqliteDb.upsertChapters([
        {
          id: `${testMangaId}_flame_20`,
          manga_id: testMangaId,
          source_id: 'flamecomics',
          chapter_number: 20,
          title: 'Chapter 20',
          url: '/series/slr/20',
        },
      ]);

      const res = await request(app)
        .get(`/api/reader/chapter-pages?mangaId=${testMangaId}&chapterNumber=20&url=https://asurascans.com/comics/slr/20&sourceId=asurascans`)
        .expect(200);

      expect(res.headers['x-mirror-fallback']).toBeDefined();
      expect(res.body.pages.length).toBe(2);
      expect(res.body.fallbackOccurred).toBe(true);

      spy.mockRestore();
    });
  });
});

