import { Router } from 'express';
import { SqliteDb } from '../../sqlite-db';
import { APP_VERSION } from '../version';
import {
  appSettings,
  setAppSettings,
  syncConfig,
  applySyncConfigPatch,
  syncBulkAddOrUpdateManga,
  saveDatabaseToDisk,
  sanitizeIncomingSettings,
  sanitizeIncomingConfig,
  MASKED_SECRET,
} from '../appState';

// ============================================================================
// APP SETTINGS & BACKUP IMPORT/EXPORT ROUTES
// Extracted from server.ts. Both settings endpoints stay host-only via the
// global host-gate middleware (SENSITIVE_GET_PATHS) mounted in server.ts.
// ============================================================================

export const settingsRouter = Router();

// GET Settings
settingsRouter.get("/api/settings", (_req, res) => {
  // Secrets never leave the server in plaintext: captcha API keys and webhook
  // URLs/tokens are replaced by a mask sentinel for EVERY caller.
  res.json({
    ...appSettings,
    captchaApiKey: appSettings.captchaApiKey ? MASKED_SECRET : '',
    discordWebhookUrl: (appSettings as any).discordWebhookUrl ? MASKED_SECRET : '',
    telegramBotToken: (appSettings as any).telegramBotToken ? MASKED_SECRET : '',
  });
});

// POST Update Settings (host-only; whitelisted fields only)
settingsRouter.post("/api/settings", (req, res) => {
  if (req.body) {
    const clean = sanitizeIncomingSettings(req.body);
    setAppSettings({
      ...appSettings,
      ...clean,
      readerDefaults: {
        ...appSettings.readerDefaults,
        ...(clean.readerDefaults || {}),
      },
    });
    saveDatabaseToDisk();
  }
  res.json({
    success: true,
    settings: {
      ...appSettings,
      captchaApiKey: appSettings.captchaApiKey ? MASKED_SECRET : '',
      discordWebhookUrl: (appSettings as any).discordWebhookUrl ? MASKED_SECRET : '',
      telegramBotToken: (appSettings as any).telegramBotToken ? MASKED_SECRET : '',
    },
  });
});

// Export Backup JSON (host-only — see SENSITIVE_GET_PATHS)
settingsRouter.get("/api/settings/backup/export", (_req, res) => {
  const backup = {
    version: `${APP_VERSION}-kotatsu`,
    exportedAt: new Date().toISOString(),
    mangaDatabase: SqliteDb.getAllManga(),
    config: syncConfig,
    // Secret material is masked in exports; import keeps the existing key.
    appSettings: {
      ...appSettings,
      captchaApiKey: appSettings.captchaApiKey ? MASKED_SECRET : '',
      discordWebhookUrl: (appSettings as any).discordWebhookUrl ? MASKED_SECRET : '',
      telegramBotToken: (appSettings as any).telegramBotToken ? MASKED_SECRET : '',
    },
  };

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="graywood_reader_backup.json"');
  res.send(JSON.stringify(backup, null, 2));
});

// Import Backup JSON (host-only; all incoming keys whitelisted)
settingsRouter.post("/api/settings/backup/import", (req, res) => {
  try {
    const { mangaDatabase: importedManga, config: importedConfig, appSettings: importedSettings } = req.body;
    if (Array.isArray(importedManga)) {
      syncBulkAddOrUpdateManga(importedManga);
    }
    if (importedConfig) {
      applySyncConfigPatch(sanitizeIncomingConfig(importedConfig));
    }
    if (importedSettings) {
      const cleanSettings = sanitizeIncomingSettings(importedSettings);
      setAppSettings({
        ...appSettings,
        ...cleanSettings,
        readerDefaults: {
          ...appSettings.readerDefaults,
          ...(cleanSettings.readerDefaults || {}),
        },
      });
    }
    saveDatabaseToDisk();
    res.json({ success: true, count: SqliteDb.getMangaCount() });
  } catch (err: any) {
    res.status(400).json({ error: "Invalid backup format" });
  }
});

