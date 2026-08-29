// ============================================================================
// Source Discovery Engine & Kotatsu Image Engine Cache Instance
// ============================================================================

import { MangaItem } from '../../../src/types';
import { SqliteDb } from '../../../sqlite-db';
import { syncAddOrUpdateManga } from '../../appState';
import { disabledSourceIds, isSourceAlive, isSourceUrlOrNameDisabled } from '../../sources/sourcesCatalog';
import { calculateStringSimilarity } from '../metadataService';
import { searchWeebCentral } from '../../scrapers/weebCentral';
import { ASURA_API_HEADERS } from '../../scrapers/asuraScans';
import { fetchFlameSeriesContext } from '../../scrapers/flameComics';
import { extractLiveDomainChapterPages } from './chapterParser';

export interface KotatsuPageListCacheEntry {
  pages: string[];
  timestamp: number;
}

export class KotatsuImageEngine {
  private pageListCache = new Map<string, KotatsuPageListCacheEntry>();
  private maxCacheAgeMs = 1000 * 60 * 60 * 24; // 24 Hours Cache

  public async getChapterPages(
    targetUrl: string,
    domainId: string,
    chapterNumber: number = 1
  ): Promise<string[] | null> {
    const cacheKey = `${domainId}:${targetUrl}:${chapterNumber}`;
    const cached = this.pageListCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.maxCacheAgeMs) {
      console.log(`[Kotatsu Image Engine] Memory Cache Hit for ${cacheKey} (${cached.pages.length} pages)`);
      return cached.pages;
    }

    try {
      const sqliteCached = SqliteDb.getCachedChapterPages(domainId, chapterNumber, targetUrl);
      if (sqliteCached && sqliteCached.pages.length > 0) {
        console.log(`[Kotatsu Image Engine] SQLite Cache Hit for ${cacheKey} (${sqliteCached.pages.length} pages)`);
        this.setMemoryCache(cacheKey, { pages: sqliteCached.pages, timestamp: Date.now() });
        return sqliteCached.pages;
      }
    } catch {}

    const pages = await extractLiveDomainChapterPages(targetUrl, domainId, chapterNumber);
    if (pages && pages.length > 0) {
      this.setMemoryCache(cacheKey, { pages, timestamp: Date.now() });
      try {
        SqliteDb.setCachedChapterPages(domainId, chapterNumber, targetUrl, pages, this.maxCacheAgeMs);
      } catch {}
    }
    return pages;
  }

  private setMemoryCache(key: string, entry: KotatsuPageListCacheEntry) {
    if (this.pageListCache.size >= 300) {
      const oldest = this.pageListCache.keys().next().value;
      if (oldest) this.pageListCache.delete(oldest);
    }
    this.pageListCache.set(key, entry);
  }

  public clearCache() {
    this.pageListCache.clear();
  }

  public size(): number {
    return this.pageListCache.size;
  }
}

export const kotatsuImageEngine = new KotatsuImageEngine();

