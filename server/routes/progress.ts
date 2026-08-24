import { Router } from 'express';
import { SqliteDb } from '../../sqlite-db';
import { resolveRequestUserId, mangaDatabase } from '../appState';

// ============================================================================
// READING PROGRESS & ACTIVITY PERSISTENCE API
// Borrowed from Kotatsu's HistoryEntity model: store a per-user, per-chapter
// reading position so readers can RESUME mid-chapter, and persist per-day
// activity so the analytics/heatmap show real data instead of mock values.
// Extracted from server.ts.
// ============================================================================

export const progressRouter = Router();

// ── SSE Live Reading Session Sync Engine ─────────────────────────────────────
interface SseSessionClient {
  userId: string;
  res: any;
}
const sseClients = new Set<SseSessionClient>();

export function broadcastProgressSync(event: {
  userId: string;
  mangaId: string;
  chapterNumber: number;
  pageIndex?: number;
  pageCount?: number;
  percent?: number;
}): void {
  const payload = `data: ${JSON.stringify({ type: 'progress_update', ...event, timestamp: new Date().toISOString() })}\n\n`;
  for (const client of sseClients) {
    if (client.userId === event.userId || client.userId === 'usr_guest') {
      try {
        client.res.write(payload);
      } catch {
        sseClients.delete(client);
      }
    }
  }
}

