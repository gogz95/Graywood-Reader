import { URL } from 'url';
import { fetchWithSsrfGuard } from './security';
import { challengeManager } from './challengeManager';
import { getBrowserHeaders } from './userAgentPool';
import { sourceCircuitBreaker } from './circuitBreaker';

export interface ChallengeDetectionResult {
  isChallenge: boolean;
  type: 'cloudflare_turnstile' | 'cloudflare_ddos' | 'recaptcha' | 'hcaptcha' | 'ip_block' | 'none';
  siteKey?: string;
  action?: string;
  data?: string;
  pageTitle?: string;
}

export interface SolverCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
}

export interface FlareSolverrResponse {
  ok: boolean;
  status?: string;
  message?: string;
  html?: string;
  cookies?: SolverCookie[];
  userAgent?: string;
  responseTimeMs?: number;
  error?: string;
}

export interface SolverBalanceResult {
  ok: boolean;
  provider: string;
  balance?: number;
  currency?: string;
  error?: string;
}

export interface FetchBypassOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  sourceId?: string;
  enableCloudflareBypass?: boolean;
  flareSolverrUrl?: string;
  captchaSolverEnabled?: boolean;
  captchaApiKey?: string;
  captchaProvider?: 'auto' | '2captcha' | 'capsolver';
  onCookieUpdate?: (sourceId: string, cookies: string[]) => void;
}

export interface FetchBypassResult {
  ok: boolean;
  status: number;
  html: string;
  bypassed: boolean;
  methodUsed?: string;
  error?: string;
}

interface FlareSolverrSessionEntry {
  sessionId: string;
  sourceKey: string;
  createdAt: number;
  lastUsed: number;
  consecutiveErrors: number;
}

/**
 * Manages persistent FlareSolverr browser sessions keyed by domain/source.
 * Reusing sessions keeps Cloudflare clearance tokens and browser context warm.
 */
export class FlareSolverrSessionPool {
  private sessions = new Map<string, FlareSolverrSessionEntry>();
  private maxSessionAgeMs = 20 * 60 * 1000; // 20 min max session lifetime
  private sessionIdleTtlMs = 8 * 60 * 1000;  // 8 min idle TTL
  private maxErrorsBeforeRecycle = 2;

  /**
   * Acquire or create a valid FlareSolverr session for a given source / domain.
   */
  public async getOrCreateSession(
    flareSolverrUrl: string,
    sourceKey: string,
    timeoutSeconds: number = 10
  ): Promise<string | null> {
    const key = (sourceKey || 'default').toLowerCase().replace(/[^a-z0-9-_]/g, '_');
    const existing = this.sessions.get(key);
    const now = Date.now();

    if (existing) {
      const isExpired = (now - existing.createdAt) > this.maxSessionAgeMs;
      const isIdle = (now - existing.lastUsed) > this.sessionIdleTtlMs;
      const isFailed = existing.consecutiveErrors >= this.maxErrorsBeforeRecycle;

      if (!isExpired && !isIdle && !isFailed) {
        existing.lastUsed = now;
        return existing.sessionId;
      }

      // Destroy stale / errored session on server
      await this.destroySession(flareSolverrUrl, existing.sessionId);
      this.sessions.delete(key);
    }

    // Create a new session with unique ID
    const sessionId = `gy_${key}_${Math.random().toString(36).substring(2, 8)}`;
    try {
      const endpoint = flareSolverrUrl.replace(/\/+$/, '');
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cmd: 'sessions.create',
          session: sessionId,
        }),
        signal: AbortSignal.timeout(timeoutSeconds * 1000),
      });

      if (res.ok) {
        const data: any = await res.json();
        if (data.status === 'ok') {
          const sid = data.session || sessionId;
          this.sessions.set(key, {
            sessionId: sid,
            sourceKey: key,
            createdAt: now,
            lastUsed: now,
            consecutiveErrors: 0,
          });
          return sid;
        }
      }
    } catch (_) {
      // If session creation fails (e.g. FlareSolverr v2 without session support), fallback to stateless
    }

    return null;
  }

  /**
   * Record success on a session.
   */
  public recordSessionSuccess(sourceKey: string): void {
    const key = (sourceKey || 'default').toLowerCase().replace(/[^a-z0-9-_]/g, '_');
    const existing = this.sessions.get(key);
    if (existing) {
      existing.lastUsed = Date.now();
      existing.consecutiveErrors = 0;
    }
  }

  /**
   * Record failure on a session. If error count exceeds threshold, session will be recycled.
   */
  public recordSessionFailure(sourceKey: string): void {
    const key = (sourceKey || 'default').toLowerCase().replace(/[^a-z0-9-_]/g, '_');
    const existing = this.sessions.get(key);
    if (existing) {
      existing.consecutiveErrors++;
    }
  }

  /**
   * Destroy a session on the FlareSolverr server and remove from memory.
   */
  public async destroySession(flareSolverrUrl: string, sessionId: string): Promise<void> {
    if (!sessionId) return;
    try {
      const endpoint = flareSolverrUrl.replace(/\/+$/, '');
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cmd: 'sessions.destroy',
          session: sessionId,
        }),
        signal: AbortSignal.timeout(4000),
      });
    } catch (_) {
      // Best-effort cleanup
    }
  }

  /**
   * Clear all sessions from pool.
   */
  public async destroyAll(flareSolverrUrl: string): Promise<void> {
    for (const [, s] of this.sessions) {
      await this.destroySession(flareSolverrUrl, s.sessionId);
    }
    this.sessions.clear();
  }

  public getActiveCount(): number {
    return this.sessions.size;
  }
}

