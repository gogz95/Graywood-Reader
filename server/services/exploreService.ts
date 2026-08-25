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
import {
  isAdImageSrc,
  isAdSeries,
  isAdUrl,
  isAdTitle,
  stripAdElements,
} from '../adFilter';
import {
  SourceDefinition,
  KOTATSU_SOURCES,
  disabledSourceIds,
  isSourceAlive,
  isMetadataOnlySource,
  isContentPath,
  isSeriesContentPath,
  isChapterTitle,
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
import { scrapeMangaRead, searchMangaRead } from '../scrapers/mangaRead';
import { scrapeManhuaPlus, searchManhuaPlus } from '../scrapers/manhuaPlus';
import { scrapeDemonicScans, searchDemonicScans } from '../scrapers/demonicScans';
import { scrapeAquaManga } from '../scrapers/aquaManga';
import { scrapeKunManga } from '../scrapers/kunManga';
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

    return results.slice(0, limit);
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

    let cards = $('.card-body .thumb-item-flow, .thumb-item-flow').toArray();
    if (cards.length === 0) cards = $('.thumb_attr.series-title').parent().toArray();

    for (const el of cards) {
      if (results.length >= limit) break;
      const card = $(el);
      const titleA = card.find('.thumb_attr.series-title > a, .series-title a').first();
      const href = titleA.attr('href') || card.find('a[href*="/manga/"]').not('[href*="chapter"]').not('[href*="chap-"]').first().attr('href') || '';
      const title = titleA.text().trim() || titleA.attr('title') || '';
      if (!href || !title) continue;
      const absUrl = href.startsWith('http') ? href : `https://manhwa18.com${href.startsWith('/') ? '' : '/'}${href}`;
      if (!/\/manga\/[^/]+$/i.test(absUrl.replace(/\/+$/, ''))) continue;
      const key = absUrl.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const bgEl = card.find('[data-bg], [data-background], [data-src], [data-original], [data-lazy-src], img').first();
      let cover = bgEl.attr('data-bg') || bgEl.attr('data-background') || bgEl.attr('data-src') || bgEl.attr('data-original') || bgEl.attr('data-lazy-src') || bgEl.attr('src') || '';
      if (!cover) {
        const style = card.find('[style*="background"]').attr('style') || card.attr('style') || '';
        const m = style.match(/background(?:-image)?:\s*url\(['"]?([^'")]+)['"]?\)/i);
        if (m && m[1]) cover = m[1];
      }
      if (cover.startsWith('//')) cover = `https:${cover}`;
      else if (cover.startsWith('/')) cover = `https://manhwa18.com${cover}`;

      let latestCh = 1;
      const chText = card.find('.thumb_attr.chapter-title a, a[href*="chapter"]').first().text().trim();
      const chMatch = chText.match(/chapter[-_\.\s]*(\d+(?:\.\d+)?)|ch\.?\s*(\d+(?:\.\d+)?)/i);
      if (chMatch) latestCh = parseFloat(chMatch[1] || chMatch[2]) || 1;

      results.push({
        id: generateSourceScrapeId('manhwa18', absUrl),
        title,
        sourceUrl: absUrl,
        coverImage: cover.startsWith('http') ? cover : '',
        sourceName: 'Manhwa18',
        description: 'Adult manhwa series from Manhwa18',
        genres: ['Adult', 'Manhwa'],
        latestChapter: latestCh,
        type: 'manhwa',
      });
    }
    return results;
  } catch (e) {
    console.error('[Scraper] Manhwa18 failed:', (e as Error).message);
    return [];
  }
}

