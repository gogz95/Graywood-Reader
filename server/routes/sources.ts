// ============================================================================
// SOURCES & KOTATSU CATALOG ROUTER
// Source listing, activation/deactivation, health diagnostics, circuit breakers, and search
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Router, Request, Response } from 'express';
import { MangaItem, isNsfwManga } from '../../src/types';
import {
  syncConfig,
  saveDatabaseToDisk,
  isNsfwAccessAllowed,
} from '../appState';
import { sourceCircuitBreaker } from '../circuitBreaker';
import { challengeManager } from '../challengeManager';
import {
  KOTATSU_SOURCES,
  SOURCE_MAP,
  disabledSourceIds,
  isSourceAlive,
  isMetadataOnlySource,
  buildFullSourceInventory,
  getSourceById,
  rebuildDeadSourcesSet,
  SourceDefinition,
} from '../sources/sourcesCatalog';
import {
  sourceHealthMap,
  scheduleSourceHealthPersist,
  SourceHealth,
} from '../services/sourceHealthService';
import {
  getSourcePopularSeries,
  auditAndDisableEmptySources,
  sourceAuditRunning,
  sourceAuditStatus,
} from '../services/exploreService';
import { enrichWithMangaDexMetadata } from '../services/metadataService';
import { searchWeebCentral } from '../scrapers/weebCentral';
import { ASURA_API_HEADERS } from '../scrapers/asuraScans';
import { fetchFlameSeriesContext } from '../scrapers/flameComics';

export function reviveSource(sourceId: string): { ok: boolean; message: string; source?: SourceDefinition } {
  if (!sourceId) return { ok: false, message: "sourceId is required" };
  const lower = sourceId.toLowerCase();

  if (isMetadataOnlySource(lower)) {
    return { ok: false, message: `Source "${sourceId}" is a metadata-only source and cannot be used for reading.` };
  }

  const def = getSourceById(lower);
  if (!def) {
    return { ok: false, message: `Source "${sourceId}" not found in catalog.` };
  }

  disabledSourceIds.delete(lower);
  disabledSourceIds.delete(sourceId);

  if (!Array.isArray(syncConfig.reactivatedSources)) syncConfig.reactivatedSources = [];
  if (!syncConfig.reactivatedSources.includes(sourceId)) syncConfig.reactivatedSources.push(sourceId);
  syncConfig.disabledSources = Array.from(disabledSourceIds);

  if (Array.isArray(syncConfig.removedSources)) {
    syncConfig.removedSources = syncConfig.removedSources.filter((r) => String(r).toLowerCase() !== lower);
  }

  rebuildDeadSourcesSet();
  saveDatabaseToDisk();

  return {
    ok: true,
    message: `Successfully reactivated source "${def.name}".`,
    source: def,
  };
}

export function deactivateSource(sourceId: string): { ok: boolean; message: string } {
  if (!sourceId) return { ok: false, message: "sourceId is required" };
  const lower = sourceId.toLowerCase();

  disabledSourceIds.add(lower);
  disabledSourceIds.add(sourceId);

  if (!Array.isArray(syncConfig.disabledSources)) syncConfig.disabledSources = [];
  if (!syncConfig.disabledSources.includes(sourceId)) syncConfig.disabledSources.push(sourceId);

  if (Array.isArray(syncConfig.reactivatedSources)) {
    syncConfig.reactivatedSources = syncConfig.reactivatedSources.filter((r) => String(r).toLowerCase() !== lower);
  }

  saveDatabaseToDisk();
  return { ok: true, message: `Source "${sourceId}" has been deactivated.` };
}

export function purgeDisabledSources(): { purgedCount: number; remainingCount: number } {
  const count = disabledSourceIds.size;
  disabledSourceIds.clear();
  syncConfig.disabledSources = [];
  saveDatabaseToDisk();
  return {
    purgedCount: count,
    remainingCount: KOTATSU_SOURCES.length,
  };
}

export const sourcesRouter = Router();

