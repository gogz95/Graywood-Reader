import { useEffect, useRef } from 'react';
import { apiFetch, getApiBaseUrl, getAuthToken } from '../utils/api';


const CLIENT_SESSION_STORAGE_KEY = 'graywood_client_session_reading_history';

export interface ClientSessionHistoryEntry {
  currentChapter: number;
  lastReadAt: string;
}

export type ClientSessionHistory = Record<string, ClientSessionHistoryEntry>;

export interface RemoteProgressUpdate {
  userId: string;
  mangaId: string;
  chapterNumber: number;
  pageIndex?: number;
  pageCount?: number;
  percent?: number;
  timestamp: string;
}

export function getClientSessionHistory(): ClientSessionHistory {
  try {
    const raw = localStorage.getItem(CLIENT_SESSION_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

export function saveClientSessionProgress(mangaId: string, chapterNumber: number): void {
  try {
    const history = getClientSessionHistory();
    const existingCh = history[mangaId]?.currentChapter || 0;
    const nextCh = Math.max(existingCh, chapterNumber);
    history[mangaId] = {
      currentChapter: nextCh,
      lastReadAt: new Date().toISOString(),
    };
    localStorage.setItem(CLIENT_SESSION_STORAGE_KEY, JSON.stringify(history));
  } catch (err) {
    console.error('[Client Session Engine] Storage error:', err);
  }
}

export async function migrateClientSessionHistoryToUser(targetUserId: string): Promise<void> {
  const sessionHistory = getClientSessionHistory();
  const entries = Object.entries(sessionHistory);
  if (entries.length === 0) return;

  for (const [mangaId, record] of entries) {
    try {
      await apiFetch('/api/reader/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mangaId, chapterNumber: record.currentChapter, userId: targetUserId }),
      });
    } catch (_) {}
  }

  try {
    localStorage.removeItem(CLIENT_SESSION_STORAGE_KEY);
  } catch (_) {}
}

/**
 * React Hook that subscribes to real-time Server-Sent Events (SSE) reading progress updates
 * broadcast by other tabs, devices, or mobile thin clients for seamless continuity.
 */
export function useLiveReadingSessionSync(
  onRemoteProgress?: (update: RemoteProgressUpdate) => void
): void {
  const callbackRef = useRef(onRemoteProgress);
  callbackRef.current = onRemoteProgress;

  useEffect(() => {
    let evtSource: EventSource | null = null;
    let reconnectTimeout: any = null;
    let isMounted = true;

    const connect = () => {
      if (!isMounted) return;
      try {
        const baseUrl = getApiBaseUrl();
        // EventSource cannot send Authorization headers; pass JWT as ?token=
        // so the server can authenticate the SSE connection and route progress
        // updates to the correct user instead of the shared guest bucket.
        const authToken = getAuthToken();
        const tokenParam = authToken ? `?token=${encodeURIComponent(authToken)}` : '';
        const url = `${baseUrl}/api/reader/sync/events${tokenParam}`;
        evtSource = new EventSource(url);


        evtSource.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);
            if (data?.type === 'progress_update') {
              callbackRef.current?.(data);
            }
          } catch (_) {}
        };

        evtSource.onerror = () => {
          if (evtSource) {
            evtSource.close();
            evtSource = null;
          }
          if (isMounted) {
            reconnectTimeout = setTimeout(connect, 5000);
          }
        };
      } catch (err) {
        if (isMounted) {
          reconnectTimeout = setTimeout(connect, 10000);
        }
      }
    };

    connect();

    return () => {
      isMounted = false;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (evtSource) evtSource.close();
    };
  }, []);
}

