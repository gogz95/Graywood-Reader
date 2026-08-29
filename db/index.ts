// ============================================================================
// db/index.ts — Canonical SQLite Database Domain Layer
// Unified entrypoint exposing the parameterized DAL and SqliteDb service facade.
// ============================================================================

import * as mangaDb from './manga';
import * as usersDb from './users';
import * as progressDb from './progress';
import * as categoriesDb from './categories';
import * as readlistsDb from './readlists';
import * as downloadsDb from './downloads';
import * as cacheDb from './cache';
import * as authDb from './auth';
import * as notesDb from './notes';
import * as maintenanceDb from './maintenance';

export { db, DATA_DIR, DB_PATH } from './connection';
export type { PersistedDownloadJob } from './downloads';
export type { DatabaseMaintenanceResult } from './maintenance';

export {
  purgeReaperScans,
  purgeTestRemnants,
  rekeyCollidedSourceIds,
  migrateJsonToSqlite,
  invalidateMangaCache,
} from './manga';

export {
  getStickyNotes,
  saveStickyNote,
  deleteStickyNote,
} from './notes';

export { optimizeDatabase } from './maintenance';

/**
 * Unified SqliteDb Service Interface
 * High-performance object facade delegating to modular domain functions.
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
  bulkDeleteManga: mangaDb.bulkDeleteManga,
  deleteMangaByUserId: mangaDb.deleteMangaByUserId,
  purgeReaperScans: mangaDb.purgeReaperScans,
  deleteAllManga: mangaDb.deleteAllManga,
  getMangaCount: mangaDb.getMangaCount,
  ensureMangaPlaceholder: mangaDb.ensureMangaPlaceholder,

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
  getAllUserLibraryStates: usersDb.getAllUserLibraryStates,
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