// Export Kotatsu Backup JSON (host-only)
settingsRouter.get("/api/settings/backup/export-kotatsu", async (_req, res) => {
  try {
    const { exportToKotatsuBackup } = await import('../../src/utils/kotatsuImporter');
    const mangaList = SqliteDb.getAllManga();
    const jsonStr = exportToKotatsuBackup(mangaList);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="kotatsu_backup.json"');
    res.send(jsonStr);
  } catch (err: any) {
    res.status(500).json({ error: `Export failed: ${err.message}` });
  }
});

// Import Kotatsu Backup (host-only; accepts JSON or parsed payload)
settingsRouter.post("/api/settings/backup/import-kotatsu", async (req, res) => {
  try {
    const { parseKotatsuBackup } = await import('../../src/utils/kotatsuImporter');
    const payload = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const items = await parseKotatsuBackup(payload, 'usr_admin');
    if (items.length > 0) {
      syncBulkAddOrUpdateManga(items);
      const userStateBatch = items.map((item) => ({
        id: item.id,
        isFavorite: item.isFavorite,
        currentChapter: item.currentChapter,
        status: item.status,
        categoryIds: item.categories,
      }));
      SqliteDb.bulkApplyUserImportState('usr_admin', userStateBatch);
    }
    saveDatabaseToDisk();
    res.json({ success: true, count: items.length, totalTracked: SqliteDb.getMangaCount() });
  } catch (err: any) {
    res.status(400).json({ error: `Invalid Kotatsu backup: ${err.message}` });
  }
});

// ============================================================================
// SCHEDULED LOCAL BACKUPS API
// ============================================================================

// GET /api/backups - List local automated backups
settingsRouter.get("/api/backups", async (_req, res) => {
  const { listLocalBackups } = await import('../services/autoBackupService');
  res.json({
    backups: listLocalBackups(),
    settings: {
      autoBackupEnabled: appSettings.autoBackupEnabled,
      autoBackupSchedule: appSettings.autoBackupSchedule,
      autoBackupMaxCount: appSettings.autoBackupMaxCount,
      autoBackupLastRun: appSettings.autoBackupLastRun,
    },
  });
});

// POST /api/backups/create - Trigger manual backup snapshot
settingsRouter.post("/api/backups/create", async (req, res) => {
  const { createBackupNow } = await import('../services/autoBackupService');
  const label = typeof req.body?.label === 'string' ? req.body.label : 'manual';
  const result = createBackupNow(label);
  if (!result.success) {
    return res.status(500).json({ error: result.error || 'Failed to create backup' });
  }
  res.json({ success: true, filename: result.filename });
});

// POST /api/backups/:filename/restore - Restore local backup
settingsRouter.post("/api/backups/:filename/restore", async (req, res) => {
  const { restoreLocalBackup } = await import('../services/autoBackupService');
  const filename = req.params.filename;
  const result = restoreLocalBackup(filename);
  if (!result.success) {
    return res.status(400).json({ error: result.message });
  }
  res.json(result);
});

// DELETE /api/backups/:filename - Delete local backup
settingsRouter.delete("/api/backups/:filename", async (req, res) => {
  const { deleteLocalBackup } = await import('../services/autoBackupService');
  const filename = req.params.filename;
  const result = deleteLocalBackup(filename);
  if (!result.success) {
    return res.status(404).json({ error: result.error || 'Backup not found' });
  }
  res.json({ success: true });
});

// GET /api/backups/:filename/download - Download specific backup file
settingsRouter.get("/api/backups/:filename/download", async (req, res) => {
  const path = await import('path');
  const fs = await import('fs');
  const { getBackupsDirectory } = await import('../services/autoBackupService');
  const safeName = path.basename(req.params.filename);
  const fullPath = path.join(getBackupsDirectory(), safeName);
  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  res.download(fullPath, safeName);
});