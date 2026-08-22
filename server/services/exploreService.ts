// ============================================================================
// EXPLORE & BROWSE SERVICE
// Aggregates live source feeds, runs catalog warm-up, and background source audits
// ============================================================================

import crypto from 'node:crypto';
import * as cheerio from 'cheerio';
import { MangaItem, isNsfwManga } from '../../src/types';
import { SqliteDb } from '../../sqlite-db';
import {
  appSettings,
  saveDatabaseToDisk,
} from '../appState';
import { fetchWithChallengeBypass } from '../captchaSolver';
import { sourceCircuitBreaker } from '../circuitBreaker';
import { isAdImageSrc } from '../adFilter';
import {
  SourceDefinition,
  KOTATSU_SOURCES,
  disabledSourceIds,
  isSourceAlive,
  isMetadataOnlySource,
  isContentPath,
  isNavText,
  getAllSourcesWithExtensions,
  isSeriesFromDisabledSource,
} from '../sources/sourcesCatalog';
import {
  sourceCookieJar,
  updateSourceHealth,
  sourceHealthMap,
} from './sourceHealthService';
import { scrapeWeebCentral } from '../scrapers/weebCentral';
import { syncConfig } from '../appState';

export const SCRAPER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export function generateSourceScrapeId(prefix: string, href: string): string {
  const normalized = href.replace(/\/+$/, '');
  return `${prefix}_${crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 24)}`;
}

export async function scrapeAsuraScans(page: number, limit: number): Promise<{ items: any[]; totalCount: number }> {
  const ASURA_API = 'https://api.asurascans.com/api/series';
  const ASURA_PER_PAGE = 20;
  const ASURA_TOTAL = 340;

  const safeOffset = Math.max(0, (page - 1) * limit);
  const wanted = Math.max(1, Math.min(limit, ASURA_PER_PAGE * 4));

  const collected: any[] = [];
  let detectedTotal = ASURA_TOTAL;

  let offset = safeOffset;
  while (collected.length < wanted) {
    let json: any;
    try {
      const res = await fetch(`${ASURA_API}?offset=${offset}`, {
        signal: AbortSignal.timeout(12000),
        headers: {
          'User-Agent': SCRAPER_UA,
          'Accept': 'application/json',
          'Origin': 'https://asurascans.com',
          'Referer': 'https://asurascans.com/',
        },
      });
      if (!res.ok) {
        console.warn(`[Asura] API returned HTTP ${res.status} at offset ${offset}`);
        break;
      }
      json = await res.json();
    } catch (e) {
      console.error(`[Asura] Error fetching API at offset ${offset}:`, (e as Error).message);
      break;
    }

    const data: any[] = Array.isArray(json?.data) ? json.data : [];
    if (json?.meta?.total) detectedTotal = Number(json.meta.total);
    if (data.length === 0) break;

    for (const s of data) {
      if (collected.length >= wanted) break;
      const slug = s.slug || s.id || '';
      if (!slug) continue;
      const pubPath = s.public_url || `/comics/${s.slug || slug}`;
      collected.push({
        id: `asura_${slug}`,
        title: s.title || 'Unknown',
        sourceUrl: `https://asurascans.com${pubPath}`,
        coverImage: s.cover || '',
        sourceName: 'Asura Scans',
        description: (s.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 200),
        genres: (Array.isArray(s.genres) ? s.genres : []).map((g: any) => g?.name).filter(Boolean),
        latestChapter: s.chapter_count ? Number(s.chapter_count) : 1,
        type: s.type || 'manhwa',
        rating: typeof s.rating === 'number' ? Number(s.rating.toFixed(1)) : 9.0,
      });
    }

    offset += data.length;
    await new Promise((r) => setTimeout(r, 300));
  }

  return { items: collected, totalCount: detectedTotal };
}

