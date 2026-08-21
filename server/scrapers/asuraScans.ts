import { ResolvedScraperChapter } from './flameComics';

export const ASURA_API_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Origin': 'https://asurascans.com',
  'Referer': 'https://asurascans.com/',
};

export const ASURA_SLUG_TOKEN_RX = /-[0-9a-f]{8}$/i;

export interface AsuraSeriesMetadata {
  title?: string;
  coverImage?: string;
  description?: string;
  rating?: number;
  latestChapter?: number;
  altTitles?: string[];
  genres?: string[];
}

export async function fetchAsuraSeriesMetadata(slugOrUrl: string): Promise<AsuraSeriesMetadata | null> {
  let slug = slugOrUrl;
  if (slug.includes('/')) {
    const parts = slug.split('/').filter(Boolean);
    const idx = parts.findIndex((p) => p === 'series' || p === 'manga');
    if (idx !== -1 && parts[idx + 1]) {
      slug = parts[idx + 1];
    } else {
      slug = parts[parts.length - 1] || '';
    }
  }

  if (!slug) return null;
  const cleanSlug = slug.replace(ASURA_SLUG_TOKEN_RX, '') || slug;
  const slugsToTry = Array.from(new Set([cleanSlug, slug]));

  for (const s of slugsToTry) {
    try {
      const res = await fetch(`https://api.asurascans.com/api/series/${s}`, {
        headers: ASURA_API_HEADERS,
        signal: AbortSignal.timeout(12000),
      });

      if (res.ok) {
        const json = await res.json();
        const series = json.series || {};
        const metadata: AsuraSeriesMetadata = {};

        if (series.title) metadata.title = series.title;
        if (series.cover) metadata.coverImage = series.cover;
        if (series.description) metadata.description = series.description;
        if (series.rating) metadata.rating = Math.round(Number(series.rating) * 10) / 10;
        if (series.chapter_count) metadata.latestChapter = Number(series.chapter_count);
        if (series.alt_titles && Array.isArray(series.alt_titles)) {
          metadata.altTitles = series.alt_titles.filter(Boolean);
        }
        if (series.genres && Array.isArray(series.genres)) {
          metadata.genres = series.genres
            .map((g: any) => (typeof g === 'string' ? g : g.name))
            .filter(Boolean);
        }
        return metadata;
      }
    } catch {
      // Continue to next slug candidate
    }
  }
  return null;
}

export async function fetchAsuraChapterList(targetUrl: string): Promise<{ chapters: ResolvedScraperChapter[]; matchedSlug: string | null }> {
  let rawSlug = '';
  if (targetUrl.includes('/series/')) {
    const parts = targetUrl.split('/');
    const idx = parts.indexOf('series');
    if (idx !== -1 && parts[idx + 1]) {
      rawSlug = parts[idx + 1];
    }
  }
  if (!rawSlug) return { chapters: [], matchedSlug: null };

  const cleaned = rawSlug.replace(ASURA_SLUG_TOKEN_RX, '') || rawSlug;
  const slugsToTry = Array.from(new Set([cleaned, rawSlug]));

  for (const s of slugsToTry) {
    try {
      const listRes = await fetch(`https://api.asurascans.com/api/series/${s}/chapters`, {
        headers: ASURA_API_HEADERS,
        signal: AbortSignal.timeout(15000),
      });
      if (!listRes.ok) continue;

      const listData = await listRes.json();
      if (listData && Array.isArray(listData.data) && listData.data.length > 0) {
        const chapters: ResolvedScraperChapter[] = listData.data
          .map((c: any) => ({
            number: Number(c.number ?? 0),
            id: String(c.id),
            slug: String(c.slug || ''),
            title: c.title ? `Chapter ${c.number} - ${c.title}` : `Chapter ${c.number}`,
            url: c.slug ? `https://asurascans.com/series/${s}/chapters/${c.slug}` : '',
            pageCount: Number(c.page_count) || 12,
          }))
          .filter((c: ResolvedScraperChapter) => c.number > 0 && c.slug);
        if (chapters.length > 0) return { chapters, matchedSlug: s };
      }
    } catch {
      // Continue to next candidate
    }
  }
  return { chapters: [], matchedSlug: null };
}
