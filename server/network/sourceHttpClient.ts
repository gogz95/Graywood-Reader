// ============================================================================
// server/network/sourceHttpClient.ts — Unified Outbound Network Gateway
// Centralizes outbound external scraper and proxy requests with SSRF guards,
// deterministic domain-pinned User-Agents, circuit breaking, and trace logging.
// ============================================================================

import { fetchWithSsrfGuard } from '../security';
import { sourceCircuitBreaker } from '../circuitBreaker';
import { isSourceUrlOrNameDisabled } from '../sources/sourcesCatalog';
import { recordTrace } from '../diagnostics/traceBuffer';
import { getBrowserHeaders } from '../userAgentPool';

export interface SourceFetchOptions extends RequestInit {
  sourceId?: string;
  sourceName?: string;
  domain?: string;
  timeoutMs?: number;
  skipCircuitBreaker?: boolean;
  isImage?: boolean;
  stage?: 'HTTP_FETCH' | 'IMAGE_PROXY';
}

/**
 * Extract a clean hostname domain string from any URL or domain seed.
 */
export function extractDomainFromUrl(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return String(rawUrl || '').toLowerCase();
  }
}

/**
 * Execute an external HTTP fetch through the centralized network gateway.
 */
export async function sourceFetch(
  url: string,
  options: SourceFetchOptions = {}
): Promise<globalThis.Response> {
  const domain = options.domain || extractDomainFromUrl(url);
  const sourceId = options.sourceId || domain;
  const stage = options.stage || (options.isImage ? 'IMAGE_PROXY' : 'HTTP_FETCH');

  // 1. Check if the source is disabled, dead, or blocked by ID/URL
  if (isSourceUrlOrNameDisabled(options.sourceName, url, sourceId)) {
    recordTrace({
      domain,
      sourceId,
      stage,
      status: 'error',
      statusCode: 403,
      durationMs: 0,
      message: `Source "${sourceId}" is disabled or flagged as dead.`,
    });
    throw new Error(`Source "${sourceId}" is flagged as disabled or dead.`);
  }

  // 2. Check source circuit breaker status
  if (!options.skipCircuitBreaker && !sourceCircuitBreaker.canAttempt(sourceId)) {
    recordTrace({
      domain,
      sourceId,
      stage,
      status: 'error',
      statusCode: 503,
      durationMs: 0,
      message: `Circuit OPEN for source "${sourceId}".`,
    });
    throw new Error(`Circuit OPEN for source "${sourceId}". Rapidly fast-failing outbound request.`);
  }

  // 3. Pin deterministic browser headers per domain to preserve CF session integrity
  const pinnedHeaders = getBrowserHeaders(url, {
    sourceId,
    isImage: options.isImage,
    rotate: false,
    customHeaders: options.headers as Record<string, string>,
  });

  const timeoutMs = options.timeoutMs ?? 12000;
  const signal = options.signal || AbortSignal.timeout(timeoutMs);

  const start = Date.now();
  try {
    const res = await fetchWithSsrfGuard(url, {
      ...options,
      headers: pinnedHeaders,
      signal,
    });

    const durationMs = Date.now() - start;

    if (res.ok) {
      sourceCircuitBreaker.recordSuccess(sourceId);
      recordTrace({
        domain,
        sourceId,
        stage,
        status: 'ok',
        statusCode: res.status,
        durationMs,
      });
    } else {
      sourceCircuitBreaker.recordFailure(sourceId, res.status);
      recordTrace({
        domain,
        sourceId,
        stage,
        status: res.status >= 500 || res.status === 403 ? 'error' : 'warn',
        statusCode: res.status,
        durationMs,
        message: `HTTP ${res.status} ${res.statusText}`,
      });
    }

    return res;
  } catch (err: any) {
    const durationMs = Date.now() - start;
    sourceCircuitBreaker.recordFailure(sourceId, 0, err?.message);
    recordTrace({
      domain,
      sourceId,
      stage,
      status: 'error',
      statusCode: 0,
      durationMs,
      message: err?.message || String(err),
    });
    throw err;
  }
}