export async function searchManhwa18(query: string, page: number = 1, limit: number = 24): Promise<{ items: any[]; totalCount: number }> {
  try {
    const encQ = encodeURIComponent(query);
    const url = `https://manhwa18.com/tim-kiem?q=${encQ}&page=${page}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': SCRAPER_UA, 'Accept': 'text/html', 'Referer': 'https://manhwa18.com/' },
    });
    if (!res.ok) return { items: [], totalCount: 0 };

    const html = await res.text();
    const $ = cheerio.load(html);
    const results: any[] = [];
    const seen = new Set<string>();

    let cards = $('.card-body .thumb-item-flow, .thumb-item-flow').toArray();
    for (const el of cards) {
      if (results.length >= limit) break;
      const card = $(el);
      const titleA = card.find('.thumb_attr.series-title > a, .series-title a').first();
      const href = titleA.attr('href') || card.find('a[href*="/manga/"]').not('[href*="chapter"]').not('[href*="chap-"]').first().attr('href') || '';
      const title = titleA.text().trim() || titleA.attr('title') || '';
      if (!href || !title) continue;
      const absUrl = href.startsWith('http') ? href : `https://manhwa18.com${href.startsWith('/') ? '' : '/'}${href}`;
      if (!/\/manga\/[^/]+$/i.test(absUrl.replace(/\/+$/, ''))) continue;
      const key = absUrl.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const bgEl = card.find('[data-bg], [data-background], [data-src], [data-original], [data-lazy-src], img').first();
      let cover = bgEl.attr('data-bg') || bgEl.attr('data-background') || bgEl.attr('data-src') || bgEl.attr('data-original') || bgEl.attr('data-lazy-src') || bgEl.attr('src') || '';
      if (cover.startsWith('//')) cover = `https:${cover}`;
      else if (cover.startsWith('/')) cover = `https://manhwa18.com${cover}`;

      let latestCh = 1;
      const chText = card.find('.thumb_attr.chapter-title a, a[href*="chapter"]').first().text().trim();
      const chMatch = chText.match(/chapter[-_\.\s]*(\d+(?:\.\d+)?)|ch\.?\s*(\d+(?:\.\d+)?)/i);
      if (chMatch) latestCh = parseFloat(chMatch[1] || chMatch[2]) || 1;

      results.push({
        id: generateSourceScrapeId('manhwa18', absUrl),
        title,
        sourceUrl: absUrl,
        coverImage: cover.startsWith('http') ? cover : '',
        sourceName: 'Manhwa18',
        description: 'Adult manhwa series from Manhwa18',
        genres: ['Adult', 'Manhwa'],
        latestChapter: latestCh,
        type: 'manhwa',
      });
    }
    return { items: results, totalCount: results.length };
  } catch (e) {
    console.error('[Search Engine] Manhwa18 search failed:', (e as Error).message);
    return { items: [], totalCount: 0 };
  }
}

export async function scrapeManhwa18CC(page: number, limit: number): Promise<any[]> {
  try {
    const url = `https://manhwa18.cc/webtoons?page=${page}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': SCRAPER_UA, 'Accept': 'text/html', 'Referer': 'https://manhwa18.cc/' },
    });
    if (!res.ok) return [];

    const html = await res.text();
    const $ = cheerio.load(html);
    const results: any[] = [];
    const seen = new Set<string>();

    let cards = $('.manga-item, .item, .entry, .card, .thumb-item-flow').toArray();
    for (const el of cards) {
      if (results.length >= limit) break;
      const card = $(el);
      const titleA = card.find('.manga-name a, .post-title a, h3 a, h2 a, a[href*="/webtoon/"]').not('[href*="chapter"]').first();
      const href = titleA.attr('href') || '';
      const rawTitle = titleA.attr('title') || titleA.text().trim() || '';
      const title = rawTitle.replace(/^18\+\s*/, '').trim();
      if (!href || !title || title === '18+') continue;
      const absUrl = href.startsWith('http') ? href : `https://manhwa18.cc${href.startsWith('/') ? '' : '/'}${href}`;
      if (!/\/webtoon\/[^/]+$/i.test(absUrl.replace(/\/+$/, ''))) continue;
      const key = absUrl.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const bgEl = card.find('img, [data-bg], [data-src], [data-original]').first();
      let cover = bgEl.attr('data-src') || bgEl.attr('data-original') || bgEl.attr('data-bg') || bgEl.attr('src') || '';
      if (cover.startsWith('//')) cover = `https:${cover}`;
      else if (cover.startsWith('/')) cover = `https://manhwa18.cc${cover}`;

      results.push({
        id: generateSourceScrapeId('manhwa18cc', absUrl),
        title,
        sourceUrl: absUrl,
        coverImage: cover.startsWith('http') ? cover : '',
        sourceName: 'Manhwa18.cc',
        description: 'Adult manhwa series from Manhwa18.cc',
        genres: ['Adult', 'Webtoon'],
        latestChapter: 1,
        type: 'manhwa',
      });
    }
    return results;
  } catch (e) {
    console.error('[Scraper] Manhwa18CC failed:', (e as Error).message);
    return [];
  }
}

