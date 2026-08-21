import * as cheerio from 'cheerio';
import { ResolvedScraperChapter } from './flameComics';

const UA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
};

export interface WeebCentralSeriesItem {
  id: string;
  title: string;
  sourceUrl: string;
  coverImage: string;
  sourceName: string;
  description?: string;
  genres?: string[];
  type?: string;
  rating?: number;
}

/** Extract the WeebCentral series ID token from a full URL or slug path. */
export function extractWeebCentralSeriesId(seriesUrl: string): string | null {
  if (!seriesUrl) return null;
  const match = seriesUrl.match(/\/series\/([A-Z0-9]+)/i);
  if (match) return match[1];
  const parts = seriesUrl.replace(/^https?:\/\/[^/]+/i, '').split('/').filter(Boolean);
  const idx = parts.findIndex((p) => p.toLowerCase() === 'series');
  if (idx !== -1 && parts[idx + 1]) return parts[idx + 1];
  return null;
}

/** Extract the WeebCentral chapter ID token from a chapter URL. */
export function extractWeebCentralChapterId(chapterUrl: string): string | null {
  if (!chapterUrl) return null;
  const match = chapterUrl.match(/\/chapters\/([A-Z0-9]+)/i);
  if (match) return match[1];
  const parts = chapterUrl.replace(/^https?:\/\/[^/]+/i, '').split('/').filter(Boolean);
  const idx = parts.findIndex((p) => p.toLowerCase() === 'chapters');
  if (idx !== -1 && parts[idx + 1]) return parts[idx + 1];
  return null;
}

