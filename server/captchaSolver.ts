import { URL } from 'url';
import { fetchWithSsrfGuard } from './security';

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
 */
export async function solveWithFlareSolverr(
  targetUrl: string,
  flareSolverrUrl: string = 'http://localhost:8191/v1',
  timeoutSeconds: number = 30
): Promise<FlareSolverrResponse> {
  const startTime = Date.now();
  try {
    const endpoint = flareSolverrUrl.replace(/\/+$/, '');
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cmd: 'request.get',
        url: targetUrl,
        maxTimeout: timeoutSeconds * 1000,
      }),
      signal: AbortSignal.timeout((timeoutSeconds + 5) * 1000),
    });

    const elapsed = Date.now() - startTime;

    if (!res.ok) {
      return {
        ok: false,
        status: `HTTP_${res.status}`,
        responseTimeMs: elapsed,
        error: `FlareSolverr returned HTTP ${res.status}`,
      };
    }

    const data: any = await res.json();
    if (data.status === 'ok' && data.solution) {
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

    return {
      ok: false,
      status: data.status || 'error',
      message: data.message || 'FlareSolverr failed to solve challenge',
      responseTimeMs: elapsed,
      error: data.message || 'Unknown FlareSolverr error',
    };
  } catch (err: any) {
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
 * 1. Direct stealth request
 * 2. If challenged, automatically triggers FlareSolverr or 2Captcha/CapSolver
 * 3. Returns HTML with bypass metadata
 */
export async function fetchWithChallengeBypass(
  targetUrl: string,
  options: FetchBypassOptions = {}
): Promise<FetchBypassResult> {
  const origin = new URL(targetUrl).origin;
  const timeoutMs = options.timeoutMs || 20000;

  const defaultHeaders: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    Referer: origin + '/',
    ...(options.headers || {}),
  };

  // Step 1: Direct Stealth Fetch (redirect-safe SSRF guard on every hop)
  try {
    const directRes = await fetchWithSsrfGuard(targetUrl, {
      headers: defaultHeaders,
      signal: AbortSignal.timeout(timeoutMs),
    });

    const htmlText = await directRes.text();
    const challenge = detectChallenge(htmlText, directRes.status);

    if (!challenge.isChallenge && directRes.ok) {
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
      console.warn(
        `[Challenge Solver] Source at ${origin} triggered ${challenge.type} challenge (HTTP ${directRes.status}). Attempting auto-bypass...`
      );

      // A. Try FlareSolverr
      if (options.enableCloudflareBypass !== false && options.flareSolverrUrl) {
        const solverResult = await solveWithFlareSolverr(
          targetUrl,
          options.flareSolverrUrl,
          Math.round(timeoutMs / 1000)
        );

        if (solverResult.ok && solverResult.html) {
          console.log(`[Challenge Solver] FlareSolverr successfully bypassed challenge for ${origin}!`);

          if (options.sourceId && options.onCookieUpdate && solverResult.cookies && solverResult.cookies.length > 0) {
            const cookieHeaders = solverResult.cookies.map((c) => `${c.name}=${c.value}`);
            options.onCookieUpdate(options.sourceId, cookieHeaders);
          }

          return {
            ok: true,
            status: 200,
            html: solverResult.html,
            bypassed: true,
            methodUsed: 'FlareSolverr Automated Bypass',
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
          return {
            ok: true,
            status: 200,
            html: htmlText,
            bypassed: true,
            methodUsed: '2Captcha Automated Turnstile Solver',
          };
        }
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
          Math.round(timeoutMs / 1000)
        );
        if (solverResult.ok && solverResult.html) {
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

    return {
      ok: false,
      status: 500,
      html: '',
      bypassed: false,
      error: err.message || 'Network fetch failed',
    };
  }
}
