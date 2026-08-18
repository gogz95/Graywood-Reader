import fs from 'fs';
import path from 'path';

// ============================================================================
// STRUCTURED LOGGER WITH CONSOLE + DAILY-ROTATING FILE OUTPUT
// ============================================================================
// Replaces scattered console.log/warn/error calls across the server with a
// unified logger that writes timestamped, leveled entries to both console
// (stdout/stderr) and date-stamped log files under data/logs/.
// Log files rotate daily; old files accumulate until manually pruned or the
// cleaner removes anything older than 7 days on startup.
// ============================================================================

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

const LEVEL_LABELS: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.ERROR]: 'ERROR',
};

const LOGS_DIR = path.join(process.cwd(), 'data', 'logs');
const MAX_LOG_AGE_DAYS = 7;
const FLUSH_INTERVAL_MS = 5_000;

// The current date-based log filename (recomputed on each write so a date
// rollover automatically starts a new file).
function todayLogPath(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return path.join(LOGS_DIR, `server-${yyyy}-${mm}-${dd}.log`);
}

// In-memory write buffer to batch disk flushes (avoids per-line fsync).
let writeBuffer: string[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;

function ensureLogsDir(): void {
  try {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  } catch {
    // If we can't create the log directory, log to console only.
  }
}

function flushBuffer(): void {
  if (writeBuffer.length === 0) return;
  const batch = writeBuffer.join('');
  writeBuffer = [];
  try {
    ensureLogsDir();
    fs.appendFileSync(todayLogPath(), batch, 'utf8');
  } catch {
    // Disk write failed — already logged to console, so this is best-effort.
  }
}

// Start periodic flush. Called once at module load.
function startFlushTimer(): void {
  if (flushTimer) return;
  flushTimer = setInterval(flushBuffer, FLUSH_INTERVAL_MS);
  // Prevent the timer from keeping the process alive indefinitely.
  if (flushTimer && typeof flushTimer.unref === 'function') {
    flushTimer.unref();
  }
}

// Clean logs older than MAX_LOG_AGE_DAYS on startup (non-blocking).
function cleanOldLogs(): void {
  try {
    ensureLogsDir();
    const files = fs.readdirSync(LOGS_DIR);
    const cutoff = Date.now() - MAX_LOG_AGE_DAYS * 24 * 60 * 60 * 1000;
    for (const f of files) {
      if (!f.startsWith('server-') || !f.endsWith('.log')) continue;
      const fp = path.join(LOGS_DIR, f);
      try {
        const stat = fs.statSync(fp);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(fp);
        }
      } catch {
        // Stale/corrupt file — ignore.
      }
    }
  } catch {
    // Directory doesn't exist yet or is unreadable — fine.
  }
}

startFlushTimer();
cleanOldLogs();

function formatLogLine(level: LogLevel, context: string, message: string, meta?: Record<string, unknown>): string {
  const ts = new Date().toISOString();
  const metaStr = meta && Object.keys(meta).length > 0 ? ' ' + JSON.stringify(meta) : '';
  return `[${ts}] [${LEVEL_LABELS[level]}] [${context}] ${message}${metaStr}\n`;
}

function write(level: LogLevel, context: string, message: string, meta?: Record<string, unknown>): void {
  const line = formatLogLine(level, context, message, meta);

  // Console output
  switch (level) {
    case LogLevel.ERROR:
      process.stderr.write(line);
      break;
    case LogLevel.WARN:
      process.stderr.write(line);
      break;
    default:
      process.stdout.write(line);
  }

  // File output (batched)
  writeBuffer.push(line);
}

// ============================================================================
// PUBLIC LOGGER API
// ============================================================================

export const logger = {
  debug(context: string, message: string, meta?: Record<string, unknown>) {
    if (process.env.LOG_LEVEL === 'debug') {
      write(LogLevel.DEBUG, context, message, meta);
    }
  },

  info(context: string, message: string, meta?: Record<string, unknown>) {
    write(LogLevel.INFO, context, message, meta);
  },

  warn(context: string, message: string, meta?: Record<string, unknown>) {
    write(LogLevel.WARN, context, message, meta);
  },

  error(context: string, message: string, meta?: Record<string, unknown>) {
    write(LogLevel.ERROR, context, message, meta);
  },

  /**
   * Force-flush outstanding buffered log lines to disk.
   * Call this on graceful shutdown to ensure no logs are lost.
   */
  flush() {
    flushBuffer();
  },
};

/**
 * Simple access-log middleware for Express. Logs every completed request with
 * method, URL, status code, response time, and resolved user (if any).
 */
import type express from 'express';
export function requestLoggerMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  const start = Date.now();
  const originalEnd = res.end.bind(res);

  res.end = function (...args: any[]): any {
    const elapsed = Date.now() - start;
    const userId = (req as any).user?.id || (req as any).user?.username || '-';
    const msg = `${req.method} ${req.originalUrl || req.url} ${res.statusCode} ${elapsed}ms`;
    const meta = { method: req.method, url: req.originalUrl || req.url, status: res.statusCode, durationMs: elapsed, userId };
    if (res.statusCode >= 500) {
      logger.error('HTTP', msg, meta);
    } else if (res.statusCode >= 400) {
      logger.warn('HTTP', msg, meta);
    } else {
      logger.info('HTTP', msg, meta);
    }
    return originalEnd(...args);
  } as any;

  next();
}
