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

const stmtGetAllLogs = db.prepare('SELECT * FROM logs ORDER BY timestamp DESC');
const stmtDeleteAllLogs = db.prepare('DELETE FROM logs');
const stmtInsertLog = db.prepare(`
  INSERT OR REPLACE INTO logs (id, mangaId, mangaTitle, sourceName, previousChapter, newChapter, timestamp, status, details, type)
  VALUES (@id, @mangaId, @mangaTitle, @sourceName, @previousChapter, @newChapter, @timestamp, @status, @details, @type)
`);

// ── Key-Value Settings Store ────────────────────────────────────────────────
export function getSetting(key: string): string | null {
  const row = stmtGetSetting.get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function setSetting(key: string, value: string) {
  stmtSetSetting.run({ key, value });
}

// ── Auto-Update Logs ────────────────────────────────────────────────────────
export function getAllLogs(): any[] {
  return stmtGetAllLogs.all();
}

export function replaceAllLogs(logs: any[]) {
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
