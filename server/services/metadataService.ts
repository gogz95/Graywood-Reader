import { MangaItem, isNsfwManga } from '../../src/types';
import { SqliteDb } from '../../sqlite-db';
import { mangaDatabase, saveDatabaseToDisk } from '../appState';
import {
  snapshotMetadataOverrides,
  restoreMetadataOverrides,
  preferEnglishTitle,
} from '../../src/utils/metadataHelpers';
import { fetchAsuraSeriesMetadata } from '../scrapers/asuraScans';
import { fetchFlameSeriesContext } from '../scrapers/flameComics';
import { isSeriesFromDisabledSource } from '../sources/sourcesCatalog';
import { APP_USER_AGENT } from '../version';

// ── Rate-Limiting & Compliance Engine for MangaDex API ────────────────────────
let lastMangaDexRequestTime = 0;
const MANGADEX_RATE_LIMIT_MS = 220; // Enforces max ~4.5 req/sec (compliant with 5 req/sec rule)

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

  // Handle MangaDex rate-limiting (HTTP 429) with exponential retry backoff
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

// ── String Similarity Engine (Levenshtein + Token Optimization) ──────────────
export function calculateStringSimilarity(str1: string, str2: string): number {
  if (!str1 || !str2) return 0;
  if (str1 === str2) return 100;

  const s1 = str1.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const s2 = str2.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();

  if (s1 === s2) return 100;
  if (!s1 || !s2) return 0;

  if (s1.includes(s2) || s2.includes(s1)) {
    return 85;
  }

  const words1 = s1.split(/\s+/);
  const words2 = s2.split(/\s+/);
  const t1 = new Set(words1);
  const t2 = new Set(words2);

  let shared = 0;
  t1.forEach((t) => {
    if (t2.has(t)) shared++;
  });
  const tokenSim = (2 * shared) / (t1.size + t2.size);

  // Fast token match skip: if token similarity is exact or near 0 on long strings, avoid 2D matrix
  if (tokenSim === 1) return 100;

  // Character Levenshtein distance
  const len1 = s1.length;
  const len2 = s2.length;
  const matrix: number[][] = Array.from({ length: len1 + 1 }, () => Array(len2 + 1).fill(0));

  for (let i = 0; i <= len1; i++) matrix[i][0] = i;
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  const levDist = matrix[len1][len2];
  const maxLen = Math.max(len1, len2);
  const levSim = 1 - levDist / maxLen;

  return Math.round((tokenSim * 0.6 + levSim * 0.4) * 100);
}

// ── In-Memory MangaDex Metadata Cache ─────────────────────────────────────────
const mangadexMetaCache = new Map<
  string,
  {
    apiId: string | null;
    coverImage: string;
    description: string;
    genres: string[];
    altTitles: string[];
    fetchedAt: number;
  }
>();
const MANGADEX_META_TTL = 6 * 60 * 60 * 1000; // 6 hours

export async function getMangaDexMetadataByTitle(
  title: string
): Promise<{ apiId: string | null; coverImage: string; description: string; genres: string[]; altTitles: string[] } | null> {
  const cleanTitle = (title || '').trim();
  if (!cleanTitle) return null;
  const key = cleanTitle
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
  if (!key) return null;
  const cached = mangadexMetaCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < MANGADEX_META_TTL) return cached;

  try {
    const clean = cleanTitle
      .replace(/\s*\([^)]*\)/g, '')
      .replace(/uncensored|reboot|hd|season\s+\d+|ch\s*\d+/gi, '')
      .trim();
    if (clean.length < 3) return null;

    const mdRes = await fetchMangaDex(
      `https://api.mangadex.org/manga?title=${encodeURIComponent(clean)}&limit=1&includes[]=cover_art&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica`
    );
    if (!mdRes.ok) return null;
    const json = await mdRes.json();
    const m = json?.data?.[0];
    if (!m) return null;

    const coverRel = (m.relationships || []).find((r: any) => r.type === 'cover_art');
    const coverFileName = coverRel?.attributes?.fileName;
    const descObj = m.attributes?.description || {};
    const meta = {
      apiId: m.id,
      coverImage: coverFileName
        ? `/api/mangadex/image-proxy?url=${encodeURIComponent(`https://uploads.mangadex.org/covers/${m.id}/${coverFileName}.512.jpg`)}`
        : '',
      description: (descObj.en || Object.values(descObj)[0] || '').substring(0, 400),
      genres: (m.attributes?.tags || []).map((t: any) => t.attributes?.name?.en).filter(Boolean).slice(0, 8),
      altTitles: (m.attributes?.altTitles || []).map((t: any) => Object.values(t)[0]).filter(Boolean) as string[],
    };
    mangadexMetaCache.set(key, { ...meta, fetchedAt: Date.now() });
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

