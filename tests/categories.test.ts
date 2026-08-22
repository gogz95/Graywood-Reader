import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../server';
import { SqliteDb } from '../sqlite-db';
import { signAuthToken } from '../server/security';

describe('User-Defined Categories & Custom Shelves', () => {
  const testUserId = 'usr_cat_tester';
  const createdTestCatIds: string[] = [];

  afterEach(() => {
    // Clean up any test categories
    for (const catId of createdTestCatIds) {
      try {
        SqliteDb.deleteCategory(catId, testUserId);
        SqliteDb.deleteCategory(catId, 'usr_admin');
        SqliteDb.deleteCategory(catId, 'usr_user_a');
        SqliteDb.deleteCategory(catId, 'usr_user_b');
      } catch (_) {}
    }
    createdTestCatIds.length = 0;
  });

  it('creates, lists, updates, and deletes categories in SQLite', () => {
    const catId = `cat_test_${Date.now()}`;
    createdTestCatIds.push(catId);
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
    createdTestCatIds.push(createdId);

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

  it('guarantees complete shelf isolation between different users', async () => {
    const userA = { id: 'usr_user_a', username: 'user_a', role: 'user' as const };
    const userB = { id: 'usr_user_b', username: 'user_b', role: 'user' as const };
    const tokenA = signAuthToken({ sub: userA.id, ...userA });
    const tokenB = signAuthToken({ sub: userB.id, ...userB });

    // 1. User A creates a private shelf "User A Favorites"
    const createResA = await request(app)
      .post('/api/categories')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        name: 'User A Favorites',
        description: 'Private shelf for User A',
        color: '#f43f5e',
      });
    expect(createResA.status).toBe(201);
    const catIdA = createResA.body.id;
    createdTestCatIds.push(catIdA);

    // 2. User A assigns manga m_isolation_test to catIdA
    const mangaTestId = 'm_isolation_test_series';
    const assignResA = await request(app)
      .post('/api/categories/assign')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        mangaId: mangaTestId,
        categoryIds: [catIdA],
      });
    expect(assignResA.status).toBe(200);
    expect(assignResA.body.categories).toEqual([catIdA]);

    // 3. User B fetches their categories -> must NOT contain User A's shelf
    const getResB = await request(app)
      .get('/api/categories')
      .set('Authorization', `Bearer ${tokenB}`);
    expect(getResB.status).toBe(200);
    expect(getResB.body.some((c: any) => c.id === catIdA || c.name === 'User A Favorites')).toBe(false);

    // 4. User B gets manga overlay -> mangaTestId must NOT have catIdA in categories for User B
    const mangaItem = {
      id: mangaTestId,
      title: 'Isolation Manga',
      categories: [catIdA], // Even if global object had categories
    } as any;
    const overlayB = SqliteDb.applyUserOverlay([mangaItem], userB.id);
    expect(overlayB[0].categories).toEqual([]);

    // 5. User B tries to update User A's category -> rejected 404
    const updateResB = await request(app)
      .put(`/api/categories/${catIdA}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ name: 'Hacked by User B' });
    expect(updateResB.status).toBe(404);

    // 6. User B tries to delete User A's category -> User A's category still exists
    await request(app)
      .delete(`/api/categories/${catIdA}`)
      .set('Authorization', `Bearer ${tokenB}`);
    const checkCatsA = SqliteDb.getCategories(userA.id);
    expect(checkCatsA.some((c) => c.id === catIdA)).toBe(true);

    // Clean up
    SqliteDb.deleteCategory(catIdA, userA.id);
  });

  it('guarantees complete isolation across four distinct users with zero mirroring or striping', async () => {
    const user1 = { id: 'usr_iso_user1', username: 'iso_user1', role: 'user' as const };
    const user2 = { id: 'usr_iso_user2', username: 'iso_user2', role: 'user' as const };
    const user3 = { id: 'usr_iso_admin', username: 'iso_admin', role: 'admin' as const };
    const user4 = { id: 'usr_iso_guest', username: 'iso_guest', role: 'user' as const };

    const token1 = signAuthToken({ sub: user1.id, ...user1 });
    const token2 = signAuthToken({ sub: user2.id, ...user2 });
    const token3 = signAuthToken({ sub: user3.id, ...user3 });
    const token4 = signAuthToken({ sub: user4.id, ...user4 });

    // 1. Initially all 4 users have 0 categories
    for (const token of [token1, token2, token3, token4]) {
      const res = await request(app).get('/api/categories').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    }

    // 2. Each user creates their own distinct shelf
    const res1 = await request(app).post('/api/categories').set('Authorization', `Bearer ${token1}`).send({ name: 'User 1 Shelf' });
    const res2 = await request(app).post('/api/categories').set('Authorization', `Bearer ${token2}`).send({ name: 'User 2 Shelf' });
    const res3 = await request(app).post('/api/categories').set('Authorization', `Bearer ${token3}`).send({ name: 'Admin Shelf' });
    const res4 = await request(app).post('/api/categories').set('Authorization', `Bearer ${token4}`).send({ name: 'Guest Shelf' });

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);
    expect(res3.status).toBe(201);
    expect(res4.status).toBe(201);

    const id1 = res1.body.id;
    const id2 = res2.body.id;
    const id3 = res3.body.id;
    const id4 = res4.body.id;

    // 3. User 1 assigns manga M1 to Shelf 1
    await request(app).post('/api/categories/assign').set('Authorization', `Bearer ${token1}`).send({ mangaId: 'm_shared_1', categoryIds: [id1] });
    // User 2 assigns manga M1 to Shelf 2
    await request(app).post('/api/categories/assign').set('Authorization', `Bearer ${token2}`).send({ mangaId: 'm_shared_1', categoryIds: [id2] });
    // User 3 assigns manga M2 to Shelf 3
    await request(app).post('/api/categories/assign').set('Authorization', `Bearer ${token3}`).send({ mangaId: 'm_shared_2', categoryIds: [id3] });
    // User 4 assigns manga M3 to Shelf 4
    await request(app).post('/api/categories/assign').set('Authorization', `Bearer ${token4}`).send({ mangaId: 'm_shared_3', categoryIds: [id4] });

    // 4. Verify each user's /api/categories returns ONLY their own category
    const list1 = await request(app).get('/api/categories').set('Authorization', `Bearer ${token1}`);
    const list2 = await request(app).get('/api/categories').set('Authorization', `Bearer ${token2}`);
    const list3 = await request(app).get('/api/categories').set('Authorization', `Bearer ${token3}`);
    const list4 = await request(app).get('/api/categories').set('Authorization', `Bearer ${token4}`);

    expect(list1.body.map((c: any) => c.name)).toEqual(['User 1 Shelf']);
    expect(list2.body.map((c: any) => c.name)).toEqual(['User 2 Shelf']);
    expect(list3.body.map((c: any) => c.name)).toEqual(['Admin Shelf']);
    expect(list4.body.map((c: any) => c.name)).toEqual(['Guest Shelf']);

    // 5. Verify overlay on manga items is strictly isolated per user
    const sampleItems = [
      { id: 'm_shared_1', title: 'Shared 1', categories: [] },
      { id: 'm_shared_2', title: 'Shared 2', categories: [] },
      { id: 'm_shared_3', title: 'Shared 3', categories: [] },
    ] as any[];

    const ov1 = SqliteDb.applyUserOverlay(sampleItems, user1.id);
    const ov2 = SqliteDb.applyUserOverlay(sampleItems, user2.id);
    const ov3 = SqliteDb.applyUserOverlay(sampleItems, user3.id);
    const ov4 = SqliteDb.applyUserOverlay(sampleItems, user4.id);

    expect(ov1.find((m) => m.id === 'm_shared_1')?.categories).toEqual([id1]);
    expect(ov1.find((m) => m.id === 'm_shared_2')?.categories).toEqual([]);
    expect(ov1.find((m) => m.id === 'm_shared_3')?.categories).toEqual([]);

    expect(ov2.find((m) => m.id === 'm_shared_1')?.categories).toEqual([id2]);
    expect(ov2.find((m) => m.id === 'm_shared_2')?.categories).toEqual([]);
    expect(ov2.find((m) => m.id === 'm_shared_3')?.categories).toEqual([]);

    expect(ov3.find((m) => m.id === 'm_shared_1')?.categories).toEqual([]);
    expect(ov3.find((m) => m.id === 'm_shared_2')?.categories).toEqual([id3]);
    expect(ov3.find((m) => m.id === 'm_shared_3')?.categories).toEqual([]);

    expect(ov4.find((m) => m.id === 'm_shared_1')?.categories).toEqual([]);
    expect(ov4.find((m) => m.id === 'm_shared_2')?.categories).toEqual([]);
    expect(ov4.find((m) => m.id === 'm_shared_3')?.categories).toEqual([id4]);

    // Clean up
    SqliteDb.deleteCategory(id1, user1.id);
    SqliteDb.deleteCategory(id2, user2.id);
    SqliteDb.deleteCategory(id3, user3.id);
    SqliteDb.deleteCategory(id4, user4.id);
  });

  it('restores and auto-creates categories for importing user only on bulk import', async () => {
    const backupCategoryName = `Imported Test Shelf ${Date.now()}`;
    const testSeriesId = `kotatsu_backup_cat_${Date.now()}`;
    const backupItems = [
      {
        id: testSeriesId,
        title: 'Overgeared',
        sourceName: 'Asura Scans',
        sourceUrl: 'https://asurascans.com/comics/overgeared',
        isFavorite: true,
        categories: [backupCategoryName],
      },
    ];

    const importRes = await request(app)
      .post('/api/manga/bulk-import')
      .send(backupItems);

    expect(importRes.status).toBe(201);
    expect(importRes.body.count).toBe(1);

    // Verify category was created for admin/host
    const getCatsRes = await request(app).get('/api/categories');
    expect(getCatsRes.status).toBe(200);
    const foundCat = getCatsRes.body.find((c: any) => c.name === backupCategoryName);
    expect(foundCat).toBeDefined();
    if (foundCat) createdTestCatIds.push(foundCat.id);

    // Verify manga is linked to this category for admin
    const mangaCategories = SqliteDb.getMangaCategories(backupItems[0].id, 'usr_admin');
    expect(mangaCategories).toContain(foundCat?.id);

    // Verify other users do NOT have this category automatically injected
    const otherUserCats = SqliteDb.getCategories('usr_other_random_user');
    expect(otherUserCats.some((c) => c.name === backupCategoryName)).toBe(false);

    // Clean up
    if (foundCat) SqliteDb.deleteCategory(foundCat.id, 'usr_admin');
    SqliteDb.deleteManga(testSeriesId);
  });

  it('restores user reading progress on backup bulk import', async () => {
    const progressMangaId = `tachi_prog_${Date.now()}`;
    const backupItems = [
      {
        id: progressMangaId,
        title: 'Solo Leveling',
        sourceName: 'Asura Scans',
        sourceUrl: 'https://asurascans.com/comics/solo-leveling',
        currentChapter: 142,
        totalChapters: 200,
        status: 'reading',
        isFavorite: true,
      },
    ];

    const importRes = await request(app)
      .post('/api/manga/bulk-import')
      .send(backupItems);

    expect(importRes.status).toBe(201);

    // Verify progress is persisted in user library state
    const stateMap = SqliteDb.getUserLibraryStateMap('usr_admin');
    const itemState = stateMap.get(progressMangaId);
    expect(itemState).toBeDefined();
    expect(itemState?.currentChapter).toBe(142);
    expect(itemState?.status).toBe('reading');

    // Clean up
    SqliteDb.deleteManga(progressMangaId);
  });

  it('correctly detects 18+ / NSFW manga for library toggle', async () => {
    const { isNsfwManga } = await import('../src/types');

    expect(isNsfwManga({ genres: ['Action', 'Fantasy'] })).toBe(false);
    expect(isNsfwManga({ isNsfw: true, genres: ['Action'] })).toBe(true);
    expect(isNsfwManga({ genres: ['Action', '18+', 'Drama'] })).toBe(true);
    expect(isNsfwManga({ genres: ['Smut', 'Romance'] })).toBe(true);
    expect(isNsfwManga({ genres: ['Adult', 'Psychological'] })).toBe(true);
    expect(isNsfwManga({ genres: ['Erotica'] })).toBe(true);
    expect(isNsfwManga({ genres: ['Hentai'] })).toBe(true);
    expect(isNsfwManga({ title: 'Secret Class [18+]' })).toBe(true);
    expect(isNsfwManga({ title: 'Regular Title', notes: 'Imported uncensored [nsfw]' })).toBe(true);
  });

  it('persists isNsfw flag and protects it via metadataOverrides across DB and refresh cycles', async () => {
    const { SqliteDb } = await import('../sqlite-db');
    const { snapshotMetadataOverrides, restoreMetadataOverrides } = await import('../src/utils/metadataHelpers');
    const { isNsfwManga } = await import('../src/types');

    const testMangaId = `m_nsfw_test_${Date.now()}`;
    const initialItem = {
      id: testMangaId,
      title: 'Action Fantasy Non-Explicit',
      altTitles: ['AFNE'],
      type: 'manhwa' as const,
      coverImage: 'https://example.com/cover.jpg',
      description: 'A clean action manhwa.',
      genres: ['Action', 'Fantasy'],
      status: 'reading' as const,
      currentChapter: 10,
      totalChapters: 50,
      latestChapter: 50,
      lastUpdated: new Date().toISOString(),
      rating: 9.0,
      sourceUrl: 'https://asurascans.com/manga/afne',
      sourceName: 'Asura Scans',
      autoUpdateEnabled: true,
      notes: '',
      addedAt: new Date().toISOString(),
      lastReadAt: new Date().toISOString(),
      isNsfw: false,
      metadataOverrides: [],
    };

    SqliteDb.upsertManga(initialItem);
    const saved = SqliteDb.getMangaById(testMangaId);
    expect(saved).toBeDefined();
    expect(saved?.isNsfw).toBe(false);
    expect(isNsfwManga(saved!)).toBe(false);

    // User edits series to mark as 18+ and locks isNsfw in metadataOverrides
    const userEdited = {
      ...saved!,
      isNsfw: true,
      genres: ['Action', 'Fantasy', '18+'],
      metadataOverrides: ['isNsfw', 'genres'],
    };
    SqliteDb.upsertManga(userEdited);

    const reloaded = SqliteDb.getMangaById(testMangaId);
    expect(reloaded).toBeDefined();
    expect(reloaded?.isNsfw).toBe(true);
    expect(isNsfwManga(reloaded!)).toBe(true);
    expect(reloaded?.metadataOverrides).toContain('isNsfw');

    // Simulate remote metadata refresh: snapshot user overrides, apply remote update without 18+, restore overrides
    const snap = snapshotMetadataOverrides(reloaded!);
    expect(snap.isNsfw).toBe(true);
    expect(snap.genres).toContain('18+');

    // Remote source tries to overwrite with clean metadata
    const remoteData = {
      ...reloaded!,
      isNsfw: false,
      genres: ['Action', 'Fantasy', 'Adventure'],
    };
    restoreMetadataOverrides(remoteData, snap);

    expect(remoteData.isNsfw).toBe(true);
    expect(remoteData.genres).toContain('18+');

    // Clean up
    SqliteDb.deleteManga(testMangaId);
  });

  it('preserves user shelf categories when POST /api/manga/:id/refresh-metadata is called (BUG-039)', async () => {
    const user = { id: 'usr_shelf_refresh_test', username: 'shelf_refresher', role: 'user' as const };
    const token = signAuthToken({ sub: user.id, ...user });
    const mangaId = 'm_shelf_refresh_check';

    // 1. Create a custom shelf category
    const catRes = await request(app)
      .post('/api/categories')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Reading Shelf', color: '#10b981', icon: 'Bookmark' });
    expect(catRes.status).toBe(201);
    const catId = catRes.body.id;

    // 2. Add series to database
    SqliteDb.upsertManga({
      id: mangaId,
      title: 'Shelf Preservation Test',
      altTitles: [],
      type: 'manhwa',
      coverImage: 'https://example.com/cover.jpg',
      description: 'Testing shelf preservation across refreshes.',
      genres: ['Action'],
      status: 'reading',
      currentChapter: 5,
      totalChapters: 10,
      latestChapter: 10,
      rating: 8.5,
      sourceUrl: 'https://example.com/manga/shelf-preservation-test',
      sourceName: 'Custom Scraper',
      autoUpdateEnabled: true,
      notes: '',
      addedAt: new Date().toISOString(),
      lastReadAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      metadataOverrides: [],
      isFavorite: false,
      isNsfw: false,
    });

    // 3. Assign the manga to the shelf
    const assignRes = await request(app)
      .post('/api/categories/assign')
      .set('Authorization', `Bearer ${token}`)
      .send({ mangaId, categoryIds: [catId] });
    expect(assignRes.status).toBe(200);
    expect(assignRes.body.categories).toEqual([catId]);

    // 4. Trigger metadata refresh endpoint
    const refreshRes = await request(app)
      .post(`/api/manga/${mangaId}/refresh-metadata`)
      .set('Authorization', `Bearer ${token}`);
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.success).toBe(true);
    expect(refreshRes.body.manga.categories).toBeDefined();
    expect(refreshRes.body.manga.categories).toContain(catId);

    // 5. Fetch library / single item endpoint -> verify categories array is intact
    const getRes = await request(app)
      .get(`/api/manga/${mangaId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.categories).toContain(catId);

    // Clean up
    SqliteDb.deleteCategory(catId, user.id);
    SqliteDb.deleteManga(mangaId);
  });
});
