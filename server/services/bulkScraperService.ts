// ============================================================================
// BULK SCRAPER & LIBRARY INGESTION ENGINE
// Crawls multi-page catalogs across active sources and merges them into the library
// ============================================================================

import { MangaItem } from '../../src/types';
import { SqliteDb } from '../../sqlite-db';
import {
  mangaDatabase,
  saveDatabaseToDisk,
  syncAddOrUpdateManga,
} from '../appState';
import {
  SourceDefinition,
  getAllSourcesWithExtensions,
  disabledSourceIds,
  isSourceAlive,
  isMetadataOnlySource,
  getSourceById,
} from '../sources/sourcesCatalog';
import {
  getSourcePopularSeries,
  getEligibleExploreSources,
} from './exploreService';
import { enrichWithMangaDexMetadata } from './metadataService';
import { isAdSeries } from '../adFilter';

export interface BulkScrapeOptions {
  sourceIds?: string[];
  maxPagesPerSource?: number;
  enrichMetadata?: boolean;
  limitPerPage?: number;
}

export interface BulkScrapeProgress {
  status: 'idle' | 'running' | 'completed' | 'stopped' | 'error';
  totalSources: number;
  completedSources: number;
  currentSourceId: string | null;
  currentSourceName: string | null;
  currentPage: number;
  maxPagesPerSource: number;
  seriesScraped: number;
  seriesMerged: number;
  seriesNew: number;
  errors: string[];
  startedAt: number | null;
  finishedAt: number | null;
}

class BulkScraperService {
  private progress: BulkScrapeProgress = {
    status: 'idle',
    totalSources: 0,
    completedSources: 0,
    currentSourceId: null,
    currentSourceName: null,
    currentPage: 0,
    maxPagesPerSource: 5,
    seriesScraped: 0,
    seriesMerged: 0,
    seriesNew: 0,
    errors: [],
    startedAt: null,
    finishedAt: null,
  };

  private abortController: AbortController | null = null;
  private isRunning = false;

  public getProgress(): BulkScrapeProgress {
    return { ...this.progress };
  }

  public stop(): boolean {
    if (!this.isRunning) return false;
    if (this.abortController) {
      this.abortController.abort();
    }
    this.progress.status = 'stopped';
    this.progress.finishedAt = Date.now();
    this.isRunning = false;
    return true;
  }

  public async start(options: BulkScrapeOptions = {}): Promise<BulkScrapeProgress> {
    if (this.isRunning) {
      return this.getProgress();
    }

    this.isRunning = true;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    const maxPages = Math.max(1, Math.min(50, options.maxPagesPerSource || 5));
    const limitPerPage = Math.max(12, Math.min(60, options.limitPerPage || 30));
    const enrich = options.enrichMetadata !== false;

    // Resolve target sources
    let targetSources: SourceDefinition[] = [];
    if (Array.isArray(options.sourceIds) && options.sourceIds.length > 0) {
      for (const id of options.sourceIds) {
        const def = getSourceById(id);
        if (def && !isMetadataOnlySource(def.id) && isSourceAlive(def.id)) {
          targetSources.push(def);
        }
      }
    } else {
      targetSources = getEligibleExploreSources();
    }

    this.progress = {
      status: 'running',
      totalSources: targetSources.length,
      completedSources: 0,
      currentSourceId: null,
      currentSourceName: null,
      currentPage: 0,
      maxPagesPerSource: maxPages,
      seriesScraped: 0,
      seriesMerged: 0,
      seriesNew: 0,
      errors: [],
      startedAt: Date.now(),
      finishedAt: null,
    };

    // Run scraping asynchronously in background
    (async () => {
      try {
        for (let i = 0; i < targetSources.length; i++) {
          if (signal.aborted) break;

          const source = targetSources[i];
          this.progress.currentSourceId = source.id;
          this.progress.currentSourceName = source.name;

          const sourceItems: Partial<MangaItem>[] = [];

          for (let page = 1; page <= maxPages; page++) {
            if (signal.aborted) break;
            this.progress.currentPage = page;

            try {
              const res = await getSourcePopularSeries(source, page, limitPerPage);
              if (!res.items || res.items.length === 0) {
                // No more pages available from this source
                break;
              }

              for (const it of res.items) {
                if (it && it.title && !isAdSeries(it.title, it.sourceUrl, it.description)) {
                  sourceItems.push(it);
                }
              }

              this.progress.seriesScraped += res.items.length;

              // Small throttle between pages to avoid IP blocking
              await new Promise((r) => setTimeout(r, 800));
            } catch (err: any) {
              const errMsg = `[${source.name} p.${page}] ${err?.message || err}`;
              this.progress.errors.push(errMsg);
              if (this.progress.errors.length > 30) this.progress.errors.shift();
              break;
            }
          }

          // Metadata enrichment if requested
          let finalItems = sourceItems;
          if (enrich && sourceItems.length > 0) {
            try {
              finalItems = await enrichWithMangaDexMetadata(sourceItems);
            } catch {
              finalItems = sourceItems;
            }
          }

          // Merge into Library
          if (finalItems.length > 0) {
            const { mergedCount, newCount } = this.mergeItemsIntoLibrary(finalItems);
            this.progress.seriesMerged += mergedCount;
            this.progress.seriesNew += newCount;
            saveDatabaseToDisk();
          }

          this.progress.completedSources++;
          // Inter-source spacing
          await new Promise((r) => setTimeout(r, 1200));
        }

        if (!signal.aborted) {
          this.progress.status = 'completed';
        }
      } catch (fatalErr: any) {
        this.progress.status = 'error';
        this.progress.errors.push(`Fatal bulk error: ${fatalErr?.message || fatalErr}`);
      } finally {
        this.progress.finishedAt = Date.now();
        this.progress.currentSourceId = null;
        this.progress.currentSourceName = null;
        this.isRunning = false;
        this.abortController = null;
        saveDatabaseToDisk();
      }
    })();

    return this.getProgress();
  }

