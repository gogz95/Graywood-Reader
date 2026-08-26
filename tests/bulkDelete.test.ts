import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../server';
import { SqliteDb } from '../sqlite-db';
import { signAuthToken } from '../server/security';
import { MangaItem } from '../src/types';

describe('Bulk Manga Deletion & Rate Limit Exemption', () => {
  const adminToken = signAuthToken({ sub: 'usr_admin', role: 'admin' });

  beforeEach(() => {
    // Seed test manga
    const items: MangaItem[] = [
      {
        id: 'bulk_del_1',
        title: 'Bulk Delete Target 1',
        altTitles: [],
        type: 'manhwa',
        coverImage: 'https://example.com/c1.jpg',
        description: 'Desc',
        genres: ['Action'],
        status: 'reading',
        currentChapter: 1,
        totalChapters: 10,
        latestChapter: 10,
        lastUpdated: new Date().toISOString(),
        addedAt: new Date().toISOString(),
        lastReadAt: new Date().toISOString(),
        rating: 8.0,
        sourceUrl: 'https://example.com/b1',
        sourceName: 'MangaDex',
        autoUpdateEnabled: false,
        notes: '',
        userId: 'usr_admin',
        isFavorite: true,
        isNsfw: false,
      },
      {
        id: 'bulk_del_2',
        title: 'Bulk Delete Target 2',
        altTitles: [],
        type: 'manhwa',
        coverImage: 'https://example.com/c2.jpg',
        description: 'Desc',
        genres: ['Action'],
        status: 'reading',
        currentChapter: 1,
        totalChapters: 10,
        latestChapter: 10,
        lastUpdated: new Date().toISOString(),
        addedAt: new Date().toISOString(),
        lastReadAt: new Date().toISOString(),
        rating: 8.0,
        sourceUrl: 'https://example.com/b2',
        sourceName: 'MangaDex',
        autoUpdateEnabled: false,
        notes: '',
        userId: 'usr_admin',
        isFavorite: true,
        isNsfw: false,
      },
    ];
    SqliteDb.bulkUpsertManga(items);
  });

  it('deletes multiple manga atomically via POST /api/manga/bulk-delete', async () => {
    expect(SqliteDb.getMangaById('bulk_del_1')).not.toBeNull();
    expect(SqliteDb.getMangaById('bulk_del_2')).not.toBeNull();

    const res = await request(app)
      .post('/api/manga/bulk-delete')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ids: ['bulk_del_1', 'bulk_del_2'] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.deletedCount).toBe(2);

    expect(SqliteDb.getMangaById('bulk_del_1')).toBeNull();
    expect(SqliteDb.getMangaById('bulk_del_2')).toBeNull();
  });

  it('allows standard authenticated users to delete series seeded with usr_admin', async () => {
    const userToken = signAuthToken({ sub: 'usr_normal_reader', role: 'user' });

    expect(SqliteDb.getMangaById('bulk_del_1')).not.toBeNull();

    const res = await request(app)
      .delete('/api/manga/bulk_del_1')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(SqliteDb.getMangaById('bulk_del_1')).toBeNull();
  });
});
