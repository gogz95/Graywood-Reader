// ============================================================================
// SOURCE CIRCUIT BREAKER & ACTIVE HEALTH GATING
// Prevents cascading stalls by fast-failing dead or blocked upstream sources.
// Follows the standard Martin Fowler Circuit Breaker pattern:
// - CLOSED: Normal operation. Requests flow through.
// - OPEN: Tripped after consecutive failures. Incoming requests fast-fail (0ms delay).
// - HALF_OPEN: After cooldown period, allows a single probe request to test recovery.
// ============================================================================

export type CircuitState = 'CLOSED' | 'HALF_OPEN' | 'OPEN';

export interface CircuitBreakerConfig {
  failureThreshold: number;      // Consecutive failures required to trip OPEN (default 3)
  cooldownPeriodMs: number;      // Time to stay OPEN before testing HALF_OPEN (default 5 min)
}

export interface SourceCircuitInfo {
  state: CircuitState;
  failures: number;
  tripCount: number;
  nextProbeTime: number | null;
  lastChecked: number;
  lastFailureReason?: string;
  cooldownMs?: number;
}

export class SourceCircuitBreaker {
  private config: CircuitBreakerConfig;
  private states = new Map<string, {
    state: CircuitState;
    failures: number;
    tripCount: number;
    nextProbeTime: number | null;
    lastChecked: number;
    lastFailureReason?: string;
    cooldownMs?: number;
  }>();

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = {
      failureThreshold: config?.failureThreshold ?? 3,
      cooldownPeriodMs: config?.cooldownPeriodMs ?? 5 * 60 * 1000, // 5 minutes
    };
  }

  /**
   * Determine if a request to the source should be permitted.
   * If OPEN and cooldown has passed, transitions to HALF_OPEN to allow one probe.
   * If OPEN and in cooldown, returns false (fast-fail).
   */
  public canAttempt(sourceId: string): boolean {
    const normId = (sourceId || '').toLowerCase().trim();
    if (!normId) return true;

    const entry = this.states.get(normId);
    if (!entry || entry.state === 'CLOSED') {
      return true;
    }

    const now = Date.now();

    if (entry.state === 'OPEN') {
      if (entry.nextProbeTime && now >= entry.nextProbeTime) {
        // Cooldown period elapsed -> transition to HALF_OPEN for a single probe
        entry.state = 'HALF_OPEN';
        entry.lastChecked = now;
        return true;
      }
      return false; // Fast-fail
    }

    // HALF_OPEN: allows the probe request
    return true;
  }

  /**
   * Record a successful response from a source.
   * Resets the failure counter, tripCount, and returns the circuit to CLOSED.
   */
  public recordSuccess(sourceId: string): void {
    const normId = (sourceId || '').toLowerCase().trim();
    if (!normId) return;

    this.states.set(normId, {
      state: 'CLOSED',
      failures: 0,
      tripCount: 0,
      nextProbeTime: null,
      lastChecked: Date.now(),
      lastFailureReason: undefined,
      cooldownMs: undefined,
    });
  }

  /**
   * Record a failed response or network error for a source.
   * Non-transient status codes (404, 410) and severe blocking codes (403, 503, 429, 520-524)
   * count as double failures for faster circuit response.
   * Implements exponential backoff on consecutive trips (up to 16x base cooldown).
   */
  public recordFailure(sourceId: string, statusCode?: number, reason?: string): void {
    const normId = (sourceId || '').toLowerCase().trim();
    if (!normId) return;

    const now = Date.now();
    const entry = this.states.get(normId) || {
      state: 'CLOSED' as CircuitState,
      failures: 0,
      tripCount: 0,
      nextProbeTime: null,
      lastChecked: now,
      lastFailureReason: undefined,
      cooldownMs: undefined,
    };

    const isNonTransient = statusCode === 404 || statusCode === 410;
    const isSevereBlock = statusCode === 403 || statusCode === 503 || statusCode === 429 || (statusCode && statusCode >= 520 && statusCode <= 524);
    const failureIncrement = isNonTransient || isSevereBlock ? 2 : 1;

    entry.failures += failureIncrement;
    entry.lastChecked = now;
    entry.lastFailureReason = reason || (statusCode ? `HTTP ${statusCode}` : 'Network / Timeout Error');

    // If currently HALF_OPEN or failure threshold reached, trip OPEN with exponential backoff
    if (entry.state === 'HALF_OPEN' || entry.failures >= this.config.failureThreshold) {
      entry.state = 'OPEN';
      entry.tripCount = (entry.tripCount || 0) + 1;
      const backoffMultiplier = Math.min(Math.pow(2, entry.tripCount - 1), 16);
      const effectiveCooldown = this.config.cooldownPeriodMs * backoffMultiplier;
      entry.cooldownMs = effectiveCooldown;
      entry.nextProbeTime = now + effectiveCooldown;
      console.warn(`[Circuit Breaker] Source "${normId}" tripped OPEN (trip #${entry.tripCount}, ${backoffMultiplier}x backoff, cooldown ${Math.round(effectiveCooldown / 1000)}s until ${new Date(entry.nextProbeTime).toISOString()}). Reason: ${entry.lastFailureReason}`);
    }

    this.states.set(normId, entry);
  }

  /**
   * Manually trip a circuit to OPEN (e.g. upon detecting Cloudflare blocks without a solver).
   */
  public trip(sourceId: string, reason?: string, customCooldownMs?: number): void {
    const normId = (sourceId || '').toLowerCase().trim();
    if (!normId) return;

    const now = Date.now();
    const entry = this.states.get(normId) || {
      state: 'CLOSED' as CircuitState,
      failures: 0,
      tripCount: 0,
      nextProbeTime: null,
      lastChecked: now,
      lastFailureReason: undefined,
      cooldownMs: undefined,
    };

    entry.state = 'OPEN';
    entry.tripCount = (entry.tripCount || 0) + 1;
    const backoffMultiplier = customCooldownMs ? 1 : Math.min(Math.pow(2, entry.tripCount - 1), 16);
    const effectiveCooldown = customCooldownMs ?? (this.config.cooldownPeriodMs * backoffMultiplier);
    entry.failures = Math.max(entry.failures, this.config.failureThreshold);
    entry.cooldownMs = effectiveCooldown;
    entry.nextProbeTime = now + effectiveCooldown;
    entry.lastChecked = now;
    entry.lastFailureReason = reason || 'Manual Trip / Challenge Detected';

    this.states.set(normId, entry);
  }

  /**
   * Get the current circuit information for a source.
   */
  public getState(sourceId: string): SourceCircuitInfo {
    const normId = (sourceId || '').toLowerCase().trim();
    const entry = this.states.get(normId);
    if (!entry) {
      return {
        state: 'CLOSED',
        failures: 0,
        tripCount: 0,
        nextProbeTime: null,
        lastChecked: 0,
      };
    }
    // Reflect automatic transition if cooldown expired
    if (entry.state === 'OPEN' && entry.nextProbeTime && Date.now() >= entry.nextProbeTime) {
      return {
        ...entry,
        state: 'HALF_OPEN',
      };
    }
    return { ...entry };
  }

  /**
   * Return a dictionary of all tracked circuit states.
   */
  public getAllStates(): Record<string, SourceCircuitInfo> {
    const res: Record<string, SourceCircuitInfo> = {};
    for (const [id] of this.states) {
      res[id] = this.getState(id);
    }
    return res;
  }

  /**
   * Reset all or a specific circuit state.
   */
  public reset(sourceId?: string): void {
    if (sourceId) {
      this.states.delete(sourceId.toLowerCase().trim());
    } else {
      this.states.clear();
    }
  }
}

export const sourceCircuitBreaker = new SourceCircuitBreaker();
