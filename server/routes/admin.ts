import { Router } from 'express';
import crypto from 'crypto';
import { UserProfile, UserRole } from '../../src/types';
import { SqliteDb } from '../../sqlite-db';
import { logger } from '../logger';
import { toPublicUser, isHostRequest, hashPassword } from '../security';
import {
  userProfiles,
  setUserProfiles,
  reloadMangaFromSql,
  saveDatabaseToDisk,
  flushStateNow,
} from '../appState';

// ============================================================================
// ADMIN USER MANAGEMENT & DOUBLE CONFIRMATION
// Extracted from server.ts. The host-only gate below mirrors the earlier
// app.use("/api/admin", ...) middleware so admin endpoints stay restricted
// strictly to the host computer.
// ============================================================================

export const adminRouter = Router();

// Restrict all Admin operations strictly to the Host Computer or Authenticated Administrators
adminRouter.use("/api/admin", (req, res, next) => {
  const user = (req as any).user;
  if (!isHostRequest(req) && !(user && user.role === 'admin')) {
    return res.status(403).json({
      error: "Forbidden",
      message: "Admin functionality is restricted to the host computer or authenticated administrators.",
    });
  }
  next();
});

// Get All Users List (Admin) — public DTOs only (no password hashes)
adminRouter.get("/api/admin/users", (_req, res) => {
  res.json(userProfiles.map(toPublicUser));
});

// Admin User Role Promotion/Demotion
adminRouter.post("/api/admin/users/promote", (req, res) => {
  const { userId, role } = req.body || {};
  if (!userId || !role) return res.status(400).json({ error: "userId and role are required" });

  if (userId === 'usr_admin' || userId === 'usr_guest') {
    return res.status(403).json({ error: "Host Administrator and Permanent Guest Reader accounts cannot be demoted." });
  }

  const idx = userProfiles.findIndex((u) => u.id === userId);
  if (idx === -1) return res.status(404).json({ error: "User not found" });

  userProfiles[idx].role = role as UserRole;
  try {
    flushStateNow();
  } catch {
    saveDatabaseToDisk();
  }
  logger.info('Admin', `User ${userProfiles[idx].name} (${userId}) role updated to ${role}.`);
  res.json({ success: true, user: toPublicUser(userProfiles[idx]) });
});

// Admin User Permissions & Age Gate Setting
adminRouter.post("/api/admin/users/permissions", (req, res) => {
  const { userId, allowNsfw, maxAgeRating } = req.body || {};
  if (!userId) return res.status(400).json({ error: "userId is required" });

  const idx = userProfiles.findIndex((u) => u.id === userId);
  if (idx === -1) return res.status(404).json({ error: "User not found" });

  if (allowNsfw !== undefined) {
    userProfiles[idx].allowNsfw = Boolean(allowNsfw);
  }
  if (maxAgeRating && ['all', 'pg', 'pg13', '18+'].includes(maxAgeRating)) {
    userProfiles[idx].maxAgeRating = maxAgeRating;
  }

  try {
    flushStateNow();
  } catch {
    saveDatabaseToDisk();
  }
  logger.info('Admin', `Updated permissions for user "${userProfiles[idx].name}" (${userId}): allowNsfw=${userProfiles[idx].allowNsfw}, maxAgeRating=${userProfiles[idx].maxAgeRating}`);
  res.json({ success: true, user: toPublicUser(userProfiles[idx]) });
});

// Admin Reset User Password
adminRouter.post("/api/admin/users/:userId/reset-password", (req, res) => {
  const { userId } = req.params;
  const { newPassword } = req.body || {};

  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
    return res.status(400).json({
      error: "Bad Request",
      message: "New password must be at least 8 characters long.",
    });
  }

  const user = userProfiles.find((u) => u.id === userId);
  if (!user) {
    return res.status(404).json({ error: "User not found." });
  }

  user.password = hashPassword(newPassword);
  try {
    flushStateNow();
  } catch {
    saveDatabaseToDisk();
  }

  logger.info('Admin', `Password reset by Admin for user "${user.username}" (${userId}).`);
  res.json({
    success: true,
    message: `Password for user "${user.name}" (@${user.username}) was successfully reset.`,
  });
});

// Admin Provision New User Account
adminRouter.post("/api/admin/users/create", (req, res) => {
  const { name, username, email, password, avatar, role } = req.body || {};

  if (!name || !username || !email || !password) {
    return res.status(400).json({
      error: "Bad Request",
      message: "Name, username, email, and password are required.",
    });
  }

  if (password.length < 8) {
    return res.status(400).json({
      error: "Bad Request",
      message: "Password must be at least 8 characters long.",
    });
  }

  const cleanEmail = String(email).trim().toLowerCase();
  const cleanUsername = String(username).trim().toLowerCase();

  const taken = userProfiles.some(
    (u) =>
      (u.username || '').toLowerCase() === cleanUsername ||
      (u.email || '').toLowerCase() === cleanEmail
  );
  if (taken) {
    return res.status(409).json({
      error: "Conflict",
      message: "Username or email is already registered.",
    });
  }

  const newUser: UserProfile = {
    id: 'usr_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex'),
    name: String(name).trim(),
    username: String(username).trim(),
    email: cleanEmail,
    password: hashPassword(password),
    avatar: String(avatar || '🥷').trim() || '🥷',
    role: (role === 'admin' ? 'admin' : 'user') as UserRole,
    createdAt: new Date().toISOString(),
  };

  userProfiles.push(newUser);
  try {
    flushStateNow();
  } catch {
    saveDatabaseToDisk();
  }

  logger.info('Admin', `Provisioned new user "${newUser.username}" (${newUser.id}) with role=${newUser.role}`);
  res.status(201).json({
    success: true,
    user: toPublicUser(newUser),
  });
});

