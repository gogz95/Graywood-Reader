// ============================================================================
// EXPLORE & SCRAPERS ROUTER
// Live multi-source explore feed, featured updates, catalog browsing, and bulk ingestion
// ============================================================================

import { Router, Request, Response } from 'express';
import { MangaItem, isNsfwManga } from '../../src/types';
import { SqliteDb } from '../../sqlite-db';
import {
  saveDatabaseToDisk,
  syncAddOrUpdateManga,
  isNsfwAccessAllowed,
  appSettings,
} from '../appState';
import {
  KOTATSU_SOURCES,
  disabledSourceIds,
  isSourceAlive,
  SourceDefinition,
  getAllSourcesWithExtensions,
} from '../sources/sourcesCatalog';
import {
  exploreBufferRef,
  refreshExploreCatalog,
  defaultExploreSources,
  getSourcePopularSeries,
  dedupeExploreItems,
  buildDatabaseExploreItems,
  scrapeAsuraScans,
  scrapeFlameComics,
  scrapeManhwa18,
} from '../services/exploreService';
import {
  enrichWithMangaDexMetadata,
  getMangaDexMetadataByTitle,
  isMangaDexSourceLink,
  calculateStringSimilarity,
  aggregateMultiSourceMetadata,
} from '../services/metadataService';
import { ENGINE_SOURCE_REGISTRY } from '../services/crawlerEngine';

export const exploreRouter = Router();

