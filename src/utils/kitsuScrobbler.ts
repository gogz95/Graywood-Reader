/**
 * Kitsu Live Scrobbler for Graywood Reader.
 * Synchronizes chapter reading progress to a user's Kitsu library.
 *
 * Kitsu API docs: https://kitsu.docs.apiary.io/
 */

export interface KitsuMediaMatch {
  id: string;
  title: string;
  chapterCount?: number;
}

export interface KitsuSyncResult {
  ok: boolean;
  mediaId?: string;
  progress?: number;
  error?: string;
}

const KITSU_API_BASE = 'https://kitsu.io/api/edge';

const mediaIdCache = new Map<string, string>();
const lastSyncMap = new Map<string, { progress: number; at: number }>();
const SYNC_DEBOUNCE_MS = 60 * 1000;

function normalizeTitleKey(title: string): string {
  return (title || '').toLowerCase().trim();
}

function kitsuStatusFromAppStatus(status: string): string {
  switch (status) {
    case 'completed': return 'completed';
    case 'plan_to_read': return 'planned';
    case 'on_hold': return 'on_hold';
    case 'dropped': return 'dropped';
    case 'reading':
    default:
      return 'current';
  }
}

export async function searchKitsuManga(title: string): Promise<KitsuMediaMatch | null> {
  try {
    const url = `${KITSU_API_BASE}/manga?filter[text]=${encodeURIComponent(title)}&page[limit]=5`;
    const res = await fetch(url, { headers: { Accept: 'application/vnd.api+json' } });
    if (!res.ok) return null;
    const data: any = await res.json();
    const item = data?.data?.[0];
    if (!item) return null;
    const attr = item.attributes || {};
    return {
      id: item.id,
      title: attr.canonicalTitle || attr.en_jp || 'Unknown',
      chapterCount: attr.chapterCount,
    };
  } catch (err) {
    console.warn(`[Kitsu Scrobbler] Search failed for "${title}":`, err);
    return null;
  }
}

export async function getKitsuMediaId(title: string): Promise<string | null> {
  const key = normalizeTitleKey(title);
  if (!key) return null;
  const cached = mediaIdCache.get(key);
  if (cached) return cached;
  const match = await searchKitsuManga(title);
  if (match && match.id) {
    mediaIdCache.set(key, match.id);
    return match.id;
  }
  return null;
}

function buildLibraryEntryPayload(mediaId: string, progress: number, status: string, existingId?: string) {
  const payload: any = {
    data: {
      type: 'libraryEntries',
      attributes: {
        progress,
        status: kitsuStatusFromAppStatus(status),
      },
      relationships: {
        media: {
          data: { type: 'manga', id: mediaId },
        },
      },
    },
  };
  if (existingId) {
    payload.data.id = existingId;
  }
  return payload;
}

export async function syncKitsuProgress(
  token: string,
  mediaId: string,
  chapterNumber: number,
  appStatus: string = 'reading'
): Promise<KitsuSyncResult> {
  if (!token || !mediaId) {
    return { ok: false, error: 'Kitsu token or Media ID missing' };
  }

  const progress = Math.floor(chapterNumber);
  const now = Date.now();
  const last = lastSyncMap.get(mediaId);
  if (last && last.progress === progress && now - last.at < SYNC_DEBOUNCE_MS) {
    return { ok: true, mediaId, progress };
  }

  const authHeaders = {
    Authorization: `Bearer ${token.trim()}`,
    Accept: 'application/vnd.api+json',
    'Content-Type': 'application/vnd.api+json',
  };

  try {
    // Try to find an existing library entry for this manga.
    let existingId: string | undefined;
    try {
      const listRes = await fetch(`${KITSU_API_BASE}/library-entries?filter[userId]=@me&filter[mediaType]=Manga&filter[mediaId]=${mediaId}`, { headers: authHeaders });
      if (listRes.ok) {
        const listData: any = await listRes.json();
        existingId = listData?.data?.[0]?.id;
      }
    } catch {
      // ignore and fall through to upsert attempt
    }

    const payload = buildLibraryEntryPayload(mediaId, progress, appStatus, existingId);
    const method = existingId ? 'PATCH' : 'POST';
    const url = existingId
      ? `${KITSU_API_BASE}/library-entries/${existingId}`
      : `${KITSU_API_BASE}/library-entries`;

    const res = await fetch(url, {
      method,
      headers: authHeaders,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { ok: false, error: `HTTP ${res.status}: ${errText}` };
    }

    lastSyncMap.set(mediaId, { progress, at: Date.now() });
    return { ok: true, mediaId, progress };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Failed to update Kitsu' };
  }
}
