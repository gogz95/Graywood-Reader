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

// Restrict all Admin operations strictly to the Host Computer
adminRouter.use("/api/admin", (req, res, next) => {
  if (!isHostRequest(req)) {
    return res.status(403).json({
      error: "Forbidden",
      message: "Admin functionality is strictly restricted to the host computer.",
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