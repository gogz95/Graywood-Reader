import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import type { Request } from 'express';
import {
  encryptPII,
  decryptPII,
  ENCRYPTION_SECRET,
  hashPassword,
  verifyPassword,
  signAuthToken,
  verifyAuthToken,
  revokeAuthToken,
  isPrivateOrReservedIp,
  assertSafeProxyTarget,
  fetchWithSsrfGuard,
  isHostRequest,
  normalizeGatePath,
  isHostOnlyPath,
  HOST_ONLY_PATHS,
} from '../server/security';
import { isImageProxyPath } from '../server/rateLimit';

describe('PII encryption (AES-256-GCM)', () => {
  it('round-trips plaintext and does not leak it in ciphertext', () => {
    const enc = encryptPII('user@example.com');
    expect(enc.startsWith('enc:')).toBe(true);
    expect(enc).not.toContain('user@example.com');
    expect(decryptPII(enc)).toBe('user@example.com');
  });

  it('decrypts legacy slice(0,32) padded ciphertexts for backward compatibility', () => {
    const legacyKey = Buffer.from(ENCRYPTION_SECRET.padEnd(32).slice(0, 32));
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', legacyKey, iv);
    let enc = cipher.update('legacy-secret@example.com', 'utf8', 'hex');
    enc += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    const legacyCiphertext = `enc:${iv.toString('hex')}:${authTag}:${enc}`;

    expect(decryptPII(legacyCiphertext)).toBe('legacy-secret@example.com');
  });

  it('passes through non-encrypted values untouched', () => {
    expect(decryptPII('plain-text')).toBe('plain-text');
    expect(decryptPII('')).toBe('');
    expect(decryptPII('enc:malformed')).toBe('enc:malformed');
  });

  it('produces unique ciphertext for the same input (random IV)', () => {
    expect(encryptPII('secret')).not.toBe(encryptPII('secret'));
  });
});

describe('password hashing (scrypt)', () => {
  it('hashes and verifies correctly', () => {
    const hash = hashPassword('hunter2');
    expect(hash.startsWith('scrypt:')).toBe(true);
    expect(verifyPassword('hunter2', hash)).toBe(true);
    expect(verifyPassword('wrong', hash)).toBe(false);
  });

  it('rejects empty input / unknown storage', () => {
    expect(verifyPassword('x', '')).toBe(false);
    expect(verifyPassword('', 'scrypt:abc:def')).toBe(false);
    expect(verifyPassword('x', 'garbage')).toBe(false);
  });
});

describe('auth tokens (HMAC-signed)', () => {
  it('round-trips a signed token', () => {
    const token = signAuthToken({ sub: 'usr_admin', role: 'admin' });
    const payload = verifyAuthToken(token);
    expect(payload?.sub).toBe('usr_admin');
    expect(payload?.role).toBe('admin');
  });

  it('rejects a tampered signature', () => {
    const token = signAuthToken({ sub: 'usr_admin' });
    const [body, sig] = token.split('.');
    const flipped = sig.endsWith('a') ? 'b' : 'a';
    const forged = `${body}.${sig.slice(0, -1)}${flipped}`;
    expect(forged).not.toBe(token);
    expect(verifyAuthToken(forged)).toBeNull();
  });

  it('rejects empty / malformed tokens', () => {
    expect(verifyAuthToken('')).toBeNull();
    expect(verifyAuthToken('no-dot')).toBeNull();
  });
});

