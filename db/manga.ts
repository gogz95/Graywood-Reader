import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { db } from './connection';
import { MangaItem, isNsfwManga } from '../src/types';
import { logger } from '../server/logger';

// Prepared Statements for Sub-millisecond Execution
const stmtGetAllManga = db.prepare('SELECT * FROM manga ORDER BY lastUpdated DESC');
const stmtGetMangaById = db.prepare('SELECT * FROM manga WHERE id = ?');
const stmtGetMangaByApiId = db.prepare('SELECT * FROM manga WHERE apiId = ?');

const stmtUpsertManga = db.prepare(`
  INSERT INTO manga (
    id, title, altTitles, type, coverImage, description, genres, status,
    currentChapter, totalChapters, latestChapter, lastUpdated, rating,
    sourceUrl, sourceName, availableSources, autoUpdateEnabled, notes, addedAt, lastReadAt,
    syncedFromApi, apiId, userId, isFavorite, isFlagged, flagReason, flaggedAt, metadataOverrides, customTags, categories, isNsfw
  ) VALUES (
    @id, @title, @altTitles, @type, @coverImage, @description, @genres, @status,
    @currentChapter, @totalChapters, @latestChapter, @lastUpdated, @rating,
    @sourceUrl, @sourceName, @availableSources, @autoUpdateEnabled, @notes, @addedAt, @lastReadAt,
    @syncedFromApi, @apiId, @userId, @isFavorite, @isFlagged, @flagReason, @flaggedAt, @metadataOverrides, @customTags, @categories, @isNsfw
  ) ON CONFLICT(id) DO UPDATE SET
    title=excluded.title,
    altTitles=excluded.altTitles,
    type=excluded.type,
    coverImage=excluded.coverImage,
    description=excluded.description,
    genres=excluded.genres,
    status=excluded.status,
    currentChapter=excluded.currentChapter,
    totalChapters=excluded.totalChapters,
    latestChapter=excluded.latestChapter,
    lastUpdated=excluded.lastUpdated,
    rating=excluded.rating,
    sourceUrl=excluded.sourceUrl,
    sourceName=excluded.sourceName,
    availableSources=excluded.availableSources,
    autoUpdateEnabled=excluded.autoUpdateEnabled,
    notes=excluded.notes,
    syncedFromApi=excluded.syncedFromApi,
    apiId=excluded.apiId,
    userId=excluded.userId,
    isFavorite=excluded.isFavorite,
    isFlagged=excluded.isFlagged,
    flagReason=excluded.flagReason,
    flaggedAt=excluded.flaggedAt,
    metadataOverrides=excluded.metadataOverrides,
    customTags=excluded.customTags,
    categories=excluded.categories,
    isNsfw=excluded.isNsfw
`);

const stmtUpdateProgress = db.prepare(`
  UPDATE manga SET currentChapter = ?, lastReadAt = ? WHERE id = ?
`);

const stmtToggleFavorite = db.prepare(`
  UPDATE manga SET isFavorite = ? WHERE id = ?
`);

const stmtToggleFlag = db.prepare(`
  UPDATE manga SET isFlagged = ?, flagReason = ?, flaggedAt = ? WHERE id = ?
`);

const stmtDeleteManga = db.prepare(`
  DELETE FROM manga WHERE id = ?
`);

const stmtDeleteMangaByUserId = db.prepare(`
  DELETE FROM manga WHERE userId = ?
`);

// Prepared Statements for cross-table operations in bulkUpsertManga
const stmtUpsertUserLibraryState = db.prepare(`
  INSERT INTO user_library_state (user_id, manga_id, current_chapter, last_read_at, status)
  VALUES (@user_id, @manga_id, @current_chapter, @last_read_at, @status)
  ON CONFLICT(user_id, manga_id) DO UPDATE SET
    current_chapter = CASE
      WHEN excluded.current_chapter > COALESCE(user_library_state.current_chapter, 0) THEN excluded.current_chapter
      ELSE user_library_state.current_chapter
    END,
    last_read_at = CASE
      WHEN excluded.current_chapter >= COALESCE(user_library_state.current_chapter, 0) THEN excluded.last_read_at
      ELSE user_library_state.last_read_at
    END,
    status = COALESCE(excluded.status, user_library_state.status)
`);

