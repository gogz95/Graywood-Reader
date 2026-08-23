// ============================================================================
// CROSS-SERIES STORY ARCS & CUSTOM READLISTS ROUTER
// Manages multi-series reading orders, crossover events, and playlists
// ============================================================================

import { Router, Request, Response } from 'express';
import { SqliteDb } from '../../sqlite-db';
import { resolveRequestUserId } from '../appState';

export const readlistsRouter = Router();

// GET /api/readlists - List all readlists for current user
readlistsRouter.get('/api/readlists', (req: Request, res: Response): void => {
  const userId = resolveRequestUserId(req) || 'usr_guest';
  const readlists = SqliteDb.getReadlists(userId);
  res.json({ readlists });
});

// POST /api/readlists - Create new readlist
readlistsRouter.post('/api/readlists', (req: Request, res: Response): void => {
  const userId = resolveRequestUserId(req) || 'usr_guest';
  const { name, description, coverImage } = req.body || {};

  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'Readlist name is required' });
    return;
  }

  const id = `rl_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const readlist = SqliteDb.createReadlist({
    id,
    userId,
    name: name.trim(),
    description: description ? String(description).trim() : undefined,
    coverImage: coverImage ? String(coverImage).trim() : undefined,
  });

  res.status(201).json({ success: true, readlist });
});

// GET /api/readlists/:id - Fetch single readlist with chapter items
readlistsRouter.get('/api/readlists/:id', (req: Request, res: Response): void => {
  const userId = resolveRequestUserId(req) || 'usr_guest';
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const readlist = SqliteDb.getReadlistById(id, userId);

  if (!readlist) {
    res.status(404).json({ error: 'Readlist not found' });
    return;
  }

  res.json({ readlist });
});

// PUT /api/readlists/:id - Update readlist details
readlistsRouter.put('/api/readlists/:id', (req: Request, res: Response): void => {
  const userId = resolveRequestUserId(req) || 'usr_guest';
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { name, description, coverImage } = req.body || {};

  const updated = SqliteDb.updateReadlist(id, { name, description, coverImage }, userId);
  if (!updated) {
    res.status(404).json({ error: 'Readlist not found' });
    return;
  }

  res.json({ success: true, readlist: updated });
});

// DELETE /api/readlists/:id - Delete readlist
readlistsRouter.delete('/api/readlists/:id', (req: Request, res: Response): void => {
  const userId = resolveRequestUserId(req) || 'usr_guest';
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  const ok = SqliteDb.deleteReadlist(id, userId);
  res.json({ success: ok });
});

// POST /api/readlists/:id/items - Add item or range to readlist
readlistsRouter.post('/api/readlists/:id/items', (req: Request, res: Response): void => {
  const userId = resolveRequestUserId(req) || 'usr_guest';
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const readlist = SqliteDb.getReadlistById(id, userId);

  if (!readlist) {
    res.status(404).json({ error: 'Readlist not found' });
    return;
  }

  const { mangaId, chapterNumber, chapterNumbers, chapterTitle, notes } = req.body || {};

  if (!mangaId) {
    res.status(400).json({ error: 'mangaId is required' });
    return;
  }

  const existingItems = readlist.items || [];
  let currentSort = existingItems.length;

  if (Array.isArray(chapterNumbers) && chapterNumbers.length > 0) {
    for (const num of chapterNumbers) {
      SqliteDb.addReadlistItem({
        id: `rli_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        readlistId: id,
        mangaId: String(mangaId),
        chapterNumber: Number(num),
        chapterTitle: `Chapter ${num}`,
        sortOrder: currentSort++,
        notes: notes ? String(notes) : undefined,
      });
    }
  } else if (chapterNumber !== undefined) {
    SqliteDb.addReadlistItem({
      id: `rli_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      readlistId: id,
      mangaId: String(mangaId),
      chapterNumber: Number(chapterNumber),
      chapterTitle: chapterTitle ? String(chapterTitle) : `Chapter ${chapterNumber}`,
      sortOrder: currentSort,
      notes: notes ? String(notes) : undefined,
    });
  } else {
    res.status(400).json({ error: 'chapterNumber or chapterNumbers array is required' });
    return;
  }

  const refreshed = SqliteDb.getReadlistById(id, userId);
  res.status(201).json({ success: true, readlist: refreshed });
});

// DELETE /api/readlists/:id/items/:itemId - Remove item from readlist
readlistsRouter.delete('/api/readlists/:id/items/:itemId', (req: Request, res: Response): void => {
  const userId = resolveRequestUserId(req) || 'usr_guest';
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const itemId = Array.isArray(req.params.itemId) ? req.params.itemId[0] : req.params.itemId;

  const readlist = SqliteDb.getReadlistById(id, userId);
  if (!readlist) {
    res.status(404).json({ error: 'Readlist not found' });
    return;
  }

  SqliteDb.removeReadlistItem(itemId, id);
  const refreshed = SqliteDb.getReadlistById(id, userId);
  res.json({ success: true, readlist: refreshed });
});

// PUT /api/readlists/:id/reorder - Reorder items in playlist
readlistsRouter.put('/api/readlists/:id/reorder', (req: Request, res: Response): void => {
  const userId = resolveRequestUserId(req) || 'usr_guest';
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { items } = req.body || {};

  if (!Array.isArray(items)) {
    res.status(400).json({ error: 'items array is required' });
    return;
  }

  const readlist = SqliteDb.getReadlistById(id, userId);
  if (!readlist) {
    res.status(404).json({ error: 'Readlist not found' });
    return;
  }

  SqliteDb.setReadlistItems(id, items);
  const refreshed = SqliteDb.getReadlistById(id, userId);
  res.json({ success: true, readlist: refreshed });
});