export async function scrapeFlameComics(page: number, limit: number): Promise<any[]> {
  try {
    const url = page === 1 ? 'https://flamecomics.xyz/browse' : `https://flamecomics.xyz/browse?page=${page}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': SCRAPER_UA, 'Accept': 'text/html' },
    });
    if (!res.ok) return [];

    const html = await res.text();
    const results: any[] = [];
    const seen = new Set<string>();

    const seriesRx = /href="(https:\/\/flamecomics\.xyz\/series\/\d+)"[^>]*>([^<]{3,150})<\/a>/gi;
    const coverRx = /<img[^>]+src="([^"]+flamecomics[^"]+)"[^>]*>/gi;

    const covers: string[] = [];
    let cm: RegExpExecArray | null;
    while ((cm = coverRx.exec(html)) !== null) {
      covers.push(cm[1]);
    }

    let m: RegExpExecArray | null;
    while ((m = seriesRx.exec(html)) !== null) {
      const href = m[1];
      const title = m[2].trim();
      const key = href.toLowerCase();
      if (seen.has(key) || !title) continue;
      seen.add(key);

      const langMatch = html.substring(Math.max(0, m.index - 200), m.index).match(/href="https:\/\/flamecomics\.xyz\/series\/\d+"[^>]*>(KR|CN|JP)<\/a>/);
      const country = langMatch?.[1] || 'KR';
      const type = country === 'CN' ? 'manhua' : country === 'JP' ? 'manga' : 'manhwa';
      const coverIdx = results.length;

      results.push({
        id: `flame_${href.split('/').pop()}`,
        title,
        sourceUrl: href,
        coverImage: covers[coverIdx] || '',
        sourceName: 'Flame Comics',
        description: `Series from Flame Comics`,
        genres: ['Action'],
        latestChapter: 1,
        type,
      });
    }

    const offset = (page - 1) * limit;
    return results.slice(offset, offset + limit);
  } catch (e) {
    console.error('[Scraper] Flame Comics failed:', (e as Error).message);
    return [];
  }
}

export async function scrapeManhwa18(page: number, limit: number): Promise<any[]> {
  try {
    const url = `https://manhwa18.com/tim-kiem?page=${page}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': SCRAPER_UA, 'Accept': 'text/html', 'Referer': 'https://manhwa18.com/' },
    });
    if (!res.ok) return [];

    const html = await res.text();
    const $ = cheerio.load(html);
    const results: any[] = [];
    const seen = new Set<string>();

    let cards = $('.card-body .thumb-item-flow').toArray();
    if (cards.length === 0) cards = $('.thumb_attr.series-title').parent().toArray();

    for (const el of cards) {
      if (results.length >= limit) break;
      const card = $(el);
      const titleA = card.find('.thumb_attr.series-title > a').first();
      const href = titleA.attr('href') || '';
      const title = titleA.text().trim();
      if (!href || !title) continue;
      const absUrl = href.startsWith('http') ? href : `https://manhwa18.com${href.startsWith('/') ? '' : '/'}${href}`;
      if (!/\/manga\/[^/]+$/i.test(absUrl.replace(/\/+$/, ''))) continue;
      const key = absUrl.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const thumb = card.find('.thumb img').first();
      const cover = thumb.attr('data-src') || thumb.attr('src') || '';
      results.push({
        id: generateSourceScrapeId('manhwa18', absUrl),
        title,
        sourceUrl: absUrl,
        coverImage: cover.startsWith('http') ? cover : '',
        sourceName: 'Manhwa18',
        description: 'Adult manhwa series from Manhwa18',
        genres: ['Adult', 'Manhwa'],
        latestChapter: 1,
        type: 'manhwa',
      });
    }

    if (results.length === 0) {
      const titleRx = /<div class="thumb_attr series-title">\s*<a href="([^"]+)" title="([^"]+)"/gi;
      const bgRx = /data-bg="([^"]+)"/gi;
      const covers: string[] = [];
      let bg: RegExpExecArray | null;
      while ((bg = bgRx.exec(html)) !== null) covers.push(bg[1]);
      let t: RegExpExecArray | null;
      let idx = 0;
      while ((t = titleRx.exec(html)) !== null && results.length < limit) {
        let href = t[1];
        if (!href.startsWith('http')) href = `https://manhwa18.com${href.startsWith('/') ? '' : '/'}${href}`;
        href = href.replace(/\/+$/, '');
        if (!/\/manga\/[^/]+$/i.test(href) || seen.has(href)) continue;
        seen.add(href);
        results.push({
          id: generateSourceScrapeId('manhwa18', href),
          title: (t[2] || '').trim() || 'Untitled',
          sourceUrl: href,
          coverImage: covers[idx] || '',
          sourceName: 'Manhwa18',
          description: 'Adult manhwa from Manhwa18',
          genres: ['Adult', 'Manhwa'],
          latestChapter: 1,
          type: 'manhwa',
        });
        idx++;
      }
    }
    return results;
  } catch (e) {
    console.error('[Scraper] Manhwa18 failed:', (e as Error).message);
    return [];
  }
}