export async function searchLiveSourcesForSeries(
  title: string,
  altTitles: string[] = []
): Promise<{ sourceName: string; sourceUrl: string; confidence: number }[]> {
  const discovered: { sourceName: string; sourceUrl: string; confidence: number }[] = [];
  const seenUrls = new Set<string>();

  const candidateQueries = Array.from(
    new Set([title, ...(altTitles || [])])
  )
    .map((t) => (t ? t.replace(/\s*\([^)]*\)/g, '').replace(/uncensored|reboot|hd|season \d+|ch \d+/gi, '').trim() : ''))
    .filter((t) => t.length >= 2 && !/^[a-z0-9-]+\.(com|org|net|xyz|me|top|io|cc|co|info|biz)$/i.test(t));

  for (const q of candidateQueries.slice(0, 3)) {
    if (!disabledSourceIds.has('weebcentral') && isSourceAlive('weebcentral')) {
      try {
        const weebList = await searchWeebCentral(q);
        for (const s of weebList) {
          const sTitle = s.title || '';
          const sim = calculateStringSimilarity(q, sTitle);
          if (sim >= 55 && s.sourceUrl) {
            if (!seenUrls.has(s.sourceUrl)) {
              seenUrls.add(s.sourceUrl);
              discovered.push({ sourceName: 'Weeb Central', sourceUrl: s.sourceUrl, confidence: sim });
            }
          }
        }
      } catch {}
    }

    if (!disabledSourceIds.has('asurascans') && isSourceAlive('asurascans')) {
      try {
        const asuraRes = await fetch(`https://api.asurascans.com/api/series?search=${encodeURIComponent(q)}`, {
          headers: ASURA_API_HEADERS,
          signal: AbortSignal.timeout(6000),
        });
        if (asuraRes.ok) {
          const asuraJson = await asuraRes.json();
          const list = Array.isArray(asuraJson?.data) ? asuraJson.data : [];
          for (const s of list) {
            const sTitle = s.title || '';
            const sim = calculateStringSimilarity(q, sTitle);
            if (sim >= 55) {
              const slug = s.slug || s.id || '';
              const pubPath = s.public_url || `/comics/${slug}`;
              const sUrl = `https://asurascans.com${pubPath}`;
              if (!seenUrls.has(sUrl)) {
                seenUrls.add(sUrl);
                discovered.push({ sourceName: 'Asura Scans', sourceUrl: sUrl, confidence: sim });
              }
            }
          }
        }
      } catch {}
    }

    if (!disabledSourceIds.has('flamecomics') && isSourceAlive('flamecomics')) {
      try {
        const flameSlug = q.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const flameCtx = await fetchFlameSeriesContext(`https://flamecomics.xyz/series/${flameSlug}`);
        if (flameCtx && flameCtx.matchedSeries?.title) {
          const sim = calculateStringSimilarity(q, flameCtx.matchedSeries.title);
          if (sim >= 55) {
            const sUrl = `https://flamecomics.xyz/series/${flameCtx.seriesId || flameSlug}`;
            if (!seenUrls.has(sUrl)) {
              seenUrls.add(sUrl);
              discovered.push({ sourceName: 'Flame Comics', sourceUrl: sUrl, confidence: sim });
            }
          }
        }
      } catch {}
    }

    if (discovered.length >= 3) break;
  }

  discovered.sort((a, b) => b.confidence - a.confidence);
  return discovered;
}

export async function autoDiscoverLiveSourceForManga(
  manga: MangaItem
): Promise<{ sourceName: string; sourceUrl: string } | null> {
  if (Array.isArray(manga.availableSources) && manga.availableSources.length > 0) {
    const existingLive = manga.availableSources.find(
      (s) => s && s.sourceUrl && s.sourceUrl.startsWith('http') && !s.sourceUrl.toLowerCase().includes('mangadex.org') && !isSourceUrlOrNameDisabled(s.sourceName, s.sourceUrl)
    );
    if (existingLive) {
      if (!manga.sourceUrl || manga.sourceUrl.toLowerCase().includes('mangadex.org') || isSourceUrlOrNameDisabled(manga.sourceName, manga.sourceUrl)) {
        manga.sourceUrl = existingLive.sourceUrl;
        manga.sourceName = existingLive.sourceName || manga.sourceName;
        syncAddOrUpdateManga(manga);
      }
      return existingLive;
    }
  }

  const results = await searchLiveSourcesForSeries(manga.title, manga.altTitles);
  if (results.length === 0) return null;

  const best = results[0];
  if (!Array.isArray(manga.availableSources)) manga.availableSources = [];

  for (const r of results) {
    if (!manga.availableSources.some((s) => s.sourceUrl === r.sourceUrl)) {
      manga.availableSources.push({ sourceName: r.sourceName, sourceUrl: r.sourceUrl });
    }
  }

  if (!manga.sourceUrl || manga.sourceUrl.toLowerCase().includes('mangadex.org')) {
    manga.sourceUrl = best.sourceUrl;
    manga.sourceName = best.sourceName;
  }

  manga.lastUpdated = new Date().toISOString();
  syncAddOrUpdateManga(manga);

  console.log(`[Live Source Discovery] Auto-linked live source "${best.sourceName}" (${best.sourceUrl}) for "${manga.title}"`);
  return best;
}
