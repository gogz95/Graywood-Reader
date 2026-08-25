import { db } from './connection';
import { UserCategory } from '../src/types';

const stmtGetCategoriesForUser = db.prepare('SELECT * FROM categories WHERE user_id = ? ORDER BY sort_order ASC, name ASC');
const stmtGetCategoryCountsForUser = db.prepare(`
  SELECT mc.category_id, COUNT(DISTINCT mc.manga_id) as series_count
  FROM manga_categories mc
  WHERE mc.user_id = ?
  GROUP BY mc.category_id
`);
const stmtGetCategoryByIdAndUser = db.prepare('SELECT * FROM categories WHERE id = ? AND user_id = ?');
const stmtInsertCategory = db.prepare(`
  INSERT INTO categories (id, user_id, name, description, color, icon, sort_order, created_at, is_dynamic, rule_type, rule_value)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const stmtUpdateCategory = db.prepare(`
  UPDATE categories SET name = ?, description = ?, color = ?, icon = ?, sort_order = ?, is_dynamic = ?, rule_type = ?, rule_value = ?
  WHERE id = ? AND user_id = ?
`);
const stmtDeleteCategoryMangaLinks = db.prepare('DELETE FROM manga_categories WHERE category_id = ? AND user_id = ?');
const stmtDeleteCategory = db.prepare('DELETE FROM categories WHERE id = ? AND user_id = ?');
const stmtDeleteCategoryMangaLinksAdmin = db.prepare('DELETE FROM manga_categories WHERE category_id = ?');
const stmtDeleteCategoryAdmin = db.prepare('DELETE FROM categories WHERE id = ?');
const stmtGetMangaCategories = db.prepare('SELECT category_id FROM manga_categories WHERE manga_id = ? AND user_id = ?');
const stmtInsertMangaCategory = db.prepare('INSERT OR IGNORE INTO manga_categories (manga_id, category_id, user_id) VALUES (?, ?, ?)');
const stmtDeleteMangaCategoryOne = db.prepare('DELETE FROM manga_categories WHERE manga_id = ? AND category_id = ? AND user_id = ?');
const stmtDeleteMangaCategoriesForManga = db.prepare('DELETE FROM manga_categories WHERE manga_id = ? AND user_id = ?');

export function getCategories(userId: string): UserCategory[] {
  const rows = stmtGetCategoriesForUser.all(userId) as any[];
  const countRows = stmtGetCategoryCountsForUser.all(userId) as any[];
  const countMap = new Map<string, number>();
  for (const cr of countRows) countMap.set(cr.category_id, cr.series_count);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description || undefined,
    color: r.color || undefined,
    icon: r.icon || undefined,
    sortOrder: Number(r.sort_order) || 0,
    userId: r.user_id,
    createdAt: r.created_at,
    seriesCount: countMap.get(r.id) || 0,
    isDynamic: Boolean(r.is_dynamic),
    ruleType: r.rule_type || undefined,
    ruleValue: r.rule_value || undefined,
  }));
}

export function createCategory(category: UserCategory): UserCategory {
  stmtInsertCategory.run(
    category.id,
    category.userId || 'usr_admin',
    category.name,
    category.description || null,
    category.color || '#f59e0b',
    category.icon || 'Bookmark',
    category.sortOrder || 0,
    category.createdAt || new Date().toISOString(),
    category.isDynamic ? 1 : 0,
    category.ruleType || null,
    category.ruleValue ? String(category.ruleValue) : null
  );
  return category;
}

export function updateCategory(id: string, updates: Partial<UserCategory>, userId: string): UserCategory | null {
  const existing = stmtGetCategoryByIdAndUser.get(id, userId) as any;
  if (!existing) return null;
  const name = updates.name !== undefined ? updates.name : existing.name;
  const description = updates.description !== undefined ? updates.description : existing.description;
  const color = updates.color !== undefined ? updates.color : existing.color;
  const icon = updates.icon !== undefined ? updates.icon : existing.icon;
  const sortOrder = updates.sortOrder !== undefined ? updates.sortOrder : existing.sort_order;
  const isDynamic = updates.isDynamic !== undefined ? (updates.isDynamic ? 1 : 0) : existing.is_dynamic;
  const ruleType = updates.ruleType !== undefined ? updates.ruleType : existing.rule_type;
  const ruleValue = updates.ruleValue !== undefined ? String(updates.ruleValue) : existing.rule_value;

  stmtUpdateCategory.run(name, description, color, icon, sortOrder, isDynamic, ruleType, ruleValue, id, userId);

  return {
    id,
    name,
    description,
    color,
    icon,
    sortOrder,
    userId,
    createdAt: existing.created_at,
    isDynamic: Boolean(isDynamic),
    ruleType,
    ruleValue,
  };
}

export function deleteCategory(id: string, userId?: string): boolean {
  const tx = db.transaction(() => {
    if (!userId || userId === 'usr_admin') {
      stmtDeleteCategoryMangaLinksAdmin.run(id);
      stmtDeleteCategoryAdmin.run(id);
    } else {
      stmtDeleteCategoryMangaLinks.run(id, userId);
      stmtDeleteCategory.run(id, userId);
    }
  });
  tx();
  return true;
}

export function getMangaCategories(mangaId: string, userId: string): string[] {
  const rows = stmtGetMangaCategories.all(mangaId, userId) as { category_id: string }[];
  return rows.map((r) => r.category_id);
}

export function setMangaCategories(mangaId: string, categoryIds: string[], userId: string): void {
  const tx = db.transaction(() => {
    stmtDeleteMangaCategoriesForManga.run(mangaId, userId);
    for (const catId of categoryIds) {
      if (catId && catId.trim()) stmtInsertMangaCategory.run(mangaId, catId.trim(), userId);
    }
  });
  tx();
}

export function bulkAssignCategory(mangaIds: string[], categoryId: string, action: 'add' | 'remove' | 'set', userId: string): void {
  const tx = db.transaction(() => {
    for (const mangaId of mangaIds) {
      if (action === 'add') {
        stmtInsertMangaCategory.run(mangaId, categoryId, userId);
      } else if (action === 'remove') {
        stmtDeleteMangaCategoryOne.run(mangaId, categoryId, userId);
      } else if (action === 'set') {
        stmtDeleteMangaCategoriesForManga.run(mangaId, userId);
        stmtInsertMangaCategory.run(mangaId, categoryId, userId);
      }
    }
  });
  tx();
}

export function bulkApplyUserImportState(
  userId: string,
  items: Array<{
    id: string;
    isFavorite?: boolean;
    currentChapter?: number;
    status?: string;
    categoryIds?: string[];
  }>
) {
  const stmtFav = db.prepare('INSERT OR REPLACE INTO user_favorites (user_id, manga_id, is_favorite, updated_at) VALUES (?, ?, ?, ?)');
  const stmtState = db.prepare(`
    INSERT INTO user_library_state (user_id, manga_id, current_chapter, last_read_at, status)
    VALUES (:user_id, :manga_id, :current_chapter, :last_read_at, :status)
    ON CONFLICT(user_id, manga_id) DO UPDATE SET
      current_chapter = CASE WHEN excluded.current_chapter > user_library_state.current_chapter THEN excluded.current_chapter ELSE user_library_state.current_chapter END,
      last_read_at = excluded.last_read_at,
      status = COALESCE(excluded.status, user_library_state.status)
  `);
  const stmtDelCats = db.prepare('DELETE FROM manga_categories WHERE manga_id = ? AND user_id = ?');
  const stmtInsCat = db.prepare('INSERT OR IGNORE INTO manga_categories (manga_id, category_id, user_id) VALUES (?, ?, ?)');

  const now = new Date().toISOString();
  const run = db.transaction((list: typeof items) => {
    for (const item of list) {
      if (item.isFavorite) {
        stmtFav.run(userId, item.id, 1, now);
      }
      if (item.currentChapter !== undefined || item.status !== undefined) {
        stmtState.run({
          user_id: userId,
          manga_id: item.id,
          current_chapter: Math.max(0, item.currentChapter || 0),
          last_read_at: now,
          status: item.status || null,
        });
      }
      if (Array.isArray(item.categoryIds) && item.categoryIds.length > 0) {
        stmtDelCats.run(item.id, userId);
        for (const catId of item.categoryIds) {
          stmtInsCat.run(item.id, catId, userId);
        }
      }
    }
  });

  run(items);
}
