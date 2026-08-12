import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
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
    availableSources TEXT,
    metadataOverrides TEXT
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
try { db.exec('ALTER TABLE manga ADD COLUMN metadataOverrides TEXT'); } catch(e) {}

try { db.exec('CREATE INDEX IF NOT EXISTS idx_manga_flagged ON manga(isFlagged)'); } catch(e) {}

// Schema extensions for app-state persistence (profiles, logs, KV settings)
try { db.exec('ALTER TABLE profiles ADD COLUMN password TEXT'); } catch (e) {}
try { db.exec('ALTER TABLE logs ADD COLUMN mangaId TEXT'); } catch (e) {}
try { db.exec('ALTER TABLE logs ADD COLUMN type TEXT'); } catch (e) {}

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
    syncedFromApi, apiId, userId, isFavorite, isFlagged, flagReason, flaggedAt, metadataOverrides
  ) VALUES (
    @id, @title, @altTitles, @type, @coverImage, @description, @genres, @status,
    @currentChapter, @totalChapters, @latestChapter, @lastUpdated, @rating,
    @sourceUrl, @sourceName, @availableSources, @autoUpdateEnabled, @notes, @addedAt, @lastReadAt,
    @syncedFromApi, @apiId, @userId, @isFavorite, @isFlagged, @flagReason, @flaggedAt, @metadataOverrides
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
    metadataOverrides=excluded.metadataOverrides
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
const stmtUpsertReadingActivity = db.prepare(`
  INSERT INTO reading_activity (date, user_id, chapters_read, minutes_spent)
  VALUES (@date, @user_id, @chapters_read, @minutes_spent)
  ON CONFLICT(date, user_id) DO UPDATE SET
    chapters_read = excluded.chapters_read,
    minutes_spent = excluded.minutes_spent
`);
const stmtGetReadingActivity = db.prepare(`
  SELECT * FROM reading_activity WHERE user_id = ? ORDER BY date ASC
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
    metadataOverrides: row.metadataOverrides ? JSON.parse(row.metadataOverrides) : [],
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
    metadataOverrides: JSON.stringify(item.metadataOverrides || []),
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

  rekeyCollidedSourceIds(): number {
    return rekeyCollidedSourceIds();
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
  },

  // ── KV Settings Store ──────────────────────────────────────────────────────
  getSetting(key: string): string | null {
    const row = stmtGetSetting.get(key) as { value: string } | undefined;
    return row ? row.value : null;
  },

  setSetting(key: string, value: string) {
    stmtSetSetting.run({ key, value });
  },

  // ── Profiles ───────────────────────────────────────────────────────────────
  getAllProfiles(): any[] {
    return stmtGetAllProfiles.all();
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
  }
};

// Execute migration check on startup
migrateJsonToSqlite();
