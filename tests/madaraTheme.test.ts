import { describe, it, expect, vi, afterEach } from 'vitest';
import * as cheerio from 'cheerio';
import {
  createMadaraListScraper,
  extractMadaraSlug,
  parseMadaraTotalCount,
  inferTypeFromSlug,
} from '../server/scrapers/madaraTheme';
import { matchResolvedChapter } from '../server/services/crawlerEngine';

const CATALOG_HTML = `
<html><body>
  <div class="page-item-detail">
    <div class="item-thumb">
      <a href="https://fixture.test/manga/solo-leveling/">
        <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
             data-src="https://fixture.test/wp-content/uploads/solo.jpg" />
      </a>
    </div>
    <div class="post-title"><a href="https://fixture.test/manga/solo-leveling/">Solo Leveling</a></div>
    <span class="chapter">Chapter 179</span>
    <div class="mg_genres"><a>Action</a><a>Fantasy</a></div>
  </div>
  <div class="page-item-detail">
    <div class="post-title"><a href="https://fixture.test/manga/omniscient-reader/">Omniscient Reader</a></div>
    <span class="chapter">Ch. 200</span>
  </div>
  <!-- duplicate slug must be deduped -->
  <div class="page-item-detail">
    <div class="post-title"><a href="https://fixture.test/manga/solo-leveling/">Solo Leveling (dup)</a></div>
  </div>
  <!-- chapter deep-link of an otherwise unseen slug must be rejected -->
  <div class="page-item-detail">
    <div class="post-title"><a href="https://fixture.test/manga/hidden-series/chapter-3/">Chapter 3</a></div>
  </div>
  <div class="wp-pagenavi"><span class="pages">Page 1 of 120</span></div>
</body></html>
`;

describe('Madara Theme Shared Scraper Factory', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('extracts slugs from series URLs with configurable path segments', () => {
    expect(extractMadaraSlug('https://x.test/manga/solo-leveling/')).toBe('solo-leveling');
    expect(extractMadaraSlug('https://x.test/title/nano-machine', 'title')).toBe('nano-machine');
    expect(extractMadaraSlug('')).toBe('');
  });

  it('parses real total counts from wp-pagenavi instead of fabricating them', () => {
    const $ = cheerio.load('<div class="wp-pagenavi"><span class="pages">Page 1 of 350</span></div>');
    expect(parseMadaraTotalCount($, 24)).toBe(350 * 24);

    const $links = cheerio.load(
      '<ul class="pagination"><li><a href="/manga/page/2/">2</a></li><li><a href="/manga/page/87/">Last</a></li></ul>',
    );
    expect(parseMadaraTotalCount($links, 12)).toBe(87 * 12);

    const $none = cheerio.load('<div>No pagination here</div>');
    expect(parseMadaraTotalCount($none, 24)).toBe(0);
  });

  it('infers content type from slug keywords', () => {
    expect(inferTypeFromSlug('some-manhua-title')).toBe('manhua');
    expect(inferTypeFromSlug('some-manhwa-title')).toBe('manhwa');
    expect(inferTypeFromSlug('naruto')).toBe('manga');
  });


  it('scrapes catalog cards honestly: dedupes, rejects chapter links, parses real totals', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => CATALOG_HTML,
    })));

    const scraper = createMadaraListScraper({
      id: 'fixture',
      name: 'Fixture Scans',
      baseUrl: 'https://fixture.test',
    });

    const { items, totalCount } = await scraper.scrape(1, 24);

    // 2 unique series (dedupe by slug).
    expect(items.map((i) => i.title)).toEqual(['Solo Leveling', 'Omniscient Reader']);
    expect(items[0].id).toBe('fixture_solo-leveling');
    expect(items[0].coverImage).toBe('https://fixture.test/wp-content/uploads/solo.jpg');
    expect(items[0].latestChapter).toBe(179);
    expect(items[0].genres).toEqual(['Action', 'Fantasy']);

    // Honest metadata: no fabricated rating or description fields.
    expect(items[0].rating).toBeUndefined();
    expect(items[0].description).toBeUndefined();
    expect(items[1].genres).toBeUndefined();

    // Real total from "Page 1 of 120" x 2 parsed cards on page.
    expect(totalCount).toBe(120 * 2);
  });

  it('falls back to items.length when pagination cannot be parsed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => `
        <div class="page-item-detail">
          <div class="post-title"><a href="https://fixture.test/manga/only-one/">Only One</a></div>
        </div>`,
    })));

    const scraper = createMadaraListScraper({
      id: 'fixture',
      name: 'Fixture Scans',
      baseUrl: 'https://fixture.test',
    });
    const { items, totalCount } = await scraper.scrape();
    expect(items.length).toBe(1);
    expect(totalCount).toBe(1);
  });

  it('returns empty results gracefully on HTTP failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, text: async () => '' })));
    const scraper = createMadaraListScraper({
      id: 'fixture',
      name: 'Fixture Scans',
      baseUrl: 'https://fixture.test',
    });
    expect(await scraper.scrape()).toEqual({ items: [], totalCount: 0 });
    expect(await scraper.search('anything')).toEqual([]);
  });
});

describe('matchResolvedChapter', () => {
  const chapters = [
    { number: 10, id: 'a', slug: 'series-1-chapter-10', title: 'Chapter 10', url: 'https://x/chapter-10', pageCount: 0 },
    { number: 105, id: 'b', slug: 'series-1-chapter-105', title: 'Chapter 105', url: 'https://x/chapter-105', pageCount: 0 },
    { number: 10.5, id: 'c', slug: 'series-1-chapter-10.5', title: 'Chapter 10.5', url: 'https://x/chapter-10.5', pageCount: 0 },
  ];

  it('prefers exact numeric matches', () => {
    expect(matchResolvedChapter(chapters, 105)?.number).toBe(105);
  });

  it('does not let decimal chapter numbers act as regex wildcards', () => {
    // The '.' in 10.5 must be escaped — a slug like "chapter-10x5" must not match.
    const tricky = [
      { number: 9, id: 'z', slug: 'series-chapter-10x5', title: 'Ch', url: 'https://x/10x5', pageCount: 0 },
    ];
    expect(matchResolvedChapter(tricky, 10.5)).toBeUndefined();

    // ...while a genuine decimal slug still matches via the fallback regex.
    expect(matchResolvedChapter([chapters[0], chapters[2]], 10.5)?.number).toBe(10.5);
  });
});
