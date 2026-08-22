import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dns from 'dns';
import net from 'net';
import express from 'express';
import { Agent } from 'undici';
import { UserProfile } from '../src/types';
import { SqliteDb } from '../sqlite-db';

declare global {
  namespace Express {
    interface Request {
      user?: UserProfile | { sub: string; role?: string; email?: string; [key: string]: any };
    }
  }
}

// =========================================================
// GDPR ARTICLE 32 CRYPTOGRAPHIC ENCRYPTION & SECURITY ENGINE
// =========================================================
// Secret resolution order:
//   1. ENCRYPTION_SECRET environment variable (recommended for production)
//   2. data/.encryption-secret file (auto-generated, never committed to git)
export function resolveEncryptionSecret(): string {
  if (process.env.ENCRYPTION_SECRET && process.env.ENCRYPTION_SECRET.trim()) {
    return process.env.ENCRYPTION_SECRET.trim();
  }
  const secretPath = path.join(process.cwd(), 'data', '.encryption-secret');
  // A known, published legacy default was previously auto-seeded. If it is
  // still present, warn loudly so operators rotate it — but never reuse it for
  // new installs (it would let anyone decrypt PII / forge auth tokens).
  const LEGACY_DEFAULT = 'graywood-reader-gdpr-aes256-secret-key-32b!';
  try {
    if (fs.existsSync(secretPath)) {
      const existing = fs.readFileSync(secretPath, 'utf8').trim();
      if (existing) {
        if (existing === LEGACY_DEFAULT) {
          console.warn('[Security Engine] data/.encryption-secret contains the legacy default key. Rotate it now: set a strong ENCRYPTION_SECRET (>= 32 chars) and restart. Existing encrypted PII will need re-encryption.');
        }
        return existing;
      }
    }
  } catch (err) {
    console.error('[Security Engine] Failed to read secret file:', err);
  }
  // First run: generate a strong random secret — never a predictable default.
  const generated =
    crypto.randomBytes(48).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 48) +
    crypto.randomBytes(4).toString('hex');
  try {
    fs.mkdirSync(path.dirname(secretPath), { recursive: true });
    fs.writeFileSync(secretPath, generated + '\n', { mode: 0o600 });
    console.warn('[Security Engine] Generated a fresh random encryption secret at data/.encryption-secret (mode 0600). Set ENCRYPTION_SECRET in your environment to pin it explicitly.');
  } catch (err) {
    console.error('[Security Engine] Failed to persist generated secret file:', err);
  }
  return generated;
}

export const ENCRYPTION_SECRET = resolveEncryptionSecret();
const ALGORITHM = 'aes-256-gcm';

// Cryptographically sound 32-byte key derived via HKDF (RFC 5869)
const PII_ENCRYPTION_KEY = crypto.hkdfSync('sha256', ENCRYPTION_SECRET, '', 'graywood-gdpr-aes256-key', 32);
const LEGACY_PII_KEY = Buffer.from(ENCRYPTION_SECRET.padEnd(32).slice(0, 32));

export function encryptPII(text: string): string {
  if (!text) return '';
  try {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(PII_ENCRYPTION_KEY), iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `enc:${iv.toString('hex')}:${authTag}:${encrypted}`;
  } catch (err: any) {
    console.error('[GDPR Engine] Encryption error:', err);
    throw new Error(`GDPR Encryption failed: ${err?.message || 'Cipher error'}`);
  }
}

export function decryptPII(encryptedData: string): string {
  if (!encryptedData || !encryptedData.startsWith('enc:')) return encryptedData;
  const parts = encryptedData.slice(4).split(':');
  if (parts.length !== 3) return encryptedData;
  const [ivHex, authTagHex, encryptedText] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  // 1. Try decrypting with the HKDF-derived key
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(PII_ENCRYPTION_KEY), iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    // 2. Fall back to legacy padEnd/slice key for backward compatibility
    try {
      const legacyDecipher = crypto.createDecipheriv(ALGORITHM, LEGACY_PII_KEY, iv);
      legacyDecipher.setAuthTag(authTag);
      let decrypted = legacyDecipher.update(encryptedText, 'hex', 'utf8');
      decrypted += legacyDecipher.final('utf8');
      return decrypted;
    } catch {
      return encryptedData;
    }
  }
}

