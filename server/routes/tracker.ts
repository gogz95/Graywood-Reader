// ============================================================================
// TRACKER, AI & DATABASE OPERATIONS ROUTER
// Auto-update tracking, duplicate detection/merging, AI enrichment, and DB backups
// ============================================================================

import { Router, Request, Response } from 'express';
import { MangaItem, DuplicateCandidate } from '../../src/types';
import { SqliteDb } from '../../sqlite-db';
import {
  mangaDatabase,
  syncConfig,
  saveDatabaseToDisk,
  syncAddOrUpdateManga,
  syncDeleteManga,
  syncResetManga,
  syncBulkAddOrUpdateManga,
  getGeminiClient,
  autoUpdateLogs,
  resolveRequestUserId,
} from '../appState';
import { isSeriesFromDisabledSource } from '../sources/sourcesCatalog';
import {
  fetchMangaDex,
  calculateStringSimilarity,
  purgeDisabledSourcesAndRefreshMetadata,
  refreshSingleMangaMetadata,
} from '../services/metadataService';

export const trackerRouter = Router();

const GEMINI_MODEL = "gemini-3.6-flash";

// In-memory logs & status for tracker auto-updater
export interface AutoUpdateLog {
  id: string;
  timestamp: string;
  source: string;
  mangaTitle: string;
  status: 'updated' | 'unchanged' | 'error';
  message: string;
  oldChapter?: number;
  newChapter?: number;
}

export { autoUpdateLogs };
export const autoUpdateStatus = {
  isScanning: false,
  currentSource: '',
  scannedCount: 0,
  totalCount: 0,
  newReleasesFound: 0,
  lastScanTimestamp: '',
};

export const ignoredDuplicatePairs = new Set<string>();

// ── Tracker Status & Trigger ────────────────────────────────────────────────
trackerRouter.get('/api/tracker/status', (_req, res) => {
  res.json({
    isScanning: autoUpdateStatus.isScanning,
    currentSource: autoUpdateStatus.currentSource,
    scannedCount: autoUpdateStatus.scannedCount,
    totalCount: autoUpdateStatus.totalCount,
    newReleasesFound: autoUpdateStatus.newReleasesFound,
    lastScanTimestamp: autoUpdateStatus.lastScanTimestamp,
    logs: autoUpdateLogs,
  });
});

trackerRouter.post('/api/tracker/auto-update', async (_req, res) => {
  if (autoUpdateStatus.isScanning) {
    return res.json({
      success: true,
      message: 'Scan already in progress',
      isScanning: true,
      scannedCount: autoUpdateStatus.scannedCount,
      totalCount: autoUpdateStatus.totalCount,
    });
  }

  autoUpdateStatus.isScanning = true;
  autoUpdateStatus.scannedCount = 0;
  autoUpdateStatus.totalCount = mangaDatabase.length;
  autoUpdateStatus.newReleasesFound = 0;

  try {
    const toUpdate = mangaDatabase.filter((m) => m.autoUpdateEnabled !== false);
    autoUpdateStatus.totalCount = toUpdate.length;

    const batchSize = 4;
    for (let i = 0; i < toUpdate.length; i += batchSize) {
      const batch = toUpdate.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (m) => {
          const oldLatest = m.latestChapter || 0;
          autoUpdateStatus.currentSource = m.sourceName || 'Crawler';
          try {
            const updated = await refreshSingleMangaMetadata(m);
            autoUpdateStatus.scannedCount++;
            if (updated.latestChapter > oldLatest) {
              autoUpdateStatus.newReleasesFound++;
              autoUpdateLogs.unshift({
                id: `log-${Date.now()}-${m.id}`,
                timestamp: new Date().toISOString(),
                source: m.sourceName || 'Live Source',
                mangaTitle: m.title,
                status: 'updated',
                message: `New chapter available: Ch. ${updated.latestChapter} (was Ch. ${oldLatest})`,
                oldChapter: oldLatest,
                newChapter: updated.latestChapter,
              });
            }
          } catch (err: any) {
            autoUpdateStatus.scannedCount++;
            autoUpdateLogs.unshift({
              id: `log-${Date.now()}-${m.id}`,
              timestamp: new Date().toISOString(),
              source: m.sourceName || 'Live Source',
              mangaTitle: m.title,
              status: 'error',
              message: `Refresh failed: ${err.message}`,
            });
          }
        })
      );
    }

    if (autoUpdateLogs.length > 50) autoUpdateLogs.splice(50);
    autoUpdateStatus.lastScanTimestamp = new Date().toISOString();
    saveDatabaseToDisk();

    res.json({
      success: true,
      scannedCount: autoUpdateStatus.scannedCount,
      newReleasesFound: autoUpdateStatus.newReleasesFound,
      message: `Auto-update completed. Scanned ${autoUpdateStatus.scannedCount} series, found ${autoUpdateStatus.newReleasesFound} new releases.`,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Auto update failed', details: err.message });
  } finally {
    autoUpdateStatus.isScanning = false;
  }
});

