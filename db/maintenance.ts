import fs from 'fs';
import path from 'path';
import { db, DB_PATH } from './connection';
import { MangaItem } from '../src/types';
import { mapRowToMangaItem, mapMangaItemToRow, invalidateMangaCache } from './manga';
import { logger } from '../server/logger';

const stmtGetAllManga = db.prepare('SELECT * FROM manga ORDER BY lastUpdated DESC');
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

const stmtUpsertUserLibraryState = db.prepare(`
  INSERT INTO user_library_state (user_id, manga_id, current_chapter, last_read_at, status)
  VALUES (@user_id, @manga_id, @current_chapter, @last_read_at, @status)
  ON CONFLICT(user_id, manga_id) DO UPDATE SET
    current_chapter = excluded.current_chapter,
    last_read_at = excluded.last_read_at,
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

export interface DatabaseMaintenanceResult {
  success: boolean;
  timestamp: string;
  vacuumExecuted: boolean;
  walCheckpointed: boolean;
  expiredCachePurged: number;
  logsTrimmed: number;
  initialSizeBytes: number;
  finalSizeBytes: number;
  freedBytes: number;
  pageCount: number;
}

export function exportFullDatabaseDump(): {
  version: number;
  exportedAt: string;
  manga: MangaItem[];
  categories: any[];
  mangaCategories: any[];
  profiles: any[];
  settings: Record<string, string>;
  readingProgress: any[];
  readingActivity: any[];
  userFavorites: any[];
  userLibraryState: any[];
  pageStickyNotes: any[];
  logs: any[];
} {
  const mangaRows = stmtGetAllManga.all();
  const categories = db.prepare('SELECT * FROM categories').all();
  const mangaCategories = db.prepare('SELECT * FROM manga_categories').all();
  const profiles = db.prepare('SELECT * FROM profiles').all();
  const settingRows = db.prepare('SELECT * FROM settings').all() as Array<{ key: string; value: string }>;
  const readingProgress = db.prepare('SELECT * FROM reading_progress').all();
  const readingActivity = db.prepare('SELECT * FROM reading_activity').all();
  const userFavorites = db.prepare('SELECT * FROM user_favorites').all();
  const userLibraryState = db.prepare('SELECT * FROM user_library_state').all();
  const pageStickyNotes = db.prepare('SELECT * FROM page_sticky_notes').all();
  const logs = db.prepare('SELECT * FROM logs').all();

  const settings: Record<string, string> = {};
  for (const row of settingRows) {
    settings[row.key] = row.value;
  }

  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    manga: mangaRows.map(mapRowToMangaItem),
    categories,
    mangaCategories,
    profiles,
    settings,
    readingProgress,
    readingActivity,
    userFavorites,
    userLibraryState,
    pageStickyNotes,
    logs,
  };
}

export function importFullDatabaseDump(dump: any, options: { mode?: 'replace' | 'merge' } = { mode: 'replace' }): {
  mangaCount: number;
  categoriesCount: number;
  profilesCount: number;
  progressCount: number;
  notesCount: number;
} {
  invalidateMangaCache();
  const mode = options.mode || 'replace';

  const tx = db.transaction(() => {
    if (mode === 'replace') {
      db.exec(`
        DELETE FROM manga_categories;
        DELETE FROM categories;
        DELETE FROM reading_progress;
        DELETE FROM reading_activity;
        DELETE FROM user_favorites;
        DELETE FROM user_library_state;
        DELETE FROM page_sticky_notes;
        DELETE FROM logs;
        DELETE FROM manga;
      `);
    }

    let mangaCount = 0;
    let categoriesCount = 0;
    let profilesCount = 0;
    let progressCount = 0;
    let notesCount = 0;

    const mangaList = Array.isArray(dump.manga)
      ? dump.manga
      : Array.isArray(dump.mangaDatabase)
      ? dump.mangaDatabase
      : Array.isArray(dump.data)
      ? dump.data
      : [];

    const hasExplicitUserLibraryState = Array.isArray(dump.userLibraryState) && dump.userLibraryState.length > 0;
    const hasExplicitUserFavorites = Array.isArray(dump.userFavorites) && dump.userFavorites.length > 0;
    const now = new Date().toISOString();

    for (const item of mangaList) {
      if (item && item.id) {
        stmtUpsertManga.run(mapMangaItemToRow(item));
        mangaCount++;

        const itemUid = item.userId || 'usr_admin';
        if (!hasExplicitUserLibraryState && (item.currentChapter !== undefined || item.status || item.lastReadAt)) {
          stmtUpsertUserLibraryState.run({
            user_id: itemUid,
            manga_id: item.id,
            current_chapter: Math.max(0, Number(item.currentChapter) || 0),
            last_read_at: item.lastReadAt || now,
            status: item.status || null,
          });
          progressCount++;
        }

        if (!hasExplicitUserFavorites && item.isFavorite) {
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
          for (const catIdOrName of item.categories) {
            stmtInsertMangaCategory.run(item.id, String(catIdOrName), itemUid);
          }
        }
      }
    }

    if (Array.isArray(dump.categories)) {
      const stmtCat = db.prepare(`
        INSERT OR REPLACE INTO categories (id, user_id, name, description, color, icon, sort_order, created_at, is_dynamic, rule_type, rule_value)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const cat of dump.categories) {
        if (cat && cat.id) {
          stmtCat.run(
            cat.id,
            cat.user_id || cat.userId || 'usr_admin',
            cat.name || 'Category',
            cat.description || null,
            cat.color || null,
            cat.icon || null,
            Number(cat.sort_order ?? cat.sortOrder) || 0,
            cat.created_at || cat.createdAt || new Date().toISOString(),
            cat.is_dynamic ? 1 : 0,
            cat.rule_type || cat.ruleType || null,
            cat.rule_value || cat.ruleValue || null
          );
          categoriesCount++;
        }
      }
    }

    if (Array.isArray(dump.mangaCategories)) {
      const stmtMC = db.prepare(`
        INSERT OR REPLACE INTO manga_categories (manga_id, category_id, user_id)
        VALUES (?, ?, ?)
      `);
      for (const mc of dump.mangaCategories) {
        if (mc && mc.manga_id && mc.category_id) {
          stmtMC.run(mc.manga_id, mc.category_id, mc.user_id || 'usr_admin');
        }
      }
    }

    const profilesList = Array.isArray(dump.profiles)
      ? dump.profiles
      : Array.isArray(dump.userProfiles)
      ? dump.userProfiles
      : [];
    if (profilesList.length > 0) {
      const stmtProf = db.prepare(`
        INSERT OR REPLACE INTO profiles (id, name, username, email, avatar, role, password, storageFolderPath, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const p of profilesList) {
        if (p && p.id) {
          stmtProf.run(
            p.id,
            p.name || p.username || 'User',
            p.username || p.name || 'user',
            p.email || '',
            p.avatar || '🥷',
            p.role || 'user',
            p.password || '',
            p.storageFolderPath || '',
            p.createdAt || new Date().toISOString()
          );
          profilesCount++;
        }
      }
    }

    const settingsObj = (dump.settings && typeof dump.settings === 'object')
      ? dump.settings
      : (dump.appSettings && typeof dump.appSettings === 'object' ? dump.appSettings : null);
    if (settingsObj) {
      const stmtSet = db.prepare(`
        INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)
      `);
      for (const [k, v] of Object.entries(settingsObj)) {
        if (typeof v === 'string') {
          stmtSet.run(k, v);
        } else if (v !== undefined && v !== null) {
          stmtSet.run(k, JSON.stringify(v));
        }
      }
    }

    if (Array.isArray(dump.readingProgress)) {
      const stmtProg = db.prepare(`
        INSERT OR REPLACE INTO reading_progress (manga_id, user_id, chapter_number, page_index, page_count, percent, last_read_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const r of dump.readingProgress) {
        if (r && r.manga_id && r.user_id) {
          stmtProg.run(
            r.manga_id,
            r.user_id,
            Number(r.chapter_number) || 0,
            Number(r.page_index) || 0,
            Number(r.page_count) || 0,
            Number(r.percent) || 0,
            r.last_read_at || new Date().toISOString()
          );
          progressCount++;
        }
      }
    }

    if (Array.isArray(dump.readingActivity)) {
      const stmtAct = db.prepare(`
        INSERT OR REPLACE INTO reading_activity (date, user_id, chapters_read, minutes_spent)
        VALUES (?, ?, ?, ?)
      `);
      for (const a of dump.readingActivity) {
        if (a && a.date && a.user_id) {
          stmtAct.run(
            a.date,
            a.user_id,
            Number(a.chapters_read) || 0,
            Number(a.minutes_spent) || 0
          );
        }
      }
    }

    if (Array.isArray(dump.userFavorites)) {
      const stmtFav = db.prepare(`
        INSERT OR REPLACE INTO user_favorites (user_id, manga_id, is_favorite, updated_at)
        VALUES (?, ?, ?, ?)
      `);
      for (const f of dump.userFavorites) {
        if (f && f.user_id && f.manga_id) {
          stmtFav.run(
            f.user_id,
            f.manga_id,
            Number(f.is_favorite) ? 1 : 0,
            f.updated_at || new Date().toISOString()
          );
        }
      }
    }

    if (Array.isArray(dump.userLibraryState)) {
      const stmtLib = db.prepare(`
        INSERT OR REPLACE INTO user_library_state (user_id, manga_id, current_chapter, last_read_at, status)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const s of dump.userLibraryState) {
        if (s && s.user_id && s.manga_id) {
          stmtLib.run(
            s.user_id,
            s.manga_id,
            Number(s.current_chapter) || 0,
            s.last_read_at || new Date().toISOString(),
            s.status || null
          );
        }
      }
    }

    if (Array.isArray(dump.pageStickyNotes)) {
      const stmtNote = db.prepare(`
        INSERT OR REPLACE INTO page_sticky_notes (id, manga_id, chapter_number, page_index, note_text, color, created_at, updated_at, user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const n of dump.pageStickyNotes) {
        if (n && n.id && n.manga_id) {
          stmtNote.run(
            n.id,
            n.manga_id,
            Number(n.chapter_number ?? n.chapterNumber) || 0,
            Number(n.page_index ?? n.pageIndex) || 0,
            n.note_text || n.noteText || '',
            n.color || 'yellow',
            n.created_at || n.createdAt || new Date().toISOString(),
            n.updated_at || n.updatedAt || new Date().toISOString(),
            n.user_id || n.userId || 'usr_admin'
          );
          notesCount++;
        }
      }
    }

    return {
      mangaCount,
      categoriesCount,
      profilesCount,
      progressCount,
      notesCount,
    };
  });

  return tx();
}

