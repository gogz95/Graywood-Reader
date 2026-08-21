import { Router } from 'express';
import crypto from 'crypto';
import * as cheerio from 'cheerio';
import { MangaItem, isNsfwManga } from '../../src/types';
import { SqliteDb } from '../../sqlite-db';
import {
  mangaDatabase,
  autoUpdateLogs,
  saveDatabaseToDisk,
  syncAddOrUpdateManga,
  syncBulkAddOrUpdateManga,
  syncDeleteManga,
  resolveRequestUserId,
  canWriteCatalog,
  canModifyManga,
  rejectCatalogWrite,
} from '../appState';
import { isHostRequest } from '../security';
import {
  refreshSingleMangaMetadata,
  fetchMangaDex,
  isMangaDexSourceLink,
} from '../services/metadataService';
import { preferEnglishTitle } from '../../src/utils/metadataHelpers';
import { fetchAsuraSeriesMetadata, ASURA_API_HEADERS } from '../scrapers/asuraScans';
import { fetchFlameSeriesContext } from '../scrapers/flameComics';
import { searchWeebCentral, fetchWeebCentralSeriesMetadata } from '../scrapers/weebCentral';
import { KOTATSU_SOURCES, disabledSourceIds, isSourceAlive, isSeriesFromDisabledSource } from '../sources/sourcesCatalog';
import { fetchWithChallengeBypass } from '../captchaSolver';
import { APP_USER_AGENT } from '../version';

export const mangaRouter = Router();

