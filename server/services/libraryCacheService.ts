// ============================================================================
// PERSISTENT LIBRARY CACHE SERVICE
// Built on first boot and updated weekly to provide sub-millisecond library lookups
// and persistent metadata caching across all active working sources.
// ============================================================================

import { MangaItem } from '../../src/types';
import { SqliteDb } from '../../sqlite-db';
import {
  getAllSourcesWithExtensions,
  disabledSourceIds,
  isSourceAlive,
  isSeriesFromDisabledSource,
} from '../sources/sourcesCatalog';

export const WEEKLY_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (1 week)
export const LIBRARY_CACHE_VERSION = '1.0.0';

export interface LibraryCacheSnapshot {
  series: MangaItem[];
  totalCount: number;
  genres: Array<{ name: string; count: number }>;
  types: string[];
  sources: Array<{ id: string; name: string; count: number }>;
  builtAt: number;
  updatedAt: number;
  version: string;
}

export const libraryCacheRef: { current: LibraryCacheSnapshot | null } = { current: null };
let weeklySchedulerTimer: NodeJS.Timeout | null = null;
let isRefreshing = false;

/**
 * Builds a complete snapshot of the library index with pre-computed
 * genres, types, sources, and active series data.
 */
export function buildLibraryCacheSnapshot(): LibraryCacheSnapshot {
  const allManga = SqliteDb.getAllManga();
  const activeSources = getAllSourcesWithExtensions().filter(
    (s) => !disabledSourceIds.has(s.id) && isSourceAlive(s.id)
  );

  const activeSeries: MangaItem[] = [];
  const genreCounts = new Map<string, number>();
  const typeSet = new Set<string>();
  const sourceCountMap = new Map<string, number>();

  // Pre-index sources for fast O(1) lookup instead of O(N*M) linear search
  const sourceById = new Map<string, string>();
  const sourceByName = new Map<string, string>();
  const sourceByDomain: Array<{ domain: string; id: string }> = [];

  for (const s of activeSources) {
    const idL = s.id.toLowerCase();
    const nameL = s.name.toLowerCase();
    const domain = s.baseUrl.replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase();
    sourceById.set(idL, s.id);
    sourceByName.set(nameL, s.id);
    if (domain) sourceByDomain.push({ domain, id: s.id });
  }

  for (const m of allManga) {
    if (isSeriesFromDisabledSource(m)) continue;

    activeSeries.push(m);

    // Track types
    if (m.type) {
      typeSet.add(String(m.type).toLowerCase());
    }

    // Track genres
    for (const g of m.genres || []) {
      if (typeof g === 'string' && g.trim()) {
        const norm = g.trim();
        genreCounts.set(norm, (genreCounts.get(norm) || 0) + 1);
      }
    }

    // Fast O(1) match and track source
    const sName = (m.sourceName || '').toLowerCase().trim();
    const sUrl = (m.sourceUrl || '').toLowerCase();
    let matchedId = sourceById.get(sName) || sourceByName.get(sName);

    if (!matchedId && sUrl) {
      for (const d of sourceByDomain) {
        if (sUrl.includes(d.domain)) {
          matchedId = d.id;
          break;
        }
      }
    }

    const srcId = matchedId || (sName ? sName.replace(/[^a-z0-9]/g, '') : 'custom');
    sourceCountMap.set(srcId, (sourceCountMap.get(srcId) || 0) + 1);
  }

  const genres = [...genreCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));

  const types = [...typeSet].sort();

  const sources = activeSources.map((s) => ({
    id: s.id,
    name: s.name,
    count: sourceCountMap.get(s.id) || 0,
  }));

  const now = Date.now();
  return {
    series: activeSeries,
    totalCount: activeSeries.length,
    genres,
    types,
    sources,
    builtAt: libraryCacheRef.current?.builtAt || now,
    updatedAt: now,
    version: LIBRARY_CACHE_VERSION,
  };
}

/**
 * Initializes the persistent library cache on server startup.
 * If cache exists in SQLite, hydrations happen immediately (<1ms).
 * If first boot, builds and persists the cache immediately.
 */