// Admin Delete User with MANDATORY Double Confirmation
adminRouter.delete("/api/admin/users/:userId", (req, res) => {
  const { userId } = req.params;
  const { confirm } = req.body || {};

  // Check mandatory double confirmation payload
  if (confirm !== true) {
    return res.status(400).json({
      error: "Mandatory double-confirmation required. Set 'confirm: true' in request body to delete user account.",
      requiresConfirmation: true,
    });
  }

  const user = userProfiles.find((u) => u.id === userId);
  if (!user) {
    return res.status(404).json({ error: "User profile not found." });
  }

  if (user.id === 'usr_admin' || user.id === 'usr_guest' || user.role === 'admin') {
    return res.status(403).json({ error: "Host Administrator and Permanent Guest Reader accounts are protected and non-deletable." });
  }

  // Cascade purge in SQLite (profile + owned manga + reading progress/activity)
  const result = SqliteDb.purgeUserData(userId);
  setUserProfiles(userProfiles.filter((u) => u.id !== userId));
  reloadMangaFromSql();
  try {
    flushStateNow();
  } catch {
    saveDatabaseToDisk();
  }
  logger.info('Admin', `User "${user.name}" (${userId}) permanently deleted after double-confirmation. (${result.mangaDeleted} library records purged from SQLite)`);

  res.json({
    success: true,
    message: `User account '${user.name}' and ${result.mangaDeleted} associated library records permanently deleted.`,
    deletedUserId: userId,
    remainingUsers: userProfiles.map(toPublicUser),
  });
});

// ============================================================================
// SERVER MIGRATION & DISASTER RECOVERY ENGINE (Host / Admin Only)
// ============================================================================

// GET /api/admin/migration/export - Export complete standalone migration package (.zip)
adminRouter.get("/api/admin/migration/export", async (req, res) => {
  try {
    const { createMigrationPackage } = await import('../services/migrationService');
    const label = typeof req.query?.label === 'string' ? req.query.label : 'server_migration';
    const pkg = await createMigrationPackage({ customLabel: label });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${pkg.filename}"`);
    res.setHeader('X-Migration-Format-Version', String(pkg.manifest.formatVersion));
    res.setHeader('X-Migration-Series-Count', String(pkg.manifest.tableCounts.manga));
    res.send(pkg.buffer);
  } catch (err: any) {
    logger.error('Admin', 'Failed to export migration package', { error: err.message });
    res.status(500).json({ error: `Migration export failed: ${err.message}` });
  }
});

// POST /api/admin/migration/restore - Restore server from migration package (.zip or .json)
adminRouter.post("/api/admin/migration/restore", async (req, res) => {
  try {
    const { restoreMigrationPackage } = await import('../services/migrationService');
    let payload: Buffer | string;

    if (Buffer.isBuffer(req.body)) {
      payload = req.body;
    } else if (req.body?.data && typeof req.body.data === 'string') {
      // Base64 encoded payload
      payload = Buffer.from(req.body.data, 'base64');
    } else if (typeof req.body === 'object' && req.body !== null) {
      payload = Buffer.from(JSON.stringify(req.body), 'utf8');
    } else if (typeof req.body === 'string') {
      payload = Buffer.from(req.body, 'utf8');
    } else {
      return res.status(400).json({ error: "Invalid request: No migration package payload provided." });
    }

    const mode = req.query?.mode === 'merge' ? 'merge' : 'replace';
    const result = await restoreMigrationPackage(payload, { mode });

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);
  } catch (err: any) {
    logger.error('Admin', 'Failed to restore migration package', { error: err.message });
    res.status(500).json({ error: `Migration restore failed: ${err.message}` });
  }
});

// ============================================================================
// DATABASE MAINTENANCE & VACUUM (Host / Admin Only)
// ============================================================================

// POST /api/admin/maintenance/optimize - Trigger SQLite maintenance, cache purge, WAL truncation, and defragmentation
adminRouter.post("/api/admin/maintenance/optimize", (req, res) => {
  try {
    const { vacuum, purgeExpiredCache, trimLogsDays } = req.body || {};
    const result = SqliteDb.performDatabaseMaintenance({
      vacuum: Boolean(vacuum),
      purgeExpiredCache: purgeExpiredCache !== false,
      trimLogsDays: trimLogsDays !== undefined ? Number(trimLogsDays) : 30,
    });

    res.json({
      success: result.success,
      message: "Database optimization and maintenance completed successfully.",
      result,
    });
  } catch (err: any) {
    logger.error('Admin', 'Database maintenance failed', { error: err.message });
    res.status(500).json({ error: `Database maintenance failed: ${err.message}` });
  }
});