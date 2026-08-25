// ============================================================================
// Multi-Provider Metadata Aggregator Engine
// AniList, MangaUpdates, MAL (Jikan), Kitsu, OpenLibrary, Google Books
// ============================================================================

import { APP_USER_AGENT } from '../../version';
import { appSettings } from '../../appState';
import { getMangaDexMetadataByTitle } from './mangadex';
import { cleanHtml, sanitizeTitleForSearch } from './liveMetadata';

const PROVIDER_THROTTLE_MS: Record<string, number> = {
  anilist: 350,
  mangadex: 260,
  jikan: 400,
  kitsu: 400,
  mangaupdates: 1200,
  openlibrary: 1200,
  googlebooks: 500,
};
const lastProviderRequestAt: Record<string, number> = {};

async function throttleProvider(key: string): Promise<void> {
  const ms = PROVIDER_THROTTLE_MS[key] || 0;
  if (ms <= 0) return;
  const last = lastProviderRequestAt[key] || 0;
  const wait = ms - (Date.now() - last);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastProviderRequestAt[key] = Date.now();
}

export interface UnifiedMetadataResult {
  provider: 'MangaDex' | 'AniList' | 'MangaUpdates' | 'MyAnimeList' | 'Kitsu' | 'OpenLibrary' | 'GoogleBooks';
  title: string;
  altTitles: string[];
  coverImage: string;
  description: string;
  genres: string[];
  rating?: number;
  status?: string;
  publicationType?: string;
  externalUrl?: string;
  apiId?: string;
  authors?: string[];
  categories?: string[];
  attribution?: string;
  dataSources?: string[];
}

const CACHE_TTL_MS: Record<string, number> = {
  mangadex: 6 * 60 * 60 * 1000,
  anilist: 6 * 60 * 60 * 1000,
  mangaupdates: 6 * 60 * 60 * 1000,
  jikan: 24 * 60 * 60 * 1000,
  kitsu: 6 * 60 * 60 * 1000,
  openlibrary: 24 * 60 * 60 * 1000,
  googlebooks: 24 * 60 * 60 * 1000,
};
const metadataCache = new Map<string, { value: UnifiedMetadataResult | null; expires: number }>();

function evictCache<K>(cache: Map<K, { expires: number }>, maxSize: number): void {
  const now = Date.now();
  for (const [k, v] of cache) {
    if (v.expires <= now) cache.delete(k);
  }
  while (cache.size >= maxSize) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

async function cachedProviderResult<T extends UnifiedMetadataResult | null>(
  key: string,
  fn: () => Promise<T>
): Promise<T> {
  const providerKey = key.split(':')[0].toLowerCase();
  const ttl = CACHE_TTL_MS[providerKey] || 60 * 60 * 1000;
  const hit = metadataCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  const value = await fn();
  if (value) {
    if (metadataCache.size >= 500) evictCache(metadataCache, 500);
    metadataCache.set(key, { value, expires: Date.now() + ttl });
  } else {
    metadataCache.delete(key);
  }
  return value;
}

export async function fetchAniListMetadata(title: string): Promise<UnifiedMetadataResult | null> {
  const searchTitle = sanitizeTitleForSearch(title) || title;
  if (!searchTitle || searchTitle.length < 2) return null;
  const graphqlQuery = `
    query ($search: String) {
      Page(page: 1, perPage: 3) {
        media(search: $search, type: MANGA) {
          id
          title { romaji english native }
          coverImage { extraLarge large }
          description
          genres
          status
          averageScore
          countryOfOrigin
          siteUrl
        }
      }
    }
  `;

  try {
    await throttleProvider('anilist');
    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: graphqlQuery, variables: { search: searchTitle } }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return null;
    const json = await res.json();
    const media = json.data?.Page?.media?.[0];
    if (!media) return null;

    const engTitle = media.title?.english || media.title?.romaji || media.title?.native || searchTitle;
    const altTitles = [media.title?.romaji, media.title?.native, media.title?.english].filter(Boolean) as string[];
    const origin = media.countryOfOrigin;
    const pubType = origin === 'KR' ? 'manhwa' : origin === 'CN' || origin === 'TW' ? 'manhua' : 'manga';

    return {
      provider: 'AniList',
      title: engTitle,
      altTitles: Array.from(new Set(altTitles)),
      coverImage: media.coverImage?.extraLarge || media.coverImage?.large || '',
      description: cleanHtml(media.description || ''),
      genres: media.genres || [],
      rating: media.averageScore ? Number((media.averageScore / 10).toFixed(1)) : undefined,
      status: media.status || 'FINISHED',
      publicationType: pubType,
      externalUrl: media.siteUrl || `https://anilist.co/manga/${media.id}`,
      apiId: String(media.id),
    };
  } catch (err: any) {
    console.warn(`[AniList Meta] Failed for ${title}:`, err.message);
    return null;
  }
}

