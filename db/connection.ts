import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { logger } from '../server/logger';

// Ensure data directory exists (cwd-relative so bundled/Docker entrypoints share ./data)
export const DATA_DIR = path.join(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export const DB_PATH =
  process.env.DB_PATH ||
  (process.env.NODE_ENV === 'test'
    ? path.join(DATA_DIR, 'test-manga.db')
    : path.join(DATA_DIR, 'manga.db'));

logger.info('SQLite', 'Initializing SQLite database', { dbPath: DB_PATH });
export const db = new Database(DB_PATH);

// Enable WAL Mode for high concurrency and sub-millisecond writes
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');
db.pragma('cache_size = -64000');
db.pragma('temp_store = MEMORY');
db.pragma('mmap_size = 268435456');

// 1. Initialize Tables, Indexes & Schema Migrations
export function initializeDatabaseSchema(): void {
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

    CREATE TABLE IF NOT EXISTS reading_activity (
      date TEXT NOT NULL,
      user_id TEXT NOT NULL,
      chapters_read INTEGER DEFAULT 0,
      minutes_spent REAL DEFAULT 0,
      PRIMARY KEY (date, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_read_progress_user ON reading_progress(user_id, last_read_at);
    CREATE INDEX IF NOT EXISTS idx_read_activity_user ON reading_activity(user_id, date);

    CREATE TABLE IF NOT EXISTS user_favorites (
      user_id TEXT NOT NULL,
      manga_id TEXT NOT NULL,
      is_favorite INTEGER DEFAULT 1,
      updated_at TEXT,
      PRIMARY KEY (user_id, manga_id)
    );

    CREATE TABLE IF NOT EXISTS user_library_state (
      user_id TEXT NOT NULL,
      manga_id TEXT NOT NULL,
      current_chapter INTEGER DEFAULT 0,
      last_read_at TEXT,
      status TEXT,
      PRIMARY KEY (user_id, manga_id)
    );

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

    CREATE TABLE IF NOT EXISTS revoked_tokens (
      jti TEXT PRIMARY KEY,
      revoked_at TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_revoked_tokens_exp ON revoked_tokens(expires_at);

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

  try { db.exec('ALTER TABLE logs ADD COLUMN mangaId TEXT'); } catch (e) { }
  try { db.exec('ALTER TABLE logs ADD COLUMN type TEXT'); } catch (e) { }

  // Auto-sanitize ad & spam entries from legacy scrapes/imports
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
}

// Auto-initialize schema on module load
initializeDatabaseSchema();
