// ============================================================================
// MANHUA PLUS SCRAPER (WPComics/ASP.NET theme — rebuilt 2026-08)
//
// manhuaplus.top migrated off the WordPress Madara theme: the old
// `/manga/?m_orderby=views` catalogue, wp-admin AJAX chapter endpoint, and
// `/?s=&post_type=wp-manga` search all return 404 now.  Current layout:
//   catalogue : /all-manga/{page}/?sort=views   (cards: div.item > figure)
//   search    : /filter?keyword={query}         (same card markup)
//   series    : /manga/{slug}                    (inline chapter list
//                                                 #nt_listchapter, links
//                                                 /manga/{slug}/chapter-N)
// ============================================================================

import * as cheerio from 'cheerio';
import { cleanMangaTitle } from '../../src/utils/metadataHelpers';
import { stripAdElements } from '../adFilter';
import { extractMadaraSlug, MadaraSeriesItem, MadaraScrapeResult } from './madaraTheme';

export type ManhuaPlusSeriesItem = MadaraSeriesItem;

const BASE_URL = 'https://manhuaplus.top';

const UA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Referer': `${BASE_URL}/`,
};

export const extractManhuaPlusSlug = (url: string): string => extractMadaraSlug(url, 'manga');

/** Parse the new-theme series cards (`div.item > figure.clearfix`). */
export function parseManhuaPlusCards(html: string): ManhuaPlusSeriesItem[] {
  const $ = cheerio.load(html);
  stripAdElements($);
  const items: ManhuaPlusSeriesItem[] = [];
  const seen = new Set<string>();

  $('div.item').each((_, el) => {
    const card = $(el);
    const a = card.find('.image a[href*="/manga/"], a[title][href*="/manga/"]').first();
    const href = a.attr('href') || '';
    const title = (a.attr('title') || a.text() || '').trim();
    if (!href || !title) return;
    // Series links only — chapter links look like /manga/{slug}/chapter-N.
    if (!/\/manga\/[^/]+\/?$/i.test(href)) return;

    const fullUrl = href.startsWith('http') ? href : `${BASE_URL}${href.startsWith('/') ? '' : '/'}${href}`;
    const slug = extractManhuaPlusSlug(fullUrl);
    if (!slug || seen.has(slug)) return;
    seen.add(slug);

    const img = card.find('img').first();
    let cover = img.attr('data-original') || img.attr('data-src') || img.attr('data-lazy-src') || img.attr('src') || '';
    if (cover && !cover.startsWith('http')) {
      cover = `${BASE_URL}${cover.startsWith('/') ? '' : '/'}${cover}`;
    }

    let latestChapter: number | undefined;
    const chText =
      card.find('li.chapter a[title]').first().attr('title') ||
      card.find('li.chapter a, .chapter a').first().text() ||
      '';
    const chMatch = chText.match(/(\d+(?:\.\d+)?)/);
    if (chMatch) {
      const parsed = parseFloat(chMatch[1]);
      if (Number.isFinite(parsed) && parsed > 0) latestChapter = parsed;
    }

    // Honest metadata only — no fabricated ratings, genres, or descriptions.
    items.push({
      id: `manhuaplus_${slug}`,
      title: cleanMangaTitle(title),
      sourceUrl: fullUrl,
      coverImage: cover,
      sourceName: 'ManhuaPlus',
      ...(latestChapter !== undefined ? { latestChapter } : {}),
      type: 'manhua',
    });
  });

  return items;
}

/** Parse "Page 1 / 28" pagination totals from the new theme. */
export function parseManhuaPlusTotalCount(html: string, itemsPerPage: number): number {
  const $ = cheerio.load(html);
  const hidden = $('ul.pagination li.hidden, .pagination li.hidden').first().text();
  const m = hidden.match(/Page\s+\d+\s*\/\s*(\d+)/i) || hidden.match(/\/\s*(\d+)/);
  if (m) {
    const totalPages = parseInt(m[1], 10);
    if (Number.isFinite(totalPages) && totalPages > 0 && itemsPerPage > 0) {
      return totalPages * itemsPerPage;
    }
  }
  let lastPage = 0;
  $('ul.pagination a, .pagination a').each((_, el) => {
    const t = ($(el).attr('title') || '') + ' ' + $(el).text();
    const pm = t.match(/Page\s+(\d+)/i) || t.match(/^(\d+)$/);
    if (pm) {
      const n = parseInt(pm[1], 10);
      if (Number.isFinite(n) && n > lastPage) lastPage = n;
    }
  });
  return lastPage > 0 && itemsPerPage > 0 ? lastPage * itemsPerPage : 0;
}

export async function scrapeManhuaPlus(
  page: number = 1,
  limit: number = 24,
): Promise<MadaraScrapeResult> {
  try {
    const url = `${BASE_URL}/all-manga/${Math.max(1, page)}/?sort=views`;
    const res = await fetch(url, { headers: UA_HEADERS, signal: AbortSignal.timeout(12000) });
    if (!res.ok) return { items: [], totalCount: 0 };

    const html = await res.text();
    const items = parseManhuaPlusCards(html);
    const parsedTotal = parseManhuaPlusTotalCount(html, Math.max(items.length, 1));
    const totalCount = parsedTotal > 0 ? Math.max(parsedTotal, items.length) : items.length;
    return { items: items.slice(0, limit), totalCount };
  } catch (e) {
    console.error('[Scraper] ManhuaPlus failed:', (e as Error).message);
    return { items: [], totalCount: 0 };
  }
}

export async function searchManhuaPlus(query: string, limit: number = 24): Promise<ManhuaPlusSeriesItem[]> {
  try {
    const cleanQ = encodeURIComponent(query.trim());
    if (!cleanQ) return [];
    const url = `${BASE_URL}/filter?keyword=${cleanQ}`;
    const res = await fetch(url, { headers: UA_HEADERS, signal: AbortSignal.timeout(12000) });
    if (!res.ok) return [];

    const html = await res.text();
    return parseManhuaPlusCards(html).slice(0, limit);
  } catch {
    return [];
  }
}