export async function fetchMangaUpdatesMetadata(title: string): Promise<UnifiedMetadataResult | null> {
  const searchTitle = sanitizeTitleForSearch(title) || title;
  if (!searchTitle || searchTitle.length < 2) return null;
  const mup = appSettings as any;
  const username = mup.mangaUpdatesUsername || '';
  const password = mup.mangaUpdatesPassword || '';
  if (!username || !password) {
    console.warn('[MangaUpdates Meta] Credentials not configured — skipping lookup (public search retired).');
    return null;
  }
  try {
    await throttleProvider('mangaupdates');

    const loginRes = await fetch('https://api.mangaupdates.com/v1/account/login', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': APP_USER_AGENT },
      body: JSON.stringify({ username, password }),
      signal: AbortSignal.timeout(10000),
    });
    if (!loginRes.ok) {
      console.warn(`[MangaUpdates Meta] Login failed (HTTP ${loginRes.status}) for ${title}.`);
      return null;
    }
    const loginCookies = (loginRes.headers.get('set-cookie') || '')
      .split(/,\s*(?=[A-Za-z_][A-Za-z0-9_]*=)/)
      .filter(Boolean);
    const loginJson = await loginRes.json().catch(() => null);
    const sessionToken = loginJson?.token || loginJson?.api_token || loginJson?.access_token || loginJson?.auth_token || '';

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': APP_USER_AGENT,
    };
    if (sessionToken) headers.Authorization = sessionToken.startsWith('Bearer ') ? sessionToken : `Bearer ${sessionToken}`;
    if (loginCookies.length) headers.Cookie = loginCookies.join('; ');

    const res = await fetch('https://api.mangaupdates.com/v1/series', {
      method: 'POST',
      headers,
      body: JSON.stringify({ search: searchTitle, page: 1, perpage: 3 }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.warn(`[MangaUpdates Meta] Series search failed (HTTP ${res.status}) for ${title}.`);
      return null;
    }
    const json = await res.json().catch(() => null);
    if (!json) return null;
    const record = json.results?.[0]?.record || json.results?.[0];
    if (!record) return null;

    const altTitles = (record.associated || [])
      .flatMap((a: any) => [a?.title, a?.related_series_name].filter(Boolean))
      .filter(Boolean);
    return {
      provider: 'MangaUpdates',
      title: record.title || searchTitle,
      altTitles: Array.from(new Set(altTitles)),
      coverImage: record.image?.url?.original || record.image?.url?.thumb || '',
      description: cleanHtml(record.description || ''),
      genres: (record.genres || []).map((g: any) => g.genre || g).filter(Boolean),
      rating: record.bayesian_rating ? Number(record.bayesian_rating.toFixed(1)) : undefined,
      status: record.completed ? 'COMPLETED' : 'RELEASING',
      publicationType: record.type ? String(record.type).toLowerCase() : 'manga',
      externalUrl: record.url || `https://www.mangaupdates.com/series.html?id=${record.series_id}`,
      apiId: record.series_id != null ? String(record.series_id) : undefined,
      authors: (record.authors || []).flatMap((a: any) => [a?.name, a?.author_name].filter(Boolean)),
      categories: (record.categories || []).map((c: any) => c.category || c).filter(Boolean),
      attribution: 'Data via MangaUpdates API (mangaupdates.com)',
    };
  } catch (err: any) {
    console.warn(`[MangaUpdates Meta] Failed for ${title}:`, err.message);
    return null;
  }
}

