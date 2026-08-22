// ============================================================================
// SOURCE HEALTH & SESSION COOKIE MANAGEMENT SERVICE
// ============================================================================

import { SqliteDb } from '../../sqlite-db';
import { sourceCircuitBreaker, CircuitState } from '../circuitBreaker';

export interface SourceHealth {
  id: string;
  lastChecked: number;
  lastStatus: 'ok' | 'degraded' | 'blocked' | 'down' | 'broken';
  consecutiveFailures: number;
  failureReason?: string;
  circuitState?: CircuitState;
}

export const sourceHealthMap = new Map<string, SourceHealth>();

export function detectBlockedResponse(html: string, statusCode: number): 'cloudflare' | 'captcha' | 'blocked' | 'none' {
  if (statusCode === 403 || statusCode === 503 || statusCode === 429) {
    if (/Checking your browser|cf-browser-verification|challenge-platform|Attention Required.*Cloudflare|Just a moment|DDoS protection|Please turn JavaScript on/i.test(html)) return 'cloudflare';
  }
  if (statusCode === 403) {
    if (/captcha|recaptcha|hcaptcha|turnstile|cf-turnstile/i.test(html)) return 'captcha';
    if (/blocked|access denied|ip has been banned/i.test(html)) return 'blocked';
  }
  return 'none';
}

let _sourceHealthPersistTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleSourceHealthPersist() {
  if (_sourceHealthPersistTimer) return; // already scheduled
  _sourceHealthPersistTimer = setTimeout(() => {
    _sourceHealthPersistTimer = null;
    try {
      const obj: Record<string, any> = {};
      for (const [id, h] of sourceHealthMap) obj[id] = h;
      SqliteDb.setSourceHealthMap(obj);
    } catch { /* non-critical — health state is best-effort */ }
  }, 500);
}

export function updateSourceHealth(sourceId: string, html: string | null, statusCode: number, error?: string) {
  let e = sourceHealthMap.get(sourceId);
  if (!e) {
    e = { id: sourceId, lastChecked: Date.now(), lastStatus: 'ok', consecutiveFailures: 0 };
    sourceHealthMap.set(sourceId, e);
  }
  e.lastChecked = Date.now();
  if (error || statusCode >= 400) {
    e.consecutiveFailures++;
    e.failureReason = error || `HTTP ${statusCode}`;
    if (e.consecutiveFailures >= 5) e.lastStatus = 'down';
    else if (e.consecutiveFailures >= 2) e.lastStatus = 'degraded';
    sourceCircuitBreaker.recordFailure(sourceId, statusCode, e.failureReason);
  } else if (html) {
    const bt = detectBlockedResponse(html, statusCode);
    if (bt !== 'none') {
      e.consecutiveFailures++;
      e.lastStatus = 'blocked';
      e.failureReason = `Source returned ${bt} challenge`;
      sourceCircuitBreaker.trip(sourceId, e.failureReason);
    } else {
      e.consecutiveFailures = 0;
      e.lastStatus = 'ok';
      e.failureReason = undefined;
      sourceCircuitBreaker.recordSuccess(sourceId);
    }
  } else {
    e.consecutiveFailures = 0;
    e.lastStatus = 'ok';
    e.failureReason = undefined;
    sourceCircuitBreaker.recordSuccess(sourceId);
  }
  e.circuitState = sourceCircuitBreaker.getState(sourceId).state;

  scheduleSourceHealthPersist();
}

/** Load persisted health state from SQLite on startup (RC-5). */
export function loadSourceHealthMap() {
  try {
    const saved = SqliteDb.getSourceHealthMap();
    for (const [id, h] of Object.entries(saved)) {
      if (h && typeof h === 'object') sourceHealthMap.set(id, h as SourceHealth);
    }
    if (Object.keys(saved).length > 0) {
      console.log(`[Source Health] Loaded persisted health state for ${Object.keys(saved).length} sources.`);
    }
  } catch { /* non-critical */ }
}

// Fix #5: Per-Source Cookie Jar for session persistence
export class SourceCookieJar {
  private cookies = new Map<string, Map<string, string>>();
  setCookies(sid: string, headers: string[]) {
    if (!this.cookies.has(sid)) this.cookies.set(sid, new Map());
    const jar = this.cookies.get(sid)!;
    for (const h of headers) {
      const p = h.split(';')[0].split('=');
      if (p.length >= 2) jar.set(p[0].trim(), p.slice(1).join('='));
    }
  }
  getCookieHeader(sid: string): string {
    const jar = this.cookies.get(sid);
    if (!jar || jar.size === 0) return '';
    return Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
  }
  clear(sid?: string) {
    if (sid) this.cookies.delete(sid);
    else this.cookies.clear();
  }
}

export const sourceCookieJar = new SourceCookieJar();

// ── Automatic Domain Migration Resolver ──────────────────────────────────────
const KNOWN_SOURCE_MIRRORS: Record<string, string[]> = {
  asurascans: ['https://asuracomic.net', 'https://asura.gg', 'https://asurascans.com', 'https://asura.nacm.cc'],
  flamecomics: ['https://flamecomics.xyz', 'https://flamecomics.me', 'https://flamescans.org'],
  reaperscans: ['https://reaperscans.com', 'https://reaperscans.to', 'https://reapercomics.com'],
  weebcentral: ['https://weebcentral.com', 'https://weebcentral.net'],
};

/**
 * Automatically probes known mirrors when a source experiences consecutive network/DNS failures,
 * and updates SQLite database source URLs on successful mirror discovery.
 */
export async function attemptAutoDomainMigration(sourceId: string, currentUrl: string): Promise<string | null> {
  const mirrors = KNOWN_SOURCE_MIRRORS[sourceId.toLowerCase()];
  if (!mirrors || mirrors.length === 0) return null;

  for (const mirror of mirrors) {
    try {
      const probe = await fetch(mirror, {
        method: 'HEAD',
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(5000),
      });
      if (probe.ok || probe.status === 403) { // 403 means server exists and is alive
        console.log(`[Domain Resolver] Successfully discovered active mirror for "${sourceId}": ${mirror}`);
        // Automatically batch migrate database items with old domain
        try {
          const allManga = SqliteDb.getAllManga();
          const oldDomainMatch = currentUrl.match(/^https?:\/\/[^/]+/i)?.[0];
          if (oldDomainMatch) {
            for (const m of allManga) {
              if (m.sourceUrl?.startsWith(oldDomainMatch)) {
                const migratedUrl = m.sourceUrl.replace(oldDomainMatch, mirror);
                SqliteDb.updateManga(m.id, { sourceUrl: migratedUrl });
              }
            }
          }
        } catch (_) {}
        return mirror;
      }
    } catch (_) {}
  }
  return null;
}

