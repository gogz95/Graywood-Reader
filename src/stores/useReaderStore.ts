import { create } from 'zustand';
import { MangaItem, AppTheme, isNsfwManga } from '../types';
import { FlagCategory } from '../components/FlagIssueModal';
import { apiFetch } from '../utils/api';
import { useAuthStore, getDeviceId } from './useAuthStore';
import { useLibraryStore } from './useLibraryStore';
import { useSettingsStore } from './useSettingsStore';
import { useModalStore } from './useModalStore';
import {
  saveClientSessionProgress,
  getClientSessionHistory,
} from '../hooks/useReaderSession';
import { getAniListMediaId, syncAniListProgress } from '../utils/aniListScrobbler';
import { getMALMediaId, syncMALProgress } from '../utils/malScrobbler';
import { getKitsuMediaId, syncKitsuProgress } from '../utils/kitsuScrobbler';
import type { BugReportInitialData } from '../components/SubmitBugModal';

// ============================================================================
// useReaderStore — Reader target state & chapter-read orchestration (Zustand)
// Replaces readerTarget, chapterListTarget, and handleMarkChapterRead from App.tsx.
// ============================================================================

interface ReaderState {
  readerTarget: { manga: MangaItem; chapterNumber: number; chapterId?: string } | null;
  chapterListTarget: MangaItem | null;
  isIncognito: boolean;

  // Actions
  setReaderTarget: (target: { manga: MangaItem; chapterNumber: number; chapterId?: string } | null) => void;
  setChapterListTarget: (manga: MangaItem | null) => void;
  setIsIncognito: (incognito: boolean) => void;
  toggleIncognito: () => void;

  /**
   * Opens the reader, resolving the chapter number from the server if needed.
   * Gates NSFW content behind login for guests.
   */
  openReader: (manga: MangaItem, chapterNumber?: number, chapterId?: string) => Promise<void>;
  closeReader: () => void;

  /**
   * Marks a chapter as read — optimistic update, server persist, tracker scrobbling.
   * Respects incognito mode, private mode, and admin/guest roles.
   */
  markChapterRead: (mangaId: string, chapterNumber: number) => Promise<void>;

  /** Opens the bug/flag reporter pre-filled for a manga issue */
  reportMangaIssue: (category: FlagCategory, manga: MangaItem) => void;
}