export async function getSourcePopularSeries(
  sourceDef: SourceDefinition,
  page: number = 1,
  limit: number = 24
): Promise<{ items: any[]; totalCount: number }> {
  const offset = (page - 1) * limit;

  if (sourceDef.engineType === 'mangadex') {
    const fallback =
      KOTATSU_SOURCES.find((s) => s.id !== 'mangadex' && !disabledSourceIds.has(s.id) && isSourceAlive(s.id)) ||
      KOTATSU_SOURCES.find((s) => s.id !== 'mangadex');
    if (fallback) return getSourcePopularSeries(fallback, page, limit);
    return { items: [], totalCount: 0 };
  }

  const lowerName = sourceDef.name.toLowerCase();
  const lowerId = sourceDef.id.toLowerCase();
  if (lowerName.includes('weebcentral') || lowerId.includes('weebcentral')) {
    const result = await scrapeWeebCentral(page, limit);
    if (result.items.length > 0) return result;
  }
  if (lowerName.includes('asura') || lowerId.includes('asura')) {
    const result = await scrapeAsuraScans(page, limit);
    if (result.items.length > 0) return result;
  }
  if (lowerName.includes('flame') || lowerId.includes('flame')) {
    const items = await scrapeFlameComics(page, limit);
    if (items.length > 0) return { items, totalCount: items.length };
  }
  if (lowerName.includes('manhwa18') || lowerId.includes('manhwa18')) {
    const items = await scrapeManhwa18(page, limit);
    if (items.length > 0) return { items, totalCount: 90 * limit };
  }

  const scrapedItems: any[] = [];

  try {
    const catalogCandidates: string[] = [];
    if (sourceDef.engineType === 'madara') {
      catalogCandidates.push(page === 1 ? `${sourceDef.baseUrl}/manga/` : `${sourceDef.baseUrl}/manga/page/${page}/`);
      catalogCandidates.push(page === 1 ? `${sourceDef.baseUrl}/` : `${sourceDef.baseUrl}/page/${page}/`);
    } else if (sourceDef.engineType === 'mangathemesia') {
      catalogCandidates.push(`${sourceDef.baseUrl}/manga/?page=${page}&order=popular`);
      catalogCandidates.push(`${sourceDef.baseUrl}/manga/?page=${page}`);
      catalogCandidates.push(`${sourceDef.baseUrl}/series/?page=${page}`);
    } else if (sourceDef.engineType === 'wpcomics') {
      catalogCandidates.push(page === 1 ? `${sourceDef.baseUrl}/` : `${sourceDef.baseUrl}/?page=${page}`);
      catalogCandidates.push(page === 1 ? `${sourceDef.baseUrl}/manga-list` : `${sourceDef.baseUrl}/manga-list?page=${page}`);
      catalogCandidates.push(page === 1 ? `${sourceDef.baseUrl}/manga/` : `${sourceDef.baseUrl}/manga/page/${page}/`);
    } else if (sourceDef.engineType === 'foolslide') {
      catalogCandidates.push(page === 1 ? `${sourceDef.baseUrl}/directory/` : `${sourceDef.baseUrl}/directory/${page}/`);
      catalogCandidates.push(page === 1 ? `${sourceDef.baseUrl}/series/` : `${sourceDef.baseUrl}/series/${page}/`);
      catalogCandidates.push(page === 1 ? `${sourceDef.baseUrl}/list/` : `${sourceDef.baseUrl}/list/${page}/`);
      catalogCandidates.push(`${sourceDef.baseUrl}/`);
    } else {
      catalogCandidates.push(page === 1 ? `${sourceDef.baseUrl}/browse` : `${sourceDef.baseUrl}/browse?page=${page}`);
      catalogCandidates.push(page === 1 ? `${sourceDef.baseUrl}/series` : `${sourceDef.baseUrl}/series?page=${page}`);
      catalogCandidates.push(page === 1 ? `${sourceDef.baseUrl}/manga` : `${sourceDef.baseUrl}/manga?page=${page}`);
      catalogCandidates.push(page === 1 ? `${sourceDef.baseUrl}/` : `${sourceDef.baseUrl}/?page=${page}`);
    }

    if (!sourceCircuitBreaker.canAttempt(sourceDef.id)) {
      console.warn(`[Catalog Scraper] Fast-failing ${sourceDef.name} (circuit OPEN)`);
      return { items: [], totalCount: 0 };
    }

    let html: string | null = null;
    for (const catalogUrl of catalogCandidates) {
      for (let attempt = 0; attempt < 2 && !html; attempt++) {
        try {
          const timeout = [4000, 8000][attempt] || 4000;
          const liveRes = await fetchWithChallengeBypass(catalogUrl, {
            headers: { 'User-Agent': SCRAPER_UA, 'Accept': 'text/html,application/xhtml+xml' },
            enableCloudflareBypass: appSettings.enableCloudflareBypass,
            flareSolverrUrl: appSettings.flareSolverrUrl,
            captchaSolverEnabled: appSettings.captchaSolverEnabled,
            captchaApiKey: appSettings.captchaApiKey,
            timeoutMs: timeout,
            sourceId: sourceDef.id,
            onCookieUpdate: (sid, cookies) => sourceCookieJar.setCookies(sid, cookies),
          });
          if (liveRes.ok && liveRes.html) {
            html = liveRes.html;
            updateSourceHealth(sourceDef.id, liveRes.html, liveRes.status);
            break;
          } else {
            updateSourceHealth(sourceDef.id, null, liveRes.status || 500);
            if (liveRes.status === 404 || liveRes.status === 410) {
              break;
            }
          }
        } catch (fetchErr: any) {
          updateSourceHealth(sourceDef.id, null, 0, fetchErr?.message);
        }
      }
      if (html) break;
    }

    if (html) {
      const $ = cheerio.load(html);
      const baseOrigin = sourceDef.baseUrl.replace(/\/$/, '');
      const seenTitles = new Set<string>();

      const extractCover = (el: any): string => {
        const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src') || $(el).attr('data-original') || '';
        if (!src || !/\.(jpg|jpeg|png|webp)/i.test(src) || /logo|avatar|banner|icon|placeholder/i.test(src)) return '';
        if (isAdImageSrc(src, baseOrigin)) return '';
        return src.startsWith('http') ? src : `${baseOrigin}${src}`;
      };

      const pushItem = (href: string, title: string, cover: string) => {
        const normTitle = title.toLowerCase();
        if (!href || title.length < 2 || seenTitles.has(normTitle)) return;
        if (isNavText(title)) return;
        if (!isContentPath(href)) return;
        seenTitles.add(normTitle);
        scrapedItems.push({
          id: generateSourceScrapeId(`live_${sourceDef.id}`, href),
          title,
          sourceUrl: href.startsWith('http') ? href : `${baseOrigin}${href}`,
          coverImage: cover,
          sourceName: sourceDef.name,
          description: `Live directory entry from ${sourceDef.name}`,
          genres: ['Action', 'Fantasy'],
          latestChapter: 10,
          type: sourceDef.id.includes('manhua') ? 'manhua' : sourceDef.id.includes('manhwa') ? 'manhwa' : 'manga',
        });
      };

      if (sourceDef.engineType === 'mangathemesia') {
        let found = false;
        $('.listupd .bsx, .listupd .bs').each((_i, el) => {
          const a = $(el).find('a').first();
          const href = a.attr('href') || '';
          const title = ($(el).find('.tt, .bigor .tt, h3, .series-title').text() || a.attr('title') || '').trim();
          const cover = extractCover($(el).find('img').first());
          if (href && title) { pushItem(href, title, cover); found = true; }
        });
        if (!found) {
          $('.utao .uta').each((_i, el) => {
            const a = $(el).find('.luf a, a').first();
            const href = a.attr('href') || '';
            const title = ($(el).find('.luf h4, h4, .tt').text() || a.text()).trim();
            const cover = extractCover($(el).find('img').first());
            if (href && title) pushItem(href, title, cover);
          });
        }
      } else if (sourceDef.engineType === 'madara' || sourceDef.engineType === 'wpcomics') {
        let found = false;
        $('.page-item-detail, .c-tabs-item__content, .item-thumb, .manga-item').each((_i, el) => {
          const a = $(el).find('.post-title a, h3 a, h4 a, .title a, a').first();
          const href = a.attr('href') || '';
          const title = a.text().trim() || a.attr('title') || '';
          const cover = extractCover($(el).find('img').first());
          if (href && title) { pushItem(href, title, cover); found = true; }
        });
        if (!found) {
          $('h3.h5 a, .post-title a, .entry-title a').each((_i, el) => {
            const a = $(el);
            const href = a.attr('href') || '';
            const title = a.text().trim();
            const cover = extractCover($(el).closest('article, .item, li').find('img').first());
            if (href && title) pushItem(href, title, cover);
          });
        }
      } else {
        $('article, .item, .card, .thumb-item, .series-card, .comic-item, li, a[href]').each((_i, el) => {
          if (scrapedItems.length >= limit * 2) return false;
          const a = ($(el).is('a') ? $(el) : $(el).find('a').first());
          const href = a.attr('href') || '';
          const title = a.text().trim() || a.attr('title') || $(el).find('h2, h3, h4, .title').first().text().trim();
          const cover = extractCover(a.find('img').first().length ? a.find('img').first() : $(el).find('img').first());
          if (href && title) pushItem(href, title, cover);
        });
      }
    }
  } catch {}

  if (scrapedItems.length >= limit) {
    return { items: scrapedItems.slice(0, limit), totalCount: scrapedItems.length };
  }

  const targetId = sourceDef.id.toLowerCase();
  const targetName = sourceDef.name.toLowerCase();
  const targetDomain = sourceDef.baseUrl.replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase();

  const dbMatches = SqliteDb.getAllManga().filter((m: any) => {
    const sName = (m.sourceName || '').toLowerCase();
    const sUrl = (m.sourceUrl || '').toLowerCase();
    return sName.includes(targetId) || sName.includes(targetName) || (sUrl && sUrl.includes(targetDomain));
  }).map((m: any) => ({
    id: m.id,
    title: m.title,
    sourceUrl: m.sourceUrl || sourceDef.baseUrl,
    coverImage: m.coverImage,
    sourceName: sourceDef.name,
    description: m.description || `Indexed from ${sourceDef.name}`,
    genres: m.genres || ['Action'],
    latestChapter: m.latestChapter || 1,
    type: m.type || 'manhwa',
  }));

  const combined = [...scrapedItems, ...dbMatches];
  const uniqueItems: any[] = [];
  const seen = new Set<string>();

  for (const item of combined) {
    const key = item.title.toLowerCase().trim();
    if (!seen.has(key)) {
      seen.add(key);
      uniqueItems.push(item);
    }
  }

  return { items: uniqueItems.slice(offset, offset + limit), totalCount: uniqueItems.length };
}

