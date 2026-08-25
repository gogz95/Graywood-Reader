import * as cheerio from 'cheerio';
import { MangaItem, isNsfwManga } from '../../src/types';
import { SqliteDb } from '../../sqlite-db';
import { mangaDatabase, appSettings, saveDatabaseToDisk, syncAddOrUpdateManga } from '../appState';
import {
  snapshotMetadataOverrides,
  restoreMetadataOverrides,
  preferEnglishTitle,
  DEFAULT_UNKNOWN_RATING,
  cleanMangaTitle,
} from '../../src/utils/metadataHelpers';
import { fetchAsuraSeriesMetadata } from '../scrapers/asuraScans';
import { fetchFlameSeriesContext } from '../scrapers/flameComics';
import { fetchWeebCentralSeriesMetadata } from '../scrapers/weebCentral';
import { isSeriesFromDisabledSource } from '../sources/sourcesCatalog';
import { fetchWithChallengeBypass } from '../captchaSolver';
import { sourceCookieJar } from './sourceHealthService';
import { parseGenericChapterListFromHtml } from './crawlerEngine';
import { isAdSeries, isAdUrl, isAdTitle, stripAdElements } from '../adFilter';
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

  const normalize = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, '')
      .trim();
  const s1 = normalize(str1);
  const s2 = normalize(str2);

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

  const distance = matrix[len1][len2];
  const maxLen = Math.max(len1, len2);
  const charSim = (1 - distance / maxLen) * 100;

  return Math.round(tokenSim * 50 + charSim * 0.5);
}

// ── In-Memory MangaDex Metadata Cache ─────────────────────────────────────────
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

/**
 * Shared cache eviction: first sweeps expired entries, then enforces a hard
 * capacity cap by evicting the oldest (FIFO) entries.  This prevents both
 * unbounded growth and stale data from lingering past its TTL.
 */
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

    // Strict similarity threshold check (>= 75%) to prevent false-positive matches
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

