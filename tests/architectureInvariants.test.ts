import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteDb } from '../db';
import { MangaItem } from '../src/types';
import { recordTrace, getRecentTraces, clearTraces } from '../server/diagnostics/traceBuffer';
import { resolveSourceUrl } from '../server/sources/sourcesCatalog';

describe('Stage 6: Final End-to-End Invariant Verification & Architecture Guarantees', () => {
  beforeEach(() => {
    clearTraces();
  });

  describe('Invariant 1: Strict Multi-User Isolation for Progress & Ratings', () => {
    it('ensures User A updating reading progress and rating never mutates User B state for the same manga', () => {
      const testMangaId = 'manga_multiuser_inv_test';
      const baseManga: MangaItem = {
        id: testMangaId,
        title: 'Multi-User Invariant Test Series',
        altTitles: [],
        coverImage: 'https://images.unsplash.com/cover.jpg',
        description: 'Testing user isolation',
        genres: ['Action'],
        type: 'manhwa',
        status: 'reading',
        currentChapter: 1,
        totalChapters: null,
        latestChapter: 100,
        lastUpdated: new Date().toISOString(),
        rating: 8.0,
        sourceUrl: 'https://example.com/multiuser-test',
        sourceName: 'Test Source',
        autoUpdateEnabled: false,
        notes: '',
        addedAt: new Date().toISOString(),
        lastReadAt: new Date().toISOString(),
      };

      SqliteDb.upsertManga(baseManga);

      const userA = 'usr_alice';
      const userB = 'usr_bob';

      // Initialize User B at Chapter 12 with Rating 7.0
      SqliteDb.setUserLibraryChapter(userB, testMangaId, 12, { rating: 7.0, status: 'reading' });
      SqliteDb.upsertReadingProgress({
        manga_id: testMangaId,
        user_id: userB,
        chapter_number: 12,
        page_index: 5,
        page_count: 20,
        percent: 25,
      });

      // User A reads up to Chapter 42.5 and rates it 9.5
      SqliteDb.setUserLibraryChapter(userA, testMangaId, 42.5, { rating: 9.5, status: 'reading' });
      SqliteDb.upsertReadingProgress({
        manga_id: testMangaId,
        user_id: userA,
        chapter_number: 42.5,
        page_index: 18,
        page_count: 20,
        percent: 90,
      });

      // Verify User A overlay
      const overlayA = SqliteDb.applyUserOverlayOne(baseManga, userA);
      expect(overlayA.currentChapter).toBe(42.5);
      expect(overlayA.rating).toBe(9.5);

      // Verify User B overlay remains strictly unchanged
      const overlayB = SqliteDb.applyUserOverlayOne(baseManga, userB);
      expect(overlayB.currentChapter).toBe(12);
      expect(overlayB.rating).toBe(7.0);

      // Verify individual progress entries in reading_progress table
      const progressA = SqliteDb.getReadingProgressForChapter(testMangaId, userA, 42.5);
      expect(progressA?.percent).toBe(90);

      const progressB = SqliteDb.getReadingProgressForChapter(testMangaId, userB, 42.5);
      expect(progressB).toBeFalsy();

      const progressB12 = SqliteDb.getReadingProgressForChapter(testMangaId, userB, 12);
      expect(progressB12?.percent).toBe(25);
    });
  });

  describe('Invariant 2: Diagnostic Trace Buffer Ring Recording & Retrieval', () => {
    it('records and retrieves structured diagnostic events via recordTrace / getRecentTraces', () => {
      expect(getRecentTraces().length).toBe(0);

      recordTrace({
        domain: 'asurascans.com',
        sourceId: 'asurascans',
        stage: 'HTTP_FETCH',
        status: 'ok',
        statusCode: 200,
        durationMs: 145,
        message: 'Successfully scraped chapter list',
      });

      recordTrace({
        domain: 'flamecomics.xyz',
        sourceId: 'flamecomics',
        stage: 'MIRROR_FALLBACK',
        status: 'warn',
        durationMs: 310,
        message: 'Recovered chapter via mirror fallback',
      });

      const traces = getRecentTraces();
      expect(traces.length).toBe(2);

      // Latest trace first
      expect(traces[0].sourceId).toBe('flamecomics');
      expect(traces[0].stage).toBe('MIRROR_FALLBACK');
      expect(traces[0].status).toBe('warn');

      expect(traces[1].sourceId).toBe('asurascans');
      expect(traces[1].stage).toBe('HTTP_FETCH');

      // Filter by stage
      const fallbackTraces = getRecentTraces({ stage: 'MIRROR_FALLBACK' });
      expect(fallbackTraces.length).toBe(1);
      expect(fallbackTraces[0].sourceId).toBe('flamecomics');

      // Filter by status
      const okTraces = getRecentTraces({ status: 'ok' });
      expect(okTraces.length).toBe(1);
      expect(okTraces[0].sourceId).toBe('asurascans');
    });
  });

  describe('Invariant 3: Canonical Base URL and Relative Path Resolution', () => {
    it('resolves relative chapter paths against the active source base domain', () => {
      // Relative path with leading slash
      const resolvedAsura = resolveSourceUrl('asurascans', '/comics/solo-leveling/chapter-1');
      expect(resolvedAsura).toBe('https://asurascans.com/comics/solo-leveling/chapter-1');

      // Relative path without leading slash
      const resolvedFlame = resolveSourceUrl('flamecomics', 'series/solo-leveling/chapter-5');
      expect(resolvedFlame).toBe('https://flamecomics.xyz/series/solo-leveling/chapter-5');

      // Absolute path from known stale mirror updated to canonical
      const resolvedMirror = resolveSourceUrl('asurascans', 'https://asuracomic.net/comics/slr/ch-1');
      expect(resolvedMirror).toBe('https://asurascans.com/comics/slr/ch-1');

      // Custom base URL resolution
      const customResolved = resolveSourceUrl('https://custom-scanlation.org', '/read/series-a/ch-10');
      expect(customResolved).toBe('https://custom-scanlation.org/read/series-a/ch-10');
    });
  });
});