export async function searchManhwa18CC(query: string, page: number = 1, limit: number = 24): Promise<{ items: any[]; totalCount: number }> {
  try {
    const encQ = encodeURIComponent(query);
    const url = `https://manhwa18.cc/search?q=${encQ}&page=${page}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': SCRAPER_UA, 'Accept': 'text/html', 'Referer': 'https://manhwa18.cc/' },
    });
    if (!res.ok) return { items: [], totalCount: 0 };

    const html = await res.text();
    const $ = cheerio.load(html);
    const results: any[] = [];
    const seen = new Set<string>();

    let cards = $('.manga-item, .item, .entry, .card, .thumb-item-flow').toArray();
    for (const el of cards) {
      if (results.length >= limit) break;
      const card = $(el);
      const titleA = card.find('.manga-name a, .post-title a, h3 a, h2 a, a[href*="/webtoon/"]').not('[href*="chapter"]').first();
      const href = titleA.attr('href') || '';
      const rawTitle = titleA.attr('title') || titleA.text().trim() || '';
      const title = rawTitle.replace(/^18\+\s*/, '').trim();
      if (!href || !title || title === '18+') continue;
      const absUrl = href.startsWith('http') ? href : `https://manhwa18.cc${href.startsWith('/') ? '' : '/'}${href}`;
      if (!/\/webtoon\/[^/]+$/i.test(absUrl.replace(/\/+$/, ''))) continue;
      const key = absUrl.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const bgEl = card.find('img, [data-bg], [data-src], [data-original]').first();
      let cover = bgEl.attr('data-src') || bgEl.attr('data-original') || bgEl.attr('data-bg') || bgEl.attr('src') || '';
      if (cover.startsWith('//')) cover = `https:${cover}`;
      else if (cover.startsWith('/')) cover = `https://manhwa18.cc${cover}`;

      results.push({
        id: generateSourceScrapeId('manhwa18cc', absUrl),
        title,
        sourceUrl: absUrl,
        coverImage: cover.startsWith('http') ? cover : '',
        sourceName: 'Manhwa18.cc',
        description: 'Adult manhwa series from Manhwa18.cc',
        genres: ['Adult', 'Webtoon'],
        latestChapter: 1,
        type: 'manhwa',
      });
    }
    return { items: results, totalCount: results.length };
  } catch (e) {
    console.error('[Search Engine] Manhwa18CC search failed:', (e as Error).message);
    return { items: [], totalCount: 0 };
  }
}