// ── Generic HTML Series Metadata Parser ───────────────────────────────────────
export function parseGenericLiveSeriesMetadata(html: string, pageUrl: string): Partial<MangaItem> | null {
  if (!html) return null;
  const $ = cheerio.load(html);
  stripAdElements($);
  let origin = '';
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    origin = '';
  }

  let title = '';
  let coverImage = '';
  let description = '';
  const genresSet = new Set<string>();
  let latestChapter: number | undefined = undefined;
  let rating: number | undefined = undefined;

  // A. Check JSON-LD structured data first
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const raw = $(el).html()?.trim();
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed) ? parsed : [parsed, ...(parsed['@graph'] || [])];
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const type = String(item['@type'] || '').toLowerCase();
        if (type.includes('book') || type.includes('creativework') || type.includes('comicseries') || type.includes('article') || type.includes('webpage')) {
          if (!title && item.name) title = cleanHtml(String(item.name));
          if (!description && item.description) description = cleanHtml(String(item.description));
          if (!coverImage && (item.image || item.thumbnailUrl)) {
            const img = item.image?.url || item.image || item.thumbnailUrl;
            if (typeof img === 'string') coverImage = img;
          }
          if (Array.isArray(item.genre)) {
            item.genre.forEach((g: any) => typeof g === 'string' && genresSet.add(g.trim()));
          }
        }
      }
    } catch (_) {}
  });

  // B. Check __NEXT_DATA__ SSR hydration
  const nextData = $('script#__NEXT_DATA__').html()?.trim();
  if (nextData) {
    try {
      const parsed = JSON.parse(nextData);
      const seriesObj = parsed?.props?.pageProps?.series || parsed?.props?.pageProps?.manga || parsed?.props?.pageProps?.comic || parsed?.props?.pageProps?.data;
      if (seriesObj && typeof seriesObj === 'object') {
        if (!title && seriesObj.title) title = cleanHtml(seriesObj.title);
        if (!description && (seriesObj.description || seriesObj.synopsis)) {
          description = cleanHtml(seriesObj.description || seriesObj.synopsis);
        }
        if (!coverImage && (seriesObj.cover || seriesObj.thumbnail || seriesObj.thumb || seriesObj.image || seriesObj.coverImage)) {
          coverImage = seriesObj.cover || seriesObj.thumbnail || seriesObj.thumb || seriesObj.image || seriesObj.coverImage;
        }
        if (Array.isArray(seriesObj.genres)) {
          seriesObj.genres.forEach((g: any) => {
            const name = typeof g === 'string' ? g : g?.name || g?.title;
            if (name) genresSet.add(String(name).trim());
          });
        }
      }
    } catch (_) {}
  }

  // C. Fallback to CSS Selectors for Title
  if (!title) {
    title =
      $('.post-title h1, .entry-title, .series-name h1, .series-name a, .profile-manga .post-title h1, .story-info-right h1, div.anime-title h1, .manga-info h1')
        .first()
        .text()
        .trim() ||
      $('meta[property="og:title"]').attr('content') ||
      $('meta[name="twitter:title"]').attr('content') ||
      $('title').text().trim() ||
      '';
  }

  if (title) {
    title = cleanMangaTitle(title);
    if (isAdSeries(title, pageUrl) || isAdTitle(title)) {
      return null;
    }
  }

  if (isAdUrl(pageUrl)) {
    return null;
  }

  // D. Fallback to CSS Selectors for Cover Image
  if (!coverImage) {
    const candidateImg = $(
      '.summary_image img, .tab-summary .summary_image img, .profile-manga .thumb img, .story-info-left .img-loading, .series-thumb img, div.poster img, .manga-info-pic img'
    ).first();

    coverImage =
      candidateImg.attr('data-src') ||
      candidateImg.attr('data-lazy-src') ||
      candidateImg.attr('data-original') ||
      candidateImg.attr('data-cdn-src') ||
      candidateImg.attr('data-cfsrc') ||
      candidateImg.attr('data-full-url') ||
      candidateImg.attr('src') ||
      $('meta[property="og:image"]').attr('content') ||
      $('meta[name="twitter:image"]').attr('content') ||
      '';
  }

  if (coverImage) {
    coverImage = coverImage.trim();
    if (coverImage.startsWith('//')) coverImage = 'https:' + coverImage;
    else if (coverImage.startsWith('/') && origin) coverImage = `${origin}${coverImage}`;
  }

  // E. Fallback to CSS Selectors for Description
  if (!description) {
    description =
      $('.summary__content, .description-summary .summary__content, .panel-story-info-description, .series-synopsis, div.synopsis, .story-info-right .panel-story-info-description, .entry-content p, .post-content')
        .first()
        .text()
        .trim() ||
      $('meta[property="og:description"]').attr('content') ||
      $('meta[name="description"]').attr('content') ||
      '';

    description = cleanHtml(description.replace(/^(?:Description|Synopsis)\s*:\s*/i, ''));
  }

  // F. Fallback to CSS Selectors for Genres
  if (genresSet.size === 0) {
    $('.genres-content a, .mgen a, .series-genres a, .story-info-right-extent .genres-content a, .post-content_item:contains("Genre") a, a[href*="/genre/"], a[href*="/genres/"], a[href*="/the-loai/"]')
      .each((_, el) => {
        const g = $(el).text().trim();
        if (g && g.length < 30 && !/^(read|manga|all|genre|genres)$/i.test(g)) {
          genresSet.add(g);
        }
      });
  }

  // G. Chapters
  const chapters = parseGenericChapterListFromHtml(html, origin);
  if (chapters.length > 0) {
    latestChapter = Math.max(...chapters.map((c) => c.number));
  }

  // H. Rating
  const ratingStr =
    $('.post-total-rating .score, span.rating-val, .star-rating span, meta[itemprop="ratingValue"]')
      .first()
      .text()
      .trim() ||
    $('meta[itemprop="ratingValue"]').attr('content') ||
    '';
  if (ratingStr) {
    const num = parseFloat(ratingStr);
    if (Number.isFinite(num) && num > 0 && num <= 10) rating = num;
  }

  const result: Partial<MangaItem> = {};
  if (title) result.title = title;
  if (coverImage) result.coverImage = coverImage;
  if (description) result.description = description;
  if (genresSet.size > 0) result.genres = Array.from(genresSet);
  if (latestChapter && latestChapter > 0) result.latestChapter = latestChapter;
  if (rating) result.rating = rating;

  return Object.keys(result).length > 0 ? result : null;
}

