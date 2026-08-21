import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { webhooksRouter } from '../server/routes/webhooks';
import { sendDiscordWebhook, sendTelegramWebhook, dispatchNewChapterWebhooks } from '../server/services/webhookNotifier';
import { appSettings } from '../server/appState';
import { MangaItem } from '../src/types';

describe('Webhook Notifier & Push Dispatcher', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('handles invalid Discord webhook URL format gracefully', async () => {
    const result = await sendDiscordWebhook('https://example.com/not-a-discord-webhook', {
      title: 'Solo Leveling',
      chapterNumber: 180,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid Discord webhook URL');
  });

  it('handles invalid Telegram bot token or chat ID gracefully', async () => {
    const result = await sendTelegramWebhook('', '', {
      title: 'Solo Leveling',
      chapterNumber: 180,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Missing Telegram');
  });

  it('skips dispatching if webhooks are disabled in settings', async () => {
    appSettings.discordWebhookEnabled = false;
    appSettings.telegramWebhookEnabled = false;

    const mockManga: MangaItem = {
      id: 'test_manga_1',
      title: 'Solo Leveling: Ragnarok',
      currentChapter: 10,
      latestChapter: 15,
      altTitles: [],
      coverImage: 'https://example.com/cover.jpg',
      description: '',
      genres: ['Action'],
      rating: 9,
      notes: '',
      addedAt: '',
      lastReadAt: '',
      totalChapters: null,
      sourceUrl: '',
      sourceName: 'AsuraScans',
      type: 'manhwa',
      status: 'reading',
      autoUpdateEnabled: true,
      lastUpdated: new Date().toISOString(),
    };

    const results = await dispatchNewChapterWebhooks(mockManga, 16);
    expect(results.discordSent).toBe(false);
    expect(results.telegramSent).toBe(false);
  });

  it('exposes test-discord and test-telegram endpoints', async () => {
    const app = express();
    app.use(express.json());
    app.use(webhooksRouter);

    const discordRes = await request(app)
      .post('/api/webhooks/test-discord')
      .send({ webhookUrl: 'https://example.com/invalid' });

    expect(discordRes.status).toBe(400);
    expect(discordRes.body).toHaveProperty('error');

    const tgRes = await request(app)
      .post('/api/webhooks/test-telegram')
      .send({ botToken: '', chatId: '' });

    expect(tgRes.status).toBe(400);
    expect(tgRes.body).toHaveProperty('error');
  });
});