trackerRouter.get('/api/tracker/logs', (_req, res) => {
  res.json(autoUpdateLogs);
});

trackerRouter.post('/api/tracker/dismiss-duplicate', (req, res) => {
  const { primaryId, secondaryId } = req.body;
  if (primaryId && secondaryId) {
    ignoredDuplicatePairs.add(`${primaryId}_${secondaryId}`);
    ignoredDuplicatePairs.add(`${secondaryId}_${primaryId}`);
  }
  res.json({ success: true });
});

trackerRouter.post('/api/tracker/detect-duplicates', async (_req, res) => {
  const candidates: DuplicateCandidate[] = [];
  const processedPairs = new Set<string>();

  const tokenMap = new Map<string, MangaItem[]>();
  for (const m of mangaDatabase) {
    const tokens = Array.from(new Set(
      [m.title, ...(m.altTitles || [])]
        .flatMap((t) => t.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/))
        .filter((tok) => tok.length >= 4 && !['the', 'that', 'with', 'from', 'this', 'your', 'about', 'chapter'].includes(tok))
    ));
    for (const tok of tokens) {
      if (!tokenMap.has(tok)) tokenMap.set(tok, []);
      tokenMap.get(tok)!.push(m);
    }
  }

  for (const list of tokenMap.values()) {
    if (list.length < 2 || list.length > 25) continue;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const itemA = list[i];
        const itemB = list[j];
        if (itemA.id === itemB.id) continue;

        const pairKey = itemA.id < itemB.id ? `${itemA.id}_${itemB.id}` : `${itemB.id}_${itemA.id}`;
        if (processedPairs.has(pairKey)) continue;
        processedPairs.add(pairKey);

        if (ignoredDuplicatePairs.has(`${itemA.id}_${itemB.id}`) || ignoredDuplicatePairs.has(`${itemB.id}_${itemA.id}`)) continue;

        let maxSim = calculateStringSimilarity(itemA.title, itemB.title);
        for (const altA of (itemA.altTitles || [])) {
          const sim = calculateStringSimilarity(altA, itemB.title);
          if (sim > maxSim) maxSim = sim;
        }
        for (const altB of (itemB.altTitles || [])) {
          const sim = calculateStringSimilarity(itemA.title, altB);
          if (sim > maxSim) maxSim = sim;
        }

        if (maxSim >= 60 || (itemA.coverImage && itemA.coverImage === itemB.coverImage)) {
          const mergedAltSet = new Set([...(itemA.altTitles || []), ...(itemB.altTitles || []), itemA.title, itemB.title]);
          const mergedAltTitles = Array.from(mergedAltSet).filter(
            (t) => t.toLowerCase() !== itemA.title.toLowerCase()
          );

          const mergedGenres = Array.from(new Set([...(itemA.genres || []), ...(itemB.genres || [])]));

          candidates.push({
            id: `dup_${itemA.id}_${itemB.id}`,
            primaryItem: itemA,
            secondaryItem: itemB,
            similarityScore: Math.min(maxSim + 15, 99),
            reason: maxSim >= 80 ? 'High title & alternate name match' : 'Similar romanized title & matching genre tags',
            suggestedTitle: itemA.title.length >= itemB.title.length ? itemA.title : itemB.title,
            mergedAltTitles,
            suggestedGenres: mergedGenres,
            suggestedDescription: itemA.description.length > itemB.description.length ? itemA.description : itemB.description,
          });
        }
      }
    }
  }

  const ai = getGeminiClient();
  if (ai && mangaDatabase.length > 2) {
    try {
      const dbTitlesList = mangaDatabase.map((m) => ({
        id: m.id,
        title: m.title,
        altTitles: m.altTitles,
        type: m.type,
      }));

      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: `Analyze this JSON list of Manhwa & Manhua titles:
${JSON.stringify(dbTitlesList.slice(0, 100))}

Identify duplicate pairs (e.g. romanized vs English translation). Return JSON array of objects with primaryId, secondaryId, confidence, reason, suggestedTitle.`,
        config: {
          responseMimeType: "application/json",
        },
      });

      if (response.text) {
        const aiResults = JSON.parse(response.text);
        if (Array.isArray(aiResults)) {
          for (const aiDup of aiResults) {
            const itemA = mangaDatabase.find((m) => m.id === aiDup.primaryId);
            const itemB = mangaDatabase.find((m) => m.id === aiDup.secondaryId);
            if (itemA && itemB && itemA.id !== itemB.id) {
              const existingIdx = candidates.findIndex(
                (c) =>
                  (c.primaryItem.id === itemA.id && c.secondaryItem.id === itemB.id) ||
                  (c.primaryItem.id === itemB.id && c.secondaryItem.id === itemA.id)
              );

              const mergedAltSet = new Set([
                ...(itemA.altTitles || []),
                ...(itemB.altTitles || []),
                itemA.title,
                itemB.title,
              ]);

              const candidateData: DuplicateCandidate = {
                id: `dup_ai_${itemA.id}_${itemB.id}`,
                primaryItem: itemA,
                secondaryItem: itemB,
                similarityScore: aiDup.confidence || 95,
                reason: `AI Match: ${aiDup.reason}`,
                suggestedTitle: aiDup.suggestedTitle || itemA.title,
                mergedAltTitles: Array.from(mergedAltSet).filter(
                  (t) => t.toLowerCase() !== (aiDup.suggestedTitle || itemA.title).toLowerCase()
                ),
                suggestedGenres: Array.from(new Set([...(itemA.genres || []), ...(itemB.genres || [])])),
                suggestedDescription: itemA.description.length > itemB.description.length ? itemA.description : itemB.description,
              };

              if (existingIdx !== -1) {
                candidates[existingIdx] = candidateData;
              } else {
                candidates.push(candidateData);
              }
            }
          }
        }
      }
    } catch (err) {
      console.error("Gemini duplicate detection error:", err);
    }
  }

  res.json(candidates);
});

