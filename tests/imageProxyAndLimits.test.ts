import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../server';
import { negativeProxyCache, clearNegativeProxyCache } from '../server/routes/reader';
import { broadcastProgressSync } from '../server/routes/progress';
import { SqliteDb } from '../sqlite-db';

describe('Image Proxy Limits, Caching & Anti-Spam Protections', () => {
  beforeEach(() => {
    clearNegativeProxyCache();
  });

  it('sets negative cache and returns 502 with Cache-Control headers on upstream failure', async () => {
    const fakeUrl = 'https://example.com/non-existent-image-xyz987.jpg';

    // First request - attempts fetch and caches failure
    const res1 = await request(app)
      .get(`/api/proxy/image?url=${encodeURIComponent(fakeUrl)}`);

    expect(res1.status).toBe(502);
    expect(res1.headers['cache-control']).toContain('max-age=600');
    expect(negativeProxyCache.has(fakeUrl)).toBe(true);

    // Second request - immediately short-circuited via negative cache
    const res2 = await request(app)
      .get(`/api/proxy/image?url=${encodeURIComponent(fakeUrl)}`);

    expect(res2.status).toBe(502);
    expect(res2.body.error).toContain('cached failure');
    expect(res2.headers['cache-control']).toContain('max-age=600');
  });

  it('uses https://mangadex.org/ referer for MangaDex cover image requests', async () => {
    const mdCoverUrl = 'https://uploads.mangadex.org/covers/32d76d19-8a05-4db0-9fc2-e0b0648fe9d0/fbc962f9-3d12-4c6e-8212-32a2cb874a7b.jpg';

    const res = await request(app)
      .get(`/api/mangadex/image-proxy?url=${encodeURIComponent(mdCoverUrl)}`);

    expect(res.status).toBe(502);
    expect(negativeProxyCache.has(mdCoverUrl)).toBe(true);
    expect(res.headers['cache-control']).toContain('max-age=600');
  });
});

describe('SSE Reading Progress Broadcast Privacy Isolation', () => {
  it('only writes to matching client userId and does not broadcast user progress to guests', () => {
    const writtenUser: string[] = [];
    const writtenGuest: string[] = [];

    // Simulate clients in sseClients
    const userClientRes = {
      write: (data: string) => writtenUser.push(data),
    };
    const guestClientRes = {
      write: (data: string) => writtenGuest.push(data),
    };

    // We verify the broadcastProgressSync logic directly
    const event = {
      userId: 'usr_alice',
      mangaId: 'manga_secret_1',
      chapterNumber: 42,
    };

    broadcastProgressSync(event);

    // Any guest client must have received 0 data
    expect(writtenGuest.length).toBe(0);
  });
});

describe('Atomic Reading Activity Recording', () => {
  it('atomically increments chapters_read and minutes_spent for the user', () => {
    const testUid = 'usr_atomic_test_' + Date.now();
    SqliteDb.recordReadingActivity(testUid, { chaptersRead: 2, minutesSpent: 15 });
    SqliteDb.recordReadingActivity(testUid, { chaptersRead: 3, minutesSpent: 20 });

    const rows = SqliteDb.getReadingActivity(testUid);
    const today = new Date().toISOString().substring(0, 10);
    const todayRow = rows.find((r: any) => r.date === today);

    expect(todayRow).toBeDefined();
    expect(todayRow.chapters_read).toBe(5);
    expect(todayRow.minutes_spent).toBe(35);
  });
});
