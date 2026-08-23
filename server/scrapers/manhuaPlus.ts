import * as cheerio from 'cheerio';
import { MangaItem } from '../../src/types';
import { stripAdElements } from '../adFilter';

const UA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Referer': 'https://manhuaplus.top/',
};

export interface ManhuaPlusSeriesItem {
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

export function extractManhuaPlusSlug(url: string): string {
  if (!url) return '';
  const match = url.match(/\/manga\/([^/]+)/i);
  if (match) return match[1];
  const parts = url.split('/').filter(Boolean);
  return parts[parts.length - 1] || '';
}

export async function scrapeManhuaPlus(
  page: number = 1,
  limit: number = 24
): Promise<{ items: ManhuaPlusSeriesItem[]; totalCount: number }> {
  try {
    const url = page === 1
      ? 'https://manhuaplus.top/manga/?m_orderby=views'
      : `https://manhuaplus.top/manga/page/${page}/?m_orderby=views`;

    const res = await fetch(url, {
      headers: UA_HEADERS,
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return { items: [], totalCount: 0 };

    const html = await res.text();
    const $ = cheerio.load(html);
    stripAdElements($);
    const items: ManhuaPlusSeriesItem[] = [];

    $('.page-item-detail, .c-tabs-item__content, .badge-pos-1').each((_, el) => {
      const card = $(el);
      const a = card.find('.post-title a, h3 a, h4 a').first();
      const href = a.attr('href') || '';
      const rawTitle = a.text().trim() || a.attr('title') || '';
      if (!href || !rawTitle || !/\/manga\/[^/]+/i.test(href)) return;

      const fullUrl = href.startsWith('http') ? href : `https://manhuaplus.top${href}`;
      const slug = extractManhuaPlusSlug(fullUrl);
      if (!slug) return;

      const img = card.find('img').first();
      let cover = img.attr('data-src') || img.attr('data-lazy-src') || img.attr('data-original') || img.attr('src') || '';
      if (cover.includes('placeholder') || cover.includes('data:image')) {
        cover = img.attr('data-src') || img.attr('data-lazy-src') || '';
      }
      if (cover && !cover.startsWith('http')) {
        cover = `https://manhuaplus.top${cover.startsWith('/') ? '' : '/'}${cover}`;
      }

      let latestChapter = 1;
      const chText = card.find('.chapter, .font-meta, .chapter-item').first().text();
      const chMatch = chText.match(/(\d+(?:\.\d+)?)/);
      if (chMatch) latestChapter = parseFloat(chMatch[1]) || 1;

      const genres: string[] = [];
      card.find('.mg_genres a, .genres a').each((__, gEl) => {
        const g = $(gEl).text().trim();
        if (g && !genres.includes(g)) genres.push(g);
      });

      items.push({
        id: `manhuaplus_${slug}`,
        title: rawTitle.replace(/\s+/g, ' ').trim(),
        sourceUrl: fullUrl,
        coverImage: cover,
        sourceName: 'ManhuaPlus',
        description: `Series from ManhuaPlus`,
        genres: genres.length > 0 ? genres : ['Manhua', 'Action'],
        latestChapter,
        type: 'manhua',
        rating: 9.0,
      });
    });

    return { items: items.slice(0, limit), totalCount: Math.max(items.length, 300) };
  } catch (e) {
    console.error('[Scraper] ManhuaPlus failed:', (e as Error).message);
    return { items: [], totalCount: 0 };
  }
}

export async function searchManhuaPlus(query: string, limit: number = 24): Promise<ManhuaPlusSeriesItem[]> {
  try {
    const cleanQ = encodeURIComponent(query.trim());
    const url = `https://manhuaplus.top/?s=${cleanQ}&post_type=wp-manga`;
    const res = await fetch(url, {
      headers: UA_HEADERS,
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return [];

    const html = await res.text();
    const $ = cheerio.load(html);
    stripAdElements($);
    const items: ManhuaPlusSeriesItem[] = [];

    $('.c-tabs-item__content, .search-wrap .row, .page-item-detail').each((_, el) => {
      const card = $(el);
      const a = card.find('.post-title a, h3 a, h4 a, .tab-thumb a').first();
      const href = a.attr('href') || '';
      const rawTitle = a.text().trim() || a.attr('title') || '';
      if (!href || !rawTitle || !/\/manga\/[^/]+/i.test(href)) return;

      const fullUrl = href.startsWith('http') ? href : `https://manhuaplus.top${href}`;
      const slug = extractManhuaPlusSlug(fullUrl);
      if (!slug) return;

      const img = card.find('img').first();
      let cover = img.attr('data-src') || img.attr('data-lazy-src') || img.attr('data-original') || img.attr('src') || '';
      if (cover && !cover.startsWith('http')) {
        cover = `https://manhuaplus.top${cover.startsWith('/') ? '' : '/'}${cover}`;
      }

      items.push({
        id: `manhuaplus_${slug}`,
        title: rawTitle.replace(/\s+/g, ' ').trim(),
        sourceUrl: fullUrl,
        coverImage: cover,
        sourceName: 'ManhuaPlus',
        genres: ['Manhua'],
        latestChapter: 1,
        type: 'manhua',
      });
    });

    return items.slice(0, limit);
  } catch {
    return [];
  }
}
