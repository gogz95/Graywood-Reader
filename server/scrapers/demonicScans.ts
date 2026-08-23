import * as cheerio from 'cheerio';
import { MangaItem } from '../../src/types';
import { stripAdElements } from '../adFilter';

const UA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Referer': 'https://demonicscans.org/',
};

export interface DemonicScansSeriesItem {
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

export function extractDemonicScansSlug(url: string): string {
  if (!url) return '';
  const match = url.match(/\/(?:title|manga|series)\/([^/]+)/i);
  if (match) return match[1];
  const parts = url.split('/').filter(Boolean);
  return parts[parts.length - 1] || '';
}

export async function scrapeDemonicScans(
  page: number = 1,
  limit: number = 24
): Promise<{ items: DemonicScansSeriesItem[]; totalCount: number }> {
  try {
    const url = page === 1
      ? 'https://demonicscans.org/newmangalist.php'
      : `https://demonicscans.org/newmangalist.php?page=${page}`;

    const res = await fetch(url, {
      headers: UA_HEADERS,
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return { items: [], totalCount: 0 };

    const html = await res.text();
    const $ = cheerio.load(html);
    stripAdElements($);
    const items: DemonicScansSeriesItem[] = [];

    $('.item, .box_list .item, .lastupdates-container .item, .media').each((_, el) => {
      const card = $(el);
      const a = card.find('a[href*="/title/"], a[href*="/manga/"], .media-body a').first();
      const href = a.attr('href') || '';
      const rawTitle = (a.text() || a.attr('title') || card.find('h4, h3, .title').text()).trim();
      if (!href || !rawTitle) return;

      const fullUrl = href.startsWith('http') ? href : `https://demonicscans.org${href.startsWith('/') ? '' : '/'}${href}`;
      const slug = extractDemonicScansSlug(fullUrl);
      if (!slug) return;

      const img = card.find('img').first();
      let cover = img.attr('data-src') || img.attr('src') || '';
      if (cover && !cover.startsWith('http')) {
        cover = `https://demonicscans.org${cover.startsWith('/') ? '' : '/'}${cover}`;
      }

      let latestChapter = 1;
      const chText = card.find('.chapter, .text-muted, a[href*="/read/"]').first().text();
      const chMatch = chText.match(/(\d+(?:\.\d+)?)/);
      if (chMatch) latestChapter = parseFloat(chMatch[1]) || 1;

      items.push({
        id: `demonicscans_${slug}`,
        title: rawTitle.replace(/\s+/g, ' ').trim(),
        sourceUrl: fullUrl,
        coverImage: cover,
        sourceName: 'Demonic Scans',
        description: `Series from Demonic Scans`,
        genres: ['Action', 'Fantasy'],
        latestChapter,
        type: 'manhwa',
        rating: 9.0,
      });
    });

    return { items: items.slice(0, limit), totalCount: Math.max(items.length, 250) };
  } catch (e) {
    console.error('[Scraper] Demonic Scans failed:', (e as Error).message);
    return { items: [], totalCount: 0 };
  }
}

export async function searchDemonicScans(query: string, limit: number = 24): Promise<DemonicScansSeriesItem[]> {
  try {
    const cleanQ = encodeURIComponent(query.trim());
    const url = `https://demonicscans.org/advanced.php?search=${cleanQ}`;
    const res = await fetch(url, {
      headers: UA_HEADERS,
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return [];

    const html = await res.text();
    const $ = cheerio.load(html);
    stripAdElements($);
    const items: DemonicScansSeriesItem[] = [];

    $('.item, .box_list .item, .media').each((_, el) => {
      const card = $(el);
      const a = card.find('a[href*="/title/"], a[href*="/manga/"], .media-body a').first();
      const href = a.attr('href') || '';
      const rawTitle = (a.text() || a.attr('title') || '').trim();
      if (!href || !rawTitle) return;

      const fullUrl = href.startsWith('http') ? href : `https://demonicscans.org${href.startsWith('/') ? '' : '/'}${href}`;
      const slug = extractDemonicScansSlug(fullUrl);
      if (!slug) return;

      const img = card.find('img').first();
      let cover = img.attr('data-src') || img.attr('src') || '';
      if (cover && !cover.startsWith('http')) {
        cover = `https://demonicscans.org${cover.startsWith('/') ? '' : '/'}${cover}`;
      }

      items.push({
        id: `demonicscans_${slug}`,
        title: rawTitle.replace(/\s+/g, ' ').trim(),
        sourceUrl: fullUrl,
        coverImage: cover,
        sourceName: 'Demonic Scans',
        genres: ['Action', 'Fantasy'],
        latestChapter: 1,
        type: 'manhwa',
      });
    });

    return items.slice(0, limit);
  } catch {
    return [];
  }
}