  private mergeItemsIntoLibrary(incomingItems: Partial<MangaItem>[]): {
    mergedCount: number;
    newCount: number;
  } {
    let mergedCount = 0;
    let newCount = 0;

    // Build O(1) title lookup map
    const titleMap = new Map<string, MangaItem>();
    for (const m of mangaDatabase) {
      const norm = m.title.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (norm) titleMap.set(norm, m);
      for (const alt of m.altTitles || []) {
        const altNorm = alt.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (altNorm && !titleMap.has(altNorm)) titleMap.set(altNorm, m);
      }
    }

    for (const item of incomingItems) {
      if (!item.title) continue;
      const normTitle = item.title.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!normTitle || normTitle.length < 2) continue;

      const exactMatch = titleMap.get(normTitle);

      if (exactMatch) {
        if (!exactMatch.availableSources) exactMatch.availableSources = [];
        if (item.sourceName && item.sourceUrl) {
          const exists = exactMatch.availableSources.some(
            (s) => s.sourceName === item.sourceName || s.sourceUrl === item.sourceUrl
          );
          if (!exists) {
            exactMatch.availableSources.push({
              sourceName: item.sourceName,
              sourceUrl: item.sourceUrl,
            });
          }
        }
        if (!exactMatch.coverImage && item.coverImage) exactMatch.coverImage = item.coverImage;
        if ((!exactMatch.description || exactMatch.description.length < 30) && item.description) {
          exactMatch.description = item.description;
        }
        if (item.latestChapter && item.latestChapter > (exactMatch.latestChapter || 0)) {
          exactMatch.latestChapter = item.latestChapter;
        }
        if (item.genres && item.genres.length > 0) {
          exactMatch.genres = Array.from(new Set([...(exactMatch.genres || []), ...item.genres]));
        }
        if (item.altTitles && item.altTitles.length > 0) {
          exactMatch.altTitles = Array.from(new Set([...(exactMatch.altTitles || []), ...item.altTitles]));
        }
        syncAddOrUpdateManga(exactMatch);
        mergedCount++;
      } else {
        const newManga: MangaItem = {
          id: item.id || `m_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
          title: item.title,
          sourceUrl: item.sourceUrl || '',
          coverImage: item.coverImage || '',
          sourceName: item.sourceName || 'Unknown Source',
          description: item.description || '',
          genres: item.genres && item.genres.length > 0 ? item.genres : ['Action'],
          latestChapter: item.latestChapter || 1,
          type: (item.type as any) || 'manhwa',
          rating: item.rating || 9.0,
          status: 'ongoing',
          altTitles: item.altTitles || [],
          availableSources: item.sourceName && item.sourceUrl ? [{ sourceName: item.sourceName, sourceUrl: item.sourceUrl }] : [],
          unreadCount: item.latestChapter || 1,
        };

        syncAddOrUpdateManga(newManga);
        titleMap.set(normTitle, newManga);
        newCount++;
      }
    }

    return { mergedCount, newCount };
  }
}

export const bulkScraperService = new BulkScraperService();
