// ============================================================================
// MADARA THEME SHARED SCRAPER FACTORY
//
// Mirrors Mihon/Tachiyomi's shared `Madara` base-class pattern: dozens of
// WordPress "Madara" theme sites (MangaRead, Aqua Manga, Kun Manga,
// Manhua Plus, ...) share the exact same card markup, AJAX chapter endpoint,
// and pagination widgets.  Instead of copy-pasting the parsing logic into one
// file per source, this factory builds a configured scraper per source.
// ============================================================================

import * as cheerio from 'cheerio';
import { stripAdElements } from '../adFilter';
import { cleanMangaTitle } from '../../src/utils/metadataHelpers';

export interface MadaraThemeConfig {
  /** Unique lowercase source id (must match the catalog entry). */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Site origin, no trailing slash. e.g. 'https://www.mangaread.org' */
  baseUrl: string;
  /** Path segment that identifies a series URL. Default: 'manga'. */
  seriesPathSegment?: string;
  /** Genres applied only when a card exposes none. Default: none (honest). */
  defaultGenres?: string[];
  /** Content type heuristic from the slug. Default: infer from slug keywords. */
  inferType?: (slug: string) => string | undefined;
  /** Extra CSS selectors for catalog cards, appended to the Madara defaults. */
  extraCardSelectors?: string[];
}

export interface MadaraSeriesItem {
  id: string;
  title: string;
  sourceUrl: string;
  coverImage: string;
  sourceName: string;
  description?: string;
  genres?: string[];
  type?: string;
  latestChapter?: number;
  rating?: number;
}

export interface MadaraScrapeResult {
  items: MadaraSeriesItem[];
  totalCount: number;
}

const DEFAULT_UA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
};

/** Extract the series slug from a Madara-series URL. */
export function extractMadaraSlug(url: string, pathSegment: string = 'manga'): string {
  if (!url) return '';
  const rx = new RegExp(`\\/${pathSegment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/([^/]+)`, 'i');
  const match = url.match(rx);
  if (match) return match[1].replace(/\/+$/, '');
  const parts = url.split('/').filter(Boolean);
  return parts[parts.length - 1] || '';
}

/** Resolve a possibly-relative cover URL against the site origin. */
export function resolveMadaraCover(img: any, baseUrl: string): string {
  if (!img || img.length === 0) return '';
  let cover =
    img.attr('data-src') ||
    img.attr('data-lazy-src') ||
    img.attr('data-original') ||
    img.attr('src') ||
    '';
  // Madara lazy-loads covers; a placeholder/data-URI src means the real URL
  // lives in data-src / data-lazy-src.
  if (cover.includes('placeholder') || cover.includes('data:image')) {
    cover = img.attr('data-src') || img.attr('data-lazy-src') || '';
  }
  if (cover && !cover.startsWith('http')) {
    cover = `${baseUrl}${cover.startsWith('/') ? '' : '/'}${cover}`;
  }
  return cover;
}

/**
 * Parse the real total series count from Madara's wp-pagenavi widget.
 * Looks for "Page 1 of 350" text or the highest numbered page link.
 * Returns 0 when pagination cannot be determined (callers then fall back to
 * items.length — never fabricate a count).
 */
export function parseMadaraTotalCount($: cheerio.CheerioAPI, itemsPerPage: number): number {
  // Pattern 1: <span class="pages">Page 1 of 350</span>
  const pagesText = $('.wp-pagenavi span.pages, .pagination .pages, span.pages').first().text();
  const pagesMatch = pagesText.match(/of\s+([\d,]+)/i);
  if (pagesMatch) {
    const totalPages = parseInt(pagesMatch[1].replace(/,/g, ''), 10);
    if (Number.isFinite(totalPages) && totalPages > 0 && itemsPerPage > 0) {
      return totalPages * itemsPerPage;
    }
  }

  // Pattern 2: highest /page/N/ link in the pagination block
  let lastPage = 0;
  $('.wp-pagenavi a, .pagination a, ul.pagination a, .nav-links a').each((_, el) => {
    const href = ($(el).attr('href') || '') + ' ' + $(el).text();
    const m = href.match(/\/page\/(\d+)\/?/i) || href.match(/^(\d+)$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > lastPage) lastPage = n;
    }
  });
  if (lastPage > 0 && itemsPerPage > 0) return lastPage * itemsPerPage;

  return 0;
}

interface ParsedCard {
  title: string;
  href: string;
  slug: string;
  cover: string;
  latestChapter?: number;
  genres: string[];
}