trackerRouter.post('/api/tracker/merge-duplicates', (req, res) => {
  const { primaryId, secondaryId, newTitle, newAltTitles, newGenres, newDescription } = req.body;

  const primary = SqliteDb.getMangaById(primaryId);
  const secondary = SqliteDb.getMangaById(secondaryId);

  if (!primary || !secondary) {
    return res.status(404).json({ error: "One or both items not found" });
  }

  const maxCurrentChapter = Math.max(primary.currentChapter || 0, secondary.currentChapter || 0);
  const maxLatestChapter = Math.max(primary.latestChapter || 1, secondary.latestChapter || 1);

  const mergedPrimary: MangaItem = {
    ...primary,
    title: newTitle || primary.title,
    altTitles: Array.isArray(newAltTitles) ? newAltTitles : primary.altTitles,
    genres: Array.isArray(newGenres) ? newGenres : primary.genres,
    description: newDescription || primary.description,
    currentChapter: maxCurrentChapter,
    latestChapter: maxLatestChapter,
    rating: Math.max(primary.rating || 0, secondary.rating || 0),
    notes: [primary.notes, secondary.notes].filter(Boolean).join(" | Merged note: "),
    lastUpdated: new Date().toISOString(),
  };

  syncDeleteManga(secondaryId);
  syncAddOrUpdateManga(mergedPrimary);

  res.json({
    success: true,
    mergedItem: mergedPrimary,
    removedId: secondaryId,
    remainingTotal: SqliteDb.getMangaCount(),
  });
});

