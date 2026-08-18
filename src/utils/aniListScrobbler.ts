/**
 * AniList GraphQL Live Scrobbler for Graywood Reader.
 * Automatically synchronizes chapter reading progress to the user's AniList profile.
 */

export interface AniListMediaMatch {
  id: number;
  title: {
    romaji?: string;
    english?: string;
    native?: string;
  };
  coverImage?: {
    large?: string;
  };
  status?: string;
  chapters?: number;
}

export interface AniListSyncResult {
  ok: boolean;
  mediaId?: number;
  progress?: number;
  error?: string;
}

const ANILIST_GRAPHQL_ENDPOINT = 'https://graphql.anilist.co';

/**
 * Search AniList for a manga title to find its AniList Media ID.
 */
export async function searchAniListManga(title: string): Promise<AniListMediaMatch | null> {
  const query = `
    query ($search: String) {
      Media(search: $search, type: MANGA) {
        id
        title {
          romaji
          english
          native
        }
        coverImage {
          large
        }
        status
        chapters
      }
    }
  `;

  try {
    const res = await fetch(ANILIST_GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        query,
        variables: { search: title },
      }),
    });

    if (!res.ok) return null;
    const data: any = await res.json();
    return data?.data?.Media || null;
  } catch (err) {
    console.warn(`[AniList Scrobbler] Search failed for "${title}":`, err);
    return null;
  }
}

/**
 * Sync reading progress to AniList for a given manga and chapter number.
 */
export async function syncAniListProgress(
  token: string,
  mediaId: number,
  chapterNumber: number,
  isCompleted: boolean = false
): Promise<AniListSyncResult> {
  if (!token || !mediaId) {
    return { ok: false, error: 'AniList token or Media ID missing' };
  }

  const mutation = `
    mutation ($mediaId: Int, $progress: Int, $status: MediaListStatus) {
      SaveMediaListEntry(mediaId: $mediaId, progress: $progress, status: $status) {
        id
        status
        progress
      }
    }
  `;

  try {
    const status = isCompleted ? 'COMPLETED' : 'CURRENT';
    const res = await fetch(ANILIST_GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token.trim()}`,
      },
      body: JSON.stringify({
        query: mutation,
        variables: {
          mediaId,
          progress: Math.floor(chapterNumber),
          status,
        },
      }),
    });

    if (!res.ok) {
      const errJson: any = await res.json().catch(() => ({}));
      const msg = errJson?.errors?.[0]?.message || `HTTP ${res.status}`;
      return { ok: false, error: msg };
    }

    const data: any = await res.json();
    const entry = data?.data?.SaveMediaListEntry;
    return {
      ok: true,
      mediaId,
      progress: entry?.progress || chapterNumber,
    };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Failed to update AniList' };
  }
}
