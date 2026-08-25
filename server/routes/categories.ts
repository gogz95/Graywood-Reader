import { Router } from 'express';
import { SqliteDb } from '../../sqlite-db';
import { resolveRequestUserId } from '../appState';

export const categoriesRouter = Router();

// GET /api/categories - List user custom categories
categoriesRouter.get('/', (req, res) => {
  const userId = resolveRequestUserId(req);
  if (!userId) {
    return res.json([]);
  }
  const categories = SqliteDb.getCategories(userId);
  res.json(categories);
});

// POST /api/categories - Create a custom category shelf
categoriesRouter.post('/', (req, res) => {
  const userId = resolveRequestUserId(req);
  if (!userId) {
    return res.status(401).json({ error: 'Authentication required to create custom shelves' });
  }
  const { name, description, color, icon, sortOrder, isDynamic, ruleType, ruleValue } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Category name is required' });
  }

  const id = `cat_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const newCat = SqliteDb.createCategory({
    id,
    name: name.trim(),
    description: description ? String(description).trim() : undefined,
    color: color || '#f59e0b',
    icon: icon || 'Bookmark',
    sortOrder: Number(sortOrder) || 0,
    userId,
    createdAt: new Date().toISOString(),
    isDynamic: Boolean(isDynamic),
    ruleType: ruleType || undefined,
    ruleValue: ruleValue || undefined,
  });

  res.status(201).json(newCat);
});

// PUT /api/categories/:id - Update a category shelf
categoriesRouter.put('/:id', (req, res) => {
  const userId = resolveRequestUserId(req);
  if (!userId) {
    return res.status(401).json({ error: 'Authentication required to update custom shelves' });
  }
  const { id } = req.params;
  const updates = req.body || {};

  const updated = SqliteDb.updateCategory(id, updates, userId);
  if (!updated) {
    return res.status(404).json({ error: 'Category not found' });
  }

  res.json(updated);
});

// DELETE /api/categories/:id - Delete a category shelf
categoriesRouter.delete('/:id', (req, res) => {
  const userId = resolveRequestUserId(req) || 'usr_admin';
  const { id } = req.params;

  SqliteDb.deleteCategory(id, userId);
  res.json({ success: true, message: 'Category deleted' });
});

// POST /api/categories/assign - Assign categories to a single manga
categoriesRouter.post('/assign', (req, res) => {
  const userId = resolveRequestUserId(req);
  if (!userId) {
    return res.status(401).json({ error: 'Authentication required to assign shelves' });
  }
  const { mangaId, categoryIds } = req.body || {};
  if (!mangaId || !Array.isArray(categoryIds)) {
    return res.status(400).json({ error: 'mangaId and categoryIds array are required' });
  }

  SqliteDb.setMangaCategories(mangaId, categoryIds, userId);
  const manga = SqliteDb.getMangaById(mangaId);
  const overlaid = manga ? SqliteDb.applyUserOverlay([manga], userId)[0] : null;

  res.json({ success: true, categories: categoryIds, manga: overlaid });
});

// POST /api/categories/bulk-assign - Batch assign / remove / set categories across series
categoriesRouter.post('/bulk-assign', (req, res) => {
  const userId = resolveRequestUserId(req);
  if (!userId) {
    return res.status(401).json({ error: 'Authentication required to bulk assign shelves' });
  }
  const { mangaIds, categoryId, action = 'add' } = req.body || {};
  if (!Array.isArray(mangaIds) || !categoryId) {
    return res.status(400).json({ error: 'mangaIds array and categoryId are required' });
  }

  SqliteDb.bulkAssignCategory(mangaIds, categoryId, action, userId);
  res.json({ success: true, count: mangaIds.length });
});
