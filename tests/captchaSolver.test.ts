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