// Whitelisted fields a client is allowed to set when creating a manga.
const MANGA_CREATE_FIELDS = {
  title: (v: any) => String(v || 'Untitled Series'),
  altTitles: (v: any) => (Array.isArray(v) ? v : []),
  type: (v: any) => (['manga', 'manhwa', 'manhua'].includes(v) ? v : 'manhwa'),
  coverImage: (v: any) => String(v || 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=500&auto=format&fit=crop&q=80'),
  description: (v: any) => String(v || 'No description provided.'),
  genres: (v: any) => (Array.isArray(v) ? v : ['Action']),
  status: (v: any) => String(v || 'reading'),
  currentChapter: (v: any) => Number(v) || 0,
  totalChapters: (v: any) => (v ? Number(v) : null),
  latestChapter: (v: any, all: any) => Number(v) || Number(all.currentChapter) || 1,
  rating: (v: any) => Number(v) || 8.0,
  sourceUrl: (v: any) => String(v || ''),
  sourceName: (v: any) => String(v || 'Custom / Manual'),
  autoUpdateEnabled: (v: any) => v !== false,
  notes: (v: any) => String(v || ''),
  syncedFromApi: (v: any) => v || null,
  apiId: (v: any) => v || null,
  isFavorite: (v: any) => Boolean(v),
  isNsfw: (v: any, all: any) => (v !== undefined ? Boolean(v) : isNsfwManga(all)),
};

export function isContentPath(href: string): boolean {
  if (!href || typeof href !== 'string') return false;
  const h = href.trim();
  if (/^(#|javascript:|mailto:|tel:)/i.test(h)) return false;
  if (/\/(manga|series|title|titles|manhwa|manhua|comic|comics|webtoon|webtoons|read|reader|view|book|truyen|truyen-tranh|story|detail|project|online|comic-online|bd|mangas|g|comic|manga-detail)\//i.test(h)) {
    return true;
  }
  if (/^\/[a-z0-9-_]{3,80}\/?$/i.test(h)) {
    return !/^\/(home|login|register|signup|search|browse|explore|filter|categories|category|genres|genre|tags|tag|latest|popular|history|bookmarks|bookmark|settings|privacy|terms|about|dmca|contact|faq|api|admin|wp-admin|wp-content|wp-includes|feed|rss|install_app|user|profile|author|publisher|group)\/?$/i.test(h);
  }
  return false;
}

export function isNavText(t: string): boolean {
  return /^(nav|menu|home|login|register|sign.?up|account|cookie|privacy|about|dmca|contact|tag|categor|terms|disclaimer|faq|support|donate|patreon|discord)/i.test((t || '').trim());
}

// ── GET /api/manga - List / Filter Manga with User Overlay ─────────────────────
mangaRouter.get('/', (req, res) => {
  const limitRaw = Number(req.query.limit);
  const offsetRaw = Number(req.query.offset);
  const hasPagination =
    (req.query.limit !== undefined || req.query.offset !== undefined) &&
    (Number.isFinite(limitRaw) || Number.isFinite(offsetRaw));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : 200;
  const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? Math.floor(offsetRaw) : 0;

  let allManga = SqliteDb.getAllManga();
  allManga = allManga.filter((m) => !isSeriesFromDisabledSource(m));

  const overlayUserId = resolveRequestUserId(req);
  if (overlayUserId) {
    allManga = SqliteDb.applyUserOverlay(allManga, overlayUserId);
  } else {
    allManga = allManga.map((m) => ({
      ...m,
      isFavorite: false,
      currentChapter: 0,
      categories: [],
    }));
  }

  if (hasPagination) {
    const paged = allManga.slice(offset, offset + limit);
    res.setHeader('X-Total-Count', String(allManga.length));
    return res.json(paged);
  }
  res.json(allManga);
});

// ── POST /api/manga - Create a New Manga Item ─────────────────────────────────
mangaRouter.post('/', (req, res) => {
  if (!canWriteCatalog(req)) return rejectCatalogWrite(res);
  const body = req.body || {};
  const newItem: MangaItem = {
    id: String(body.id || `m_${crypto.randomUUID()}`),
    title: MANGA_CREATE_FIELDS.title(body.title),
    altTitles: MANGA_CREATE_FIELDS.altTitles(body.altTitles),
    type: MANGA_CREATE_FIELDS.type(body.type),
    coverImage: MANGA_CREATE_FIELDS.coverImage(body.coverImage),
    description: MANGA_CREATE_FIELDS.description(body.description),
    genres: MANGA_CREATE_FIELDS.genres(body.genres),
    status: MANGA_CREATE_FIELDS.status(body.status) as MangaItem['status'],
    currentChapter: MANGA_CREATE_FIELDS.currentChapter(body.currentChapter),
    totalChapters: MANGA_CREATE_FIELDS.totalChapters(body.totalChapters),
    latestChapter: MANGA_CREATE_FIELDS.latestChapter(body.latestChapter, body),
    lastUpdated: new Date().toISOString(),
    rating: MANGA_CREATE_FIELDS.rating(body.rating),
    sourceUrl: MANGA_CREATE_FIELDS.sourceUrl(body.sourceUrl),
    sourceName: MANGA_CREATE_FIELDS.sourceName(body.sourceName),
    autoUpdateEnabled: MANGA_CREATE_FIELDS.autoUpdateEnabled(body.autoUpdateEnabled),
    notes: MANGA_CREATE_FIELDS.notes(body.notes),
    addedAt: new Date().toISOString(),
    lastReadAt: new Date().toISOString(),
    syncedFromApi: MANGA_CREATE_FIELDS.syncedFromApi(body.syncedFromApi),
    apiId: MANGA_CREATE_FIELDS.apiId(body.apiId),
    isFavorite: MANGA_CREATE_FIELDS.isFavorite(body.isFavorite),
    isNsfw: MANGA_CREATE_FIELDS.isNsfw(body.isNsfw, body),
    metadataOverrides: Array.isArray(body.metadataOverrides) ? body.metadataOverrides : [],
    userId: (req as any).user ? (req as any).user.id : null,
  };

  syncAddOrUpdateManga(newItem);
  if (newItem.isFavorite) {
    const uid = resolveRequestUserId(req) || (newItem.userId as string) || null;
    if (uid) SqliteDb.setUserFavorite(uid, newItem.id, true);
  }
  const uid = resolveRequestUserId(req);
  res.status(201).json(uid ? SqliteDb.applyUserOverlay([newItem], uid)[0] : newItem);
});

// ── POST /api/manga/bulk-import - Bulk Series Import / Restore ────────────────
mangaRouter.post('/bulk-import', (req, res) => {
  if (!canWriteCatalog(req)) return rejectCatalogWrite(res);
  const rawList = Array.isArray(req.body) ? req.body : req.body?.items;
  if (!Array.isArray(rawList) || rawList.length === 0) {
    return res.status(400).json({ error: 'Invalid items array' });
  }

  const reqUser = (req as any).user;
  const userId = reqUser ? reqUser.id : null;
  const uid = resolveRequestUserId(req) || userId || (isHostRequest(req) ? 'usr_admin' : 'usr_guest');

  const processedItems: MangaItem[] = rawList.map((body: any) => ({
    id: String(body.id || `m_${crypto.randomUUID()}`),
    title: MANGA_CREATE_FIELDS.title(body.title),
    altTitles: MANGA_CREATE_FIELDS.altTitles(body.altTitles),
    type: MANGA_CREATE_FIELDS.type(body.type),
    coverImage: MANGA_CREATE_FIELDS.coverImage(body.coverImage),
    description: MANGA_CREATE_FIELDS.description(body.description),
    genres: MANGA_CREATE_FIELDS.genres(body.genres),
    status: MANGA_CREATE_FIELDS.status(body.status) as MangaItem['status'],
    currentChapter: MANGA_CREATE_FIELDS.currentChapter(body.currentChapter),
    totalChapters: MANGA_CREATE_FIELDS.totalChapters(body.totalChapters),
    latestChapter: MANGA_CREATE_FIELDS.latestChapter(body.latestChapter, body),
    lastUpdated: new Date().toISOString(),
    rating: MANGA_CREATE_FIELDS.rating(body.rating),
    sourceUrl: MANGA_CREATE_FIELDS.sourceUrl(body.sourceUrl),
    sourceName: MANGA_CREATE_FIELDS.sourceName(body.sourceName),
    autoUpdateEnabled: MANGA_CREATE_FIELDS.autoUpdateEnabled(body.autoUpdateEnabled),
    notes: MANGA_CREATE_FIELDS.notes(body.notes),
    addedAt: body.addedAt || new Date().toISOString(),
    lastReadAt: body.lastReadAt || new Date().toISOString(),
    syncedFromApi: MANGA_CREATE_FIELDS.syncedFromApi(body.syncedFromApi),
    apiId: MANGA_CREATE_FIELDS.apiId(body.apiId),
    isFavorite: MANGA_CREATE_FIELDS.isFavorite(body.isFavorite),
    categories: Array.isArray(body.categories) ? body.categories : [],
    userId: uid || 'usr_admin',
  }));

  syncBulkAddOrUpdateManga(processedItems);

  if (uid) {
    const existingCats = SqliteDb.getCategories(uid);
    const catNameToId = new Map<string, string>();
    for (const c of existingCats) {
      catNameToId.set(c.name.toLowerCase().trim(), c.id);
      catNameToId.set(c.id, c.id);
    }
    const colorList = ['#f59e0b', '#f43f5e', '#10b981', '#a855f7', '#0ea5e9', '#6366f1', '#06b6d4', '#ec4899'];

    const userStateBatch: Array<{
      id: string;
      isFavorite?: boolean;
      currentChapter?: number;
      status?: string;
      categoryIds?: string[];
    }> = [];

    for (const item of processedItems) {
      let resolvedIds: string[] | undefined = undefined;
      if (Array.isArray(item.categories) && item.categories.length > 0) {
        resolvedIds = [];
        for (const catNameOrId of item.categories) {
          const trimmed = String(catNameOrId).trim();
          if (!trimmed) continue;
          let catId = catNameToId.get(trimmed.toLowerCase()) || catNameToId.get(trimmed);
          if (!catId) {
            catId = `cat_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
            const pickColor = colorList[existingCats.length % colorList.length];
            SqliteDb.createCategory({
              id: catId,
              name: trimmed,
              color: pickColor,
              icon: 'Bookmark',
              sortOrder: existingCats.length,
              userId: uid,
              createdAt: new Date().toISOString(),
            });
            catNameToId.set(trimmed.toLowerCase(), catId);
            catNameToId.set(catId, catId);
            existingCats.push({ id: catId, name: trimmed, sortOrder: existingCats.length, userId: uid });
          }
          resolvedIds.push(catId);
        }
      }

      userStateBatch.push({
        id: item.id,
        isFavorite: item.isFavorite,
        currentChapter: item.currentChapter,
        status: item.status,
        categoryIds: resolvedIds,
      });
    }

    SqliteDb.bulkApplyUserImportState(uid, userStateBatch);
  }

  res.status(201).json({
    success: true,
    count: processedItems.length,
    totalTracked: SqliteDb.getMangaCount(),
  });
});

// ── POST /api/manga/:id/refresh-metadata - Single Manga Refresh ───────────────
mangaRouter.post('/:id/refresh-metadata', async (req, res) => {
  const { id } = req.params;
  const existing = SqliteDb.getMangaById(id) || mangaDatabase.find((m) => m.id === id);
  if (!existing) return res.status(404).json({ error: 'Manga not found' });

  try {
    console.log(`[Metadata Engine] Refreshing live metadata for '${existing.title}' (${id})...`);
    const refreshed = await refreshSingleMangaMetadata(existing);
    res.json({ success: true, manga: refreshed, message: `Metadata refreshed for ${refreshed.title}` });
  } catch (err: any) {
    console.error(`[Metadata Engine] Failed to refresh metadata for ${id}:`, err);
    res.status(500).json({ error: 'Failed to refresh metadata', details: err.message });
  }
});

// ── POST /api/manga/:id/pull-metadata-from-source - Pick Scraper Metadata ─────
mangaRouter.post('/:id/pull-metadata-from-source', async (req, res) => {
  if (!canWriteCatalog(req)) return rejectCatalogWrite(res);
  const { id } = req.params;
  const existing = SqliteDb.getMangaById(id) || mangaDatabase.find((m) => m.id === id);
  if (!existing) return res.status(404).json({ error: 'Manga not found' });
  if (!canModifyManga(req, existing)) {
    return res.status(403).json({ error: 'Forbidden', message: "You do not have permission to modify another user's series." });
  }

  const { sourceUrl, sourceName, fields } = req.body as {
    sourceUrl: string;
    sourceName: string;
    fields?: string[];
  };
  if (!sourceUrl) return res.status(400).json({ error: 'sourceUrl is required' });

  const ALLOWED_FIELDS = ['title', 'description', 'coverImage', 'rating', 'genres', 'altTitles'] as const;
  type AllowedField = (typeof ALLOWED_FIELDS)[number];
  const fieldsToApply: AllowedField[] =
    Array.isArray(fields) && fields.length > 0
      ? fields.filter((f): f is AllowedField => ALLOWED_FIELDS.includes(f as AllowedField))
      : [...ALLOWED_FIELDS];

  if (fieldsToApply.length === 0) {
    return res.status(400).json({ error: 'No valid fields requested' });
  }

  let fetched: Partial<MangaItem> | null = null;
  const srcLower = (sourceName || '').toLowerCase();
  const urlLower = (sourceUrl || '').toLowerCase();

  try {
    if (urlLower.includes('asura') || srcLower.includes('asura')) {
      const meta = await fetchAsuraSeriesMetadata(sourceUrl);
      if (meta) fetched = meta;
    } else if (urlLower.includes('weebcentral') || srcLower.includes('weeb')) {
      const scraped = await fetchWeebCentralSeriesMetadata(sourceUrl);
      if (scraped) fetched = scraped as Partial<MangaItem>;
    } else if (urlLower.includes('flamecomics') || srcLower.includes('flame')) {
      const ctx = await fetchFlameSeriesContext(sourceUrl);
      if (ctx?.matchedSeries) {
        fetched = {
          title: ctx.matchedSeries.title,
          coverImage: ctx.matchedSeries.thumb,
          genres: ctx.matchedSeries.genres || [],
          description: ctx.matchedSeries.synopsis || '',
        };
      }
    } else if (urlLower.includes('mangadex') || srcLower.includes('mangadex')) {
      const mdIdMatch = sourceUrl.match(/\/title\/([a-f0-9-]+)/i);
      const mdId = mdIdMatch?.[1] || existing.apiId;
      if (mdId) {
        const mdRes = await fetchMangaDex(`https://api.mangadex.org/manga/${mdId}?includes[]=cover_art`);
        if (mdRes.ok) {
          const mdJson = await mdRes.json();
          const attrs = mdJson.data?.attributes || {};
          const rels = mdJson.data?.relationships || [];
          const coverRel = rels.find((r: any) => r.type === 'cover_art');
          const coverFileName = coverRel?.attributes?.fileName;
          fetched = {
            title: preferEnglishTitle(attrs.title) || undefined,
            description: attrs.description?.en || (Object.values(attrs.description || {})[0] as string | undefined),
            coverImage: coverFileName ? `/api/mangadex/image-proxy?url=${encodeURIComponent(`https://uploads.mangadex.org/covers/${mdId}/${coverFileName}.512.jpg`)}` : undefined,
            rating: existing.rating,
            genres: Array.isArray(attrs.tags) ? attrs.tags.map((t: any) => t.attributes?.name?.en).filter(Boolean) : [],
            altTitles: Array.isArray(attrs.altTitles) ? (attrs.altTitles.map((t: any) => Object.values(t)[0]).filter(Boolean) as string[]) : [],
          };
        }
      }
    } else {
      const scraped = await fetchWeebCentralSeriesMetadata(sourceUrl).catch(() => null);
      if (scraped) fetched = scraped as Partial<MangaItem>;
    }
  } catch (err: any) {
    console.warn(`[pull-metadata-from-source] Scraper error for ${sourceUrl}:`, err.message);
    return res.status(502).json({ error: 'Source scraper error', details: err.message });
  }

  if (!fetched) {
    return res.status(404).json({ error: 'Could not fetch metadata from that source' });
  }

  const updated: MangaItem = { ...existing };
  const appliedFields: string[] = [];

  for (const field of fieldsToApply) {
    const value = fetched[field as keyof typeof fetched];
    if (value === undefined || value === null) continue;

    if (field === 'title' && typeof value === 'string' && value.trim()) {
      updated.title = value.trim();
      appliedFields.push(field);
    } else if (field === 'description' && typeof value === 'string' && value.trim()) {
      updated.description = value.trim();
      appliedFields.push(field);
    } else if (field === 'coverImage' && typeof value === 'string' && value.trim()) {
      updated.coverImage = value.trim();
      appliedFields.push(field);
    } else if (field === 'rating' && typeof value === 'number' && value > 0) {
      updated.rating = value;
      appliedFields.push(field);
    } else if (field === 'genres' && Array.isArray(value) && value.length > 0) {
      updated.genres = Array.from(new Set([...updated.genres, ...(value as string[])])).filter(Boolean);
      appliedFields.push(field);
    } else if (field === 'altTitles' && Array.isArray(value) && value.length > 0) {
      updated.altTitles = Array.from(new Set([...updated.altTitles, ...(value as string[])])).filter(Boolean);
      appliedFields.push(field);
    }
  }

  if (appliedFields.length === 0) {
    return res.status(200).json({ success: false, manga: existing, message: 'No new metadata found from that source' });
  }

  const atomicApplied = appliedFields.filter((f) => ['title', 'description', 'coverImage', 'rating'].includes(f));
  updated.metadataOverrides = Array.from(
    new Set([...(existing.metadataOverrides || []), ...atomicApplied])
  );
  updated.lastUpdated = new Date().toISOString();

  SqliteDb.upsertManga(updated);
  const idx = mangaDatabase.findIndex((m) => m.id === id);
  if (idx !== -1) mangaDatabase[idx] = updated;
  saveDatabaseToDisk();

  console.log(`[pull-metadata-from-source] Applied [${appliedFields.join(', ')}] from '${sourceName}' for '${updated.title}'`);
  res.json({
    success: true,
    manga: updated,
    appliedFields,
    message: `Applied ${appliedFields.join(', ')} from ${sourceName}`,
  });
});

// ── GET /api/manga/:id/metadata-options - Aggregated Metadata Studio ──────────
mangaRouter.get('/:id/metadata-options', async (req, res) => {
  const { id } = req.params;
  const manga = SqliteDb.getMangaById(id) || mangaDatabase.find((m) => m.id === id);
  if (!manga) return res.status(404).json({ error: 'Manga not found' });

  const searchOverride = typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim() : '';

  interface SourceOption {
    sourceName: string;
    sourceUrl: string;
    title?: string;
    description?: string;
    coverImage?: string;
    covers?: Array<{ url: string; label?: string }>;
    rating?: number;
    genres?: string[];
    altTitles?: string[];
  }

  const sourceCandidates: Array<{ name: string; url: string }> = [];
  const seenUrls = new Set<string>();

  const addCandidate = (name: string, url: string) => {
    if (!url) return;
    const norm = url.toLowerCase().trim();
    if (seenUrls.has(norm)) return;
    seenUrls.add(norm);
    sourceCandidates.push({ name: name || 'Source', url });
  };

  for (const s of manga.availableSources || []) {
    addCandidate(s.sourceName || 'Source', s.sourceUrl || '');
  }
  if (manga.sourceUrl) {
    addCandidate(manga.sourceName || 'Primary Source', manga.sourceUrl);
  }

  let mdId =
    !searchOverride && manga.apiId
      ? manga.apiId
      : (!searchOverride && manga.id?.startsWith('md_') ? manga.id.replace('md_', '') : null) ||
        (!searchOverride ? manga.sourceUrl?.match(/\/title\/([a-f0-9-]+)/i)?.[1] : null);

  const sourceResults: SourceOption[] = [];

  await Promise.allSettled([
    (async () => {
      const targetQuery = searchOverride || manga.title;
      if (!mdId && targetQuery && targetQuery !== 'Unknown') {
        try {
          const cleanTitle = targetQuery.replace(/\s*\([^)]*\)/g, '').trim();
          if (cleanTitle.length > 2) {
            const searchRes = await fetchMangaDex(
              `https://api.mangadex.org/manga?title=${encodeURIComponent(cleanTitle)}&limit=5&includes[]=cover_art`
            );
            if (searchRes.ok) {
              const searchJson = await searchRes.json();
              if (searchJson.data?.[0]?.id) {
                mdId = searchJson.data[0].id;
              }
            }
          }
        } catch (_) {}
      }

      if (mdId) {
        try {
          const [mdRes, coverRes] = await Promise.all([
            fetchMangaDex(`https://api.mangadex.org/manga/${mdId}?includes[]=cover_art`),
            fetchMangaDex(`https://api.mangadex.org/cover?manga[]=${mdId}&limit=50&order[volume]=desc`).catch(() => null),
          ]);

          if (mdRes.ok) {
            const mdJson = await mdRes.json();
            const attrs = mdJson.data?.attributes || {};
            const rels = mdJson.data?.relationships || [];
            const primaryCoverRel = rels.find((r: any) => r.type === 'cover_art');
            const primaryFileName = primaryCoverRel?.attributes?.fileName;

            const allCovers: Array<{ url: string; label?: string }> = [];
            if (primaryFileName) {
              allCovers.push({
                url: `/api/mangadex/image-proxy?url=${encodeURIComponent(`https://uploads.mangadex.org/covers/${mdId}/${primaryFileName}.512.jpg`)}`,
                label: 'Main Cover (MangaDex)',
              });
            }

            if (coverRes && coverRes.ok) {
              const coverJson = await coverRes.json();
              const coverData = Array.isArray(coverJson.data) ? coverJson.data : [];
              for (const c of coverData) {
                const fn = c.attributes?.fileName;
                const vol = c.attributes?.volume;
                const locale = c.attributes?.locale;
                if (fn && fn !== primaryFileName) {
                  allCovers.push({
                    url: `/api/mangadex/image-proxy?url=${encodeURIComponent(`https://uploads.mangadex.org/covers/${mdId}/${fn}.512.jpg`)}`,
                    label: vol ? `Vol. ${vol}${locale ? ` (${locale.toUpperCase()})` : ''}` : `Alt Cover${locale ? ` (${locale.toUpperCase()})` : ''}`,
                  });
                }
              }
            }

            sourceResults.push({
              sourceName: 'MangaDex API',
              sourceUrl: `https://mangadex.org/title/${mdId}`,
              title: preferEnglishTitle(attrs.title) || manga.title,
              description: attrs.description?.en || (Object.values(attrs.description || {})[0] as string) || '',
              coverImage: allCovers[0]?.url,
              covers: allCovers,
              genres: Array.isArray(attrs.tags) ? attrs.tags.map((t: any) => t.attributes?.name?.en).filter(Boolean) : [],
              altTitles: Array.isArray(attrs.altTitles) ? (attrs.altTitles.map((t: any) => Object.values(t)[0]).filter(Boolean) as string[]) : [],
            });
          }
        } catch (_) {}
      }
    })(),

    (async () => {
      const aniQuery = searchOverride || manga.title;
      if (!aniQuery || aniQuery === 'Unknown') return;
      try {
        const cleanTitle = aniQuery.replace(/\s*\([^)]*\)/g, '').trim();
        if (cleanTitle.length < 2) return;
        const graphqlQuery = `
          query ($search: String) {
            Page(page: 1, perPage: 4) {
              media(search: $search, type: MANGA) {
                id
                title { english romaji native }
                coverImage { extraLarge large medium color }
                bannerImage
                description
                genres
                averageScore
              }
            }
          }
        `;
        const aniRes = await fetch('https://graphql.anilist.co', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ query: graphqlQuery, variables: { search: cleanTitle } }),
        });
        if (aniRes.ok) {
          const aniJson = await aniRes.json();
          const list = aniJson.data?.Page?.media || [];
          for (const m of list) {
            const aniTitle = m.title?.english || m.title?.romaji || m.title?.native || cleanTitle;
            const covers: Array<{ url: string; label?: string }> = [];
            if (m.coverImage?.extraLarge) {
              covers.push({ url: m.coverImage.extraLarge, label: 'AniList HQ Poster (Extra Large)' });
            }
            if (m.coverImage?.large && m.coverImage.large !== m.coverImage.extraLarge) {
              covers.push({ url: m.coverImage.large, label: 'AniList Standard Poster' });
            }
            if (m.bannerImage) {
              covers.push({ url: m.bannerImage, label: 'AniList Official Banner Art' });
            }
            if (covers.length > 0) {
              sourceResults.push({
                sourceName: 'AniList',
                sourceUrl: `https://anilist.co/manga/${m.id}`,
                title: aniTitle,
                description: m.description ? m.description.replace(/<[^>]*>/g, '') : '',
                coverImage: covers[0]?.url,
                covers,
                rating: m.averageScore ? Number((m.averageScore / 10).toFixed(1)) : undefined,
                genres: m.genres || [],
                altTitles: [m.title?.romaji, m.title?.native, m.title?.english].filter((t: any) => t && t !== aniTitle),
              });
            }
          }
        }
      } catch (_) {}
    })(),

    ...sourceCandidates.map(async (cand) => {
      const urlLower = cand.url.toLowerCase();
      const nameLower = cand.name.toLowerCase();

      try {
        if (urlLower.includes('asura') || nameLower.includes('asura')) {
          const meta = await fetchAsuraSeriesMetadata(cand.url);
          if (meta) {
            sourceResults.push({
              sourceName: cand.name || 'Asura Scans',
              sourceUrl: cand.url,
              title: meta.title,
              description: meta.description,
              coverImage: meta.coverImage,
              covers: meta.coverImage ? [{ url: meta.coverImage, label: 'Default Artwork (Asura)' }] : [],
              rating: meta.rating,
              genres: meta.genres || [],
              altTitles: meta.altTitles || [],
            });
          }
        } else if (urlLower.includes('weebcentral') || nameLower.includes('weeb')) {
          const scraped = await fetchWeebCentralSeriesMetadata(cand.url);
          if (scraped) {
            sourceResults.push({
              sourceName: cand.name || 'Weeb Central',
              sourceUrl: cand.url,
              title: scraped.title,
              description: scraped.description,
              coverImage: scraped.coverImage,
              covers: scraped.coverImage ? [{ url: scraped.coverImage, label: 'Official Artwork (Weeb Central)' }] : [],
              genres: scraped.genres || [],
              rating: scraped.rating,
            });
          }
        } else if (urlLower.includes('flamecomics') || nameLower.includes('flame')) {
          const ctx = await fetchFlameSeriesContext(cand.url);
          if (ctx?.matchedSeries) {
            const thumb = ctx.matchedSeries.thumb;
            sourceResults.push({
              sourceName: cand.name || 'Flame Comics',
              sourceUrl: cand.url,
              title: ctx.matchedSeries.title,
              description: ctx.matchedSeries.synopsis,
              coverImage: thumb,
              covers: thumb ? [{ url: thumb, label: 'Series Poster (Flame Comics)' }] : [],
              genres: ctx.matchedSeries.genres || [],
            });
          }
        } else {
          const scraped = await fetchWeebCentralSeriesMetadata(cand.url).catch(() => null);
          if (scraped && (scraped.title || scraped.coverImage)) {
            sourceResults.push({
              sourceName: cand.name,
              sourceUrl: cand.url,
              title: scraped.title,
              description: scraped.description,
              coverImage: scraped.coverImage,
              covers: scraped.coverImage ? [{ url: scraped.coverImage, label: cand.name }] : [],
              genres: scraped.genres || [],
            });
          }
        }
      } catch (_) {}
    }),
  ]);

  res.json({
    success: true,
    current: {
      id: manga.id,
      title: manga.title,
      description: manga.description,
      coverImage: manga.coverImage,
      rating: manga.rating,
      genres: manga.genres,
      altTitles: manga.altTitles,
      metadataOverrides: manga.metadataOverrides || [],
    },
    sources: sourceResults,
  });
});