export const flareSolverrSessionPool = new FlareSolverrSessionPool();

/**
 * Scan HTTP response body and status code for Cloudflare and Captcha bot protection screens.
 */
export function detectChallenge(html: string, statusCode: number): ChallengeDetectionResult {
  const normalizedHtml = (html || '').toLowerCase();

  // 1. Cloudflare Turnstile / Challenge Platform
  if (
    normalizedHtml.includes('challenges.cloudflare.com/turnstile') ||
    normalizedHtml.includes('cf-turnstile') ||
    normalizedHtml.includes('class="cf-turnstile"') ||
    normalizedHtml.includes('id="cf-turnstile"') ||
    /data-sitekey=["']0x4[a-zA-Z0-9_-]+["']/i.test(html)
  ) {
    const siteKeyMatch =
      html.match(/data-sitekey=["'](0x4[a-zA-Z0-9_-]+)["']/i) ||
      html.match(/sitekey:\s*["'](0x4[a-zA-Z0-9_-]+)["']/i) ||
      html.match(/["']sitekey["']\s*:\s*["']([^"']+)["']/i);
    const actionMatch = html.match(/data-action=["']([^"']+)["']/i);
    const dataMatch = html.match(/data-cdata=["']([^"']+)["']/i);

    return {
      isChallenge: true,
      type: 'cloudflare_turnstile',
      siteKey: siteKeyMatch ? siteKeyMatch[1] : undefined,
      action: actionMatch ? actionMatch[1] : undefined,
      data: dataMatch ? dataMatch[1] : undefined,
    };
  }

  // 2. Cloudflare DDoS / Browser Verification Under Attack Mode (403/503/429)
  if (statusCode === 403 || statusCode === 503 || statusCode === 429) {
    if (
      normalizedHtml.includes('checking your browser') ||
      normalizedHtml.includes('cf-browser-verification') ||
      normalizedHtml.includes('challenge-platform') ||
      normalizedHtml.includes('attention required! | cloudflare') ||
      normalizedHtml.includes('just a moment...') ||
      normalizedHtml.includes('ddos protection by cloudflare') ||
      normalizedHtml.includes('ray id:')
    ) {
      return {
        isChallenge: true,
        type: 'cloudflare_ddos',
      };
    }
  }

  // 3. Google reCAPTCHA v2 / v3
  if (
    normalizedHtml.includes('google.com/recaptcha') ||
    normalizedHtml.includes('recaptcha/api.js') ||
    normalizedHtml.includes('g-recaptcha')
  ) {
    const siteKeyMatch =
      html.match(/data-sitekey=["']([a-zA-Z0-9_-]{40})["']/i) ||
      html.match(/["']sitekey["']\s*:\s*["']([a-zA-Z0-9_-]{40})["']/i);
    return {
      isChallenge: true,
      type: 'recaptcha',
      siteKey: siteKeyMatch ? siteKeyMatch[1] : undefined,
    };
  }

  // 4. hCaptcha
  if (
    normalizedHtml.includes('hcaptcha.com/1/api.js') ||
    normalizedHtml.includes('h-captcha') ||
    normalizedHtml.includes('class="h-captcha"')
  ) {
    const siteKeyMatch =
      html.match(/data-sitekey=["']([a-f0-9-]{36})["']/i) ||
      html.match(/["']sitekey["']\s*:\s*["']([a-f0-9-]{36})["']/i);
    return {
      isChallenge: true,
      type: 'hcaptcha',
      siteKey: siteKeyMatch ? siteKeyMatch[1] : undefined,
    };
  }

  // 5. Hard IP Ban / Access Denied
  if (statusCode === 403) {
    if (
      normalizedHtml.includes('access denied') ||
      normalizedHtml.includes('ip has been banned') ||
      normalizedHtml.includes('403 forbidden')
    ) {
      return {
        isChallenge: true,
        type: 'ip_block',
      };
    }
  }

  return { isChallenge: false, type: 'none' };
}

/**
 * Solve Cloudflare / Turnstile challenges via a local or remote FlareSolverr proxy.
 * Uses persistent FlareSolverr sessions per domain to reuse active clearance cookies.
 */
export async function solveWithFlareSolverr(
  targetUrl: string,
  flareSolverrUrl: string = 'http://localhost:8191/v1',
  timeoutSeconds: number = 30,
  sourceKey?: string
): Promise<FlareSolverrResponse> {
  const startTime = Date.now();
  let origin = '';
  try { origin = new URL(targetUrl).origin; } catch { origin = targetUrl; }
  const domainKey = sourceKey || origin.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[^a-z0-9-_]/g, '_');

  try {
    const endpoint = flareSolverrUrl.replace(/\/+$/, '');

    // Attempt to acquire or reuse a FlareSolverr session
    const sessionId = await flareSolverrSessionPool.getOrCreateSession(
      endpoint,
      domainKey,
      Math.min(timeoutSeconds, 10)
    );

    const payload: Record<string, any> = {
      cmd: 'request.get',
      url: targetUrl,
      maxTimeout: timeoutSeconds * 1000,
    };
    if (sessionId) {
      payload.session = sessionId;
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout((timeoutSeconds + 5) * 1000),
    });

    const elapsed = Date.now() - startTime;

    if (!res.ok) {
      if (sessionId) flareSolverrSessionPool.recordSessionFailure(domainKey);
      return {
        ok: false,
        status: `HTTP_${res.status}`,
        responseTimeMs: elapsed,
        error: `FlareSolverr returned HTTP ${res.status}`,
      };
    }

    const data: any = await res.json();
    if (data.status === 'ok' && data.solution) {
      if (sessionId) flareSolverrSessionPool.recordSessionSuccess(domainKey);
      return {
        ok: true,
        status: 'ok',
        html: data.solution.response || '',
        cookies: (data.solution.cookies || []).map((c: any) => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
        })),
        userAgent: data.solution.userAgent,
        responseTimeMs: elapsed,
      };
    }

    if (sessionId) flareSolverrSessionPool.recordSessionFailure(domainKey);
    return {
      ok: false,
      status: data.status || 'error',
      message: data.message || 'FlareSolverr failed to solve challenge',
      responseTimeMs: elapsed,
      error: data.message || 'Unknown FlareSolverr error',
    };
  } catch (err: any) {
    if (domainKey) flareSolverrSessionPool.recordSessionFailure(domainKey);
    return {
      ok: false,
      status: 'connection_error',
      responseTimeMs: Date.now() - startTime,
      error: err.message || 'Could not connect to FlareSolverr endpoint',
    };
  }
}

/**
 * Solve Turnstile or Captcha via 2Captcha API.
 */
export async function solveWith2Captcha(
  apiKey: string,
  pageUrl: string,
  siteKey: string,
  type: 'turnstile' | 'recaptcha' | 'hcaptcha' = 'turnstile',
  action?: string,
  data?: string
): Promise<{ ok: boolean; token?: string; error?: string }> {
  try {
    let inUrl = `https://2captcha.com/in.php?key=${encodeURIComponent(apiKey)}&json=1&pageurl=${encodeURIComponent(pageUrl)}`;

    if (type === 'turnstile') {
      inUrl += `&method=turnstile&sitekey=${encodeURIComponent(siteKey)}`;
      if (action) inUrl += `&action=${encodeURIComponent(action)}`;
      if (data) inUrl += `&data=${encodeURIComponent(data)}`;
    } else if (type === 'hcaptcha') {
      inUrl += `&method=hcaptcha&sitekey=${encodeURIComponent(siteKey)}`;
    } else {
      inUrl += `&method=userrecaptcha&googlekey=${encodeURIComponent(siteKey)}`;
    }

    const inRes = await fetch(inUrl, { signal: AbortSignal.timeout(10000) });
    const inJson: any = await inRes.json();

    if (inJson.status !== 1 || !inJson.request) {
      return { ok: false, error: `2Captcha task creation error: ${inJson.request || 'Unknown error'}` };
    }

    const requestId = inJson.request;
    const maxAttempts = 24; // Up to ~48 seconds

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const resUrl = `https://2captcha.com/res.php?key=${encodeURIComponent(apiKey)}&action=get&id=${encodeURIComponent(requestId)}&json=1`;
      const resRes = await fetch(resUrl, { signal: AbortSignal.timeout(10000) });
      const resJson: any = await resRes.json();

      if (resJson.status === 1 && resJson.request) {
        return { ok: true, token: resJson.request };
      }
      if (resJson.request !== 'CAPCHA_NOT_READY') {
        return { ok: false, error: `2Captcha solving error: ${resJson.request}` };
      }
    }

    return { ok: false, error: '2Captcha solving timed out after 48s' };
  } catch (err: any) {
    return { ok: false, error: `2Captcha network error: ${err.message}` };
  }
}

/**
 * Check balance for 2Captcha or CapSolver.
 */
export async function checkSolverBalance(apiKey: string, provider: 'auto' | '2captcha' | 'capsolver' = 'auto'): Promise<SolverBalanceResult> {
  if (!apiKey || apiKey.trim().length < 8) {
    return { ok: false, provider: 'none', error: 'API key is missing or too short.' };
  }

  const cleanKey = apiKey.trim();

  // Try 2Captcha
  if (provider === 'auto' || provider === '2captcha') {
    try {
      const res = await fetch(`https://2captcha.com/res.php?key=${encodeURIComponent(cleanKey)}&action=getbalance&json=1`, {
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const json: any = await res.json();
        if (json.status === 1 && json.request !== undefined) {
          const bal = parseFloat(json.request);
          if (!isNaN(bal)) {
            return { ok: true, provider: '2Captcha', balance: bal, currency: 'USD' };
          }
        }
      }
    } catch (_) {}
  }

  // Try CapSolver
  if (provider === 'auto' || provider === 'capsolver') {
    try {
      const res = await fetch('https://api.capsolver.com/getBalance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientKey: cleanKey }),
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const json: any = await res.json();
        if (json.errorId === 0 && json.balance !== undefined) {
          return { ok: true, provider: 'CapSolver', balance: Number(json.balance), currency: 'USD' };
        }
      }
    } catch (_) {}
  }

  return {
    ok: false,
    provider: 'Unknown',
    error: 'Could not authenticate with 2Captcha or CapSolver using the provided API key.',
  };
}

/**
 * Perform a resilient fetch with automatic Cloudflare & Captcha challenge bypass:
 * 1. Fast-fails if circuit breaker is OPEN
 * 2. Direct stealth request with realistic browser profiles & client hints
 * 3. If challenged, automatically triggers persistent FlareSolverr session or 2Captcha/CapSolver
 * 4. Returns HTML with bypass metadata
 */
export async function fetchWithChallengeBypass(
  targetUrl: string,
  options: FetchBypassOptions = {}
): Promise<FetchBypassResult> {
  const origin = new URL(targetUrl).origin;
  const timeoutMs = options.timeoutMs || 20000;

  // Fast-fail if source circuit breaker is tripped OPEN
  if (options.sourceId && !sourceCircuitBreaker.canAttempt(options.sourceId)) {
    return {
      ok: false,
      status: 503,
      html: '',
      bypassed: false,
      error: `Circuit breaker is OPEN for source ${options.sourceId} (fast-fail)`,
    };
  }

  // Generate realistic browser headers matching modern Chrome / Safari / Firefox
  const browserHeaders = getBrowserHeaders(targetUrl, {
    sourceId: options.sourceId,
    customHeaders: options.headers,
  });

  // Step 1: Direct Stealth Fetch (redirect-safe SSRF guard on every hop)
  try {
    const directRes = await fetchWithSsrfGuard(targetUrl, {
      headers: browserHeaders,
      signal: AbortSignal.timeout(timeoutMs),
    });

    const htmlText = await directRes.text();
    const challenge = detectChallenge(htmlText, directRes.status);

    if (!challenge.isChallenge && directRes.ok) {
      if (options.sourceId) {
        challengeManager.resolveChallenge(options.sourceId);
        sourceCircuitBreaker.recordSuccess(options.sourceId);
      }
      return {
        ok: true,
        status: directRes.status,
        html: htmlText,
        bypassed: false,
        methodUsed: 'Direct Stealth Engine',
      };
    }

    // Step 2: Challenge detected! Attempt automated bypass if enabled
    if (challenge.isChallenge) {
      if (options.enableCloudflareBypass === false && !options.captchaSolverEnabled) {
        return {
          ok: false,
          status: directRes.status,
          html: '',
          bypassed: false,
          challengeDetected: true,
          challengeType: challenge.type,
          error: `Challenge ${challenge.type} detected and auto-bypass disabled for request`,
        };
      }

      console.warn(
        `[Challenge Solver] Source at ${origin} triggered ${challenge.type} challenge (HTTP ${directRes.status}). Attempting auto-bypass...`
      );

      // A. Try FlareSolverr (with persistent session pooling)
      if (options.enableCloudflareBypass !== false && options.flareSolverrUrl) {
        const solverResult = await solveWithFlareSolverr(
          targetUrl,
          options.flareSolverrUrl,
          Math.round(timeoutMs / 1000),
          options.sourceId
        );

        if (solverResult.ok && solverResult.html) {
          console.log(`[Challenge Solver] FlareSolverr successfully bypassed challenge for ${origin}!`);

          if (options.sourceId) {
            challengeManager.resolveChallenge(options.sourceId);
            sourceCircuitBreaker.recordSuccess(options.sourceId);
          }

          if (options.sourceId && options.onCookieUpdate && solverResult.cookies && solverResult.cookies.length > 0) {
            const cookieHeaders = solverResult.cookies.map((c) => `${c.name}=${c.value}`);
            options.onCookieUpdate(options.sourceId, cookieHeaders);
          }

          return {
            ok: true,
            status: 200,
            html: solverResult.html,
            bypassed: true,
            methodUsed: 'FlareSolverr Automated Bypass (Session)',
          };
        }
      }

      // B. Try 2Captcha if Turnstile siteKey found
      if (options.captchaSolverEnabled && options.captchaApiKey && challenge.siteKey) {
        console.log(`[Challenge Solver] Submitting Turnstile siteKey ${challenge.siteKey} to 2Captcha...`);
        const captchaResult = await solveWith2Captcha(
          options.captchaApiKey,
          targetUrl,
          challenge.siteKey,
          'turnstile',
          challenge.action,
          challenge.data
        );

        if (captchaResult.ok && captchaResult.token) {
          console.log(`[Challenge Solver] 2Captcha token received! Bypassed challenge.`);
          if (options.sourceId) {
            challengeManager.resolveChallenge(options.sourceId);
            sourceCircuitBreaker.recordSuccess(options.sourceId);
          }
          return {
            ok: true,
            status: 200,
            html: htmlText,
            bypassed: true,
            methodUsed: '2Captcha Automated Turnstile Solver',
          };
        }
      }

      // If challenge was not automatically bypassed, record for user notification & trip circuit if blocked
      const srcId = options.sourceId || origin.replace(/https?:\/\//, '').replace(/[^a-z0-9]/g, '');
      challengeManager.recordChallenge({
        sourceId: srcId,
        sourceUrl: origin,
        sampleUrl: targetUrl,
        challengeType: challenge.type as any,
        httpStatus: directRes.status,
        siteKey: challenge.siteKey,
      });

      if (options.sourceId && (challenge.type === 'ip_block' || challenge.type === 'cloudflare_ddos')) {
        sourceCircuitBreaker.trip(options.sourceId, `Blocked by ${challenge.type}`);
      }
    }

    return {
      ok: directRes.ok,
      status: directRes.status,
      html: htmlText,
      bypassed: false,
      methodUsed: 'Direct Stealth (Challenge Active)',
    };
  } catch (err: any) {
    // If direct fetch threw a network error, try FlareSolverr as backup
    if (options.enableCloudflareBypass !== false && options.flareSolverrUrl) {
      try {
        const solverResult = await solveWithFlareSolverr(
          targetUrl,
          options.flareSolverrUrl,
          Math.round(timeoutMs / 1000),
          options.sourceId
        );
        if (solverResult.ok && solverResult.html) {
          if (options.sourceId) {
            sourceCircuitBreaker.recordSuccess(options.sourceId);
          }
          return {
            ok: true,
            status: 200,
            html: solverResult.html,
            bypassed: true,
            methodUsed: 'FlareSolverr Fallback Bypass',
          };
        }
      } catch (_) {}
    }

    if (options.sourceId) {
      sourceCircuitBreaker.recordFailure(options.sourceId, 0, err?.message);
    }

    return {
      ok: false,
      status: 500,
      html: '',
      bypassed: false,
      error: err.message || 'Network fetch failed',
    };
  }
}