export async function searchSourceDirectly(
  sourceDef: SourceDefinition,
  query: string,
  page: number = 1,
  limit: number = 24
): Promise<{ items: any[]; totalCount: number }> {
  const cleanQ = (query || '').trim();
  if (!cleanQ) return getSourcePopularSeries(sourceDef, page, limit);

  const lowerName = sourceDef.name.toLowerCase();
  const lowerId = sourceDef.id.toLowerCase();
  const baseOrigin = sourceDef.baseUrl.replace(/\/+$/, '');

  if (lowerName.includes('weebcentral') || lowerId.includes('weebcentral')) {
    const results = await scrapeWeebCentral(1, limit);
    const needle = cleanQ.toLowerCase();
    const filtered = results.items.filter(
      (m: any) => (m.title || '').toLowerCase().includes(needle) || (m.description || '').toLowerCase().includes(needle)
    );
    return { items: filtered, totalCount: filtered.length };
  }

  if (lowerName.includes('mangaread') || lowerId.includes('mangaread')) {
    const results = await searchMangaRead(cleanQ, limit);
    if (results.length > 0) return { items: results, totalCount: results.length };
  }

  if (lowerName.includes('manhuaplus') || lowerId.includes('manhuaplus')) {
    const results = await searchManhuaPlus(cleanQ, limit);
    if (results.length > 0) return { items: results, totalCount: results.length };
  }

  if (lowerName.includes('demonic') || lowerId.includes('demonic')) {
    const results = await searchDemonicScans(cleanQ, limit);
    if (results.length > 0) return { items: results, totalCount: results.length };
  }

  if (lowerId === 'manhwa18' || (lowerName.includes('manhwa18') && !lowerId.includes('cc') && !lowerName.includes('.cc'))) {
    const results = await searchManhwa18(cleanQ, page, limit);
    if (results.items.length > 0) return results;
  }

  if (lowerId.includes('manhwa18cc') || lowerName.includes('manhwa18.cc') || lowerName.includes('manhwa18 cc')) {
    const results = await searchManhwa18CC(cleanQ, page, limit);
    if (results.items.length > 0) return results;
  }

  if (lowerName.includes('asura') || lowerId.includes('asura')) {
    try {
      const cleanSlug = cleanQ.replace(/^asura_/i, '').replace(/[-_]/g, ' ').trim();
      const asuraRes = await fetch(`https://api.asurascans.com/api/series?search=${encodeURIComponent(cleanSlug || cleanQ)}`, {
        headers: {
          'User-Agent': SCRAPER_UA,
          'Accept': 'application/json',
          'Origin': 'https://asurascans.com',
          'Referer': 'https://asurascans.com/',
        },
        signal: AbortSignal.timeout(12000),
      });
      if (asuraRes.ok) {
        const json = await asuraRes.json();
        const data: any[] = Array.isArray(json?.data) ? json.data : [];
        const results = data.map((s: any) => {
          const slug = s.slug || s.id || '';
          const pubPath = s.public_url || `/comics/${s.slug || slug}`;
          return {
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
          };
        });
        return { items: results.slice(0, limit), totalCount: results.length };
      }
    } catch (e: any) {
      console.warn('[Search Engine] Asura search error:', e.message);
    }
  }

  // Build search candidate URLs based on engine type
  const searchCandidates: string[] = [];
  const encQ = encodeURIComponent(cleanQ);

  if (sourceDef.engineType === 'madara') {
    searchCandidates.push(`${baseOrigin}/?s=${encQ}&post_type=wp-manga`);
    searchCandidates.push(`${baseOrigin}/manga/?s=${encQ}`);
    searchCandidates.push(`${baseOrigin}/?s=${encQ}`);
  } else if (sourceDef.engineType === 'mangathemesia') {
    searchCandidates.push(`${baseOrigin}/?s=${encQ}`);
    searchCandidates.push(`${baseOrigin}/manga/?s=${encQ}`);
    searchCandidates.push(`${baseOrigin}/series/?s=${encQ}`);
  } else if (sourceDef.engineType === 'wpcomics') {
    searchCandidates.push(`${baseOrigin}/tim-kiem?q=${encQ}`);
    searchCandidates.push(`${baseOrigin}/search?q=${encQ}`);
    searchCandidates.push(`${baseOrigin}/?s=${encQ}`);
  } else {
    // Custom HTML / generic
    if (lowerId.includes('demonic') || baseOrigin.includes('demonicscans')) {
      searchCandidates.push(`${baseOrigin}/advanced.php?search=${encQ}`);
    }
    searchCandidates.push(`${baseOrigin}/tim-kiem?q=${encQ}`);
    searchCandidates.push(`${baseOrigin}/search?q=${encQ}`);
    searchCandidates.push(`${baseOrigin}/?s=${encQ}`);
    searchCandidates.push(`${baseOrigin}/browse?q=${encQ}`);
    searchCandidates.push(`${baseOrigin}/series?q=${encQ}`);
  }

  if (sourceCircuitBreaker.canAttempt(sourceDef.id)) {
    for (const searchUrl of searchCandidates) {
      try {
        const liveRes = await fetchWithChallengeBypass(searchUrl, {
          headers: { 'User-Agent': SCRAPER_UA, 'Accept': 'text/html,application/xhtml+xml', 'Referer': `${baseOrigin}/` },
          enableCloudflareBypass: appSettings.enableCloudflareBypass,
          flareSolverrUrl: appSettings.flareSolverrUrl,
          captchaSolverEnabled: appSettings.captchaSolverEnabled,
          captchaApiKey: appSettings.captchaApiKey,
          timeoutMs: 8000,
          sourceId: sourceDef.id,
          onCookieUpdate: (sid, cookies) => sourceCookieJar.setCookies(sid, cookies),
        });

        if (liveRes.ok && liveRes.html && liveRes.html.length > 500) {
          const items = parseUniversalCatalogCards(liveRes.html, sourceDef, baseOrigin);
          if (items.length > 0) {
            const needle = cleanQ.toLowerCase();
            const matching = items.filter(
              (m: any) => (m.title || '').toLowerCase().includes(needle) || (m.description || '').toLowerCase().includes(needle)
            );
            const finalItems = matching.length > 0 ? matching : items;
            return { items: finalItems.slice(0, limit), totalCount: finalItems.length };
          }
        }
      } catch (err: any) {
        console.warn(`[Search Engine] Query candidate failed for ${sourceDef.name}:`, err.message);
      }
    }
  }

  // Fallback: Fetch directory pages and filter in memory
  const { items: popular } = await getSourcePopularSeries(sourceDef, 1, 60);
  const needle = cleanQ.toLowerCase();
  const filtered = popular.filter(
    (m: any) => (m.title || '').toLowerCase().includes(needle) || (m.description || '').toLowerCase().includes(needle)
  );
  return { items: filtered.slice(0, limit), totalCount: filtered.length };
}