// ── POST /api/manga/:id/custom-metadata-update - Lock / Override Metadata ────
mangaRouter.post('/:id/custom-metadata-update', (req, res) => {
  if (!canWriteCatalog(req)) return rejectCatalogWrite(res);
  const { id } = req.params;
  const manga = SqliteDb.getMangaById(id) || mangaDatabase.find((m) => m.id === id);
  if (!manga) return res.status(404).json({ error: 'Manga not found' });
  if (!canModifyManga(req, manga)) {
    return res.status(403).json({ error: 'Forbidden', message: "You do not have permission to modify another user's series." });
  }

  const {
    title,
    description,
    coverImage,
    rating,
    genres,
    altTitles,
    isNsfw,
    metadataOverrides,
  } = req.body || {};

  const updated: MangaItem = { ...manga };

  if (typeof title === 'string' && title.trim()) updated.title = title.trim();
  if (typeof description === 'string') updated.description = description.trim();
  if (typeof coverImage === 'string' && coverImage.trim()) updated.coverImage = coverImage.trim();
  if (typeof rating === 'number' && !isNaN(rating)) updated.rating = rating;
  if (typeof isNsfw === 'boolean') updated.isNsfw = isNsfw;
  if (Array.isArray(genres)) updated.genres = Array.from(new Set(genres.map(String).filter(Boolean)));
  if (Array.isArray(altTitles)) updated.altTitles = Array.from(new Set(altTitles.map(String).filter(Boolean)));
  if (Array.isArray(metadataOverrides)) {
    updated.metadataOverrides = Array.from(new Set(metadataOverrides.map(String).filter(Boolean)));
  }

  updated.lastUpdated = new Date().toISOString();

  SqliteDb.upsertManga(updated);
  const idx = mangaDatabase.findIndex((m) => m.id === id);
  if (idx !== -1) mangaDatabase[idx] = updated;
  saveDatabaseToDisk();

  res.json({
    success: true,
    manga: updated,
    message: 'Metadata and artwork updated successfully',
  });
});

