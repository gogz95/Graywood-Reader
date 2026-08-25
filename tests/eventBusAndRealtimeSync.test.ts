import { describe, it, expect, vi } from 'vitest';
import http from 'http';
import express from 'express';
import { eventBus } from '../server/services/eventBus';
import { eventsRouter } from '../server/routes/events';

describe('EventBus & Real-Time Sync Engine', () => {
  it('allows subscribing to specific event types and general events', () => {
    const generalHandler = vi.fn();
    const specificHandler = vi.fn();

    const unsubGeneral = eventBus.subscribe(generalHandler);
    const unsubSpecific = eventBus.subscribeType('chapter_read', specificHandler);

    eventBus.publish('chapter_read', { mangaId: 'manga_123', chapterNumber: 5 }, 'usr_test');

    expect(generalHandler).toHaveBeenCalledTimes(1);
    expect(generalHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'chapter_read',
        userId: 'usr_test',
        data: { mangaId: 'manga_123', chapterNumber: 5 },
      })
    );

    expect(specificHandler).toHaveBeenCalledTimes(1);
    expect(specificHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'chapter_read',
        data: { mangaId: 'manga_123', chapterNumber: 5 },
      })
    );

    unsubGeneral();
    unsubSpecific();

    // After unsubscription, should not receive further events
    eventBus.publish('chapter_read', { mangaId: 'manga_123', chapterNumber: 6 });
    expect(generalHandler).toHaveBeenCalledTimes(1);
    expect(specificHandler).toHaveBeenCalledTimes(1);
  });

  it('serves an SSE stream endpoint at /api/events with text/event-stream headers', async () => {
    const app = express();
    app.use('/api/events', eventsRouter);

    const server = app.listen(0);
    const port = (server.address() as any).port;

    try {
      const result = await new Promise<{ status: number; contentType: string; body: string }>((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${port}/api/events`, (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk.toString();
            // Once initial chunk is received, destroy client request to close stream cleanly
            req.destroy();
            resolve({
              status: res.statusCode || 0,
              contentType: res.headers['content-type'] || '',
              body: data,
            });
          });
          res.on('error', reject);
        });
        req.on('error', (err) => {
          // Ignore ECONNRESET / aborted errors caused by req.destroy()
          if ((err as any).code !== 'ECONNRESET' && (err as any).code !== 'ERR_STREAM_PREMATURE_CLOSE') {
            reject(err);
          }
        });
      });

      expect(result.status).toBe(200);
      expect(result.contentType).toContain('text/event-stream');
      expect(result.body).toContain('"type":"connected"');
    } finally {
      server.close();
    }
  });
});
