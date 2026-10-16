// ============================================================================
// src/services/scrobbleDispatcher.ts — Unified Frontend Scrobbler Dispatcher
// Dispatches reading progress concurrently to AniList, MyAnimeList, and Kitsu.
// ============================================================================

import { MangaItem } from '../types';
import { useSettingsStore } from '../stores/useSettingsStore';
import { getAniListMediaId, syncAniListProgress, AniListSyncResult } from '../utils/aniListScrobbler';
import { getMALMediaId, syncMALProgress, MALSyncResult } from '../utils/malScrobbler';
import { getKitsuMediaId, syncKitsuProgress, KitsuSyncResult } from '../utils/kitsuScrobbler';

export interface ScrobbleOptions {
  userRating?: number;
  isCompleted?: boolean;
}

export interface TrackerSyncReport {
  anilist?: AniListSyncResult;
  mal?: MALSyncResult;
  kitsu?: KitsuSyncResult;
}

/**
 * Dispatches reading progress updates to all connected external tracking services.
 * Designed to execute non-blocking in the background, reporting clean structured results.
 */
export async function syncProgressToTrackers(
  manga: MangaItem,
  chapterNumber: number,
  options: ScrobbleOptions = {}
): Promise<TrackerSyncReport> {
  const { appSettings } = useSettingsStore.getState();
  const report: TrackerSyncReport = {};
  const isCompleted = options.isCompleted ?? manga.status === 'completed';

  const tasks: Promise<void>[] = [];

  // 1. AniList Scrobbler
  if (appSettings.anilistConnected && appSettings.anilistToken && appSettings.anilistAutoSync) {
    tasks.push(
      (async () => {
        try {
          const mediaId = await getAniListMediaId(manga.title);
          if (mediaId && appSettings.anilistToken) {
            report.anilist = await syncAniListProgress(
              appSettings.anilistToken,
              mediaId,
              chapterNumber,
              isCompleted
            );
          }
        } catch (err: any) {
          report.anilist = { ok: false, error: err?.message || 'AniList sync failed' };
        }
      })()
    );
  }

  // 2. MyAnimeList Scrobbler
  if (appSettings.malConnected && appSettings.malToken && appSettings.malAutoSync) {
    tasks.push(
      (async () => {
        try {
          const mediaId = await getMALMediaId(manga.title);
          if (mediaId && appSettings.malToken) {
            report.mal = await syncMALProgress(
              appSettings.malToken,
              mediaId,
              chapterNumber,
              manga.status
            );
          }
        } catch (err: any) {
          report.mal = { ok: false, error: err?.message || 'MAL sync failed' };
        }
      })()
    );
  }

  // 3. Kitsu Scrobbler
  if (appSettings.kitsuConnected && appSettings.kitsuToken && appSettings.kitsuAutoSync) {
    tasks.push(
      (async () => {
        try {
          const mediaId = await getKitsuMediaId(manga.title);
          if (mediaId && appSettings.kitsuToken) {
            report.kitsu = await syncKitsuProgress(
              appSettings.kitsuToken,
              mediaId,
              chapterNumber,
              manga.status
            );
          }
        } catch (err: any) {
          report.kitsu = { ok: false, error: err?.message || 'Kitsu sync failed' };
        }
      })()
    );
  }

  await Promise.allSettled(tasks);
  return report;
}
