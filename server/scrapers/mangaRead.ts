import * as cheerio from 'cheerio';
import { MangaItem } from '../../src/types';
import { stripAdElements } from '../adFilter';
import { createMadaraListScraper, MadaraSeriesItem } from './madaraTheme';
import { fetchWithSsrfGuard } from '../security';
import { sourceCircuitBreaker } from '../circuitBreaker';
import { isSourceUrlOrNameDisabled } from '../sources/sourcesCatalog';

export type MangaReadSeriesItem = MadaraSeriesItem;

const mangaRead = createMadaraListScraper({
  id: 'mangaread',
  name: 'MangaRead',
  baseUrl: 'https://www.mangaread.org',
  inferType: (slug) =>
    slug.includes('manhwa') ? 'manhwa' : slug.includes('manhua') ? 'manhua' : 'manga',
});

export const extractMangaReadSlug = mangaRead.extractSlug;
export const scrapeMangaRead = mangaRead.scrape;
export const searchMangaRead = mangaRead.search;

const UA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Referer': 'https://www.mangaread.org/',
};

export async function fetchMangaReadMetadata(seriesUrl: string): Promise<Partial<MangaItem> | null> {
  if (!sourceCircuitBreaker.canAttempt('mangaread') || isSourceUrlOrNameDisabled('MangaRead', seriesUrl)) {
    return null;
  }

  try {
    const res = await fetchWithSsrfGuard(seriesUrl, {
      headers: UA_HEADERS,
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      sourceCircuitBreaker.recordFailure('mangaread', res.status);
      return null;
    }
    sourceCircuitBreaker.recordSuccess('mangaread');

    const html = await res.text();
    const $ = cheerio.load(html);
    stripAdElements($);

    const title = $('.post-title h1, .entry-title').first().text().trim();
    if (!title) return null;

    const img = $('.summary_image img, .tab-summary img').first();
    let coverImage = img.attr('data-src') || img.attr('data-lazy-src') || img.attr('data-original') || img.attr('src') || '';
    if (coverImage && !coverImage.startsWith('http')) {
      coverImage = `https://www.mangaread.org${coverImage.startsWith('/') ? '' : '/'}${coverImage}`;
    }

    const description = $('.description-summary .summary__content, .manga-about').first().text().trim().replace(/\s+/g, ' ');
    const genres: string[] = [];
    $('.genres-content a').each((_, el) => {
      const g = $(el).text().trim();
      if (g && !genres.includes(g)) genres.push(g);
    });

    const altTitles: string[] = [];
    $('.post-content_item:contains("Alternative") .summary-content').text().split(/[,;/|]/).forEach((t) => {
      const clean = t.trim();
      if (clean && clean !== title && !altTitles.includes(clean)) altTitles.push(clean);
    });

    return {
      title,
      coverImage,
      description,
      genres: genres.length > 0 ? genres : ['Manga'],
      altTitles,
      sourceName: 'MangaRead',
      sourceUrl: seriesUrl,
    };
  } catch {
    return null;
  }
}
