// ============================================================================
// sqlite-db.ts — Backward-Compatible Barrel Re-Export
// Decomposed into domain modules under db/ for maintainability and scalability.
// ============================================================================

import * as mangaDb from './db/manga';
import * as usersDb from './db/users';
import * as progressDb from './db/progress';
import * as categoriesDb from './db/categories';
import * as readlistsDb from './db/readlists';
import * as downloadsDb from './db/downloads';
import * as cacheDb from './db/cache';
import * as authDb from './db/auth';
import * as notesDb from './db/notes';
import * as maintenanceDb from './db/maintenance';

export { db, DATA_DIR, DB_PATH } from './db/connection';
export type { PersistedDownloadJob } from './db/downloads';
export type { DatabaseMaintenanceResult } from './db/maintenance';

export {
  purgeReaperScans,
  purgeTestRemnants,
  rekeyCollidedSourceIds,
  migrateJsonToSqlite,
  invalidateMangaCache,
} from './db/manga';

export {
  getStickyNotes,
  saveStickyNote,
  deleteStickyNote,
} from './db/notes';

export { optimizeDatabase } from './db/maintenance';

/**
 * Unified SqliteDb Service Interface
 * Backward-compatible object facade delegating to modular domain functions.
 */
export const SqliteDb = {
  // Manga
  getAllManga: mangaDb.getAllManga,
  queryManga: (options: Parameters<typeof mangaDb.queryManga>[0]) =>
    mangaDb.queryManga(options, usersDb.applyUserOverlay),
  invalidateMangaCache: mangaDb.invalidateMangaCache,
  rekeyCollidedSourceIds: mangaDb.rekeyCollidedSourceIds,
  purgeTestRemnants: mangaDb.purgeTestRemnants,
  getMangaById: mangaDb.getMangaById,
  getMangaByApiId: mangaDb.getMangaByApiId,
  upsertManga: mangaDb.upsertManga,
  bulkUpsertManga: mangaDb.bulkUpsertManga,
  updateChapterProgress: mangaDb.updateChapterProgress,
  toggleFavorite: mangaDb.toggleFavorite,
  toggleFlag: mangaDb.toggleFlag,
  deleteManga: mangaDb.deleteManga,
  deleteMangaByUserId: mangaDb.deleteMangaByUserId,
  purgeReaperScans: mangaDb.purgeReaperScans,
  deleteAllManga: mangaDb.deleteAllManga,
  getMangaCount: mangaDb.getMangaCount,

  // Users & Profiles
  getAllProfiles: usersDb.getAllProfiles,
  getProfileById: usersDb.getProfileById,
  upsertProfile: usersDb.upsertProfile,
  deleteProfile: usersDb.deleteProfile,
  replaceAllProfiles: usersDb.replaceAllProfiles,
  setUserFavorite: usersDb.setUserFavorite,
  getUserFavoriteIds: usersDb.getUserFavoriteIds,
  isUserFavorite: usersDb.isUserFavorite,
  setUserLibraryChapter: usersDb.setUserLibraryChapter,
  getUserLibraryStateMap: usersDb.getUserLibraryStateMap,
  applyUserOverlayOne: usersDb.applyUserOverlayOne,
  applyUserOverlay: usersDb.applyUserOverlay,
  purgeUserData: usersDb.purgeUserData,
  deleteReadingDataForUser: progressDb.deleteReadingDataForUser,

  // Reading Progress & Activity
  upsertReadingProgress: progressDb.upsertReadingProgress,
  getReadingProgress: progressDb.getReadingProgress,
  getReadingProgressForChapter: progressDb.getReadingProgressForChapter,
  recordReadingActivity: progressDb.recordReadingActivity,
  getReadingActivity: progressDb.getReadingActivity,
  getAllReadingProgressForUser: progressDb.getAllReadingProgressForUser,

  // Categories
  getCategories: categoriesDb.getCategories,
  createCategory: categoriesDb.createCategory,
  updateCategory: categoriesDb.updateCategory,
  deleteCategory: categoriesDb.deleteCategory,
  getMangaCategories: categoriesDb.getMangaCategories,
  setMangaCategories: categoriesDb.setMangaCategories,
  bulkAssignCategory: categoriesDb.bulkAssignCategory,
  bulkApplyUserImportState: categoriesDb.bulkApplyUserImportState,

  // Readlists
  getReadlists: readlistsDb.getReadlists,
  getReadlistById: readlistsDb.getReadlistById,
  createReadlist: readlistsDb.createReadlist,
  updateReadlist: readlistsDb.updateReadlist,
  deleteReadlist: readlistsDb.deleteReadlist,
  addReadlistItem: readlistsDb.addReadlistItem,
  removeReadlistItem: readlistsDb.removeReadlistItem,
  setReadlistItems: readlistsDb.setReadlistItems,

  // Download Jobs
  saveDownloadJob: downloadsDb.saveDownloadJob,
  getDownloadJobs: downloadsDb.getDownloadJobs,
  getDownloadJobById: downloadsDb.getDownloadJobById,
  deleteDownloadJob: downloadsDb.deleteDownloadJob,
  clearCompletedDownloadJobs: downloadsDb.clearCompletedDownloadJobs,

  // Settings & Cache
  getSetting: cacheDb.getSetting,
  setSetting: cacheDb.setSetting,
  getAllLogs: cacheDb.getAllLogs,
  replaceAllLogs: cacheDb.replaceAllLogs,
  getExploreBuffer: cacheDb.getExploreBuffer,
  setExploreBuffer: cacheDb.setExploreBuffer,
  getSourceHealthMap: cacheDb.getSourceHealthMap,
  setSourceHealthMap: cacheDb.setSourceHealthMap,
  getSeriesReaderSettings: cacheDb.getSeriesReaderSettings,
  setSeriesReaderSettings: cacheDb.setSeriesReaderSettings,
  getLibraryCache: cacheDb.getLibraryCache,
  setLibraryCache: cacheDb.setLibraryCache,
  getCachedChapterPages: cacheDb.getCachedChapterPages,
  setCachedChapterPages: cacheDb.setCachedChapterPages,
  cleanupExpiredChapterPages: cacheDb.cleanupExpiredChapterPages,

  // Auth & Token Revocation
  revokeToken: authDb.revokeToken,
  isTokenRevoked: authDb.isTokenRevoked,
  cleanupExpiredRevokedTokens: authDb.cleanupExpiredRevokedTokens,

  // Notes
  getStickyNotes: notesDb.getStickyNotes,
  saveStickyNote: notesDb.saveStickyNote,
  deleteStickyNote: notesDb.deleteStickyNote,

  // Maintenance & Migration
  exportFullDatabaseDump: maintenanceDb.exportFullDatabaseDump,
  importFullDatabaseDump: maintenanceDb.importFullDatabaseDump,
  createLiveDatabaseBackup: maintenanceDb.createLiveDatabaseBackup,
  performDatabaseMaintenance: maintenanceDb.performDatabaseMaintenance,
};
