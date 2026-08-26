// ============================================================================
// Live Metadata Extractor & Multi-Provider Aggregator Engine
// ============================================================================

import * as cheerio from 'cheerio';
import { MangaItem } from '../../../src/types';
import { SqliteDb } from '../../../sqlite-db';
import { mangaDatabase, appSettings, saveDatabaseToDisk, syncAddOrUpdateManga } from '../../appState';
import {
  snapshotMetadataOverrides,
  restoreMetadataOverrides,
  preferEnglishTitle,
  DEFAULT_UNKNOWN_RATING,
  cleanMangaTitle,
} from '../../../src/utils/metadataHelpers';
import { fetchAsuraSeriesMetadata } from '../../scrapers/asuraScans';
import { fetchFlameSeriesContext } from '../../scrapers/flameComics';
import { fetchWeebCentralSeriesMetadata } from '../../scrapers/weebCentral';
import { isSeriesFromDisabledSource } from '../../sources/sourcesCatalog';
import { fetchWithChallengeBypass } from '../../captchaSolver';
import { sourceCookieJar } from '../sourceHealthService';
import { parseGenericChapterListFromHtml } from '../crawler/chapterParser';
import { isAdSeries, isAdUrl, isAdTitle, stripAdElements } from '../../adFilter';
import { APP_USER_AGENT } from '../../version';
import { calculateStringSimilarity } from './similarity';
import { fetchMangaDex, getMangaDexMetadataByTitle, isMangaDexSourceLink } from './mangadex';

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
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number(dec);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    });
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

  if (genresSet.size === 0) {
    $('.genres-content a, .mgen a, .series-genres a, .story-info-right-extent .genres-content a, .post-content_item:contains("Genre") a, a[href*="/genre/"], a[href*="/genres/"], a[href*="/the-loai/"]')
      .each((_, el) => {
        const g = $(el).text().trim();
        if (g && g.length < 30 && !/^(read|manga|all|genre|genres)$/i.test(g)) {
          genresSet.add(g);
        }
      });
  }

  const chapters = parseGenericChapterListFromHtml(html, origin);
  if (chapters.length > 0) {
    latestChapter = Math.max(...chapters.map((c) => c.number));
  }

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
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Referer: origin + '/',
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

export async function refreshSingleMangaMetadata(manga: MangaItem): Promise<MangaItem> {
  const metadataSnap = snapshotMetadataOverrides(manga);

  const hasLiveSourceUrl = Boolean(
    manga.sourceUrl &&
    manga.sourceUrl.startsWith('http') &&
    !isMangaDexSourceLink(manga.sourceName, manga.sourceUrl)
  );

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

  const isSparse =
    !manga.coverImage ||
    !manga.description ||
    manga.description.length < 35 ||
    !manga.genres ||
    manga.genres.length === 0;

  if (isSparse && manga.title && manga.title !== 'Unknown') {
    try {
      const { aggregateMultiSourceMetadata } = await import('./liveMetadataAggregator');
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

export async function enrichWithMangaDexMetadata<
  T extends { title: string; coverImage?: string; description?: string; genres?: string[]; altTitles?: string[]; apiId?: string | null }
>(items: T[]): Promise<T[]> {
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
          genres: item.genres && item.genres.length > 0 ? item.genres : meta.genres || [],
          altTitles: item.altTitles && item.altTitles.length > 0 ? item.altTitles : meta.altTitles || [],
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