/** Clean WeebCentral display title (stripping leading "Official" prefixes). */
function cleanWeebCentralTitle(rawTitle: string): string {
  return (rawTitle || '')
    .replace(/^Official\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Scrape popular series listing from Weeb Central. */
export async function scrapeWeebCentral(
  page: number = 1,
  limit: number = 24
): Promise<{ items: WeebCentralSeriesItem[]; totalCount: number }> {
  try {
    const url = `https://weebcentral.com/search/data?sort=Popularity&order=Descending&official=Any&anime=Any&adult=Any&display_mode=Full+Display&page=${page}&limit=${limit}`;
    const res = await fetch(url, {
      headers: UA_HEADERS,
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return { items: [], totalCount: 0 };

    const html = await res.text();
    const $ = cheerio.load(html);
    const items: WeebCentralSeriesItem[] = [];

    $('article').each((_, el) => {
      const a = $(el).find('a[href*="/series/"]').first();
      const href = a.attr('href') || '';
      if (!href) return;

      const rawTitle = a.text().trim();
      const title = cleanWeebCentralTitle(rawTitle);
      if (!title) return;

      const fullUrl = href.startsWith('http') ? href : `https://weebcentral.com${href}`;
      const seriesId = extractWeebCentralSeriesId(fullUrl) || href;
      const cover = $(el).find('img').first().attr('src') || '';
      const desc = $(el).find('p, .description').text().trim().replace(/\s+/g, ' ');

      const genres: string[] = [];
      $(el).find('a[href*="/search?tags="], .tag, .badge').each((__, tagEl) => {
        const tagText = $(tagEl).text().trim();
        if (tagText && !genres.includes(tagText)) genres.push(tagText);
      });

      items.push({
        id: `weebcentral_${seriesId}`,
        title,
        sourceUrl: fullUrl,
        coverImage: cover,
        sourceName: 'Weeb Central',
        description: desc.slice(0, 300),
        genres: genres.length > 0 ? genres : ['Manga'],
        type: 'manga',
      });
    });

    return { items, totalCount: items.length * 100 };
  } catch (err: any) {
    console.warn('[WeebCentral Scraper] scrapePopular error:', err.message);
    return { items: [], totalCount: 0 };
  }
}

/** Search Weeb Central by query string. */
export async function searchWeebCentral(query: string): Promise<WeebCentralSeriesItem[]> {
  try {
    const cleanQ = (query || '').trim();
    if (!cleanQ) return [];

    const url = `https://weebcentral.com/search/data?text=${encodeURIComponent(cleanQ)}&sort=Best+Match&order=Ascending&official=Any&anime=Any&adult=Any&display_mode=Full+Display`;
    const res = await fetch(url, {
      headers: UA_HEADERS,
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return [];

    const html = await res.text();
    const $ = cheerio.load(html);
    const results: WeebCentralSeriesItem[] = [];
    const seen = new Set<string>();

    $('article').each((_, el) => {
      const a = $(el).find('a[href*="/series/"]').first();
      const href = a.attr('href') || '';
      if (!href) return;

      const rawTitle = a.text().trim();
      const title = cleanWeebCentralTitle(rawTitle);
      if (!title) return;

      const fullUrl = href.startsWith('http') ? href : `https://weebcentral.com${href}`;
      const seriesId = extractWeebCentralSeriesId(fullUrl) || href;
      if (seen.has(seriesId)) return;
      seen.add(seriesId);

      const cover = $(el).find('img').first().attr('src') || '';
      const desc = $(el).find('p, .description').text().trim().replace(/\s+/g, ' ');

      const genres: string[] = [];
      $(el).find('a[href*="/search?tags="], .tag, .badge').each((__, tagEl) => {
        const tagText = $(tagEl).text().trim();
        if (tagText && !genres.includes(tagText)) genres.push(tagText);
      });

      results.push({
        id: `weebcentral_${seriesId}`,
        title,
        sourceUrl: fullUrl,
        coverImage: cover,
        sourceName: 'Weeb Central',
        description: desc.slice(0, 300),
        genres: genres.length > 0 ? genres : ['Manga'],
        type: 'manga',
      });
    });

    return results;
  } catch (err: any) {
    console.warn('[WeebCentral Scraper] search error:', err.message);
    return [];
  }
}

/** Fetch detailed metadata for a specific Weeb Central series URL or ID. */
export async function fetchWeebCentralSeriesMetadata(seriesUrlOrSlug: string): Promise<WeebCentralSeriesItem | null> {
  try {
    const seriesId = extractWeebCentralSeriesId(seriesUrlOrSlug);
    const targetUrl = seriesId ? `https://weebcentral.com/series/${seriesId}` : seriesUrlOrSlug;
    const res = await fetch(targetUrl, {
      headers: UA_HEADERS,
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);
    const rawTitle = $('h1').first().text().trim() || $('title').text().replace(/ - Weeb Central.*/i, '').trim();
    const title = cleanWeebCentralTitle(rawTitle);
    if (!title) return null;
    const cover = $('img[src*="/covers/"], main img, article img').first().attr('src') || '';
    const desc = $('p.description, .description, main p').first().text().trim().replace(/\s+/g, ' ');
    const genres: string[] = [];
    $('a[href*="/search?tags="], .tag, .badge').each((_, el) => {
      const tagText = $(el).text().trim();
      if (tagText && !genres.includes(tagText)) genres.push(tagText);
    });
    return {
      id: `weebcentral_${seriesId || 'series'}`,
      title,
      sourceUrl: targetUrl,
      coverImage: cover,
      sourceName: 'Weeb Central',
      description: desc,
      genres: genres.length > 0 ? genres : ['Manga'],
      type: 'manga',
    };
  } catch (err: any) {
    console.warn('[WeebCentral Scraper] fetchSeriesMetadata error:', err.message);
    return null;
  }
}


/** Enumerate all chapters for a Weeb Central series. */
export async function fetchWeebCentralChapterList(seriesUrl: string): Promise<ResolvedScraperChapter[]> {
  try {
    const seriesId = extractWeebCentralSeriesId(seriesUrl);
    if (!seriesId) return [];

    const chListUrl = `https://weebcentral.com/series/${seriesId}/full-chapter-list`;
    const res = await fetch(chListUrl, {
      headers: UA_HEADERS,
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];

    const html = await res.text();
    const $ = cheerio.load(html);
    const chapters: ResolvedScraperChapter[] = [];
    const seen = new Set<string>();

    $('a[href*="/chapters/"]').each((i, el) => {
      const href = $(el).attr('href') || '';
      if (!href) return;
      const fullHref = href.startsWith('http') ? href : `https://weebcentral.com${href}`;
      const chapterId = extractWeebCentralChapterId(fullHref) || href;
      if (seen.has(chapterId)) return;
      seen.add(chapterId);

      const rawText = $(el).find('span').first().text().trim() || $(el).text().trim();
      const numMatch = (rawText + ' ' + href).match(/(?:chapter|ch\.?)\s*(\d+(?:\.\d+)?)/i) || rawText.match(/^(\d+(?:\.\d+)?)/);
      const num = numMatch ? parseFloat(numMatch[1]) : (i + 1);

      chapters.push({
        number: Number.isFinite(num) && num > 0 ? num : (i + 1),
        id: chapterId,
        slug: chapterId,
        title: rawText.split('\n')[0]?.trim() || `Chapter ${num}`,
        url: fullHref,
        pageCount: 16,
      });
    });

    return chapters;
  } catch (err: any) {
    console.warn('[WeebCentral Scraper] fetchChapterList error:', err.message);
    return [];
  }
}

/** Extract panel images for a Weeb Central chapter. */
export async function fetchWeebCentralChapterPages(chapterUrl: string): Promise<string[] | null> {
  try {
    const chapterId = extractWeebCentralChapterId(chapterUrl);
    if (!chapterId) return null;

    // WeebCentral loads chapter images via its dedicated /images endpoint
    const imagesEndpoint = `https://weebcentral.com/chapters/${chapterId}/images?is_prev=False&current_page=1&reading_style=long_strip`;
    const res = await fetch(imagesEndpoint, {
      headers: UA_HEADERS,
      signal: AbortSignal.timeout(15000),
    });

    const pages: string[] = [];
    const seen = new Set<string>();

    if (res.ok) {
      const html = await res.text();
      const $ = cheerio.load(html);
      $('img').each((_, el) => {
        const src = ($(el).attr('src') || $(el).attr('data-src') || '').trim();
        if (src && src.startsWith('http') && !seen.has(src)) {
          seen.add(src);
          pages.push(src);
        }
      });
    }

    // Fallback: If /images endpoint didn't give pages, check the direct chapter page
    if (pages.length === 0) {
      const pageRes = await fetch(`https://weebcentral.com/chapters/${chapterId}`, {
        headers: UA_HEADERS,
        signal: AbortSignal.timeout(15000),
      });
      if (pageRes.ok) {
        const html = await pageRes.text();
        const $ = cheerio.load(html);
        $('section img, #images img, img[src*="temp.compsci88.com"]').each((_, el) => {
          const src = ($(el).attr('src') || $(el).attr('data-src') || '').trim();
          if (src && src.startsWith('http') && !seen.has(src)) {
            seen.add(src);
            pages.push(src);
          }
        });
      }
    }

    return pages.length > 0 ? pages : null;
  } catch (err: any) {
    console.warn('[WeebCentral Scraper] fetchChapterPages error:', err.message);
    return null;
  }
}
