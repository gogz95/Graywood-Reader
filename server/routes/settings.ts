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
  // Secrets never leave the server in plaintext: the captcha API key is
  // replaced by a mask sentinel for EVERY caller (host UI included — the
  // password input shows it as set without exposing the value).
  res.json({
    ...appSettings,
    captchaApiKey: appSettings.captchaApiKey ? MASKED_SECRET : '',
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