// ── Refresh Live Metadata for a Single Manga Item ────────────────────────────
export async function refreshSingleMangaMetadata(manga: MangaItem): Promise<MangaItem> {
  const metadataSnap = snapshotMetadataOverrides(manga);

  // 1. MangaDex Metadata Refresh & Title Search Linker
  let mangaDexId =
    manga.apiId ||
    (manga.id?.startsWith('md_') ? manga.id.replace('md_', '') : null) ||
    manga.sourceUrl?.match(/\/title\/([a-f0-9\-]+)/i)?.[1];

  if (!mangaDexId && manga.title && manga.title !== 'Unknown') {
    try {
      const cleanTitle = manga.title
        .replace(/\s*\([^)]*\)/g, '')
        .replace(/uncensored|reboot|hd|season \d+|ch \d+/gi, '')
        .trim();
      if (cleanTitle.length > 2) {
        const searchRes = await fetchMangaDex(
          `https://api.mangadex.org/manga?title=${encodeURIComponent(cleanTitle)}&limit=5&includes[]=cover_art&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica`
        );
        if (searchRes.ok) {
          const searchJson = await searchRes.json();
          const results: any[] = Array.isArray(searchJson.data) ? searchJson.data : [];
          let matched: any = null;
          let bestSim = 0;
          for (const cand of results) {
            const candTitle = cand?.attributes?.title?.en || Object.values(cand?.attributes?.title || {})[0] || '';
            const sim = calculateStringSimilarity(cleanTitle, String(candTitle));
            if (sim > bestSim) {
              bestSim = sim;
              matched = cand;
            }
          }
          if (matched && bestSim >= 60) {
            mangaDexId = matched.id;
            manga.apiId = matched.id;
            manga.syncedFromApi = 'MangaDex API v5';
          } else if (matched) {
            console.warn(`[Metadata Refresh] MangaDex best match for "${manga.title}" scored ${bestSim} — below threshold (60), NOT linking.`);
          }
        }
      }
    } catch (_) {}
  }

  if (mangaDexId) {
    try {
      const mdRes = await fetchMangaDex(`https://api.mangadex.org/manga/${mangaDexId}?includes[]=cover_art`);
      if (mdRes.ok) {
        const mdJson = await mdRes.json();
        const attrs = mdJson.data?.attributes || {};
        const rels = mdJson.data?.relationships || [];
        const coverRel = rels.find((r: any) => r.type === 'cover_art');
        const coverFileName = coverRel?.attributes?.fileName;

        if (attrs.title) {
          const mainTitle = preferEnglishTitle(attrs.title);
          if (mainTitle) manga.title = mainTitle;
        }
        if (attrs.description && (attrs.description.en || Object.values(attrs.description)[0])) {
          manga.description = attrs.description.en || Object.values(attrs.description)[0];
        }
        if (attrs.altTitles && Array.isArray(attrs.altTitles)) {
          const newAlts = attrs.altTitles.map((t: any) => Object.values(t)[0]).filter(Boolean) as string[];
          if (newAlts.length > 0) {
            manga.altTitles = Array.from(new Set([...(manga.altTitles || []), ...newAlts]));
          }
        }
        if (coverFileName) {
          manga.coverImage = `/api/mangadex/image-proxy?url=${encodeURIComponent(`https://uploads.mangadex.org/covers/${mangaDexId}/${coverFileName}.512.jpg`)}`;
        }
        if (attrs.tags && Array.isArray(attrs.tags)) {
          const tags = attrs.tags.map((t: any) => t.attributes?.name?.en).filter(Boolean);
          if (tags.length > 0) {
            manga.genres = Array.from(new Set([...(manga.genres || []), ...tags]));
          }
        }

        // Fetch real total chapter number from MangaDex aggregate endpoint
        try {
          const aggRes = await fetchMangaDex(
            `https://api.mangadex.org/manga/${mangaDexId}/aggregate?translatedLanguage[]=en`
          );
          if (aggRes.ok) {
            const aggJson = await aggRes.json();
            const volumes = aggJson.volumes || {};
            let maxCh = manga.latestChapter || 1;
            for (const vol of Object.values(volumes) as any[]) {
              const chs = vol?.chapters || {};
              for (const chKey of Object.keys(chs)) {
                const num = parseFloat(chKey);
                if (Number.isFinite(num) && num > maxCh) {
                  maxCh = num;
                }
              }
            }
            if (maxCh > (manga.latestChapter || 0)) {
              manga.latestChapter = maxCh;
            }
          } else {
            const feedRes = await fetchMangaDex(
              `https://api.mangadex.org/manga/${mangaDexId}/feed?limit=500&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica`
            );
            if (feedRes.ok) {
              const feedJson = await feedRes.json();
              const chapters = feedJson.data || [];
              const maxCh = chapters.reduce((max: number, c: any) => Math.max(max, parseFloat(c.attributes.chapter) || 0), manga.latestChapter || 1);
              if (maxCh > (manga.latestChapter || 0)) {
                manga.latestChapter = maxCh;
              }
            }
          }
        } catch (_) {}
      }
    } catch (e: any) {
      console.warn(`[Metadata Refresh] MangaDex refresh failed for ${manga.title}:`, e.message);
    }
  }

  // 2. Asura Scans Metadata Refresh
  if (manga.sourceUrl && /asura(?:comic\.net|scans\.(?:com|org))/i.test(manga.sourceUrl)) {
    manga.sourceUrl = manga.sourceUrl.replace(/asuracomic\.net/gi, 'asurascans.com').replace(/asurascans\.(?:com|org)/gi, 'asurascans.com');
    try {
      const asuraMeta = await fetchAsuraSeriesMetadata(manga.sourceUrl);
      if (asuraMeta) {
        if (asuraMeta.title) manga.title = asuraMeta.title;
        if (asuraMeta.coverImage) manga.coverImage = asuraMeta.coverImage;
        if (asuraMeta.description) manga.description = asuraMeta.description;
        if (asuraMeta.rating) manga.rating = asuraMeta.rating;
        if (asuraMeta.latestChapter) manga.latestChapter = Math.max(manga.latestChapter || 1, asuraMeta.latestChapter);
        if (asuraMeta.altTitles && asuraMeta.altTitles.length > 0) {
          manga.altTitles = Array.from(new Set([...(manga.altTitles || []), ...asuraMeta.altTitles]));
        }
        if (asuraMeta.genres && asuraMeta.genres.length > 0) {
          manga.genres = Array.from(new Set([...(manga.genres || []), ...asuraMeta.genres]));
        }
      }
    } catch (e: any) {
      console.warn(`[Metadata Refresh] Asura Scans refresh failed for ${manga.title}:`, e.message);
    }
  }

  // 3. Flame Comics Metadata Refresh
  if (manga.sourceUrl && manga.sourceUrl.includes('flamecomics')) {
    try {
      const flameCtx = await fetchFlameSeriesContext(manga.sourceUrl);
      if (flameCtx) {
        if (flameCtx.matchedSeries?.title) manga.title = flameCtx.matchedSeries.title;
        if (flameCtx.chapters && flameCtx.chapters.length > 0) {
          manga.latestChapter = Math.max(manga.latestChapter || 1, flameCtx.chapters.length);
        }
      }
    } catch (e: any) {
      console.warn(`[Metadata Refresh] Flame Comics refresh failed for ${manga.title}:`, e.message);
    }
  }

  restoreMetadataOverrides(manga, metadataSnap);

  manga.lastUpdated = new Date().toISOString();
  SqliteDb.upsertManga(manga);

  const idx = mangaDatabase.findIndex((m) => m.id === manga.id);
  if (idx !== -1) {
    mangaDatabase[idx] = manga;
  }
  return manga;
}