// Password hashing uses salted scrypt (memory-hard KDF). Legacy unsalted
// SHA-256 hashes are still accepted for verification for backward compatibility.
export function hashPassword(password: string): string {
  if (!password) return '';
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function isAlreadyHashed(value: string): boolean {
  return (
    value.startsWith('scrypt:') ||
    value.startsWith('enc:') ||
    /^[a-f0-9]{64}$/i.test(value) // legacy SHA-256 hex digest
  );
}

export function verifyPassword(password: string, stored: string): boolean {
  if (!password || !stored) return false;
  try {
    if (stored.startsWith('scrypt:')) {
      const [, salt, hash] = stored.split(':');
      if (!salt || !hash) return false;
      const check = crypto.scryptSync(password, salt, 64).toString('hex');
      return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
    }
    // Legacy SHA-256 fallback
    return stored === crypto.createHash('sha256').update(password + ENCRYPTION_SECRET).digest('hex');
  } catch {
    return false;
  }
}

export function verifyPasswordAsync(password: string, stored: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!password || !stored) return resolve(false);
    if (stored.startsWith('scrypt:')) {
      const [, salt, hash] = stored.split(':');
      if (!salt || !hash) return resolve(false);
      return crypto.scrypt(password, salt, 64, (err, derived) => {
        if (err) return resolve(false);
        return resolve(crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(derived)));
      });
    }
    // Legacy SHA-256 fallback (no KDF, so resolve synchronously-safe).
    return resolve(stored === crypto.createHash('sha256').update(password + ENCRYPTION_SECRET).digest('hex'));
  });
}

// =========================================================
// TOKEN-BASED AUTHENTICATION (opt-in, backward compatible)
// =========================================================
export const AUTH_ENABLED = process.env.REQUIRE_AUTH === '1' || process.env.REQUIRE_AUTH === 'true';
export const AUTH_TOKEN_TTL_MS = Number(process.env.AUTH_TOKEN_TTL_MS) || 7 * 24 * 60 * 60 * 1000; // default 7 days

export const AUTH_SIGNING_KEY = crypto.createHash('sha256')
  .update('auth-signing:' + ENCRYPTION_SECRET)
  .digest();