// ── GET /api/kotatsu/sources & /api/sources ──────────────────────────────────
export const handleGetSources = (req: Request, res: Response) => {
  let activeSources = KOTATSU_SOURCES.filter(
    (s) => s.id !== 'mangadex' && !disabledSourceIds.has(s.id) && isSourceAlive(s.id, syncConfig) && isSourceAlive(s.name, syncConfig)
  );
  if (!isNsfwAccessAllowed(req)) {
    activeSources = activeSources.filter((s) => !s.isNsfw);
  }
  const listWithStates = activeSources.map((s) => ({
    ...s,
    isEnabled: true,
  }));
  res.json(listWithStates);
};

sourcesRouter.get('/api/kotatsu/sources', handleGetSources);
sourcesRouter.get('/api/sources', handleGetSources);

// ── POST /api/kotatsu/sources/purge-disabled ─────────────────────────────────
export const handlePurgeDisabledSources = (_req: Request, res: Response) => {
  const result = purgeDisabledSources();
  res.json({
    success: true,
    message: `Permanently deleted ${result.purgedCount} disabled sources. ${result.remainingCount} active sources remain.`,
    ...result,
  });
};

sourcesRouter.post('/api/kotatsu/sources/purge-disabled', handlePurgeDisabledSources);
sourcesRouter.post('/api/sources/purge-disabled', handlePurgeDisabledSources);

// ── POST /api/kotatsu/sources/toggle ─────────────────────────────────────────
export const handleToggleSource = (req: Request, res: Response) => {
  const { sourceId, isEnabled } = req.body || {};
  if (!sourceId) return res.status(400).json({ error: "sourceId is required" });

  if (isEnabled === false) {
    disabledSourceIds.add(sourceId);
  } else {
    disabledSourceIds.delete(sourceId);
  }

  syncConfig.disabledSources = Array.from(disabledSourceIds);
  saveDatabaseToDisk();
  console.log(`[Source Engine] Source "${sourceId}" is now ${isEnabled ? 'ENABLED' : 'DISABLED'} (${disabledSourceIds.size} disabled in total)`);
  res.json({
    success: true,
    sourceId,
    isEnabled: !disabledSourceIds.has(sourceId),
    disabledCount: disabledSourceIds.size,
  });
};

sourcesRouter.post('/api/kotatsu/sources/toggle', handleToggleSource);
sourcesRouter.post('/api/sources/toggle', handleToggleSource);

// ── GET /api/kotatsu/sources/all ─────────────────────────────────────────────
export const handleGetAllSources = (req: Request, res: Response) => {
  let inventory = buildFullSourceInventory(syncConfig);
  if (!isNsfwAccessAllowed(req)) {
    inventory = inventory.filter((s) => !s.isNsfw);
  }
  const enriched = inventory.map((item) => {
    const h = sourceHealthMap.get(item.id);
    return {
      ...item,
      healthStatus: h ? h.lastStatus : 'unknown',
      circuitState: h ? (h.circuitState || 'CLOSED') : 'CLOSED',
      consecutiveFailures: h ? (h.consecutiveFailures || 0) : 0,
      lastHealthCheck: h ? h.lastChecked : null,
      failureReason: h ? (h.failureReason || null) : null,
    };
  });
  res.json(enriched);
};

sourcesRouter.get('/api/kotatsu/sources/all', handleGetAllSources);
sourcesRouter.get('/api/sources/all', handleGetAllSources);

// ── POST /api/kotatsu/sources/activate & deactivate ───────────────────────────
export const handleActivateSource = (req: Request, res: Response) => {
  const { sourceId } = req.body || {};
  const result = reviveSource(sourceId);
  if (!result.ok) return res.status(400).json({ success: false, message: result.message });
  res.json({
    success: true,
    message: result.message,
    source: result.source,
    reactivatedCount: (syncConfig.reactivatedSources || []).length,
    disabledCount: disabledSourceIds.size,
  });
};

