import { describe, it, expect, beforeEach } from 'vitest';
import { SourceCircuitBreaker } from '../server/circuitBreaker';

describe('SourceCircuitBreaker', () => {
  let breaker: SourceCircuitBreaker;

  beforeEach(() => {
    breaker = new SourceCircuitBreaker({
      failureThreshold: 3,
      cooldownPeriodMs: 1000, // 1 second for fast testing
    });
  });

  it('starts in CLOSED state and permits attempts', () => {
    expect(breaker.canAttempt('asurascans')).toBe(true);
    expect(breaker.getState('asurascans').state).toBe('CLOSED');
    expect(breaker.getState('asurascans').failures).toBe(0);
  });

  it('remains CLOSED when failures are below threshold', () => {
    breaker.recordFailure('asurascans', 500, 'Server Error');
    breaker.recordFailure('asurascans', 502, 'Bad Gateway');

    expect(breaker.canAttempt('asurascans')).toBe(true);
    expect(breaker.getState('asurascans').state).toBe('CLOSED');
    expect(breaker.getState('asurascans').failures).toBe(2);
  });

  it('trips OPEN once failure threshold is reached and fast-fails', () => {
    breaker.recordFailure('asurascans', 500);
    breaker.recordFailure('asurascans', 500);
    breaker.recordFailure('asurascans', 500);

    expect(breaker.getState('asurascans').state).toBe('OPEN');
    expect(breaker.canAttempt('asurascans')).toBe(false); // Fast-fail
  });

  it('non-transient HTTP 404 counts as double failures for faster tripping', () => {
    breaker.recordFailure('deadsource', 404, 'Not Found');
    breaker.recordFailure('deadsource', 404, 'Not Found');

    // 2 + 2 = 4 >= 3 threshold -> trips OPEN
    expect(breaker.getState('deadsource').state).toBe('OPEN');
    expect(breaker.canAttempt('deadsource')).toBe(false);
  });

  it('transitions to HALF_OPEN after cooldown and allows a single probe', async () => {
    breaker.recordFailure('flamecomics', 500);
    breaker.recordFailure('flamecomics', 500);
    breaker.recordFailure('flamecomics', 500);

    expect(breaker.canAttempt('flamecomics')).toBe(false);

    // Wait for cooldown to expire
    await new Promise((r) => setTimeout(r, 1050));

    // Next request should transition to HALF_OPEN and be allowed
    expect(breaker.canAttempt('flamecomics')).toBe(true);
    expect(breaker.getState('flamecomics').state).toBe('HALF_OPEN');
  });

  it('success in HALF_OPEN resets circuit to CLOSED', async () => {
    breaker.recordFailure('flamecomics', 500);
    breaker.recordFailure('flamecomics', 500);
    breaker.recordFailure('flamecomics', 500);

    await new Promise((r) => setTimeout(r, 1050));
    expect(breaker.canAttempt('flamecomics')).toBe(true); // transitions to HALF_OPEN

    breaker.recordSuccess('flamecomics');
    expect(breaker.getState('flamecomics').state).toBe('CLOSED');
    expect(breaker.getState('flamecomics').failures).toBe(0);
    expect(breaker.canAttempt('flamecomics')).toBe(true);
  });

  it('failure in HALF_OPEN immediately trips back to OPEN', async () => {
    breaker.recordFailure('flamecomics', 500);
    breaker.recordFailure('flamecomics', 500);
    breaker.recordFailure('flamecomics', 500);

    await new Promise((r) => setTimeout(r, 1050));
    expect(breaker.canAttempt('flamecomics')).toBe(true); // transitions to HALF_OPEN

    // Probe fails
    breaker.recordFailure('flamecomics', 503, 'Still down');
    expect(breaker.getState('flamecomics').state).toBe('OPEN');
    expect(breaker.canAttempt('flamecomics')).toBe(false);
  });

  it('allows manual trip with custom reason', () => {
    breaker.trip('blocked-source', 'Cloudflare Turnstile Detected');
    expect(breaker.getState('blocked-source').state).toBe('OPEN');
    expect(breaker.getState('blocked-source').lastFailureReason).toBe('Cloudflare Turnstile Detected');
    expect(breaker.canAttempt('blocked-source')).toBe(false);
  });

  it('case-insensitively normalizes source IDs', () => {
    breaker.recordFailure('MangaDex', 500);
    expect(breaker.getState('mangadex').failures).toBe(1);
    expect(breaker.getState('MANGADEX').failures).toBe(1);
  });
});
