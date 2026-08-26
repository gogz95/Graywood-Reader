import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../server';
import { isValidPanelImageUrl } from '../server/services/crawlerEngine';

describe('Reader Missing Pages and Placeholder Rejection', () => {
  it('rejects placeholder and lazyload images in isValidPanelImageUrl', () => {
    expect(isValidPanelImageUrl('https://example.com/assets/placeholder.jpg')).toBe(false);
    expect(isValidPanelImageUrl('https://example.com/images/placeholder.png')).toBe(false);
    expect(isValidPanelImageUrl('https://example.com/chapter/placeholder.webp')).toBe(false);
    expect(isValidPanelImageUrl('https://example.com/assets/blank.gif')).toBe(false);
    expect(isValidPanelImageUrl('https://example.com/assets/blank.png')).toBe(false);
    expect(isValidPanelImageUrl('https://example.com/assets/loading.gif')).toBe(false);
    expect(isValidPanelImageUrl('https://example.com/assets/lazyload.png')).toBe(false);
    expect(isValidPanelImageUrl('https://example.com/assets/no-image.jpg')).toBe(false);
    expect(isValidPanelImageUrl('https://example.com/thumb-placeholder.jpg')).toBe(false);

    // Valid chapter panel images should be accepted
    expect(isValidPanelImageUrl('https://cdn.example.com/manga/solo-leveling/ch1/01.webp')).toBe(true);
    expect(isValidPanelImageUrl('https://cdn.example.com/uploads/chapters/100/02.jpg')).toBe(true);
    expect(isValidPanelImageUrl('https://images.example.com/media/page_3.png')).toBe(true);
  });

  it('returns missing pages error and empty pages array when chapter cannot be resolved', async () => {
    const res = await request(app).get('/api/reader/chapter-pages?mangaId=non_existent_manga_123&chapterNumber=5');
    expect(res.status).toBe(200);
    expect(res.body.pages).toEqual([]);
    expect(res.body.totalPages).toBe(0);
    expect(res.body.contentUnavailable).toBe(true);
    expect(res.body.isRealImages).toBe(false);
    expect(res.body.loadError).toContain('missing pages');
    expect(res.body.notice).toContain('missing pages');

    // Ensure NO placeholder SVGs (/api/reader/panel-image) are returned
    expect(res.body.pages.some((p: string) => p.includes('/api/reader/panel-image'))).toBe(false);
  });

  it('returns HTTP 502 error instead of redirecting to placeholder SVG on failed proxy image', async () => {
    const res = await request(app).get('/api/reader/proxy-image?url=https://127.0.0.1:9999/non-existent.jpg');
    // Blocked loopback / failed image request returns error status, never redirects to panel-image placeholder
    expect([403, 502]).toContain(res.status);
    if (res.status === 302) {
      expect(res.headers.location).not.toContain('/api/reader/panel-image');
    }
  });

  it('does not serve a source as available once it is flagged as broken', async () => {
    // 1. Seed a test manga with a custom source and availableSources
    const testMangaId = 'manga_broken_source_test';
    await request(app).post('/api/manga').send({
      id: testMangaId,
      title: 'Flagged Broken Source Test',
      sourceName: 'Broken Source Test',
      sourceUrl: 'https://brokensource.example/manga/test-title',
      availableSources: [
        { sourceName: 'Broken Source Test', sourceUrl: 'https://brokensource.example/manga/test-title' },
        { sourceName: 'Working Mirror', sourceUrl: 'https://workingmirror.example/manga/test-title' },
      ],
    });

    // 2. Flag the source as broken
    const flagRes = await request(app).post('/api/sources/flag-broken').send({
      sourceId: 'brokensource_example',
      sourceName: 'Broken Source Test',
      reason: 'HTTP 503 Service Unavailable Cloudflare Loop',
    });
    expect(flagRes.status).toBe(200);
    expect(flagRes.body.success).toBe(true);

    // 3. Verify GET /api/reader/sources/:id excludes the broken source
    const sourcesRes = await request(app).get(`/api/reader/sources/${testMangaId}`);
    expect(sourcesRes.status).toBe(200);
    const availableSources = sourcesRes.body.sources || [];
    expect(availableSources.some((s: any) => s.sourceUrl.includes('brokensource.example'))).toBe(false);
    expect(availableSources.some((s: any) => s.sourceName === 'Broken Source Test')).toBe(false);

    // 4. Verify GET /api/reader/chapter-pages with the broken source URL reports source disabled
    const chapterPagesRes = await request(app).get(
      `/api/reader/chapter-pages?mangaId=${testMangaId}&chapterNumber=1&url=${encodeURIComponent('https://brokensource.example/manga/test-title')}`
    );
    expect(chapterPagesRes.status).toBe(200);
    expect(chapterPagesRes.body.pages).toEqual([]);
    expect(chapterPagesRes.body.contentUnavailable).toBe(true);
    expect(chapterPagesRes.body.loadError).toContain('broken or disabled');
  });
});
