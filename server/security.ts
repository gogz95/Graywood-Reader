import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dns from 'dns';
import net from 'net';
import express from 'express';
import { UserProfile } from '../src/types';

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
  try {
    if (fs.existsSync(secretPath)) {
      const existing = fs.readFileSync(secretPath, 'utf8').trim();
      if (existing) return existing;
    }
  } catch (err) {
    console.error('[Security Engine] Failed to read secret file:', err);
  }
  // First run: seed with the legacy default key for backward compatibility.
  const legacyDefault = 'graywood-reader-gdpr-aes256-secret-key-32b!';
  try {
    fs.mkdirSync(path.dirname(secretPath), { recursive: true });
    fs.writeFileSync(secretPath, legacyDefault + '\n', { mode: 0o600 });
    console.warn('[Security Engine] Seeded data/.encryption-secret with the legacy default key so existing encrypted PII stays decryptable. Set ENCRYPTION_SECRET in your environment to rotate it.');
  } catch (err) {
    console.error('[Security Engine] Failed to seed secret file:', err);
  }
  return legacyDefault;
}

export const ENCRYPTION_SECRET = resolveEncryptionSecret();
const ALGORITHM = 'aes-256-gcm';

export function encryptPII(text: string): string {
  if (!text) return '';
  try {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_SECRET.padEnd(32).slice(0, 32)), iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `enc:${iv.toString('hex')}:${authTag}:${encrypted}`;
  } catch (err) {
    console.error('[GDPR Engine] Encryption error:', err);
    return text;
  }
}

export function decryptPII(encryptedData: string): string {
  if (!encryptedData || !encryptedData.startsWith('enc:')) return encryptedData;
  try {
    const parts = encryptedData.slice(4).split(':');
    if (parts.length !== 3) return encryptedData;
    const [ivHex, authTagHex, encryptedText] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(ENCRYPTION_SECRET.padEnd(32).slice(0, 32)), iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return encryptedData;
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
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + AUTH_TOKEN_TTL_MS }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', AUTH_SIGNING_KEY).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyAuthToken(token: string): Record<string, unknown> | null {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot === -1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', AUTH_SIGNING_KEY).update(body).digest('base64url');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof payload.exp === 'number' && payload.exp < Date.now()) return null;
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
  // SECURITY: Never trust the raw X-Forwarded-For header here — it is trivially
  // spoofable by any remote client. Use only the Express-resolved socket IP.
  const clientIp = (req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  return clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === 'localhost';
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

export async function streamProxiedImage(response: Response, res: express.Response): Promise<boolean> {
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

  try {
    for await (const chunk of body) {
      received += chunk.length;
      if (received > MAX_PROXY_IMAGE_BYTES) {
        controller.abort();
        throw new Error('Proxied image exceeded size cap during streaming');
      }
      if (!res.write(Buffer.from(chunk))) {
        await new Promise((resolve) => res.once('drain', resolve));
      }
    }
    clearTimeout(capTimer);
    res.end();
    return true;
  } catch (err: any) {
    clearTimeout(capTimer);
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'text/plain');
      res.status(502).send(err?.message || 'Streaming failed');
    }
    return false;
  }
}
