import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
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
import { userProfiles, saveDatabaseToDisk, flushStateNow } from '../appState';

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

// Admin Bootstrap Status Endpoint (Host-only)
authRouter.get("/api/auth/admin-bootstrap-status", (req, res) => {
  if (!isHostRequest(req)) {
    return res.status(403).json({ error: 'Forbidden', message: 'Host only endpoint.' });
  }
  const bootstrapPath = path.join(process.cwd(), 'data', '.admin-bootstrap-password');
  const hasBootstrapFile = fs.existsSync(bootstrapPath);
  res.json({
    hasBootstrapPasswordFile: hasBootstrapFile,
    adminUsername: 'admin',
    message: hasBootstrapFile
      ? 'An initial admin password was auto-generated in data/.admin-bootstrap-password'
      : 'Admin password is configured in database / environment',
  });
});

// Login: exchange a username/email + password for a signed token.
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
    return res.status(400).json({ error: 'Bad Request', message: 'Username/email and password are required.' });
  }

  const user = userProfiles.find(
    (u) => (u.username || '').toLowerCase() === identifier || (u.email || '').toLowerCase() === identifier
  );
  if (!user) {
    recordLoginFailure(clientIp);
    recordAccountFailure(identifier);
    logger.warn('Auth', `Failed login attempt (user not found: "${identifier}") from ${clientIp}`);
    return res.status(401).json({ error: 'Unauthorized', message: 'Invalid username/email or password.' });
  }

  if (!user.password) {
    recordLoginFailure(clientIp);
    recordAccountFailure(identifier);
    logger.warn('Auth', `Failed login attempt for user "${user.username}" (no password configured) from ${clientIp}`);
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'This profile has no password configured. Please sign in with a registered account or use Guest mode.',
    });
  }

  const ok = await verifyPasswordAsync(pass, user.password);
  if (!ok) {
    recordLoginFailure(clientIp);
    recordAccountFailure(identifier);
    logger.warn('Auth', `Failed login attempt for "${user.username}" (incorrect password) from ${clientIp}`);
    return res.status(401).json({ error: 'Unauthorized', message: 'Invalid username/email or password.' });
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
      message: 'Name, username, email, and password are required.',
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
  // Synchronous flush guarantees zero data-loss window on sudden restarts or crashes
  try {
    flushStateNow();
  } catch (err) {
    saveDatabaseToDisk();
  }

  const regToken = signAuthToken({ sub: newUser.id, role: newUser.role });
  logger.info('Auth', `Registered user ${newUser.username} (${newUser.id}) role=${newUser.role}`);
  res.status(201).json({
    token: regToken,
    expiresInMs: AUTH_TOKEN_TTL_MS,
    user: toPublicUser(newUser),
  });
});

// Update Profile (Name, Avatar, Email) for Authenticated User
authRouter.put("/api/auth/profile", (req, res) => {
  const actor = (req as any).user as UserProfile | null;
  const isHost = isHostRequest(req);
  if (!actor && !isHost) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Sign in to update your profile.' });
  }

  const targetId = actor?.id || 'usr_admin';
  const userIdx = userProfiles.findIndex((u) => u.id === targetId);
  if (userIdx === -1) {
    return res.status(404).json({ error: 'Not Found', message: 'User profile not found.' });
  }

  const { name, avatar, email, theme, allowNsfw, maxAgeRating } = req.body || {};
  const current = userProfiles[userIdx];

  if (name && typeof name === 'string' && name.trim()) {
    current.name = name.trim();
  }
  if (avatar && typeof avatar === 'string' && avatar.trim()) {
    current.avatar = avatar.trim();
  }
  if (theme && typeof theme === 'string' && ['amber', 'emerald', 'amoled', 'violet', 'cyberpunk'].includes(theme)) {
    current.theme = theme as any;
  }
  if (allowNsfw !== undefined && typeof allowNsfw === 'boolean') {
    current.allowNsfw = allowNsfw;
  }
  if (maxAgeRating && ['all', 'pg', 'pg13', '18+'].includes(maxAgeRating)) {
    current.maxAgeRating = maxAgeRating;
  }
  if (email && typeof email === 'string' && email.trim()) {
    const cleanEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ error: 'Bad Request', message: 'Invalid email address.' });
    }
    const duplicate = userProfiles.some((u) => u.id !== targetId && (u.email || '').toLowerCase() === cleanEmail);
    if (duplicate) {
      return res.status(409).json({ error: 'Conflict', message: 'Email address is already in use.' });
    }
    current.email = cleanEmail;
  }

  try {
    flushStateNow();
  } catch {
    saveDatabaseToDisk();
  }

  logger.info('Auth', `Profile updated for user "${current.username}" (${current.id}) theme=${current.theme || 'default'}`);
  res.json({ success: true, user: toPublicUser(current) });
});

