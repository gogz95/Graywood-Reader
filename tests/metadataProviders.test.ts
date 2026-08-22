import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import {
  fetchAniListMetadata,
  fetchMangaUpdatesMetadata,
  fetchJikanMetadata,
  fetchKitsuMetadata,
  fetchOpenLibraryMetadata,
  fetchGoogleBooksMetadata,
  aggregateMultiSourceMetadata,
} from '../server/services/metadataService';
import { appSettings } from '../server/appState';

// ── Helpers ───────────────────────────────────────────────────────────────────
function jsonResponse(body: unknown, status = 200): any {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (): any => null },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

const fetchMock = vi.fn(async (input: any): Promise<any> => {
  const url = String(input);

  if (url.includes('account/login')) {
    return jsonResponse({ token: 'session-token' });
  }
  if (url.includes('/v1/series')) {
    return jsonResponse({
      results: [{
        record: {
          title: 'Solo Leveling', series_id: 682, completed: false, type: 'manhwa',
          description: '<p>Solo leveling description</p>', bayesian_rating: 8.5,
          image: { url: { original: 'https://mu/cover.jpg' } },
          genres: [{ genre: 'Action' }, { genre: 'Fantasy' }],
          associated: [{ title: 'Na Honjaman Level Up' }],
          authors: [{ name: 'Chugong' }],
          categories: [{ category: 'Manhwa' }],
          url: 'https://www.mangaupdates.com/series.html?id=42',
        },
      }],
    });
  }
  if (url.includes('kitsu.io')) {
    return jsonResponse({
      data: [{
        id: '54114',
        attributes: {
          canonicalTitle: 'Solo Leveling',
          titles: { en_us: 'Solo Leveling', en_jp: 'Boku dake Level Up na Ken' },
          abbreviatedTitles: [],
          synopsis: '<p>Kitsu synopsis</p>', description: '<p>Kitsu desc</p>',
          averageRating: '84.52', status: 'finished', subtype: 'manhwa', mangaType: 'manhwa',
          posterImage: { large: 'https://kitsu/cover/large.jpg' },
        },
      }],
    });
  }
  if (url.includes('openlibrary.org')) {
    return jsonResponse({
      docs: [{
        title: '나 혼자만 레벨 업 1 (novel)', cover_i: 10839422,
        key: '/works/OL19924210W', author_name: ['Chugong'],
        subject: ['series: NonEssential', 'Adventure', 'Fantasy'],
      }],
    });
  }
  if (url.includes('googleapis.com')) {
    return jsonResponse({
      items: [{
        id: 'gb1',
        volumeInfo: {
          title: 'Solo Leveling', authors: ['Chugong'],
          description: '<b>Solo Leveling volume</b>', averageRating: 5,
          imageLinks: { thumbnail: 'http://books/cover.jpg' },
          categories: ['Fantasy'], previewLink: 'https://books.google.com/',
        },
      }],
    });
  }
  if (url.includes('anilist.co')) {
    return jsonResponse({
      data: { Page: { media: [{
        id: '110800', title: { english: 'Solo Leveling', romaji: 'Ore dake Level Up na Ken' },
        coverImage: { extraLarge: 'https://anilist/cover.jpg' },
        description: '<p>AniList description</p>', genres: ['Action', 'Fantasy'],
        averageScore: 90, status: 'RELEASING', countryOfOrigin: 'KR', siteUrl: 'https://anilist.co/manga/1',
      }] } },
    });
  }
  if (url.includes('jikan.moe')) {
    return jsonResponse({
      data: [{
        mal_id: 1, title_english: 'Solo Leveling', title_japanese: '俺だけレベルアップな件',
        titles: [{ title: 'Na Honjaman Level Up' }], images: { jpg: { large_image_url: 'https://mal/cover.jpg' } },
        synopsis: '<p>MAL synopsis</p>', genres: [{ name: 'Action' }], score: 8.5, publishing: true,
      }],
    });
  }
  if (url.includes('mangadex.org')) {
    return jsonResponse({ data: [] });
  }
  return jsonResponse({});
});