export const DEFAULT_EXPLORE_SOURCE_IDS = ['weebcentral', 'asurascans', 'flamecomics', 'mangaread', 'manhuaplusorg', 'ravenscans', 'manhwa18', 'hiperdex'];
export const EXPLORE_REFRESH_INTERVAL_MS = Number(process.env.EXPLORE_REFRESH_INTERVAL_MS) || 5 * 60 * 1000;
export const EXPLORE_CACHE_TTL_MS = Number(process.env.EXPLORE_CACHE_TTL_MS) || 60 * 60 * 1000;
export const EXPLORE_WARM_PAGES = Math.max(1, Math.min(6, Number(process.env.EXPLORE_WARM_PAGES) || 3));
export const EXPLORE_WARM_LIMIT = 40;
export const EXPLORE_DOMAIN_SPACING_MS = 1200;
export const EXPLORE_MAX_WARM_SOURCES = Math.max(4, Math.min(60, Number(process.env.EXPLORE_MAX_WARM_SOURCES) || 30));
let exploreSourceRotationIndex = 0;

export interface ExploreBufferEntry {
  items: any[];
  sourceIds: string[];
  builtAt: number;
  expiresAt: number;
  lastError: string | null;
}

export const exploreBufferRef: { current: ExploreBufferEntry | null } = { current: null };
let exploreRefreshRunning = false;
let exploreRefreshTimer: ReturnType<typeof setInterval> | null = null;
const lastExploreDomainRequest = new Map<string, number>();

