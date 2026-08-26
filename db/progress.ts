import { db } from './connection';

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

export function upsertReadingProgress(p: {
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
}

export function getReadingProgress(mangaId: string, userId: string): any[] {
  return stmtGetReadingProgress.all(mangaId, userId);
}

export function getReadingProgressForChapter(mangaId: string, userId: string, chapterNumber: number): any {
  return stmtGetReadingProgressForChapter.get(mangaId, userId, Number(chapterNumber) || 0) || null;
}

export function recordReadingActivity(userId: string, opts: { chaptersRead?: number; minutesSpent?: number }) {
  const today = new Date().toISOString().substring(0, 10);
  const allRows = stmtGetReadingActivity.all(userId) as any[];
  const existing = allRows.find((r: any) => r.date === today);
  stmtUpsertReadingActivity.run({
    date: today,
    user_id: userId,
    chapters_read: (existing?.chapters_read || 0) + (Number(opts.chaptersRead) || 0),
    minutes_spent: (existing?.minutes_spent || 0) + (Number(opts.minutesSpent) || 0),
  });
}

export function getReadingActivity(userId: string): any[] {
  return stmtGetReadingActivity.all(userId);
}

export function getAllReadingProgressForUser(userId: string): any[] {
  return stmtGetReadingProgressByUser.all(userId);
}

const stmtDeleteReadingProgressByUserId = db.prepare('DELETE FROM reading_progress WHERE user_id = ?');
const stmtDeleteReadingActivityByUserId = db.prepare('DELETE FROM reading_activity WHERE user_id = ?');

export function deleteReadingDataForUser(userId: string): void {
  stmtDeleteReadingProgressByUserId.run(userId);
  stmtDeleteReadingActivityByUserId.run(userId);
}