export async function createLiveDatabaseBackup(destPath: string): Promise<void> {
  const parentDir = path.dirname(destPath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }
  if (fs.existsSync(destPath)) {
    fs.unlinkSync(destPath);
  }
  await db.backup(destPath);
}

export function performDatabaseMaintenance(options: { vacuum?: boolean; purgeExpiredCache?: boolean; trimLogsDays?: number } = {}): DatabaseMaintenanceResult {
  const { vacuum = false, purgeExpiredCache = true, trimLogsDays = 30 } = options;
  const initialSizeBytes = fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).size : 0;
  let expiredCachePurged = 0;
  let logsTrimmed = 0;
  let walCheckpointed = false;
  let vacuumExecuted = false;

  try {
    if (purgeExpiredCache) {
      const now = Date.now();
      const res = db.prepare('DELETE FROM chapter_pages_cache WHERE expires_at < ?').run(now);
      expiredCachePurged = res.changes;
    }

    if (trimLogsDays > 0) {
      const cutoffDate = new Date(Date.now() - trimLogsDays * 24 * 60 * 60 * 1000).toISOString();
      const res = db.prepare('DELETE FROM logs WHERE timestamp < ?').run(cutoffDate);
      logsTrimmed = res.changes;
    }

    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
      walCheckpointed = true;
    } catch (walErr) {
      logger.warn('SQLite', 'WAL checkpoint warning', { error: String(walErr) });
    }

    try {
      db.pragma('optimize');
    } catch (optErr) {
      logger.warn('SQLite', 'PRAGMA optimize warning', { error: String(optErr) });
    }

    if (vacuum) {
      try {
        db.exec('VACUUM');
        vacuumExecuted = true;
      } catch (vacErr) {
        logger.warn('SQLite', 'VACUUM warning', { error: String(vacErr) });
      }
    }

    const finalSizeBytes = fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).size : 0;
    const pageCountRow = db.prepare('PRAGMA page_count').get() as { page_count?: number } | undefined;
    const pageCount = pageCountRow?.page_count || 0;

    const result: DatabaseMaintenanceResult = {
      success: true,
      timestamp: new Date().toISOString(),
      vacuumExecuted,
      walCheckpointed,
      expiredCachePurged,
      logsTrimmed,
      initialSizeBytes,
      finalSizeBytes,
      freedBytes: Math.max(0, initialSizeBytes - finalSizeBytes),
      pageCount,
    };

    logger.info('SQLite', 'Database maintenance completed', { ...result } as Record<string, unknown>);
    return result;
  } catch (err: any) {
    logger.error('SQLite', 'Database maintenance failed', { error: err.message });
    return {
      success: false,
      timestamp: new Date().toISOString(),
      vacuumExecuted,
      walCheckpointed,
      expiredCachePurged,
      logsTrimmed,
      initialSizeBytes,
      finalSizeBytes: fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).size : 0,
      freedBytes: 0,
      pageCount: 0,
    };
  }
}

export function optimizeDatabase(): void {
  try {
    db.pragma('optimize');
  } catch (err) {
    console.warn('[SQLite Engine] PRAGMA optimize notice:', err);
  }
}