export function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return url || ''; }
}

export function dedupeExploreItems(aggregated: any[]): any[] {
  const seen = new Map<string, any>();
  for (const it of aggregated) {
    if (!it || !it.title) continue;
    const key = String(it.title)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
    if (!key) continue;

    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, { ...it });
    } else {
      if (!existing.coverImage && it.coverImage) existing.coverImage = it.coverImage;
      if ((!existing.description || existing.description.length < 20) && it.description) {
        existing.description = it.description;
      }
      if (!existing.latestChapter || (it.latestChapter && it.latestChapter > existing.latestChapter)) {
        existing.latestChapter = it.latestChapter;
      }
      if (Array.isArray(it.genres) && it.genres.length > 0) {
        existing.genres = Array.from(new Set([...(existing.genres || []), ...it.genres]));
      }
      if ((!existing.__sourceId || existing.__sourceId === 'explore') && it.__sourceId && it.__sourceId !== 'explore') {
        existing.__sourceId = it.__sourceId;
        existing.__sourceName = it.__sourceName;
      }
      if (!existing.sourceUrl && it.sourceUrl) existing.sourceUrl = it.sourceUrl;
      if (!existing.apiId && it.apiId) existing.apiId = it.apiId;
    }
  }
  return Array.from(seen.values());
}

