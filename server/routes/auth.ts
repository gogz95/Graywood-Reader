import { Router } from 'express';
import crypto from 'crypto';
import { UserProfile, UserRole } from '../../src/types';
import { logger } from '../logger';
import {
  AUTH_ENABLED,
  AUTH_TOKEN_TTL_MS,
  hashPassword,
  verifyPasswordAsync,
  signAuthToken,
  verifyAuthToken,
  revokeAuthToken,
  toPublicUser,
  isHostRequest,
} from '../security';
import {
  checkLoginRateLimit,
  recordLoginFailure,
  clearLoginFailures,
  checkAccountLockout,
  recordAccountFailure,
  clearAccountFailures,
} from '../rateLimit';
import { userProfiles, saveDatabaseToDisk } from '../appState';

// ============================================================================
// AUTHENTICATION & PROFILE ROUTES
// Extracted from server.ts. Mounted AFTER the host-gate / rate-limit / auth
// middleware chain so it is covered by the same protections as the rest of
// the API.
// ============================================================================

export const authRouter = Router();

// Host PC Client Context Endpoint
authRouter.get("/api/auth/client-context", (req, res) => {
  const isHost = isHostRequest(req);
  const clientIp = (req.ip || req.socket.remoteAddress || '127.0.0.1').replace(/^::ffff:/, '');
  res.json({
    isHost,
    clientIp,
    defaultRole: isHost ? 'admin' : 'guest',
  });
});

// Login: exchange a username/email + password for a signed token.
// Available regardless of REQUIRE_AUTH (host can always mint tokens; remote
// clients need this to gain access once auth is enabled).
authRouter.post("/api/auth/login", async (req, res) => {
  const clientIp = (req.ip || req.socket?.remoteAddress || '127.0.0.1').replace(/^::ffff:/, '');

  const { username, email, password } = req.body || {};
  const identifier = String(username || email || '').trim().toLowerCase();
  const pass = String(password || '');

  // Per-account lockout applies to EVERY caller (also protects against
  // distributed brute force across many IPs).
  const accountBlock = checkAccountLockout(identifier);
  if (accountBlock) {
    logger.warn('Auth', `Login blocked: account "${identifier}" is locked`, { retryAfterSeconds: accountBlock.retryAfterSeconds });
    return res.status(429).json({
      error: 'Too Many Requests',
      message: accountBlock.message,
      retryAfterSeconds: accountBlock.retryAfterSeconds,
    });
  }

  // Login brute-force rate limiting (skipped for host/localhost)
  if (clientIp !== '127.0.0.1' && clientIp !== '::1') {
    const block = checkLoginRateLimit(clientIp);
    if (block) {
      logger.warn('Auth', `Login blocked for IP ${clientIp}`, { retryAfterSeconds: block.retryAfterSeconds });
      return res.status(429).json({
        error: 'Too Many Requests',
        message: block.message,
        retryAfterSeconds: block.retryAfterSeconds,
      });
    }
  }

  if (!identifier || !pass) {
    return res.status(400).json({ error: 'Bad Request', message: 'username/email and password are required.' });
  }

  const user = userProfiles.find(
    (u) => (u.username || '').toLowerCase() === identifier || (u.email || '').toLowerCase() === identifier
  );
  if (!user || !user.password) {
    recordLoginFailure(clientIp);
    recordAccountFailure(identifier);
    logger.warn('Auth', `Failed login attempt for "${identifier}" from ${clientIp}`);
    return res.status(401).json({ error: 'Unauthorized', message: 'Invalid credentials.' });
  }

  const ok = await verifyPasswordAsync(pass, user.password);
  if (!ok) {
    recordLoginFailure(clientIp);
    recordAccountFailure(identifier);
    logger.warn('Auth', `Failed login attempt for "${user.username}" (bad password) from ${clientIp}`);
    return res.status(401).json({ error: 'Unauthorized', message: 'Invalid credentials.' });
  }

  // Successful login — clear any prior failure records (IP + account)
  clearLoginFailures(clientIp);
  clearAccountFailures(identifier);
  logger.info('Auth', `User "${user.username}" logged in from ${clientIp}`);

  const token = signAuthToken({ sub: user.id, role: user.role });
  res.json({
    token,
    expiresInMs: AUTH_TOKEN_TTL_MS,
    user: toPublicUser(user),
  });
});

// Logout: revoke the presented token (jti) so it stops verifying immediately.
authRouter.post("/api/auth/logout", (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (token) {
    const payload = verifyAuthToken(token);
    if (payload && typeof payload.jti === 'string') {
      revokeAuthToken(payload.jti);
      logger.info('Auth', `Token ${payload.jti} revoked via logout (user ${String(payload.sub || '?')})`);
    }
  }
  res.json({ success: true });
});

// Register a new user account. Passwords are scrypt-hashed before storage.
// Role is never taken from the client (always 'user' unless first real account on host).
authRouter.post("/api/auth/register", (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  const username = String(body.username || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const avatar = String(body.avatar || '🥷').trim() || '🥷';

  if (!name || !username || !email || !password) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'name, username, email, and password are required.',
    });
  }
  if (password.length < 8) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Password must be at least 8 characters.',
    });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Bad Request', message: 'A valid email address is required.' });
  }

  const usernameLc = username.toLowerCase();
  const taken = userProfiles.some(
    (u) =>
      (u.username || '').toLowerCase() === usernameLc ||
      (u.email || '').toLowerCase() === email
  );
  if (taken) {
    return res.status(409).json({
      error: 'Conflict',
      message: 'Username or email is already registered.',
    });
  }

  const realUsers = userProfiles.filter((u) => u.id !== 'usr_admin' && u.id !== 'usr_guest');
  const role: UserRole =
    realUsers.length === 0 && isHostRequest(req) ? 'admin' : 'user';

  const newUser: UserProfile = {
    id: 'usr_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex'),
    name,
    username,
    email,
    password: hashPassword(password),
    avatar,
    role,
    createdAt: new Date().toISOString(),
  };

  userProfiles.push(newUser);
  saveDatabaseToDisk();

  const regToken = signAuthToken({ sub: newUser.id, role: newUser.role });
  logger.info('Auth', `Registered user ${newUser.username} (${newUser.id}) role=${newUser.role}`);
  res.status(201).json({
    token: regToken,
    expiresInMs: AUTH_TOKEN_TTL_MS,
    user: toPublicUser(newUser),
  });
});

// Public profile list (never includes password hashes). Emails are PII:
// only the host or the profile's owner may see them — everyone else gets an
// empty string instead of a full account enumeration surface.
authRouter.get("/api/profiles", (req, res) => {
  const actor = (req as any).user as UserProfile | null;
  const hostCaller = isHostRequest(req);
  res.json(userProfiles.map((u) => {
    const pub = toPublicUser(u);
    if (!hostCaller && actor?.id !== u.id) pub.email = '';
    return pub;
  }));
});

// Return the currently authenticated user (or null). Never requires auth.
authRouter.get("/api/auth/me", (req, res) => {
  const user = (req as any).user as UserProfile | null;
  res.json({
    authenticated: !!user,
    authEnabled: AUTH_ENABLED,
    user: user ? toPublicUser(user) : null,
  });
});