import { db } from './connection';

const stmtGetSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
const stmtSetSetting = db.prepare(`
  INSERT INTO settings (key, value) VALUES (@key, @value)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
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

const stmtGetCoverCache = db.prepare('SELECT data, content_type FROM cover_cache WHERE url_hash = ?');
const stmtSetCoverCache = db.prepare(`
  INSERT INTO cover_cache (url_hash, data, content_type, updated_at)
  VALUES (@url_hash, @data, @content_type, @updated_at)
  ON CONFLICT(url_hash) DO UPDATE SET
    data = excluded.data,
    content_type = excluded.content_type,
    updated_at = excluded.updated_at
`);

const stmtGetAllLogs = db.prepare('SELECT * FROM logs ORDER BY timestamp DESC LIMIT 500');
const stmtDeleteAllLogs = db.prepare('DELETE FROM logs');
const stmtInsertLog = db.prepare(`
  INSERT OR REPLACE INTO logs (id, mangaId, mangaTitle, sourceName, previousChapter, newChapter, timestamp, status, details, type)
  VALUES (@id, @mangaId, @mangaTitle, @sourceName, @previousChapter, @newChapter, @timestamp, @status, @details, @type)
`);

const stmtGetSystemState = db.prepare('SELECT value FROM system_state WHERE key = ?');
const stmtSetSystemState = db.prepare(`
  INSERT INTO system_state (key, value, updated_at) VALUES (@key, @value, @updated_at)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
`);

// ── Key-Value Settings Store ────────────────────────────────────────────────
export function getSetting(key: string): string | null {
  const row = stmtGetSetting.get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function setSetting(key: string, value: string) {
  stmtSetSetting.run({ key, value });
}

// ── System State Key-Value Store (Cold Start / Lock Tracking) ───────────────
export function getSystemState(key: string): string | null {
  try {
    const row = stmtGetSystemState.get(key) as { value: string } | undefined;
    return row ? row.value : null;
  } catch {
    return null;
  }
}

export function setSystemState(key: string, value: string): void {
  try {
    stmtSetSystemState.run({ key, value, updated_at: new Date().toISOString() });
  } catch (err) {
    console.error('[SQLite] Failed to set system_state:', err);
  }
}

// ── Auto-Update Logs ────────────────────────────────────────────────────────
export function getAllLogs(): any[] {
  return stmtGetAllLogs.all();
}

export function replaceAllLogs(logs: any[]) {
  const boundedLogs = (logs || []).slice(0, 500);
  const transaction = db.transaction((list: any[]) => {
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
    db.prepare(`
      DELETE FROM logs WHERE id NOT IN (
        SELECT id FROM logs ORDER BY timestamp DESC LIMIT 500
      )
    `).run();
  });
  transaction(boundedLogs);
}

// ── Explore Catalog Buffer Persistence ──────────────────────────────────────
export function getExploreBuffer(): any | null {
  try {
    const raw = stmtGetSetting.get('explore_buffer') as { value: string } | undefined;
    if (!raw || !raw.value) return null;
    const parsed = JSON.parse(raw.value);
    if (!parsed || !Array.isArray(parsed.items)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setExploreBuffer(entry: { items: any[]; sourceIds: string[]; builtAt: number; expiresAt: number; lastError: string | null } | null) {
  try {
    if (!entry) return;
    stmtSetSetting.run({ key: 'explore_buffer', value: JSON.stringify(entry) });
  } catch (err) {
    console.error('[SQLite Engine] Error persisting explore buffer:', err);
  }
}

// ── Source Health Map Persistence ───────────────────────────────────────────
export function getSourceHealthMap(): Record<string, any> {
  try {
    const raw = stmtGetSetting.get('source_health_map') as { value: string } | undefined;
    if (!raw || !raw.value) return {};
    return JSON.parse(raw.value) || {};
  } catch {
    return {};
  }
}

export function setSourceHealthMap(map: Record<string, any>) {
  try {
    stmtSetSetting.run({ key: 'source_health_map', value: JSON.stringify(map) });
  } catch (err) {
    console.error('[SQLite Engine] Error persisting source health map:', err);
  }
}

// ── Per-Series Reader Settings ──────────────────────────────────────────────
export function getSeriesReaderSettings(userId: string, mangaId: string): Record<string, any> | null {
  try {
    const key = `series_reader_settings:${userId}:${mangaId}`;
    const raw = stmtGetSetting.get(key) as { value: string } | undefined;
    if (!raw || !raw.value) return null;
    const parsed = JSON.parse(raw.value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function setSeriesReaderSettings(userId: string, mangaId: string, settings: Record<string, any>) {
  try {
    const key = `series_reader_settings:${userId}:${mangaId}`;
    stmtSetSetting.run({ key, value: JSON.stringify(settings || {}) });
  } catch (err) {
    console.error('[SQLite Engine] Error persisting series reader settings:', err);
  }
}

// ── Persistent Library Cache ────────────────────────────────────────────────
export function getLibraryCache(): any | null {
  try {
    const raw = stmtGetSetting.get('persistent_library_cache_v1') as { value: string } | undefined;
    if (!raw || !raw.value) return null;
    const parsed = JSON.parse(raw.value);
    if (!parsed || !Array.isArray(parsed.series)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setLibraryCache(entry: any) {
  try {
    if (!entry) return;
    stmtSetSetting.run({ key: 'persistent_library_cache_v1', value: JSON.stringify(entry) });
  } catch (err) {
    console.error('[SQLite Engine] Error persisting library cache:', err);
  }
}

// ── Chapter Pages Cache (Stale-While-Revalidate) ─────────────────────────────
export function getCachedChapterPages(mangaId: string, chapterNumber: number, sourceUrl: string): { pages: string[]; pageCount: number } | null {
  try {
    const row = stmtGetCachedPages.get(mangaId, chapterNumber, sourceUrl, Date.now()) as { pages: string; page_count: number } | undefined;
    if (!row || !row.pages) return null;
    const pages = JSON.parse(row.pages);
    if (!Array.isArray(pages) || pages.length === 0) return null;
    return { pages, pageCount: Number(row.page_count) || pages.length };
  } catch {
    return null;
  }
}

export function setCachedChapterPages(mangaId: string, chapterNumber: number, sourceUrl: string, pages: string[], ttlMs: number = 6 * 60 * 60 * 1000): void {
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
}

export function cleanupExpiredChapterPages(): number {
  try {
    const info = stmtCleanupCachedPages.run(Date.now());
    return info.changes;
  } catch {
    return 0;
  }
}

// ── Permanent Cover Cache ───────────────────────────────────────────────────
export function getCoverCache(urlHash: string): { data: Buffer; contentType: string } | null {
  try {
    const row = stmtGetCoverCache.get(urlHash) as { data: Buffer; content_type: string } | undefined;
    if (!row || !row.data) return null;
    return { data: row.data, contentType: row.content_type };
  } catch {
    return null;
  }
}

export function setCoverCache(urlHash: string, data: Buffer, contentType: string): void {
  try {
    stmtSetCoverCache.run({
      url_hash: urlHash,
      data,
      content_type: contentType,
      updated_at: Date.now(),
    });
  } catch (err) {
    console.error('[SQLite Engine] Failed to cache cover:', err);
  }
}