export function buildDatabaseExploreItems(): any[] {
  const allManga = SqliteDb.getAllManga();
  const activeSources = getAllSourcesWithExtensions().filter(
    (s) => !disabledSourceIds.has(s.id) && isSourceAlive(s.id)
  );

  const items: any[] = [];
  for (const m of allManga) {
    if (isSeriesFromDisabledSource(m)) continue;

    const sName = (m.sourceName || '').toLowerCase();
    const sUrl = (m.sourceUrl || '').toLowerCase();

    const matchedSrc = activeSources.find((s) => {
      const idL = s.id.toLowerCase();
      const nameL = s.name.toLowerCase();
      const domain = s.baseUrl.replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase();
      return (
        sName.includes(idL) ||
        idL.includes(sName) ||
        sName.includes(nameL) ||
        nameL.includes(sName) ||
        (sUrl && domain && sUrl.includes(domain))
      );
    });

    const sourceId = matchedSrc
      ? matchedSrc.id
      : m.sourceName
      ? m.sourceName.toLowerCase().replace(/[^a-z0-9]/g, '')
      : 'explore';
    const sourceName = matchedSrc ? matchedSrc.name : (m.sourceName || 'Explore');

    items.push({
      id: m.id,
      title: m.title,
      sourceUrl: m.sourceUrl,
      coverImage: m.coverImage || '',
      sourceName,
      __sourceId: sourceId,
      __sourceName: sourceName,
      apiId: m.apiId || null,
      description: m.description || '',
      genres: Array.isArray(m.genres) && m.genres.length > 0 ? m.genres : ['Action'],
      latestChapter: Number(m.latestChapter) || 1,
      type: m.type || 'manhwa',
      rating: m.rating || 9.0,
      isNsfw: isNsfwManga(m),
    });
  }

  return items;
}

export function getEligibleExploreSources(): SourceDefinition[] {
  return getAllSourcesWithExtensions().filter(
    (s) => s.id !== 'mangadex' && !disabledSourceIds.has(s.id) && isSourceAlive(s.id)
  );
}

export function defaultExploreSources(): SourceDefinition[] {
  const eligible = getEligibleExploreSources();
  const picks: SourceDefinition[] = [];
  const seen = new Set<string>();

  for (const id of DEFAULT_EXPLORE_SOURCE_IDS) {
    const s = eligible.find((src) => src.id === id);
    if (s) {
      picks.push(s);
      seen.add(id);
    }
  }

  const others = eligible.filter((s) => !seen.has(s.id));
  const totalOthers = others.length;
  if (totalOthers > 0) {
    const start = exploreSourceRotationIndex % totalOthers;
    const rotated = [...others.slice(start), ...others.slice(0, start)];
    const remainingSlots = Math.max(0, EXPLORE_MAX_WARM_SOURCES - picks.length);
    picks.push(...rotated.slice(0, remainingSlots));
  }

  return picks;
}

