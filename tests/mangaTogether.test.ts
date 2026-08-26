import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../server';

describe('Real-Time Co-Reading & Manga Together Rooms', () => {
  let createdRoomId = '';

  it('creates a new reading room via POST /api/rooms', async () => {
    const res = await request(app)
      .post('/api/rooms')
      .send({
        mangaId: 'manga_solo_leveling',
        mangaTitle: 'Solo Leveling',
        chapterNumber: 42,
        hostName: 'TestHost',
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toHaveLength(6);
    expect(res.body.hostName).toBe('TestHost');
    expect(res.body.chapterNumber).toBe(42);
    createdRoomId = res.body.id;
  });

  it('lists active rooms via GET /api/rooms', async () => {
    const res = await request(app).get('/api/rooms');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const found = res.body.find((r: any) => r.id === createdRoomId);
    expect(found).toBeDefined();
    expect(found.mangaTitle).toBe('Solo Leveling');
  });

  it('retrieves room state via GET /api/rooms/:id', async () => {
    const res = await request(app).get(`/api/rooms/${createdRoomId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(createdRoomId);
    expect(res.body.chapterNumber).toBe(42);
    expect(res.body.participants).toBeInstanceOf(Array);
  });

  it('allows a participant to join via POST /api/rooms/:id/join', async () => {
    const res = await request(app)
      .post(`/api/rooms/${createdRoomId}/join`)
      .send({
        userName: 'CoReader1',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.room.participants.length).toBeGreaterThanOrEqual(2);
  });

  it('broadcasts synchronized navigation via POST /api/rooms/:id/sync', async () => {
    const res = await request(app)
      .post(`/api/rooms/${createdRoomId}/sync`)
      .send({
        action: 'scroll',
        chapterNumber: 43,
        pageIndex: 5,
        scrollPercent: 65,
        userId: 'usr_test_host',
        userName: 'TestHost',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const roomRes = await request(app).get(`/api/rooms/${createdRoomId}`);
    expect(roomRes.body.chapterNumber).toBe(43);
    expect(roomRes.body.pageIndex).toBe(5);
    expect(roomRes.body.scrollPercent).toBe(65);
  });

  it('returns 404 for nonexistent room code', async () => {
    const res = await request(app).get('/api/rooms/NONEXIST');
    expect(res.status).toBe(404);
  });
});