// Change Password for Authenticated User
authRouter.post("/api/auth/change-password", async (req, res) => {
  const actor = (req as any).user as UserProfile | null;
  const isHost = isHostRequest(req);
  if (!actor && !isHost) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Sign in to change password.' });
  }

  const targetId = actor?.id || 'usr_admin';
  const user = userProfiles.find((u) => u.id === targetId);
  if (!user) {
    return res.status(404).json({ error: 'Not Found', message: 'User profile not found.' });
  }

  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
    return res.status(400).json({ error: 'Bad Request', message: 'New password must be at least 8 characters long.' });
  }

  // If user already has a password, verify current password (unless host admin modifying own session)
  if (user.password && actor) {
    if (!currentPassword) {
      return res.status(400).json({ error: 'Bad Request', message: 'Current password is required.' });
    }
    const ok = await verifyPasswordAsync(String(currentPassword), user.password);
    if (!ok) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Current password is incorrect.' });
    }
  }

  user.password = hashPassword(newPassword);
  try {
    flushStateNow();
  } catch {
    saveDatabaseToDisk();
  }

  logger.info('Auth', `Password successfully changed for user "${user.username}" (${user.id})`);
  res.json({ success: true, message: 'Password successfully updated.' });
});

// Public profile list (never includes password hashes).
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

// ── OpenID Connect (OIDC) / Authentik / Keycloak SSO Integration ─────────────
authRouter.get("/api/auth/oidc/config", (_req, res) => {
  const envEnabled = process.env.OIDC_ENABLED === 'true';
  const issuerUrl = process.env.OIDC_ISSUER || 'https://auth.example.com/application/o/graywood/';
  const clientId = process.env.OIDC_CLIENT_ID || '';
  const buttonLabel = process.env.OIDC_BUTTON_LABEL || 'Sign in with Authentik / OIDC';

  res.json({
    enabled: envEnabled || false,
    issuerUrl: envEnabled ? issuerUrl : '',
    clientId: envEnabled ? clientId : '',
    buttonLabel,
  });
});

authRouter.post("/api/auth/oidc/callback", async (req, res) => {
  try {
    const { code, state, email, name, username } = req.body || {};
    const effectiveEmail = String(email || username || 'sso_user@graywood.local').toLowerCase();
    const effectiveUsername = String(username || name || effectiveEmail.split('@')[0] || 'sso_user').replace(/\s+/g, '_').toLowerCase();

    // Check if user already exists
    let user = userProfiles.find((u) => u.email?.toLowerCase() === effectiveEmail || u.username?.toLowerCase() === effectiveUsername);

    if (!user) {
      // Auto-register user from OIDC claims
      const newId = `usr_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      user = {
        id: newId,
        name: name || effectiveUsername,
        username: effectiveUsername,
        email: effectiveEmail,
        avatar: '👤',
        role: 'user',
        createdAt: new Date().toISOString(),
      };
      userProfiles.push(user);
      try {
        flushStateNow();
      } catch {
        saveDatabaseToDisk();
      }
      logger.info('Auth', `Auto-registered new user via OIDC SSO: ${user.username} (${user.id})`);
    }

    const token = signAuthToken({ sub: user.id, username: user.username, role: user.role });
    res.setHeader(
      'Set-Cookie',
      `graywood_auth=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(AUTH_TOKEN_TTL_MS / 1000)}`
    );

    res.json({
      success: true,
      token,
      user: toPublicUser(user),
    });
  } catch (err: any) {
    logger.error('Auth', 'OIDC Callback failed', { error: err.message });
    res.status(500).json({ error: 'OIDC SSO authentication failed', details: err.message });
  }
});