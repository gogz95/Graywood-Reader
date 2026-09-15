import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { settingsRouter } from '../server/routes/settings';
import { progressRouter } from '../server/routes/progress';
import { appSettings, userProfiles, syncConfig } from '../server/appState';
import { SqliteDb } from '../db';

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

  it('POST /api/settings/initial-setup enforces minimum 8 characters for admin password', async () => {
    const res = await request(app)
      .post('/api/settings/initial-setup')
      .send({
        adminPassword: 'short',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Bad Request');
    expect(res.body.message).toContain('at least 8 characters');
  });

  it('verifies optimized welcome queries (recently updated, popular, stats, genres)', () => {
    // Seed a couple test series
    SqliteDb.upsertManga({
      id: 'manga_welcome_test_1',
      title: 'Welcome Test Action Series',
      altTitles: ['WTAS'],
      type: 'manhwa',
      coverImage: 'https://example.com/cover1.jpg',
      description: 'Action test series',
      genres: ['Action', 'Fantasy'],
      status: 'reading',
      currentChapter: 1,
      totalChapters: 100,
      latestChapter: 50,
      lastUpdated: new Date(Date.now() - 1000).toISOString(),
      rating: 9.8,
      sourceUrl: 'https://example.com/1',
      sourceName: 'TestSource',
      autoUpdateEnabled: false,
      notes: '',
      addedAt: new Date().toISOString(),
      lastReadAt: new Date().toISOString(),
      isFavorite: true,
      categories: [],
      userId: 'usr_admin',
    });

    SqliteDb.upsertManga({
      id: 'manga_welcome_test_2',
      title: 'Welcome Test Romance Series',
      altTitles: ['WTRS'],
      type: 'manga',
      coverImage: 'https://example.com/cover2.jpg',
      description: 'Romance test series',
      genres: ['Romance', 'Comedy'],
      status: 'completed',
      currentChapter: 10,
      totalChapters: 10,
      latestChapter: 10,
      lastUpdated: new Date().toISOString(),
      rating: 8.5,
      sourceUrl: 'https://example.com/2',
      sourceName: 'TestSource',
      autoUpdateEnabled: false,
      notes: '',
      addedAt: new Date().toISOString(),
      lastReadAt: new Date().toISOString(),
      isFavorite: false,
      categories: [],
      userId: 'usr_admin',
    });

    const recent = SqliteDb.getRecentlyUpdatedManga(5, true);
    expect(recent.length).toBeGreaterThan(0);
    expect(recent[0].id).toBe('manga_welcome_test_2'); // Most recently updated

    const popular = SqliteDb.getPopularManga(5, true);
    expect(popular.length).toBeGreaterThan(0);
    expect(popular.some((m) => m.id === 'manga_welcome_test_1')).toBe(true);

    const stats = SqliteDb.getLibraryStats(true);
    expect(stats.totalSeries).toBeGreaterThanOrEqual(2);
    expect(stats.totalChapters).toBeGreaterThanOrEqual(60);

    const topGenres = SqliteDb.getTopGenres(5, true);
    expect(topGenres.length).toBeGreaterThan(0);
    expect(topGenres.some((g) => g.name === 'Action' || g.name === 'Romance')).toBe(true);

    // Clean up test series
    SqliteDb.deleteManga('manga_welcome_test_1');
    SqliteDb.deleteManga('manga_welcome_test_2');
  });

  it('persists and restores explore buffer entries in SQLite', () => {
    const testEntry = {
      items: [{ id: 'test_series_123', title: 'On Demand Series' }],
      sourceIds: ['test_source_id'],
      builtAt: Date.now(),
      expiresAt: Date.now() + 3600000,
      lastError: null,
    };

    SqliteDb.setExploreBuffer(testEntry);
    const restored = SqliteDb.getExploreBuffer();

    expect(restored).not.toBeNull();
    expect(restored.items.length).toBe(1);
    expect(restored.items[0].title).toBe('On Demand Series');
    expect(restored.sourceIds).toContain('test_source_id');
  });
});
