import { db } from './connection';
import { PageStickyNote } from '../src/types';

export function getStickyNotes(mangaId: string, userId?: string): PageStickyNote[] {
  try {
    if (userId) {
      return db
        .prepare(
          'SELECT id, manga_id as mangaId, chapter_number as chapterNumber, page_index as pageIndex, note_text as noteText, color, created_at as createdAt, updated_at as updatedAt, user_id as userId FROM page_sticky_notes WHERE manga_id = ? AND user_id = ? ORDER BY chapter_number ASC, page_index ASC'
        )
        .all(mangaId, userId) as PageStickyNote[];
    }
    return db
      .prepare(
        'SELECT id, manga_id as mangaId, chapter_number as chapterNumber, page_index as pageIndex, note_text as noteText, color, created_at as createdAt, updated_at as updatedAt, user_id as userId FROM page_sticky_notes WHERE manga_id = ? ORDER BY chapter_number ASC, page_index ASC'
      )
      .all(mangaId) as PageStickyNote[];
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
    const res = userId
      ? db.prepare('DELETE FROM page_sticky_notes WHERE id = ? AND user_id = ?').run(id, userId)
      : db.prepare('DELETE FROM page_sticky_notes WHERE id = ?').run(id);
    return res.changes > 0;
  } catch {
    return false;
  }
}