// GET /api/reader/sync/events - Real-time SSE channel for live cross-device session synchronization
progressRouter.get("/api/reader/sync/events", (req, res) => {
  const userId = resolveProgressUserId(req);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const client: SseSessionClient = { userId, res };
  sseClients.add(client);

  res.write(`data: ${JSON.stringify({ type: 'connected', userId, timestamp: new Date().toISOString() })}\n\n`);

  // 25-second keep-alive heartbeat ping
  const pingInterval = setInterval(() => {
    try {
      res.write(': keepalive\n\n');
    } catch {
      clearInterval(pingInterval);
      sseClients.delete(client);
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(pingInterval);
    sseClients.delete(client);
  });
});

// ------------------------------------------------------------
// GET /api/reader/progress?sourceId=...&slug=...
// Returns reading progress for a specific manga identified by its source ID and slug.
// ------------------------------------------------------------
progressRouter.get("/api/reader/progress", async (req, res) => {
  const sourceId = (req.query.sourceId as string || "").trim();
  const slug = (req.query.slug as string || "").trim();
  if (!sourceId || !slug) {
    return res.status(400).json({ error: "sourceId and slug are required" });
  }
  const userId = resolveProgressUserId(req);
  // Find manga matching the sourceId and slug. We look at sourceName and sourceUrl.
  const manga = mangaDatabase.find((m) => {
    const nameMatch = m.sourceName && m.sourceName.toLowerCase().includes(sourceId.toLowerCase());
    const urlMatch = m.sourceUrl && m.sourceUrl.toLowerCase().includes(slug.toLowerCase());
    return nameMatch && urlMatch;
  });
  if (!manga) {
    return res.status(404).json({ error: "Manga not found for given sourceId and slug" });
  }
  const rows = SqliteDb.getReadingProgress(manga.id, userId);
  return res.json(rows);
});

function resolveProgressUserId(req: any): string {
  // Anonymous remote writes land in the shared guest bucket — NEVER on the
  // host admin's personal progress/favorites.
  return resolveRequestUserId(req) || 'usr_guest';
}

// Save (or update) the current reading position for a manga/chapter.
progressRouter.post("/api/reader/progress", (req, res) => {
  const { mangaId, chapterNumber, pageIndex, pageCount, percent } = req.body || {};
  if (!mangaId || chapterNumber === undefined) {
    return res.status(400).json({ error: 'mangaId and chapterNumber are required' });
  }
  const userId = resolveProgressUserId(req);

  SqliteDb.upsertReadingProgress({
    manga_id: String(mangaId),
    user_id: userId,
    chapter_number: Number(chapterNumber) || 0,
    page_index: Number(pageIndex),
    page_count: Number(pageCount),
    percent: Number(percent),
  });

  // Per-user library chapter (do NOT clobber global catalog currentChapter)
  try {
    const ch = Number(chapterNumber) || 0;
    SqliteDb.setUserLibraryChapter(userId, String(mangaId), ch);
    SqliteDb.setUserFavorite(userId, String(mangaId), true);
  } catch (err) {
    console.error('[Progress Engine] Failed to mirror progress onto user library state:', err);
  }

  // Broadcast real-time SSE progress update to all active devices & tabs
  try {
    broadcastProgressSync({
      userId,
      mangaId: String(mangaId),
      chapterNumber: Number(chapterNumber) || 0,
      pageIndex: Number(pageIndex),
      pageCount: Number(pageCount),
      percent: Number(percent),
    });
  } catch (err) {
    console.error('[SSE Sync Engine] Broadcast failed:', err);
  }

  res.json({ success: true });
});

// ── Per-Series Reader Settings Sync ───────────────────────────────────────────
// Reader preferences (mode, page gap, filter, background, zoom…) roam across
// PWA / Electron / other browsers per user exactly like reading progress does.
// Falls back to 404/null when no server-side settings were saved yet so the
// client can keep using its fast local (localStorage) snapshot.

// GET /api/reader/settings/:mangaId  → saved settings JSON (or 404/null)
progressRouter.get("/api/reader/settings/:mangaId", (req, res) => {
  const mangaId = String(req.params.mangaId || '');
  if (!mangaId) return res.status(400).json({ error: 'mangaId is required' });
  const userId = resolveProgressUserId(req);
  const saved = SqliteDb.getSeriesReaderSettings(userId, mangaId);
  if (!saved) return res.status(404).json({ error: 'No saved reader settings', settings: null });
  res.json({ success: true, settings: saved });
});

// PUT /api/reader/settings/:mangaId  → persist settings for this user
progressRouter.put("/api/reader/settings/:mangaId", (req, res) => {
  const mangaId = String(req.params.mangaId || '');
  const settings = req.body?.settings || req.body || {};
  if (!mangaId) return res.status(400).json({ error: 'mangaId is required' });
  if (!settings || typeof settings !== 'object') {
    return res.status(400).json({ error: 'settings object is required' });
  }
  const userId = resolveProgressUserId(req);
  SqliteDb.setSeriesReaderSettings(userId, mangaId, settings);
  res.json({ success: true });
});

// Get the resume position(s) for a manga (all stored chapters for the user).
progressRouter.get("/api/reader/history/:mangaId", (req, res) => {
  const { mangaId } = req.params;
  const userId = resolveProgressUserId(req);
  const rows = SqliteDb.getReadingProgress(String(mangaId), userId);
  res.json(rows);
});

// Get the "Continue Reading" list: most-recently-read manga for the user.
progressRouter.get("/api/reader/history", (req, res) => {
  const userId = resolveProgressUserId(req);
  const progRows = SqliteDb.getAllReadingProgressForUser(userId);
  const map = new Map<string, any>();

  for (const p of progRows) {
    if (!p.manga_id || map.has(p.manga_id)) continue;
    const manga = SqliteDb.getMangaById(p.manga_id) || mangaDatabase.find((m) => m.id === p.manga_id);
    if (manga) {
      map.set(p.manga_id, { manga, progress: p });
      if (map.size >= 50) break;
    }
  }

  res.json([...map.values()]);
});

// Get real reading analytics (per-day activity) for the active user, converted
// into the ReadingAnalytics shape (streaks, totals, heatmap).
progressRouter.get("/api/reader/analytics", (req, res) => {
  const userId = resolveProgressUserId(req);
  const rows = SqliteDb.getReadingActivity(userId);
  let totalChaptersRead = 0;
  let totalTimeMinutes = 0;
  for (const r of rows) {
    totalChaptersRead += Number(r.chapters_read) || 0;
    totalTimeMinutes += Number(r.minutes_spent) || 0;
  }

  const dayMap = new Map<string, number>();
  for (const r of rows) dayMap.set(r.date, Number(r.chapters_read) || 0);
  const dates = [...dayMap.keys()].sort();

  // Favorite genre: most common genre across the user's personal library
  // (favorites & in-progress series weigh more), mirroring the recommendation
  // weighting used by the frontend.
  const genreScore = new Map<string, number>();
  for (const m of SqliteDb.applyUserOverlay(SqliteDb.getAllManga(), userId)) {
    const weight = (m.isFavorite ? 3 : 0) + (m.status === 'reading' ? 2 : 0) + 1;
    for (const g of m.genres || []) {
      genreScore.set(g, (genreScore.get(g) || 0) + weight);
    }
  }
  const favoriteGenre = [...genreScore.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';

  // Current streak: trailing consecutive days with activity, ending today.
  const today = new Date().toISOString().substring(0, 10);
  let currentStreak = 0;
  let cursor = today;
  for (let i = 0; i < 3650; i++) {
    if (dayMap.has(cursor)) { currentStreak++; cursor = prevDate(cursor); }
    else break;
  }

  // Longest streak across all recorded days.
  let longestStreak = 0;
  let run = 0;
  for (const d of dates) {
    if (dayMap.has(d)) { run++; longestStreak = Math.max(longestStreak, run); }
    else run = 0;
  }

  res.json({
    currentStreakDays: currentStreak,
    longestStreakDays: longestStreak,
    totalChaptersRead,
    totalTimeMinutes,
    favoriteGenre,
    activities: rows.map((r) => {
      const chapters = Number(r.chapters_read) || 0;
      return {
        date: r.date,
        chaptersRead: chapters,
        minutesSpent: Number(r.minutes_spent) || 0,
        level: clamp(0, 4, chapters),
      };
    }),
  });
});

function prevDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().substring(0, 10);
}
function clamp(min: number, max: number, v: number): number {
  return Math.min(max, Math.max(min, v));
}