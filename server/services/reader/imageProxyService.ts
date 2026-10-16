// ============================================================================
// server/services/reader/imageProxyService.ts — Image Proxy & Caching Service
// Proxies chapter panels and series covers with memory LRU / SQLite caching,
// negative failure circuit breaker, SSRF guard, and image optimization.
// ============================================================================

import { Request, Response } from 'express';
import { assertSafeProxyTarget, MAX_PROXY_IMAGE_BYTES, fetchWithSsrfGuard } from '../../security';
import { imageCacheService } from '../imageCache';
import { parseOptimizationParams, optimizeImageBuffer } from '../imageOptimizer';
import { recordTrace } from '../../diagnostics/traceBuffer';
import { extractDomainFromUrl } from '../../network/sourceHttpClient';
import { isNsfwAccessAllowed } from '../../appState';
import { isNsfwManga } from '../../../src/types';
import { resolveMangaEntity } from './pageResolverService';

// Negative cache for proxy images that returned 404/410/failed upstream (TTL: 10 minutes)
export const MAX_NEGATIVE_PROXY_CACHE_SIZE = 2000;
export const negativeProxyCache = new Map<string, number>();

export function pruneNegativeProxyCache(): void {
  const now = Date.now();
  if (negativeProxyCache.size > MAX_NEGATIVE_PROXY_CACHE_SIZE) {
    negativeProxyCache.clear();
    return;
  }
  for (const [url, expiry] of negativeProxyCache) {
    if (now >= expiry) negativeProxyCache.delete(url);
  }
}

export function recordNegativeProxyFailure(url: string, ttlMs: number = 10 * 60 * 1000): void {
  pruneNegativeProxyCache();
  negativeProxyCache.set(url, Date.now() + ttlMs);
}

export function clearNegativeProxyCache(): void {
  negativeProxyCache.clear();
}

/**
 * Express route handler for `/api/reader/proxy-image`, `/api/proxy/image`, and `/api/mangadex/image-proxy`.
 */