/** Resilient DOM Card Parser that extracts series across all engine layouts */
export function parseUniversalCatalogCards(
  html: string,
  sourceDef: SourceDefinition,
  baseOrigin: string
): any[] {
  if (!html) return [];
  const $ = cheerio.load(html);
  stripAdElements($);
  const scrapedItems: any[] = [];
  const seenTitles = new Set<string>();
  const seenUrls = new Set<string>();

  const isPlaceholderCover = (url: string): boolean => {
    if (!url) return true;
    const lower = url.toLowerCase();
    if (lower.startsWith('data:image/gif;base64,r0lgodlhaqab') || lower.startsWith('data:image/png;base64,ivborw0kggoaaaansuheugaaaaee') || lower.startsWith('data:image/svg+xml')) {
      return true;
    }
    return /placeholder|blank\.gif|loading\.gif|spinner\.gif|default-avatar|no-image|default_cover|default-cover|wp-manga\/assets\/images\/placeholder|no_cover|\.gif(\?|$)/i.test(lower);
  };

  const extractCover = (el: any, cardParent?: any): string => {
    if (!el || !el.length) {
      if (cardParent && cardParent.length) {
        const bgEl = cardParent.find('[data-bg], [data-background], [data-src], [data-original], [data-lazy-src]').first();
        const dataBg = bgEl.attr('data-bg') || bgEl.attr('data-background') || bgEl.attr('data-src') || cardParent.attr('data-bg') || cardParent.attr('data-background') || '';
        if (dataBg && !isPlaceholderCover(dataBg)) return dataBg.trim();
        const bgStyle = bgEl.attr('style') || cardParent.attr('style') || '';
        const bgMatch = bgStyle.match(/background-image:\s*url\(['"]?([^'")]+)['"]?\)/i);
        if (bgMatch && bgMatch[1] && !isPlaceholderCover(bgMatch[1])) return bgMatch[1].trim();
      }
      return '';
    }

    const candidateAttrs = [
      'data-src',
      'data-lazy-src',
      'data-original',
      'data-cfsrc',
      'data-bg',
      'data-background',
      'data-img-url',
      'data-url',
      'data-image',
      'data-img',
      'data-page-url',
      'data-srcset',
      'srcset',
      'src',
    ];

    let found = '';
    for (const attr of candidateAttrs) {
      const val = el.attr(attr);
      if (val && !isPlaceholderCover(val)) {
        found = val.trim();
        break;
      }
    }

    // Check style on the image itself or parent card
    if (!found) {
      const style = el.attr('style') || (cardParent ? cardParent.attr('style') : '') || '';
      const bgMatch = style.match(/background-image:\s*url\(['"]?([^'")]+)['"]?\)/i);
      if (bgMatch && bgMatch[1] && !isPlaceholderCover(bgMatch[1])) {
        found = bgMatch[1].trim();
      }
    }

    if (!found && cardParent && cardParent.length) {
      const pBg = cardParent.attr('data-bg') || cardParent.attr('data-background') || cardParent.attr('data-src') || '';
      if (pBg && !isPlaceholderCover(pBg)) found = pBg.trim();
    }

    if (!found) return '';

    if (found.includes(',') && (found.includes(' 1x') || found.includes(' 2x') || found.includes('w'))) {
      const parts = found.split(',').map((s: string) => s.trim()).filter(Boolean);
      if (parts.length > 0) found = (parts[parts.length - 1].split(/\s+/)[0] || '').trim();
    }

    if (isAdImageSrc(found, baseOrigin)) return '';
    if (found.startsWith('//')) return `https:${found}`;
    if (found.startsWith('/')) return `${baseOrigin}${found}`;
    if (!found.startsWith('http://') && !found.startsWith('https://')) return `${baseOrigin}/${found}`;
    return found;
  };

  const pushItem = (href: string, title: string, cover: string, latestCh = 10, genres: string[] = ['Action', 'Fantasy']) => {
    if (!href) return;
    if (!isSeriesContentPath(href)) return;
    if (isChapterTitle(title)) return;
    if (isNavText(title)) return;
    if (isAdSeries(title, href) || isAdUrl(href) || isAdTitle(title)) return;

    let absUrl = href.trim();
    if (absUrl.startsWith('//')) absUrl = `https:${absUrl}`;
    else if (absUrl.startsWith('/')) absUrl = `${baseOrigin}${absUrl}`;
    else if (!absUrl.startsWith('http://') && !absUrl.startsWith('https://')) absUrl = `${baseOrigin}/${absUrl}`;
    absUrl = absUrl.replace(/\/+$/, '');

    if (!isSeriesContentPath(absUrl)) return;
    if (isAdUrl(absUrl)) return;

    const normUrl = absUrl.toLowerCase();
    if (seenUrls.has(normUrl)) return;

    const cleanTitle = title
      .replace(/\s+/g, ' ')
      .replace(/\s*Chapter\s*\d+.*$/i, '')
      .replace(/\s*Ch\.\s*\d+.*$/i, '')
      .replace(/\s*Ep\.\s*\d+.*$/i, '')
      .trim();

    if (!cleanTitle || cleanTitle.length < 2 || isChapterTitle(cleanTitle)) return;

    const normTitle = cleanTitle.toLowerCase();
    if (seenTitles.has(normTitle)) return;

    seenTitles.add(normTitle);
    seenUrls.add(normUrl);

    scrapedItems.push({
      id: generateSourceScrapeId(`live_${sourceDef.id}`, absUrl),
      title: cleanTitle,
      sourceUrl: absUrl,
      coverImage: cover,
      sourceName: sourceDef.name,
      description: `Live directory entry from ${sourceDef.name}`,
      genres: genres.length > 0 ? genres : ['Action', 'Fantasy'],
      latestChapter: latestCh || 10,
      type: sourceDef.id.includes('manhua') ? 'manhua' : sourceDef.id.includes('manhwa') ? 'manhwa' : 'manga',
    });
  };

  // Strategy 1: Dedicated themesia / madara / wpcomics / custom card wrappers
  const cardSelectors = [
    '.listupd .bsx', '.listupd .bs', '.utao .uta',
    '.page-item-detail', '.c-tabs-item__content', '.item-thumb', '.manga-item', '.page-listing-item .badge-pos-1',
    '.thumb-item-flow', '.card-body .thumb-item-flow', '.film_list-wrap .flw-item',
    '.items .item', '.list-manga .item', '.box_list .item', '.lastupdates-container .item', '.row .item',
    'article.badge-pos-1', 'article.item', 'article.manga', 'article',
    '.series-card', '.manga-card', '.comic-card', '.book-item', '.grid-item', '.thumb-item', '.card', '.item',
  ];

  for (const sel of cardSelectors) {
    const cards = $(sel).toArray();
    if (cards.length > 0) {
      for (const el of cards) {
        const card = $(el);
        const a = card.is('a') ? card : card.find('.series-title a, .thumb_attr.series-title > a, .manga-name a, .post-title a, .tt a, h3 a, h4 a, h2 a, .title a, a[href*="/manga/"], a[href*="/series/"], a[href*="/comic/"], a[href*="/webtoon/"]').not('[href*="chapter"]').not('[href*="chap-"]').first();
        const href = a.attr('href') || (card.is('a') ? card.attr('href') : '') || '';
        const rawTitle = (card.find('.series-title a, .thumb_attr.series-title > a, .manga-name, .post-title, .tt, .bigor .tt, h3, h2, h4, .title').first().text() || a.attr('title') || a.text()).trim();
        const title = rawTitle.replace(/^18\+\s*/, '').trim();
        const cover = extractCover(card.find('img').first(), card);

        let chNum = 10;
        const chText = card.find('.epx, .chapter, .font-meta, .chapter-item, .fres-chapter, a[href*="chapter"]').first().text();
        const chMatch = chText.match(/(?:ch(?:apter)?\.?\s*|ep\.?\s*)(\d+(?:\.\d+)?)/i);
        if (chMatch) chNum = parseFloat(chMatch[1]) || 10;

        if (href && title) pushItem(href, title, cover, chNum);
      }
      if (scrapedItems.length >= 2) return scrapedItems;
    }
  }

  // Strategy 2: Universal anchor & container scan (strictly matching series paths)
  $('a[href]').each((_i, el) => {
    const a = $(el);
    const href = a.attr('href') || '';
    if (!href || !isSeriesContentPath(href)) return;

    const parent = a.closest('div, li, article, section');
    const rawTitle = (a.attr('title') || parent.find('h2, h3, h4, h5, .title, .series-title, .name').first().text() || a.text()).trim();
    const title = rawTitle.replace(/^18\+\s*/, '').trim();
    if (isChapterTitle(title)) return;

    const cover = extractCover(a.find('img').first().length ? a.find('img').first() : parent.find('img').first(), parent);

    let chNum = 10;
    const chText = parent.find('.epx, .chapter, .font-meta, .chapter-item, .fres-chapter, a[href*="chapter"]').first().text();
    const chMatch = chText.match(/(?:ch(?:apter)?\.?\s*|ep\.?\s*)(\d+(?:\.\d+)?)/i);
    if (chMatch) chNum = parseFloat(chMatch[1]) || 10;

    if (title && title.length >= 2) {
      pushItem(href, title, cover, chNum);
    }
  });

  return scrapedItems;
}

