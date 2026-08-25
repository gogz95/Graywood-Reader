import { db } from './connection';

const stmtRevokeToken = db.prepare(`
  INSERT OR REPLACE INTO revoked_tokens (jti, revoked_at, expires_at)
  VALUES (?, ?, ?)
`);

const stmtIsTokenRevoked = db.prepare(`
  SELECT 1 FROM revoked_tokens WHERE jti = ? AND expires_at > ?
`);

const stmtCleanupRevokedTokens = db.prepare(`
  DELETE FROM revoked_tokens WHERE expires_at <= ?
`);

export function revokeToken(jti: string, expiresAt: number): void {
  if (!jti) return;
  try {
    stmtRevokeToken.run(jti, new Date().toISOString(), expiresAt);
  } catch (e) {
    console.error('[SQLite Engine] Failed to record revoked token:', e);
  }
}

export function isTokenRevoked(jti: string): boolean {
  if (!jti) return false;
  try {
    const row = stmtIsTokenRevoked.get(jti, Date.now());
    return Boolean(row);
  } catch {
    return false;
  }
}

export function cleanupExpiredRevokedTokens(): number {
  try {
    const info = stmtCleanupRevokedTokens.run(Date.now());
    return info.changes;
  } catch {
    return 0;
  }
}