const stmtUpsertUserFavorite = db.prepare(`
  INSERT INTO user_favorites (user_id, manga_id, is_favorite, updated_at)
  VALUES (@user_id, @manga_id, @is_favorite, @updated_at)
  ON CONFLICT(user_id, manga_id) DO UPDATE SET
    is_favorite = excluded.is_favorite,
    updated_at = excluded.updated_at
`);

const stmtUpsertReadingProgress = db.prepare(`
  INSERT INTO reading_progress (manga_id, user_id, chapter_number, page_index, page_count, percent, last_read_at)
  VALUES (@manga_id, @user_id, @chapter_number, @page_index, @page_count, @percent, @last_read_at)
  ON CONFLICT(manga_id, user_id, chapter_number) DO UPDATE SET
    page_index = excluded.page_index,
    page_count = excluded.page_count,
    percent = excluded.percent,
    last_read_at = excluded.last_read_at
`);

const stmtInsertMangaCategory = db.prepare('INSERT OR IGNORE INTO manga_categories (manga_id, category_id, user_id) VALUES (?, ?, ?)');

// Helper Serializers & Deserializers
export function mapRowToMangaItem(row: any): MangaItem {
  const metadataOverrides: string[] = row.metadataOverrides ? JSON.parse(row.metadataOverrides) : [];
  const isOverrideSet = metadataOverrides.includes('isNsfw');
  const dbIsNsfw = row.isNsfw !== undefined && row.isNsfw !== null ? Boolean(row.isNsfw) : false;

  const item: MangaItem = {
    ...row,
    altTitles: row.altTitles ? JSON.parse(row.altTitles) : [],
    genres: row.genres ? JSON.parse(row.genres) : [],
    availableSources: row.availableSources ? JSON.parse(row.availableSources) : [],
    autoUpdateEnabled: Boolean(row.autoUpdateEnabled),
    isFavorite: Boolean(row.isFavorite),
    isFlagged: Boolean(row.isFlagged),
    flagReason: row.flagReason || undefined,
    flaggedAt: row.flaggedAt || undefined,
    metadataOverrides,
    customTags: row.customTags ? JSON.parse(row.customTags) : [],
    categories: row.categories ? JSON.parse(row.categories) : [],
    isNsfw: false,
    currentChapter: Number(row.currentChapter) || 0,
    latestChapter: Number(row.latestChapter) || 1,
    totalChapters: row.totalChapters ? Number(row.totalChapters) : null,
    rating: Number(row.rating) || 9.0,
  };

  item.isNsfw = isOverrideSet ? dbIsNsfw : (dbIsNsfw || isNsfwManga(item));
  return item;
}

export function mapMangaItemToRow(item: MangaItem) {
  const metadataOverrides = Array.isArray(item.metadataOverrides) ? item.metadataOverrides : [];
  const isOverrideSet = metadataOverrides.includes('isNsfw');
  const effectiveIsNsfw = isOverrideSet ? Boolean(item.isNsfw) : (Boolean(item.isNsfw) || isNsfwManga(item));

  return {
    id: item.id,
    title: item.title || 'Untitled Series',
    altTitles: JSON.stringify(item.altTitles || []),
    type: item.type || 'manhwa',
    coverImage: item.coverImage || '',
    description: item.description || '',
    genres: JSON.stringify(item.genres || []),
    status: item.status || 'reading',
    currentChapter: item.currentChapter || 0,
    totalChapters: item.totalChapters || null,
    latestChapter: item.latestChapter || 1,
    lastUpdated: item.lastUpdated || new Date().toISOString(),
    rating: item.rating || 9.0,
    sourceUrl: item.sourceUrl || '',
    sourceName: item.sourceName || 'MangaDex API',
    availableSources: JSON.stringify(item.availableSources || []),
    autoUpdateEnabled: item.autoUpdateEnabled ? 1 : 0,
    notes: item.notes || '',
    addedAt: item.addedAt || new Date().toISOString(),
    lastReadAt: item.lastReadAt || new Date().toISOString(),
    syncedFromApi: item.syncedFromApi || '',
    apiId: item.apiId || '',
    userId: item.userId || null,
    isFavorite: item.isFavorite ? 1 : 0,
    isFlagged: item.isFlagged ? 1 : 0,
    flagReason: item.flagReason || null,
    flaggedAt: item.flaggedAt || (item.isFlagged ? new Date().toISOString() : null),
    metadataOverrides: JSON.stringify(item.metadataOverrides || []),
    customTags: JSON.stringify(item.customTags || []),
    categories: '[]',
    isNsfw: effectiveIsNsfw ? 1 : 0,
  };
}

