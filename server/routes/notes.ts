import { Router, Request, Response } from 'express';
import { SqliteDb } from '../../sqlite-db';
import { PageStickyNote } from '../../src/types';

export const notesRouter = Router();

// GET /api/notes/:mangaId - Retrieve all page notes for a manga
notesRouter.get('/api/notes/:mangaId', (req: Request, res: Response) => {
  try {
    const mangaId = String(req.params.mangaId);
    const notes = SqliteDb.getStickyNotes(mangaId);
    res.json(notes);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to retrieve sticky notes', details: err.message });
  }
});

// POST /api/notes - Create or update a page sticky note
notesRouter.post('/api/notes', (req: Request, res: Response) => {
  try {
    const { id, mangaId, chapterNumber, pageIndex, noteText, color } = req.body;
    if (!mangaId || chapterNumber === undefined || pageIndex === undefined || !noteText) {
      return res.status(400).json({ error: 'Missing required fields (mangaId, chapterNumber, pageIndex, noteText)' });
    }

    const noteId = id || `note_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const note: PageStickyNote = {
      id: String(noteId),
      mangaId: String(mangaId),
      chapterNumber: Number(chapterNumber),
      pageIndex: Number(pageIndex),
      noteText: String(noteText),
      color: color || 'yellow',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    SqliteDb.saveStickyNote(note);
    res.json({ success: true, note });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to save sticky note', details: err.message });
  }
});

// DELETE /api/notes/:id - Delete a page sticky note
notesRouter.delete('/api/notes/:id', (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const deleted = SqliteDb.deleteStickyNote(id);
    res.json({ success: deleted });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete sticky note', details: err.message });
  }
});
