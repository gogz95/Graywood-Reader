import { logger } from '../logger';

export interface DomainRateLimitConfig {
  /** Maximum requests permitted per second for this domain */
  requestsPerSecond: number;
  /** Burst capacity allowed before throttling begins */
  burstCapacity: number;
  /** Cooldown time in ms after encountering a 429 / 503 HTTP status */
  backoffInitialMs: number;
  /** Maximum backoff cooldown cap in ms */
  backoffMaxMs: number;
}

const DEFAULT_CONFIG: DomainRateLimitConfig = {
  requestsPerSecond: 2.5, // ~400ms between requests
  burstCapacity: 5,
  backoffInitialMs: 5000,
  backoffMaxMs: 60000,
};

interface DomainState {
  tokens: number;
  lastRefill: number;
  queue: Array<() => void>;
  backoffUntil: number;
  currentBackoffMs: number;
  consecutiveBackoffs: number;
}

export class DomainRateLimiter {
  private domains = new Map<string, DomainState>();
  private domainConfigs = new Map<string, DomainRateLimitConfig>();

  constructor() {
    // Periodic sweep to clean up idle domains after 10 minutes
    setInterval(() => this.cleanupIdleDomains(), 10 * 60 * 1000);
  }

  /**
   * Set custom rate limit configuration for a specific domain.
   */
  public setConfig(domain: string, config: Partial<DomainRateLimitConfig>): void {
    const cleanDomain = this.normalizeDomain(domain);
    this.domainConfigs.set(cleanDomain, { ...DEFAULT_CONFIG, ...config });
  }

  /**
   * Extract or normalize domain hostname from a URL or raw domain string.
   */
  public normalizeDomain(urlOrDomain: string): string {
    if (!urlOrDomain) return 'unknown';
    try {
      if (urlOrDomain.startsWith('http://') || urlOrDomain.startsWith('https://')) {
        const u = new URL(urlOrDomain);
        return u.hostname.toLowerCase();
      }
      return urlOrDomain.toLowerCase().split('/')[0].split(':')[0];
    } catch {
      return urlOrDomain.toLowerCase();
    }
  }

  private getDomainState(domain: string): DomainState {
    let state = this.domains.get(domain);
    if (!state) {
      const config = this.domainConfigs.get(domain) || DEFAULT_CONFIG;
      state = {
        tokens: config.burstCapacity,
        lastRefill: Date.now(),
        queue: [],
        backoffUntil: 0,
        currentBackoffMs: config.backoffInitialMs,
        consecutiveBackoffs: 0,
      };
      this.domains.set(domain, state);
    }
    return state;
  }

  private refillTokens(domain: string, state: DomainState, config: DomainRateLimitConfig): void {
    const now = Date.now();
    const elapsedSec = (now - state.lastRefill) / 1000;
    state.lastRefill = now;
    state.tokens = Math.min(config.burstCapacity, state.tokens + elapsedSec * config.requestsPerSecond);
  }

  /**
   * Schedules execution of an asynchronous request, holding it until token capacity is available.
   */
  public async schedule<T>(urlOrDomain: string, fn: () => Promise<T>): Promise<T> {
    const domain = this.normalizeDomain(urlOrDomain);
    const config = this.domainConfigs.get(domain) || DEFAULT_CONFIG;
    const state = this.getDomainState(domain);

    await new Promise<void>((resolve) => {
      state.queue.push(resolve);
      this.processQueue(domain);
    });

    try {
      const result = await fn();
      // On success, gradually reduce backoff penalty
      if (state.consecutiveBackoffs > 0) {
        state.consecutiveBackoffs = Math.max(0, state.consecutiveBackoffs - 1);
        if (state.consecutiveBackoffs === 0) {
          state.currentBackoffMs = config.backoffInitialMs;
        }
      }
      return result;
    } catch (err: any) {
      const status = err?.status || err?.statusCode || err?.response?.status;
      if (status === 429 || status === 503) {
        this.triggerBackoff(domain, status);
      }
      throw err;
    }
  }

  /**
   * Explicitly notify the rate limiter that a 429/503 response was received for this domain.
   */
  public triggerBackoff(urlOrDomain: string, statusCode = 429): void {
    const domain = this.normalizeDomain(urlOrDomain);
    const config = this.domainConfigs.get(domain) || DEFAULT_CONFIG;
    const state = this.getDomainState(domain);

    state.consecutiveBackoffs++;
    state.currentBackoffMs = Math.min(
      config.backoffMaxMs,
      config.backoffInitialMs * Math.pow(2, state.consecutiveBackoffs - 1)
    );
    state.backoffUntil = Date.now() + state.currentBackoffMs;

    logger.warn('DomainRateLimiter', `Domain "${domain}" triggered HTTP ${statusCode}. Backing off for ${Math.round(state.currentBackoffMs / 1000)}s`);

    setTimeout(() => {
      this.processQueue(domain);
    }, state.currentBackoffMs + 50);
  }

  private processQueue(domain: string): void {
    const state = this.domains.get(domain);
    if (!state || state.queue.length === 0) return;

    const now = Date.now();
    if (now < state.backoffUntil) {
      const delay = state.backoffUntil - now;
      setTimeout(() => this.processQueue(domain), delay + 10);
      return;
    }

    const config = this.domainConfigs.get(domain) || DEFAULT_CONFIG;
    this.refillTokens(domain, state, config);

    if (state.tokens >= 1.0) {
      state.tokens -= 1.0;
      const next = state.queue.shift();
      if (next) {
        next();
      }
    } else {
      // Not enough tokens yet -> compute time needed to accumulate 1 token
      const waitMs = Math.ceil(((1.0 - state.tokens) / config.requestsPerSecond) * 1000);
      setTimeout(() => this.processQueue(domain), Math.max( waitMs, 25 ));
    }
  }

  public getDomainStatus(urlOrDomain: string): {
    domain: string;
    queuedCount: number;
    tokensAvailable: number;
    isBackingOff: boolean;
    backoffRemainingMs: number;
  } {
    const domain = this.normalizeDomain(urlOrDomain);
    const state = this.domains.get(domain);
    if (!state) {
      return {
        domain,
        queuedCount: 0,
        tokensAvailable: DEFAULT_CONFIG.burstCapacity,
        isBackingOff: false,
        backoffRemainingMs: 0,
      };
    }
    const now = Date.now();
    return {
      domain,
      queuedCount: state.queue.length,
      tokensAvailable: Math.round(state.tokens * 10) / 10,
      isBackingOff: now < state.backoffUntil,
      backoffRemainingMs: Math.max(0, state.backoffUntil - now),
    };
  }

  private cleanupIdleDomains(): void {
    const now = Date.now();
    for (const [domain, state] of this.domains.entries()) {
      if (state.queue.length === 0 && now - state.lastRefill > 10 * 60 * 1000 && now > state.backoffUntil) {
        this.domains.delete(domain);
      }
    }
  }
}

export const domainRateLimiter = new DomainRateLimiter();
