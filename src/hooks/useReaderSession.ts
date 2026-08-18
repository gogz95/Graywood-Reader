import { apiFetch } from '../utils/api';

const CLIENT_SESSION_STORAGE_KEY = 'graywood_client_session_reading_history';

export interface ClientSessionHistoryEntry {
  currentChapter: number;
  lastReadAt: string;
}

export type ClientSessionHistory = Record<string, ClientSessionHistoryEntry>;

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

export function useReaderSession() {
  return {
    getClientSessionHistory,
    saveClientSessionProgress,
    migrateClientSessionHistoryToUser,
  };
}