// ── GET /api/manga/:id/find-sources - Search Alternative Sources ──────────────
mangaRouter.get('/:id/find-sources', async (req, res) => {
  const { id } = req.params;
  const manga = SqliteDb.getMangaById(id) || mangaDatabase.find((m) => m.id === id);
  if (!manga) return res.status(404).json({ error: 'Manga not found' });

  const queryParam = ((req.query.q as string) || '').trim();
  const query = queryParam || manga.title;
  const results: any[] = [];
  const seenUrls = new Set<string>();
  if (manga.sourceUrl) seenUrls.add(manga.sourceUrl.toLowerCase());

  const candidateSources = KOTATSU_SOURCES.filter(
    (s) => s.id !== 'mangadex' && !disabledSourceIds.has(s.id) && isSourceAlive(s.id)
  ).slice(0, 12);

  await Promise.allSettled(
    candidateSources.map(async (sourceDef) => {
      try {
        let items: any[] = [];
        if (sourceDef.id === 'weebcentral') {
          const weebResults = await searchWeebCentral(query);
          items = weebResults.map((s) => ({
            sourceName: 'Weeb Central',
            sourceId: 'weebcentral',
            sourceUrl: s.sourceUrl,
            title: s.title,
            coverImage: s.coverImage,
          }));
        } else if (sourceDef.id === 'asurascans') {
          const cleanQuery = query.replace(/^asura_/i, '').replace(/[-_]/g, ' ').trim();
          const asuraRes = await fetch(`https://api.asurascans.com/api/series?search=${encodeURIComponent(cleanQuery || query)}`, {
            headers: ASURA_API_HEADERS,
            signal: AbortSignal.timeout(6000),
          });
          if (asuraRes.ok) {
            const json = await asuraRes.json();
            const data: any[] = Array.isArray(json?.data) ? json.data : [];
            items = data.map((s: any) => ({
              sourceName: 'Asura Scans',
              sourceId: 'asurascans',
              sourceUrl: `https://asurascans.com${s.public_url || `/comics/${s.slug || s.id}`}`,
              title: s.title || 'Unknown',
              coverImage: s.cover || '',
              latestChapter: s.latest_chapter || s.total_chapters || undefined,
            }));
          }
        } else {
          let searchUrl = `${sourceDef.baseUrl}/?s=${encodeURIComponent(query)}`;
          if (sourceDef.engineType === 'madara' || sourceDef.engineType === 'wpcomics') {
            searchUrl = `${sourceDef.baseUrl}/?s=${encodeURIComponent(query)}&post_type=wp-manga`;
          } else if (sourceDef.engineType === 'foolslide') {
            searchUrl = `${sourceDef.baseUrl}/search?search=${encodeURIComponent(query)}`;
          }
          const bypassRes = await fetchWithChallengeBypass(searchUrl, {
            headers: {
              'User-Agent': APP_USER_AGENT,
              Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
            timeoutMs: 6000,
            sourceId: sourceDef.id,
          });
          if (bypassRes.ok && bypassRes.html) {
            const $ = cheerio.load(bypassRes.html);
            const origin = sourceDef.baseUrl.replace(/\/$/, '');
            const resolveHref = (href: string) => (href.startsWith('http') ? href : `${origin}${href.startsWith('/') ? '' : '/'}${href}`);
            const resolveCover = (el: any) => {
              const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src') || '';
              return src.startsWith('http') ? src : src ? `${origin}${src}` : '';
            };

            $('.listupd .bsx, .listupd .bs, .page-item-detail, .c-tabs-item__content').each((_i, el) => {
              const a = $(el).find('a').first();
              const href = a.attr('href') || '';
              const title = ($(el).find('.tt, .bigor .tt, .post-title a, h3, h4').text() || a.attr('title') || '').trim();
              const cover = resolveCover($(el).find('img').first());
              if (href && title && isContentPath(href) && !isNavText(title)) {
                items.push({
                  sourceName: sourceDef.name,
                  sourceId: sourceDef.id,
                  sourceUrl: resolveHref(href),
                  title,
                  coverImage: cover || '',
                });
              }
            });
          }
        }

        for (const item of items) {
          if (!item.sourceUrl) continue;
          const urlKey = item.sourceUrl.toLowerCase();
          if (seenUrls.has(urlKey)) continue;
          seenUrls.add(urlKey);

          const qNorm = query.toLowerCase().replace(/[^a-z0-9]/g, '');
          const tNorm = (item.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          const isExact = qNorm.length > 0 && (qNorm === tNorm || tNorm.includes(qNorm) || qNorm.includes(tNorm));
          const confidence = qNorm === tNorm ? 'exact' : isExact ? 'high' : 'partial';

          results.push({
            ...item,
            confidence,
            isCurrent: manga.sourceUrl ? item.sourceUrl.toLowerCase() === manga.sourceUrl.toLowerCase() : false,
          });
        }
      } catch {}
    })
  );

  const dbMatches = SqliteDb.getAllManga().filter((m) => {
    if (m.id === manga.id || !m.sourceUrl) return false;
    if (isMangaDexSourceLink(m.sourceName, m.sourceUrl)) return false;
    const mTitleNorm = m.title.toLowerCase().replace(/[^a-z0-9]/g, '');
    const qNorm = query.toLowerCase().replace(/[^a-z0-9]/g, '');
    return mTitleNorm === qNorm || mTitleNorm.includes(qNorm);
  });

  for (const dbm of dbMatches) {
    if (!dbm.sourceUrl) continue;
    const urlKey = dbm.sourceUrl.toLowerCase();
    if (!seenUrls.has(urlKey)) {
      seenUrls.add(urlKey);
      results.push({
        sourceName: dbm.sourceName,
        sourceId: dbm.sourceName.toLowerCase().replace(/[^a-z0-9]/g, ''),
        sourceUrl: dbm.sourceUrl,
        title: dbm.title,
        coverImage: dbm.coverImage,
        latestChapter: dbm.latestChapter,
        confidence: 'exact',
        isCurrent: false,
      });
    }
  }

  results.sort((a, b) => {
    const score = (c: string) => (c === 'exact' ? 3 : c === 'high' ? 2 : 1);
    return score(b.confidence) - score(a.confidence);
  });

  res.json({
    mangaId: manga.id,
    title: manga.title,
    query,
    count: results.length,
    results,
  });
});

// ── POST /api/manga/:id/attach-source - Attach / Link Alternative Source ───────
mangaRouter.post('/:id/attach-source', (req, res) => {
  if (!canWriteCatalog(req)) return rejectCatalogWrite(res);
  const { id } = req.params;
  const existing = SqliteDb.getMangaById(id) || mangaDatabase.find((m) => m.id === id);
  if (!existing) return res.status(404).json({ error: 'Manga not found' });
  if (!canModifyManga(req, existing)) {
    return res.status(403).json({ error: 'Forbidden', message: "You do not have permission to modify another user's series." });
  }

  const { sourceName, sourceUrl, latestChapter, coverImage, setAsPrimary = true } = req.body || {};
  if (!sourceUrl) return res.status(400).json({ error: 'Missing sourceUrl' });

  const newSourceName = sourceName || 'Live Source';
  const available = Array.isArray(existing.availableSources) ? [...existing.availableSources] : [];

  if (!available.some((s) => s.sourceUrl.toLowerCase() === sourceUrl.toLowerCase())) {
    available.push({ sourceName: newSourceName, sourceUrl });
  }

  const updatedItem: MangaItem = {
    ...existing,
    sourceName: setAsPrimary ? newSourceName : existing.sourceName,
    sourceUrl: setAsPrimary ? sourceUrl : existing.sourceUrl,
    coverImage: setAsPrimary && coverImage && !existing.coverImage ? coverImage : existing.coverImage,
    latestChapter: latestChapter && Number(latestChapter) > (existing.latestChapter || 0) ? Number(latestChapter) : existing.latestChapter,
    availableSources: available,
    lastUpdated: new Date().toISOString(),
  };

  if (updatedItem.isFlagged && (!updatedItem.flagReason || updatedItem.flagReason.toLowerCase().includes('missing source'))) {
    updatedItem.isFlagged = false;
    updatedItem.flagReason = undefined;
    updatedItem.flaggedAt = undefined;
  }

  syncAddOrUpdateManga(updatedItem);
  const uid = resolveRequestUserId(req);
  if (uid) {
    SqliteDb.setUserFavorite(uid, updatedItem.id, true);
  }

  res.json({
    success: true,
    manga: uid ? SqliteDb.applyUserOverlay([updatedItem], uid)[0] : updatedItem,
    message: `Linked ${newSourceName} to '${updatedItem.title}' successfully!`,
  });
});

// ── POST /api/manga/refresh-all-metadata - Bulk Refresh ───────────────────────
mangaRouter.post('/refresh-all-metadata', async (_req, res) => {
  try {
    console.log(`[Metadata Engine] Starting bulk metadata refresh for all ${mangaDatabase.length} series...`);
    let refreshedCount = 0;

    const batchSize = 5;
    for (let i = 0; i < mangaDatabase.length; i += batchSize) {
      const batch = mangaDatabase.slice(i, i + batchSize);
      await Promise.all(batch.map((m) => refreshSingleMangaMetadata(m).catch(() => m)));
      refreshedCount += batch.length;
    }

    autoUpdateLogs.unshift({
      id: `log-${Date.now()}`,
      mangaId: 'bulk-refresh',
      mangaTitle: 'Bulk Metadata Refresh',
      previousChapter: 0,
      newChapter: refreshedCount,
      source: 'Metadata Refresh Engine',
      timestamp: new Date().toISOString(),
      type: 'manhwa',
    });
    if (autoUpdateLogs.length > 50) autoUpdateLogs.pop();

    saveDatabaseToDisk();
    res.json({
      success: true,
      updatedCount: refreshedCount,
      totalCount: mangaDatabase.length,
      message: `Successfully refreshed metadata for ${refreshedCount} series.`,
    });
  } catch (err: any) {
    console.error('[Metadata Engine] Error during bulk metadata refresh:', err);
    res.status(500).json({ error: 'Bulk metadata refresh failed', details: err.message });
  }
});

// ── PUT /api/manga/:id - Update Single Manga ──────────────────────────────────
mangaRouter.put('/:id', (req, res) => {
  if (!canWriteCatalog(req)) return rejectCatalogWrite(res);
  const { id } = req.params;
  const existing = SqliteDb.getMangaById(id);
  if (!existing) return res.status(404).json({ error: 'Manga not found' });
  if (!canModifyManga(req, existing)) {
    return res.status(403).json({ error: 'Forbidden', message: "You do not have permission to modify another user's series." });
  }

  const body = req.body || {};
  const updatedItem: MangaItem = {
    ...existing,
    title: body.title !== undefined ? String(body.title) : existing.title,
    altTitles: body.altTitles !== undefined ? (Array.isArray(body.altTitles) ? body.altTitles : existing.altTitles) : existing.altTitles,
    type: body.type !== undefined ? (['manga', 'manhwa', 'manhua'].includes(body.type) ? body.type : existing.type) : existing.type,
    coverImage: body.coverImage !== undefined ? String(body.coverImage) : existing.coverImage,
    description: body.description !== undefined ? String(body.description) : existing.description,
    genres: body.genres !== undefined ? (Array.isArray(body.genres) ? body.genres : existing.genres) : existing.genres,
    status: body.status !== undefined ? (String(body.status) as MangaItem['status']) : existing.status,
    currentChapter: body.currentChapter !== undefined ? Number(body.currentChapter) || 0 : existing.currentChapter,
    totalChapters: body.totalChapters !== undefined ? (body.totalChapters ? Number(body.totalChapters) : null) : existing.totalChapters,
    rating: body.rating !== undefined ? Number(body.rating) || 0 : existing.rating,
    sourceUrl: body.sourceUrl !== undefined ? String(body.sourceUrl) : existing.sourceUrl,
    sourceName: body.sourceName !== undefined ? String(body.sourceName) : existing.sourceName,
    autoUpdateEnabled: body.autoUpdateEnabled !== undefined ? Boolean(body.autoUpdateEnabled) : existing.autoUpdateEnabled,
    notes: body.notes !== undefined ? String(body.notes) : existing.notes,
    isFavorite: body.isFavorite !== undefined ? Boolean(body.isFavorite) : existing.isFavorite,
    isFlagged: body.isFlagged !== undefined ? Boolean(body.isFlagged) : existing.isFlagged,
    flagReason: body.flagReason !== undefined ? String(body.flagReason) : existing.flagReason,
    isNsfw: body.isNsfw !== undefined ? Boolean(body.isNsfw) : body.genres ? isNsfwManga(body) : existing.isNsfw,
    metadataOverrides: body.metadataOverrides !== undefined ? (Array.isArray(body.metadataOverrides) ? body.metadataOverrides : existing.metadataOverrides) : existing.metadataOverrides,
    categories: existing.categories,
    lastUpdated: new Date().toISOString(),
  };

  syncAddOrUpdateManga(updatedItem);
  const uid = resolveRequestUserId(req) || 'usr_guest';
  if (body.isFavorite !== undefined) {
    SqliteDb.setUserFavorite(uid, updatedItem.id, Boolean(body.isFavorite));
  }
  if (body.categories !== undefined && Array.isArray(body.categories)) {
    SqliteDb.setMangaCategories(updatedItem.id, body.categories, uid);
  }
  res.json(uid ? SqliteDb.applyUserOverlay([updatedItem], uid)[0] : updatedItem);
});

// ── POST /api/manga/increment/:id - Quick Chapter Read Increment ──────────────
mangaRouter.post('/increment/:id', (req, res) => {
  const { id } = req.params;
  const existing = SqliteDb.getMangaById(id);
  if (!existing) return res.status(404).json({ error: 'Manga not found' });

  const userId = resolveRequestUserId(req) || 'usr_guest';
  const overlay = SqliteDb.applyUserOverlay([existing], userId)[0];
  const newChapter = (Number(overlay.currentChapter) || 0) + 1;
  SqliteDb.setUserLibraryChapter(userId, id, newChapter, {
    status: overlay.status === 'plan_to_read' ? 'reading' : overlay.status,
  });
  SqliteDb.setUserFavorite(userId, id, true);
  const updated = SqliteDb.applyUserOverlay([existing], userId)[0];
  res.json(updated);
});

// ── POST /api/manga/toggle-favorite - Toggle Favorite Status ──────────────────
mangaRouter.post('/toggle-favorite', (req, res) => {
  const { id, isFavorite } = req.body || {};
  if (!id) return res.status(400).json({ error: 'Missing manga id' });

  const existing = SqliteDb.getMangaById(id);
  if (!existing) return res.status(404).json({ error: 'Manga not found' });

  const userId = resolveRequestUserId(req) || 'usr_guest';
  SqliteDb.setUserFavorite(userId, String(id), Boolean(isFavorite));
  const updated = SqliteDb.applyUserOverlay([existing], userId)[0];
  res.json({ success: true, manga: updated });
});

// ── POST /api/manga/toggle-flag - Toggle Broken / Error Flag ──────────────────
mangaRouter.post('/toggle-flag', (req, res) => {
  if (!canWriteCatalog(req)) return rejectCatalogWrite(res);
  const { id, isFlagged, flagReason } = req.body || {};
  if (!id) return res.status(400).json({ error: 'Missing manga id' });

  const existing = SqliteDb.getMangaById(id) || mangaDatabase.find((m) => m.id === id);
  if (existing) {
    existing.isFlagged = Boolean(isFlagged);
    existing.flagReason = flagReason || (isFlagged ? 'Flagged for loading errors' : undefined);
    existing.flaggedAt = isFlagged ? new Date().toISOString() : undefined;
    syncAddOrUpdateManga(existing);

    if (isFlagged && flagReason?.includes('loading failed')) {
      console.log(`[Flag Resolution Engine] Attempting automatic source recovery for ${existing.title}`);
      setTimeout(() => {
        const flaggedManga = SqliteDb.getMangaById(id);
        if (flaggedManga && flaggedManga.autoUpdateEnabled) {
          setImmediate(() => {
            refreshSingleMangaMetadata(flaggedManga)
              .then((updated) => {
                if (updated) syncAddOrUpdateManga(updated);
              })
              .catch(console.error);
          });
        }
      }, 5000);
    }
  }

  res.json({ success: true, manga: existing });
});

// ── DELETE /api/manga/:id - Delete Series From Library ─────────────────────────
mangaRouter.delete('/:id', (req, res) => {
  if (!canWriteCatalog(req)) return rejectCatalogWrite(res);
  const { id } = req.params;
  const existing = SqliteDb.getMangaById(id) || mangaDatabase.find((m) => m.id === id);
  if (existing && !canModifyManga(req, existing)) {
    return res.status(403).json({ error: 'Forbidden', message: "You do not have permission to delete another user's series." });
  }
  syncDeleteManga(id);
  res.json({ success: true, message: 'Deleted successfully from SQLite and persistent database' });
});