export async function getSourcePopularSeries(
  sourceDef: SourceDefinition,
  page: number = 1,
  limit: number = 24
): Promise<{ items: any[]; totalCount: number }> {
  if (sourceDef.engineType === 'mangadex') {
    const fallback =
      KOTATSU_SOURCES.find((s) => s.id !== 'mangadex' && !disabledSourceIds.has(s.id) && isSourceAlive(s.id)) ||
      KOTATSU_SOURCES.find((s) => s.id !== 'mangadex');
    if (fallback) return getSourcePopularSeries(fallback, page, limit);
    return { items: [], totalCount: 0 };
  }

  const lowerName = sourceDef.name.toLowerCase();
  const lowerId = sourceDef.id.toLowerCase();
  const baseOrigin = sourceDef.baseUrl.replace(/\/+$/, '');

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
    if (items.length > 0) {
      const estimatedTotal = items.length >= limit ? page * limit + limit * 5 : (page - 1) * limit + items.length;
      return { items, totalCount: estimatedTotal };
    }
  }
  if (lowerId === 'manhwa18' || (lowerName.includes('manhwa18') && !lowerId.includes('cc') && !lowerName.includes('.cc'))) {
    const items = await scrapeManhwa18(page, limit);
    if (items.length > 0) return { items, totalCount: 90 * limit };
  }
  if (lowerId.includes('manhwa18cc') || lowerName.includes('manhwa18.cc') || lowerName.includes('manhwa18 cc')) {
    const items = await scrapeManhwa18CC(page, limit);
    if (items.length > 0) return { items, totalCount: 90 * limit };
  }
  if (lowerName.includes('mangaread') || lowerId.includes('mangaread')) {
    const result = await scrapeMangaRead(page, limit);
    if (result.items.length > 0) return result;
  }
  if (lowerName.includes('manhuaplus') || lowerId.includes('manhuaplus')) {
    const result = await scrapeManhuaPlus(page, limit);
    if (result.items.length > 0) return result;
  }
  if (lowerName.includes('demonic') || lowerId.includes('demonic')) {
    const result = await scrapeDemonicScans(page, limit);
    if (result.items.length > 0) return result;
  }
  if (lowerName.includes('aquamanga') || lowerId.includes('aquamanga')) {
    const result = await scrapeAquaManga(page, limit);
    if (result.items.length > 0) return result;
  }
  if (lowerName.includes('kunmanga') || lowerId.includes('kunmanga')) {
    const result = await scrapeKunManga(page, limit);
    if (result.items.length > 0) return result;
  }


  const scrapedItems: any[] = [];

  try {
    const catalogCandidates: string[] = [];

    // Build comprehensive, engine-aware catalog candidate URLs
    if (sourceDef.engineType === 'madara') {
      if (page === 1) {
        catalogCandidates.push(`${baseOrigin}/manga/?m_orderby=views`);
        catalogCandidates.push(`${baseOrigin}/manga/`);
        catalogCandidates.push(`${baseOrigin}/manga-list/`);
        catalogCandidates.push(`${baseOrigin}/`);
      } else {
        catalogCandidates.push(`${baseOrigin}/manga/page/${page}/?m_orderby=views`);
        catalogCandidates.push(`${baseOrigin}/manga/page/${page}/`);
        catalogCandidates.push(`${baseOrigin}/page/${page}/`);
      }
    } else if (sourceDef.engineType === 'mangathemesia') {
      if (page === 1) {
        catalogCandidates.push(`${baseOrigin}/manga/?order=popular`);
        catalogCandidates.push(`${baseOrigin}/manga/`);
        catalogCandidates.push(`${baseOrigin}/series/?order=popular`);
        catalogCandidates.push(`${baseOrigin}/comic/`);
        catalogCandidates.push(`${baseOrigin}/`);
      } else {
        catalogCandidates.push(`${baseOrigin}/manga/?page=${page}&order=popular`);
        catalogCandidates.push(`${baseOrigin}/manga/?page=${page}`);
        catalogCandidates.push(`${baseOrigin}/series/?page=${page}`);
        catalogCandidates.push(`${baseOrigin}/comic/?page=${page}`);
        catalogCandidates.push(`${baseOrigin}/page/${page}/`);
      }
    } else if (sourceDef.engineType === 'wpcomics') {
      if (page === 1) {
        catalogCandidates.push(`${baseOrigin}/manga-list`);
        catalogCandidates.push(`${baseOrigin}/manga/`);
        catalogCandidates.push(`${baseOrigin}/`);
      } else {
        catalogCandidates.push(`${baseOrigin}/manga-list?page=${page}`);
        catalogCandidates.push(`${baseOrigin}/?page=${page}`);
        catalogCandidates.push(`${baseOrigin}/manga/page/${page}/`);
      }
    } else if (sourceDef.engineType === 'foolslide') {
      if (page === 1) {
        catalogCandidates.push(`${baseOrigin}/directory/`);
        catalogCandidates.push(`${baseOrigin}/series/`);
        catalogCandidates.push(`${baseOrigin}/list/`);
        catalogCandidates.push(`${baseOrigin}/`);
      } else {
        catalogCandidates.push(`${baseOrigin}/directory/${page}/`);
        catalogCandidates.push(`${baseOrigin}/series/${page}/`);
        catalogCandidates.push(`${baseOrigin}/list/${page}/`);
      }
    } else {
      // Custom HTML / Generic (Demonic Scans, PHP scripts, Next/Nuxt custom sites)
      if (lowerId.includes('demonic') || baseOrigin.includes('demonicscans')) {
        catalogCandidates.push(`${baseOrigin}/lastupdates.php?page=${page}`);
        catalogCandidates.push(`${baseOrigin}/newmangalist.php?page=${page}`);
        catalogCandidates.push(`${baseOrigin}/translationlist.php?page=${page}`);
      }
      if (page === 1) {
        catalogCandidates.push(`${baseOrigin}/lastupdates.php`);
        catalogCandidates.push(`${baseOrigin}/newmangalist.php`);
        catalogCandidates.push(`${baseOrigin}/browse`);
        catalogCandidates.push(`${baseOrigin}/series`);
        catalogCandidates.push(`${baseOrigin}/comics`);
        catalogCandidates.push(`${baseOrigin}/manga`);
        catalogCandidates.push(`${baseOrigin}/manga-list`);
        catalogCandidates.push(`${baseOrigin}/all-manga`);
        catalogCandidates.push(`${baseOrigin}/directory`);
        catalogCandidates.push(`${baseOrigin}/`);
      } else {
        catalogCandidates.push(`${baseOrigin}/lastupdates.php?page=${page}`);
        catalogCandidates.push(`${baseOrigin}/newmangalist.php?page=${page}`);
        catalogCandidates.push(`${baseOrigin}/browse?page=${page}`);
        catalogCandidates.push(`${baseOrigin}/series?page=${page}`);
        catalogCandidates.push(`${baseOrigin}/comics?page=${page}`);
        catalogCandidates.push(`${baseOrigin}/manga?page=${page}`);
        catalogCandidates.push(`${baseOrigin}/manga-list?page=${page}`);
        catalogCandidates.push(`${baseOrigin}/all-manga?page=${page}`);
        catalogCandidates.push(`${baseOrigin}/directory?page=${page}`);
        catalogCandidates.push(`${baseOrigin}/?page=${page}`);
      }
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
            headers: { 'User-Agent': SCRAPER_UA, 'Accept': 'text/html,application/xhtml+xml', 'Referer': `${baseOrigin}/` },
            enableCloudflareBypass: appSettings.enableCloudflareBypass,
            flareSolverrUrl: appSettings.flareSolverrUrl,
            captchaSolverEnabled: appSettings.captchaSolverEnabled,
            captchaApiKey: appSettings.captchaApiKey,
            timeoutMs: timeout,
            sourceId: sourceDef.id,
            onCookieUpdate: (sid, cookies) => sourceCookieJar.setCookies(sid, cookies),
          });
          if (liveRes.ok && liveRes.html && liveRes.html.length > 500) {
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
      const parsedCards = parseUniversalCatalogCards(html, sourceDef, baseOrigin);
      scrapedItems.push(...parsedCards);
    }
  } catch (err: any) {
    console.warn(`[Catalog Scraper] Scrape error on ${sourceDef.name}:`, err.message);
  }

  // When items are found for this page, return them directly without out-of-bounds offset slicing
  if (scrapedItems.length > 0) {
    const pageItems = scrapedItems.slice(0, limit);
    const hasMore = scrapedItems.length >= Math.min(limit, 10);
    const calculatedTotal = hasMore ? page * limit + limit * 5 : (page - 1) * limit + pageItems.length;
    return { items: pageItems, totalCount: calculatedTotal };
  }

  // Fallback to local DB matches if remote live scrape completely failed
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

  const offset = (page - 1) * limit;
  return { items: dbMatches.slice(offset, offset + limit), totalCount: dbMatches.length };
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
    if (isAdSeries(it.title, it.sourceUrl, it.description)) continue;
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
    if (isAdSeries(m.title, m.sourceUrl, m.description)) continue;

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