// ── Smart Merge Engine: Integrate incoming source items and merge with existing DB ─
export function integrateKotatsuSourcesAndMerge(incomingItems: Partial<MangaItem>[]): {
  mergedCount: number;
  uncertainCount: number;
  newCount: number;
} {
  let mergedCount = 0;
  let uncertainCount = 0;
  let newCount = 0;

  // Build O(1) title lookup map for fast exact matching
  const allManga = SqliteDb.getAllManga();
  const titleMap = new Map<string, MangaItem>();
  for (const m of allManga) {
    const norm = m.title.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (norm) titleMap.set(norm, m);
    for (const alt of (m.altTitles || [])) {
      const altNorm = alt.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (altNorm && !titleMap.has(altNorm)) titleMap.set(altNorm, m);
    }
  }

  for (const item of incomingItems) {
    if (!item.title) continue;
    const normTitle = item.title.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!normTitle) continue;

    const exactMatch = titleMap.get(normTitle);

    if (exactMatch) {
      if (!exactMatch.availableSources) exactMatch.availableSources = [];
      if (item.sourceName && item.sourceUrl) {
        const srcExists = exactMatch.availableSources.some(
          (s) => s.sourceName === item.sourceName || s.sourceUrl === item.sourceUrl
        );
        if (!srcExists) {
          exactMatch.availableSources.push({
            sourceName: item.sourceName,
            sourceUrl: item.sourceUrl,
          });
        }
      }
      if (item.apiId) exactMatch.apiId = item.apiId;
      if (item.sourceUrl) exactMatch.sourceUrl = item.sourceUrl;
      if (item.sourceName && !exactMatch.sourceName?.includes(item.sourceName)) {
        exactMatch.sourceName = `${exactMatch.sourceName} • ${item.sourceName}`;
      }
      if (item.latestChapter && item.latestChapter > exactMatch.latestChapter) {
        exactMatch.latestChapter = item.latestChapter;
      }
      if (item.genres && item.genres.length > 0) {
        exactMatch.genres = Array.from(new Set([...exactMatch.genres, ...item.genres]));
      }
      if (item.altTitles && item.altTitles.length > 0) {
        exactMatch.altTitles = Array.from(new Set([...exactMatch.altTitles, ...item.altTitles]));
      }
      syncAddOrUpdateManga(exactMatch);
      mergedCount++;
    } else {
      let maxSim = 0;
      let similarTarget: MangaItem | null = null;

      for (const existing of allManga) {
        const sim = calculateStringSimilarity(existing.title, item.title);
        if (sim > maxSim) {
          maxSim = sim;
          similarTarget = existing;
        }
      }

      if (maxSim >= 60 && similarTarget) {
        uncertainCount++;
      }

      const newItem: MangaItem = {
        id: item.id || `kotatsu_db_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        title: item.title,
        altTitles: item.altTitles || [],
        type: (item.type as MangaItem['type']) || 'manhwa',
        coverImage: item.coverImage || '/api/mangadex/image-proxy?url=https%3A%2F%2Fuploads.mangadex.org%2Fcovers%2F32d76d19-8a05-4db0-9fc2-e0b0648fe9d0%2Ffbc962f9-3d12-4c6e-8212-32a2cb874a7b.jpg',
        description: item.description || `Indexed from ${item.sourceName || 'Kotatsu Source'}`,
        genres: item.genres || ['Action'],
        status: 'plan_to_read',
        currentChapter: 0,
        totalChapters: item.totalChapters || null,
        latestChapter: item.latestChapter || 1,
        rating: item.rating || 9.0,
        sourceUrl: item.sourceUrl || '',
        sourceName: item.sourceName || 'Explore',
        autoUpdateEnabled: false,
        notes: '',
        addedAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        lastReadAt: new Date().toISOString(),
        isFavorite: false,
      };
      syncAddOrUpdateManga(newItem);
      titleMap.set(normTitle, newItem);
      newCount++;
    }
  }

  saveDatabaseToDisk();
  return { mergedCount, uncertainCount, newCount };
}

// ── GET /api/explore/meta ───────────────────────────────────────────────────
exploreRouter.get('/api/explore/meta', (req: Request, res: Response) => {
  const buf = exploreBufferRef.current;
  const rawItems = buf && buf.items && buf.items.length > 0 ? buf.items : buildDatabaseExploreItems();

  const isNsfwAllowed = isNsfwAccessAllowed(req);
  const genreCounts = new Map<string, number>();
  const typeSet = new Set<string>();
  const sourceCountMap = new Map<string, number>();

  const filteredItems = isNsfwAllowed ? rawItems : rawItems.filter((it) => !isNsfwManga(it));

  for (const it of filteredItems) {
    for (const g of (it.genres || [])) {
      if (typeof g === 'string' && g.trim()) {
        const normalized = g.trim();
        const lower = normalized.toLowerCase();
        if (!isNsfwAllowed && (lower === '18+' || lower === 'adult' || lower === 'smut' || lower === 'hentai' || lower === 'erotica' || lower === 'nsfw' || lower === 'r18' || lower === 'pornographic')) {
          continue;
        }
        genreCounts.set(normalized, (genreCounts.get(normalized) || 0) + 1);
      }
    }
    if (it.type) typeSet.add(String(it.type).toLowerCase());
    if (it.__sourceId) {
      sourceCountMap.set(it.__sourceId, (sourceCountMap.get(it.__sourceId) || 0) + 1);
    }
  }

  const genres = [...genreCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);

  const types = [...typeSet].sort();

  let allActiveSources = getAllSourcesWithExtensions()
    .filter((s) => s.id !== 'mangadex' && !disabledSourceIds.has(s.id) && isSourceAlive(s.id));

  if (!isNsfwAllowed) {
    allActiveSources = allActiveSources.filter((s) => !s.isNsfw);
  }

  // Sort sources: sources with indexed series first (by count DESC), then alphabetically
  allActiveSources.sort((a, b) => {
    const countA = sourceCountMap.get(a.id) || 0;
    const countB = sourceCountMap.get(b.id) || 0;
    if (countA !== countB) return countB - countA;
    return a.name.localeCompare(b.name);
  });

  const mappedSources = allActiveSources.map((s) => ({
    id: s.id,
    name: s.name,
    count: sourceCountMap.get(s.id) || undefined,
  }));

  return res.json({
    genres,
    types,
    sources: mappedSources,
    totalItems: filteredItems.length,
    builtAt: buf?.builtAt || Date.now(),
  });
});

// ── GET /api/explore ─────────────────────────────────────────────────────────
exploreRouter.get('/api/explore', async (req: Request, res: Response) => {
  const rawSourceId = ((req.query.sourceId as string) || '').trim();
  const q = ((req.query.q as string) || '').trim();
  const typeFilter = ((req.query.type as string) || '').trim().toLowerCase();
  const includeTagsRaw = ((req.query.includeTags as string) || '').trim();
  const excludeTagsRaw = ((req.query.excludeTags as string) || '').trim();
  const nsfwFilter = ((req.query.nsfw as string) || 'all').trim().toLowerCase();
  const page = Math.max(1, Number(req.query.page) || 1);

  let limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));

  const clientWidth = Number(req.query.width) || 0;
  const clientHeight = Number(req.query.height) || 0;

  if (clientWidth > 0 && clientHeight > 0) {
    const screenArea = clientWidth * clientHeight;
    const baseLimit = 30;
    const maxLimit = 100;
    const minArea = 1024 * 768;
    const maxArea = 3840 * 2160;
    const normalizedArea = Math.min(1, Math.max(0, (screenArea - minArea) / (maxArea - minArea)));
    const scaleFactor = 1 + (normalizedArea * 2.5);
    const scaledLimit = Math.min(maxLimit, Math.floor(baseLimit * scaleFactor));
    limit = Math.max(baseLimit, scaledLimit);
  }

  const userAgent = req.headers['user-agent']?.toString() || '';
  const isMobile = /mobile|android|iphone|ipod|blackberry|iemobile|opera mini|fennec|windows phone|windows mobile/i.test(userAgent);
  if (isMobile) {
    limit = Math.min(40, limit);
  }

  const isNsfwAllowed = isNsfwAccessAllowed(req);

  const buf = exploreBufferRef.current;
  const bufferReady = !!buf && buf.items.length > 0;
  const bufferFresh = bufferReady && Date.now() < buf!.expiresAt;

  if (bufferReady && !bufferFresh) {
    refreshExploreCatalog(false).catch(() => {});
  }

  let catalog: any[] = bufferReady ? [...buf!.items] : buildDatabaseExploreItems();

  // On-demand source live scraping when browsing a specific source that has few items
  if (rawSourceId && rawSourceId !== 'all') {
    const sourceDef = getAllSourcesWithExtensions().find(
      (s) => s.id === rawSourceId && s.id !== 'mangadex' && !disabledSourceIds.has(s.id) && isSourceAlive(s.id)
    );

    const existingCountForSource = catalog.filter((it) => it.__sourceId === rawSourceId).length;
    if (sourceDef && existingCountForSource < page * limit && page <= 5) {
      try {
        const liveResult = await getSourcePopularSeries(sourceDef, page, limit);
        const liveItems = Array.isArray(liveResult) ? liveResult : (liveResult?.items || []);
        if (liveItems.length > 0) {
          const tagged = liveItems.map((it) => ({
            ...it,
            __sourceId: sourceDef.id,
            __sourceName: sourceDef.name,
          }));
          catalog = dedupeExploreItems([...catalog, ...tagged]);
          if (exploreBufferRef.current) {
            exploreBufferRef.current.items = catalog;
            if (!exploreBufferRef.current.sourceIds.includes(sourceDef.id)) {
              exploreBufferRef.current.sourceIds.push(sourceDef.id);
            }
          }
        }
      } catch (liveErr: any) {
        console.warn(`[Explore] Live on-demand fetch notice for ${rawSourceId}:`, liveErr?.message);
      }
    }
  }

  let list: any[] = catalog;

  // 1. Source filter
  if (rawSourceId && rawSourceId !== 'all') {
    list = list.filter((it) => it.__sourceId === rawSourceId);
  }

  // 2. NSFW filter
  if (!isNsfwAllowed || nsfwFilter === 'safe') {
    list = list.filter((it) => !isNsfwManga(it));
  } else if (nsfwFilter === '18+') {
    list = list.filter((it) => isNsfwManga(it));
  }

  // 3. Type filter
  if (typeFilter && typeFilter !== 'all') {
    list = list.filter((it) => (it.type || 'manhwa').toLowerCase() === typeFilter);
  }

  // 4. Tri-State Include Tags
  if (includeTagsRaw) {
    const incTags = includeTagsRaw
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    if (incTags.length > 0) {
      list = list.filter((it) => {
        const rGenres = (it.genres || []).map((g: string) => String(g).toLowerCase());
        return incTags.every((t) => rGenres.includes(t));
      });
    }
  }

  // 5. Tri-State Exclude Tags
  if (excludeTagsRaw) {
    const excTags = excludeTagsRaw
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    if (excTags.length > 0) {
      list = list.filter((it) => {
        const rGenres = (it.genres || []).map((g: string) => String(g).toLowerCase());
        return !excTags.some((t) => rGenres.includes(t));
      });
    }
  }

  // 6. Search query
  if (q) {
    const needle = q.toLowerCase();
    list = list.filter((it) =>
      (it.title || '').toLowerCase().includes(needle) ||
      (it.description || '').toLowerCase().includes(needle) ||
      (Array.isArray(it.altTitles) && it.altTitles.some((a: string) => String(a).toLowerCase().includes(needle))) ||
      (it.__sourceName || it.sourceName || '').toLowerCase().includes(needle)
    );
  }

  const totalCount = list.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / limit));
  const offset = (page - 1) * limit;
  const paged = list.slice(offset, offset + limit);

  res.setHeader('X-Total-Count', String(totalCount));
  res.setHeader('X-Total-Pages', String(totalPages));
  return res.json({ items: paged, totalCount, totalPages, cached: true });
});

// ── GET /api/kotatsu/explore/featured ────────────────────────────────────────
exploreRouter.get('/api/kotatsu/explore/featured', async (req, res) => {
  try {
    let allManga = SqliteDb.getAllManga();
    if (!isNsfwAccessAllowed(req)) {
      allManga = allManga.filter((m) => !isNsfwManga(m));
    }
    const isReadable = (m: any) =>
      (m.sourceUrl && !isMangaDexSourceLink(m.sourceName, m.sourceUrl)) ||
      (Array.isArray(m.availableSources) && m.availableSources.some((s: any) => !isMangaDexSourceLink(s.sourceName, s.sourceUrl)));
    const readable = allManga.filter(isReadable);
    const manhwa = readable.filter((m: any) => m.type === 'manhwa').slice(0, 12);
    const manhua = readable.filter((m: any) => m.type === 'manhua').slice(0, 12);
    const manga = readable.filter((m: any) => m.type === 'manga').slice(0, 12);

    res.json({
      featuredManhwa: manhwa.map((m: any) => ({
        id: m.id,
        title: m.title,
        coverImage: m.coverImage,
        sourceName: m.sourceName || 'Kotatsu Engine',
        latestChapter: m.latestChapter || 10,
        type: 'manhwa',
      })),
      featuredManhua: manhua.map((m: any) => ({
        id: m.id,
        title: m.title,
        coverImage: m.coverImage,
        sourceName: m.sourceName || 'Kotatsu Engine',
        latestChapter: m.latestChapter || 10,
        type: 'manhua',
      })),
      featuredManga: manga.map((m: any) => ({
        id: m.id,
        title: m.title,
        coverImage: m.coverImage,
        sourceName: m.sourceName || 'Kotatsu Engine',
        latestChapter: m.latestChapter || 10,
        type: 'manga',
      })),
    });
  } catch {
    res.json({ featuredManhwa: [], featuredManhua: [], featuredManga: [] });
  }
});

// ── GET /api/kotatsu/updates ─────────────────────────────────────────────────
exploreRouter.get('/api/kotatsu/updates', async (req, res) => {
  try {
    let allManga = SqliteDb.getAllManga();
    if (!isNsfwAccessAllowed(req)) {
      allManga = allManga.filter((m: any) => !isNsfwManga(m));
    }
    const live = allManga
      .filter((m: any) => m.sourceUrl && !isMangaDexSourceLink(m.sourceName, m.sourceUrl))
      .sort((a: any, b: any) => new Date(b.lastUpdated || 0).getTime() - new Date(a.lastUpdated || 0).getTime())
      .slice(0, 24);

    const items = live.map((m: any) => ({
      id: m.id,
      title: m.title,
      sourceUrl: m.sourceUrl,
      sourceName: m.sourceName || 'Live Source',
      coverImage: m.coverImage || '',
      latestChapter: Number(m.latestChapter) || 1,
      updatedAt: m.lastUpdated || new Date().toISOString(),
      type: m.type || 'manhwa',
      apiId: m.apiId || null,
      description: m.description || '',
      genres: m.genres || [],
    }));

    const enriched = await enrichWithMangaDexMetadata(items);
    res.json(enriched);
  } catch {
    res.json([]);
  }
});

// ── GET /api/explore/welcome ────────────────────────────────────────────────
exploreRouter.get('/api/explore/welcome', async (req, res) => {
  try {
    let allManga = SqliteDb.getAllManga();
    const isNsfwAllowed = isNsfwAccessAllowed(req);
    if (!isNsfwAllowed) {
      allManga = allManga.filter((m: any) => !isNsfwManga(m));
    }

    // 1. Newly updated series (sorted by lastUpdated DESC)
    const recentlyUpdated = [...allManga]
      .filter((m: any) => m.title && m.latestChapter)
      .sort((a: any, b: any) => new Date(b.lastUpdated || 0).getTime() - new Date(a.lastUpdated || 0).getTime())
      .slice(0, 18);

    // 2. Popular series (sorted by rating DESC, then latestChapter DESC)
    const popular = [...allManga]
      .filter((m: any) => m.title)
      .sort((a: any, b: any) => {
        const rB = Number(b.rating) || 0;
        const rA = Number(a.rating) || 0;
        if (rB !== rA) return rB - rA;
        return (Number(b.latestChapter) || 0) - (Number(a.latestChapter) || 0);
      })
      .slice(0, 18);

    // 3. Stats summary
    const totalChapters = allManga.reduce((acc: number, m: any) => acc + (Number(m.latestChapter) || 0), 0);
    const activeSources = getAllSourcesWithExtensions().filter(
      (s) => s.id !== 'mangadex' && !disabledSourceIds.has(s.id) && isSourceAlive(s.id)
    );

    // 4. Top Genres & Categories
    const genreMap = new Map<string, number>();
    for (const m of allManga) {
      for (const g of m.genres || []) {
        if (typeof g === 'string' && g.trim()) {
          const norm = g.trim();
          genreMap.set(norm, (genreMap.get(norm) || 0) + 1);
        }
      }
    }
    const topCategories = [...genreMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 14)
      .map(([name, count]) => ({ name, count }));

    res.json({
      newlyUpdated: recentlyUpdated,
      popular,
      stats: {
        totalSeries: allManga.length,
        totalChapters,
        totalSources: activeSources.length,
      },
      topCategories,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to fetch welcome data' });
  }
});


// ── GET /api/kotatsu/latest ──────────────────────────────────────────────────
exploreRouter.get('/api/kotatsu/latest', async (req, res) => {
  const sourceId = (req.query.sourceId as string) || '';
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(Number(req.query.limit) || 24, 100);

  let sourceDef = KOTATSU_SOURCES.find((s) => s.id === sourceId && s.id !== 'mangadex');
  if (!sourceDef) {
    sourceDef =
      KOTATSU_SOURCES.find((s) => s.id !== 'mangadex' && !disabledSourceIds.has(s.id) && isSourceAlive(s.id)) ||
      KOTATSU_SOURCES.find((s) => s.id !== 'mangadex');
  }
  if (!sourceDef) return res.json([]);

  if (sourceDef.isNsfw && !isNsfwAccessAllowed(req)) {
    return res.json([]);
  }

  try {
    const result = await getSourcePopularSeries(sourceDef, page, limit);
    let items = Array.isArray(result) ? result : (result?.items || []);
    if (!isNsfwAccessAllowed(req)) {
      items = items.filter((m: any) => !isNsfwManga(m));
    }
    const totalCount = Array.isArray(result) ? items.length : (result?.totalCount ?? items.length);
    const enriched = await enrichWithMangaDexMetadata(items);
    res.setHeader('X-Total-Count', String(totalCount));
    res.setHeader('X-Total-Pages', String(Math.ceil(totalCount / limit)));
    return res.json(enriched);
  } catch {
    res.json([]);
  }
});

// ── POST /api/scrape/source-catalog ──────────────────────────────────────────
exploreRouter.post('/api/scrape/source-catalog', async (req, res) => {
  const { sourceId } = req.body as { sourceId: string };
  if (!sourceId) return res.status(400).json({ error: 'sourceId required' });

  const SCRAPE_CONFIGS: Record<string, { totalPages: number; limit: number; scraper: (p: number, l: number) => Promise<any[] | { items: any[]; totalCount: number }> }> = {
    asurascans: { totalPages: 17, limit: 20, scraper: scrapeAsuraScans },
    flamecomics: { totalPages: 15, limit: 30, scraper: scrapeFlameComics },
    manhwa18: { totalPages: 90, limit: 20, scraper: scrapeManhwa18 },
  };

  const config = SCRAPE_CONFIGS[sourceId];
  if (!config) {
    return res.status(400).json({ error: `No scrape config for sourceId "${sourceId}". Supported: ${Object.keys(SCRAPE_CONFIGS).join(', ')}` });
  }

  res.json({
    status: 'started',
    sourceId,
    totalPages: config.totalPages,
    message: `Scraping ${config.totalPages} page(s) from ${sourceId}.`,
  });

  (async () => {
    let totalAdded = 0;
    for (let page = 1; page <= config.totalPages; page++) {
      try {
        const raw = await config.scraper(page, config.limit);
        const items: any[] = Array.isArray(raw) ? raw : raw.items;
        for (const item of items) {
          const existing = SqliteDb.getAllManga().find((m: any) =>
            m.title.toLowerCase().trim() === item.title.toLowerCase().trim()
          );
          if (!existing) {
            SqliteDb.upsertManga({
              ...item,
              id: item.id || `scraped_${sourceId}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
              status: 'reading',
              currentChapter: 0,
              autoUpdateEnabled: false,
              addedAt: new Date().toISOString(),
              lastUpdated: new Date().toISOString(),
            } as MangaItem);
            totalAdded++;
          }
        }
        await new Promise((r) => setTimeout(r, 1200));
      } catch (e: any) {
        console.error(`[AutoScraper] Error on page ${page} for ${sourceId}:`, e.message);
      }
    }
  })();
});

