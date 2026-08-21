import { describe, it, expect } from 'vitest';
import { detectChallenge } from '../server/captchaSolver';

describe('challenge detection', () => {
  it('detects Cloudflare Turnstile widgets and extracts the sitekey', () => {
    const html = `<html><body><div class="cf-turnstile" data-sitekey="0x4ABCDEF12345xyz_-"></div></body></html>`;
    const result = detectChallenge(html, 200);
    expect(result.isChallenge).toBe(true);
    expect(result.type).toBe('cloudflare_turnstile');
    expect(result.siteKey).toBe('0x4ABCDEF12345xyz_-');
  });

  it('detects Cloudflare "Just a moment" interstitials on 403/503', () => {
    for (const status of [403, 503]) {
      const html = `<html><head><title>Just a moment...</title></head><body>Checking your browser...</body></html>`;
      const result = detectChallenge(html, status);
      expect(result.isChallenge).toBe(true);
      expect(result.type).toBe('cloudflare_ddos');
    }
  });

  it('does not flag a normal 403 without challenge markers', () => {
    const result = detectChallenge('<html><body>Forbidden</body></html>', 403);
    expect(result.isChallenge).toBe(false);
    expect(result.type).toBe('none');
  });

  it('detects Google reCAPTCHA embeds', () => {
    const html = `<html><body><div class="g-recaptcha" data-sitekey="6LcXYZ"></div></body></html>`;
    const result = detectChallenge(html, 200);
    expect(result.isChallenge).toBe(true);
    expect(result.type).toBe('recaptcha');
  });

  it('passes clean pages through', () => {
    const html = `<html><head><title>Solo Leveling — Chapter 12</title></head><body><img src="page1.jpg"/></body></html>`;
    const result = detectChallenge(html, 200);
    expect(result.isChallenge).toBe(false);
    expect(result.type).toBe('none');
  });
});

import { FlareSolverrSessionPool } from '../server/captchaSolver';

describe('FlareSolverrSessionPool', () => {
  it('manages sessions and recycles after error threshold', async () => {
    const pool = new FlareSolverrSessionPool();
    expect(pool.getActiveCount()).toBe(0);

    // Mock session creation by setting directly in private map for deterministic unit testing
    (pool as any).sessions.set('asurascans', {
      sessionId: 'session_asura_123',
      sourceKey: 'asurascans',
      createdAt: Date.now(),
      lastUsed: Date.now(),
      consecutiveErrors: 0,
    });

    expect(pool.getActiveCount()).toBe(1);

    // Test recordSessionSuccess
    pool.recordSessionSuccess('asurascans');
    expect((pool as any).sessions.get('asurascans').consecutiveErrors).toBe(0);

    // Test consecutive errors
    pool.recordSessionFailure('asurascans');
    expect((pool as any).sessions.get('asurascans').consecutiveErrors).toBe(1);

    pool.recordSessionFailure('asurascans');
    expect((pool as any).sessions.get('asurascans').consecutiveErrors).toBe(2);

    // Session should be flagged as failed and next getOrCreateSession will purge it
    const existing = (pool as any).sessions.get('asurascans');
    const isFailed = existing.consecutiveErrors >= (pool as any).maxErrorsBeforeRecycle;
    expect(isFailed).toBe(true);
  });
});

