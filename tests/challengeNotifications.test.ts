import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../server';
import { challengeManager } from '../server/challengeManager';

describe('Manual Captcha & Challenge Notification Setup', () => {
  beforeEach(() => {
    challengeManager.clear();
  });

  it('records, queries, and dismisses active challenges via challengeManager', () => {
    const notif = challengeManager.recordChallenge({
      sourceId: 'flamecomics',
      sourceName: 'Flame Comics',
      sourceUrl: 'https://flamecomics.xyz',
      challengeType: 'cloudflare_turnstile',
      httpStatus: 403,
      siteKey: '0x4AAAAAAABBBCCC',
    });

    expect(notif.id).toBe('chn_flamecomics');
    expect(notif.challengeType).toBe('cloudflare_turnstile');
    expect(notif.resolved).toBe(false);

    const active = challengeManager.getActiveChallenges();
    expect(active.length).toBe(1);
    expect(active[0].sourceName).toBe('Flame Comics');

    // Dismiss challenge
    const dismissed = challengeManager.dismissChallenge('chn_flamecomics');
    expect(dismissed).toBe(true);
    expect(challengeManager.getActiveChallenges().length).toBe(0);
  });

  it('GET /api/challenges returns active challenges and configuration', async () => {
    challengeManager.recordChallenge({
      sourceId: 'asurascans',
      sourceName: 'Asura Scans',
      sourceUrl: 'https://asuracomic.net',
      challengeType: 'recaptcha',
      httpStatus: 403,
    });

    const res = await request(app).get('/api/challenges');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.challenges[0].sourceId).toBe('asurascans');
    expect(res.body.config).toBeDefined();
  });

  it('POST /api/challenges/config updates notification settings', async () => {
    const res = await request(app)
      .post('/api/challenges/config')
      .send({
        inAppAlerts: true,
        soundAlerts: false,
        discordWebhookUrl: 'https://discord.com/api/webhooks/test/123',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.config.discordWebhookUrl).toBe('https://discord.com/api/webhooks/test/123');
    expect(res.body.config.soundAlerts).toBe(false);
  });

  it('POST /api/challenges/:id/solve-manual resolves challenge with cookies', async () => {
    challengeManager.recordChallenge({
      sourceId: 'reaperscans',
      sourceName: 'Reaper Scans',
      sourceUrl: 'https://reaperscans.com',
      challengeType: 'cloudflare_turnstile',
      httpStatus: 403,
    });

    const res = await request(app)
      .post('/api/challenges/chn_reaperscans/solve-manual')
      .send({
        cookies: 'cf_clearance=testclearance123; __cf_bm=bm456',
        sourceId: 'reaperscans',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(challengeManager.getActiveChallenges().length).toBe(0);
  });

  it('POST /api/challenges/test creates a test challenge notification', async () => {
    const res = await request(app).post('/api/challenges/test');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.notification).toBeDefined();
    expect(challengeManager.getActiveChallenges().length).toBe(1);
  });
});
