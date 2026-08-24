// ============================================================================
// DEMONIC SCANS SCRAPER (custom PHP theme — rebuilt 2026-08)
//
// Current demonicscans.org layout:
//   new series list : /newmangalist.php  (paged via ?list=N, NOT ?page=N)
//                     cards: div.updates-element > .thumb a[href^="/manga/"]
//                     latest chapter: chaptered.php?manga={id}&chapter={n}
//   search          : /advanced.php?search={query}
//                     cards: #advanced-content .advanced-element a[title]
//   series          : /manga/{Slug}
// ============================================================================

import * as cheerio from 'cheerio';
import { stripAdElements } from '../adFilter';

const BASE_URL = 'https://demonicscans.org';

const UA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Referer': `${BASE_URL}/`,
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
  const match = url.match(/\/(?:title|manga|series)\/([^/?#]+)/i);
  if (match) return match[1].replace(/\/+$/, '');
  const parts = url.split('/').filter(Boolean);
  return parts[parts.length - 1] || '';
}

function resolveCover(raw: string): string {
  let cover = (raw || '').trim();
  if (!cover) return '';
  if (!cover.startsWith('http')) {
    cover = `${BASE_URL}${cover.startsWith('/') ? '' : '/'}${cover}`;
  }
  // Thumbnail filenames contain spaces — browsers encode them implicitly,
  // but raw fetch/proxy clients need a valid URI.
  return encodeURI(cover);
}

/** Parse `div.updates-element` cards from the new-manga listing. */
function parseUpdatesCards($: cheerio.CheerioAPI): DemonicScansSeriesItem[] {
  const items: DemonicScansSeriesItem[] = [];
  const seen = new Set<string>();

  $('.updates-element').each((_, el) => {
    const card = $(el);
    const a = card.find('a[href^="/manga/"], a[href*="/manga/"]').first();
    const href = a.attr('href') || '';
    if (!href) return;

    const fullUrl = href.startsWith('http') ? href : `${BASE_URL}${href.startsWith('/') ? '' : '/'}${href}`;
    const slug = extractDemonicScansSlug(fullUrl);
    if (!slug || seen.has(slug)) return;

    const img = card.find('img').first();
    const title = (
      img.attr('title') ||
      img.attr('alt') ||
      a.attr('title') ||
      card.find('.updates-element-info a, .title, h3, h4').first().text() ||
      a.text()
    ).trim();
    if (!title) return;
    seen.add(slug);

    // Highest chaptered.php?...&chapter=N link on the card = latest chapter.
    let latestChapter: number | undefined;
    card.find('a[href*="chaptered.php"]').each((__, chEl) => {
      const m = ($(chEl).attr('href') || '').match(/chapter=(\d+(?:\.\d+)?)/i);
      if (m) {
        const n = parseFloat(m[1]);
        if (Number.isFinite(n) && n > 0 && (latestChapter === undefined || n > latestChapter)) {
          latestChapter = n;
        }
      }
    });

    // Honest metadata only — no fabricated ratings, genres, or descriptions.
    items.push({
      id: `demonicscans_${slug}`,
      title: title.replace(/\s+/g, ' ').trim(),
      sourceUrl: fullUrl,
      coverImage: resolveCover(img.attr('src') || ''),
      sourceName: 'Demonic Scans',
      ...(latestChapter !== undefined ? { latestChapter } : {}),
    });
  });

  return items;
}


/** Parse `.advanced-element` cards from the advanced search page. */
function parseAdvancedSearchCards($: cheerio.CheerioAPI): DemonicScansSeriesItem[] {
  const items: DemonicScansSeriesItem[] = [];
  const seen = new Set<string>();

  $('.advanced-element, #advanced-content .advanced-element').each((_, el) => {
    const card = $(el);
    const a = card.find('a[href*="/manga/"]').first();
    const href = a.attr('href') || '';
    if (!href) return;

    const fullUrl = href.startsWith('http') ? href : `${BASE_URL}${href.startsWith('/') ? '' : '/'}${href}`;
    const slug = extractDemonicScansSlug(fullUrl);
    if (!slug || seen.has(slug)) return;

    const img = card.find('img').first();
    const title = (a.attr('title') || img.attr('title') || img.attr('alt') || a.text()).trim();
    if (!title) return;
    seen.add(slug);

    items.push({
      id: `demonicscans_${slug}`,
      title: title.replace(/\s+/g, ' ').trim(),
      sourceUrl: fullUrl,
      coverImage: resolveCover(img.attr('src') || ''),
      sourceName: 'Demonic Scans',
    });
  });

  return items;
}

export async function scrapeDemonicScans(
  page: number = 1,
  limit: number = 24,
): Promise<{ items: DemonicScansSeriesItem[]; totalCount: number }> {
  try {
    // The listing is paged with ?list=N — ?page=N is silently ignored.
    const url = page <= 1
      ? `${BASE_URL}/newmangalist.php`
      : `${BASE_URL}/newmangalist.php?list=${page}`;

    const res = await fetch(url, { headers: UA_HEADERS, signal: AbortSignal.timeout(12000) });
    if (!res.ok) return { items: [], totalCount: 0 };

    const html = await res.text();
    const $ = cheerio.load(html);
    stripAdElements($);
    const items = parseUpdatesCards($);

    // Pagination widget lists the highest ?list=N link.
    let lastPage = 0;
    $('a[href*="newmangalist.php?list="]').each((_, el) => {
      const m = ($(el).attr('href') || '').match(/list=(\d+)/);
      if (m) lastPage = Math.max(lastPage, parseInt(m[1], 10));
    });
    const totalCount = lastPage > 0 && items.length > 0
      ? Math.max(lastPage * items.length, items.length)
      : items.length;

    return { items: items.slice(0, limit), totalCount };
  } catch (e) {
    console.error('[Scraper] Demonic Scans failed:', (e as Error).message);
    return { items: [], totalCount: 0 };
  }
}

export async function searchDemonicScans(query: string, limit: number = 24): Promise<DemonicScansSeriesItem[]> {
  try {
    const cleanQ = encodeURIComponent(query.trim());
    if (!cleanQ) return [];
    const url = `${BASE_URL}/advanced.php?search=${cleanQ}`;
    const res = await fetch(url, { headers: UA_HEADERS, signal: AbortSignal.timeout(12000) });
    if (!res.ok) return [];

    const html = await res.text();
    const $ = cheerio.load(html);
    stripAdElements($);
    return parseAdvancedSearchCards($).slice(0, limit);
  } catch {
    return [];
  }
}
