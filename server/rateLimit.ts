import express from 'express';

// ==========================================
// DDOS PROTECTION & RATE LIMITING MIDDLEWARE (Bypassed for Host PC)
// ==========================================
export const ipRequestCounts = new Map<string, { count: number; resetTime: number }>();
export const ipProxyRequestCounts = new Map<string, { count: number; resetTime: number }>();
export const RATE_LIMIT_MAX = 300; // max 300 API requests per minute
export const RATE_LIMIT_PROXY_MAX = 2400; // image proxy: ~40 pages × retries
export const RATE_LIMIT_WINDOW = 60 * 1000;

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
}, 30_000);

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