// ── GET /api/scrape/browse ───────────────────────────────────────────────────
exploreRouter.get('/api/scrape/browse', async (req, res) => {
  const sourceId = (req.query.sourceId as string || '').toLowerCase();
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));

  try {
    let items: any[] = [];
    let totalCount = 0;
    if (sourceId === 'asurascans') {
      const result = await scrapeAsuraScans(page, limit);
      items = result.items;
      totalCount = result.totalCount;
    } else if (sourceId === 'flamecomics') {
      items = await scrapeFlameComics(page, limit);
      totalCount = items.length;
    } else if (sourceId === 'manhwa18') {
      items = await scrapeManhwa18(page, limit);
      totalCount = 90 * limit;
    } else {
      return res.status(400).json({ error: `No scraper registered for sourceId "${sourceId}"` });
    }
    res.setHeader('X-Total-Count', String(totalCount));
    res.setHeader('X-Total-Pages', String(Math.ceil(totalCount / limit)));
    return res.json(items);
  } catch (e: any) {
    console.error(`[Scrape Browse] Error for ${sourceId}:`, e.message);
    return res.json([]);
  }
});

// ── POST /api/kotatsu/pull-all-sources & /api/scrape/update-all-series ───────
export async function updateDatabaseWithAllAvailableSeries(): Promise<{
  totalNew: number;
  totalMerged: number;
  totalSeriesInDatabase: number;
  sourceCounts: Record<string, number>;
}> {
  console.log('[Database Engine] Starting comprehensive update with all available series from active sources...');
  let totalNew = 0;
  let totalMerged = 0;
  const sourceCounts: Record<string, number> = {};

  try {
    const asuraResult = await scrapeAsuraScans(1, 250);
    const asuraItems = Array.isArray(asuraResult) ? asuraResult : (asuraResult?.items || []);
    if (asuraItems.length > 0) {
      const res = integrateKotatsuSourcesAndMerge(asuraItems);
      totalNew += res.newCount;
      totalMerged += res.mergedCount;
      sourceCounts['asurascans'] = asuraItems.length;
    }
  } catch (e: any) {
    console.warn('[Database Engine] Asura Scans bulk update warning:', e.message);
  }

  try {
    const flameItems = await scrapeFlameComics(1, 450);
    if (flameItems && flameItems.length > 0) {
      const res = integrateKotatsuSourcesAndMerge(flameItems);
      totalNew += res.newCount;
      totalMerged += res.mergedCount;
      sourceCounts['flamecomics'] = flameItems.length;
    }
  } catch (e: any) {
    console.warn('[Database Engine] Flame Comics bulk update warning:', e.message);
  }

  try {
    const m18Items: any[] = [];
    for (let p = 1; p <= 5; p++) {
      const pageItems = await scrapeManhwa18(p, 20);
      if (pageItems && pageItems.length > 0) {
        m18Items.push(...pageItems);
      }
    }
    if (m18Items.length > 0) {
      const res = integrateKotatsuSourcesAndMerge(m18Items);
      totalNew += res.newCount;
      totalMerged += res.mergedCount;
      sourceCounts['manhwa18'] = m18Items.length;
    }
  } catch (e: any) {
    console.warn('[Database Engine] Manhwa18 bulk update warning:', e.message);
  }

  const extraSources = ENGINE_SOURCE_REGISTRY.filter(
    (s) => !['asura','flame','manhwa18','manhwa18cc','aquamanga','manhuaplus','manhuaplusorg',
             'harimanga','anisascans','adultwebtoon','mangaread','manhwabuddy','manhuafast',
             'kunmanga','topmanhua','manhwaclan','weebcentral','atsumoe','demonicscans','beehentai',
             'manhuascan','ravenscans','luminous','night','hentai20','hotcomics','daycomics',
             'mangatx'].includes(s.id) &&
    s.engine === 'madara' && !disabledSourceIds.has(s.id)
  ).slice(0, 60);

  let extraPulled = 0;
  for (const src of extraSources) {
    try {
      const srcDef = KOTATSU_SOURCES.find((s) => s.id === src.id);
      if (!srcDef) continue;
      const result = await getSourcePopularSeries(srcDef, 1, 15);
      const items = Array.isArray(result) ? result : (result?.items || []);
      if (items.length > 0) {
        const res = integrateKotatsuSourcesAndMerge(items);
        totalNew += res.newCount;
        totalMerged += res.mergedCount;
        extraPulled += items.length;
        sourceCounts[src.id] = items.length;
      }
      await new Promise((r) => setTimeout(r, 800));
    } catch {}
  }

  try {
    const rowsMissingMeta = SqliteDb.getAllManga()
      .filter((m: any) => m.sourceUrl && !isMangaDexSourceLink(m.sourceName, m.sourceUrl) && !m.apiId)
      .slice(0, 60);
    let enrichedCount = 0;
    for (const row of rowsMissingMeta) {
      const meta = await getMangaDexMetadataByTitle(row.title);
      if (!meta || !meta.apiId) continue;
      const updated: any = { ...row, apiId: meta.apiId };
      if (meta.description) updated.description = updated.description || meta.description;
      if (meta.genres && meta.genres.length && (!updated.genres || updated.genres.length === 0)) updated.genres = meta.genres;
      if (meta.coverImage) updated.coverImage = updated.coverImage || meta.coverImage;
      if (meta.altTitles && meta.altTitles.length) updated.altTitles = Array.from(new Set([...(updated.altTitles || []), ...meta.altTitles]));
      SqliteDb.upsertManga(updated);
      enrichedCount++;
    }
    sourceCounts['mangadex_metadata_backfill'] = enrichedCount;
  } catch (err: any) {
    console.warn('[Database Engine] MangaDex metadata backfill warning:', err.message);
  }

  saveDatabaseToDisk();
  return {
    totalNew,
    totalMerged,
    totalSeriesInDatabase: SqliteDb.getMangaCount(),
    sourceCounts,
  };
}