export async function fetchJikanMetadata(title: string): Promise<UnifiedMetadataResult | null> {
  const searchTitle = sanitizeTitleForSearch(title) || title;
  if (!searchTitle || searchTitle.length < 2) return null;
  try {
    await throttleProvider('jikan');
    const res = await fetch(`https://api.jikan.moe/v4/manga?q=${encodeURIComponent(searchTitle)}&limit=1`, {
      headers: { 'User-Agent': APP_USER_AGENT },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return null;
    const json = await res.json();
    const item = json.data?.[0];
    if (!item) return null;

    const altTitles = [item.title_english, item.title_japanese, ...(item.titles || []).map((t: any) => t.title)].filter(Boolean);
    return {
      provider: 'MyAnimeList',
      title: item.title_english || item.title || searchTitle,
      altTitles: Array.from(new Set(altTitles)),
      coverImage: item.images?.jpg?.large_image_url || item.images?.jpg?.image_url || '',
      description: cleanHtml(item.synopsis || ''),
      genres: (item.genres || []).map((g: any) => g.name).filter(Boolean),
      rating: item.score ? Number(item.score.toFixed(1)) : undefined,
      status: item.publishing ? 'RELEASING' : 'FINISHED',
      publicationType: item.type ? item.type.toLowerCase() : 'manga',
      externalUrl: item.url || `https://myanimelist.net/manga/${item.mal_id}`,
      apiId: String(item.mal_id),
    };
  } catch (err: any) {
    console.warn(`[MAL Jikan Meta] Failed for ${title}:`, err.message);
    return null;
  }
}

export async function fetchKitsuMetadata(title: string): Promise<UnifiedMetadataResult | null> {
  const searchTitle = sanitizeTitleForSearch(title) || title;
  if (!searchTitle || searchTitle.length < 2) return null;
  try {
    await throttleProvider('kitsu');
    const url = `https://kitsu.io/api/edge/manga?filter%5Btext%5D=${encodeURIComponent(searchTitle)}&page%5Blimit%5D=3`;
    const res = await fetch(url, {
      headers: { Accept: 'application/vnd.api+json', 'User-Agent': APP_USER_AGENT },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    const item = json?.data?.[0];
    if (!item) return null;
    const attr = item.attributes || {};
    const canonical = attr.canonicalTitle || attr.en_us || attr.en_jp || searchTitle;
    const altTitles = [
      ...Object.values(attr.titles || {}),
      ...(attr.abbreviatedTitles || []),
    ].filter((t): t is string => Boolean(t) && String(t) !== canonical);
    const sub = String(attr.subtype || attr.mangaType || '').toLowerCase();
    const pubType = sub.includes('manhwa') ? 'manhwa'
      : sub.includes('manhua') ? 'manhua'
      : sub.includes('novel') ? 'novel'
      : 'manga';
    const st = String(attr.status || '').toLowerCase().trim();
    const status = (st === 'finished' || st === 'completed') ? 'FINISHED'
      : (st === 'current' || st === 'upcoming' || st === 'releasing') ? 'RELEASING'
      : undefined;
    const rating = attr.averageRating ? Number((Number(attr.averageRating) / 10).toFixed(1)) : undefined;
    const cover = attr.posterImage?.large || attr.posterImage?.original || attr.coverImage?.large || '';
    return {
      provider: 'Kitsu',
      title: canonical,
      altTitles: Array.from(new Set(altTitles)),
      coverImage: cover,
      description: cleanHtml(attr.synopsis || attr.description || ''),
      genres: [],
      rating,
      status,
      publicationType: pubType,
      externalUrl: `https://kitsu.io/manga/${item.id}`,
      apiId: String(item.id),
      authors: [],
      categories: [],
    };
  } catch (err: any) {
    console.warn(`[Kitsu Meta] Failed for ${title}:`, err.message);
    return null;
  }
}

export async function fetchOpenLibraryMetadata(title: string): Promise<UnifiedMetadataResult | null> {
  const searchTitle = sanitizeTitleForSearch(title) || title;
  if (!searchTitle || searchTitle.length < 2) return null;
  try {
    await throttleProvider('openlibrary');
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(searchTitle)}&limit=5&fields=title,author_name,first_publish_year,cover_i,key,subject`;
    const res = await fetch(url, {
      headers: { 'User-Agent': APP_USER_AGENT },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    const doc = json?.docs?.[0];
    if (!doc) return null;
    const genres = (doc.subject || []).filter((s: string) => !/^series:/i.test(s)).slice(0, 12);
    const cover = doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg` : '';
    return {
      provider: 'OpenLibrary',
      title: doc.title || searchTitle,
      altTitles: [],
      coverImage: cover,
      description: '',
      genres,
      status: undefined,
      publicationType: 'novel',
      externalUrl: doc.key ? `https://openlibrary.org${doc.key}` : '',
      apiId: doc.key || undefined,
      authors: (doc.author_name || []).filter(Boolean),
      categories: [],
    };
  } catch (err: any) {
    console.warn(`[OpenLibrary Meta] Failed for ${title}:`, err.message);
    return null;
  }
}

export async function fetchGoogleBooksMetadata(title: string): Promise<UnifiedMetadataResult | null> {
  const searchTitle = sanitizeTitleForSearch(title) || title;
  if (!searchTitle || searchTitle.length < 2) return null;
  try {
    await throttleProvider('googlebooks');
    const url = `https://www.googleapis.com/books/v1/volumes?q=intitle:${encodeURIComponent(searchTitle)}&maxResults=5`;
    const res = await fetch(url, {
      headers: { 'User-Agent': APP_USER_AGENT },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    const item = json?.items?.[0];
    if (!item) return null;
    const vi = item.volumeInfo || {};
    const thumb = vi.imageLinks?.thumbnail || vi.imageLinks?.smallThumbnail || '';
    const cover = thumb ? thumb.replace(/^http:/, 'https:') : '';
    const r5 = vi.averageRating ? Number(vi.averageRating) : undefined;
    return {
      provider: 'GoogleBooks',
      title: vi.title || searchTitle,
      altTitles: (vi.subtitle ? [vi.subtitle] : []).filter(Boolean),
      coverImage: cover,
      description: cleanHtml(vi.description || ''),
      genres: (vi.categories || []).filter(Boolean),
      rating: r5 != null ? Number((r5 * 2).toFixed(1)) : undefined,
      status: undefined,
      publicationType: 'novel',
      externalUrl: vi.previewLink || vi.infoLink || '',
      apiId: item.id || undefined,
      authors: (vi.authors || []).filter(Boolean),
      categories: [],
    };
  } catch (err: any) {
    console.warn(`[GoogleBooks Meta] Failed for ${title}:`, err.message);
    return null;
  }
}

export async function aggregateMultiSourceMetadata(title: string): Promise<{
  merged: Partial<UnifiedMetadataResult>;
  sources: UnifiedMetadataResult[];
}> {
  const queryTitle = sanitizeTitleForSearch(title) || title;
  const t = appSettings as any;
  const enabled = {
    mangadex: t.mangadexConnected !== false,
    anilist: t.anilistConnected !== false,
    mal: t.malEnabled !== false,
    mangaupdates: t.mangaUpdatesEnabled !== false,
    kitsu: t.kitsuMetadataEnabled !== false,
    openlibrary: t.openlibraryEnabled !== false,
    googlebooks: t.googleBooksEnabled !== false,
  };

  const results = await Promise.allSettled([
    cachedProviderResult('mangadex:' + queryTitle, () =>
      enabled.mangadex
        ? getMangaDexMetadataByTitle(queryTitle).then((md) =>
            md
              ? {
                  provider: 'MangaDex' as const,
                  title: md.title || title,
                  altTitles: md.altTitles || [],
                  coverImage: md.coverImage || '',
                  description: md.description || '',
                  genres: md.genres || [],
                  apiId: md.apiId || undefined,
                }
              : null
          )
        : Promise.resolve(null)
    ),
    cachedProviderResult('anilist:' + queryTitle, () => (enabled.anilist ? fetchAniListMetadata(queryTitle) : Promise.resolve(null))),
    cachedProviderResult('mangaupdates:' + queryTitle, () => (enabled.mangaupdates ? fetchMangaUpdatesMetadata(queryTitle) : Promise.resolve(null))),
    cachedProviderResult('jikan:' + queryTitle, () => (enabled.mal !== false ? fetchJikanMetadata(queryTitle) : Promise.resolve(null))),
    cachedProviderResult('kitsu:' + queryTitle, () => (enabled.kitsu ? fetchKitsuMetadata(queryTitle) : Promise.resolve(null))),
    cachedProviderResult('openlibrary:' + queryTitle, () => (enabled.openlibrary ? fetchOpenLibraryMetadata(queryTitle) : Promise.resolve(null))),
    cachedProviderResult('googlebooks:' + queryTitle, () => (enabled.googlebooks ? fetchGoogleBooksMetadata(queryTitle) : Promise.resolve(null))),
  ]);

  const sources: UnifiedMetadataResult[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) {
      sources.push(r.value);
    }
  }

  if (sources.length === 0) {
    return { merged: {}, sources: [] };
  }

  const bestCover =
    sources.find((s) => s.coverImage && (s.provider === 'AniList' || s.provider === 'MangaDex'))?.coverImage || sources[0].coverImage;
  const bestDesc = [...sources].sort((a, b) => (b.description?.length || 0) - (a.description?.length || 0))[0]?.description || '';
  const allGenres = Array.from(new Set(sources.flatMap((s) => s.genres || [])));
  const allAltTitles = Array.from(new Set(sources.flatMap((s) => s.altTitles || [])));
  const allAuthors = Array.from(new Set(sources.flatMap((s) => s.authors || [])));
  const allCategories = Array.from(new Set(sources.flatMap((s) => s.categories || [])));

  const validRatings = sources.map((s) => s.rating).filter((r): r is number => typeof r === 'number' && r > 0);
  const avgRating =
    validRatings.length > 0
      ? Number((validRatings.reduce((a, b) => a + b, 0) / validRatings.length).toFixed(1))
      : undefined;

  return {
    merged: {
      title: sources[0].title || title,
      altTitles: allAltTitles,
      coverImage: bestCover,
      description: bestDesc,
      genres: allGenres,
      rating: avgRating,
      status: sources.find((s) => s.status)?.status || 'RELEASING',
      publicationType: sources.find((s) => s.publicationType)?.publicationType || 'manhwa',
      authors: allAuthors,
      categories: allCategories,
      dataSources: Array.from(new Set(sources.map((s) => s.provider))),
    },
    sources,
  };
}