export const useReaderStore = create<ReaderState>((set, get) => ({
  readerTarget: null,
  chapterListTarget: null,
  isIncognito: false,

  setReaderTarget: (target) => set({ readerTarget: target }),
  setChapterListTarget: (manga) => set({ chapterListTarget: manga }),
  setIsIncognito: (incognito) => set({ isIncognito: incognito }),
  toggleIncognito: () => set((state) => ({ isIncognito: !state.isIncognito })),

  openReader: async (manga, chapterNumber?, chapterId?) => {
    const { activeProfile, isGuestClient } = useAuthStore.getState();
    const modalStore = useModalStore.getState();

    // Gate 18+ / NSFW titles: Guest users must log in
    if (isGuestClient && isNsfwManga(manga)) {
      modalStore.setModalData({ authModalMode: 'login' });
      modalStore.openModal('auth');
      return;
    }

    let ch: number | undefined;
    if (chapterId && chapterNumber !== undefined && chapterNumber > 0) {
      ch = chapterNumber;
    } else if (chapterNumber !== undefined && chapterNumber > 0) {
      ch = chapterNumber;
    } else if (!isGuestClient && manga.currentChapter > 0) {
      ch = manga.currentChapter;
    } else if (isGuestClient) {
      const saved = getClientSessionHistory()[manga.id]?.currentChapter || 0;
      if (saved > 0) ch = saved;
    }

    if (ch === undefined || ch <= 0) {
      ch = manga.currentChapter > 0 ? manga.currentChapter : 0;
      try {
        const res = await apiFetch(
          `/api/reader/chapters/${encodeURIComponent(manga.id)}?order=desc${
            manga.sourceUrl ? `&url=${encodeURIComponent(manga.sourceUrl)}` : ''
          }`
        );
        if (res.ok) {
          const list = await res.json();
          if (Array.isArray(list) && list.length > 0) {
            const nums = list
              .map((c: any) => Number(c.chapterNumber ?? c.number))
              .filter((n: number) => Number.isFinite(n) && n > 0);
            if (nums.length > 0) {
              const newest = Math.max(...nums);
              const oldest = Math.min(...nums);
              if (ch > 0 && ch >= oldest && ch <= newest) {
                // keep saved progress
              } else if (ch > 0 && ch < oldest) {
                ch = oldest;
              } else {
                ch = newest;
              }
            }
          }
        }
      } catch (err) {
        console.warn('[Reader] Failed to resolve live chapter list; falling back.', err);
      }
      if (!ch || ch <= 0) ch = Math.max(1, manga.latestChapter || 1);
    }

    set({ readerTarget: { manga, chapterNumber: ch, chapterId } });
  },

  closeReader: () => {
    set({ readerTarget: null });
  },

  markChapterRead: async (mangaId, chapterNumber) => {
    const { isIncognito } = get();
    const { activeProfileId } = useAuthStore.getState();
    const { appSettings } = useSettingsStore.getState();
    const libraryStore = useLibraryStore.getState();

    if (isIncognito) {
      console.log('[Incognito] Private reading mode active - read history suppressed.');
      return;
    }

    const isPrivate = appSettings.privateModeEnabled;
    const currentManga =
      libraryStore.mangaList.find((m) => m.id === mangaId) ||
      (get().readerTarget?.manga?.id === mangaId ? get().readerTarget!.manga : null);

    // Optimistic update
    libraryStore.setMangaList((prev) => {
      const exists = prev.some((m) => m.id === mangaId);
      if (exists) {
        return prev.map((m) => {
          if (m.id === mangaId) {
            const nextCh = Math.max(m.currentChapter, chapterNumber);
            const updates: any = {
              ...m,
              currentChapter: nextCh,
              latestChapter: Math.max(m.latestChapter, nextCh),
              status: m.status === 'plan_to_read' ? 'reading' : m.status,
              isFavorite: true,
            };
            if (!isPrivate) {
              updates.lastReadAt = new Date().toISOString();
            }
            return updates;
          }
          return m;
        });
      } else if (currentManga) {
        const nextCh = Math.max(currentManga.currentChapter || 0, chapterNumber);
        const newManga: MangaItem = {
          ...currentManga,
          currentChapter: nextCh,
          latestChapter: Math.max(currentManga.latestChapter || 1, nextCh),
          status: currentManga.status === 'plan_to_read' ? 'reading' : (currentManga.status || 'reading'),
          isFavorite: true,
          lastReadAt: !isPrivate ? new Date().toISOString() : undefined,
        };
        return [...prev, newManga];
      }
      return prev;
    });

    if (activeProfileId === 'usr_guest') {
      saveClientSessionProgress(mangaId, chapterNumber);
      return;
    }

    if (isPrivate) return;

    try {
      await apiFetch('/api/reader/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mangaId, chapterNumber, manga: currentManga }),
      });

      const mangaItem = libraryStore.mangaList.find((m) => m.id === mangaId) || currentManga;
      if (!mangaItem) return;

      // AniList Scrobbler
      if (appSettings.anilistConnected && appSettings.anilistToken && appSettings.anilistAutoSync) {
        getAniListMediaId(mangaItem.title)
          .then((mediaId) => {
            if (mediaId && appSettings.anilistToken) {
              syncAniListProgress(appSettings.anilistToken!, mediaId, chapterNumber, mangaItem.status === 'completed');
            }
          })
          .catch(() => {});
      }

      // MAL Scrobbler
      if (appSettings.malConnected && appSettings.malToken && appSettings.malAutoSync) {
        getMALMediaId(mangaItem.title)
          .then((mediaId) => {
            if (mediaId && appSettings.malToken) {
              syncMALProgress(appSettings.malToken, mediaId, chapterNumber, mangaItem.status);
            }
          })
          .catch(() => {});
      }

      // Kitsu Scrobbler
      if (appSettings.kitsuConnected && appSettings.kitsuToken && appSettings.kitsuAutoSync) {
        getKitsuMediaId(mangaItem.title)
          .then((mediaId) => {
            if (mediaId && appSettings.kitsuToken) {
              syncKitsuProgress(appSettings.kitsuToken, mediaId, chapterNumber, mangaItem.status);
            }
          })
          .catch(() => {});
      }
    } catch (err) {
      console.error('Mark read error:', err);
    }
  },

  reportMangaIssue: (category, manga) => {
    const modalStore = useModalStore.getState();
    modalStore.setModalData({
      bugReportInitialData: {
        title: `[${category.label}] ${manga.title}`,
        description: `Flagged issue: ${category.label}.\n\nSeries: ${manga.title} (${manga.id})\nSource: ${manga.sourceName || manga.sourceUrl || 'unknown'}\nFlag reason: ${category.flagReason}`,
        file: 'server.ts (Live Source Extractor)',
        stepsToReproduce: `1. Open series "${manga.title}"\n2. Trigger reading / metadata load\n3. Observe: ${category.label}`,
        priority: 'high',
      } as BugReportInitialData,
    });
    modalStore.openModal('submitBug');
  },
}));