export async function pullBulkMangaDexSeries(maxPages: number = 20): Promise<{
  totalNew: number;
  totalMerged: number;
  totalPulled: number;
  totalSeriesInDatabase: number;
}> {
  const maxRows = Math.min(600, Math.max(20, maxPages * 30));
  const rowsMissingMeta = SqliteDb.getAllManga()
    .filter((m: any) => m.sourceUrl && !isMangaDexSourceLink(m.sourceName, m.sourceUrl) && !m.apiId)
    .slice(0, maxRows);

  let totalPulled = 0;
  for (const row of rowsMissingMeta) {
    try {
      const meta = await getMangaDexMetadataByTitle(row.title);
      if (!meta || !meta.apiId) continue;
      const updated: any = { ...row, apiId: meta.apiId };
      if (meta.description) updated.description = updated.description || meta.description;
      if (meta.genres && meta.genres.length && (!updated.genres || updated.genres.length === 0)) updated.genres = meta.genres;
      if (meta.coverImage) updated.coverImage = updated.coverImage || meta.coverImage;
      if (meta.altTitles && meta.altTitles.length) updated.altTitles = Array.from(new Set([...(updated.altTitles || []), ...meta.altTitles]));
      SqliteDb.upsertManga(updated);
      totalPulled++;
    } catch (err: any) {
      console.warn('[MangaDex Background DB] Backfill error:', err.message);
    }
  }

  saveDatabaseToDisk();
  return {
    totalNew: 0,
    totalMerged: 0,
    totalPulled,
    totalSeriesInDatabase: SqliteDb.getMangaCount(),
  };
}