sourcesRouter.post('/api/kotatsu/sources/activate', handleActivateSource);
sourcesRouter.post('/api/sources/activate', handleActivateSource);

export const handleDeactivateSource = (req: Request, res: Response) => {
  const { sourceId } = req.body || {};
  const result = deactivateSource(sourceId);
  if (!result.ok) return res.status(400).json({ success: false, message: result.message });
  res.json({ success: true, message: result.message, disabledCount: disabledSourceIds.size });
};

sourcesRouter.post('/api/kotatsu/sources/deactivate', handleDeactivateSource);
sourcesRouter.post('/api/sources/deactivate', handleDeactivateSource);

// ── POST /api/kotatsu/sources/activate-all & deactivate-all ───────────────────
sourcesRouter.post('/api/kotatsu/sources/activate-all', (_req, res) => {
  const removedSet = new Set((syncConfig.removedSources || []).map((r) => String(r).toLowerCase()));
  const allToRevive = new Set<string>([...removedSet, ...disabledSourceIds]);

  let revived = 0;
  let skippedMeta = 0;
  for (const id of allToRevive) {
    if (isMetadataOnlySource(id)) { skippedMeta++; continue; }
    const r = reviveSource(id);
    if (r.ok) revived++;
  }
  res.json({
    success: true,
    message: `Activated ${revived} source(s).`,
    activatedCount: revived,
    skippedMetadataOnly: skippedMeta,
    activeCount: KOTATSU_SOURCES.filter((s) => !disabledSourceIds.has(s.id) && s.id !== 'mangadex').length,
    reactivatedSources: syncConfig.reactivatedSources || [],
  });
});

sourcesRouter.post('/api/kotatsu/sources/deactivate-all', (_req, res) => {
  let deactivated = 0;
  let skippedMeta = 0;
  for (const s of KOTATSU_SOURCES) {
    if (s.id === 'mangadex' || isMetadataOnlySource(s.id, s.baseUrl)) { skippedMeta++; continue; }
    disabledSourceIds.add(s.id);
    if (!Array.isArray(syncConfig.disabledSources)) syncConfig.disabledSources = [];
    if (!syncConfig.disabledSources.includes(s.id)) syncConfig.disabledSources.push(s.id);
    deactivated++;
  }
  saveDatabaseToDisk();
  res.json({
    success: true,
    message: `Deactivated ${deactivated} source(s).`,
    deactivatedCount: deactivated,
    skippedMetadataOnly: skippedMeta,
    disabledCount: disabledSourceIds.size,
  });
});

// ── GET /api/kotatsu/sources/health ───────────────────────────────────────────
sourcesRouter.get('/api/kotatsu/sources/health', (_req, res) => {
  const healthData: Record<string, any> = {};
  for (const source of KOTATSU_SOURCES) {
    const h = sourceHealthMap.get(source.id);
    const cb = sourceCircuitBreaker.getState(source.id);
    if (h || cb.state !== 'CLOSED') {
      healthData[source.id] = {
        id: source.id,
        lastChecked: h?.lastChecked || cb.lastChecked || Date.now(),
        lastStatus: h?.lastStatus || (cb.state === 'OPEN' ? 'down' : 'ok'),
        consecutiveFailures: h?.consecutiveFailures ?? cb.failures,
        tripCount: cb.tripCount || 0,
        nextProbeTime: cb.nextProbeTime,
        failureReason: h?.failureReason || cb.lastFailureReason,
        circuitState: cb.state,
      };
    }
  }
  res.json({
    healthy: Object.values(healthData).filter(h => h.lastStatus === 'ok' && h.circuitState !== 'OPEN').length,
    degraded: Object.values(healthData).filter(h => h.lastStatus === 'degraded' || h.circuitState === 'HALF_OPEN').length,
    blocked: Object.values(healthData).filter(h => h.lastStatus === 'blocked').length,
    down: Object.values(healthData).filter(h => h.lastStatus === 'down' || h.circuitState === 'OPEN').length,
    disabled: disabledSourceIds.size,
    sources: healthData,
    disabledSourceIds: Array.from(disabledSourceIds),
  });
});