function parseMadaraCards(
  $: cheerio.CheerioAPI,
  config: MadaraThemeConfig,
  isSearch: boolean,
): ParsedCard[] {
  const segment = config.seriesPathSegment || 'manga';
  const seriesHrefRx = new RegExp(`\\/${segment}\\/[^/]+`, 'i');
  // A genuine series URL ends right after the slug (optional trailing slash /
  // query / fragment).  Anything deeper (e.g. /manga/slug/chapter-3/) is a
  // chapter page masquerading as a series card.
  const seriesEndRx = new RegExp(`\\/${segment}\\/[^/]+\\/?([?#].*)?$`, 'i');
  const cardSelectors = [
    '.page-item-detail',
    '.c-tabs-item__content',
    ...(isSearch ? ['.search-wrap .row'] : ['.badge-pos-1']),
    ...(config.extraCardSelectors || []),
  ].join(', ');
  const titleSelectors = isSearch
    ? '.post-title a, h3 a, h4 a, .tab-thumb a'
    : '.post-title a, h3 a, h4 a';

  const cards: ParsedCard[] = [];
  const seenSlugs = new Set<string>();

  $(cardSelectors).each((_, el) => {
    const card = $(el);
    const a = card.find(titleSelectors).first();
    const href = a.attr('href') || '';
    const rawTitle = a.text().trim() || a.attr('title') || '';
    if (!href || !rawTitle || !seriesHrefRx.test(href)) return;
    if (!seriesEndRx.test(href.split('#')[0].split('?')[0])) return;

    const fullUrl = href.startsWith('http') ? href : `${config.baseUrl}${href}`;
    const slug = extractMadaraSlug(fullUrl, segment);
    if (!slug || seenSlugs.has(slug)) return;
    seenSlugs.add(slug);

    const cover = resolveMadaraCover(card.find('img').first(), config.baseUrl);

    let latestChapter: number | undefined;
    const chText = card.find('.chapter, .font-meta, .chapter-item').first().text();
    const chMatch = chText.match(/(\d+(?:\.\d+)?)/);
    if (chMatch) {
      const parsed = parseFloat(chMatch[1]);
      if (Number.isFinite(parsed) && parsed > 0) latestChapter = parsed;
    }

    const genres: string[] = [];
    card.find('.mg_genres a, .genres a').each((__, gEl) => {
      const g = $(gEl).text().trim();
      if (g && !genres.includes(g)) genres.push(g);
    });

    cards.push({
      title: cleanMangaTitle(rawTitle),
      href: fullUrl,
      slug,
      cover,
      latestChapter,
      genres,
    });
  });

  return cards;
}

function cardToItem(card: ParsedCard, config: MadaraThemeConfig): MadaraSeriesItem {
  const type = config.inferType ? config.inferType(card.slug) : inferTypeFromSlug(card.slug);
  return {
    id: `${config.id}_${card.slug}`,
    title: card.title,
    sourceUrl: card.href,
    coverImage: card.cover,
    sourceName: config.name,
    // Honest metadata only: no fabricated descriptions, ratings, or genres.
    ...(card.genres.length > 0
      ? { genres: card.genres }
      : config.defaultGenres && config.defaultGenres.length > 0
        ? { genres: config.defaultGenres }
        : {}),
    ...(card.latestChapter !== undefined ? { latestChapter: card.latestChapter } : {}),
    ...(type ? { type } : {}),
  };
}

async function fetchMadaraHtml(url: string, referer: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { ...DEFAULT_UA_HEADERS, 'Referer': referer },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Build a configured Madara-theme list/search scraper for one source.
 * `scrape` enumerates the popular catalogue; `search` queries wp-manga search.
 */
export function createMadaraListScraper(config: MadaraThemeConfig): {
  scrape: (page?: number, limit?: number) => Promise<MadaraScrapeResult>;
  search: (query: string, limit?: number) => Promise<MadaraSeriesItem[]>;
  extractSlug: (url: string) => string;
} {
  const referer = `${config.baseUrl}/`;

  const scrape = async (page: number = 1, limit: number = 24): Promise<MadaraScrapeResult> => {
    try {
      const url = page === 1
        ? `${config.baseUrl}/manga/?m_orderby=views`
        : `${config.baseUrl}/manga/page/${page}/?m_orderby=views`;

      const html = await fetchMadaraHtml(url, referer);
      if (!html) return { items: [], totalCount: 0 };

      const $ = cheerio.load(html);
      stripAdElements($);
      const cards = parseMadaraCards($, config, false);
      const items = cards.map((c) => cardToItem(c, config));

      // Honest totals: parse the pagination widget; otherwise report what we got.
      const parsedTotal = parseMadaraTotalCount($, Math.max(cards.length, 1));
      const totalCount = parsedTotal > 0 ? Math.max(parsedTotal, items.length) : items.length;

      return { items: items.slice(0, limit), totalCount };
    } catch (e) {
      console.error(`[Scraper] ${config.name} failed:`, (e as Error).message);
      return { items: [], totalCount: 0 };
    }
  };

  const search = async (query: string, limit: number = 24): Promise<MadaraSeriesItem[]> => {
    try {
      const cleanQ = encodeURIComponent(query.trim());
      if (!cleanQ) return [];
      const url = `${config.baseUrl}/?s=${cleanQ}&post_type=wp-manga`;

      const html = await fetchMadaraHtml(url, referer);
      if (!html) return [];

      const $ = cheerio.load(html);
      stripAdElements($);
      const cards = parseMadaraCards($, config, true);
      return cards.map((c) => cardToItem(c, config)).slice(0, limit);
    } catch {
      return [];
    }
  };

  const extractSlug = (url: string): string =>
    extractMadaraSlug(url, config.seriesPathSegment || 'manga');

  return { scrape, search, extractSlug };
}

export function inferTypeFromSlug(slug: string): string {
  const s = (slug || '').toLowerCase();
  if (s.includes('manhua')) return 'manhua';
  if (s.includes('manhwa')) return 'manhwa';
  return 'manga';
}
