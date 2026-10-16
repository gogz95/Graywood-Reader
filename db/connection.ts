import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { logger } from '../server/logger';

// Ensure data directory exists (respects DB_PATH, STORAGE_PATH or ./data)
export const DATA_DIR = process.env.STORAGE_PATH
  ? path.resolve(process.env.STORAGE_PATH)
  : (process.env.DB_PATH ? path.dirname(path.resolve(process.env.DB_PATH)) : path.join(process.cwd(), 'data'));

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
db.pragma('wal_autocheckpoint = 1000');
db.pragma('foreign_keys = ON');
db.pragma('cache_size = -64000');
db.pragma('temp_store = MEMORY');
db.pragma('mmap_size = 268435456');

// 1. Initialize Tables, Indexes & Schema Migrations
export function initializeDatabaseSchema(): void {
  const currentVersion = Number(db.pragma('user_version', { simple: true })) || 0;

  const migrations: Array<{ version: number; name: string; run: (database: Database.Database) => void }> = [
    {
      version: 1,
      name: 'initial_schema',
      run: (database) => {
        database.exec(`
          CREATE TABLE IF NOT EXISTS system_state (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS cover_cache (
            url_hash TEXT PRIMARY KEY,
            data BLOB NOT NULL,
            content_type TEXT NOT NULL,
            updated_at INTEGER NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_cover_cache_updated ON cover_cache(updated_at);

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
            categories TEXT,
            isNsfw INTEGER DEFAULT 0
          );

          CREATE INDEX IF NOT EXISTS idx_manga_title ON manga(title);
          CREATE INDEX IF NOT EXISTS idx_manga_favorite ON manga(isFavorite);
          CREATE INDEX IF NOT EXISTS idx_manga_type ON manga(type);
          CREATE INDEX IF NOT EXISTS idx_manga_updated ON manga(lastUpdated DESC);
          CREATE INDEX IF NOT EXISTS idx_manga_apiId ON manga(apiId);
          CREATE INDEX IF NOT EXISTS idx_manga_rating ON manga(rating DESC);
          CREATE INDEX IF NOT EXISTS idx_manga_lastRead ON manga(lastReadAt DESC);
          CREATE INDEX IF NOT EXISTS idx_manga_status ON manga(status);
          CREATE INDEX IF NOT EXISTS idx_manga_status_updated ON manga(status, lastUpdated DESC);
          CREATE INDEX IF NOT EXISTS idx_manga_user_updated ON manga(userId, lastUpdated DESC);
          CREATE INDEX IF NOT EXISTS idx_manga_user_favorite ON manga(userId, isFavorite);
          CREATE INDEX IF NOT EXISTS idx_manga_user_lastRead ON manga(userId, lastReadAt DESC);
          CREATE INDEX IF NOT EXISTS idx_manga_flagged ON manga(isFlagged);
          CREATE INDEX IF NOT EXISTS idx_manga_isNsfw ON manga(isNsfw);
          CREATE INDEX IF NOT EXISTS idx_manga_nsfw_status_updated ON manga(isNsfw, status, lastUpdated DESC);

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
            chapter_number REAL NOT NULL,
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
          CREATE INDEX IF NOT EXISTS idx_read_progress_lookup ON reading_progress(manga_id, user_id, chapter_number);
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
            current_chapter REAL DEFAULT 0,
            last_read_at TEXT,
            status TEXT,
            rating REAL,
            notes TEXT,
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
          CREATE INDEX IF NOT EXISTS idx_user_fav_reverse ON user_favorites(manga_id, user_id);
          CREATE INDEX IF NOT EXISTS idx_user_lib_user ON user_library_state(user_id, last_read_at);
          CREATE INDEX IF NOT EXISTS idx_user_lib_status ON user_library_state(user_id, status);
          CREATE INDEX IF NOT EXISTS idx_sticky_notes_manga ON page_sticky_notes(manga_id, chapter_number);
          CREATE INDEX IF NOT EXISTS idx_sticky_notes_user ON page_sticky_notes(user_id);

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
      },
    },
    {
      version: 2,
      name: 'ensure_columns_and_indices',
      run: (database) => {
        const getCols = (tbl: string) => {
          try {
            return new Set((database.prepare(`PRAGMA table_info(${tbl})`).all() as any[]).map((c) => c.name));
          } catch {
            return new Set<string>();
          }
        };

        const mangaCols = getCols('manga');
        if (!mangaCols.has('availableSources')) database.exec('ALTER TABLE manga ADD COLUMN availableSources TEXT');
        if (!mangaCols.has('isFlagged')) database.exec('ALTER TABLE manga ADD COLUMN isFlagged INTEGER DEFAULT 0');
        if (!mangaCols.has('flagReason')) database.exec('ALTER TABLE manga ADD COLUMN flagReason TEXT');
        if (!mangaCols.has('flaggedAt')) database.exec('ALTER TABLE manga ADD COLUMN flaggedAt TEXT');
        if (!mangaCols.has('metadataOverrides')) database.exec('ALTER TABLE manga ADD COLUMN metadataOverrides TEXT');
        if (!mangaCols.has('customTags')) database.exec('ALTER TABLE manga ADD COLUMN customTags TEXT');
        if (!mangaCols.has('categories')) database.exec('ALTER TABLE manga ADD COLUMN categories TEXT');
        if (!mangaCols.has('isNsfw')) database.exec('ALTER TABLE manga ADD COLUMN isNsfw INTEGER DEFAULT 0');
        database.exec('UPDATE manga SET isNsfw = 0 WHERE isNsfw IS NULL');

        const catCols = getCols('categories');
        if (!catCols.has('is_dynamic')) database.exec('ALTER TABLE categories ADD COLUMN is_dynamic INTEGER DEFAULT 0');
        if (!catCols.has('rule_type')) database.exec('ALTER TABLE categories ADD COLUMN rule_type TEXT');
        if (!catCols.has('rule_value')) database.exec('ALTER TABLE categories ADD COLUMN rule_value TEXT');

        const ulsCols = getCols('user_library_state');
        if (!ulsCols.has('rating')) database.exec('ALTER TABLE user_library_state ADD COLUMN rating REAL');
        if (!ulsCols.has('notes')) database.exec('ALTER TABLE user_library_state ADD COLUMN notes TEXT');

        const psnCols = getCols('page_sticky_notes');
        if (!psnCols.has('user_id')) database.exec('ALTER TABLE page_sticky_notes ADD COLUMN user_id TEXT');
        database.exec(`UPDATE page_sticky_notes SET user_id = 'usr_admin' WHERE user_id IS NULL`);

        const logCols = getCols('logs');
        if (!logCols.has('mangaId')) database.exec('ALTER TABLE logs ADD COLUMN mangaId TEXT');
        if (!logCols.has('type')) database.exec('ALTER TABLE logs ADD COLUMN type TEXT');
      },
    },
    {
      version: 3,
      name: 'cascade_cleanup_triggers',
      run: (database) => {
        database.exec(`
          CREATE TRIGGER IF NOT EXISTS trg_manga_cleanup_after_delete
          AFTER DELETE ON manga
          FOR EACH ROW
          BEGIN
            DELETE FROM manga_categories WHERE manga_id = OLD.id;
            DELETE FROM reading_progress WHERE manga_id = OLD.id;
            DELETE FROM user_library_state WHERE manga_id = OLD.id;
            DELETE FROM user_favorites WHERE manga_id = OLD.id;
            DELETE FROM page_sticky_notes WHERE manga_id = OLD.id;
            DELETE FROM readlist_items WHERE manga_id = OLD.id;
          END;
        `);
      },
    },
    {
      version: 4,
      name: 'manga_chapters_schema',
      run: (database) => {
        database.exec(`
          CREATE TABLE IF NOT EXISTS manga_chapters (
            id TEXT PRIMARY KEY,
            manga_id TEXT NOT NULL,
            source_id TEXT NOT NULL,
            chapter_number REAL NOT NULL,
            title TEXT,
            url TEXT NOT NULL,
            scanlator TEXT,
            upload_date TEXT,
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            FOREIGN KEY (manga_id) REFERENCES manga(id) ON DELETE CASCADE
          );
          CREATE INDEX IF NOT EXISTS idx_manga_chapters_lookup ON manga_chapters(manga_id, chapter_number);
          CREATE INDEX IF NOT EXISTS idx_manga_chapters_source ON manga_chapters(source_id);

          CREATE TRIGGER IF NOT EXISTS trg_manga_chapters_cleanup
          AFTER DELETE ON manga
          FOR EACH ROW
          BEGIN
            DELETE FROM manga_chapters WHERE manga_id = OLD.id;
          END;
        `);
      },
    },
  ];

  for (const migration of migrations) {
    if (currentVersion < migration.version) {
      db.transaction(() => {
        migration.run(db);
        db.pragma(`user_version = ${migration.version}`);
      })();
    }
  }
}

export function closeDatabase(): void {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
    logger.info('SQLite', 'Closed SQLite database cleanly with TRUNCATE checkpoint');
  } catch (err: any) {
    logger.error('SQLite', 'Error during database shutdown checkpoint/close', { error: err?.message || String(err) });
  }
}

// Auto-initialize schema on module load
initializeDatabaseSchema();

