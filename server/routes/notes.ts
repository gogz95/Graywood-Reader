import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { SqliteDb } from '../../sqlite-db';
import { PageStickyNote } from '../../src/types';
import { isHostRequest, verifyAuthToken } from '../security';

export const notesRouter = Router();

/**
 * Resolve the acting user for sticky notes. Notes are PRIVATE per user, so
 * identity comes only from the verified Bearer token (never client body),
 * falling back to the host admin on the host machine and the shared guest
 * bucket for anonymous remote clients.
 */
function resolveNotesUserId(req: Request): string {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (token) {
    const payload = verifyAuthToken(token);
    if (payload && typeof payload.sub === 'string') return payload.sub;
  }
  return isHostRequest(req) ? 'usr_admin' : 'usr_guest';
}

// GET /api/notes/:mangaId - Retrieve the caller's own page notes for a manga
notesRouter.get('/api/notes/:mangaId', (req: Request, res: Response) => {
  try {
    const mangaId = String(req.params.mangaId);
    const userId = resolveNotesUserId(req);
    const notes = SqliteDb.getStickyNotes(mangaId, userId);
    res.json(notes);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to retrieve sticky notes', details: err.message });
  }
});

// POST /api/notes - Create or update a page sticky note (owner is server-resolved)
notesRouter.post('/api/notes', (req: Request, res: Response) => {
  try {
    const { id, mangaId, chapterNumber, pageIndex, noteText, color } = req.body;
    if (!mangaId || chapterNumber === undefined || pageIndex === undefined || !noteText) {
      return res.status(400).json({ error: 'Missing required fields (mangaId, chapterNumber, pageIndex, noteText)' });
    }

    const userId = resolveNotesUserId(req);
    const noteId = id || `note_${crypto.randomUUID()}`;
    const note: PageStickyNote = {
      id: String(noteId),
      mangaId: String(mangaId),
      chapterNumber: Number(chapterNumber),
      pageIndex: Number(pageIndex),
      noteText: String(noteText),
      color: color || 'yellow',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      userId,
    };

    SqliteDb.saveStickyNote(note);
    res.json({ success: true, note });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to save sticky note', details: err.message });
  }
});

// DELETE /api/notes/:id - Delete one of the caller's own sticky notes
notesRouter.delete('/api/notes/:id', (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const userId = resolveNotesUserId(req);
    const deleted = SqliteDb.deleteStickyNote(id, userId);
    res.json({ success: deleted });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete sticky note', details: err.message });
  }
});