exploreRouter.post(['/api/kotatsu/pull-all-sources', '/api/scrape/update-all-series'], async (_req, res) => {
  try {
    const result = await updateDatabaseWithAllAvailableSeries();
    res.json({
      success: true,
      message: `Successfully pulled all available series from active sources into database.`,
      addedCount: result.totalNew,
      mergedCount: result.totalMerged,
      totalSeriesInDatabase: result.totalSeriesInDatabase,
      sourceCounts: result.sourceCounts,
    });
  } catch (err: any) {
    console.error('[Database Engine] Bulk ingestion error:', err);
    res.status(500).json({ error: 'Failed to pull series from sources', details: err.message });
  }
});

exploreRouter.post('/api/mangadex/pull-bulk-catalog', async (req, res) => {
  const pages = Math.min(100, Math.max(1, Number(req.body?.pages) || 20));
  try {
    const result = await pullBulkMangaDexSeries(pages);
    res.json({
      success: true,
      message: `MangaDex metadata backfill complete: enriched ${result.totalPulled} live series (metadata-only).`,
      ...result,
    });
  } catch (err: any) {
    console.error('[MangaDex Bulk Endpoint] Error:', err);
    res.status(500).json({ error: 'Failed to pull bulk series from MangaDex API', details: err.message });
  }
});