// ── AI Metadata Enrichment & Similar Search ─────────────────────────────────
trackerRouter.post('/api/ai/enrich-metadata', async (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: "Title is required" });

  const ai = getGeminiClient();
  if (!ai) {
    return res.status(503).json({ error: "Gemini API key not configured. Set GEMINI_API_KEY on the server to use AI metadata enrichment." });
  }

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: `You are an expert Manhwa & Manhua database curator. Provide metadata for the title: "${title}".
Return JSON object:
{
  "title": "Clean Official English Title",
  "altTitles": ["Romanized Korean/Chinese name", "Original Hangul or Hanzi", "Short Alias"],
  "type": "manhwa" or "manhua",
  "description": "Engaging 2-3 sentence synopsis",
  "genres": ["Action", "Fantasy", "System", "Cultivation"],
  "latestChapter": 150,
  "rating": 9.2,
  "status": "reading"
}`,
      config: { responseMimeType: "application/json" },
    });

    if (response.text) {
      const data = JSON.parse(response.text);
      return res.json(data);
    }
  } catch (err: any) {
    console.error("AI Metadata enrichment error:", err);
  }

  res.status(502).json({ error: "AI metadata enrichment failed. Check server logs." });
});

trackerRouter.post('/api/ai/find-similar', async (req, res) => {
  const { title, genres } = req.body;
  const ai = getGeminiClient();
  if (!ai) return res.json([]);

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: `Given the series "${title}" with genres [${(genres || []).join(', ')}], suggest 4 similar series.
Return JSON array of { title, type, reason }.`,
      config: { responseMimeType: "application/json" },
    });

    if (response.text) {
      return res.json(JSON.parse(response.text));
    }
  } catch (err) {
    console.error("AI recommendations error:", err);
  }

  res.json([]);
});