export function purgeReaperScans(): number {
  try {
    const info = db.prepare(`DELETE FROM manga WHERE sourceUrl LIKE '%reaperscans.com%' OR sourceName LIKE '%Reaper Scans%'`).run();
    return info.changes;
  } catch (err) {
    return 0;
  }
}

export function purgeTestRemnants(): number {
  try {
    const info = db.prepare(`
      DELETE FROM manga 
      WHERE id LIKE 'test_backup_%'
         OR id LIKE 'manga_mig_%'
         OR id LIKE 'tachi_prog_%'
         OR title = 'Safe Adventure Story'
         OR title = 'Adult Smut Explicit Story'
         OR title = 'Solo Backup Leveling'
         OR title LIKE '%Server Migration Edition%'
         OR (title = 'Solo Leveling' AND coverImage LIKE '%unsplash.com%')
    `).run();
    if (info.changes > 0) {
      logger.info('SQLite', `Cleaned up ${info.changes} test remnant series from database`);
    }
    return info.changes;
  } catch (err: any) {
    logger.warn('SQLite', 'Failed to purge test remnants', { error: err?.message });
    return 0;
  }
}

export function rekeyCollidedSourceIds(): number {
  const rows = db.prepare('SELECT id, sourceUrl FROM manga').all() as { id: string; sourceUrl: string | null }[];
  const upd = db.prepare('UPDATE manga SET id = ? WHERE id = ?');
  const tx = db.transaction((list: { id: string; sourceUrl: string | null }[]) => {
    let rekeyed = 0;
    for (const row of list) {
      const srcUrl = (row.sourceUrl || '').replace(/\/+$/, '');
      if (!srcUrl) continue;
      const oldSig = Buffer.from(srcUrl).toString('base64url').substring(0, 16);
      if (!row.id.endsWith('_' + oldSig)) continue;
      const prefix = row.id.slice(0, row.id.length - 17);
      const newId = `${prefix}_${crypto.createHash('sha256').update(srcUrl).digest('hex').slice(0, 24)}`;
      if (newId !== row.id) {
        try { upd.run(newId, row.id); rekeyed++; } catch (e) { }
      }
    }
    return rekeyed;
  });
  const rekeyed = tx(rows);
  if (rekeyed > 0) console.log(`[SQLite Engine] Re-keyed ${rekeyed} collided source rows to unique IDs.`);
  return rekeyed;
}

export function migrateJsonToSqlite() {
  const jsonPath = path.join(process.cwd(), 'database.json');
  if (!fs.existsSync(jsonPath)) return;

  const countRow = db.prepare('SELECT COUNT(*) as count FROM manga').get() as { count: number };
  if (countRow.count > 0) {
    console.log(`[SQLite Engine] Database already populated with ${countRow.count} series.`);
    return;
  }

  try {
    console.log(`[SQLite Engine] Migrating existing database.json into SQLite...`);
    const raw = fs.readFileSync(jsonPath, 'utf8');
    const data = JSON.parse(raw);
    const seriesList: MangaItem[] = data.mangaDatabase || [];

    const insertMany = db.transaction((list: MangaItem[]) => {
      for (const item of list) {
        stmtUpsertManga.run(mapMangaItemToRow(item));
      }
    });

    insertMany(seriesList);
    const newCount = (db.prepare('SELECT COUNT(*) as count FROM manga').get() as any).count;
    console.log(`[SQLite Engine] Successfully migrated ${newCount} series from database.json to SQLite data/manga.db!`);
  } catch (err) {
    console.error("[SQLite Engine] Migration error:", err);
  }
}

let _mangaCache: MangaItem[] | null = null;

export function invalidateMangaCache() {
  _mangaCache = null;
}

export function getAllManga(): MangaItem[] {
  if (_mangaCache) return _mangaCache;
  const rows = stmtGetAllManga.all();
  _mangaCache = rows.map(mapRowToMangaItem);
  return _mangaCache;
}