export function initLibraryCache(): void {
  try {
    const saved = SqliteDb.getLibraryCache() as LibraryCacheSnapshot | null;
    if (saved && Array.isArray(saved.series) && saved.series.length > 0) {
      libraryCacheRef.current = saved;
      const ageDays = Math.round(((Date.now() - saved.updatedAt) / (24 * 3600 * 1000)) * 10) / 10;
      console.log(
        `[Library Cache] Loaded persistent cache: ${saved.totalCount} series across ${saved.sources?.length || 0} sources (age: ${ageDays}d).`
      );

      // Check if weekly refresh is due
      if (Date.now() - saved.updatedAt >= WEEKLY_CACHE_TTL_MS) {
        console.log('[Library Cache] Cache is over 7 days old — scheduling weekly background refresh...');
        setTimeout(() => refreshLibraryCache(false), 5000);
      }
    } else {
      // First boot: build initial cache
      const built = buildLibraryCacheSnapshot();
      libraryCacheRef.current = built;
      SqliteDb.setLibraryCache(built);
      console.log(
        `[Library Cache] First boot: built initial persistent library cache with ${built.totalCount} series across ${built.sources.length} sources.`
      );
    }
  } catch (err: any) {
    console.error('[Library Cache] Failed to initialize persistent cache:', err?.message || err);
  }
}

/**
 * Refreshes and persists the library cache snapshot.
 */
export function refreshLibraryCache(force = false): LibraryCacheSnapshot {
  if (isRefreshing && !force) {
    return libraryCacheRef.current || buildLibraryCacheSnapshot();
  }

  isRefreshing = true;
  try {
    const fresh = buildLibraryCacheSnapshot();
    libraryCacheRef.current = fresh;
    SqliteDb.setLibraryCache(fresh);
    console.log(
      `[Library Cache] Weekly library cache updated: ${fresh.totalCount} series indexed (next update in 7 days).`
    );
    return fresh;
  } catch (err: any) {
    console.error('[Library Cache] Refresh error:', err?.message || err);
    return libraryCacheRef.current || buildLibraryCacheSnapshot();
  } finally {
    isRefreshing = false;
  }
}

/**
 * Starts the weekly background scheduler that verifies and refreshes
 * the persistent library cache every 7 days.
 */
export function startWeeklyLibraryCacheScheduler(checkIntervalHours = 1): void {
  if (weeklySchedulerTimer) clearInterval(weeklySchedulerTimer);

  weeklySchedulerTimer = setInterval(() => {
    try {
      const cur = libraryCacheRef.current;
      if (!cur || Date.now() - cur.updatedAt >= WEEKLY_CACHE_TTL_MS) {
        console.log('[Library Cache Scheduler] Weekly update trigger: rebuilding persistent library cache...');
        refreshLibraryCache(false);
      }
    } catch (err: any) {
      console.error('[Library Cache Scheduler] Error in weekly check:', err?.message || err);
    }
  }, checkIntervalHours * 60 * 60 * 1000);

  console.log(`[Library Cache Scheduler] Initialized weekly cache update scheduler (check interval: ${checkIntervalHours}h, TTL: 7d).`);
}

/**
 * Returns current health and timing metadata about the persistent library cache.
 */
export function getLibraryCacheStatus() {
  const cur = libraryCacheRef.current;
  const now = Date.now();
  const updatedAt = cur?.updatedAt || now;
  const ageMs = now - updatedAt;
  const ageDays = Math.round((ageMs / (24 * 3600 * 1000)) * 10) / 10;
  const nextUpdateDueAt = new Date(updatedAt + WEEKLY_CACHE_TTL_MS).toISOString();
  const isWeeklyUpdateDue = ageMs >= WEEKLY_CACHE_TTL_MS;

  return {
    isCached: !!cur,
    totalSeries: cur?.totalCount || 0,
    builtAt: cur?.builtAt ? new Date(cur.builtAt).toISOString() : null,
    updatedAt: new Date(updatedAt).toISOString(),
    ageDays,
    nextUpdateDueAt,
    isWeeklyUpdateDue,
    sourcesCount: cur?.sources?.length || 0,
    genresCount: cur?.genres?.length || 0,
    version: cur?.version || LIBRARY_CACHE_VERSION,
  };
}

/**
 * Quick notifier called whenever a library item is added or updated,
 * keeping the in-memory cache synchronized in real-time.
 */
export function notifyLibraryItemChanged(item?: Partial<MangaItem>): void {
  if (!libraryCacheRef.current) return;
  try {
    if (item && item.id) {
      const idx = libraryCacheRef.current.series.findIndex((m) => m.id === item.id);
      if (idx !== -1) {
        libraryCacheRef.current.series[idx] = { ...libraryCacheRef.current.series[idx], ...item } as MangaItem;
      } else if (item.title) {
        libraryCacheRef.current.series.unshift(item as MangaItem);
        libraryCacheRef.current.totalCount = libraryCacheRef.current.series.length;
      }
    }
  } catch {}
}