// ── POST /api/kotatsu/sources/circuit-reset ──────────────────────────────────
sourcesRouter.post('/api/kotatsu/sources/circuit-reset', (req, res) => {
  const { sourceId } = req.body || {};
  if (sourceId) {
    sourceCircuitBreaker.reset(sourceId);
    const h = sourceHealthMap.get(sourceId);
    if (h) {
      h.consecutiveFailures = 0;
      h.lastStatus = 'ok';
      h.failureReason = undefined;
      h.circuitState = 'CLOSED';
      scheduleSourceHealthPersist();
    }
    return res.json({ success: true, message: `Reset circuit breaker for ${sourceId}` });
  } else {
    sourceCircuitBreaker.reset();
    for (const [, h] of sourceHealthMap) {
      h.consecutiveFailures = 0;
      h.lastStatus = 'ok';
      h.failureReason = undefined;
      h.circuitState = 'CLOSED';
    }
    scheduleSourceHealthPersist();
    return res.json({ success: true, message: 'Reset all circuit breakers' });
  }
});

// ── GET /api/sources/dashboard ───────────────────────────────────────────────
sourcesRouter.get('/api/sources/dashboard', (_req, res) => {
  const topSourcesList = KOTATSU_SOURCES.slice(0, 50).map((source) => {
    const h = sourceHealthMap.get(source.id);
    const cb = sourceCircuitBreaker.getState(source.id);
    const srcDef = SOURCE_MAP.get(source.id);
    const urlStr = source.baseUrl || srcDef?.baseUrl || '';
    let domainStr = '';
    try { domainStr = new URL(urlStr).hostname; } catch {}
    return {
      id: source.id,
      name: source.name,
      engine: (source.id.includes('madara') ? 'madara' : 'custom'),
      lang: source.lang || 'en',
      domain: domainStr,
      baseUrl: urlStr,
      circuitState: cb.state,
      tripCount: cb.tripCount || 0,
      nextProbeTime: cb.nextProbeTime,
      consecutiveFailures: h?.consecutiveFailures ?? cb.failures,
      lastChecked: h?.lastChecked || cb.lastChecked || 0,
      lastStatus: h?.lastStatus || (cb.state === 'OPEN' ? 'down' : 'ok'),
      failureReason: h?.failureReason || cb.lastFailureReason,
    };
  });

  const summary = {
    totalMonitored: topSourcesList.length,
    healthy: topSourcesList.filter((s) => s.lastStatus === 'ok' && s.circuitState !== 'OPEN').length,
    degraded: topSourcesList.filter((s) => s.lastStatus === 'degraded' || s.circuitState === 'HALF_OPEN').length,
    blocked: topSourcesList.filter((s) => s.lastStatus === 'blocked').length,
    down: topSourcesList.filter((s) => s.lastStatus === 'down' || s.circuitState === 'OPEN').length,
  };

  res.json({ summary, sources: topSourcesList });
});

// ── POST /api/sources/flag-broken & /api/challenges/:id/flag-broken ──────────
export const handleFlagSourceBroken = (req: Request, res: Response) => {
  const challengeId = req.params.id || req.body.challengeId;
  const reason = req.body.reason || "Manually flagged as broken";
  let sourceId = req.body.sourceId;
  let sourceName = req.body.sourceName || sourceId;

  if (challengeId) {
    const active = challengeManager.getActiveChallenges().find((c) => c.id === challengeId);
    if (active) {
      sourceId = active.sourceId;
      sourceName = active.sourceName;
      challengeManager.dismissChallenge(challengeId);
    } else if (challengeId.startsWith('chn_')) {
      sourceId = challengeId.replace(/^chn_/, '');
      sourceName = sourceId;
      challengeManager.dismissChallenge(challengeId);
    }
  }

  if (!sourceId) {
    return res.status(400).json({ error: "sourceId or challengeId is required" });
  }

  disabledSourceIds.add(sourceId);
  syncConfig.disabledSources = Array.from(disabledSourceIds);
  saveDatabaseToDisk();

  const h: SourceHealth = sourceHealthMap.get(sourceId) || {
    id: sourceId,
    lastChecked: Date.now(),
    lastStatus: 'broken' as const,
    consecutiveFailures: 99,
    failureReason: reason,
  };
  h.lastStatus = 'broken';
  h.failureReason = reason;
  sourceHealthMap.set(sourceId, h);
  sourceCircuitBreaker.trip(sourceId, reason);

  console.log(`[Challenge Engine] Source "${sourceName}" (${sourceId}) manually flagged as broken and disabled. Reason: ${reason}`);

  res.json({
    success: true,
    sourceId,
    sourceName,
    message: `Source "${sourceName}" flagged as broken and disabled.`,
  });
};

