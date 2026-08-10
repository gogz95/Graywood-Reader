import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { MangaItem, UserProfile, AppSettings, AutoUpdateLog } from './src/types';

// Ensure data directory exists
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'manga.db');

console.log(`[SQLite Engine] Initializing SQLite database at ${DB_PATH}...`);
const db = new Database(DB_PATH);

// Enable WAL Mode for high concurrency and sub-millisecond writes
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

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
    availableSources TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_manga_title ON manga(title);
  CREATE INDEX IF NOT EXISTS idx_manga_favorite ON manga(isFavorite);
  CREATE INDEX IF NOT EXISTS idx_manga_type ON manga(type);
  CREATE INDEX IF NOT EXISTS idx_manga_updated ON manga(lastUpdated DESC);
  CREATE INDEX IF NOT EXISTS idx_manga_apiId ON manga(apiId);
`);

try { db.exec('ALTER TABLE manga ADD COLUMN availableSources TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE manga ADD COLUMN isFlagged INTEGER DEFAULT 0'); } catch(e) {}
try { db.exec('ALTER TABLE manga ADD COLUMN flagReason TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE manga ADD COLUMN flaggedAt TEXT'); } catch(e) {}

try { db.exec('CREATE INDEX IF NOT EXISTS idx_manga_flagged ON manga(isFlagged)'); } catch(e) {}

db.exec(`
  CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    username TEXT,
    email TEXT,
    avatar TEXT,
    role TEXT,
    storageFolderPath TEXT,
    createdAt TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS logs (
    id TEXT PRIMARY KEY,
    mangaTitle TEXT,
    sourceName TEXT,
    previousChapter INTEGER,
    newChapter INTEGER,
    timestamp TEXT,
    status TEXT,
    details TEXT
  );
`);

// Prepared Statements for Sub-millisecond Execution
const stmtGetAllManga = db.prepare('SELECT * FROM manga ORDER BY lastUpdated DESC');
const stmtGetMangaById = db.prepare('SELECT * FROM manga WHERE id = ?');
const stmtGetMangaByApiId = db.prepare('SELECT * FROM manga WHERE apiId = ?');

const stmtUpsertManga = db.prepare(`
  INSERT INTO manga (
    id, title, altTitles, type, coverImage, description, genres, status,
    currentChapter, totalChapters, latestChapter, lastUpdated, rating,
    sourceUrl, sourceName, availableSources, autoUpdateEnabled, notes, addedAt, lastReadAt,
    syncedFromApi, apiId, userId, isFavorite, isFlagged, flagReason, flaggedAt
  ) VALUES (
    @id, @title, @altTitles, @type, @coverImage, @description, @genres, @status,
    @currentChapter, @totalChapters, @latestChapter, @lastUpdated, @rating,
    @sourceUrl, @sourceName, @availableSources, @autoUpdateEnabled, @notes, @addedAt, @lastReadAt,
    @syncedFromApi, @apiId, @userId, @isFavorite, @isFlagged, @flagReason, @flaggedAt
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
    flaggedAt=excluded.flaggedAt
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

// Helper Serializers & Deserializers
function mapRowToMangaItem(row: any): MangaItem {
  return {
    ...row,
    altTitles: row.altTitles ? JSON.parse(row.altTitles) : [],
    genres: row.genres ? JSON.parse(row.genres) : [],
    availableSources: row.availableSources ? JSON.parse(row.availableSources) : [],
    autoUpdateEnabled: Boolean(row.autoUpdateEnabled),
    isFavorite: Boolean(row.isFavorite),
    isFlagged: Boolean(row.isFlagged),
    flagReason: row.flagReason || undefined,
    flaggedAt: row.flaggedAt || undefined,
    currentChapter: Number(row.currentChapter) || 0,
    latestChapter: Number(row.latestChapter) || 1,
    totalChapters: row.totalChapters ? Number(row.totalChapters) : null,
    rating: Number(row.rating) || 9.0,
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

function mapMangaItemToRow(item: MangaItem) {
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
    latestChapter: item.latestChapter || 100,
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
  };
}

// Data Migration Engine: Automatically imports existing database.json into SQLite
export function migrateJsonToSqlite() {
  const jsonPath = path.join(__dirname, 'database.json');
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

// Public Database Service Functions
export const SqliteDb = {
  getAllManga(): MangaItem[] {
    const rows = stmtGetAllManga.all();
    return rows.map(mapRowToMangaItem);
  },

  getMangaById(id: string): MangaItem | null {
    const row = stmtGetMangaById.get(id);
    return row ? mapRowToMangaItem(row) : null;
  },

  getMangaByApiId(apiId: string): MangaItem | null {
    const row = stmtGetMangaByApiId.get(apiId);
    return row ? mapRowToMangaItem(row) : null;
  },

  upsertManga(item: MangaItem) {
    stmtUpsertManga.run(mapMangaItemToRow(item));
  },

  bulkUpsertManga(items: MangaItem[]) {
    const transaction = db.transaction((list: MangaItem[]) => {
      for (const item of list) {
        stmtUpsertManga.run(mapMangaItemToRow(item));
      }
    });
    transaction(items);
  },

  updateChapterProgress(id: string, chapterNumber: number) {
    stmtUpdateProgress.run(chapterNumber, new Date().toISOString(), id);
  },

  toggleFavorite(id: string, isFavorite: boolean) {
    stmtToggleFavorite.run(isFavorite ? 1 : 0, id);
  },

  toggleFlag(id: string, isFlagged: boolean, flagReason?: string) {
    stmtToggleFlag.run(isFlagged ? 1 : 0, flagReason || null, isFlagged ? new Date().toISOString() : null, id);
  },

  deleteManga(id: string) {
    stmtDeleteManga.run(id);
  },

  purgeReaperScans() {
    return purgeReaperScans();
  },

  deleteAllManga() {
    db.prepare('DELETE FROM manga').run();
  },

  getMangaCount(): number {
    const row = db.prepare('SELECT COUNT(*) as count FROM manga').get() as { count: number };
    return row.count;
  }
};

// Execute migration check on startup
migrateJsonToSqlite();
