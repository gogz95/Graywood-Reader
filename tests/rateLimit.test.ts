import { describe, it, expect } from 'vitest';
import {
  checkLoginRateLimit,
  recordLoginFailure,
  clearLoginFailures,
  checkAccountLockout,
  recordAccountFailure,
  clearAccountFailures,
  RATE_LIMIT_MAX,
  RATE_LIMIT_PROXY_MAX,
} from '../server/rateLimit';

describe('IP login brute-force limiter', () => {
  it('allows attempts until the failure threshold, then blocks the IP', () => {
    const ip = '203.0.113.10';
    expect(checkLoginRateLimit(ip)).toBeNull();

    for (let i = 0; i < 4; i++) {
      recordLoginFailure(ip);
      // Still below threshold — allowed
      expect(checkLoginRateLimit(ip)).toBeNull();
    }

    recordLoginFailure(ip); // 5th failure → block
    const block = checkLoginRateLimit(ip);
    expect(block?.blocked).toBe(true);
    expect(block!.retryAfterSeconds).toBeGreaterThan(0);

    clearLoginFailures(ip);
    expect(checkLoginRateLimit(ip)).toBeNull();
  });

  it('does not cross-contaminate different IPs', () => {
    const a = '203.0.113.20';
    const b = '203.0.113.21';
    for (let i = 0; i < 5; i++) recordLoginFailure(a);
    expect(checkLoginRateLimit(a)?.blocked).toBe(true);
    expect(checkLoginRateLimit(b)).toBeNull();
    clearLoginFailures(a);
  });
});

describe('per-account lockout', () => {
  it('locks the account after repeated failures regardless of IP', () => {
    const account = 'victim@example.com';
    expect(checkAccountLockout(account)).toBeNull();

    for (let i = 0; i < 5; i++) recordAccountFailure(account);
    const block = checkAccountLockout(account);
    expect(block?.blocked).toBe(true);
    expect(block!.message).toContain('locked');

    clearAccountFailures(account);
    expect(checkAccountLockout(account)).toBeNull();
  });

  it('stays below threshold when failures clear first', () => {
    const account = 'careful@example.com';
    recordAccountFailure(account);
    recordAccountFailure(account);
    expect(checkAccountLockout(account)).toBeNull();
    clearAccountFailures(account);
  });

  it('ignores empty identifiers', () => {
    recordAccountFailure('');
    expect(checkAccountLockout('')).toBeNull();
  });
});

describe('rate-limit budget constants', () => {
  it('keeps sane public budgets', () => {
    expect(RATE_LIMIT_MAX).toBeGreaterThanOrEqual(60);
    expect(RATE_LIMIT_PROXY_MAX).toBeGreaterThan(RATE_LIMIT_MAX);
  });
});