sourcesRouter.post('/api/challenges/:id/flag-broken', handleFlagSourceBroken);
sourcesRouter.post('/api/challenges/flag-broken', handleFlagSourceBroken);
sourcesRouter.post('/api/sources/flag-broken', handleFlagSourceBroken);
sourcesRouter.post('/api/kotatsu/sources/flag-broken', handleFlagSourceBroken);

// ── POST /api/scrape/audit-sources & GET /api/scrape/audit-status ────────────
sourcesRouter.post('/api/scrape/audit-sources', async (_req, res) => {
  try {
    const concurrency = Math.min(20, Math.max(1, Number(_req.query.concurrency) || 8));
    const result = await auditAndDisableEmptySources(concurrency);
    return res.json(result);
  } catch (e: any) {
    return res.status(500).json({ error: "Source audit failed", details: e.message });
  }
});

sourcesRouter.get('/api/scrape/audit-status', (_req, res) => {
  const healthSummary: Record<string, number> = {};
  for (const [, h] of sourceHealthMap) {
    healthSummary[h.lastStatus] = (healthSummary[h.lastStatus] || 0) + 1;
  }
  res.json({
    running: sourceAuditRunning,
    disabledCount: disabledSourceIds.size,
    activeCount: KOTATSU_SOURCES.filter(s => !disabledSourceIds.has(s.id) && s.id !== 'mangadex').length,
    totalSources: KOTATSU_SOURCES.length,
    healthSummary,
    status: Array.from(sourceAuditStatus.entries()).map(([id, s]) => ({ id, ...s })),
  });
});

// ── GET /api/scrape/source-health & POST /api/scrape/run-liveness ─────────────
sourcesRouter.get('/api/scrape/source-health', (_req, res) => {
  const healthPath = path.join(process.cwd(), 'data', 'source-health.json');
  try {
    if (!fs.existsSync(healthPath)) {
      return res.json({ error: 'No liveness scan results found. Run POST /api/scrape/run-liveness first.', scannedAt: null, sources: [] });
    }
    const data = JSON.parse(fs.readFileSync(healthPath, 'utf-8'));
    return res.json(data);
  } catch (e: any) {
    return res.status(500).json({ error: 'Failed to read source-health.json', details: e.message });
  }
});

sourcesRouter.post('/api/scrape/run-liveness', (req, res) => {
  const { sample, concurrency, patch } = req.body || {};
  const scriptPath = path.join(process.cwd(), 'scripts', 'catalog-liveness.mjs');
  if (!fs.existsSync(scriptPath)) {
    return res.status(404).json({ error: 'catalog-liveness.mjs not found in scripts/' });
  }
  const args: string[] = [];
  if (sample) args.push('--sample', String(Number(sample) || 50));
  if (concurrency) args.push('--concurrency', String(Number(concurrency) || 20));
  if (patch) args.push('--patch');

  const child = spawn(process.execPath, [scriptPath, ...args], {
    detached: true,
    stdio: 'ignore',
    cwd: process.cwd(),
  });
  child.unref();
  return res.json({
    status: 'started',
    pid: child.pid,
    message: `Liveness scan started in background (pid ${child.pid}). Results will be written to data/source-health.json. Poll GET /api/scrape/source-health for results.`,
    args,
  });
});

