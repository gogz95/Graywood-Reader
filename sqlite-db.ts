import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { MangaItem, UserProfile, AppSettings, AutoUpdateLog, PageStickyNote, UserCategory, isNsfwManga } from './src/types';
import { logger } from './server/logger';

// Ensure data directory exists (cwd-relative so bundled/Docker entrypoints share ./data)
const DATA_DIR = path.join(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = process.env.DB_PATH || (process.env.NODE_ENV === 'test' ? path.join(DATA_DIR, 'test-manga.db') : path.join(DATA_DIR, 'manga.db'));

logger.info('SQLite', 'Initializing SQLite database', { dbPath: DB_PATH });
const db = new Database(DB_PATH);

// Enable WAL Mode for high concurrency and sub-millisecond writes
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');
db.pragma('cache_size = -64000');
db.pragma('temp_store = MEMORY');
db.pragma('mmap_size = 268435456');

// 1. Initialize Tables & Indexes
db.exec(`
  CREATE TABLE IF NOT EXISTS manga (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    altTitles TEXT,
    type TEXT,
    coverImage TEXT,
    description TEXT,
    genres TEXT,
    status TEXT,
    currentChapter INTEGER DEFAULT 0,
    totalChapters INTEGER,
    latestChapter INTEGER DEFAULT 1,
    lastUpdated TEXT,
    rating REAL DEFAULT 9.0,
    sourceUrl TEXT,
    sourceName TEXT,
    autoUpdateEnabled INTEGER DEFAULT 1,
    notes TEXT,
    addedAt TEXT,
    lastReadAt TEXT,
    syncedFromApi TEXT,
    apiId TEXT,
    userId TEXT,
    isFavorite INTEGER DEFAULT 0,
    isFlagged INTEGER DEFAULT 0,
    flagReason TEXT,
    flaggedAt TEXT,
    availableSources TEXT,
    metadataOverrides TEXT,
    customTags TEXT,
    categories TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_manga_title ON manga(title);
  CREATE INDEX IF NOT EXISTS idx_manga_favorite ON manga(isFavorite);
  CREATE INDEX IF NOT EXISTS idx_manga_type ON manga(type);
  CREATE INDEX IF NOT EXISTS idx_manga_updated ON manga(lastUpdated DESC);
  CREATE INDEX IF NOT EXISTS idx_manga_apiId ON manga(apiId);
  CREATE INDEX IF NOT EXISTS idx_manga_rating ON manga(rating DESC);
  CREATE INDEX IF NOT EXISTS idx_manga_lastRead ON manga(lastReadAt DESC);
  CREATE INDEX IF NOT EXISTS idx_manga_status ON manga(status);
  CREATE INDEX IF NOT EXISTS idx_manga_user_updated ON manga(userId, lastUpdated DESC);
  CREATE INDEX IF NOT EXISTS idx_manga_user_favorite ON manga(userId, isFavorite);
  CREATE INDEX IF NOT EXISTS idx_manga_user_lastRead ON manga(userId, lastReadAt DESC);
`);

try { db.exec('ALTER TABLE manga ADD COLUMN availableSources TEXT'); } catch (e) { }
try { db.exec('ALTER TABLE manga ADD COLUMN isFlagged INTEGER DEFAULT 0'); } catch (e) { }
try { db.exec('ALTER TABLE manga ADD COLUMN flagReason TEXT'); } catch (e) { }
try { db.exec('ALTER TABLE manga ADD COLUMN flaggedAt TEXT'); } catch (e) { }
try { db.exec('ALTER TABLE manga ADD COLUMN metadataOverrides TEXT'); } catch (e) { }
try { db.exec('ALTER TABLE manga ADD COLUMN customTags TEXT'); } catch (e) { }
try { db.exec('ALTER TABLE manga ADD COLUMN categories TEXT'); } catch (e) { }
try { db.exec('ALTER TABLE manga ADD COLUMN isNsfw INTEGER DEFAULT 0'); } catch (e) { }

try { db.exec('CREATE INDEX IF NOT EXISTS idx_manga_flagged ON manga(isFlagged)'); } catch (e) { }
try { db.exec('CREATE INDEX IF NOT EXISTS idx_manga_isNsfw ON manga(isNsfw)'); } catch (e) { }
try { db.exec('CREATE INDEX IF NOT EXISTS idx_manga_user_updated ON manga(userId, lastUpdated DESC)'); } catch (e) { }
try { db.exec('CREATE INDEX IF NOT EXISTS idx_manga_user_favorite ON manga(userId, isFavorite)'); } catch (e) { }
try { db.exec('CREATE INDEX IF NOT EXISTS idx_manga_user_lastRead ON manga(userId, lastReadAt DESC)'); } catch (e) { }

db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    color TEXT,
    icon TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT,
    is_dynamic INTEGER DEFAULT 0,
    rule_type TEXT,
    rule_value TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_categories_user_sort ON categories(user_id, sort_order);

  CREATE TABLE IF NOT EXISTS manga_categories (
    manga_id TEXT NOT NULL,
    category_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    PRIMARY KEY (manga_id, category_id, user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_manga_categories_user ON manga_categories(user_id);
  CREATE INDEX IF NOT EXISTS idx_manga_categories_manga ON manga_categories(manga_id);
  CREATE INDEX IF NOT EXISTS idx_manga_categories_cat ON manga_categories(category_id);
  CREATE INDEX IF NOT EXISTS idx_manga_categories_composite ON manga_categories(user_id, category_id, manga_id);
`);

try { db.exec('ALTER TABLE categories ADD COLUMN is_dynamic INTEGER DEFAULT 0'); } catch (e) { }
try { db.exec('ALTER TABLE categories ADD COLUMN rule_type TEXT'); } catch (e) { }
try { db.exec('ALTER TABLE categories ADD COLUMN rule_value TEXT'); } catch (e) { }

try {
  db.exec(`
    DELETE FROM manga_categories WHERE category_id NOT IN (SELECT id FROM categories);
    UPDATE manga SET categories = '[]' WHERE categories IS NOT NULL AND categories != '[]';
  `);
} catch (e) { }

db.exec(`
  CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    username TEXT,
    email TEXT,
    avatar TEXT,
    role TEXT,
    password TEXT,
    storageFolderPath TEXT,
    createdAt TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS logs (
    id TEXT PRIMARY KEY,
    mangaId TEXT,
    mangaTitle TEXT,
    sourceName TEXT,
    previousChapter INTEGER,
    newChapter INTEGER,
    timestamp TEXT,
    status TEXT,
    details TEXT,
    type TEXT
  );

  -- Reading progress / position (resume mid-chapter), modeled on Kotatsu's
  -- HistoryEntity. One row per (manga, user, chapter) so a user can resume a
  -- chapter at the exact page/percent they left off, or continue from history.
  CREATE TABLE IF NOT EXISTS reading_progress (
    manga_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    chapter_number INTEGER NOT NULL,
    page_index INTEGER DEFAULT 0,
    page_count INTEGER DEFAULT 0,
    percent INTEGER DEFAULT 0,
    last_read_at TEXT,
    PRIMARY KEY (manga_id, user_id, chapter_number)
  );

  -- Per-day reading activity, powering the (previously mock) analytics heatmap.
  CREATE TABLE IF NOT EXISTS reading_activity (
    date TEXT NOT NULL,
    user_id TEXT NOT NULL,
    chapters_read INTEGER DEFAULT 0,
    minutes_spent REAL DEFAULT 0,
    PRIMARY KEY (date, user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_read_progress_user ON reading_progress(user_id, last_read_at);
  CREATE INDEX IF NOT EXISTS idx_read_activity_user ON reading_activity(user_id, date);

  -- Per-user favorites (shared catalog rows stay global; library membership is personal)
  CREATE TABLE IF NOT EXISTS user_favorites (
    user_id TEXT NOT NULL,
    manga_id TEXT NOT NULL,
    is_favorite INTEGER DEFAULT 1,
    updated_at TEXT,
    PRIMARY KEY (user_id, manga_id)
  );

  -- Per-user library reading position (current chapter) so users don't clobber each other
  CREATE TABLE IF NOT EXISTS user_library_state (
    user_id TEXT NOT NULL,
    manga_id TEXT NOT NULL,
    current_chapter INTEGER DEFAULT 0,
    last_read_at TEXT,
    status TEXT,
    PRIMARY KEY (user_id, manga_id)
  );

  -- Private page sticky notes (per-user: user_id scopes visibility/ownership)
  CREATE TABLE IF NOT EXISTS page_sticky_notes (
    id TEXT PRIMARY KEY,
    manga_id TEXT NOT NULL,
    chapter_number INTEGER NOT NULL,
    page_index INTEGER NOT NULL,
    note_text TEXT NOT NULL,
    color TEXT DEFAULT 'yellow',
    created_at TEXT,
    updated_at TEXT,
    user_id TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_user_fav_user ON user_favorites(user_id);
  CREATE INDEX IF NOT EXISTS idx_user_lib_user ON user_library_state(user_id, last_read_at);
  CREATE INDEX IF NOT EXISTS idx_sticky_notes_manga ON page_sticky_notes(manga_id, chapter_number);

  -- Persistent revoked token blacklist (logout survives process restarts)
  CREATE TABLE IF NOT EXISTS revoked_tokens (
    jti TEXT PRIMARY KEY,
    revoked_at TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_revoked_tokens_exp ON revoked_tokens(expires_at);

  -- Chapter page URL cache with TTL (sub-millisecond reading access & rate-limit shield)
  CREATE TABLE IF NOT EXISTS chapter_pages_cache (
    manga_id TEXT NOT NULL,
    chapter_number REAL NOT NULL,
    source_url TEXT NOT NULL,
    pages TEXT NOT NULL,
    page_count INTEGER NOT NULL,
    cached_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    PRIMARY KEY (manga_id, chapter_number, source_url)
  );
  CREATE INDEX IF NOT EXISTS idx_chapter_cache_exp ON chapter_pages_cache(expires_at);

  -- Cross-Series Story Arcs & Custom Readlists / Playlists
  CREATE TABLE IF NOT EXISTS readlists (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    cover_image TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_readlists_user ON readlists(user_id);

  CREATE TABLE IF NOT EXISTS readlist_items (
    id TEXT PRIMARY KEY,
    readlist_id TEXT NOT NULL,
    manga_id TEXT NOT NULL,
    chapter_number REAL NOT NULL,
    chapter_title TEXT,
    sort_order INTEGER DEFAULT 0,
    notes TEXT,
    FOREIGN KEY(readlist_id) REFERENCES readlists(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_readlist_items_list ON readlist_items(readlist_id, sort_order);

  -- Persistent Chapter Download Queue & Archive State
  CREATE TABLE IF NOT EXISTS download_jobs (
    id TEXT PRIMARY KEY,
    manga_id TEXT NOT NULL,
    manga_title TEXT NOT NULL,
    chapter_number REAL NOT NULL,
    chapter_title TEXT,
    source_url TEXT,
    source_name TEXT,
    status TEXT NOT NULL,
    current_page INTEGER DEFAULT 0,
    total_pages INTEGER DEFAULT 0,
    bytes_downloaded INTEGER DEFAULT 0,
    percent INTEGER DEFAULT 0,
    error TEXT,
    output_path TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    retries INTEGER DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_download_jobs_status ON download_jobs(status, created_at);
  CREATE INDEX IF NOT EXISTS idx_download_jobs_manga ON download_jobs(manga_id, chapter_number);
`);

try { db.exec('ALTER TABLE page_sticky_notes ADD COLUMN user_id TEXT'); } catch (e) { }
try { db.exec(`UPDATE page_sticky_notes SET user_id = 'usr_admin' WHERE user_id IS NULL`); } catch (e) { }
try { db.exec('CREATE INDEX IF NOT EXISTS idx_sticky_notes_user ON page_sticky_notes(user_id)'); } catch (e) { }

// Migration for logs columns on legacy databases
try { db.exec('ALTER TABLE logs ADD COLUMN mangaId TEXT'); } catch (e) { }
try { db.exec('ALTER TABLE logs ADD COLUMN type TEXT'); } catch (e) { }

// Auto-sanitize ad & spam entries from legacy scrapes/imports (e.g. BUG-044)
try {
  const adRows = db.prepare(`
    SELECT id, title FROM manga
    WHERE title LIKE '%cam model%'
       OR title LIKE '%free live sex show%'
       OR title LIKE '%live sex chat%'
       OR title LIKE '%chaturbate%'
       OR title LIKE '%stripchat%'
       OR title LIKE '%camsoda%'
       OR title LIKE '%slot online%'
       OR title LIKE '%slot gacor%'
       OR id LIKE '%nottobemissed%'
  `).all() as any[];

  if (adRows && adRows.length > 0) {
    const deleteStmt = db.prepare('DELETE FROM manga WHERE id = ?');
    for (const row of adRows) {
      deleteStmt.run(row.id);
      logger.info('SQLite', 'Purged ad/spam item from database', { id: row.id, title: row.title });
    }
  }
} catch (e) { }


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

const stmtDeleteReadingProgressByUserId = db.prepare(`
  DELETE FROM reading_progress WHERE user_id = ?
`);

const stmtDeleteReadingActivityByUserId = db.prepare(`
  DELETE FROM reading_activity WHERE user_id = ?
`);

// ── KV Settings Store (appSettings / syncConfig JSON blobs) ─────────────────
const stmtGetSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
const stmtSetSetting = db.prepare(`
  INSERT INTO settings (key, value) VALUES (@key, @value)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`);

// ── User Profile Persistence ─────────────────────────────────────────────────
const stmtGetAllProfiles = db.prepare('SELECT * FROM profiles ORDER BY createdAt ASC');
const stmtDeleteAllProfiles = db.prepare('DELETE FROM profiles');
const stmtDeleteProfile = db.prepare('DELETE FROM profiles WHERE id = ?');
const stmtUpsertProfile = db.prepare(`
  INSERT INTO profiles (id, name, username, email, avatar, role, password, storageFolderPath, createdAt)
  VALUES (@id, @name, @username, @email, @avatar, @role, @password, @storageFolderPath, @createdAt)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    username = excluded.username,
    email = excluded.email,
    avatar = excluded.avatar,
    role = excluded.role,
    password = excluded.password,
    storageFolderPath = excluded.storageFolderPath,
    createdAt = excluded.createdAt
`);

// ── Auto-Update Log Persistence ──────────────────────────────────────────────
const stmtGetAllLogs = db.prepare('SELECT * FROM logs ORDER BY timestamp DESC');
const stmtDeleteAllLogs = db.prepare('DELETE FROM logs');
const stmtInsertLog = db.prepare(`
  INSERT OR REPLACE INTO logs (id, mangaId, mangaTitle, sourceName, previousChapter, newChapter, timestamp, status, details, type)
  VALUES (@id, @mangaId, @mangaTitle, @sourceName, @previousChapter, @newChapter, @timestamp, @status, @details, @type)
`);

// ── Reading Progress & Activity Persistence ─────────────────────────────────
const stmtUpsertReadingProgress = db.prepare(`
  INSERT INTO reading_progress (manga_id, user_id, chapter_number, page_index, page_count, percent, last_read_at)
  VALUES (@manga_id, @user_id, @chapter_number, @page_index, @page_count, @percent, @last_read_at)
  ON CONFLICT(manga_id, user_id, chapter_number) DO UPDATE SET
    page_index = excluded.page_index,
    page_count = excluded.page_count,
    percent = excluded.percent,
    last_read_at = excluded.last_read_at
`);
const stmtGetReadingProgress = db.prepare(`
  SELECT * FROM reading_progress WHERE manga_id = ? AND user_id = ?
`);
const stmtGetReadingProgressForChapter = db.prepare(`
  SELECT * FROM reading_progress WHERE manga_id = ? AND user_id = ? AND chapter_number = ?
`);
const stmtGetReadingActivity = db.prepare(`
  SELECT * FROM reading_activity WHERE user_id = ? ORDER BY date ASC
`);
const stmtGetReadingProgressByUser = db.prepare(`
  SELECT * FROM reading_progress WHERE user_id = ? ORDER BY last_read_at DESC
`);
const stmtUpsertReadingActivity = db.prepare(`
  INSERT INTO reading_activity (date, user_id, chapters_read, minutes_spent)
  VALUES (@date, @user_id, @chapters_read, @minutes_spent)
  ON CONFLICT(date, user_id) DO UPDATE SET
    chapters_read = excluded.chapters_read,
    minutes_spent = excluded.minutes_spent
`);

// Per-user favorites & library chapter state
const stmtUpsertUserFavorite = db.prepare(`
  INSERT INTO user_favorites (user_id, manga_id, is_favorite, updated_at)
  VALUES (@user_id, @manga_id, @is_favorite, @updated_at)
  ON CONFLICT(user_id, manga_id) DO UPDATE SET
    is_favorite = excluded.is_favorite,
    updated_at = excluded.updated_at
`);
const stmtGetUserFavorites = db.prepare(`
  SELECT manga_id, is_favorite FROM user_favorites WHERE user_id = ? AND is_favorite = 1
`);
const stmtGetUserFavorite = db.prepare(`
  SELECT is_favorite FROM user_favorites WHERE user_id = ? AND manga_id = ?
`);
const stmtDeleteUserFavoritesByUser = db.prepare(`DELETE FROM user_favorites WHERE user_id = ?`);

const stmtUpsertUserLibraryState = db.prepare(`
  INSERT INTO user_library_state (user_id, manga_id, current_chapter, last_read_at, status)
  VALUES (@user_id, @manga_id, @current_chapter, @last_read_at, @status)
  ON CONFLICT(user_id, manga_id) DO UPDATE SET
    current_chapter = excluded.current_chapter,
    last_read_at = excluded.last_read_at,
    status = COALESCE(excluded.status, user_library_state.status)
`);
const stmtGetUserLibraryState = db.prepare(`
  SELECT * FROM user_library_state WHERE user_id = ?
`);
const stmtGetUserLibraryStateOne = db.prepare(`
  SELECT * FROM user_library_state WHERE user_id = ? AND manga_id = ?
`);
const stmtDeleteUserLibraryStateByUser = db.prepare(`DELETE FROM user_library_state WHERE user_id = ?`);

const stmtRevokeToken = db.prepare(`
  INSERT OR REPLACE INTO revoked_tokens (jti, revoked_at, expires_at)
  VALUES (?, ?, ?)
`);
const stmtIsTokenRevoked = db.prepare(`
  SELECT 1 FROM revoked_tokens WHERE jti = ? AND expires_at > ?
`);
const stmtCleanupRevokedTokens = db.prepare(`
  DELETE FROM revoked_tokens WHERE expires_at <= ?
`);

const stmtGetCachedPages = db.prepare(`
  SELECT pages, page_count FROM chapter_pages_cache
  WHERE manga_id = ? AND chapter_number = ? AND source_url = ? AND expires_at > ?
`);
const stmtSetCachedPages = db.prepare(`
  INSERT OR REPLACE INTO chapter_pages_cache (manga_id, chapter_number, source_url, pages, page_count, cached_at, expires_at)
  VALUES (@manga_id, @chapter_number, @source_url, @pages, @page_count, @cached_at, @expires_at)
`);
const stmtCleanupCachedPages = db.prepare(`
  DELETE FROM chapter_pages_cache WHERE expires_at <= ?
`);

// ── Category & Junction Precompiled Statements ──────────────────────────────
const stmtGetCategoriesForUser = db.prepare('SELECT * FROM categories WHERE user_id = ? ORDER BY sort_order ASC, name ASC');
const stmtGetCategoryCountsForUser = db.prepare(`
  SELECT mc.category_id, COUNT(DISTINCT mc.manga_id) as series_count
  FROM manga_categories mc
  WHERE mc.user_id = ?
  GROUP BY mc.category_id
`);
const stmtGetCategoryByIdAndUser = db.prepare('SELECT * FROM categories WHERE id = ? AND user_id = ?');
const stmtInsertCategory = db.prepare(`
  INSERT INTO categories (id, user_id, name, description, color, icon, sort_order, created_at, is_dynamic, rule_type, rule_value)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const stmtUpdateCategory = db.prepare(`
  UPDATE categories SET name = ?, description = ?, color = ?, icon = ?, sort_order = ?, is_dynamic = ?, rule_type = ?, rule_value = ?
  WHERE id = ? AND user_id = ?
`);
const stmtDeleteCategoryMangaLinks = db.prepare('DELETE FROM manga_categories WHERE category_id = ? AND user_id = ?');
const stmtDeleteCategory = db.prepare('DELETE FROM categories WHERE id = ? AND user_id = ?');
const stmtGetMangaCategories = db.prepare('SELECT category_id FROM manga_categories WHERE manga_id = ? AND user_id = ?');
const stmtGetMangaCategoriesAllForUser = db.prepare('SELECT manga_id, category_id FROM manga_categories WHERE user_id = ?');
const stmtInsertMangaCategory = db.prepare('INSERT OR IGNORE INTO manga_categories (manga_id, category_id, user_id) VALUES (?, ?, ?)');
const stmtDeleteMangaCategoryOne = db.prepare('DELETE FROM manga_categories WHERE manga_id = ? AND category_id = ? AND user_id = ?');
const stmtDeleteMangaCategoriesForManga = db.prepare('DELETE FROM manga_categories WHERE manga_id = ? AND user_id = ?');

// ── Readlists & Playlists Precompiled Statements ─────────────────────────────
const stmtGetReadlistsForUser = db.prepare(`
  SELECT r.*, COUNT(ri.id) as items_count
  FROM readlists r
  LEFT JOIN readlist_items ri ON ri.readlist_id = r.id
  WHERE r.user_id = ?
  GROUP BY r.id
  ORDER BY r.updated_at DESC
`);
const stmtGetReadlistById = db.prepare('SELECT * FROM readlists WHERE id = ?');
const stmtGetReadlistItems = db.prepare(`
  SELECT ri.*, m.title as manga_title, m.coverImage as manga_cover, m.sourceUrl as manga_source_url, m.sourceName as manga_source_name
  FROM readlist_items ri
  LEFT JOIN manga m ON m.id = ri.manga_id
  WHERE ri.readlist_id = ?
  ORDER BY ri.sort_order ASC
`);
const stmtInsertReadlist = db.prepare(`
  INSERT INTO readlists (id, user_id, name, description, cover_image, created_at, updated_at)
  VALUES (@id, @userId, @name, @description, @coverImage, @createdAt, @updatedAt)
`);
const stmtUpdateReadlist = db.prepare(`
  UPDATE readlists
  SET name = @name, description = @description, cover_image = @coverImage, updated_at = @updatedAt
  WHERE id = @id AND user_id = @userId
`);
const stmtDeleteReadlist = db.prepare('DELETE FROM readlists WHERE id = ? AND user_id = ?');
const stmtDeleteReadlistItems = db.prepare('DELETE FROM readlist_items WHERE readlist_id = ?');
const stmtInsertReadlistItem = db.prepare(`
  INSERT INTO readlist_items (id, readlist_id, manga_id, chapter_number, chapter_title, sort_order, notes)
  VALUES (@id, @readlistId, @mangaId, @chapterNumber, @chapterTitle, @sortOrder, @notes)
`);
const stmtDeleteReadlistItemById = db.prepare('DELETE FROM readlist_items WHERE id = ? AND readlist_id = ?');

// ── Download Jobs Precompiled Statements ──────────────────────────────────
const stmtGetAllDownloadJobs = db.prepare('SELECT * FROM download_jobs ORDER BY created_at DESC');
const stmtGetDownloadJobById = db.prepare('SELECT * FROM download_jobs WHERE id = ?');
const stmtUpsertDownloadJob = db.prepare(`
  INSERT INTO download_jobs (
    id, manga_id, manga_title, chapter_number, chapter_title,
    source_url, source_name, status, current_page, total_pages,
    bytes_downloaded, percent, error, output_path, created_at,
    started_at, finished_at, retries
  ) VALUES (
    @id, @manga_id, @manga_title, @chapter_number, @chapter_title,
    @source_url, @source_name, @status, @current_page, @total_pages,
    @bytes_downloaded, @percent, @error, @output_path, @created_at,
    @started_at, @finished_at, @retries
  ) ON CONFLICT(id) DO UPDATE SET
    status = excluded.status,
    current_page = excluded.current_page,
    total_pages = excluded.total_pages,
    bytes_downloaded = excluded.bytes_downloaded,
    percent = excluded.percent,
    error = excluded.error,
    output_path = excluded.output_path,
    started_at = excluded.started_at,
    finished_at = excluded.finished_at,
    retries = excluded.retries
`);
const stmtDeleteDownloadJob = db.prepare('DELETE FROM download_jobs WHERE id = ?');
const stmtDeleteCompletedDownloadJobs = db.prepare(`DELETE FROM download_jobs WHERE status IN ('completed', 'cancelled')`);

export interface PersistedDownloadJob {
  id: string;
  mangaId: string;
  mangaTitle: string;
  chapterNumber: number;
  chapterTitle?: string;
  sourceUrl?: string;
  sourceName?: string;
  status: 'queued' | 'downloading' | 'packaging' | 'completed' | 'paused' | 'failed' | 'cancelled';
  progress: {
    current: number;
    total: number;
    percent: number;
    bytesDownloaded: number;
  };
  error?: string | null;
  outputPath?: string | null;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  retries: number;
}

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

function mapRowToDownloadJob(row: any): PersistedDownloadJob {
  return {
    id: row.id,
    mangaId: row.manga_id,
    mangaTitle: row.manga_title,
    chapterNumber: Number(row.chapter_number) || 0,
    chapterTitle: row.chapter_title || undefined,
    sourceUrl: row.source_url || undefined,
    sourceName: row.source_name || undefined,
    status: row.status,
    progress: {
      current: Number(row.current_page) || 0,
      total: Number(row.total_pages) || 0,
      percent: Number(row.percent) || 0,
      bytesDownloaded: Number(row.bytes_downloaded) || 0,
    },
    error: row.error || null,
    outputPath: row.output_path || null,
    createdAt: row.created_at,
    startedAt: row.started_at || null,
    finishedAt: row.finished_at || null,
    retries: Number(row.retries) || 0,
  };
}


// Helper Serializers & Deserializers
function mapRowToMangaItem(row: any): MangaItem {
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

function mapMangaItemToRow(item: MangaItem) {
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

// One-time migration: re-key rows created by the old truncated-base64url ID
// generator (which produced the SAME id for every series on a site, so those
// series collapsed into a single DB row). A row is detected as collided when its
// id ends with exactly the first 16 base64url chars of its own sourceUrl — the
// old generator's signature. It is re-keyed to a sha256 hash of the full href.
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
      const prefix = row.id.slice(0, row.id.length - 17); // strip `_` + 16 sig chars
      const newId = `${prefix}_${crypto.createHash('sha256').update(srcUrl).digest('hex').slice(0, 24)}`;
      if (newId !== row.id) {
        try { upd.run(newId, row.id); rekeyed++; } catch (e) { /* ignore unique collisions */ }
      }
    }
    return rekeyed;
  });
  const rekeyed = tx(rows);
  if (rekeyed > 0) console.log(`[SQLite Engine] Re-keyed ${rekeyed} collided source rows to unique IDs.`);
  return rekeyed;
}

// Data Migration Engine: Automatically imports existing database.json into SQLite
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

// Public Database Service Functions
export const SqliteDb = {
  getAllManga(): MangaItem[] {
    if (_mangaCache) return _mangaCache;
    const rows = stmtGetAllManga.all();
    _mangaCache = rows.map(mapRowToMangaItem);
    return _mangaCache;
  },

  queryManga(options: {
    limit?: number;
    offset?: number;
    isNsfwAllowed?: boolean;
    search?: string;
    type?: string;
    status?: string;
    userId?: string;
    sortBy?: 'lastUpdated' | 'title' | 'rating' | 'lastReadAt';
    order?: 'asc' | 'desc';
  } = {}): { items: MangaItem[]; total: number } {
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

    if (options.userId) {
      items = this.applyUserOverlay(items, options.userId);
    } else {
      items = items.map((m) => ({
        ...m,
        isFavorite: false,
        currentChapter: 0,
        categories: [],
      }));
    }

    return { items, total };
  },

  invalidateMangaCache() {
    _mangaCache = null;
  },

  rekeyCollidedSourceIds(): number {
    _mangaCache = null;
    return rekeyCollidedSourceIds();
  },

  purgeTestRemnants(): number {
    _mangaCache = null;
    return purgeTestRemnants();
  },

  getMangaById(id: string): MangaItem | null {
    if (_mangaCache) {
      const found = _mangaCache.find((m) => m.id === id);
      if (found) return found;
    }
    const row = stmtGetMangaById.get(id);
    return row ? mapRowToMangaItem(row) : null;
  },

  getMangaByApiId(apiId: string): MangaItem | null {
    if (_mangaCache) {
      const found = _mangaCache.find((m) => m.apiId === apiId);
      if (found) return found;
    }
    const row = stmtGetMangaByApiId.get(apiId);
    return row ? mapRowToMangaItem(row) : null;
  },

  upsertManga(item: MangaItem) {
    _mangaCache = null;
    stmtUpsertManga.run(mapMangaItemToRow(item));
  },

  bulkUpsertManga(items: MangaItem[]) {
    _mangaCache = null;
    const transaction = db.transaction((list: MangaItem[]) => {
      for (const item of list) {
        stmtUpsertManga.run(mapMangaItemToRow(item));
      }
    });
    transaction(items);
  },

  updateChapterProgress(id: string, chapterNumber: number) {
    _mangaCache = null;
    stmtUpdateProgress.run(chapterNumber, new Date().toISOString(), id);
  },

  toggleFavorite(id: string, isFavorite: boolean) {
    _mangaCache = null;
    stmtToggleFavorite.run(isFavorite ? 1 : 0, id);
  },

  toggleFlag(id: string, isFlagged: boolean, flagReason?: string) {
    _mangaCache = null;
    stmtToggleFlag.run(isFlagged ? 1 : 0, flagReason || null, isFlagged ? new Date().toISOString() : null, id);
  },

  deleteManga(id: string) {
    _mangaCache = null;
    stmtDeleteManga.run(id);
  },

  deleteMangaByUserId(userId: string): number {
    _mangaCache = null;
    const info = stmtDeleteMangaByUserId.run(userId);
    return Number(info.changes) || 0;
  },

  deleteReadingDataForUser(userId: string) {
    stmtDeleteReadingProgressByUserId.run(userId);
    stmtDeleteReadingActivityByUserId.run(userId);
  },

  /**
   * Permanently remove a user's profile, owned manga rows, and reading data.
   * Shared catalog rows (userId NULL) are left intact.
   */
  purgeUserData(userId: string): { mangaDeleted: number } {
    _mangaCache = null;
    const run = db.transaction((uid: string) => {
      stmtDeleteReadingProgressByUserId.run(uid);
      stmtDeleteReadingActivityByUserId.run(uid);
      stmtDeleteUserFavoritesByUser.run(uid);
      stmtDeleteUserLibraryStateByUser.run(uid);
      const mangaInfo = stmtDeleteMangaByUserId.run(uid);
      stmtDeleteProfile.run(uid);
      return { mangaDeleted: Number(mangaInfo.changes) || 0 };
    });
    return run(userId);
  },

  purgeReaperScans() {
    _mangaCache = null;
    return purgeReaperScans();
  },

  deleteAllManga() {
    _mangaCache = null;
    db.prepare('DELETE FROM manga').run();
  },

  getMangaCount(): number {
    const row = db.prepare('SELECT COUNT(*) as count FROM manga').get() as { count: number };
    return row.count;
  },

  // ── KV Settings Store ──────────────────────────────────────────────────────
  getSetting(key: string): string | null {
    const row = stmtGetSetting.get(key) as { value: string } | undefined;
    return row ? row.value : null;
  },

  setSetting(key: string, value: string) {
    stmtSetSetting.run({ key, value });
  },

  // ── Explore Catalog Buffer Persistence ─────────────────────────────────────
  // The buffered /api/explore snapshot is stored as a JSON blob in the settings
  // KV table so a server restart can serve /browse instantly (no warm-up wait).
  // Everything is parsed defensively: a missing/corrupt row simply returns null.
  getExploreBuffer(): any | null {
    try {
      const raw = stmtGetSetting.get('explore_buffer') as { value: string } | undefined;
      if (!raw || !raw.value) return null;
      const parsed = JSON.parse(raw.value);
      if (!parsed || !Array.isArray(parsed.items)) return null;
      return parsed;
    } catch {
      return null;
    }
  },

  setExploreBuffer(entry: { items: any[]; sourceIds: string[]; builtAt: number; expiresAt: number; lastError: string | null } | null) {
    try {
      if (!entry) return;
      stmtSetSetting.run({ key: 'explore_buffer', value: JSON.stringify(entry) });
    } catch (err) {
      console.error('[SQLite Engine] Error persisting explore buffer:', err);
    }
  },

  // ── Source Health Map Persistence (RC-5 fix) ───────────────────────────────
  // Persists the in-memory sourceHealthMap so circuit states and health stats
  // survive server restarts. A missing/corrupt row simply returns an empty object.
  getSourceHealthMap(): Record<string, any> {
    try {
      const raw = stmtGetSetting.get('source_health_map') as { value: string } | undefined;
      if (!raw || !raw.value) return {};
      return JSON.parse(raw.value) || {};
    } catch {
      return {};
    }
  },

  setSourceHealthMap(map: Record<string, any>) {
    try {
      stmtSetSetting.run({ key: 'source_health_map', value: JSON.stringify(map) });
    } catch (err) {
      console.error('[SQLite Engine] Error persisting source health map:', err);
    }
  },

  // ── Per-Series Reader Settings (server-side sync) ───────────────────────────
  // Reader preferences (mode, page gap, image filter, background, zoom…)
  // persisted per (user, manga) so they roam across PWA / Electron / other
  // browsers exactly like reading progress does. Keyed into the `settings`
  // table as a single JSON blob per (user, manga).
  getSeriesReaderSettings(userId: string, mangaId: string): Record<string, any> | null {
    try {
      const key = `series_reader_settings:${userId}:${mangaId}`;
      const raw = stmtGetSetting.get(key) as { value: string } | undefined;
      if (!raw || !raw.value) return null;
      const parsed = JSON.parse(raw.value);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  },

  setSeriesReaderSettings(userId: string, mangaId: string, settings: Record<string, any>) {
    try {
      const key = `series_reader_settings:${userId}:${mangaId}`;
      stmtSetSetting.run({ key, value: JSON.stringify(settings || {}) });
    } catch (err) {
      console.error('[SQLite Engine] Error persisting series reader settings:', err);
    }
  },

  // ── Persistent Library Cache ───────────────────────────────────────────────
  // A persistent snapshot of the library index built on first boot and updated weekly.
  getLibraryCache(): any | null {
    try {
      const raw = stmtGetSetting.get('persistent_library_cache_v1') as { value: string } | undefined;
      if (!raw || !raw.value) return null;
      const parsed = JSON.parse(raw.value);
      if (!parsed || !Array.isArray(parsed.series)) return null;
      return parsed;
    } catch {
      return null;
    }
  },

  setLibraryCache(entry: any) {
    try {
      if (!entry) return;
      stmtSetSetting.run({ key: 'persistent_library_cache_v1', value: JSON.stringify(entry) });
    } catch (err) {
      console.error('[SQLite Engine] Error persisting library cache:', err);
    }
  },

  // ── Profiles ───────────────────────────────────────────────────────────────
  getAllProfiles(): any[] {
    return stmtGetAllProfiles.all();
  },

  getProfileById(id: string): any {
    return db.prepare('SELECT * FROM profiles WHERE id = ?').get(id) || null;
  },

  upsertProfile(profile: any) {
    stmtUpsertProfile.run({
      id: profile.id,
      name: profile.name || '',
      username: profile.username || '',
      email: profile.email || '',
      avatar: profile.avatar || '',
      role: profile.role || 'user',
      password: profile.password || '',
      storageFolderPath: profile.storageFolderPath || '',
      createdAt: profile.createdAt || new Date().toISOString(),
    });
  },

  deleteProfile(id: string) {
    stmtDeleteProfile.run(id);
  },

  replaceAllProfiles(profiles: any[]) {
    const transaction = db.transaction((list: any[]) => {
      stmtDeleteAllProfiles.run();
      for (const p of list) {
        stmtUpsertProfile.run({
          id: p.id,
          name: p.name || '',
          username: p.username || '',
          email: p.email || '',
          avatar: p.avatar || '',
          role: p.role || 'user',
          password: p.password || '',
          storageFolderPath: p.storageFolderPath || '',
          createdAt: p.createdAt || new Date().toISOString(),
        });
      }
    });
    transaction(profiles);
  },

  // ── Auto-Update Logs ───────────────────────────────────────────────────────
  getAllLogs(): any[] {
    return stmtGetAllLogs.all();
  },

  replaceAllLogs(logs: any[]) {
    const transaction = db.transaction((list: any[]) => {
      stmtDeleteAllLogs.run();
      for (const l of list) {
        stmtInsertLog.run({
          id: l.id,
          mangaId: l.mangaId || '',
          mangaTitle: l.mangaTitle || '',
          sourceName: l.source || l.sourceName || '',
          previousChapter: l.previousChapter ?? 0,
          newChapter: l.newChapter ?? 0,
          timestamp: l.timestamp || new Date().toISOString(),
          status: l.status || 'updated',
          details: l.details || '',
          type: l.type || 'manhwa',
        });
      }
    });
    transaction(logs);
  },

  // ── Reading Progress (resume position) ─────────────────────────────────────
  upsertReadingProgress(p: {
    manga_id: string;
    user_id: string;
    chapter_number: number;
    page_index?: number;
    page_count?: number;
    percent?: number;
  }) {
    stmtUpsertReadingProgress.run({
      manga_id: p.manga_id,
      user_id: p.user_id,
      chapter_number: Number(p.chapter_number) || 0,
      page_index: Number(p.page_index) || 0,
      page_count: Number(p.page_count) || 0,
      percent: Math.min(100, Math.max(0, Number(p.percent) || 0)),
      last_read_at: new Date().toISOString(),
    });
  },

  getReadingProgress(mangaId: string, userId: string): any[] {
    return stmtGetReadingProgress.all(mangaId, userId);
  },

  getReadingProgressForChapter(mangaId: string, userId: string, chapterNumber: number): any {
    return stmtGetReadingProgressForChapter.get(mangaId, userId, Number(chapterNumber) || 0) || null;
  },

  // ── Per-day Reading Activity (real analytics/heatmap) ──────────────────────
  recordReadingActivity(userId: string, opts: { chaptersRead?: number; minutesSpent?: number }) {
    const today = new Date().toISOString().substring(0, 10);
    const allRows = stmtGetReadingActivity.all(userId) as any[];
    const existing = allRows.find((r: any) => r.date === today);
    stmtUpsertReadingActivity.run({
      date: today,
      user_id: userId,
      chapters_read: (existing?.chapters_read || 0) + (Number(opts.chaptersRead) || 0),
      minutes_spent: (existing?.minutes_spent || 0) + (Number(opts.minutesSpent) || 0),
    });
  },

  getReadingActivity(userId: string): any[] {
    return stmtGetReadingActivity.all(userId);
  },

  /** All page-level reading position rows for a user (GDPR export/erasure). */
  getAllReadingProgressForUser(userId: string): any[] {
    return stmtGetReadingProgressByUser.all(userId);
  },

  // ── Per-user favorites ─────────────────────────────────────────────────────
  setUserFavorite(userId: string, mangaId: string, isFavorite: boolean) {
    stmtUpsertUserFavorite.run({
      user_id: userId,
      manga_id: mangaId,
      is_favorite: isFavorite ? 1 : 0,
      updated_at: new Date().toISOString(),
    });
  },

  getUserFavoriteIds(userId: string): Set<string> {
    const rows = stmtGetUserFavorites.all(userId) as { manga_id: string }[];
    return new Set(rows.map((r) => r.manga_id));
  },

  isUserFavorite(userId: string, mangaId: string): boolean {
    const row = stmtGetUserFavorite.get(userId, mangaId) as { is_favorite: number } | undefined;
    return Boolean(row?.is_favorite);
  },

  // ── Per-user library chapter state ─────────────────────────────────────────
  setUserLibraryChapter(
    userId: string,
    mangaId: string,
    currentChapter: number,
    opts?: { status?: string }
  ) {
    const existing = stmtGetUserLibraryStateOne.get(userId, mangaId) as
      | { current_chapter?: number; status?: string }
      | undefined;
    const nextCh = Math.max(Number(existing?.current_chapter) || 0, Number(currentChapter) || 0);
    stmtUpsertUserLibraryState.run({
      user_id: userId,
      manga_id: mangaId,
      current_chapter: nextCh,
      last_read_at: new Date().toISOString(),
      status: opts?.status || existing?.status || null,
    });
  },

  getUserLibraryStateMap(userId: string): Map<string, { currentChapter: number; lastReadAt?: string; status?: string }> {
    const rows = stmtGetUserLibraryState.all(userId) as any[];
    const map = new Map<string, { currentChapter: number; lastReadAt?: string; status?: string }>();
    for (const r of rows) {
      map.set(r.manga_id, {
        currentChapter: Number(r.current_chapter) || 0,
        lastReadAt: r.last_read_at || undefined,
        status: r.status || undefined,
      });
    }
    return map;
  },

  /**
   * Fast-path overlay for a single series (used on chapter increments, detail views, etc.)
   * Performs targeted point-lookups instead of full table scans.
   */
  applyUserOverlayOne(manga: MangaItem, userId: string | null | undefined): MangaItem {
    if (!userId) return manga;
    const isFav = this.isUserFavorite(userId, manga.id);
    const stateRow = stmtGetUserLibraryStateOne.get(userId, manga.id) as { current_chapter?: number; last_read_at?: string; status?: string } | undefined;
    const catRows = stmtGetMangaCategories.all(manga.id, userId) as { category_id: string }[];
    const categories = catRows.map((r) => r.category_id);

    return {
      ...manga,
      isFavorite: isFav,
      currentChapter: stateRow ? (Number(stateRow.current_chapter) || 0) : (Number(manga.currentChapter) || 0),
      lastReadAt: stateRow?.last_read_at || manga.lastReadAt,
      status: (stateRow?.status as MangaItem['status']) || manga.status,
      categories,
    };
  },

  /**
   * Overlay per-user favorite + chapter progress onto catalog rows for API responses.
   * Shared catalog fields stay global; isFavorite/currentChapter/lastReadAt become personal.
   */
  applyUserOverlay(items: MangaItem[], userId: string | null | undefined): MangaItem[] {
    if (!userId || items.length === 0) return items;
    if (items.length === 1) {
      return [this.applyUserOverlayOne(items[0], userId)];
    }

    const favs = this.getUserFavoriteIds(userId);
    const userStateMap = this.getUserLibraryStateMap(userId);
    const catRows = stmtGetMangaCategoriesAllForUser.all(userId) as { manga_id: string; category_id: string }[];
    const catMap = new Map<string, string[]>();
    for (const r of catRows) {
      const arr = catMap.get(r.manga_id) || [];
      arr.push(r.category_id);
      catMap.set(r.manga_id, arr);
    }

    return items.map((m) => {
      const state = userStateMap.get(m.id);
      const userCats = catMap.get(m.id);
      return {
        ...m,
        // Per-user favorites table is source of truth once overlay is applied
        isFavorite: favs.has(m.id),
        currentChapter: state ? state.currentChapter : (Number(m.currentChapter) || 0),
        lastReadAt: state?.lastReadAt || m.lastReadAt,
        status: (state?.status as MangaItem['status']) || m.status,
        categories: userCats || [],
      };
    });
  },

  getCategories(userId: string): UserCategory[] {
    const rows = stmtGetCategoriesForUser.all(userId) as any[];
    const countRows = stmtGetCategoryCountsForUser.all(userId) as any[];
    const countMap = new Map<string, number>();
    for (const cr of countRows) countMap.set(cr.category_id, cr.series_count);

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description || undefined,
      color: r.color || undefined,
      icon: r.icon || undefined,
      sortOrder: Number(r.sort_order) || 0,
      userId: r.user_id,
      createdAt: r.created_at,
      seriesCount: countMap.get(r.id) || 0,
      isDynamic: Boolean(r.is_dynamic),
      ruleType: r.rule_type || undefined,
      ruleValue: r.rule_value || undefined,
    }));
  },

  createCategory(category: UserCategory): UserCategory {
    stmtInsertCategory.run(
      category.id,
      category.userId || 'usr_admin',
      category.name,
      category.description || null,
      category.color || '#f59e0b',
      category.icon || 'Bookmark',
      category.sortOrder || 0,
      category.createdAt || new Date().toISOString(),
      category.isDynamic ? 1 : 0,
      category.ruleType || null,
      category.ruleValue ? String(category.ruleValue) : null
    );
    return category;
  },

  updateCategory(id: string, updates: Partial<UserCategory>, userId: string): UserCategory | null {
    const existing = stmtGetCategoryByIdAndUser.get(id, userId) as any;
    if (!existing) return null;
    const name = updates.name !== undefined ? updates.name : existing.name;
    const description = updates.description !== undefined ? updates.description : existing.description;
    const color = updates.color !== undefined ? updates.color : existing.color;
    const icon = updates.icon !== undefined ? updates.icon : existing.icon;
    const sortOrder = updates.sortOrder !== undefined ? updates.sortOrder : existing.sort_order;
    const isDynamic = updates.isDynamic !== undefined ? (updates.isDynamic ? 1 : 0) : existing.is_dynamic;
    const ruleType = updates.ruleType !== undefined ? updates.ruleType : existing.rule_type;
    const ruleValue = updates.ruleValue !== undefined ? String(updates.ruleValue) : existing.rule_value;

    stmtUpdateCategory.run(name, description, color, icon, sortOrder, isDynamic, ruleType, ruleValue, id, userId);

    return {
      id,
      name,
      description,
      color,
      icon,
      sortOrder,
      userId,
      createdAt: existing.created_at,
      isDynamic: Boolean(isDynamic),
      ruleType,
      ruleValue,
    };
  },

  deleteCategory(id: string, userId: string): boolean {
    const tx = db.transaction(() => {
      stmtDeleteCategoryMangaLinks.run(id, userId);
      stmtDeleteCategory.run(id, userId);
    });
    tx();
    return true;
  },

  getMangaCategories(mangaId: string, userId: string): string[] {
    const rows = stmtGetMangaCategories.all(mangaId, userId) as { category_id: string }[];
    return rows.map((r) => r.category_id);
  },

  setMangaCategories(mangaId: string, categoryIds: string[], userId: string): void {
    const tx = db.transaction(() => {
      stmtDeleteMangaCategoriesForManga.run(mangaId, userId);
      for (const catId of categoryIds) {
        if (catId && catId.trim()) stmtInsertMangaCategory.run(mangaId, catId.trim(), userId);
      }
    });
    tx();
  },

  bulkAssignCategory(mangaIds: string[], categoryId: string, action: 'add' | 'remove' | 'set', userId: string): void {
    const tx = db.transaction(() => {
      for (const mangaId of mangaIds) {
        if (action === 'add') {
          stmtInsertMangaCategory.run(mangaId, categoryId, userId);
        } else if (action === 'remove') {
          stmtDeleteMangaCategoryOne.run(mangaId, categoryId, userId);
        } else if (action === 'set') {
          stmtDeleteMangaCategoriesForManga.run(mangaId, userId);
          stmtInsertMangaCategory.run(mangaId, categoryId, userId);
        }
      }
    });
    tx();
  },

  /**
   * High-performance batch user state & category association for backup restorations.
   * Runs all favorites, chapter progress, and category junction writes within a single SQLite transaction.
   */
  bulkApplyUserImportState(
    userId: string,
    items: Array<{
      id: string;
      isFavorite?: boolean;
      currentChapter?: number;
      status?: string;
      categoryIds?: string[];
    }>
  ) {
    const stmtFav = db.prepare('INSERT OR REPLACE INTO user_favorites (user_id, manga_id, is_favorite, updated_at) VALUES (?, ?, ?, ?)');
    const stmtState = db.prepare(`
      INSERT INTO user_library_state (user_id, manga_id, current_chapter, last_read_at, status)
      VALUES (:user_id, :manga_id, :current_chapter, :last_read_at, :status)
      ON CONFLICT(user_id, manga_id) DO UPDATE SET
        current_chapter = CASE WHEN excluded.current_chapter > user_library_state.current_chapter THEN excluded.current_chapter ELSE user_library_state.current_chapter END,
        last_read_at = excluded.last_read_at,
        status = COALESCE(excluded.status, user_library_state.status)
    `);
    const stmtDelCats = db.prepare('DELETE FROM manga_categories WHERE manga_id = ? AND user_id = ?');
    const stmtInsCat = db.prepare('INSERT OR IGNORE INTO manga_categories (manga_id, category_id, user_id) VALUES (?, ?, ?)');

    const now = new Date().toISOString();
    const run = db.transaction((list: typeof items) => {
      for (const item of list) {
        if (item.isFavorite) {
          stmtFav.run(userId, item.id, 1, now);
        }
        if (item.currentChapter !== undefined || item.status !== undefined) {
          stmtState.run({
            user_id: userId,
            manga_id: item.id,
            current_chapter: Math.max(0, item.currentChapter || 0),
            last_read_at: now,
            status: item.status || null,
          });
        }
        if (Array.isArray(item.categoryIds) && item.categoryIds.length > 0) {
          stmtDelCats.run(item.id, userId);
          for (const catId of item.categoryIds) {
            stmtInsCat.run(item.id, catId, userId);
          }
        }
      }
    });

    run(items);
  },

  getStickyNotes(mangaId: string, userId?: string): PageStickyNote[] {
    return getStickyNotes(mangaId, userId);
  },

  saveStickyNote(note: PageStickyNote): void {
    saveStickyNote(note);
  },

  deleteStickyNote(id: string, userId?: string): boolean {
    return deleteStickyNote(id, userId);
  },

  // ── Readlists & Playlists ──────────────────────────────────────────────────
  getReadlists(userId: string): any[] {
    const rows = stmtGetReadlistsForUser.all(userId) as any[];
    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      name: r.name,
      description: r.description || undefined,
      coverImage: r.cover_image || undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      itemsCount: Number(r.items_count) || 0,
    }));
  },

  getReadlistById(id: string, userId?: string): any | null {
    const row = stmtGetReadlistById.get(id) as any;
    if (!row) return null;
    if (userId && row.user_id !== userId) return null;

    const itemRows = stmtGetReadlistItems.all(id) as any[];
    const items = itemRows.map((ir) => ({
      id: ir.id,
      readlistId: ir.readlist_id,
      mangaId: ir.manga_id,
      mangaTitle: ir.manga_title || 'Untitled Series',
      mangaCover: ir.manga_cover || '',
      mangaSourceUrl: ir.manga_source_url || '',
      mangaSourceName: ir.manga_source_name || '',
      chapterNumber: Number(ir.chapter_number) || 1,
      chapterTitle: ir.chapter_title || `Chapter ${ir.chapter_number}`,
      sortOrder: Number(ir.sort_order) || 0,
      notes: ir.notes || undefined,
    }));

    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      description: row.description || undefined,
      coverImage: row.cover_image || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      itemsCount: items.length,
      items,
    };
  },

  createReadlist(readlist: {
    id: string;
    userId: string;
    name: string;
    description?: string;
    coverImage?: string;
    createdAt?: string;
    updatedAt?: string;
  }): any {
    const now = new Date().toISOString();
    stmtInsertReadlist.run({
      id: readlist.id,
      userId: readlist.userId,
      name: readlist.name,
      description: readlist.description || null,
      coverImage: readlist.coverImage || null,
      createdAt: readlist.createdAt || now,
      updatedAt: readlist.updatedAt || now,
    });
    return { ...readlist, createdAt: readlist.createdAt || now, updatedAt: readlist.updatedAt || now, itemsCount: 0, items: [] };
  },

  updateReadlist(id: string, updates: { name?: string; description?: string; coverImage?: string }, userId: string): any | null {
    const existing = stmtGetReadlistById.get(id) as any;
    if (!existing || existing.user_id !== userId) return null;

    const now = new Date().toISOString();
    stmtUpdateReadlist.run({
      id,
      userId,
      name: updates.name !== undefined ? updates.name : existing.name,
      description: updates.description !== undefined ? updates.description : existing.description,
      coverImage: updates.coverImage !== undefined ? updates.coverImage : existing.cover_image,
      updatedAt: now,
    });

    return this.getReadlistById(id, userId);
  },

  deleteReadlist(id: string, userId: string): boolean {
    const tx = db.transaction(() => {
      stmtDeleteReadlistItems.run(id);
      stmtDeleteReadlist.run(id, userId);
    });
    tx();
    return true;
  },

  addReadlistItem(item: {
    id: string;
    readlistId: string;
    mangaId: string;
    chapterNumber: number;
    chapterTitle?: string;
    sortOrder?: number;
    notes?: string;
  }): any {
    const sortOrder = item.sortOrder !== undefined ? item.sortOrder : 0;
    stmtInsertReadlistItem.run({
      id: item.id,
      readlistId: item.readlistId,
      mangaId: item.mangaId,
      chapterNumber: item.chapterNumber,
      chapterTitle: item.chapterTitle || null,
      sortOrder,
      notes: item.notes || null,
    });
    return { ...item, sortOrder };
  },

  removeReadlistItem(id: string, readlistId: string): boolean {
    stmtDeleteReadlistItemById.run(id, readlistId);
    return true;
  },

  setReadlistItems(readlistId: string, items: any[]): void {
    const tx = db.transaction(() => {
      stmtDeleteReadlistItems.run(readlistId);
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        stmtInsertReadlistItem.run({
          id: it.id || `rli_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          readlistId,
          mangaId: it.mangaId,
          chapterNumber: Number(it.chapterNumber) || 1,
          chapterTitle: it.chapterTitle || null,
          sortOrder: it.sortOrder !== undefined ? it.sortOrder : i,
          notes: it.notes || null,
        });
      }
    });
    tx();
  },

  // ── Persistent Token Revocation ──────────────────────────────────────────
  revokeToken(jti: string, expiresAt: number): void {
    if (!jti) return;
    try {
      stmtRevokeToken.run(jti, new Date().toISOString(), expiresAt);
    } catch (e) {
      console.error('[SQLite Engine] Failed to record revoked token:', e);
    }
  },

  isTokenRevoked(jti: string): boolean {
    if (!jti) return false;
    try {
      const row = stmtIsTokenRevoked.get(jti, Date.now());
      return Boolean(row);
    } catch {
      return false;
    }
  },

  cleanupExpiredRevokedTokens(): number {
    try {
      const info = stmtCleanupRevokedTokens.run(Date.now());
      return info.changes;
    } catch {
      return 0;
    }
  },

  // ── Chapter Pages Cache (Stale-While-Revalidate) ───────────────────────────
  getCachedChapterPages(mangaId: string, chapterNumber: number, sourceUrl: string): { pages: string[]; pageCount: number } | null {
    try {
      const row = stmtGetCachedPages.get(mangaId, chapterNumber, sourceUrl, Date.now()) as { pages: string; page_count: number } | undefined;
      if (!row || !row.pages) return null;
      const pages = JSON.parse(row.pages);
      if (!Array.isArray(pages) || pages.length === 0) return null;
      return { pages, pageCount: Number(row.page_count) || pages.length };
    } catch {
      return null;
    }
  },

  setCachedChapterPages(mangaId: string, chapterNumber: number, sourceUrl: string, pages: string[], ttlMs: number = 6 * 60 * 60 * 1000): void {
    if (!mangaId || !sourceUrl || !Array.isArray(pages) || pages.length === 0) return;
    try {
      const now = Date.now();
      stmtSetCachedPages.run({
        manga_id: mangaId,
        chapter_number: chapterNumber,
        source_url: sourceUrl,
        pages: JSON.stringify(pages),
        page_count: pages.length,
        cached_at: now,
        expires_at: now + ttlMs,
      });
    } catch (err) {
      console.error('[SQLite Engine] Failed to cache chapter pages:', err);
    }
  },

  cleanupExpiredChapterPages(): number {
    try {
      const info = stmtCleanupCachedPages.run(Date.now());
      return info.changes;
    } catch {
      return 0;
    }
  },

  /**
   * Complete unified database dump for server migration and automated backups.
   */
  exportFullDatabaseDump(): {
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
  },

  /**
   * Atomically restores all database tables from a migration dump.
   */
  importFullDatabaseDump(dump: any, options: { mode?: 'replace' | 'merge' } = { mode: 'replace' }): {
    mangaCount: number;
    categoriesCount: number;
    profilesCount: number;
    progressCount: number;
    notesCount: number;
  } {
    _mangaCache = null;
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

      // 1. Manga series
      const mangaList = Array.isArray(dump.manga)
        ? dump.manga
        : Array.isArray(dump.mangaDatabase)
        ? dump.mangaDatabase
        : Array.isArray(dump.data)
        ? dump.data
        : [];

      for (const item of mangaList) {
        if (item && item.id) {
          stmtUpsertManga.run(mapMangaItemToRow(item));
          mangaCount++;
        }
      }

      // 2. Categories
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

      // 3. Manga Categories Junction
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

      // 4. Profiles
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

      // 5. Settings
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

      // 6. Reading Progress
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

      // 7. Reading Activity
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

      // 8. User Favorites
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

      // 9. User Library State
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

      // 10. Sticky Notes
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
  },

  /**
   * Point-in-time binary SQLite database backup file creation.
   */
  async createLiveDatabaseBackup(destPath: string): Promise<void> {
    const parentDir = path.dirname(destPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    if (fs.existsSync(destPath)) {
      fs.unlinkSync(destPath);
    }
    // Use native better-sqlite3 asynchronous online backup
    await db.backup(destPath);
  },

  /**
   * Persistent Chapter Download Queue helpers
   */
  saveDownloadJob(job: PersistedDownloadJob): void {
    stmtUpsertDownloadJob.run({
      id: job.id,
      manga_id: job.mangaId,
      manga_title: job.mangaTitle,
      chapter_number: job.chapterNumber,
      chapter_title: job.chapterTitle || null,
      source_url: job.sourceUrl || null,
      source_name: job.sourceName || null,
      status: job.status,
      current_page: job.progress?.current || 0,
      total_pages: job.progress?.total || 0,
      bytes_downloaded: job.progress?.bytesDownloaded || 0,
      percent: job.progress?.percent || 0,
      error: job.error || null,
      output_path: job.outputPath || null,
      created_at: job.createdAt || new Date().toISOString(),
      started_at: job.startedAt || null,
      finished_at: job.finishedAt || null,
      retries: job.retries || 0,
    });
  },

  getDownloadJobs(): PersistedDownloadJob[] {
    const rows = stmtGetAllDownloadJobs.all();
    return rows.map(mapRowToDownloadJob);
  },

  getDownloadJobById(id: string): PersistedDownloadJob | null {
    const row = stmtGetDownloadJobById.get(id);
    return row ? mapRowToDownloadJob(row) : null;
  },

  deleteDownloadJob(id: string): boolean {
    const res = stmtDeleteDownloadJob.run(id);
    return res.changes > 0;
  },

  clearCompletedDownloadJobs(): number {
    const res = stmtDeleteCompletedDownloadJobs.run();
    return res.changes;
  },

  /**
   * Comprehensive database maintenance:
   * 1. Purges expired chapter page cache rows
   * 2. Trims old logs (default > 30 days)
   * 3. Performs SQLite WAL checkpoint (TRUNCATE) to merge log frames back into main database file
   * 4. Runs PRAGMA optimize
   * 5. Optional VACUUM to defragment pages and reclaim unallocated OS disk space
   */
  performDatabaseMaintenance(options: { vacuum?: boolean; purgeExpiredCache?: boolean; trimLogsDays?: number } = {}): DatabaseMaintenanceResult {
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

      // Checkpoint WAL file to commit all pending transactions and truncate WAL to 0 bytes
      try {
        db.pragma('wal_checkpoint(TRUNCATE)');
        walCheckpointed = true;
      } catch (walErr) {
        logger.warn('SQLite', 'WAL checkpoint warning', { error: String(walErr) });
      }

      // SQLite optimizer evaluates query planner statistics
      try {
        db.pragma('optimize');
      } catch (optErr) {
        logger.warn('SQLite', 'PRAGMA optimize warning', { error: String(optErr) });
      }

      // VACUUM defragments the entire database and reclaims unallocated OS blocks
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
  },
};

/**
 * One-time: copy global manga.isFavorite / currentChapter into usr_admin personal tables
 * so existing libraries don't vanish after the multi-user overlay lands.
 */
function migrateGlobalLibraryToUserTables() {
  try {
    const done = stmtGetSetting.get('migrated_user_library_v1') as { value: string } | undefined;
    if (done?.value === '1') return;
    const rows = db.prepare('SELECT id, isFavorite, currentChapter, lastReadAt, status FROM manga').all() as any[];
    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      for (const r of rows) {
        if (r.isFavorite) {
          stmtUpsertUserFavorite.run({
            user_id: 'usr_admin',
            manga_id: r.id,
            is_favorite: 1,
            updated_at: now,
          });
        }
        const ch = Number(r.currentChapter) || 0;
        if (ch > 0) {
          stmtUpsertUserLibraryState.run({
            user_id: 'usr_admin',
            manga_id: r.id,
            current_chapter: ch,
            last_read_at: r.lastReadAt || now,
            status: r.status || null,
          });
        }
      }
      stmtSetSetting.run({ key: 'migrated_user_library_v1', value: '1' });
    });
    tx();
    console.log(`[SQLite Engine] Migrated global favorites/progress into per-user tables for usr_admin (${rows.length} series scanned).`);
  } catch (err) {
    console.error('[SQLite Engine] user library migration failed:', err);
  }
}

/**
 * Sticky Notes Helpers (per-user: every note is owned by the user that
 * created it; reads/deletes are scoped to that user by the callers).
 */
export function getStickyNotes(mangaId: string, userId?: string): PageStickyNote[] {
  try {
    if (userId) {
      return db.prepare('SELECT id, manga_id as mangaId, chapter_number as chapterNumber, page_index as pageIndex, note_text as noteText, color, created_at as createdAt, updated_at as updatedAt, user_id as userId FROM page_sticky_notes WHERE manga_id = ? AND user_id = ? ORDER BY chapter_number ASC, page_index ASC').all(mangaId, userId) as PageStickyNote[];
    }
    return db.prepare('SELECT id, manga_id as mangaId, chapter_number as chapterNumber, page_index as pageIndex, note_text as noteText, color, created_at as createdAt, updated_at as updatedAt, user_id as userId FROM page_sticky_notes WHERE manga_id = ? ORDER BY chapter_number ASC, page_index ASC').all(mangaId) as PageStickyNote[];
  } catch {
    return [];
  }
}

export function saveStickyNote(note: PageStickyNote): void {
  try {
    db.prepare(`
      INSERT INTO page_sticky_notes (id, manga_id, chapter_number, page_index, note_text, color, created_at, updated_at, user_id)
      VALUES (@id, @mangaId, @chapterNumber, @pageIndex, @noteText, @color, @createdAt, @updatedAt, @userId)
      ON CONFLICT(id) DO UPDATE SET
        note_text = excluded.note_text,
        color = excluded.color,
        updated_at = excluded.updated_at
    `).run({
      id: note.id,
      mangaId: note.mangaId,
      chapterNumber: note.chapterNumber,
      pageIndex: note.pageIndex,
      noteText: note.noteText,
      color: note.color || 'yellow',
      createdAt: note.createdAt || new Date().toISOString(),
      updatedAt: note.updatedAt || new Date().toISOString(),
      userId: note.userId || null,
    });
  } catch (err) {
    console.error('Error saving sticky note:', err);
  }
}

export function deleteStickyNote(id: string, userId?: string): boolean {
  try {
    // Ownership enforced: a scoped delete only removes the caller's own note.
    const res = userId
      ? db.prepare('DELETE FROM page_sticky_notes WHERE id = ? AND user_id = ?').run(id, userId)
      : db.prepare('DELETE FROM page_sticky_notes WHERE id = ?').run(id);
    return res.changes > 0;
  } catch {
    return false;
  }
}

export function optimizeDatabase(): void {
  try {
    db.pragma('optimize');
  } catch (err) {
    console.warn('[SQLite Engine] PRAGMA optimize notice:', err);
  }
}

function populateIsNsfwIndex() {
  try {
    const done = stmtGetSetting.get('migrated_is_nsfw_v1') as { value: string } | undefined;
    if (done?.value === '1') return;
    const rows = db.prepare('SELECT * FROM manga WHERE isNsfw = 0 OR isNsfw IS NULL').all() as any[];
    const upd = db.prepare('UPDATE manga SET isNsfw = 1 WHERE id = ?');
    const tx = db.transaction(() => {
      let count = 0;
      for (const r of rows) {
        const item = mapRowToMangaItem(r);
        if (isNsfwManga(item)) {
          upd.run(r.id);
          count++;
        }
      }
      stmtSetSetting.run({ key: 'migrated_is_nsfw_v1', value: '1' });
      if (count > 0) {
        logger.info('SQLite', `Indexed ${count} NSFW titles in database for fast indexed lookups`);
      }
    });
    tx();
  } catch (err) {
    console.error('[SQLite Engine] isNsfw index migration failed:', err);
  }
}

// Execute migration check on startup
migrateJsonToSqlite();
migrateGlobalLibraryToUserTables();
populateIsNsfwIndex();
optimizeDatabase();