// ── Database Export, Import, Reset, Refresh ──────────────────────────────────
trackerRouter.get('/api/db/export', (req, res) => {
  const format = req.query.format || 'json';
  const uid = resolveRequestUserId(req) || 'usr_admin';
  const exportItems = SqliteDb.applyUserOverlay(mangaDatabase, uid);

  if (format === 'csv') {
    const headers = "id,title,type,currentChapter,latestChapter,status,rating,sourceName\n";
    const csvCell = (v: unknown) => {
      const s = String(v ?? '');
      const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const rows = exportItems.map((m) =>
      `${csvCell(m.id)},${csvCell(m.title)},${csvCell(m.type)},${m.currentChapter},${m.latestChapter},${csvCell(m.status)},${m.rating},${csvCell(m.sourceName)}`
    ).join("\n");
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="manhua_tracker_export.csv"');
    return res.send(headers + rows);
  }

  res.setHeader('Content-Disposition', 'attachment; filename="manhua_tracker_db.json"');
  res.json({
    app: "ManhuaHub Subdomain Tracker",
    exportedAt: new Date().toISOString(),
    subdomain: syncConfig.subdomain,
    count: exportItems.length,
    data: exportItems,
  });
});

trackerRouter.post('/api/db/import', (req, res) => {
  const { data, replaceExisting } = req.body;
  if (!Array.isArray(data)) {
    return res.status(400).json({ error: "Invalid payload: 'data' must be an array of manga items." });
  }

  const uid = resolveRequestUserId(req) || 'usr_admin';
  const itemsToImport: MangaItem[] = data.map((item: any) => ({
    ...item,
    userId: item.userId || uid,
    currentChapter: Math.max(0, Number(item.currentChapter) || 0),
  }));

  if (replaceExisting) {
    syncResetManga(itemsToImport);
  } else {
    const freshItems: MangaItem[] = [];
    itemsToImport.forEach((item: MangaItem) => {
      const exists = mangaDatabase.some((m) => m.id === item.id || m.title.toLowerCase() === item.title.toLowerCase());
      if (!exists) freshItems.push(item);
    });
    if (freshItems.length > 0) syncBulkAddOrUpdateManga(freshItems);
  }

  // Restore user reading progress and categories
  const userStateBatch = itemsToImport.map((item) => ({
    id: item.id,
    isFavorite: item.isFavorite,
    currentChapter: item.currentChapter,
    status: item.status,
    categoryIds: item.categories,
  }));
  SqliteDb.bulkApplyUserImportState(uid, userStateBatch);

  res.json({ success: true, totalTracked: mangaDatabase.length });
});

trackerRouter.post('/api/db/reset', (req, res) => {
  syncResetManga([]);
  saveDatabaseToDisk();
  res.json({ success: true, count: 0, message: 'Database fully cleared for rebuild' });
});

trackerRouter.post('/api/db/refresh-all', async (_req, res) => {
  try {
    const result = await purgeDisabledSourcesAndRefreshMetadata();
    res.json({
      success: true,
      message: `Database refreshed: ${result.purgedCount} purged, ${result.refreshedCount} refreshed.`,
      ...result,
      data: mangaDatabase,
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to refresh database", details: err.message });
  }
});

// ── MangaDex & AniList APIs ──────────────────────────────────────────────────
trackerRouter.get('/api/mangadex/search', async (req, res) => {
  const query = (req.query.q as string || '').trim();
  const offset = Math.max(0, Number(req.query.offset) || 0);
  let limit = Math.min(Number(req.query.limit) || 12, 100);

  if (!query) return res.json([]);

  try {
    const lang = (req.query.lang as string || 'en').toLowerCase();
    const langFilter = lang === 'all' ? '' : `&availableTranslatedLanguage[]=${lang}`;

    const response = await fetchMangaDex(
      `https://api.mangadex.org/manga?title=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}${langFilter}&includes[]=cover_art&contentRating[]=safe&contentRating[]=suggestive`
    );

    if (response.ok) {
      const data = await response.json();
      const results = (data.data || []).map((m: any) => {
        const titleObj = m.attributes.title || {};
        const title = titleObj.en || Object.values(titleObj)[0] || 'Unknown Title';
        const altTitles = (m.attributes.altTitles || []).map((alt: any) => Object.values(alt)[0]).filter(Boolean);
        const lang = m.attributes.originalLanguage || '';
        const type = lang === 'ko' ? 'manhwa' : lang === 'zh' || lang === 'zh-hk' ? 'manhua' : 'manga';

        const coverRel = (m.relationships || []).find((r: any) => r.type === 'cover_art');
        const coverFileName = coverRel?.attributes?.fileName;
        const rawCoverUrl = coverFileName
          ? `https://uploads.mangadex.org/covers/${m.id}/${coverFileName}.256.jpg`
          : '/api/mangadex/image-proxy?url=https%3A%2F%2Fuploads.mangadex.org%2Fcovers%2F32d76d19-8a05-4db0-9fc2-e0b0648fe9d0%2Ffbc962f9-3d12-4c6e-8212-32a2cb874a7b.jpg';

        const coverImage = coverFileName
          ? `/api/mangadex/image-proxy?url=${encodeURIComponent(rawCoverUrl)}`
          : rawCoverUrl;

        const descObj = m.attributes.description || {};
        const description = (descObj.en || Object.values(descObj)[0] || 'No description available.').substring(0, 300);
        const tags = (m.attributes.tags || []).map((t: any) => t.attributes?.name?.en).filter(Boolean).slice(0, 5);

        return {
          id: m.id,
          title,
          altTitles,
          type,
          coverImage,
          description,
          genres: tags.length ? tags : ['Action', 'Fantasy'],
          latestChapter: Number(m.attributes.lastChapter) || 1,
          publicationStatus: (m.attributes.status || 'ONGOING').toUpperCase(),
          source: 'MangaDex API',
          rating: 8.5,
        };
      });

      if (results.length > 0) return res.json(results);
    }

    res.json([]);
  } catch (error) {
    console.error("MangaDex search error:", error);
    res.json([]);
  }
});

trackerRouter.post('/api/mangadex/import/:mangaDexId', async (req, res) => {
  const { mangaDexId } = req.params;
  const { userId } = req.body || {};

  try {
    const mdRes = await fetchMangaDex(`https://api.mangadex.org/manga/${mangaDexId}?includes[]=cover_art&includes[]=author`);
    if (!mdRes.ok) {
      return res.status(400).json({ error: "Failed to fetch title from MangaDex API" });
    }

    const mdData = await mdRes.json();
    const m = mdData.data;

    const titleObj = m.attributes.title || {};
    const title = titleObj.en || Object.values(titleObj)[0] || 'MangaDex Series';
    const altTitles = (m.attributes.altTitles || []).map((alt: any) => Object.values(alt)[0]).filter(Boolean);
    const lang = m.attributes.originalLanguage || '';
    const type = lang === 'ko' ? 'manhwa' : lang === 'zh' || lang === 'zh-hk' ? 'manhua' : 'manga';

    const coverRel = (m.relationships || []).find((r: any) => r.type === 'cover_art');
    const coverFileName = coverRel?.attributes?.fileName;
    const rawCoverUrl = coverFileName
      ? `https://uploads.mangadex.org/covers/${m.id}/${coverFileName}.512.jpg`
      : 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=500&auto=format&fit=crop&q=80';

    const coverImage = coverFileName
      ? `/api/mangadex/image-proxy?url=${encodeURIComponent(rawCoverUrl)}`
      : rawCoverUrl;

    const descObj = m.attributes.description || {};
    const description = descObj.en || Object.values(descObj)[0] || 'MangaDex imported series.';
    const tags = (m.attributes.tags || []).map((t: any) => t.attributes?.name?.en).filter(Boolean);

    const existingManga = SqliteDb.getMangaByApiId(mangaDexId) || SqliteDb.getMangaById(mangaDexId);
    if (existingManga) {
      return res.json({ success: true, message: "Series already synced in database", manga: existingManga });
    }

    const newMangaItem: MangaItem = {
      id: `md_${m.id}`,
      title,
      altTitles,
      type,
      coverImage,
      description,
      genres: tags.length ? tags : ['Action', 'Fantasy'],
      status: 'reading',
      currentChapter: 0,
      totalChapters: m.attributes.lastChapter ? Number(m.attributes.lastChapter) : null,
      latestChapter: Number(m.attributes.lastChapter) || 1,
      lastUpdated: new Date().toISOString(),
      rating: 9.0,
      sourceUrl: `https://mangadex.org/title/${m.id}`,
      sourceName: 'MangaDex API v5',
      autoUpdateEnabled: true,
      notes: 'Imported from MangaDex API',
      addedAt: new Date().toISOString(),
      lastReadAt: new Date().toISOString(),
      syncedFromApi: 'MangaDex API',
      apiId: m.id,
      userId: userId || undefined,
      isFavorite: false,
    };

    syncAddOrUpdateManga(newMangaItem);
    return res.status(201).json({ success: true, manga: newMangaItem });
  } catch (err: any) {
    console.error("[MangaDex Integration] Import error:", err);
    res.status(500).json({ error: "MangaDex import failed", details: err.message });
  }
});


trackerRouter.post('/api/anilist/search', async (req, res) => {
  const { query } = req.body;
  const searchQuery = query || 'Solo Leveling';

  const graphqlQuery = `
    query ($search: String) {
      Page(page: 1, perPage: 8) {
        media(search: $search, type: MANGA, format_in: [MANGA]) {
          id
          title {
            romaji
            english
            native
          }
          countryOfOrigin
          coverImage {
            large
          }
          description
          genres
          status
          chapters
          averageScore
        }
      }
    }
  `;

  try {
    const response = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        query: graphqlQuery,
        variables: { search: searchQuery },
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (response.ok) {
      const data = await response.json();
      const mediaList = data.data?.Page?.media || [];
      const results = mediaList.map((m: any) => {
        const title = m.title?.english || m.title?.romaji || m.title?.native || 'Unknown Title';
        const altTitles = [m.title?.romaji, m.title?.native].filter(Boolean);
        const origin = m.countryOfOrigin;
        const type = origin === 'KR' ? 'manhwa' : origin === 'CN' || origin === 'TW' ? 'manhua' : 'manga';

        return {
          id: m.id,
          title,
          altTitles,
          type,
          coverImage: m.coverImage?.large,
          description: (m.description || '').replace(/<[^>]*>?/gm, ''),
          genres: m.genres || ['Action'],
          latestChapter: m.chapters || 1,
          rating: m.averageScore ? (m.averageScore / 10).toFixed(1) : 8.5,
          source: 'AniList GraphQL',
        };
      });

      return res.json(results);
    }
    res.json([]);
  } catch (error) {
    console.error("AniList search error:", error);
    res.json([]);
  }
});
