import { create } from 'zustand';
import { apiFetch } from '../utils/api';
import { MangaItem, AutoUpdateLog, DatabaseSyncConfig, DuplicateCandidate, OpenApiManga, ReadingStatus, UserProfile, isNsfwManga } from '../types';
import { useAuthStore } from './useAuthStore';
import { saveClientSessionProgress } from '../hooks/useReaderSession';

// ============================================================================
// useLibraryStore — Global library data state & actions (Zustand)
// Replaces useLibraryState() hook + derived mangaList selectors + CRUD from App.tsx.
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
  totalCount: number;
  hasMore: boolean;
  isLoadingMore: boolean;
  page: number;
  pageSize: number;
  logs: AutoUpdateLog[];
  duplicates: DuplicateCandidate[];
  config: DatabaseSyncConfig;
  isUpdating: boolean;
  isScanningDuplicates: boolean;

  // Setters
  setMangaList: (list: MangaItem[] | ((prev: MangaItem[]) => MangaItem[])) => void;
  setLogs: (logs: AutoUpdateLog[]) => void;
  setDuplicates: (duplicates: DuplicateCandidate[]) => void;
  setConfig: (config: DatabaseSyncConfig | ((prev: DatabaseSyncConfig) => DatabaseSyncConfig)) => void;
  setIsUpdating: (updating: boolean) => void;

  // Data fetching
  fetchMangaList: (customPageSize?: number) => Promise<void>;
  fetchNextMangaPage: () => Promise<void>;
  fetchAllManga: () => Promise<void>;
  fetchLogs: () => Promise<void>;
  fetchConfig: () => Promise<void>;
  scanDuplicates: () => Promise<void>;

  // Data mutations
  saveManga: (mangaData: Partial<MangaItem>) => Promise<void>;
  addFromOpenApi: (m: OpenApiManga) => Promise<void>;
  deleteManga: (id: string) => Promise<boolean>;
  executeMerge: (
    primaryId: string,
    secondaryId: string,
    newTitle: string,
    newAltTitles: string[],
    newGenres: string[],
    newDescription: string
  ) => Promise<void>;
  dismissDuplicate: (candidateId: string, primaryId: string, secondaryId: string) => Promise<void>;
  runAutoUpdate: () => Promise<void>;
  incrementChapter: (id: string) => Promise<void>;
  bulkUpdateStatus: (ids: string[], status: ReadingStatus) => Promise<void>;
  bulkDelete: (ids: string[]) => Promise<void>;
  updateSubdomain: (subdomain: string) => Promise<void>;
  importDb: (data: MangaItem[], replaceExisting: boolean) => Promise<void>;
  resetDb: () => Promise<boolean>;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  mangaList: [],
  totalCount: 0,
  hasMore: false,
  isLoadingMore: false,
  page: 1,
  pageSize: 100,
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

  fetchMangaList: async (customPageSize) => {
    try {
      const size = customPageSize || get().pageSize || 100;
      const res = await apiFetch(`/api/manga?limit=${size}&offset=0`);
      if (res.ok) {
        const totalHeader = res.headers?.get ? res.headers.get('X-Total-Count') : null;
        const data: MangaItem[] = await res.json();
        const totalCount = totalHeader ? parseInt(totalHeader, 10) : data.length;
        set({
          mangaList: data,
          totalCount,
          hasMore: data.length < totalCount,
          page: 1,
        });
      }
    } catch (err) {
      console.error('[Library] Fetch manga list error:', err);
    }
  },

  fetchNextMangaPage: async () => {
    const { mangaList, totalCount, hasMore, isLoadingMore, page, pageSize } = get();
    if (!hasMore || isLoadingMore) return;
    set({ isLoadingMore: true });
    try {
      const offset = mangaList.length;
      const res = await apiFetch(`/api/manga?limit=${pageSize}&offset=${offset}`);
      if (res.ok) {
        const totalHeader = res.headers?.get ? res.headers.get('X-Total-Count') : null;
        const nextBatch: MangaItem[] = await res.json();
        const newTotal = totalHeader ? parseInt(totalHeader, 10) : totalCount;
        const combined = [...mangaList, ...nextBatch];
        const seen = new Set<string>();
        const deduped: MangaItem[] = [];
        for (const item of combined) {
          if (!seen.has(item.id)) {
            seen.add(item.id);
            deduped.push(item);
          }
        }
        set({
          mangaList: deduped,
          totalCount: newTotal,
          hasMore: deduped.length < newTotal,
          page: page + 1,
          isLoadingMore: false,
        });
      } else {
        set({ isLoadingMore: false });
      }
    } catch (err) {
      console.error('[Library] Fetch next manga page error:', err);
      set({ isLoadingMore: false });
    }
  },

  fetchAllManga: async () => {
    try {
      const res = await apiFetch('/api/manga');
      if (res.ok) {
        const data = await res.json();
        set({ mangaList: data, totalCount: data.length, hasMore: false });
      }
    } catch (err) {
      console.error('[Library] Fetch all manga error:', err);
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

  saveManga: async (mangaData) => {
    try {
      if (mangaData.id) {
        // Optimistic UI update
        set((state) => ({
          mangaList: state.mangaList.map((m) => (m.id === mangaData.id ? { ...m, ...mangaData } : m)),
        }));
        const res = await apiFetch(`/api/manga/${mangaData.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(mangaData),
        });
        if (res.ok) {
          const updated = await res.json().catch(() => null);
          if (updated && updated.id) {
            // Patch the single item from the server response — no full refetch needed
            set((state) => ({
              mangaList: state.mangaList.map((m) => (m.id === updated.id ? { ...m, ...updated } : m)),
            }));
          }
        }
      } else {
        const res = await apiFetch('/api/manga', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(mangaData),
        });
        if (res.ok) {
          const created = await res.json().catch(() => null);
          if (created && created.id) {
            // Add the new item to the list directly from server response
            set((state) => ({ mangaList: [created, ...state.mangaList] }));
          } else {
            // Fallback: refetch if the response couldn't be parsed
            await get().fetchMangaList();
          }
        }
      }
    } catch (err) {
      console.error('[Library] Save manga error:', err);
    }
  },

  addFromOpenApi: async (m) => {
    const newItemData: Partial<MangaItem> = {
      title: m.title,
      altTitles: m.altTitles,
      type: m.type,
      coverImage: m.coverImage,
      description: m.description,
      genres: m.genres,
      status: 'reading',
      currentChapter: 0,
      latestChapter: m.latestChapter,
      rating: m.rating || 9.0,
      sourceName: m.source,
      syncedFromApi: m.source,
      apiId: m.id,
      autoUpdateEnabled: true,
    };
    await get().saveManga(newItemData);
  },

  deleteManga: async (id) => {
    try {
      const res = await apiFetch(`/api/manga/${id}`, { method: 'DELETE' });
      if (res.ok) {
        set((state) => ({
          mangaList: state.mangaList.filter((m) => m.id !== id),
        }));
        return true;
      }
      return false;
    } catch (err) {
      console.error('[Library] Delete manga error:', err);
      return false;
    }
  },

  executeMerge: async (primaryId, secondaryId, newTitle, newAltTitles, newGenres, newDescription) => {
    try {
      const res = await apiFetch('/api/tracker/merge-duplicates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          primaryId,
          secondaryId,
          newTitle,
          newAltTitles,
          newGenres,
          newDescription,
        }),
      });
      if (res.ok) {
        await get().fetchMangaList();
        await get().scanDuplicates();
      }
    } catch (err) {
      console.error('[Library] Merge duplicates error:', err);
    }
  },

  dismissDuplicate: async (candidateId, primaryId, secondaryId) => {
    try {
      await apiFetch('/api/tracker/dismiss-duplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateId, primaryId, secondaryId }),
      });
    } catch (err) {
      console.error('[Library] Dismiss duplicate error:', err);
    }
  },

  runAutoUpdate: async () => {
    set({ isUpdating: true });
    try {
      const res = await apiFetch('/api/tracker/auto-update', { method: 'POST' });
      if (res.ok) {
        await get().fetchMangaList();
        await get().fetchLogs();
        await get().fetchConfig();
      }
    } catch (err) {
      console.error('[Library] Auto update error:', err);
    } finally {
      set({ isUpdating: false });
    }
  },

  incrementChapter: async (id) => {
    const { activeProfileId } = useAuthStore.getState();
    const current = get().mangaList.find((m) => m.id === id);
    if (!current) return;
    const nextCh = current.currentChapter + 1;

    set((state) => ({
      mangaList: state.mangaList.map((m) => {
        if (m.id === id) {
          return {
            ...m,
            currentChapter: nextCh,
            latestChapter: Math.max(m.latestChapter, nextCh),
            lastReadAt: new Date().toISOString(),
            isFavorite: true,
          };
        }
        return m;
      }),
    }));

    if (activeProfileId === 'usr_guest') {
      saveClientSessionProgress(id, nextCh);
      return;
    }

    try {
      await apiFetch(`/api/manga/increment/${id}`, { method: 'POST' });
    } catch (err) {
      console.error('[Library] Increment chapter error:', err);
    }
  },

  bulkUpdateStatus: async (ids, status) => {
    // Optimistic UI update
    set((state) => ({
      mangaList: state.mangaList.map((m) =>
        ids.includes(m.id)
          ? {
              ...m,
              status,
              currentChapter: status === 'completed' && m.latestChapter ? m.latestChapter : m.currentChapter,
              lastUpdated: new Date().toISOString(),
            }
          : m
      ),
    }));

    // Single batched request instead of N individual ones
    try {
      await apiFetch('/api/manga/bulk-update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, status }),
      });
    } catch (err) {
      console.error('[Library] Bulk update status error:', err);
    }
  },

  bulkDelete: async (ids) => {
    if (!ids || ids.length === 0) return;
    const idSet = new Set(ids);
    set((state) => ({
      mangaList: state.mangaList.filter((m) => !idSet.has(m.id)),
    }));
    try {
      await apiFetch('/api/manga/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
    } catch (err) {
      console.error('[Library] Bulk delete error:', err);
      get().fetchMangaList();
    }
  },

  updateSubdomain: async (subdomain) => {
    try {
      const res = await apiFetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subdomain }),
      });
      if (res.ok) {
        await get().fetchConfig();
      }
    } catch (err) {
      console.error('[Library] Update subdomain error:', err);
    }
  },

  importDb: async (data, replaceExisting) => {
    try {
      const res = await apiFetch('/api/db/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data, replaceExisting }),
      });
      if (res.ok) {
        await get().fetchMangaList();
        await get().scanDuplicates();
      }
    } catch (err) {
      console.error('[Library] Import DB error:', err);
    }
  },

  resetDb: async () => {
    try {
      const res = await apiFetch('/api/db/reset', { method: 'POST' });
      if (res.ok) {
        await get().fetchMangaList();
        await get().fetchLogs();
        await get().scanDuplicates();
        return true;
      }
      return false;
    } catch (err) {
      console.error('[Library] Reset DB error:', err);
      return false;
    }
  },
}));

// ── Derived Selectors (memoized via Zustand selector equality) ───────────────

/**
 * Pure selector for per-user privacy-isolated library filtering.
 */
export function getDisplayMangaList(
  mangaList: MangaItem[],
  activeProfile?: UserProfile,
  isGuestClient?: boolean
): MangaItem[] {
  return mangaList.filter((item) => {
    if (isGuestClient && isNsfwManga(item)) return false;
    if (activeProfile?.allowNsfw === false && isNsfwManga(item)) return false;
    return true;
  });
}

/**
 * Per-user privacy-isolated library view hook.
 * Blocks NSFW content for guests or accounts with NSFW restrictions.
 */
export function useDisplayMangaList(): MangaItem[] {
  const mangaList = useLibraryStore((s) => s.mangaList);
  const activeProfile = useAuthStore((s) => s.activeProfile);
  const isGuestClient = useAuthStore((s) => s.isGuestClient);

  return getDisplayMangaList(mangaList, activeProfile, isGuestClient);
}

/**
 * Strict "My Library" filter: only favorites (explicitly tracked series).
 */
export function useMyLibraryList(): MangaItem[] {
  const displayList = useDisplayMangaList();
  return displayList.filter((item) => item.isFavorite === true);
}


