import { db } from './connection';

const stmtGetReadlistsForUser = db.prepare(`
  SELECT r.*, COUNT(ri.id) as items_count
  FROM readlists r
  LEFT JOIN readlist_items ri ON ri.readlist_id = r.id
  WHERE r.user_id = ?
  GROUP BY r.id
  ORDER BY r.updated_at DESC
`);
const stmtGetReadlistById = db.prepare('SELECT * FROM readlists WHERE id = ?');
const stmtGetReadlistItems = db.prepare(`
  SELECT ri.*, m.title as manga_title, m.coverImage as manga_cover, m.sourceUrl as manga_source_url, m.sourceName as manga_source_name
  FROM readlist_items ri
  LEFT JOIN manga m ON m.id = ri.manga_id
  WHERE ri.readlist_id = ?
  ORDER BY ri.sort_order ASC
`);
const stmtInsertReadlist = db.prepare(`
  INSERT INTO readlists (id, user_id, name, description, cover_image, created_at, updated_at)
  VALUES (@id, @userId, @name, @description, @coverImage, @createdAt, @updatedAt)
`);
const stmtUpdateReadlist = db.prepare(`
  UPDATE readlists
  SET name = @name, description = @description, cover_image = @coverImage, updated_at = @updatedAt
  WHERE id = @id AND user_id = @userId
`);
const stmtDeleteReadlist = db.prepare('DELETE FROM readlists WHERE id = ? AND user_id = ?');
const stmtDeleteReadlistItems = db.prepare('DELETE FROM readlist_items WHERE readlist_id = ?');
const stmtInsertReadlistItem = db.prepare(`
  INSERT INTO readlist_items (id, readlist_id, manga_id, chapter_number, chapter_title, sort_order, notes)
  VALUES (@id, @readlistId, @mangaId, @chapterNumber, @chapterTitle, @sortOrder, @notes)
`);
const stmtDeleteReadlistItemById = db.prepare('DELETE FROM readlist_items WHERE id = ? AND readlist_id = ?');

export function getReadlists(userId: string): any[] {
  const rows = stmtGetReadlistsForUser.all(userId) as any[];
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    name: r.name,
    description: r.description || undefined,
    coverImage: r.cover_image || undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    itemsCount: Number(r.items_count) || 0,
  }));
}

export function getReadlistById(id: string, userId?: string): any | null {
  const row = stmtGetReadlistById.get(id) as any;
  if (!row) return null;
  if (userId && row.user_id !== userId) return null;

  const itemRows = stmtGetReadlistItems.all(id) as any[];
  const items = itemRows.map((ir) => ({
    id: ir.id,
    readlistId: ir.readlist_id,
    mangaId: ir.manga_id,
    mangaTitle: ir.manga_title || 'Untitled Series',
    mangaCover: ir.manga_cover || '',
    mangaSourceUrl: ir.manga_source_url || '',
    mangaSourceName: ir.manga_source_name || '',
    chapterNumber: Number(ir.chapter_number) || 1,
    chapterTitle: ir.chapter_title || `Chapter ${ir.chapter_number}`,
    sortOrder: Number(ir.sort_order) || 0,
    notes: ir.notes || undefined,
  }));

  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description || undefined,
    coverImage: row.cover_image || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    itemsCount: items.length,
    items,
  };
}

export function createReadlist(readlist: {
  id: string;
  userId: string;
  name: string;
  description?: string;
  coverImage?: string;
  createdAt?: string;
  updatedAt?: string;
}): any {
  const now = new Date().toISOString();
  stmtInsertReadlist.run({
    id: readlist.id,
    userId: readlist.userId,
    name: readlist.name,
    description: readlist.description || null,
    coverImage: readlist.coverImage || null,
    createdAt: readlist.createdAt || now,
    updatedAt: readlist.updatedAt || now,
  });
  return { ...readlist, createdAt: readlist.createdAt || now, updatedAt: readlist.updatedAt || now, itemsCount: 0, items: [] };
}

export function updateReadlist(id: string, updates: { name?: string; description?: string; coverImage?: string }, userId: string): any | null {
  const existing = stmtGetReadlistById.get(id) as any;
  if (!existing || existing.user_id !== userId) return null;

  const now = new Date().toISOString();
  stmtUpdateReadlist.run({
    id,
    userId,
    name: updates.name !== undefined ? updates.name : existing.name,
    description: updates.description !== undefined ? updates.description : existing.description,
    coverImage: updates.coverImage !== undefined ? updates.coverImage : existing.cover_image,
    updatedAt: now,
  });

  return getReadlistById(id, userId);
}

export function deleteReadlist(id: string, userId: string): boolean {
  const tx = db.transaction(() => {
    stmtDeleteReadlistItems.run(id);
    stmtDeleteReadlist.run(id, userId);
  });
  tx();
  return true;
}

export function addReadlistItem(item: {
  id: string;
  readlistId: string;
  mangaId: string;
  chapterNumber: number;
  chapterTitle?: string;
  sortOrder?: number;
  notes?: string;
}): any {
  const sortOrder = item.sortOrder !== undefined ? item.sortOrder : 0;
  stmtInsertReadlistItem.run({
    id: item.id,
    readlistId: item.readlistId,
    mangaId: item.mangaId,
    chapterNumber: item.chapterNumber,
    chapterTitle: item.chapterTitle || null,
    sortOrder,
    notes: item.notes || null,
  });
  return { ...item, sortOrder };
}

export function removeReadlistItem(id: string, readlistId: string): boolean {
  stmtDeleteReadlistItemById.run(id, readlistId);
  return true;
}

export function setReadlistItems(readlistId: string, items: any[]): void {
  const tx = db.transaction(() => {
    stmtDeleteReadlistItems.run(readlistId);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      stmtInsertReadlistItem.run({
        id: it.id || `rli_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        readlistId,
        mangaId: it.mangaId,
        chapterNumber: Number(it.chapterNumber) || 1,
        chapterTitle: it.chapterTitle || null,
        sortOrder: it.sortOrder !== undefined ? it.sortOrder : i,
        notes: it.notes || null,
      });
    }
  });
  tx();
}
