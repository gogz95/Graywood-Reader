// ============================================================================
// Explore Catalog Warm-up, Multi-Source Aggregation & Scheduled Refresher
// ============================================================================

import { MangaItem } from '../../../src/types';
import { SqliteDb } from '../../../sqlite-db';
import { appSettings, saveDatabaseToDisk, syncConfig } from '../../appState';
import {
  KOTATSU_SOURCES,
  disabledSourceIds,
  isSourceAlive,
  isMetadataOnlySource,
  getAllSourcesWithExtensions,
} from '../../sources/sourcesCatalog';
import { fetchWithChallengeBypass } from '../../captchaSolver';
import { sourceCookieJar, updateSourceHealth } from '../sourceHealthService';
import { sourceCircuitBreaker } from '../../circuitBreaker';
import {
  parseUniversalCatalogCards,
  scrapeAsuraScans,
  scrapeFlameComics,
  scrapeManhwa18,
  searchManhwa18,
  generateSourceScrapeId,
  SCRAPER_UA,
} from './catalogParser';
import { scrapeWeebCentral, searchWeebCentral } from '../../scrapers/weebCentral';
import { scrapeMangaRead, searchMangaRead } from '../../scrapers/mangaRead';
import { scrapeManhuaPlus, searchManhuaPlus } from '../../scrapers/manhuaPlus';
import { scrapeDemonicScans, searchDemonicScans } from '../../scrapers/demonicScans';
import { scrapeAquaManga } from '../../scrapers/aquaManga';
import { scrapeKunManga } from '../../scrapers/kunManga';

export interface ExploreBufferCacheEntry {
  items: any[];
  sourceIds: string[];
  builtAt: number;
  expiresAt: number;
  lastError: string | null;
}

let memoryExploreBuffer: ExploreBufferCacheEntry | null = null;
const EXPLORE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export function getExploreBuffer(): ExploreBufferCacheEntry | null {
  if (memoryExploreBuffer && memoryExploreBuffer.expiresAt > Date.now()) {
    return memoryExploreBuffer;
  }

  try {
    const dbBuffer = SqliteDb.getExploreBuffer();
    if (dbBuffer && Array.isArray(dbBuffer.items) && dbBuffer.items.length > 0) {
      memoryExploreBuffer = {
        items: dbBuffer.items,
        sourceIds: dbBuffer.sourceIds || [],
        builtAt: Number(dbBuffer.builtAt) || Date.now(),
        expiresAt: Number(dbBuffer.expiresAt) || Date.now() + EXPLORE_CACHE_TTL_MS,
        lastError: dbBuffer.lastError || null,
      };
      return memoryExploreBuffer;
    }
  } catch {}

  return null;
}

export function setExploreBuffer(items: any[], sourceIds: string[], lastError: string | null = null): void {
  const entry: ExploreBufferCacheEntry = {
    items,
    sourceIds,
    builtAt: Date.now(),
    expiresAt: Date.now() + EXPLORE_CACHE_TTL_MS,
    lastError,
  };
  memoryExploreBuffer = entry;
  try {
    SqliteDb.setExploreBuffer(entry);
  } catch (err) {
    console.error('[Explore Buffer] Failed to write explore buffer to SQLite:', err);
  }
}

export async function buildUniversalExploreCatalog(options: {
  maxSources?: number;
  itemsPerSource?: number;
} = {}): Promise<any[]> {
  const maxSources = options.maxSources || 15;
  const itemsPerSource = options.itemsPerSource || 20;

  const catalogSources = KOTATSU_SOURCES.filter(
    (s) => isSourceAlive(s.id) && !isMetadataOnlySource(s.id) && sourceCircuitBreaker.canAttempt(s.id)
  );

  const selectedSources = catalogSources.slice(0, maxSources);
  const aggregated: any[] = [];
  const activeSourceIds: string[] = [];

  for (const src of selectedSources) {
    try {
      const origin = new URL(src.baseUrl).origin;
      const catalogPath = (src as any).catalogPath || '/';
      const url = `${origin}${catalogPath.startsWith('/') ? '' : '/'}${catalogPath}`;

      const bypassRes = await fetchWithChallengeBypass(url, {
        headers: { 'User-Agent': SCRAPER_UA, Accept: 'text/html', Referer: origin + '/' },
        enableCloudflareBypass: appSettings.enableCloudflareBypass,
        flareSolverrUrl: appSettings.flareSolverrUrl,
        captchaSolverEnabled: appSettings.captchaSolverEnabled,
        captchaApiKey: appSettings.captchaApiKey,
        timeoutMs: 12000,
        sourceId: src.id,
        onCookieUpdate: (sid, cookies) => sourceCookieJar.setCookies(sid, cookies),
      });

      if (bypassRes.ok && bypassRes.html) {
        updateSourceHealth(src.id, bypassRes.html, bypassRes.status || 200);
        const parsed = parseUniversalCatalogCards(bypassRes.html, src, origin, itemsPerSource);
        if (parsed.length > 0) {
          aggregated.push(...parsed);
          activeSourceIds.push(src.id);
        }
      } else {
        updateSourceHealth(src.id, null, bypassRes.status || 500, `HTTP ${bypassRes.status}`);
      }
    } catch (err: any) {
      updateSourceHealth(src.id, null, 0, err?.message || 'Network error');
    }
  }

  setExploreBuffer(aggregated, activeSourceIds);
  return aggregated;
}

let isRefresherRunning = false;

export function scheduleExploreRefresher(): void {
  if (isRefresherRunning) return;
  isRefresherRunning = true;

  // Background warm-up 5 seconds after boot
  setTimeout(async () => {
    try {
      console.log('[Explore Engine] Warming up universal catalog buffer in background...');
      await buildUniversalExploreCatalog();
      console.log('[Explore Engine] Universal catalog buffer warm-up completed.');
    } catch (err) {
      console.error('[Explore Engine] Catalog warm-up error:', err);
    }
  }, 5000);

  // Hourly background refresher
  setInterval(async () => {
    try {
      console.log('[Explore Engine] Refreshing explore buffer...');
      await buildUniversalExploreCatalog();
    } catch (err) {
      console.error('[Explore Engine] Scheduled refresh error:', err);
    }
  }, EXPLORE_CACHE_TTL_MS);
}
