import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteDb, PersistedDownloadJob } from '../sqlite-db';
import { downloadManager } from '../server/services/downloadManagerService';
import { MangaItem } from '../src/types';

describe('Download Manager SQLite Persistence & Crash Recovery', () => {
  const dummyManga: MangaItem = {
    id: 'test_persist_manga_1',
    title: 'Test Persist Solo Leveling',
    altTitles: ['Na Honjaman Level Up'],
    type: 'manhwa',
    description: 'Sung Jinwoo test manga',
    currentChapter: 0,
    totalChapters: 200,
    latestChapter: 10,
    status: 'reading',
    rating: 9.5,
    coverImage: 'https://example.com/cover.jpg',
    genres: ['Action', 'Fantasy'],
    sourceUrl: 'https://example.com/manga/test-persist',
    sourceName: 'Test Scans',
    autoUpdateEnabled: true,
    notes: '',
    lastReadAt: new Date().toISOString(),
    addedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  };

  beforeEach(() => {
    SqliteDb.upsertManga(dummyManga);
  });

  it('persists enqueued download jobs directly to SQLite database', () => {
    const jobs = downloadManager.enqueue(dummyManga, [101, 102]);
    expect(jobs.length).toBe(2);

    const persistedJobs = SqliteDb.getDownloadJobs();
    const found101 = persistedJobs.find((j) => j.id === jobs[0].id);
    const found102 = persistedJobs.find((j) => j.id === jobs[1].id);

    expect(found101).toBeDefined();
    expect(found101?.chapterNumber).toBe(101);
    expect(['queued', 'downloading', 'failed']).toContain(found101?.status);

    expect(found102).toBeDefined();
    expect(found102?.chapterNumber).toBe(102);
  });

  it('persists pause and resume job status transitions to SQLite', () => {
    const jobs = downloadManager.enqueue(dummyManga, [103]);
    const jobId = jobs[0].id;

    // Pause
    const paused = downloadManager.pauseJob(jobId);
    expect(paused).toBe(true);

    let fromDb = SqliteDb.getDownloadJobById(jobId);
    expect(fromDb?.status).toBe('paused');

    // Resume
    const resumed = downloadManager.resumeJob(jobId);
    expect(resumed).toBe(true);

    fromDb = SqliteDb.getDownloadJobById(jobId);
    expect(fromDb?.status).toBe('queued');
  });

  it('deletes job from SQLite when cancelled', () => {
    const jobs = downloadManager.enqueue(dummyManga, [104]);
    const jobId = jobs[0].id;

    const cancelled = downloadManager.cancelJob(jobId);
    expect(cancelled).toBe(true);

    const fromDb = SqliteDb.getDownloadJobById(jobId);
    expect(fromDb).toBeNull();
  });
});
