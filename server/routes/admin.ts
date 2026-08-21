import { Router } from 'express';
import { UserRole } from '../../src/types';
import { SqliteDb } from '../../sqlite-db';
import { logger } from '../logger';
import { toPublicUser, isHostRequest } from '../security';
import {
  userProfiles,
  setUserProfiles,
  reloadMangaFromSql,
  saveDatabaseToDisk,
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
  saveDatabaseToDisk();
  logger.info('Admin', `User ${userProfiles[idx].name} (${userId}) role updated to ${role}.`);
  res.json({ success: true, user: toPublicUser(userProfiles[idx]) });
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
  saveDatabaseToDisk();
  logger.info('Admin', `User "${user.name}" (${userId}) permanently deleted after double-confirmation. (${result.mangaDeleted} library records purged from SQLite)`);

  res.json({
    success: true,
    message: `User account '${user.name}' and ${result.mangaDeleted} associated library records permanently deleted.`,
    deletedUserId: userId,
    remainingUsers: userProfiles.map(toPublicUser),
  });
});