// ── GET /api/kotatsu/search - Kotatsu Multi-Source Live Search ────────────────
sourcesRouter.get('/api/kotatsu/search', async (req, res) => {
  const resolveAliasSourceId = (alias: string): string => {
    const aliasMap: Record<string, string> = {
      "reader.graywood.no": "asurascans",
    };
    return aliasMap[alias.toLowerCase()] || alias;
  };

  const rawSourceId = (req.query.sourceId as string) || "mangadex";
  const sourceId = resolveAliasSourceId(rawSourceId);
  const query = ((req.query.q as string) || "").trim();
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(Number(req.query.limit) || 24, 100);

  let sourceDef = KOTATSU_SOURCES.find((s) => s.id === sourceId && s.id !== "mangadex");
  if (!sourceDef) {
    sourceDef =
      KOTATSU_SOURCES.find((s) => s.id !== "mangadex" && !disabledSourceIds.has(s.id) && isSourceAlive(s.id)) ||
      KOTATSU_SOURCES.find((s) => s.id !== "mangadex");
  }
  if (!sourceDef) return res.json([]);

  // Gate 18+ / NSFW source searches for guest users
  if (sourceDef.isNsfw && !isNsfwAccessAllowed(req)) {
    return res.json([]);
  }

  const filterNsfwIfNeeded = <T extends Record<string, any>>(items: T[]): T[] => {
    if (isNsfwAccessAllowed(req)) return items;
    return items.filter((m) => !isNsfwManga(m as any));
  };

  try {
    if (!query) {
      const { items: popular, totalCount } = await getSourcePopularSeries(sourceDef, page, limit);
      const enriched = await enrichWithMangaDexMetadata(popular);
      const safeEnriched = filterNsfwIfNeeded(enriched);
      res.setHeader('X-Total-Count', String(safeEnriched.length));
      res.setHeader('X-Total-Pages', String(Math.ceil(safeEnriched.length / limit)));
      return res.json(safeEnriched);
    }

    if (sourceDef.id === 'weebcentral') {
      try {
        const results = await searchWeebCentral(query);
        const enriched = await enrichWithMangaDexMetadata(results);
        const safeEnriched = filterNsfwIfNeeded(enriched);
        res.setHeader('X-Total-Count', String(safeEnriched.length));
        res.setHeader('X-Total-Pages', '1');
        return res.json(safeEnriched);
      } catch (err: any) {
        console.warn('[Kotatsu Search] WeebCentral search error:', err.message);
      }
    }

    if (sourceDef.id === 'asurascans') {
      try {
        const cleanQuery = query.replace(/^asura_/i, '').replace(/[-_]/g, ' ').trim();
        const asuraRes = await fetch(`https://api.asurascans.com/api/series?search=${encodeURIComponent(cleanQuery || query)}`, {
          headers: ASURA_API_HEADERS,
          signal: AbortSignal.timeout(12000),
        });
        if (asuraRes.ok) {
          const json = await asuraRes.json();
          const data: any[] = Array.isArray(json?.data) ? json.data : [];
          const results = data.map((s: any) => {
            const slug = s.slug || s.id || '';
            const pubPath = s.public_url || `/comics/${slug}`;
            return {
              id: `asura_${slug}`,
              title: s.title || 'Unknown',
              sourceUrl: `https://asurascans.com${pubPath}`,
              coverImage: s.cover || '',
              sourceName: 'Asura Scans',
              description: (s.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 200),
              genres: (Array.isArray(s.genres) ? s.genres : []).map((g: any) => g?.name).filter(Boolean),
              latestChapter: s.chapter_count ? Number(s.chapter_count) : 1,
              type: s.type || 'manhwa',
              rating: typeof s.rating === 'number' ? Number(s.rating.toFixed(1)) : 9.0,
            };
          });
          const enriched = await enrichWithMangaDexMetadata(results);
          const safeEnriched = filterNsfwIfNeeded(enriched);
          res.setHeader('X-Total-Count', String(safeEnriched.length));
          res.setHeader('X-Total-Pages', '1');
          return res.json(safeEnriched);
        }
      } catch (err: any) {
        console.warn('[Kotatsu Search] Asura search error:', err.message);
      }
    }

    if (sourceDef.id === 'flamecomics') {
      try {
        const flameSlug = query.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const flameCtx = await fetchFlameSeriesContext(`https://flamecomics.xyz/series/${flameSlug}`);
        if (flameCtx && flameCtx.matchedSeries) {
          const item = {
            id: `flame_${flameCtx.seriesId}`,
            title: flameCtx.matchedSeries.title || query,
            sourceUrl: `https://flamecomics.xyz/series/${flameCtx.seriesId}`,
            coverImage: flameCtx.matchedSeries.cover || '',
            sourceName: 'Flame Comics',
            description: flameCtx.matchedSeries.description || 'Flame Comics series',
            genres: flameCtx.matchedSeries.genres || ['Action'],
            latestChapter: flameCtx.chapters?.length || 1,
            type: 'manhwa',
            rating: 9.0,
          };
          const enriched = await enrichWithMangaDexMetadata([item]);
          const safeEnriched = filterNsfwIfNeeded(enriched);
          res.setHeader('X-Total-Count', String(safeEnriched.length));
          res.setHeader('X-Total-Pages', '1');
          return res.json(safeEnriched);
        }
      } catch (err: any) {
        console.warn('[Kotatsu Search] Flame search error:', err.message);
      }
    }

    const { items: popular } = await getSourcePopularSeries(sourceDef, 1, 60);
    const needle = query.toLowerCase();
    const filtered = popular.filter(
      (m: any) => (m.title || '').toLowerCase().includes(needle) || (m.description || '').toLowerCase().includes(needle)
    );
    const enriched = await enrichWithMangaDexMetadata(filtered.slice(0, limit));
    const safeEnriched = filterNsfwIfNeeded(enriched);
    res.setHeader('X-Total-Count', String(safeEnriched.length));
    res.setHeader('X-Total-Pages', String(Math.max(1, Math.ceil(safeEnriched.length / limit))));
    return res.json(safeEnriched);
  } catch (err: any) {
    console.error('[Kotatsu Search] Error searching source:', err?.message || err);
    return res.json([]);
  }
});

