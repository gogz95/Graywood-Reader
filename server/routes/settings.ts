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
    }
    saveDatabaseToDisk();
    res.json({ success: true, count: items.length, totalTracked: SqliteDb.getMangaCount() });
  } catch (err: any) {
    res.status(400).json({ error: `Invalid Kotatsu backup: ${err.message}` });
  }
});