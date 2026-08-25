import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { settingsRouter } from '../server/routes/settings';
import { progressRouter } from '../server/routes/progress';
import { appSettings, userProfiles, syncConfig } from '../server/appState';
import { SqliteDb } from '../sqlite-db';

describe('Server Setup, Caching & Data Persistence API', () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(settingsRouter);
    app.use(progressRouter);
  });

  it('POST /api/settings/initial-setup atomically configures admin profile and server settings', async () => {
    const res = await request(app)
      .post('/api/settings/initial-setup')
      .send({
        adminName: 'Chief Administrator',
        adminUsername: 'chiefadmin',
        adminPassword: 'SuperSecurePassword123!',
        selectedLanguage: 'en',
        nsfwPolicy: 'safe',
        defaultReaderMode: 'webtoon-seamless',
        flareSolverrUrl: 'http://localhost:8191/v1',
        autoUpdateInterval: 30,
        enableCloudflareBypass: true,
        pinnedSources: ['asurascans', 'flamecomics'],
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.settings.initialSetupCompleted).toBe(true);
    expect(res.body.settings.flareSolverrUrl).toBe('http://localhost:8191/v1');
    expect(res.body.settings.privateModeEnabled).toBe(true);
    expect(res.body.settings.pinnedSources).toEqual(['asurascans', 'flamecomics']);
    expect(res.body.adminUser.username).toBe('chiefadmin');
    expect(res.body.adminUser.name).toBe('Chief Administrator');

    // Verify in-memory state
    expect(appSettings.initialSetupCompleted).toBe(true);
    expect(syncConfig.autoUpdateIntervalMinutes).toBe(30);

    const admin = userProfiles.find((u) => u.id === 'usr_admin');
    expect(admin?.name).toBe('Chief Administrator');
    expect(admin?.username).toBe('chiefadmin');
  });

  it('POST /api/settings persists pinnedSources and readerDefaults', async () => {
    const res = await request(app)
      .post('/api/settings')
      .send({
        pinnedSources: ['weebcentral', 'manhwa18'],
        readerDefaults: {
          viewMode: 'rtl',
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(appSettings.pinnedSources).toEqual(['weebcentral', 'manhwa18']);
    expect(appSettings.readerDefaults.viewMode).toBe('rtl');
  });

  it('POST /api/progress/import-statistics records imported reading activity and progress in SQLite', async () => {
    const res = await request(app)
      .post('/api/progress/import-statistics')
      .send({
        totalReadingTimeMinutes: 120,
        totalChaptersRead: 45,
        entries: [
          { mangaId: 'test_series_solo', currentChapter: 25 },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const activity = SqliteDb.getReadingActivity('usr_admin');
    expect(activity.length).toBeGreaterThan(0);
  });
});