export function queryManga(
  options: {
    limit?: number;
    offset?: number;
    isNsfwAllowed?: boolean;
    search?: string;
    type?: string;
    status?: string;
    userId?: string;
    sortBy?: 'lastUpdated' | 'title' | 'rating' | 'lastReadAt';
    order?: 'asc' | 'desc';
  } = {},
  applyUserOverlayFn?: (items: MangaItem[], userId: string | null | undefined) => MangaItem[]
): { items: MangaItem[]; total: number } {
  const clauses: string[] = [];
  const params: Record<string, any> = {};

  if (options.isNsfwAllowed === false) {
    clauses.push('(isNsfw = 0 OR isNsfw IS NULL)');
  }

  if (options.type) {
    clauses.push('type = @type');
    params.type = options.type;
  }

  if (options.status) {
    clauses.push('status = @status');
    params.status = options.status;
  }

  if (options.search && options.search.trim()) {
    clauses.push('(title LIKE @search OR altTitles LIKE @search)');
    params.search = `%${options.search.trim()}%`;
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const countSql = `SELECT COUNT(*) as total FROM manga ${whereSql}`;
  const countRow = db.prepare(countSql).get(params) as { total: number } | undefined;
  const total = countRow ? countRow.total : 0;

  const sortField =
    options.sortBy === 'title'
      ? 'title'
      : options.sortBy === 'rating'
      ? 'rating'
      : options.sortBy === 'lastReadAt'
      ? 'lastReadAt'
      : 'lastUpdated';
  const sortOrder = (options.order || 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  const limit = typeof options.limit === 'number' && options.limit > 0 ? Math.floor(options.limit) : 200;
  const offset = typeof options.offset === 'number' && options.offset >= 0 ? Math.floor(options.offset) : 0;

  params.limit = limit;
  params.offset = offset;

  const dataSql = `SELECT * FROM manga ${whereSql} ORDER BY ${sortField} ${sortOrder} LIMIT @limit OFFSET @offset`;
  const rows = db.prepare(dataSql).all(params);
  let items = rows.map(mapRowToMangaItem);

  if (options.userId && applyUserOverlayFn) {
    items = applyUserOverlayFn(items, options.userId);
  } else {
    items = items.map((m) => ({
      ...m,
      isFavorite: false,
      currentChapter: 0,
      categories: [],
    }));
  }

  return { items, total };
}

export function getMangaById(id: string): MangaItem | null {
  if (_mangaCache) {
    const found = _mangaCache.find((m) => m.id === id);
    if (found) return found;
  }
  const row = stmtGetMangaById.get(id);
  return row ? mapRowToMangaItem(row) : null;
}

export function getMangaByApiId(apiId: string): MangaItem | null {
  if (_mangaCache) {
    const found = _mangaCache.find((m) => m.apiId === apiId);
    if (found) return found;
  }
  const row = stmtGetMangaByApiId.get(apiId);
  return row ? mapRowToMangaItem(row) : null;
}

export function upsertManga(item: MangaItem) {
  _mangaCache = null;
  stmtUpsertManga.run(mapMangaItemToRow(item));
}

export function bulkUpsertManga(items: MangaItem[]) {
  _mangaCache = null;
  const now = new Date().toISOString();
  const transaction = db.transaction((list: MangaItem[]) => {
    for (const item of list) {
      stmtUpsertManga.run(mapMangaItemToRow(item));
      const itemUid = item.userId || 'usr_admin';
      if (item.currentChapter !== undefined || item.status !== undefined || item.lastReadAt !== undefined) {
        stmtUpsertUserLibraryState.run({
          user_id: itemUid,
          manga_id: item.id,
          current_chapter: Math.max(0, Number(item.currentChapter) || 0),
          last_read_at: item.lastReadAt || now,
          status: item.status || null,
        });
      }
      if (item.isFavorite) {
        stmtUpsertUserFavorite.run({
          user_id: itemUid,
          manga_id: item.id,
          is_favorite: 1,
          updated_at: now,
        });
      }
      if (item.currentChapter && Number(item.currentChapter) > 0) {
        stmtUpsertReadingProgress.run({
          manga_id: item.id,
          user_id: itemUid,
          chapter_number: Number(item.currentChapter),
          page_index: 0,
          page_count: 0,
          percent: 100,
          last_read_at: item.lastReadAt || now,
        });
      }
      if (Array.isArray(item.categories) && item.categories.length > 0) {
        for (const cat of item.categories) {
          stmtInsertMangaCategory.run(item.id, String(cat), itemUid);
        }
      }
    }
  });
  transaction(items);
}

export function updateChapterProgress(id: string, chapterNumber: number) {
  _mangaCache = null;
  stmtUpdateProgress.run(chapterNumber, new Date().toISOString(), id);
}

export function toggleFavorite(id: string, isFavorite: boolean) {
  _mangaCache = null;
  stmtToggleFavorite.run(isFavorite ? 1 : 0, id);
}

export function toggleFlag(id: string, isFlagged: boolean, flagReason?: string) {
  _mangaCache = null;
  stmtToggleFlag.run(isFlagged ? 1 : 0, flagReason || null, isFlagged ? new Date().toISOString() : null, id);
}

export function deleteManga(id: string) {
  _mangaCache = null;
  stmtDeleteManga.run(id);
  try {
    db.prepare('DELETE FROM user_favorites WHERE manga_id = ?').run(id);
    db.prepare('DELETE FROM user_library_state WHERE manga_id = ?').run(id);
    db.prepare('DELETE FROM reading_progress WHERE manga_id = ?').run(id);
    db.prepare('DELETE FROM manga_categories WHERE manga_id = ?').run(id);
    db.prepare('DELETE FROM readlist_items WHERE manga_id = ?').run(id);
  } catch {}
}

export function bulkDeleteManga(ids: string[]): number {
  if (!ids || ids.length === 0) return 0;
  _mangaCache = null;
  const deleteTx = db.transaction((idList: string[]) => {
    let count = 0;
    for (const id of idList) {
      const res = stmtDeleteManga.run(id);
      count += res.changes;
      try {
        db.prepare('DELETE FROM user_favorites WHERE manga_id = ?').run(id);
        db.prepare('DELETE FROM user_library_state WHERE manga_id = ?').run(id);
        db.prepare('DELETE FROM reading_progress WHERE manga_id = ?').run(id);
        db.prepare('DELETE FROM manga_categories WHERE manga_id = ?').run(id);
        db.prepare('DELETE FROM readlist_items WHERE manga_id = ?').run(id);
      } catch {}
    }
    return count;
  });
  return deleteTx(ids);
}

export function deleteMangaByUserId(userId: string): number {
  _mangaCache = null;
  const info = stmtDeleteMangaByUserId.run(userId);
  return Number(info.changes) || 0;
}

export function deleteAllManga() {
  _mangaCache = null;
  db.prepare('DELETE FROM manga').run();
  try {
    db.prepare('DELETE FROM user_favorites').run();
    db.prepare('DELETE FROM user_library_state').run();
    db.prepare('DELETE FROM reading_progress').run();
    db.prepare('DELETE FROM manga_categories').run();
    db.prepare('DELETE FROM readlist_items').run();
  } catch {}
}

export function getMangaCount(): number {
  const row = db.prepare('SELECT COUNT(*) as count FROM manga').get() as { count: number };
  return row.count;
}

export function ensureMangaPlaceholder(item: {
  id: string;
  title?: string;
  sourceName?: string;
  sourceUrl?: string;
  coverImage?: string;
  type?: string;
  userId?: string;
  currentChapter?: number;
}): MangaItem {
  const existing = stmtGetMangaById.get(item.id) as any;
  if (existing) {
    return mapRowToMangaItem(existing);
  }
  const cleanTitle = (item.title && item.title.trim()) || item.id.replace(/^manga_|^m_/, '').replace(/[-_]/g, ' ') || 'Untracked Series';
  const now = new Date().toISOString();
  const placeholder: MangaItem = {
    id: item.id,
    title: cleanTitle,
    altTitles: [],
    type: (item.type as any) || 'manhwa',
    coverImage: item.coverImage || '',
    description: 'Auto-registered reading entry',
    genres: [],
    status: 'reading',
    currentChapter: Number(item.currentChapter) || 0,
    totalChapters: null,
    latestChapter: Number(item.currentChapter) || 0,
    lastUpdated: now,
    rating: 0,
    sourceUrl: item.sourceUrl || '',
    sourceName: item.sourceName || 'External Source',
    autoUpdateEnabled: false,
    notes: '',
    addedAt: now,
    lastReadAt: now,
    isFavorite: false,
    categories: [],
    userId: item.userId || 'usr_admin',
  };
  upsertManga(placeholder);
  return placeholder;
}
