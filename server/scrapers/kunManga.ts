import * as cheerio from 'cheerio';
import { MangaItem } from '../../src/types';
import { stripAdElements } from '../adFilter';

const UA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Referer': 'https://kunmanga.com/',
};

export interface KunMangaSeriesItem {
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

export function extractKunMangaSlug(url: string): string {
  if (!url) return '';
  const match = url.match(/\/manga\/([^/]+)/i);
  if (match) return match[1];
  const parts = url.split('/').filter(Boolean);
  return parts[parts.length - 1] || '';
}

export async function scrapeKunManga(
  page: number = 1,
  limit: number = 24
): Promise<{ items: KunMangaSeriesItem[]; totalCount: number }> {
  try {
    const url = page === 1
      ? 'https://kunmanga.com/manga/?m_orderby=views'
      : `https://kunmanga.com/manga/page/${page}/?m_orderby=views`;

    const res = await fetch(url, {
      headers: UA_HEADERS,
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return { items: [], totalCount: 0 };

    const html = await res.text();
    const $ = cheerio.load(html);
    stripAdElements($);
    const items: KunMangaSeriesItem[] = [];

    $('.page-item-detail, .c-tabs-item__content, .badge-pos-1').each((_, el) => {
      const card = $(el);
      const a = card.find('.post-title a, h3 a, h4 a').first();
      const href = a.attr('href') || '';
      const rawTitle = a.text().trim() || a.attr('title') || '';
      if (!href || !rawTitle || !/\/manga\/[^/]+/i.test(href)) return;

      const fullUrl = href.startsWith('http') ? href : `https://kunmanga.com${href}`;
      const slug = extractKunMangaSlug(fullUrl);
      if (!slug) return;

      const img = card.find('img').first();
      let cover = img.attr('data-src') || img.attr('data-lazy-src') || img.attr('data-original') || img.attr('src') || '';
      if (cover.includes('placeholder') || cover.includes('data:image')) {
        cover = img.attr('data-src') || img.attr('data-lazy-src') || '';
      }
      if (cover && !cover.startsWith('http')) {
        cover = `https://kunmanga.com${cover.startsWith('/') ? '' : '/'}${cover}`;
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
        id: `kunmanga_${slug}`,
        title: rawTitle.replace(/\s+/g, ' ').trim(),
        sourceUrl: fullUrl,
        coverImage: cover,
        sourceName: 'Kun Manga',
        description: `Series from Kun Manga`,
        genres: genres.length > 0 ? genres : ['Manhua', 'Manhwa', 'Manga'],
        latestChapter,
        type: slug.includes('manhua') ? 'manhua' : slug.includes('manhwa') ? 'manhwa' : 'manga',
        rating: 9.0,
      });
    });

    return { items: items.slice(0, limit), totalCount: Math.max(items.length, 400) };
  } catch (e) {
    console.error('[Scraper] Kun Manga failed:', (e as Error).message);
    return { items: [], totalCount: 0 };
  }
}