// ── POST /api/kotatsu/sync-database ──────────────────────────────────────────
exploreRouter.post('/api/kotatsu/sync-database', (req, res) => {
  const { items = [] } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Items array is required' });
  }
  const result = integrateKotatsuSourcesAndMerge(items);
  res.json({
    success: true,
    message: `Database sync complete! Integrated ${items.length} series.`,
    ...result,
    totalInDatabase: SqliteDb.getMangaCount(),
  });
});

// ── Multi-Provider Metadata Provider Search & Enrichment API ─────────────────

exploreRouter.get('/api/metadata/search-providers', async (req, res) => {
  const query = (req.query.q as string || '').trim();
  if (!query) {
    return res.status(400).json({ error: 'Query parameter q is required' });
  }

  try {
    const data = await aggregateMultiSourceMetadata(query);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: 'Multi-provider search failed', details: err.message });
  }
});

exploreRouter.post('/api/metadata/enrich-manga/:id', async (req, res) => {
  const { id } = req.params;
  const manga = SqliteDb.getMangaById(id);
  if (!manga) {
    return res.status(404).json({ error: 'Manga item not found' });
  }

  try {
    const { merged } = await aggregateMultiSourceMetadata(manga.title);
    if (merged) {
      if (merged.coverImage && !manga.coverImage) manga.coverImage = merged.coverImage;
      if (merged.description && (!manga.description || manga.description.length < (merged.description?.length || 0))) {
        manga.description = merged.description;
      }
      if (merged.genres && merged.genres.length > 0) {
        manga.genres = Array.from(new Set([...(manga.genres || []), ...merged.genres]));
      }
      if (merged.altTitles && merged.altTitles.length > 0) {
        manga.altTitles = Array.from(new Set([...(manga.altTitles || []), ...merged.altTitles]));
      }
      if (merged.rating && (!manga.rating || manga.rating === 9.0)) {
        manga.rating = merged.rating;
      }
      manga.lastUpdated = new Date().toISOString();
      const updated = syncAddOrUpdateManga(manga);
      saveDatabaseToDisk();
      return res.json({ success: true, manga: updated });
    }
    return res.json({ success: true, manga });
  } catch (err: any) {
    res.status(500).json({ error: 'Enrichment failed', details: err.message });
  }
});

// ── Multi-Provider Metadata Enricher Introspection API ───────────────────────
exploreRouter.get('/api/metadata/providers', (_req, res) => {
  const s = appSettings as any;
  res.json({
    providers: [
      { id: 'MangaDex', enabled: s.mangadexConnected !== false && s.mangadexMetadataEnabled !== false, apiKeyRequired: false },
      { id: 'AniList', enabled: s.anilistConnected !== false && s.anilistMetadataEnabled !== false, apiKeyRequired: false },
      { id: 'MyAnimeList', enabled: s.malEnabled !== false, apiKeyRequired: false },
      { id: 'Kitsu', enabled: s.kitsuMetadataEnabled !== false, apiKeyRequired: false, scrobbleEnabled: s.kitsuConnected === true },
      { id: 'MangaUpdates', enabled: s.mangaUpdatesEnabled !== false, apiKeyRequired: Boolean(s.mangaUpdatesUsername && s.mangaUpdatesPassword) },
      { id: 'OpenLibrary', enabled: s.openlibraryEnabled !== false, apiKeyRequired: false },
      { id: 'GoogleBooks', enabled: s.googleBooksEnabled !== false, apiKeyRequired: false },
    ],
  });
});