describe('SSRF guard', () => {
  it('allows public https URLs', async () => {
    const url = await assertSafeProxyTarget('https://1.1.1.1/img.png');
    expect(url.protocol).toBe('https:');
  });

  it('blocks non-http(s) protocols', async () => {
    await expect(assertSafeProxyTarget('ftp://1.1.1.1/x')).rejects.toThrow();
    await expect(assertSafeProxyTarget('file:///etc/passwd')).rejects.toThrow();
    await expect(assertSafeProxyTarget('gopher://1.1.1.1/')).rejects.toThrow();
  });

  it('blocks private/RFC1918/metadata IPs', async () => {
    for (const ip of ['10.0.0.1', '127.0.0.1', '192.168.1.1', '169.254.169.254', '172.16.0.1', '0.0.0.0']) {
      await expect(assertSafeProxyTarget(`http://${ip}/x`)).rejects.toThrow();
    }
  });

  it('classifies private/reserved vs public IPs', () => {
    expect(isPrivateOrReservedIp('10.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('192.168.0.5')).toBe(true);
    expect(isPrivateOrReservedIp('172.31.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('169.254.169.254')).toBe(true);
    expect(isPrivateOrReservedIp('8.8.8.8')).toBe(false);
    expect(isPrivateOrReservedIp('1.1.1.1')).toBe(false);
  });
});

describe('host request detection', () => {
  const mockReq = (ip: string) => ({ ip, socket: { remoteAddress: ip } }) as unknown as Request;

  it('treats loopback as host', () => {
    expect(isHostRequest(mockReq('::ffff:127.0.0.1'))).toBe(true);
    expect(isHostRequest(mockReq('127.0.0.1'))).toBe(true);
    expect(isHostRequest(mockReq('::1'))).toBe(true);
  });

  it('treats remote addresses as non-host', () => {
    expect(isHostRequest(mockReq('::ffff:1.2.3.4'))).toBe(false);
    expect(isHostRequest(mockReq('1.2.3.4'))).toBe(false);
    expect(isHostRequest(mockReq('10.0.0.5'))).toBe(false);
  });
});

describe('rate-limit path classification', () => {
  it('flags image-proxy paths', () => {
    expect(isImageProxyPath('/api/reader/proxy-image')).toBe(true);
    expect(isImageProxyPath('/api/reader/proxy-image?url=x')).toBe(true);
    expect(isImageProxyPath('/api/proxy/image')).toBe(true);
    expect(isImageProxyPath('/api/mangadex/image-proxy')).toBe(true);
  });

  it('does not flag non-proxy paths', () => {
    expect(isImageProxyPath('/api/manga')).toBe(false);
    expect(isImageProxyPath('/api/health')).toBe(false);
    expect(isImageProxyPath('/')).toBe(false);
  });
});

describe('host gate path normalization', () => {
  it('strips trailing slashes', () => {
    expect(normalizeGatePath('/api/config/')).toBe('/api/config');
    expect(normalizeGatePath('/api/settings///')).toBe('/api/settings');
  });

  it('decodes percent-encoded segments once', () => {
    expect(normalizeGatePath('/api/%73ettings')).toBe('/api/settings');
    // malformed sequences are kept as-is (no throw)
    expect(normalizeGatePath('/api/%E0%A4%A')).toBe('/api/%E0%A4%A');
  });

  it('protects host-only paths including sub-paths', () => {
    expect(isHostOnlyPath('/api/config')).toBe(true);
    expect(isHostOnlyPath('/api/config/')).toBe(true);
    expect(isHostOnlyPath('/api/settings/backup/export')).toBe(true);
    expect(isHostOnlyPath('/api/db/reset')).toBe(true);
  });

  it('does not over-match unrelated or prefix-similar paths', () => {
    expect(isHostOnlyPath('/api/manga')).toBe(false);
    expect(isHostOnlyPath('/api/health')).toBe(false);
    // "/api/configx" is NOT under "/api/config"
    expect(isHostOnlyPath('/api/configx')).toBe(false);
    expect(isHostOnlyPath('/api/config-extended')).toBe(false);
  });

  it('keeps destructive and settings endpoints in the protected set', () => {
    for (const p of [
      '/api/db/import',
      '/api/db/export',
      '/api/settings',
      '/api/settings/backup/export',
      '/api/settings/backup/import',
      '/api/settings/backup/export-kotatsu',
      '/api/settings/backup/import-kotatsu',
      '/api/crawler/bypass-fetch'
    ]) {
      expect(isHostOnlyPath(p)).toBe(true);
    }
  });
});

describe('token revocation (logout)', () => {
  it('issues a unique jti per token and revokes it on demand', () => {
    const token = signAuthToken({ sub: 'usr_test', role: 'user' });
    const payload = verifyAuthToken(token);
    expect(typeof payload?.jti).toBe('string');
    expect((payload?.jti as string).length).toBeGreaterThan(0);

    // Token verifies before revocation, fails after.
    expect(verifyAuthToken(token)).not.toBeNull();
    revokeAuthToken(String(payload?.jti));
    expect(verifyAuthToken(token)).toBeNull();
  });

  it('two tokens for the same user are independent', () => {
    const a = signAuthToken({ sub: 'usr_x' });
    const b = signAuthToken({ sub: 'usr_x' });
    const pa = verifyAuthToken(a);
    revokeAuthToken(String(pa?.jti));
    expect(verifyAuthToken(a)).toBeNull();
    expect(verifyAuthToken(b)).not.toBeNull();
  });
});

describe('fetchWithSsrfGuard (pre-flight validation)', () => {
  it('rejects non-http(s) protocols without performing a request', async () => {
    await expect(fetchWithSsrfGuard('file:///etc/passwd')).rejects.toThrow();
    await expect(fetchWithSsrfGuard('gopher://1.1.1.1/')).rejects.toThrow();
  });

  it('rejects private/reserved targets without performing a request', async () => {
    await expect(fetchWithSsrfGuard('http://127.0.0.1:8191/v1')).rejects.toThrow();
    await expect(fetchWithSsrfGuard('http://169.254.169.254/latest/meta-data/')).rejects.toThrow();
    await expect(fetchWithSsrfGuard('http://10.0.0.5/internal')).rejects.toThrow();
  });
});