beforeAll(() => {
  // Provide MangaUpdates credentials so its (mocked) authenticated flow runs.
  (appSettings as any).mangaUpdatesUsername = 'testuser';
  (appSettings as any).mangaUpdatesPassword = 'testpass';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Multi-Provider Metadata Services', () => {
  it('handles gracefully when provider search yields empty/invalid query', async () => {
    const ani = await fetchAniListMetadata('');
    const mu = await fetchMangaUpdatesMetadata('');
    const mal = await fetchJikanMetadata('');
    const ki = await fetchKitsuMetadata('');
    const ol = await fetchOpenLibraryMetadata('');
    const gb = await fetchGoogleBooksMetadata('');
    expect(ani).toBeNull();
    expect(mu).toBeNull();
    expect(mal).toBeNull();
    expect(ki).toBeNull();
    expect(ol).toBeNull();
    expect(gb).toBeNull();
  });

  it('fetchKitsuMetadata maps attributes (rating /100→/10, manhwa type, cover)', async () => {
    vi.stubGlobal('fetch', fetchMock);
    const r = await fetchKitsuMetadata('Solo Leveling');
    expect(r).not.toBeNull();
    expect(r!.provider).toBe('Kitsu');
    expect(r!.title).toBe('Solo Leveling');
    expect(r!.rating).toBe(8.5); // 84.52 / 10
    expect(r!.publicationType).toBe('manhwa');
    expect(r!.status).toBe('FINISHED');
    expect(r!.coverImage).toContain('kitsu/cover');
    expect(r!.externalUrl).toBe('https://kitsu.io/manga/54114');
  });

  it('fetchOpenLibrary maps cover_i to a covers URL and filters series subjects', async () => {
    vi.stubGlobal('fetch', fetchMock);
    const r = await fetchOpenLibraryMetadata('Solo Leveling');
    expect(r).not.toBeNull();
    expect(r!.provider).toBe('OpenLibrary');
    expect(r!.coverImage).toBe('https://covers.openlibrary.org/b/id/10839422-L.jpg');
    expect(r!.genres).toEqual(['Adventure', 'Fantasy']);
    expect(r!.authors).toEqual(['Chugong']);
    expect(r!.apiId).toBe('/works/OL19924210W');
  });

  it('fetchGoogleBooks upgrades http cover and converts 5-point rating to /10', async () => {
    vi.stubGlobal('fetch', fetchMock);
    const r = await fetchGoogleBooksMetadata('Solo Leveling');
    expect(r).not.toBeNull();
    expect(r!.provider).toBe('GoogleBooks');
    expect(r!.coverImage.startsWith('https://')).toBe(true);
    expect(r!.rating).toBe(10); // 5 * 2
    expect(r!.authors).toEqual(['Chugong']);
    expect(r!.genres).toEqual(['Fantasy']);
  });

  it('fetchMangaUpdates runs the authenticated login + series flow and maps fields', async () => {
    vi.stubGlobal('fetch', fetchMock);
    const r = await fetchMangaUpdatesMetadata('Solo Leveling');
    expect(r).not.toBeNull();
    expect(r!.provider).toBe('MangaUpdates');
    expect(r!.title).toBe('Solo Leveling');
    expect(r!.rating).toBe(8.5);
    expect(r!.apiId).toBe('682');
    expect(r!.altTitles).toContain('Na Honjaman Level Up');
    expect(r!.authors).toContain('Chugong');
    expect(r!.categories).toContain('Manhwa');
  });

  it('fetchMangaUpdates skips gracefully when credentials are missing', async () => {
    (appSettings as any).mangaUpdatesUsername = '';
    (appSettings as any).mangaUpdatesPassword = '';
    try {
      const r = await fetchMangaUpdatesMetadata('Solo Leveling');
      expect(r).toBeNull();
    } finally {
      (appSettings as any).mangaUpdatesUsername = 'testuser';
      (appSettings as any).mangaUpdatesPassword = 'testpass';
    }
  });

  it('aggregates multi-source metadata: unions genres/altTitles/authors and averages ratings', async () => {
    vi.stubGlobal('fetch', fetchMock);
    const res = await aggregateMultiSourceMetadata('Solo Leveling');
    expect(res.sources.length).toBeGreaterThanOrEqual(4);
    const providers = res.sources.map((s) => s.provider);
    expect(providers).toContain('Kitsu');
    expect(providers).toContain('OpenLibrary');
    expect(providers).toContain('GoogleBooks');
    expect(providers).toContain('MangaUpdates');

    expect(res.merged.genres).toEqual(expect.arrayContaining(['Action', 'Fantasy']));
    expect(res.merged.altTitles).toEqual(expect.arrayContaining(['Na Honjaman Level Up']));
    expect(res.merged.authors).toEqual(expect.arrayContaining(['Chugong']));
    expect(typeof res.merged.rating).toBe('number');
    // AUP credit compliance: aggregated result must expose its contributing sources.
    expect(res.merged.dataSources).toEqual(expect.arrayContaining(['MangaUpdates', 'Kitsu']));

    const mu = res.sources.find((s) => s.provider === 'MangaUpdates');
    expect(mu?.attribution).toContain('MangaUpdates');
    expect(mu?.externalUrl).toContain('mangaupdates.com');
  });
});
