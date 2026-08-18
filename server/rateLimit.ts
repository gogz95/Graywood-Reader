import express from 'express';

// ==========================================
// DDOS PROTECTION & RATE LIMITING MIDDLEWARE (Bypassed for Host PC)
// ==========================================
export const ipRequestCounts = new Map<string, { count: number; resetTime: number }>();
export const ipProxyRequestCounts = new Map<string, { count: number; resetTime: number }>();
export const RATE_LIMIT_MAX = 300; // max 300 API requests per minute
export const RATE_LIMIT_PROXY_MAX = 2400; // image proxy: ~40 pages × retries
export const RATE_LIMIT_WINDOW = 60 * 1000;

// ==========================================
// LOGIN BRUTE-FORCE RATE LIMITING
// ==========================================
// Tracks failed login attempts per IP. After MAX_LOGIN_FAILURES failures
// within LOGIN_FAILURE_WINDOW_MS, further login attempts are blocked until
// LOGIN_BLOCK_DURATION_MS expires. Successful login clears the counter.
const MAX_LOGIN_FAILURES = 5;               // block after 5 failures
const LOGIN_FAILURE_WINDOW_MS = 15 * 60_000; // 15-minute sliding window
const LOGIN_BLOCK_DURATION_MS = 30 * 60_000; // 30-minute block after breach
const loginFailures = new Map<string, { count: number; firstFailure: number; blockedUntil: number | null }>();

export function isImageProxyPath(p: string): boolean {
  return (
    p === '/api/reader/proxy-image' ||
    p === '/api/proxy/image' ||
    p === '/api/mangadex/image-proxy' ||
    p.startsWith('/api/reader/proxy-image') ||
    p.startsWith('/api/proxy/image')
  );
}

// Periodic cleanup of expired IP request entries to prevent unbounded memory growth.
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of ipRequestCounts) {
    if (now > record.resetTime) ipRequestCounts.delete(ip);
  }
  for (const [ip, record] of ipProxyRequestCounts) {
    if (now > record.resetTime) ipProxyRequestCounts.delete(ip);
  }
  // Cleanup stale login failure records
  for (const [ip, fail] of loginFailures) {
    if (fail.blockedUntil && now > fail.blockedUntil) {
      loginFailures.delete(ip);
    } else if (!fail.blockedUntil && now - fail.firstFailure > LOGIN_FAILURE_WINDOW_MS) {
      loginFailures.delete(ip);
    }
  }
}, 30_000);

/**
 * Check whether a login attempt from the given IP should be blocked.
 * Returns null if allowed, or an error response message if blocked.
 */
export function checkLoginRateLimit(ip: string): { blocked: true; message: string; retryAfterSeconds: number } | null {
  const now = Date.now();
  const record = loginFailures.get(ip);

  if (!record) return null;

  // Check if the IP is currently in a block period
  if (record.blockedUntil && now < record.blockedUntil) {
    const retryAfter = Math.ceil((record.blockedUntil - now) / 1000);
    return {
      blocked: true,
      message: `Too many failed login attempts. Please try again in ${retryAfter} seconds.`,
      retryAfterSeconds: retryAfter,
    };
  }

  // Expired block — clear it
  if (record.blockedUntil && now >= record.blockedUntil) {
    loginFailures.delete(ip);
    return null;
  }

  // Stale failure window — reset
  if (now - record.firstFailure > LOGIN_FAILURE_WINDOW_MS) {
    loginFailures.delete(ip);
    return null;
  }

  // Still within the failure window and count >= max — apply block
  if (record.count >= MAX_LOGIN_FAILURES) {
    record.blockedUntil = now + LOGIN_BLOCK_DURATION_MS;
    return {
      blocked: true,
      message: `Too many failed login attempts. Account temporarily locked for ${LOGIN_BLOCK_DURATION_MS / 60_000} minutes.`,
      retryAfterSeconds: Math.ceil(LOGIN_BLOCK_DURATION_MS / 1000),
    };
  }

  // Still has attempts remaining
  return null;
}

/** Record a failed login attempt for the given IP. */
export function recordLoginFailure(ip: string): void {
  const now = Date.now();
  const record = loginFailures.get(ip);

  if (!record || now - record.firstFailure > LOGIN_FAILURE_WINDOW_MS) {
    loginFailures.set(ip, { count: 1, firstFailure: now, blockedUntil: null });
  } else {
    record.count++;
    if (record.count >= MAX_LOGIN_FAILURES) {
      record.blockedUntil = now + LOGIN_BLOCK_DURATION_MS;
      console.warn(`[Login Rate Limiter] IP ${ip} blocked after ${record.count} failed attempts (${LOGIN_BLOCK_DURATION_MS / 60_000}m block).`);
    }
  }
}

/** Clear login failure records for the given IP (e.g. on successful login). */
export function clearLoginFailures(ip: string): void {
  loginFailures.delete(ip);
}

export function rateLimitMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  // Allow all requests on localhost or host IP
  const clientIp = req.ip || req.socket?.remoteAddress || '127.0.0.1';
  if (clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === '::ffff:127.0.0.1') {
    return next();
  }

  const now = Date.now();
  const proxy = isImageProxyPath(req.path);
  const bucket = proxy ? ipProxyRequestCounts : ipRequestCounts;
  const max = proxy ? RATE_LIMIT_PROXY_MAX : RATE_LIMIT_MAX;
  const record = bucket.get(clientIp);

  if (!record || now > record.resetTime) {
    bucket.set(clientIp, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
  } else {
    record.count++;
    if (record.count > max) {
      return res.status(429).json({
        error: 'Too Many Requests',
        message: proxy
          ? 'Image proxy rate limit exceeded. Please wait a moment before continuing.'
          : 'DDoS Protection triggered: Rate limit exceeded. Please wait 60 seconds before retrying.',
      });
    }
  }
  next();
}

