/**
 * MyAnimeList (MAL) Live Scrobbler for Graywood Reader.
 * Synchronizes chapter reading progress to a user's MAL manga list.
 *
 * MAL API docs: https://myanimelist.net/apiconfig/references/api/v2
 */

export interface MALMediaMatch {
  id: number;
  title: string;
  num_chapters?: number;
  status?: string;
}

export interface MALSyncResult {
  ok: boolean;
  mediaId?: number;
  progress?: number;
  error?: string;
}

const MAL_API_BASE = 'https://api.myanimelist.net/v2';

const mediaIdCache = new Map<string, number>();
const lastSyncMap = new Map<number, { progress: number; at: number }>();
const SYNC_DEBOUNCE_MS = 60 * 1000;

function malStatusFromAppStatus(status: string): string {
  switch (status) {
    case 'completed': return 'completed';
    case 'plan_to_read': return 'plan_to_read';
    case 'on_hold': return 'on_hold';
    case 'dropped': return 'dropped';
    case 'reading':
    default:
      return 'reading';
  }
}

function normalizeTitleKey(title: string): string {
  return (title || '').toLowerCase().trim();
}

export async function searchMALManga(title: string): Promise<MALMediaMatch | null> {
  try {
    const url = `${MAL_API_BASE}/manga?q=${encodeURIComponent(title)}&fields=id,title,num_chapters,status&limit=5`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data: any = await res.json();
    const node = data?.data?.[0]?.node;
    if (!node) return null;
    return {
      id: node.id,
      title: node.title,
      num_chapters: node.num_chapters,
      status: node.status,
    };
  } catch (err) {
    console.warn(`[MAL Scrobbler] Search failed for "${title}":`, err);
    return null;
  }
}

export async function getMALMediaId(title: string): Promise<number | null> {
  const key = normalizeTitleKey(title);
  if (!key) return null;
  const cached = mediaIdCache.get(key);
  if (cached) return cached;
  const match = await searchMALManga(title);
  if (match && match.id) {
    mediaIdCache.set(key, match.id);
    return match.id;
  }
  return null;
}

export async function syncMALProgress(
  token: string,
  mediaId: number,
  chapterNumber: number,
  appStatus: string = 'reading'
): Promise<MALSyncResult> {
  if (!token || !mediaId) {
    return { ok: false, error: 'MAL token or Media ID missing' };
  }

  const progress = Math.floor(chapterNumber);
  const now = Date.now();
  const last = lastSyncMap.get(mediaId);
  if (last && last.progress === progress && now - last.at < SYNC_DEBOUNCE_MS) {
    return { ok: true, mediaId, progress };
  }

  try {
    const body = new URLSearchParams();
    body.append('num_chapters_read', String(progress));
    body.append('status', malStatusFromAppStatus(appStatus));

    const res = await fetch(`${MAL_API_BASE}/manga/${mediaId}/my_list_status`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token.trim()}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { ok: false, error: `HTTP ${res.status}: ${errText}` };
    }

    lastSyncMap.set(mediaId, { progress, at: Date.now() });
    return { ok: true, mediaId, progress };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Failed to update MAL' };
  }
}