export function signAuthToken(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify({
    ...payload,
    jti: crypto.randomBytes(8).toString('hex'), // unique token id → enables revocation (logout)
    exp: Date.now() + AUTH_TOKEN_TTL_MS,
  }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', AUTH_SIGNING_KEY).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/**
 * Revoked token ids (jti). Populated by /api/auth/logout.
 * Persisted in SQLite `revoked_tokens` table with in-memory memoization
 * so logouts survive server restarts.
 */
const revokedTokenJtis = new Set<string>();

export function revokeAuthToken(jti: string, expiresAt?: number): void {
  if (!jti) return;
  revokedTokenJtis.add(jti);
  const exp = expiresAt && expiresAt > Date.now() ? expiresAt : Date.now() + AUTH_TOKEN_TTL_MS;
  SqliteDb.revokeToken(jti, exp);
}

export function isAuthTokenRevoked(jti: string): boolean {
  if (!jti) return false;
  if (revokedTokenJtis.has(jti)) return true;
  if (SqliteDb.isTokenRevoked(jti)) {
    revokedTokenJtis.add(jti);
    return true;
  }
  return false;
}

// Initial and periodic cleanup of expired tokens and chapter page caches
try {
  SqliteDb.cleanupExpiredRevokedTokens();
  SqliteDb.cleanupExpiredChapterPages();
} catch {}

setInterval(() => {
  try {
    SqliteDb.cleanupExpiredRevokedTokens();
    SqliteDb.cleanupExpiredChapterPages();
  } catch {}
}, 60 * 60 * 1000); // Hourly cleanup

export function verifyAuthToken(token: string): Record<string, unknown> | null {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot === -1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', AUTH_SIGNING_KEY).update(body).digest('base64url');
  if (sig.length !== expected.length) return null;
  const sigBuf = Buffer.from(sig, 'base64url');
  const expBuf = Buffer.from(expected, 'base64url');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof payload.exp === 'number' && payload.exp < Date.now()) return null;
    if (typeof payload.jti === 'string' && isAuthTokenRevoked(payload.jti)) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Strip secrets before any user object leaves the API. */
export function toPublicUser(u: UserProfile) {
  return {
    id: u.id,
    name: u.name,
    username: u.username,
    email: u.email,
    avatar: u.avatar,
    role: u.role,
    createdAt: u.createdAt,
  };
}

// ==========================================
// HOST PC PRIVILEGE ENGINE & SECURITY MIDDLEWARE
// ==========================================
export function isHostRequest(req: express.Request): boolean {
  // SECURITY: req.ip is Express-resolved. The server enables `trust proxy` with
  // a loopback-only trust function (see server.ts), so X-Forwarded-For is honored
  // ONLY when the direct peer is a trusted loopback proxy (nginx on this host).
  // A forged header from a remote client can therefore never elevate to a host.
  const clientIp = (req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  return clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === 'localhost';
}

// =========================================================
// HOST-ONLY GATE FOR GLOBAL SETTINGS & DESTRUCTIVE OPERATIONS
// =========================================================
// Per-user library CRUD stays open to all users, but anything that mutates
// global server state (settings, config, backups, bulk syncs, source toggles,
// crawler) is restricted to the host computer. Without a token/session system
// this prevents any LAN/remote client from overwriting the whole database.
export const HOST_ONLY_PATHS = new Set<string>([
  '/api/config',
  '/api/settings',
  '/api/settings/backup/export',
  '/api/settings/backup/import',
  '/api/settings/backup/export-kotatsu',
  '/api/settings/backup/import-kotatsu',
  '/api/settings/cache/clear',
  '/api/manga/sync-from-apis',
  '/api/manga/refresh-all-metadata',
  '/api/kotatsu/sync-database',
  '/api/kotatsu/sources/toggle',
  '/api/kotatsu/sources/purge-disabled',
  '/api/crawler/bypass-fetch',
  // Database import/export/reset (destructive or full-library exfil)
  '/api/db/export',
  '/api/db/import',
  '/api/db/reset',
  '/api/db/refresh-all',
  // Tracker bulk / destructive
  '/api/tracker/auto-update',
  '/api/tracker/detect-duplicates',
  '/api/tracker/merge-duplicates',
  '/api/tracker/dismiss-duplicate',
  // Kotatsu / scrape bulk mutations
  '/api/kotatsu/sources/activate',
  '/api/kotatsu/sources/deactivate',
  '/api/kotatsu/sources/activate-all',
  '/api/kotatsu/sources/deactivate-all',
  '/api/kotatsu/pull-all-sources',
  '/api/scrape/update-all-series',
  '/api/scrape/audit-sources',
  '/api/scrape/source-catalog',
  '/api/mangadex/pull-bulk-catalog',
  // AI bulk (API key / load)
  '/api/ai/enrich-metadata',
  '/api/ai/find-similar',
  // Admin operations
  '/api/admin',
]);
// GET requests to host-only paths are allowed (read-only config/health info),
// except these sensitive exports which leak the full database.
export const SENSITIVE_GET_PATHS = new Set<string>([
  '/api/settings/backup/export',
  '/api/settings/backup/export-kotatsu',
  '/api/db/export',
]);

// Normalize a request path: collapse trailing slashes and decode %2F so that
// `/api/config/`, `/api/settings//backup` etc. can never bypass the host gate.
export function normalizeGatePath(p: string): string {
  let path = p;
  while (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  try { path = decodeURIComponent(path); } catch { /* keep as-is on malformed input */ }
  return path;
}

// Prefix-based host-gate: a request is protected if its (normalized) path equals
// a host-only path OR falls under one of its sub-paths (e.g. /api/settings/*).
export function isHostOnlyPath(p: string): boolean {
  const norm = normalizeGatePath(p);
  for (const base of HOST_ONLY_PATHS) {
    if (norm === base || norm.startsWith(base + '/')) return true;
  }
  return false;
}

// =========================================================
// SSRF PROTECTION FOR OUTBOUND PROXY FETCHES
// =========================================================
export const MAX_PROXY_IMAGE_BYTES = 25 * 1024 * 1024; // 25 MB hard cap per proxied image

export function isPrivateOrReservedIp(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/^::ffff:/, '').replace(/^\[|\]$/g, '');
  if (normalized === '::1' || normalized === '::' || normalized === 'localhost') return true;
  if (normalized.startsWith('fe80:') || normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  const parts = normalized.split('.').map(Number);
  if (parts.length === 4 && parts.every((p) => Number.isInteger(p) && p >= 0 && p <= 255)) {
    const [a, b] = parts;
    if (a === 10 || a === 127 || a === 0) return true;          // RFC1918 / loopback / "this"
    if (a === 172 && b >= 16 && b <= 31) return true;            // RFC1918
    if (a === 192 && b === 168) return true;                     // RFC1918
    if (a === 169 && b === 254) return true;                     // link-local / cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true;           // CGNAT
  }
  return false;
}

export async function assertSafeProxyTarget(rawUrl: string): Promise<URL> {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Blocked non-HTTP proxy target protocol: ${parsed.protocol}`);
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (isPrivateOrReservedIp(host)) {
      throw new Error(`Blocked private/reserved IP proxy target: ${host}`);
    }
  } else {
    const lookups = await dns.promises.lookup(host, { all: true });
    for (const entry of lookups) {
      if (isPrivateOrReservedIp(entry.address)) {
        throw new Error(`Blocked host resolving to private/reserved IP: ${host}`);
      }
    }
  }
  return parsed;
}

/**
 * Undici Agent enforcing socket-level IP validation to prevent DNS rebinding TOCTOU attacks.
 */
export const ssrfSafeAgent = new Agent({
  keepAliveTimeout: 30000,
  keepAliveMaxTimeout: 60000,
  pipelining: 1,
  connect: {
    lookup: (hostname: string, opts: any, callback: (err: NodeJS.ErrnoException | null, address: any, family?: number) => void) => {
      dns.lookup(hostname, opts, (err, address, family) => {
        if (err) return callback(err, address, family);
        if (Array.isArray(address)) {
          for (const item of address) {
            if (isPrivateOrReservedIp(item.address)) {
              return callback(new Error(`Blocked: hostname "${hostname}" resolves to private/reserved IP "${item.address}"`), address, family);
            }
          }
          return callback(null, address, family);
        }
        if (typeof address === 'string' && isPrivateOrReservedIp(address)) {
          return callback(new Error(`Blocked: hostname "${hostname}" resolves to private/reserved IP "${address}"`), address, family);
        }
        return callback(null, address, family);
      });
    },
  },
});

/**
 * SSRF-safe fetch that follows redirects MANUALLY, re-validating every hop
 * against assertSafeProxyTarget. Plain fetch() would silently follow a 3xx
 * from a public host to an internal address (cloud metadata, LAN service),
 * defeating the initial URL check.
 */
export async function fetchWithSsrfGuard(
  rawUrl: string,
  init: RequestInit = {},
  maxRedirects = 5
): Promise<Response> {
  let currentUrl = rawUrl;
  for (let hop = 0; ; hop++) {
    await assertSafeProxyTarget(currentUrl);
    const res = await fetch(currentUrl, {
      ...init,
      dispatcher: ssrfSafeAgent,
      redirect: 'manual',
    } as any);
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      if (hop >= maxRedirects) {
        throw new Error(`Blocked: too many redirects (> ${maxRedirects})`);
      }
      // Drop the redirect body without consuming it fully.
      try { await res.body?.cancel(); } catch { /* best effort */ }
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    return res;
  }
}

export async function streamProxiedImage(response: Response, res: express.Response, req?: express.Request): Promise<boolean> {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > MAX_PROXY_IMAGE_BYTES) {
    res.setHeader('Content-Type', 'text/plain');
    res.status(413).send('Proxied image exceeds size cap');
    return false;
  }

  const body = response.body as unknown as AsyncIterable<Uint8Array> | null;
  if (!body) {
    res.status(502).send('Empty upstream response');
    return false;
  }

  const controller = new AbortController();
  let received = 0;
  const abortOnOverflow = () => controller.abort();
  const capTimer = setTimeout(abortOnOverflow, 60000);

  // Track client disconnects so the backpressure wait below can never hang
  // forever when the reader tab is closed mid-stream.
  let clientGone = false;
  const onClose = () => { clientGone = true; };
  if (req) req.once('close', onClose);

  try {
    for await (const chunk of body) {
      if (clientGone) break;
      received += chunk.length;
      if (received > MAX_PROXY_IMAGE_BYTES) {
        controller.abort();
        throw new Error('Proxied image exceeded size cap during streaming');
      }
      if (!res.write(Buffer.from(chunk))) {
        await new Promise<void>((resolve) => {
          res.once('drain', resolve);
          if (req) req.once('close', resolve);
        });
        if (clientGone) break;
      }
    }
    clearTimeout(capTimer);
    if (!clientGone) res.end();
    return true;
  } catch (err: any) {
    clearTimeout(capTimer);
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'text/plain');
      res.status(502).send(err?.message || 'Streaming failed');
    }
    return false;
  } finally {
    if (req) req.removeListener('close', onClose);
  }
}