// ── GET /api/kotatsu/search-all - Aggregate search across all active sources ──
sourcesRouter.get('/api/kotatsu/search-all', async (req, res) => {
  const query = ((req.query.q as string) || '').trim();
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  if (!query) return res.json([]);

  let active = KOTATSU_SOURCES.filter(
    (s) => s.id !== 'mangadex' && !disabledSourceIds.has(s.id) && isSourceAlive(s.id)
  );

  if (!isNsfwAccessAllowed(req)) {
    active = active.filter((s) => !s.isNsfw);
  }

  const topSources = active.slice(0, 12);
  const results: any[] = [];
  const seenTitles = new Set<string>();

  await Promise.all(
    topSources.map(async (src) => {
      try {
        const { items } = await getSourcePopularSeries(src, 1, 30);
        const needle = query.toLowerCase();
        for (const it of items) {
          if ((it.title || '').toLowerCase().includes(needle)) {
            const key = it.title.toLowerCase().trim();
            if (!seenTitles.has(key)) {
              seenTitles.add(key);
              results.push({ ...it, __sourceId: src.id, __sourceName: src.name });
            }
          }
        }
      } catch {}
    })
  );

  const enriched = await enrichWithMangaDexMetadata(results.slice(0, limit));
  if (!isNsfwAccessAllowed(req)) {
    return res.json(enriched.filter((m) => !isNsfwManga(m)));
  }
  return res.json(enriched);
});