export function throttleExploreDomain(host: string): Promise<void> {
  const wait = EXPLORE_DOMAIN_SPACING_MS - (Date.now() - (lastExploreDomainRequest.get(host) || 0));
  if (wait > 0) return new Promise((r) => setTimeout(r, wait));
  return Promise.resolve();
}

export async function buildExploreBuffer(): Promise<ExploreBufferEntry | null> {
  const dbItems = buildDatabaseExploreItems();
  const sources = defaultExploreSources();
  const aggregated: any[] = [...dbItems];
  const sourceIdsSet = new Set<string>();

  for (const it of dbItems) {
    if (it.__sourceId) sourceIdsSet.add(it.__sourceId);
  }

  for (const src of sources) {
    sourceIdsSet.add(src.id);
    const domain = hostOf(src.baseUrl);
    await throttleExploreDomain(domain);
    lastExploreDomainRequest.set(domain, Date.now());
    const warmLimit = EXPLORE_WARM_LIMIT * 2;
    for (let p = 1; p <= EXPLORE_WARM_PAGES; p++) {
      try {
        const result = await getSourcePopularSeries(src, p, warmLimit);
        const items = Array.isArray(result) ? result : (result?.items || []);
        lastExploreDomainRequest.set(domain, Date.now());
        for (const it of items) aggregated.push({ ...it, __sourceId: src.id, __sourceName: src.name });
      } catch {}
    }
  }
  const deduped = dedupeExploreItems(aggregated);

  const eligible = getEligibleExploreSources();
  const othersTotal = Math.max(0, eligible.length - DEFAULT_EXPLORE_SOURCE_IDS.length);
  if (othersTotal > 0) {
    const step = Math.max(1, EXPLORE_MAX_WARM_SOURCES - DEFAULT_EXPLORE_SOURCE_IDS.length);
    exploreSourceRotationIndex = (exploreSourceRotationIndex + step) % othersTotal;
  }

  return {
    items: deduped,
    sourceIds: Array.from(sourceIdsSet),
    builtAt: Date.now(),
    expiresAt: Date.now() + EXPLORE_CACHE_TTL_MS,
    lastError: null,
  };
}

export async function refreshExploreCatalog(force = false): Promise<void> {
  if (exploreRefreshRunning) return;
  exploreRefreshRunning = true;
  try {
    const built = await buildExploreBuffer();
    if (built && built.items.length > 0) {
      exploreBufferRef.current = built;
      try { SqliteDb.setExploreBuffer(built); } catch (e: any) { console.error('[Explore Buffer] Persist failed:', e?.message); }
      console.log(
        `[Explore Buffer] Catalog ${force ? 'warmed' : 'refreshed'}: ${built.items.length} series across ${built.sourceIds.length} source(s) [${built.sourceIds.slice(0, 10).join(', ')}...]`
      );
    } else if (force) {
      console.warn('[Explore Buffer] Warm-up produced no items; will retry on next interval.');
    }
  } catch (e: any) {
    console.error('[Explore Buffer] Refresh failed:', e?.message);
    if (exploreBufferRef.current) exploreBufferRef.current.lastError = e?.message || 'unknown';
  } finally {
    exploreRefreshRunning = false;
  }
}

export function scheduleExploreRefresher(): void {
  try {
    const saved = SqliteDb.getExploreBuffer();
    const dbItems = buildDatabaseExploreItems();
    if (saved && Array.isArray(saved.items) && saved.items.length > 0) {
      const merged = dedupeExploreItems([...dbItems, ...saved.items]);
      const sourceIds = Array.from(
        new Set([
          ...(Array.isArray(saved.sourceIds) ? saved.sourceIds : []),
          ...merged.map((m: any) => m.__sourceId).filter(Boolean),
        ])
      );
      exploreBufferRef.current = {
        items: merged,
        sourceIds,
        builtAt: Number(saved.builtAt) || Date.now(),
        expiresAt: saved.expiresAt ?? Date.now() + EXPLORE_CACHE_TTL_MS,
        lastError: saved.lastError ?? null,
      };
      console.log(`[Explore Buffer] Loaded persisted catalog: ${merged.length} series across ${sourceIds.length} sources.`);
    } else {
      const sourceIds = Array.from(new Set(dbItems.map((m: any) => m.__sourceId).filter(Boolean)));
      exploreBufferRef.current = {
        items: dbItems,
        sourceIds,
        builtAt: Date.now(),
        expiresAt: Date.now() + EXPLORE_CACHE_TTL_MS,
        lastError: null,
      };
      console.log(`[Explore Buffer] Initialized cold catalog: ${dbItems.length} series from SQLite DB across ${sourceIds.length} sources.`);
    }
  } catch (e: any) {
    console.warn('[Explore Buffer] Could not load persisted catalog:', e?.message);
  }

  refreshExploreCatalog(true).catch((e) => console.error('[Explore Buffer] Startup warm-up failed:', e?.message));
  exploreRefreshTimer = setInterval(() => {
    refreshExploreCatalog(false).catch((e) => console.error('[Explore Buffer] Interval refresh failed:', e?.message));
  }, EXPLORE_REFRESH_INTERVAL_MS);
}

