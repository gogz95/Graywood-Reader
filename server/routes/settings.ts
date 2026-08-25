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
  flushStateNow,
  userProfiles,
  sanitizeIncomingSettings,
  sanitizeIncomingConfig,
  MASKED_SECRET,
} from '../appState';
import { hashPassword, toPublicUser } from '../security';

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

// POST Initial Setup Wizard Complete (host-only; atomically configures admin & server settings in SQLite)
settingsRouter.post("/api/settings/initial-setup", (req, res) => {
  const {
    adminName,
    adminUsername,
    adminPassword,
    selectedLanguage,
    nsfwPolicy,
    defaultReaderMode,
    flareSolverrUrl,
    autoUpdateInterval,
    enableCloudflareBypass,
    pinnedSources,
  } = req.body || {};

  // 1. Update Host Admin Profile in SQLite
  const adminIdx = userProfiles.findIndex((p) => p.id === 'usr_admin');
  if (adminIdx !== -1) {
    if (adminName && typeof adminName === 'string' && adminName.trim()) {
      userProfiles[adminIdx].name = adminName.trim();
    }
    if (adminUsername && typeof adminUsername === 'string' && adminUsername.trim()) {
      userProfiles[adminIdx].username = adminUsername.trim();
    }
    if (adminPassword && typeof adminPassword === 'string' && adminPassword.length >= 6) {
      userProfiles[adminIdx].password = hashPassword(adminPassword);
    }
  }

  // 2. Update Sync Config (Crawler Interval)
  if (typeof autoUpdateInterval === 'number' && autoUpdateInterval > 0) {
    syncConfig.autoUpdateIntervalMinutes = autoUpdateInterval;
  }

  // 3. Update App Settings
  const updatedSettings: any = {
    ...appSettings,
    initialSetupCompleted: true,
    initialSetupTimestamp: new Date().toISOString(),
  };

  if (flareSolverrUrl !== undefined) {
    updatedSettings.flareSolverrUrl = flareSolverrUrl;
    updatedSettings.enableCloudflareBypass = enableCloudflareBypass ?? !!flareSolverrUrl;
  }
  if (nsfwPolicy) {
    updatedSettings.privateModeEnabled = nsfwPolicy === 'safe';
  }
  if (selectedLanguage) {
    updatedSettings.preferredLanguage = selectedLanguage;
  }
  if (defaultReaderMode) {
    updatedSettings.readerDefaults = {
      ...(appSettings.readerDefaults || {}),
      viewMode: defaultReaderMode,
    };
  }
  if (Array.isArray(pinnedSources)) {
    updatedSettings.pinnedSources = pinnedSources;
  }

  setAppSettings(updatedSettings);

  // 4. Synchronously flush to SQLite
  try {
    flushStateNow();
  } catch {
    saveDatabaseToDisk();
  }

  res.json({
    success: true,
    message: 'Initial setup configuration successfully saved to server database.',
    settings: {
      ...appSettings,
      captchaApiKey: appSettings.captchaApiKey ? MASKED_SECRET : '',
      discordWebhookUrl: (appSettings as any).discordWebhookUrl ? MASKED_SECRET : '',
      telegramBotToken: (appSettings as any).telegramBotToken ? MASKED_SECRET : '',
    },
    adminUser: adminIdx !== -1 ? toPublicUser(userProfiles[adminIdx]) : null,
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

// POST /api/backups/upload - Upload and register a backup or migration snapshot
settingsRouter.post("/api/backups/upload", async (req, res) => {
  try {
    const path = await import('path');
    const fs = await import('fs');
    const { getBackupsDirectory } = await import('../services/autoBackupService');
    const { filename, content, data } = req.body || {};

    if (!filename || typeof filename !== 'string') {
      return res.status(400).json({ error: "Filename is required" });
    }

    const safeName = path.basename(filename).replace(/[^a-zA-Z0-9_.-]/g, '_');
    if (!safeName.endsWith('.json') && !safeName.endsWith('.zip')) {
      return res.status(400).json({ error: "Only .json and .zip backup archives are accepted" });
    }

    const targetPath = path.join(getBackupsDirectory(), safeName);
    if (data && typeof data === 'string') {
      // Base64 encoded payload
      fs.writeFileSync(targetPath, Buffer.from(data, 'base64'));
    } else if (content) {
      const text = typeof content === 'object' ? JSON.stringify(content, null, 2) : String(content);
      fs.writeFileSync(targetPath, text, 'utf8');
    } else {
      return res.status(400).json({ error: "No backup data or content provided" });
    }

    res.json({ success: true, filename: safeName, message: `Backup file ${safeName} uploaded successfully.` });
  } catch (err: any) {
    res.status(500).json({ error: `Upload failed: ${err.message}` });
  }
});

// POST /api/settings/db/vacuum - Maintenance vacuum and cache purge for database
settingsRouter.post("/api/settings/db/vacuum", (req, res) => {
  try {
    const { vacuum = true, purgeExpiredCache = true, trimLogsDays = 30 } = req.body || {};
    const result = SqliteDb.performDatabaseMaintenance({
      vacuum: Boolean(vacuum),
      purgeExpiredCache: Boolean(purgeExpiredCache),
      trimLogsDays: Number(trimLogsDays) || 30,
    });

    res.json({
      success: result.success,
      message: "Database vacuum & maintenance completed.",
      result,
    });
  } catch (err: any) {
    res.status(500).json({ error: `Database vacuum failed: ${err.message}` });
  }
});