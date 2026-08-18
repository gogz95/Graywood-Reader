import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import {
  encryptPII,
  decryptPII,
  hashPassword,
  verifyPassword,
  signAuthToken,
  verifyAuthToken,
  isPrivateOrReservedIp,
  assertSafeProxyTarget,
  isHostRequest,
} from '../server/security';
import { isImageProxyPath } from '../server/rateLimit';

describe('PII encryption (AES-256-GCM)', () => {
  it('round-trips plaintext and does not leak it in ciphertext', () => {
    const enc = encryptPII('user@example.com');
    expect(enc.startsWith('enc:')).toBe(true);
    expect(enc).not.toContain('user@example.com');
    expect(decryptPII(enc)).toBe('user@example.com');
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
