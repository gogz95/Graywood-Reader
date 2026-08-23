import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DomainRateLimiter } from '../server/services/domainRateLimiter';

describe('DomainRateLimiter Service', () => {
  let limiter: DomainRateLimiter;

  beforeEach(() => {
    limiter = new DomainRateLimiter();
  });

  it('normalizes various URLs and hostnames accurately', () => {
    expect(limiter.normalizeDomain('https://mangadex.org/title/123')).toBe('mangadex.org');
    expect(limiter.normalizeDomain('http://weebcentral.com:8080/chapters')).toBe('weebcentral.com');
    expect(limiter.normalizeDomain('AsuraScans.COM/series/test')).toBe('asurascans.com');
    expect(limiter.normalizeDomain('')).toBe('unknown');
  });

  it('schedules and executes tasks sequentially within rate capacity', async () => {
    limiter.setConfig('testdomain.com', {
      requestsPerSecond: 10,
      burstCapacity: 2,
    });

    const executionOrder: number[] = [];

    const p1 = limiter.schedule('https://testdomain.com/1', async () => {
      executionOrder.push(1);
      return 'res1';
    });

    const p2 = limiter.schedule('https://testdomain.com/2', async () => {
      executionOrder.push(2);
      return 'res2';
    });

    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1).toBe('res1');
    expect(r2).toBe('res2');
    expect(executionOrder).toEqual([1, 2]);
  });

  it('triggers backoff on 429 and updates status accordingly', () => {
    limiter.setConfig('rate-limited.com', {
      backoffInitialMs: 2000,
      backoffMaxMs: 10000,
    });

    limiter.triggerBackoff('https://rate-limited.com/ch1', 429);

    const status = limiter.getDomainStatus('https://rate-limited.com');
    expect(status.isBackingOff).toBe(true);
    expect(status.backoffRemainingMs).toBeGreaterThan(0);
    expect(status.backoffRemainingMs).toBeLessThanOrEqual(2000);
  });
});
