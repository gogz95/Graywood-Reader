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

  it('scales cooldown exponentially on consecutive trips and resets on success', () => {
    // 1st trip: 1x base cooldown = 1000ms
    breaker.recordFailure('asurascans', 500);
    breaker.recordFailure('asurascans', 500);
    breaker.recordFailure('asurascans', 500);
    const state1 = breaker.getState('asurascans');
    expect(state1.state).toBe('OPEN');
    expect(state1.tripCount).toBe(1);
    expect(state1.cooldownMs).toBe(1000);

    // Force HALF_OPEN by manually updating state's nextProbeTime
    (breaker as any).states.get('asurascans').nextProbeTime = Date.now() - 10;
    expect(breaker.canAttempt('asurascans')).toBe(true);

    // 2nd trip: 2x base cooldown = 2000ms
    breaker.recordFailure('asurascans', 500);
    const state2 = breaker.getState('asurascans');
    expect(state2.state).toBe('OPEN');
    expect(state2.tripCount).toBe(2);
    expect(state2.cooldownMs).toBe(2000);

    // Force HALF_OPEN again
    (breaker as any).states.get('asurascans').nextProbeTime = Date.now() - 10;
    expect(breaker.canAttempt('asurascans')).toBe(true);

    // 3rd trip: 4x base cooldown = 4000ms
    breaker.recordFailure('asurascans', 500);
    const state3 = breaker.getState('asurascans');
    expect(state3.state).toBe('OPEN');
    expect(state3.tripCount).toBe(3);
    expect(state3.cooldownMs).toBe(4000);

    // Success resets trip count and cooldown
    breaker.recordSuccess('asurascans');
    const state4 = breaker.getState('asurascans');
    expect(state4.state).toBe('CLOSED');
    expect(state4.tripCount).toBe(0);
  });

  it('severe HTTP errors (403, 503, 429) count as double failures', () => {
    breaker.recordFailure('blocked_source', 403, 'Cloudflare 403 Forbidden');
    breaker.recordFailure('blocked_source', 503, 'Service Unavailable');
    // 2 + 2 = 4 >= 3 threshold -> trips OPEN
    expect(breaker.getState('blocked_source').state).toBe('OPEN');
    expect(breaker.canAttempt('blocked_source')).toBe(false);
  });

  it('case-insensitively normalizes source IDs', () => {
    breaker.recordFailure('MangaDex', 500);
    expect(breaker.getState('mangadex').failures).toBe(1);
    expect(breaker.getState('MANGADEX').failures).toBe(1);
  });
});
