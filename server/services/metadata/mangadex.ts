// ============================================================================
// MangaDex API Client & Metadata Caching Service
// Rate-limiting compliance (~4.5 req/sec) and in-memory cache with eviction.
// ============================================================================

import { APP_USER_AGENT } from '../../version';
import { preferEnglishTitle } from '../../../src/utils/metadataHelpers';
import { calculateStringSimilarity } from './similarity';

let lastMangaDexRequestTime = 0;
const MANGADEX_RATE_LIMIT_MS = 220;

export async function fetchMangaDex(url: string, options: RequestInit = {}, retriesLeft = 2): Promise<Response> {
  const now = Date.now();
  const timeSinceLast = now - lastMangaDexRequestTime;
  if (timeSinceLast < MANGADEX_RATE_LIMIT_MS) {
    await new Promise((r) => setTimeout(r, MANGADEX_RATE_LIMIT_MS - timeSinceLast));
  }
  lastMangaDexRequestTime = Date.now();

  const headers = new Headers(options.headers || {});
  headers.set('User-Agent', APP_USER_AGENT);
  headers.delete('Via');
  headers.delete('X-Forwarded-For');

  const response = await fetch(url, {
    ...options,
    headers,
    signal: options.signal || AbortSignal.timeout(15000),
  });

  if (response.status === 429 && retriesLeft > 0) {
    const retryAfter = response.headers.get('X-RateLimit-Retry-After');
    if (!retryAfter) {
      return response;
    }
    const retryUnix = Number(retryAfter) || Math.floor(Date.now() / 1000) + 5;
    const waitMs = Math.max(1000, retryUnix * 1000 - Date.now());
    console.warn(`[MangaDex API Rate Limiter] 429 Quota Exceeded. Waiting ${waitMs}ms before retrying (${retriesLeft} retries left)...`);
    await new Promise((r) => setTimeout(r, waitMs));
    return fetchMangaDex(url, options, retriesLeft - 1);
  }

  return response;
}

const mangadexMetaCache = new Map<
  string,
  {
    title: string;
    apiId: string | null;
    coverImage: string;
    description: string;
    genres: string[];
    altTitles: string[];
    expires: number;
  }
>();
const MANGADEX_META_TTL = 6 * 60 * 60 * 1000; // 6 hours

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

export async function getMangaDexMetadataByTitle(
  title: string
): Promise<{ apiId: string | null; title: string; coverImage: string; description: string; genres: string[]; altTitles: string[] } | null> {
  const cleanTitle = (title || '').trim();
  if (!cleanTitle) return null;
  const key = cleanTitle
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
  if (!key) return null;
  const cached = mangadexMetaCache.get(key);
  if (cached && cached.expires > Date.now()) {
    const { title, apiId, coverImage, description, genres, altTitles } = cached;
    return { title, apiId, coverImage, description, genres, altTitles };
  }

  try {
    const clean = cleanTitle
      .replace(/\s*\([^)]*\)/g, '')
      .replace(/uncensored|reboot|hd|season\s+\d+|ch\s*\d+/gi, '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
    if (clean.length < 3) return null;

    const mdRes = await fetchMangaDex(
      `https://api.mangadex.org/manga?title=${encodeURIComponent(clean)}&limit=5&includes[]=cover_art&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica`
    );
    if (!mdRes.ok) return null;
    const json = await mdRes.json();
    const list: any[] = Array.isArray(json?.data) ? json.data : [];
    if (list.length === 0) return null;

    let matched: any = null;
    let bestSim = 0;
    for (const cand of list) {
      const candTitle = cand?.attributes?.title?.en || Object.values(cand?.attributes?.title || {})[0] || '';
      const sim = calculateStringSimilarity(clean, String(candTitle));
      if (sim > bestSim) {
        bestSim = sim;
        matched = cand;
      }
    }

    if (!matched || bestSim < 75) {
      return null;
    }

    const coverRel = (matched.relationships || []).find((r: any) => r.type === 'cover_art');
    const coverFileName = coverRel?.attributes?.fileName;
    const descObj = matched.attributes?.description || {};
    const meta = {
      title: preferEnglishTitle(matched.attributes?.title || null) || '',
      apiId: matched.id,
      coverImage: coverFileName
        ? `/api/mangadex/image-proxy?url=${encodeURIComponent(`https://uploads.mangadex.org/covers/${matched.id}/${coverFileName}.512.jpg`)}`
        : '',
      description: (descObj.en || Object.values(descObj)[0] || '').substring(0, 400),
      genres: (matched.attributes?.tags || []).map((t: any) => t.attributes?.name?.en).filter(Boolean).slice(0, 8),
      altTitles: (matched.attributes?.altTitles || []).map((t: any) => Object.values(t)[0]).filter(Boolean) as string[],
    };
    if (mangadexMetaCache.size >= 500) evictCache(mangadexMetaCache, 500);
    mangadexMetaCache.set(key, { ...meta, expires: Date.now() + MANGADEX_META_TTL });
    return meta;
  } catch (_) {
    return null;
  }
}

export function isMangaDexSourceLink(sourceName?: string, sourceUrl?: string): boolean {
  const sName = (sourceName || '').toLowerCase();
  const sUrl = (sourceUrl || '').toLowerCase();
  return sName.includes('mangadex') || sUrl.includes('mangadex.org');
}
