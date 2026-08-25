// ============================================================================
// Universal Source Catalog Scraper & DOM Card Parser
// ============================================================================

import crypto from 'node:crypto';
import * as cheerio from 'cheerio';
import { MangaItem } from '../../../src/types';
import { isAdImageSrc, isAdSeries, isAdUrl, isAdTitle, stripAdElements } from '../../adFilter';
import { cleanMangaTitle } from '../../../src/utils/metadataHelpers';
import {
  SourceDefinition,
  isContentPath,
  isSeriesContentPath,
  isChapterTitle,
  isNavText,
  KOTATSU_SOURCES,
  disabledSourceIds,
  isSourceAlive,
} from '../../sources/sourcesCatalog';
import { fetchWithChallengeBypass } from '../../captchaSolver';
import { sourceCookieJar, updateSourceHealth } from '../sourceHealthService';
import { appSettings, mangaDatabase } from '../../appState';

export const SCRAPER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export function generateSourceScrapeId(prefix: string, href: string): string {
  const normalized = href.replace(/\/+$/, '');
  return `${prefix}_${crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 24)}`;
}

export function dedupeExploreItems(items: any[]): any[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = (item.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildDatabaseExploreItems(limit: number = 30): any[] {
  return mangaDatabase
    .filter((m) => m && m.title && m.title !== 'Unknown')
    .slice(0, limit)
    .map((m) => ({
      id: m.id,
      title: m.title,
      sourceUrl: m.sourceUrl || '',
      coverImage: m.coverImage || '',
      sourceName: m.sourceName || 'Library',
      description: m.description || '',
      genres: m.genres || [],
      latestChapter: m.latestChapter || 1,
      type: m.type || 'manhwa',
      rating: m.rating || 9.0,
      isNsfw: Boolean(m.isNsfw),
    }));
}

export function getEligibleExploreSources(): SourceDefinition[] {
  return KOTATSU_SOURCES.filter((s) => isSourceAlive(s.id));
}

export const defaultExploreSources = [
  'asurascans',
  'flamecomics',
  'weebcentral',
  'manhwa18',
];

export function parseUniversalCatalogCards(
  htmlText: string,
  source: SourceDefinition,
  origin: string,
  limit: number = 24
): any[] {
  const $ = cheerio.load(htmlText);
  stripAdElements($);
  const items: any[] = [];
  const seenUrls = new Set<string>();

  const containerSelectors = [
    '.listupd .bs .bsx',
    'div.page-item-detail',
    '.tab-content .c-tabs-item__content',
    '.grid .group',
    '.row-content-chapter .row',
    '.list-chapter .row',
    '.listupd .element',
    '.directory-list .item',
    '.manga-list .item',
    '.series-card',
    '.book-item',
    'div.badge-pos',
    '.lastupdates-container .item',
    '.thumb-item-flow',
    '.manga-item',
    'figure.clearfix',
    'div.item',
  ];

  let cardNodes: any[] = [];
  for (const sel of containerSelectors) {
    const found = $(sel).toArray();
    if (found.length > 0) {
      cardNodes = found;
      break;
    }
  }

  const parseNode = (el: any) => {
    if (items.length >= limit) return;
    const card = $(el);

    let titleAnchor = card
      .find('.series-title a, .thumb_attr.series-title a, .post-title a, .tt a, h3 a, h4 a, .title a, a.series-name, .manga-name a')
      .first();

    if (titleAnchor.length === 0) {
      titleAnchor = card
        .find('a[title], a[href]')
        .not('[href*="chapter"]')
        .not('[href*="chap-"]')
        .not('[title*="Chapter"]')
        .first();
    }

    let href =
      titleAnchor.attr('href') ||
      card.find('a[href]').not('[href*="chapter"]').not('[href*="chap-"]').first().attr('href') ||
      card.attr('href') ||
      '';

    let rawTitle =
      titleAnchor.attr('title') ||
      titleAnchor.text().trim() ||
      card.find('.series-title, .tt, .post-title, h3, h4, .manga-name').text().trim() ||
      '';

    if (!href || !rawTitle) return;
    if (isAdUrl(href) || isAdTitle(rawTitle) || isAdSeries(rawTitle, href)) return;

    href = href.trim();
    if (!href.startsWith('http')) {
      href = `${origin}${href.startsWith('/') ? '' : '/'}${href}`;
    }
    href = href.replace(/\/+$/, '');

    const cleanTitle = cleanMangaTitle(rawTitle);
    if (!cleanTitle || isNavText(cleanTitle) || isChapterTitle(cleanTitle)) return;
    if (isAdSeries(cleanTitle, href)) return;

    if (!isSeriesContentPath(href)) return;

    const normUrl = href.toLowerCase();
    if (seenUrls.has(normUrl)) return;
    seenUrls.add(normUrl);

    let coverImage = '';
    const imgEl = card.find('img').first();
    if (imgEl.length > 0) {
      coverImage =
        imgEl.attr('data-src') ||
        imgEl.attr('data-lazy-src') ||
        imgEl.attr('data-original') ||
        imgEl.attr('data-cdn-src') ||
        imgEl.attr('data-cfsrc') ||
        imgEl.attr('data-full-url') ||
        imgEl.attr('src') ||
        '';
    }

    if (!coverImage || /\/loading\.gif|placeholder/i.test(coverImage)) {
      const bgEl = card.find('[data-bg], [data-background], [style*="background"]').first();
      coverImage = bgEl.attr('data-bg') || bgEl.attr('data-background') || '';
      if (!coverImage) {
        const style = bgEl.attr('style') || card.attr('style') || '';
        const bgMatch = style.match(/background(?:-image)?:\s*url\(['"]?([^'")]+)['"]?\)/i);
        if (bgMatch && bgMatch[1]) coverImage = bgMatch[1];
      }
    }

    if (coverImage) {
      coverImage = coverImage.trim();
      if (coverImage.startsWith('//')) coverImage = 'https:' + coverImage;
      else if (coverImage.startsWith('/')) coverImage = `${origin}${coverImage}`;
      if (isAdImageSrc(coverImage, origin)) coverImage = '';
    }

    let latestChapter = 1;
    const chText = card.find('.epxs, .chapter, .chap, .latest-chapter, .ep, .chapter-title, .thumb_attr, a[href*="chapter"], a[href*="chap-"]').text().trim();
    const chMatch = chText.match(/(?:chapter|chap|ch|ep)[-_\.\s]*(\d+(?:\.\d+)?)/i) || (card.text().match(/(?:chapter|chap|ch|ep)[-_\.\s]*(\d+(?:\.\d+)?)/i));
    if (chMatch) {
      latestChapter = parseFloat(chMatch[1]) || 1;
    }

    const ratingText = card.find('.num, .rating, .score, .numscore').first().text().trim();
    let rating = 9.0;
    const rNum = parseFloat(ratingText);
    if (Number.isFinite(rNum) && rNum > 0 && rNum <= 10) rating = rNum;

    const scrapeId = generateSourceScrapeId(source.id, href);

    items.push({
      id: scrapeId,
      title: cleanTitle,
      sourceUrl: href,
      coverImage,
      sourceName: source.name,
      description: `Series from ${source.name}`,
      genres: source.isNsfw ? ['Adult', 'Manhwa'] : ['Action', 'Fantasy'],
      latestChapter,
      type: source.isNsfw ? 'manhwa' : 'manhwa',
      rating,
      isNsfw: source.isNsfw,
    });
  };

  if (cardNodes.length > 0) {
    cardNodes.forEach(parseNode);
  } else {
    $('a[href]').each((_, el) => parseNode(el));
  }

  return items;
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
          Accept: 'application/json',
          Origin: 'https://asurascans.com',
          Referer: 'https://asurascans.com/',
        },
      });
      if (!res.ok) break;
      json = await res.json();
    } catch {
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
      headers: { 'User-Agent': SCRAPER_UA, Accept: 'text/html' },
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
  } catch {
    return [];
  }
}

