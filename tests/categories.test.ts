import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../server';
import { SqliteDb } from '../sqlite-db';

describe('User-Defined Categories & Custom Shelves', () => {
  const testUserId = 'usr_cat_tester';

  it('creates, lists, updates, and deletes categories in SQLite', () => {
    const catId = `cat_test_${Date.now()}`;
    const newCat = SqliteDb.createCategory({
      id: catId,
      name: 'Weekend Binge',
      description: 'Series to binge over the weekend',
      color: '#a855f7',
      icon: 'Flame',
      sortOrder: 1,
      userId: testUserId,
    });

    expect(newCat.id).toBe(catId);
    expect(newCat.name).toBe('Weekend Binge');

    // List categories
    const list = SqliteDb.getCategories(testUserId);
    expect(list.some((c) => c.id === catId && c.name === 'Weekend Binge')).toBe(true);

    // Update category
    const updated = SqliteDb.updateCategory(catId, { name: 'Weekend Binge & Action', color: '#ec4899' }, testUserId);
    expect(updated?.name).toBe('Weekend Binge & Action');
    expect(updated?.color).toBe('#ec4899');

    // Assign to manga
    const mangaId = 'm_test_series_123';
    SqliteDb.setMangaCategories(mangaId, [catId], testUserId);
    const assigned = SqliteDb.getMangaCategories(mangaId, testUserId);
    expect(assigned).toEqual([catId]);

    // Bulk assign
    SqliteDb.bulkAssignCategory(['m_test_2', 'm_test_3'], catId, 'add', testUserId);
    expect(SqliteDb.getMangaCategories('m_test_2', testUserId)).toContain(catId);

    // Delete category
    const deleted = SqliteDb.deleteCategory(catId, testUserId);
    expect(deleted).toBe(true);
    const afterDelete = SqliteDb.getCategories(testUserId);
    expect(afterDelete.some((c) => c.id === catId)).toBe(false);
  });

  it('HTTP API: handles category CRUD and assignment endpoints', async () => {
    // 1. Create category via API
    const createRes = await request(app)
      .post('/api/categories')
      .send({
        name: 'Masterpieces',
        description: '10/10 Peak Fiction',
        color: '#f59e0b',
        icon: 'Trophy',
        sortOrder: 0,
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body).toHaveProperty('id');
    expect(createRes.body.name).toBe('Masterpieces');
    const createdId = createRes.body.id;

    // 2. Get categories via API
    const getRes = await request(app).get('/api/categories');
    expect(getRes.status).toBe(200);
    expect(Array.isArray(getRes.body)).toBe(true);
    expect(getRes.body.some((c: any) => c.id === createdId)).toBe(true);

    // 3. Update category via API
    const updateRes = await request(app)
      .put(`/api/categories/${createdId}`)
      .send({
        name: 'Hall of Fame',
        color: '#10b981',
      });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.name).toBe('Hall of Fame');
    expect(updateRes.body.color).toBe('#10b981');

    // 4. Assign to a manga
    const assignRes = await request(app)
      .post('/api/categories/assign')
      .send({
        mangaId: 'm_test_sample',
        categoryIds: [createdId],
      });
    expect(assignRes.status).toBe(200);
    expect(assignRes.body.categories).toContain(createdId);

    // 5. Bulk assign via API
    const bulkRes = await request(app)
      .post('/api/categories/bulk-assign')
      .send({
        mangaIds: ['m_series_a', 'm_series_b'],
        categoryId: createdId,
        action: 'add',
      });
    expect(bulkRes.status).toBe(200);
    expect(bulkRes.body.count).toBe(2);

    // 6. Delete category via API
    const deleteRes = await request(app).delete(`/api/categories/${createdId}`);
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.success).toBe(true);
  });
});
