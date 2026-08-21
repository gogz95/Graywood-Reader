const UA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
};

export interface FlameSeriesContext {
  buildId: string;
  seriesId: string;
  matchedSeries?: any;
  seriesData?: any;
  chapters: any[];
}

export interface ResolvedScraperChapter {
  number: number;
  id: string;
  slug: string;
  title: string;
  url: string;
  pageCount: number;
}

export async function fetchFlameComicsBuildId(): Promise<string | null> {
  try {
    const homeRes = await fetch('https://flamecomics.xyz/', {
      headers: UA_HEADERS,
      signal: AbortSignal.timeout(12000),
    });
    if (!homeRes.ok) return null;
    const homeHtml = await homeRes.text();
    const buildIdMatch = homeHtml.match(/\/_next\/static\/([^/]+)\/_buildManifest\.js/);
    return buildIdMatch ? buildIdMatch[1] : null;
  } catch {
    return null;
  }
}

export async function fetchFlameSeriesContext(targetUrl: string): Promise<FlameSeriesContext | null> {
  try {
    const buildId = await fetchFlameComicsBuildId();
    if (!buildId) return null;

    const browseRes = await fetch(`https://flamecomics.xyz/_next/data/${buildId}/browse.json`, {
      headers: UA_HEADERS,
      signal: AbortSignal.timeout(12000),
    });
    if (!browseRes.ok) return null;
    const browseJson = await browseRes.json();
    const seriesList = browseJson.pageProps?.series || [];
    const rawSlug = targetUrl.split('/').pop() || '';

    const matchedSeries = seriesList.find((s: any) => {
      const sId = String(s.series_id || s.id);
      const sTitle = (s.title?.toLowerCase().replace(/[^a-z0-9]/g, '') || '');
      const targetNorm = rawSlug.toLowerCase().replace(/[^a-z0-9]/g, '');
      // 1) Exact numeric series id
      if (sId === rawSlug) return true;
      // 2) Exact normalized-title equality
      if (targetNorm && sTitle === targetNorm) return true;
      // 3) Substring fallback for long slugs
      return targetNorm.length >= 5 && !!sTitle && sTitle.includes(targetNorm);
    });

    if (!matchedSeries) return null;
    const seriesId = String(matchedSeries.series_id || matchedSeries.id);

    const seriesRes = await fetch(`https://flamecomics.xyz/_next/data/${buildId}/series/${seriesId}.json`, {
      headers: UA_HEADERS,
      signal: AbortSignal.timeout(12000),
    });
    if (!seriesRes.ok) return null;
    const seriesData = await seriesRes.json();
    const chapters = seriesData.pageProps?.chapters || [];

    return { buildId, seriesId, matchedSeries, seriesData, chapters };
  } catch {
    return null;
  }
}

export function mapFlameChapters(rawChapters: any[], seriesId: string): ResolvedScraperChapter[] {
  return rawChapters
    .map((c: any) => {
      const num = Number(c.chapter ?? c.number ?? parseFloat((c.title || '').match(/\d+(?:\.\d+)?/)?.[0] ?? '0'));
      const token = String(c.token || c.chapter_id || c.id || '');
      return {
        number: Number.isFinite(num) ? num : 0,
        id: token,
        slug: token,
        title: c.title ? `Chapter ${num} - ${c.title}` : `Chapter ${num}`,
        url: token ? `https://flamecomics.xyz/series/${seriesId}/${token}` : '',
        pageCount: Number(c.pages || c.page_count) || 12,
      };
    })
    .filter((c: ResolvedScraperChapter) => c.number > 0 && c.slug);
}

export async function fetchFlameChapterList(targetUrl: string): Promise<ResolvedScraperChapter[]> {
  const ctx = await fetchFlameSeriesContext(targetUrl);
  if (!ctx) return [];
  return mapFlameChapters(ctx.chapters, ctx.seriesId);
}
