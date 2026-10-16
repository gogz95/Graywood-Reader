// ============================================================================
// server/diagnostics/traceBuffer.ts — In-Memory Diagnostic Ring Buffer
// Centralized diagnostic tracing for scraping, CF challenges, and fallbacks.
// ============================================================================

export interface DiagnosticTrace {
  id: string;
  timestamp: number;
  domain: string;
  sourceId: string;
  stage: 'HTTP_FETCH' | 'CF_CHALLENGE' | 'HTML_PARSE' | 'MIRROR_FALLBACK' | 'IMAGE_PROXY';
  status: 'ok' | 'warn' | 'error';
  statusCode?: number;
  durationMs: number;
  message?: string;
}

export const MAX_TRACES = 250;
const ringBuffer: DiagnosticTrace[] = [];
let traceCounter = 0;

/**
 * Record a structured diagnostic trace event into the in-memory ring buffer.
 */
export function recordTrace(entry: Omit<DiagnosticTrace, 'id' | 'timestamp'>): DiagnosticTrace {
  const trace: DiagnosticTrace = {
    id: `tr_${Date.now()}_${++traceCounter}`,
    timestamp: Date.now(),
    ...entry,
  };

  ringBuffer.push(trace);
  if (ringBuffer.length > MAX_TRACES) {
    ringBuffer.shift();
  }
  return trace;
}

/**
 * Retrieve recent diagnostic trace events with optional filtering.
 */
export function getRecentTraces(filter?: {
  domain?: string;
  sourceId?: string;
  stage?: string;
  status?: string;
  limit?: number;
}): DiagnosticTrace[] {
  let list = [...ringBuffer].reverse();
  if (!filter) return list;

  if (filter.domain) {
    const d = filter.domain.toLowerCase();
    list = list.filter((t) => t.domain.toLowerCase().includes(d));
  }
  if (filter.sourceId) {
    const s = filter.sourceId.toLowerCase();
    list = list.filter((t) => t.sourceId.toLowerCase() === s);
  }
  if (filter.stage) {
    list = list.filter((t) => t.stage === filter.stage);
  }
  if (filter.status) {
    list = list.filter((t) => t.status === filter.status);
  }
  const limit = Math.min(Math.max(1, filter.limit || 50), MAX_TRACES);
  return list.slice(0, limit);
}

/**
 * Clear the diagnostic trace ring buffer.
 */
export function clearTraces(): void {
  ringBuffer.length = 0;
}

/**
 * Get summary counters across all traces currently in the buffer.
 */
export function getTraceSummary(): {
  total: number;
  errors: number;
  warnings: number;
  byStage: Record<string, number>;
  byStatus: Record<string, number>;
} {
  const summary = {
    total: ringBuffer.length,
    errors: 0,
    warnings: 0,
    byStage: {} as Record<string, number>,
    byStatus: {} as Record<string, number>,
  };

  for (const t of ringBuffer) {
    if (t.status === 'error') summary.errors++;
    if (t.status === 'warn') summary.warnings++;
    summary.byStage[t.stage] = (summary.byStage[t.stage] || 0) + 1;
    summary.byStatus[t.status] = (summary.byStatus[t.status] || 0) + 1;
  }

  return summary;
}