export async function fetchLiveSeriesMetadata(sourceUrl: string, sourceName?: string): Promise<Partial<MangaItem> | null> {
  if (!sourceUrl || !sourceUrl.startsWith('http')) return null;
  try {
    const origin = new URL(sourceUrl).origin;
    const bypassRes = await fetchWithChallengeBypass(sourceUrl, {
      headers: {
        'User-Agent': APP_USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Referer': origin + '/',
      },
      enableCloudflareBypass: appSettings.enableCloudflareBypass,
      flareSolverrUrl: appSettings.flareSolverrUrl,
      captchaSolverEnabled: appSettings.captchaSolverEnabled,
      captchaApiKey: appSettings.captchaApiKey,
      timeoutMs: 15000,
      sourceId: origin,
      onCookieUpdate: (sid: string, cookies: string[]) => sourceCookieJar.setCookies(sid, cookies),
    });

    if (!bypassRes.ok || !bypassRes.html) return null;
    return parseGenericLiveSeriesMetadata(bypassRes.html, sourceUrl);
  } catch (err: any) {
    console.warn(`[Live Scraper] Failed to fetch metadata for ${sourceUrl}:`, err.message);
    return null;
  }
}

// ── Refresh Live Metadata for a Single Manga Item ────────────────────────────
export async function refreshSingleMangaMetadata(manga: MangaItem): Promise<MangaItem> {
  const metadataSnap = snapshotMetadataOverrides(manga);

  const hasLiveSourceUrl = Boolean(
    manga.sourceUrl &&
    manga.sourceUrl.startsWith('http') &&
    !isMangaDexSourceLink(manga.sourceName, manga.sourceUrl)
  );

  // 1. MangaDex Metadata Refresh (ONLY for MangaDex-native series or entries without a live scraper source)
  let mangaDexId =
    (manga.syncedFromApi === 'MangaDex API v5' ? manga.apiId : null) ||
    (manga.id?.startsWith('md_') ? manga.id.replace('md_', '') : null) ||
    manga.sourceUrl?.match(/\/title\/([a-f0-9\-]+)/i)?.[1];

  if (!hasLiveSourceUrl) {
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
            if (matched && bestSim >= 80) {
              mangaDexId = matched.id;
              manga.apiId = matched.id;
              manga.syncedFromApi = 'MangaDex API v5';
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
  } else if (manga.sourceUrl && manga.sourceUrl.includes('flamecomics')) {
    // 3. Flame Comics Metadata Refresh
    try {
      const flameCtx = await fetchFlameSeriesContext(manga.sourceUrl);
      if (flameCtx) {
        if (flameCtx.matchedSeries?.title) manga.title = flameCtx.matchedSeries.title;
        if (flameCtx.matchedSeries?.synopsis) manga.description = flameCtx.matchedSeries.synopsis;
        if (flameCtx.matchedSeries?.thumb) manga.coverImage = flameCtx.matchedSeries.thumb;
        if (flameCtx.matchedSeries?.genres && flameCtx.matchedSeries.genres.length > 0) {
          manga.genres = Array.from(new Set([...(manga.genres || []), ...flameCtx.matchedSeries.genres]));
        }
        if (flameCtx.chapters && flameCtx.chapters.length > 0) {
          manga.latestChapter = Math.max(manga.latestChapter || 1, flameCtx.chapters.length);
        }
      }
    } catch (e: any) {
      console.warn(`[Metadata Refresh] Flame Comics refresh failed for ${manga.title}:`, e.message);
    }
  } else if (manga.sourceUrl && manga.sourceUrl.includes('weebcentral.com')) {
    // 4. WeebCentral Metadata Refresh
    try {
      const weebMeta = await fetchWeebCentralSeriesMetadata(manga.sourceUrl);
      if (weebMeta) {
        if (weebMeta.title) manga.title = weebMeta.title;
        if (weebMeta.coverImage) manga.coverImage = weebMeta.coverImage;
        if (weebMeta.description) manga.description = weebMeta.description;
        if (weebMeta.genres && weebMeta.genres.length > 0) {
          manga.genres = Array.from(new Set([...(manga.genres || []), ...weebMeta.genres]));
        }
        const wcLatest = (weebMeta as any).latestChapter;
        if (wcLatest && typeof wcLatest === 'number') {
          manga.latestChapter = Math.max(manga.latestChapter || 1, wcLatest);
        }
      }
    } catch (e: any) {
      console.warn(`[Metadata Refresh] WeebCentral refresh failed for ${manga.title}:`, e.message);
    }
  } else if (hasLiveSourceUrl) {
    // 5. Live Scraper Metadata Refresh (Manhwa18, Madara, Mangathemesia, WP-Comics, etc.)
    try {
      const liveMeta = await fetchLiveSeriesMetadata(manga.sourceUrl, manga.sourceName);
      if (liveMeta) {
        if (liveMeta.title) manga.title = liveMeta.title;
        if (liveMeta.coverImage) manga.coverImage = liveMeta.coverImage;
        if (liveMeta.description) manga.description = liveMeta.description;
        if (liveMeta.rating) manga.rating = liveMeta.rating;
        if (liveMeta.latestChapter) manga.latestChapter = Math.max(manga.latestChapter || 1, liveMeta.latestChapter);
        if (liveMeta.genres && liveMeta.genres.length > 0) {
          manga.genres = Array.from(new Set([...(manga.genres || []), ...liveMeta.genres]));
        }
      }
    } catch (e: any) {
      console.warn(`[Metadata Refresh] Live source refresh failed for ${manga.title} (${manga.sourceUrl}):`, e.message);
    }
  }

  // 6. Multi-Provider Fallback Enrichment
  // If metadata is sparse (missing or short synopsis, missing cover, or empty genres),
  // query multi-provider aggregators (AniList, MangaDex, MAL, Kitsu) to enrich missing details.
  const isSparse =
    !manga.coverImage ||
    !manga.description ||
    manga.description.length < 35 ||
    !manga.genres ||
    manga.genres.length === 0;

  if (isSparse && manga.title && manga.title !== 'Unknown') {
    try {
      const { merged } = await aggregateMultiSourceMetadata(manga.title);
      if (merged) {
        if (merged.coverImage && !manga.coverImage) {
          manga.coverImage = merged.coverImage;
        }
        if (merged.description && (!manga.description || manga.description.length < (merged.description?.length || 0))) {
          manga.description = merged.description;
        }
        if (merged.genres && merged.genres.length > 0) {
          manga.genres = Array.from(new Set([...(manga.genres || []), ...merged.genres]));
        }
        if (merged.altTitles && merged.altTitles.length > 0) {
          manga.altTitles = Array.from(new Set([...(manga.altTitles || []), ...merged.altTitles]));
        }
        if (merged.rating && (!manga.rating || manga.rating === DEFAULT_UNKNOWN_RATING)) {
          manga.rating = merged.rating;
        }
      }
    } catch (_) {}
  }

  restoreMetadataOverrides(manga, metadataSnap);

  manga.lastUpdated = new Date().toISOString();
  syncAddOrUpdateManga(manga);
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

// ── Per-Provider Throttling & Enablement Engine ───────────────────────────────
// Lightweight compliance layer that mirrors the MangaDex rate-limit pattern but
// keeps independent pacing per external provider so a single aggregating title
// lookup never overwhelms any one free API. All values are conservative.
const PROVIDER_THROTTLE_MS: Record<string, number> = {
  anilist: 350,       // AniList GraphQL ~3 req/s
  mangadex: 260,      // MangaDex v5 (5 req/s rule, ~4.5 req/s enforced)
  jikan: 400,         // Jikan (MAL) is ~3 req/s
  kitsu: 400,         // Kitsu JSON:API public reads ~3 req/s
  mangaupdates: 1200, // MangaUpdates free tier is aggressively rate-limited
  openlibrary: 1200,  // OpenLibrary asks ~1 req/s
  googlebooks: 500,   // Google Books public tier ~5 req/s
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

// ── Provider Response Cache (AUP: "employ caching mechanisms") ──────────────
// Metadata is fairly static, so caching prevents repeated title lookups from
// re-hitting external APIs (especially important for MangaUpdates, whose free
// tier is rate-limited). Only successful (non-null) results are cached; null
// results (e.g. transient network errors) are retried on the next call.
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

export function decodeHtmlEntities(str: string): string {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&hellip;/g, '…')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

export function cleanHtml(raw: string): string {
  if (!raw) return '';
    const withoutTags = raw.replace(/<[^>]*>/gm, ' ');
  const decoded = decodeHtmlEntities(withoutTags);
  return decoded.replace(/\s+/g, ' ').trim();
}

export function sanitizeTitleForSearch(rawTitle: string): string {
  if (!rawTitle) return '';
  const cleaned = cleanMangaTitle(rawTitle);
  return cleaned
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Multi-Provider Metadata Aggregator Engine ────────────────────────────────
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
  /** Optional explicit credit line (per MangaUpdates AUP: acknowledge the source). */
  attribution?: string;
  /** Provider names that contributed to a merged result. */
  dataSources?: string[];
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
    const res = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
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
  // MangaUpdates retired public search (HTTP 405); series lookup now requires an
  // authenticated session. Without configured credentials we degrade gracefully.
  if (!username || !password) {
    console.warn('[MangaUpdates Meta] Credentials not configured — skipping lookup (public search retired).');
    return null;
  }
  try {
    await throttleProvider('mangaupdates');

    // 1) Authenticated login (PUT /v1/account/login)
    const loginRes = await fetch('https://api.mangaupdates.com/v1/account/login', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': APP_USER_AGENT },
      body: JSON.stringify({ username, password }),
      signal: AbortSignal.timeout(10000),
    });
    if (!loginRes.ok) {
      console.warn(`[MangaUpdates Meta] Login failed (HTTP ${loginRes.status}) for ${title}.`);
      return null;
    }
    const loginCookies = (loginRes.headers.get('set-cookie') || '')
      .split(/,\s*(?=[A-Za-z_][A-Za-z0-9_]*=)/).filter(Boolean);
    const loginJson = await loginRes.json().catch(() => null);
    const sessionToken = loginJson?.token || loginJson?.api_token || loginJson?.access_token || loginJson?.auth_token || '';

    // 2) Authenticated series search (POST /v1/series)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
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
      headers: { 'Accept': 'application/vnd.api+json', 'User-Agent': APP_USER_AGENT },
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
    cachedProviderResult('mangadex:' + queryTitle, () => enabled.mangadex
      ? getMangaDexMetadataByTitle(queryTitle).then((md) => md ? {
          provider: 'MangaDex' as const,
                  title: md.title || title,
          altTitles: md.altTitles || [],
          coverImage: md.coverImage || '',
          description: md.description || '',
          genres: md.genres || [],
          apiId: md.apiId || undefined,
        } : null)
      : Promise.resolve(null)),
    cachedProviderResult('anilist:' + queryTitle, () => enabled.anilist ? fetchAniListMetadata(queryTitle) : Promise.resolve(null)),
    cachedProviderResult('mangaupdates:' + queryTitle, () => enabled.mangaupdates ? fetchMangaUpdatesMetadata(queryTitle) : Promise.resolve(null)),
    cachedProviderResult('jikan:' + queryTitle, () => enabled.mal !== false ? fetchJikanMetadata(queryTitle) : Promise.resolve(null)),
    cachedProviderResult('kitsu:' + queryTitle, () => enabled.kitsu ? fetchKitsuMetadata(queryTitle) : Promise.resolve(null)),
    cachedProviderResult('openlibrary:' + queryTitle, () => enabled.openlibrary ? fetchOpenLibraryMetadata(queryTitle) : Promise.resolve(null)),
    cachedProviderResult('googlebooks:' + queryTitle, () => enabled.googlebooks ? fetchGoogleBooksMetadata(queryTitle) : Promise.resolve(null)),
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

  // Multi-provider merge strategy:
  // - Pick highest quality cover (AniList or MangaDex or MAL)
  // - Pick longest description
  // - Dedupe & union genres and altTitles
  // - Average ratings
  const bestCover = sources.find((s) => s.coverImage && (s.provider === 'AniList' || s.provider === 'MangaDex'))?.coverImage || sources[0].coverImage;
  const bestDesc = [...sources].sort((a, b) => (b.description?.length || 0) - (a.description?.length || 0))[0]?.description || '';
  const allGenres = Array.from(new Set(sources.flatMap((s) => s.genres || [])));
  const allAltTitles = Array.from(new Set(sources.flatMap((s) => s.altTitles || [])));
  const allAuthors = Array.from(new Set(sources.flatMap((s) => s.authors || [])));
  const allCategories = Array.from(new Set(sources.flatMap((s) => s.categories || [])));

  const validRatings = sources.map((s) => s.rating).filter((r): r is number => typeof r === 'number' && r > 0);
  const avgRating = validRatings.length > 0
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

