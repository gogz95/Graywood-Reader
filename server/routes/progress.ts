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
  const all = SqliteDb.getAllManga();
  const map = new Map<string, any>();
  for (const m of all) {
    const prog = SqliteDb.getReadingProgress(m.id, userId);
    for (const p of prog) {
      const rec = map.get(m.id);
      if (!rec || (p.last_read_at || '') > (rec.last_read_at || '')) {
        map.set(m.id, { manga: m, progress: p });
      }
    }
  }
  const list = [...map.values()]
    .sort((a, b) => (b.progress.last_read_at || '').localeCompare(a.progress.last_read_at || ''))
    .slice(0, 50);
  res.json(list);
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