export async function scrapeManhwa18(page: number, limit: number): Promise<any[]> {
  try {
    const url = `https://manhwa18.com/tim-kiem?page=${page}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': SCRAPER_UA, Accept: 'text/html', Referer: 'https://manhwa18.com/' },
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
  } catch {
    return [];
  }
}

export async function searchManhwa18(query: string, page: number = 1, limit: number = 24): Promise<{ items: any[]; totalCount: number }> {
  try {
    const encQ = encodeURIComponent(query);
    const url = `https://manhwa18.com/tim-kiem?q=${encQ}&page=${page}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': SCRAPER_UA, Accept: 'text/html', Referer: 'https://manhwa18.com/' },
    });
    if (!res.ok) return { items: [], totalCount: 0 };

    const html = await res.text();
    const $ = cheerio.load(html);
    const items: any[] = [];
    const seen = new Set<string>();

    let cards = $('.card-body .thumb-item-flow, .thumb-item-flow').toArray();
    if (cards.length === 0) cards = $('.thumb_attr.series-title').parent().toArray();

    for (const el of cards) {
      if (items.length >= limit) break;
      const card = $(el);
      const titleA = card.find('.thumb_attr.series-title > a, .series-title a').first();
      const href = titleA.attr('href') || card.find('a[href*="/manga/"]').not('[href*="chapter"]').not('[href*="chap-"]').first().attr('href') || '';
      const title = titleA.text().trim() || titleA.attr('title') || '';
      if (!href || !title) continue;
      const absUrl = href.startsWith('http') ? href : `https://manhwa18.com${href.startsWith('/') ? '' : '/'}${href}`;
      const key = absUrl.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const bgEl = card.find('[data-bg], [data-background], [data-src], [data-original], [data-lazy-src], img').first();
      let cover = bgEl.attr('data-bg') || bgEl.attr('data-background') || bgEl.attr('data-src') || bgEl.attr('data-original') || bgEl.attr('data-lazy-src') || bgEl.attr('src') || '';
      if (cover.startsWith('//')) cover = `https:${cover}`;
      else if (cover.startsWith('/')) cover = `https://manhwa18.com${cover}`;

      items.push({
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

    return { items, totalCount: items.length };
  } catch {
    return { items: [], totalCount: 0 };
  }
}

export async function getSourcePopularSeries(
  sourceDefOrId: SourceDefinition | string,
  page: number = 1,
  limit: number = 24
): Promise<{ items: any[]; totalCount: number }> {
  const sourceId = typeof sourceDefOrId === 'string' ? sourceDefOrId : sourceDefOrId.id;

  if (sourceId === 'asura' || sourceId === 'asurascans') {
    return await scrapeAsuraScans(page, limit);
  }
  if (sourceId === 'flame' || sourceId === 'flamecomics') {
    const items = await scrapeFlameComics(page, limit);
    return { items, totalCount: items.length };
  }
  if (sourceId === 'manhwa18') {
    const items = await scrapeManhwa18(page, limit);
    return { items, totalCount: items.length };
  }
  const src = typeof sourceDefOrId === 'object' ? sourceDefOrId : KOTATSU_SOURCES.find((s) => s.id === sourceId);
  if (!src) return { items: [], totalCount: 0 };
  const origin = new URL(src.baseUrl).origin;
  const catalogPath = (src as any).catalogPath || '/';
  const url = `${origin}${catalogPath.startsWith('/') ? '' : '/'}${catalogPath}`;

  const res = await fetchWithChallengeBypass(url, {
    headers: { 'User-Agent': SCRAPER_UA, Accept: 'text/html', Referer: origin + '/' },
    enableCloudflareBypass: appSettings.enableCloudflareBypass,
    flareSolverrUrl: appSettings.flareSolverrUrl,
    captchaSolverEnabled: appSettings.captchaSolverEnabled,
    captchaApiKey: appSettings.captchaApiKey,
    timeoutMs: 12000,
    sourceId: src.id,
    onCookieUpdate: (sid, cookies) => sourceCookieJar.setCookies(sid, cookies),
  });

  if (!res.ok || !res.html) return { items: [], totalCount: 0 };
  const items = parseUniversalCatalogCards(res.html, src, origin, limit);
  return { items, totalCount: items.length };
}

export async function searchSourceDirectly(
  sourceDefOrId: SourceDefinition | string,
  query: string,
  page: number = 1,
  limit: number = 24
): Promise<{ items: any[]; totalCount: number }> {
  const sourceId = typeof sourceDefOrId === 'string' ? sourceDefOrId : sourceDefOrId.id;
  if (sourceId === 'manhwa18') {
    return await searchManhwa18(query, page, limit);
  }
  const { items } = await getSourcePopularSeries(sourceDefOrId, page, limit);
  const filtered = items.filter((i) => i.title.toLowerCase().includes(query.toLowerCase()));
  return { items: filtered, totalCount: filtered.length };
}

export async function refreshExploreCatalog(forceRefresh: boolean = false): Promise<any[]> {
  const { buildUniversalExploreCatalog } = await import('./scheduler');
  return await buildUniversalExploreCatalog();
}

export const exploreBufferRef = {
  get current() {
    const { getExploreBuffer } = require('./scheduler');
    return getExploreBuffer();
  },
};