// ── Source Audit Helpers ─────────────────────────────────────────────────────
export const sourceAuditStatus = new Map<string, { seriesCount: number; checkedAt: string }>();
export let sourceAuditRunning = false;

export async function probeSourceSeriesCount(sourceDef: SourceDefinition): Promise<number> {
  const domain = sourceDef.baseUrl.replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase();
  const nameL = sourceDef.name.toLowerCase();
  const idL = sourceDef.id.toLowerCase();

  const staticCount = SqliteDb.getAllManga().filter((m: any) => {
    const n = (m.sourceName || '').toLowerCase();
    const u = (m.sourceUrl || '').toLowerCase();
    return n.includes(idL) || n.includes(nameL) || (u || '').includes(domain);
  }).length;

  if (staticCount > 0) return staticCount;

  try {
    const result = await getSourcePopularSeries(sourceDef, 1, 2);
    const items = Array.isArray(result) ? result : ((result?.items as any[]) || []);
    return items.length;
  } catch {
    return 0;
  }
}

export async function auditAndDisableEmptySources(
  concurrency = 8,
  sourceList: SourceDefinition[] = KOTATSU_SOURCES
): Promise<{ disabled: string[]; revived: string[]; keptCount: number; total: number; alreadyRunning: boolean }> {
  if (sourceAuditRunning) return { disabled: [], revived: [], keptCount: 0, total: sourceList.length, alreadyRunning: true };
  sourceAuditRunning = true;

  const pending = [...sourceList];
  const disabled: string[] = [];
  const revived: string[] = [];
  let checkedCount = 0;

  const worker = async () => {
    let src: SourceDefinition | undefined;
    while ((src = pending.shift()) !== undefined) {
      const count = await probeSourceSeriesCount(src);
      checkedCount++;
      sourceAuditStatus.set(src.id, { seriesCount: count, checkedAt: new Date().toISOString() });

      if (count === 0) {
        if (!disabledSourceIds.has(src.id)) {
          disabledSourceIds.add(src.id);
          disabled.push(src.id);
          console.log(`[Source Audit] Disabled "${src.id}" — returned 0 series.`);
        }
      } else {
        if (disabledSourceIds.has(src.id)) {
          disabledSourceIds.delete(src.id);
          revived.push(src.id);
          if (!Array.isArray(syncConfig.reactivatedSources)) syncConfig.reactivatedSources = [];
          if (!syncConfig.reactivatedSources.includes(src.id)) {
            syncConfig.reactivatedSources.push(src.id);
          }
          if (Array.isArray(syncConfig.removedSources)) {
            syncConfig.removedSources = syncConfig.removedSources.filter((r: string) => r !== src!.id);
          }
          sourceCircuitBreaker.reset(src.id);
          console.log(`[Source Audit] Revived "${src.id}" — now returning ${count} series.`);
        }
      }
    }
  };

  const n = Math.max(1, Math.min(concurrency, pending.length));
  await Promise.all(Array.from({ length: n }, worker));

  syncConfig.disabledSources = Array.from(disabledSourceIds);
  saveDatabaseToDisk();
  sourceAuditRunning = false;
  console.log(`[Source Audit] Checked ${checkedCount} sources — disabled ${disabled.length}, revived ${revived.length}.`);
  return { disabled, revived, keptCount: checkedCount - disabled.length, total: checkedCount, alreadyRunning: false };
}
