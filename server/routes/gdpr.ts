import { Router } from 'express';
import { SqliteDb } from '../../sqlite-db';
import { toPublicUser, isHostRequest } from '../security';
import {
  userProfiles,
  setUserProfiles,
  reloadMangaFromSql,
  saveDatabaseToDisk,
} from '../appState';

// ============================================================================
// GDPR DATA RIGHTS (ARTICLE 15 ACCESS / ARTICLE 17 ERASURE)
// Extracted from server.ts. Both operations remain host-only.
// ============================================================================

export const gdprRouter = Router();

// GDPR Article 15: Right to Access & Data Portability Export
gdprRouter.get("/api/gdpr/export-data/:userId", (req, res) => {
  // Without a real session/token system, GDPR data operations are host-only.
  if (!isHostRequest(req)) {
    return res.status(403).json({ error: "Forbidden", message: "GDPR data operations are restricted to the host computer." });
  }
  const { userId } = req.params;
  const user = userProfiles.find((u) => u.id === userId);
  if (!user) return res.status(404).json({ error: "User not found" });

  const userSeries = SqliteDb.getAllManga().filter((m) => m.userId === userId);
  // Complete Article 15 bundle: profile + owned series + ALL per-user tables
  // (favorites, library state, page-level reading position, daily activity).
  const libraryState = Array.from(SqliteDb.getUserLibraryStateMap(userId).entries()).map(
    ([mangaId, state]) => ({ mangaId, ...state })
  );
  const gdprExportBundle = {
    complianceNotice: "GDPR Article 15 Data Portability Export",
    exportTimestamp: new Date().toISOString(),
    personalData: toPublicUser(user),
    userMangaLibrary: userSeries,
    favorites: Array.from(SqliteDb.getUserFavoriteIds(userId)),
    libraryState,
    readingProgress: SqliteDb.getAllReadingProgressForUser(userId),
    readingActivity: SqliteDb.getReadingActivity(userId),
  };

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="gdpr_export_${userId}.json"`);
  res.send(JSON.stringify(gdprExportBundle, null, 2));
});

// GDPR Article 17: Right to Erasure / Right to be Forgotten
gdprRouter.delete("/api/gdpr/erase-data/:userId", (req, res) => {
  // Without a real session/token system, GDPR data operations are host-only.
  if (!isHostRequest(req)) {
    return res.status(403).json({ error: "Forbidden", message: "GDPR data operations are restricted to the host computer." });
  }
  const { userId } = req.params;
  if (userId === 'usr_admin' || userId === 'usr_guest') {
    return res.status(403).json({
      error: "Forbidden",
      message: "Host Administrator and Permanent Guest Reader accounts cannot be erased via GDPR endpoint.",
    });
  }
  const user = userProfiles.find((u) => u.id === userId);
  if (!user) return res.status(404).json({ error: "User not found" });

  const result = SqliteDb.purgeUserData(userId);
  setUserProfiles(userProfiles.filter((u) => u.id !== userId));
  reloadMangaFromSql();
  saveDatabaseToDisk();
  console.log(`[GDPR Engine] User ${userId} erased. Purged ${result.mangaDeleted} owned series + reading data from SQLite.`);
  res.json({
    success: true,
    message: "All user PII and library data permanently erased in compliance with GDPR Article 17.",
    mangaDeleted: result.mangaDeleted,
  });
});