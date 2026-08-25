import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import { opdsRouter } from '../server/routes/opds';
import { SqliteDb } from '../sqlite-db';

describe('OPDS-PSE (Page Streaming Extension)', () => {
  it('includes OPDS-PSE stream links in series chapter acquisition feeds', async () => {
    // Seed a temporary test series in DB
    SqliteDb.upsertManga({
      id: 'manga_opds_test',
      title: 'OPDS Test Manga',
      altTitles: [],
      type: 'manga',
      coverImage: 'https://example.com/cover.jpg',
      description: 'A test manga for OPDS-PSE validation',
      genres: ['Action'],
      status: 'reading',
      currentChapter: 1,
      latestChapter: 3,
      totalChapters: 10,
      rating: 9.0,
      sourceUrl: 'https://example.com/manga/opds-test',
      sourceName: 'Example Source',
      autoUpdateEnabled: false,
      notes: '',
      addedAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      lastReadAt: new Date().toISOString(),
      isFavorite: true,
    });

    const app = express();
    app.use(opdsRouter);

    const response = await request(app).get('/api/opds/series/manga_opds_test');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/atom+xml');
    expect(response.text).toContain('rel="http://vaemendis.net/opds-pse/stream"');
    expect(response.text).toContain('/api/opds/stream/manga_opds_test/');
  });

  it('handles OPDS-PSE single page streaming requests gracefully', async () => {
    const app = express();
    app.use(opdsRouter);

    const response = await request(app).get('/api/opds/stream/manga_opds_test/1/1');
    // Without network connection to live source, it redirects to the SVG generator fallback
    expect([200, 302]).toContain(response.status);
    if (response.status === 302) {
      expect(response.headers.location).toContain('/api/reader/panel-image');
    }
  });
});