export async function enrichWithMangaDexMetadata<T extends { title: string; coverImage?: string; description?: string; genres?: string[]; altTitles?: string[]; apiId?: string | null }>(items: T[]): Promise<T[]> {
  if (!items || items.length === 0) return items;
  return Promise.all(
    items.map(async (item) => {
      try {
        if (!item.title) return item;
        const meta = await getMangaDexMetadataByTitle(item.title);
        if (!meta) return item;

        return {
          ...item,
          apiId: item.apiId || meta.apiId || null,
          coverImage: item.coverImage || meta.coverImage || '',
          description: item.description || meta.description || '',
          genres: (item.genres && item.genres.length > 0) ? item.genres : (meta.genres || []),
          altTitles: (item.altTitles && item.altTitles.length > 0) ? item.altTitles : (meta.altTitles || []),
        };
      } catch {
        return item;
      }
    })
  );
}

export async function purgeDisabledSourcesAndRefreshMetadata(): Promise<{
  purgedCount: number;
  refreshedCount: number;
}> {
  let purgedCount = 0;
  let refreshedCount = 0;

  const validItems: MangaItem[] = [];
  for (const m of mangaDatabase) {
    if (isSeriesFromDisabledSource(m)) {
      SqliteDb.deleteManga(m.id);
      purgedCount++;
    } else {
      validItems.push(m);
    }
  }

  mangaDatabase.length = 0;
  mangaDatabase.push(...validItems);

  for (const m of mangaDatabase.slice(0, 50)) {
    try {
      await refreshSingleMangaMetadata(m);
      refreshedCount++;
    } catch {}
  }

  saveDatabaseToDisk();
  return { purgedCount, refreshedCount };
}
