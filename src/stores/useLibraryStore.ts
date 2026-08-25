import { create } from 'zustand';
import { apiFetch } from '../utils/api';
import { MangaItem, AutoUpdateLog, DatabaseSyncConfig, DuplicateCandidate, isNsfwManga } from '../types';
import { useAuthStore } from './useAuthStore';

// ============================================================================
// useLibraryStore — Global library data state (Zustand)
// Replaces useLibraryState() hook + derived mangaList selectors from App.tsx.
// ============================================================================

const DEFAULT_CONFIG: DatabaseSyncConfig = {
  subdomain: 'tracker.manhuahub.app',
  autoUpdateIntervalMinutes: 60,
  enableWebCrawling: true,
  sources: ['MangaDex API', 'AniList GraphQL', 'AsuraScans Feeds', 'FlameComics', 'WeebCentral', 'DemonicScans'],
  lastSyncTime: new Date().toISOString(),
  totalTracked: 0,
};

interface LibraryState {
  mangaList: MangaItem[];
  logs: AutoUpdateLog[];
  duplicates: DuplicateCandidate[];
  config: DatabaseSyncConfig;
  isUpdating: boolean;
  isScanningDuplicates: boolean;

  // Actions
  setMangaList: (list: MangaItem[] | ((prev: MangaItem[]) => MangaItem[])) => void;
  setLogs: (logs: AutoUpdateLog[]) => void;
  setDuplicates: (duplicates: DuplicateCandidate[]) => void;
  setConfig: (config: DatabaseSyncConfig | ((prev: DatabaseSyncConfig) => DatabaseSyncConfig)) => void;
  setIsUpdating: (updating: boolean) => void;

  fetchMangaList: () => Promise<void>;
  fetchLogs: () => Promise<void>;
  fetchConfig: () => Promise<void>;
  scanDuplicates: () => Promise<void>;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  mangaList: [],
  logs: [],
  duplicates: [],
  config: DEFAULT_CONFIG,
  isUpdating: false,
  isScanningDuplicates: false,

  setMangaList: (list) =>
    set((state) => ({
      mangaList: typeof list === 'function' ? list(state.mangaList) : list,
    })),

  setLogs: (logs) => set({ logs }),
  setDuplicates: (duplicates) => set({ duplicates }),
  setConfig: (config) =>
    set((state) => ({
      config: typeof config === 'function' ? config(state.config) : config,
    })),
  setIsUpdating: (isUpdating) => set({ isUpdating }),

  fetchMangaList: async () => {
    try {
      const res = await apiFetch('/api/manga');
      if (res.ok) {
        const data = await res.json();
        set({ mangaList: data });
      }
    } catch (err) {
      console.error('[Library] Fetch manga list error:', err);
    }
  },

  fetchLogs: async () => {
    try {
      const res = await apiFetch('/api/tracker/logs');
      if (res.ok) {
        const data = await res.json();
        set({ logs: data });
      }
    } catch (err) {
      console.error('[Library] Fetch logs error:', err);
    }
  },

  fetchConfig: async () => {
    try {
      const res = await apiFetch('/api/config');
      if (res.ok) {
        const data = await res.json();
        set({ config: data });
      }
    } catch (err) {
      console.error('[Library] Fetch config error:', err);
    }
  },

  scanDuplicates: async () => {
    set({ isScanningDuplicates: true });
    try {
      const res = await apiFetch('/api/tracker/detect-duplicates', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        set({ duplicates: data });
      }
    } catch (err) {
      console.error('[Library] Scan duplicates error:', err);
    } finally {
      set({ isScanningDuplicates: false });
    }
  },
}));

// ── Derived Selectors (memoized via Zustand selector equality) ───────────────

/**
 * Per-user privacy-isolated library view.
 * Admin sees all; standard user sees their own; guest is blocked from NSFW.
 */
export function useDisplayMangaList(): MangaItem[] {
  const mangaList = useLibraryStore((s) => s.mangaList);
  const { activeProfile, isGuestClient } = useAuthStore();

  return mangaList.filter((item) => {
    if (isGuestClient && isNsfwManga(item)) return false;
    if (activeProfile.role === 'admin') return true;
    return !item.userId || item.userId === activeProfile.id;
  });
}

/**
 * Strict "My Library" filter: only favorites (explicitly tracked series).
 */
export function useMyLibraryList(): MangaItem[] {
  const displayList = useDisplayMangaList();
  return displayList.filter((item) => item.isFavorite === true);
}
