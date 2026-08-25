/**
 * Unified Multi-Tracker Service for Graywood Reader.
 * Supports AniList, MyAnimeList (MAL), and Kitsu reading progress sync.
 */

import { syncAniListProgress, getAniListMediaId } from './aniListScrobbler';

export type TrackerService = 'anilist' | 'myanimelist' | 'kitsu';

export interface TrackerAccountConfig {
  service: TrackerService;
  enabled: boolean;
  token?: string;
  username?: string;
}

export interface TrackerSyncResult {
  service: TrackerService;
  success: boolean;
  message?: string;
  error?: string;
}

export interface KitsuMangaMatch {
  id: string;
  attributes: {
    canonicalTitle: string;
    chapterCount?: number;
    posterImage?: {
      medium?: string;
    };
  };
}

/**
 * Search Kitsu API for a manga title.
 */
export async function searchKitsuManga(title: string): Promise<KitsuMangaMatch | null> {
  try {
    const url = `https://kitsu.io/api/edge/manga?filter[text]=${encodeURIComponent(title)}&page[limit]=1`;
    const res = await fetch(url, {
      headers: {
        Accept: 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.data?.[0] || null;
  } catch (err) {
    console.warn(`[MultiTracker] Kitsu search failed for "${title}":`, err);
    return null;
  }
}

/**
 * Sync reading progress to Kitsu.
 */
export async function syncKitsuProgress(
  token: string,
  kitsuUserId: string,
  mangaTitle: string,
  chapterNumber: number
): Promise<TrackerSyncResult> {
  if (!token) {
    return { service: 'kitsu', success: false, error: 'Missing Kitsu access token' };
  }

  try {
    const match = await searchKitsuManga(mangaTitle);
    if (!match || !match.id) {
      return { service: 'kitsu', success: false, error: `Series "${mangaTitle}" not found on Kitsu` };
    }

    const payload = {
      data: {
        type: 'libraryEntries',
        attributes: {
          progress: Math.floor(chapterNumber),
          status: 'current',
        },
        relationships: {
          user: {
            data: { type: 'users', id: kitsuUserId },
          },
          media: {
            data: { type: 'manga', id: match.id },
          },
        },
      },
    };

    const res = await fetch('https://kitsu.io/api/edge/library-entries', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/vnd.api+json',
        Accept: 'application/vnd.api+json',
      },
      body: JSON.stringify(payload),
    });

    if (res.ok || res.status === 201 || res.status === 200) {
      return { service: 'kitsu', success: true, message: `Synced ch ${chapterNumber} to Kitsu` };
    }

    return { service: 'kitsu', success: false, error: `Kitsu returned HTTP ${res.status}` };
  } catch (err: any) {
    return { service: 'kitsu', success: false, error: err?.message || String(err) };
  }
}

/**
 * Broadcast progress sync to all configured trackers.
 */
export async function syncAllTrackers(
  title: string,
  chapterNumber: number,
  trackers: {
    aniListToken?: string;
    kitsuToken?: string;
    kitsuUserId?: string;
  }
): Promise<TrackerSyncResult[]> {
  const results: TrackerSyncResult[] = [];

  // 1. AniList
  if (trackers.aniListToken) {
    try {
      const mediaId = await getAniListMediaId(title);
      if (mediaId) {
        const res = await syncAniListProgress(trackers.aniListToken, mediaId, chapterNumber);
        results.push({
          service: 'anilist',
          success: res.ok,
          error: res.error,
        });
      } else {
        results.push({ service: 'anilist', success: false, error: `Could not resolve AniList media ID for "${title}"` });
      }
    } catch (err: any) {
      results.push({ service: 'anilist', success: false, error: err?.message || String(err) });
    }
  }

  // 2. Kitsu
  if (trackers.kitsuToken && trackers.kitsuUserId) {
    try {
      const res = await syncKitsuProgress(trackers.kitsuToken, trackers.kitsuUserId, title, chapterNumber);
      results.push(res);
    } catch (err: any) {
      results.push({ service: 'kitsu', success: false, error: err?.message || String(err) });
    }
  }

  return results;
}