export async function handleImageProxyRequest(req: Request, res: Response): Promise<void> {
  let targetUrl = (req.query.url as string) || '';
  const sourceUrl = (req.query.sourceUrl as string) || '';
  const pageUrl = (req.query.pageUrl as string) || '';
  const mangaId = (req.query.mangaId as string) || (req.query.id as string) || '';

  if (mangaId) {
    const proxyManga = resolveMangaEntity(mangaId);
    if (proxyManga && (proxyManga.isNsfw || isNsfwManga(proxyManga)) && !isNsfwAccessAllowed(req)) {
      res.status(403).json({
        error: 'Forbidden',
        code: 'NSFW_RESTRICTED',
        message: '18+ Adult content is restricted. Please sign in to access explicit image streams.',
        isNsfwRestricted: true,
      });
      return;
    }
  }

  if (!targetUrl) {
    res.status(400).json({ error: "Missing required 'url' parameter" });
    return;
  }

  // Prevent infinite recursive self-proxy loops
  while (
    targetUrl &&
    (targetUrl.includes('/api/mangadex/image-proxy?url=') ||
      targetUrl.includes('/api/reader/proxy-image?url=') ||
      targetUrl.includes('/api/proxy/image?url='))
  ) {
    const match = targetUrl.match(/[?&]url=([^&]+)/);
    if (match && match[1]) {
      try {
        targetUrl = decodeURIComponent(match[1]);
      } catch {
        break;
      }
    } else {
      break;
    }
  }

  if (targetUrl.startsWith('/api/reader/panel-image')) {
    res.redirect(targetUrl);
    return;
  }

  if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
    res.status(400).json({ error: 'Proxy target must be an absolute http(s) URL' });
    return;
  }

  pruneNegativeProxyCache();
  const cachedFailureExpiry = negativeProxyCache.get(targetUrl);
  if (cachedFailureExpiry && Date.now() < cachedFailureExpiry) {
    res.setHeader('Cache-Control', 'public, max-age=600, stale-if-error=300');
    res.status(502).json({ error: 'Failed to fetch image from remote host (cached failure)' });
    return;
  }

  try {
    await assertSafeProxyTarget(targetUrl);
  } catch (err: any) {
    console.warn(`[ImageProxyService] Blocked unsafe proxy target: ${err?.message || err}`);
    res.status(403).json({ error: 'Blocked proxy target', message: String(err?.message || err) });
    return;
  }

  if (imageCacheService.matchesEtag(targetUrl, req.headers['if-none-match'] as string)) {
    res.status(304).end();
    return;
  }

  const isCover =
    req.query.type === 'cover' ||
    req.query.isCover === 'true' ||
    req.query.cover === '1' ||
    req.path.includes('/cover') ||
    targetUrl.includes('/covers/') ||
    /\/covers?(\/|[._-])/i.test(targetUrl);

  const domain = extractDomainFromUrl(targetUrl);

  try {
    const cached = await imageCacheService.fetchCoalesced(
      targetUrl,
      async () => {
        let referer: string;
        if (pageUrl) {
          referer = pageUrl;
        } else if (targetUrl.includes('mangadex.org') || targetUrl.includes('uploads.mangadex.org')) {
          referer = 'https://mangadex.org/';
        } else if (targetUrl.includes('pornwa') || targetUrl.includes('manhwa18')) {
          referer = 'https://manhwa18.com/';
        } else if (sourceUrl) {
          try {
            referer = new URL(sourceUrl).origin + '/';
          } catch {
            referer = 'https://mangadex.org/';
          }
        } else {
          try {
            referer = new URL(targetUrl).origin + '/';
          } catch {
            referer = 'https://mangadex.org/';
          }
        }

        const start = Date.now();
        let response: globalThis.Response;
        try {
          response = await fetchWithSsrfGuard(targetUrl, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
              Referer: referer,
              Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            },
            signal: AbortSignal.timeout(12000),
          });
        } catch (fetchErr: any) {
          recordNegativeProxyFailure(targetUrl);
          recordTrace({
            domain,
            sourceId: mangaId || domain,
            stage: 'IMAGE_PROXY',
            status: 'error',
            statusCode: 0,
            durationMs: Date.now() - start,
            message: fetchErr?.message || String(fetchErr),
          });
          console.warn(`[ImageProxyService] Upstream network/socket failure for ${targetUrl}:`, fetchErr?.message || fetchErr);
          return null;
        }

        if (!response.ok) {
          recordNegativeProxyFailure(targetUrl);
          recordTrace({
            domain,
            sourceId: mangaId || domain,
            stage: 'IMAGE_PROXY',
            status: 'warn',
            statusCode: response.status,
            durationMs: Date.now() - start,
            message: `Remote host returned HTTP ${response.status}`,
          });
          console.warn(`[ImageProxyService] Host returned HTTP ${response.status} for ${targetUrl}`);
          return null;
        }

        const arrayBuf = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);
        if (buffer.length > MAX_PROXY_IMAGE_BYTES) {
          throw new Error('Proxied image exceeds size cap');
        }

        const contentType = response.headers.get('content-type') || 'image/jpeg';

        recordTrace({
          domain,
          sourceId: mangaId || domain,
          stage: 'IMAGE_PROXY',
          status: 'ok',
          statusCode: 200,
          durationMs: Date.now() - start,
        });

        return { buffer, contentType };
      },
      isCover
    );

    if (!cached) {
      recordNegativeProxyFailure(targetUrl);
      res.setHeader('Cache-Control', 'public, max-age=600, stale-if-error=300');
      res.status(502).json({ error: 'Failed to fetch image from remote host' });
      return;
    }

    if (req.headers['if-none-match'] === cached.etag) {
      res.status(304).end();
      return;
    }

    const optParams = parseOptimizationParams(req);
    const optimized = await optimizeImageBuffer(cached.buffer, cached.contentType, optParams);

    res.setHeader('Content-Type', optimized.contentType);
    res.setHeader('ETag', cached.etag);
    if (cached.isCover || isCover) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    }
    res.setHeader('Content-Disposition', 'inline');
    res.end(optimized.buffer);
  } catch (err: any) {
    recordNegativeProxyFailure(targetUrl);
    console.warn(`[ImageProxyService] Error proxying image (${targetUrl}):`, err?.message || err);
    if (!res.headersSent) {
      res.setHeader('Cache-Control', 'public, max-age=600, stale-if-error=300');
      res.status(502).json({ error: 'Error proxying target image', message: err?.message || String(err) });
    } else {
      res.end();
    }
  }
}
