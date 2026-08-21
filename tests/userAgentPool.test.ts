import { describe, it, expect } from 'vitest';
import {
  BROWSER_PROFILES,
  getRandomBrowserProfile,
  getDeterministicBrowserProfile,
  getBrowserHeaders,
} from '../server/userAgentPool';

describe('UserAgentPool', () => {
  it('contains diverse browser profiles with valid client hints', () => {
    expect(BROWSER_PROFILES.length).toBeGreaterThanOrEqual(6);
    for (const profile of BROWSER_PROFILES) {
      expect(profile.userAgent).toBeTruthy();
      expect(profile.acceptLanguage).toBeTruthy();
      expect(profile.secChUaMobile).toMatch(/^\?[01]$/);
      expect(profile.secChUaPlatform).toBeTruthy();
      expect(profile.acceptHtml).toContain('text/html');
      expect(profile.acceptImage).toContain('image/');
    }
  });

  it('getRandomBrowserProfile respects device preference', () => {
    const desktop = getRandomBrowserProfile('desktop');
    expect(desktop.isMobile).toBe(false);
    expect(desktop.secChUaMobile).toBe('?0');

    const mobile = getRandomBrowserProfile('mobile');
    expect(mobile.isMobile).toBe(true);
    expect(mobile.secChUaMobile).toBe('?1');
  });

  it('getDeterministicBrowserProfile produces consistent results for same source seed', () => {
    const p1 = getDeterministicBrowserProfile('asurascans');
    const p2 = getDeterministicBrowserProfile('asurascans');
    expect(p1.id).toBe(p2.id);
    expect(p1.userAgent).toBe(p2.userAgent);

    const p3 = getDeterministicBrowserProfile('flamecomics');
    const p4 = getDeterministicBrowserProfile('flamecomics');
    expect(p3.id).toBe(p4.id);
  });

  it('getBrowserHeaders formats complete browser request headers for HTML', () => {
    const headers = getBrowserHeaders('https://asuracomic.net/series/solo-leveling', {
      sourceId: 'asurascans',
    });

    expect(headers['User-Agent']).toBeTruthy();
    expect(headers['Accept']).toContain('text/html');
    expect(headers['Accept-Language']).toBeTruthy();
    expect(headers['Sec-Fetch-Dest']).toBe('document');
    expect(headers['Sec-Fetch-Mode']).toBe('navigate');
    expect(headers['Sec-Fetch-Site']).toBe('same-origin');
    expect(headers['Sec-Fetch-User']).toBe('?1');
    expect(headers['Upgrade-Insecure-Requests']).toBe('1');
    expect(headers['Referer']).toBe('https://asuracomic.net/');
  });

  it('getBrowserHeaders formats image headers with image mime-types', () => {
    const headers = getBrowserHeaders('https://cdn.example.com/chapter-1/001.jpg', {
      isImage: true,
      referer: 'https://example.com/manga/read/1',
    });

    expect(headers['Accept']).toContain('image/');
    expect(headers['Sec-Fetch-Dest']).toBe('image');
    expect(headers['Sec-Fetch-Mode']).toBe('no-cors');
    expect(headers['Sec-Fetch-User']).toBeUndefined();
    expect(headers['Upgrade-Insecure-Requests']).toBeUndefined();
    expect(headers['Referer']).toBe('https://example.com/manga/read/1');
  });

  it('allows custom header overrides', () => {
    const headers = getBrowserHeaders('https://example.com/api', {
      customHeaders: {
        'X-Requested-With': 'XMLHttpRequest',
        'Authorization': 'Bearer token123',
      },
    });

    expect(headers['X-Requested-With']).toBe('XMLHttpRequest');
    expect(headers['Authorization']).toBe('Bearer token123');
  });
});
