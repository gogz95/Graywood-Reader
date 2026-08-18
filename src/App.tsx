import { useState, useEffect, useMemo, lazy, Suspense } from 'react';

import { Navbar } from './components/Navbar';
import { MangaDetailModal } from './components/MangaDetailModal';
import { AddEditModal } from './components/AddEditModal';
import { ChapterListModal } from './components/ChapterListModal';
import { ConfirmModal } from './components/ConfirmModal';

// Lazy-loaded tab views — only the active tab's JS is fetched & rendered
const LibraryView = lazy(() => import('./components/LibraryView').then(m => ({ default: m.LibraryView })));
const AutoUpdateView = lazy(() => import('./components/AutoUpdateView').then(m => ({ default: m.AutoUpdateView })));
const OpenApiFinderView = lazy(() => import('./components/OpenApiFinderView').then(m => ({ default: m.OpenApiFinderView })));
const DuplicateFinderView = lazy(() => import('./components/DuplicateFinderView').then(m => ({ default: m.DuplicateFinderView })));
const ReaderView = lazy(() => import('./components/ReaderView').then(m => ({ default: m.ReaderView })));
const SettingsModal = lazy(() => import('./components/SettingsModal').then(m => ({ default: m.SettingsModal })));
const BrowseView = lazy(() => import('./components/BrowseView').then(m => ({ default: m.BrowseView })));
const KotatsuSourcesView = lazy(() => import('./components/KotatsuSourcesView').then(m => ({ default: m.KotatsuSourcesView })));

// Lightweight modals remain eager (tiny bundles)
import { AnalyticsModal } from './components/AnalyticsModal';
import { UserProfileModal } from './components/UserProfileModal';
import { AuthModal } from './components/AuthModal';
import { AdminPanelModal } from './components/AdminPanelModal';
import { SubmitBugModal, BugReportInitialData } from './components/SubmitBugModal';
import { FlagCategory } from './components/FlagIssueModal';
import {
  MangaItem,
  AutoUpdateLog,
  DatabaseSyncConfig,
  DuplicateCandidate,
  OpenApiManga,
  AppSettings,
  ReadingStatus,
} from './types';
import { INITIAL_MANGA_DATABASE } from './data/initialManga';
import { apiFetch } from './utils/api';
import { useAuth, GUEST_PROFILE, getDeviceId } from './hooks/useAuth';
import { useRouting, TAB_PATHS } from './hooks/useRouting';
import {
  useReaderSession,
  saveClientSessionProgress,
  getClientSessionHistory,
} from './hooks/useReaderSession';
import { getAniListMediaId, syncAniListProgress } from './utils/aniListScrobbler';

// Lightweight skeleton shown while lazy chunk loads
const ViewFallback = () => (
  <div className="flex items-center justify-center py-20">
    <div className="w-8 h-8 border-3 border-accent/30 border-t-accent rounded-full animate-spin" />
  </div>
);

export default function App() {
  // Incognito Mode State
  const [isIncognito, setIsIncognito] = useState(false);

  // Authentication & Profiles Hook
  const {
    profiles,
    setProfiles,
    activeProfileId,
    setActiveProfileId,
    activeProfile,
    isHostComputer,
    userProfileModalOpen,
    setUserProfileModalOpen,
    authModalOpen,
    setAuthModalOpen,
    adminPanelOpen,
    setAdminPanelOpen,
    fetchClientContext,
    fetchProfiles,
    fetchAuthMe,
    handleCreateProfile,
    handleRegisterUser,
    handleLoginUser,
    handlePromoteUser,
    handleDeleteProfile,
  } = useAuth();

  const [analyticsOpen, setAnalyticsOpen] = useState(false);

  // Manga Library Database State
  const [mangaList, setMangaList] = useState<MangaItem[]>(INITIAL_MANGA_DATABASE);

  // Modals state
  const [selectedMangaDetail, setSelectedMangaDetail] = useState<MangaItem | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editingManga, setEditingManga] = useState<MangaItem | null>(null);
  const [submitBugModalOpen, setSubmitBugModalOpen] = useState(false);
  const [bugModalInitialData, setBugModalInitialData] = useState<BugReportInitialData | undefined>(undefined);

  // Non-blocking Confirmation Modal State
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    variant?: 'danger' | 'warning' | 'info';
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  const closeConfirmModal = () => setConfirmModal((prev) => ({ ...prev, isOpen: false }));

  const showConfirm = (
    title: string,
    message: string,
    onConfirm: () => void,
    variant: 'danger' | 'warning' | 'info' = 'danger',
    confirmLabel: string = 'Confirm'
  ) => {
    setConfirmModal({
      isOpen: true,
      title,
      message,
      variant,
      confirmLabel,
      onConfirm: () => {
        onConfirm();
        setConfirmModal((prev) => ({ ...prev, isOpen: false }));
      },
    });
  };

  // Reader Mode state
  const [readerTarget, setReaderTarget] = useState<{ manga: MangaItem; chapterNumber: number; chapterId?: string } | null>(null);
  const [chapterListTarget, setChapterListTarget] = useState<MangaItem | null>(null);

  // Routing Hook
  const { activeTab, updateUrl, handleTabChange } = useRouting({
    mangaList,
    onOpenSeriesDetail: (manga) => setSelectedMangaDetail(manga),
    onOpenReaderFromUrl: (manga, chapterNumber) => setReaderTarget({ manga, chapterNumber }),
  });

  // Client Session Hook
  useReaderSession();

  // Per-User Privacy Isolation Filter
  // Admin sees ALL series across the server; Standard User sees only their own private library!
  const displayMangaList = mangaList.filter((item) => {
    if (activeProfile.role === 'admin') return true;
    return !item.userId || item.userId === activeProfile.id;
  });

  // Strict My Library Filter: Never auto-adds API/synced series to My Library
  const myLibraryList = useMemo(() => {
    return displayMangaList.filter((item) => item.isFavorite === true);
  }, [displayMangaList]);

  const [logs, setLogs] = useState<AutoUpdateLog[]>([]);
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[]>([]);

  const [config, setConfig] = useState<DatabaseSyncConfig>({
    subdomain: 'tracker.manhuahub.app',
    autoUpdateIntervalMinutes: 60,
    enableWebCrawling: true,
    sources: ['MangaDex API', 'AniList GraphQL', 'AsuraScans Feeds', 'FlameComics', 'WeebCentral', 'DemonicScans'],
    lastSyncTime: new Date().toISOString(),
    totalTracked: INITIAL_MANGA_DATABASE.length,
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [isScanningDuplicates, setIsScanningDuplicates] = useState(false);

  // Fetch initial data from server
  const fetchMangaList = async () => {
    try {
      const res = await apiFetch('/api/manga');
      if (res.ok) {
        const data = await res.json();
        setMangaList(data);
      }
    } catch (err) {
      console.error('Fetch manga list error:', err);
    }
  };

  const fetchConfig = async () => {
    try {
      const res = await apiFetch('/api/config');
      if (res.ok) {
        const data = await res.json();
        setConfig(data);
      }
    } catch (err) {
      console.error('Fetch config error:', err);
    }
  };

  const fetchLogs = async () => {
    try {
      const res = await apiFetch('/api/tracker/logs');
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
      }
    } catch (err) {
      console.error('Fetch logs error:', err);
    }
  };

  // Settings Modal State & Configs
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings>({
    appTheme: 'amber',
    libraryLayout: 'grid',
    gridColumns: 4,
    autoMarkReadPercent: 80,
    enableDownloadOffline: true,
    sourceTimeoutSeconds: 15,
    anilistConnected: true,
    mangadexConnected: true,
    customUserAgent: 'Kotatsu/4.8.2 (Android 14; Mobile; Graywood-Reader)',
    enableCloudflareBypass: true,
    flareSolverrUrl: 'http://localhost:8191/v1',
    captchaSolverEnabled: true,
    captchaApiKey: '',
    stealthMode: true,
    autoFormatReadingMode: true,
    defaultMangaMode: 'rtl',
    defaultManhwaMode: 'webtoon-seamless',
    defaultManhuaMode: 'webtoon-seamless',
    readerDefaults: {
      viewMode: 'webtoon-seamless',
      maxWidth: '850px',
      pageGap: 0,
      noPanelSpacing: true,
      bgColor: 'slate',
      zoomLevel: 100,
      autoMarkRead: true,
      imageFilter: 'normal',
      autoScrollEnabled: false,
      autoScrollSpeed: 2,
      tapZonesEnabled: true,
      cropWhiteMargins: true,
      showPageNumberOverlay: true,
      showPersistentPageBadge: true,
      autoNextChapter: true,
      mangaFitMode: 'fit-height',
      preloadCount: 3,
      autoFormatMode: true,
      rememberPerSeries: true,
    },
  });

  const fetchSettings = async () => {
    try {
      const res = await apiFetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        setAppSettings(data);
      }
    } catch (err) {
      console.error('Fetch settings error:', err);
    }
  };

  const handleSaveSettings = async (newSettings: AppSettings) => {
    setAppSettings(newSettings);
    try {
      await apiFetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSettings),
      });
    } catch (err) {
      console.error('Save settings error:', err);
    }
  };

  const scanDuplicates = async () => {
    setIsScanningDuplicates(true);
    try {
      const res = await apiFetch('/api/tracker/detect-duplicates', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setDuplicates(data);
      }
    } catch (err) {
      console.error('Scan duplicates error:', err);
    } finally {
      setIsScanningDuplicates(false);
    }
  };

  // Synchronize Client-Side Session Reading Progress when Guest profile is active
  useEffect(() => {
    if (activeProfileId === 'usr_guest') {
      const sessionHistory = getClientSessionHistory();
      if (Object.keys(sessionHistory).length > 0) {
        setMangaList((prev) =>
          prev.map((m) => {
            const sessionEntry = sessionHistory[m.id];
            if (sessionEntry && sessionEntry.currentChapter > m.currentChapter) {
              return {
                ...m,
                currentChapter: sessionEntry.currentChapter,
                lastReadAt: sessionEntry.lastReadAt,
                status: m.status === 'plan_to_read' ? 'reading' : m.status,
              };
            }
            return m;
          })
        );
      }
    } else {
      // Save active profile to device-specific cache for non-guest users
      try {
        localStorage.setItem(`graywood_${getDeviceId()}_active_profile`, activeProfileId);
      } catch (_) {}
    }
  }, [activeProfileId]);

  useEffect(() => {
    (async () => {
      await fetchClientContext();
      await fetchProfiles();
      await fetchAuthMe();
      await Promise.all([fetchMangaList(), fetchConfig(), fetchLogs(), fetchSettings()]);
    })();
  }, [fetchClientContext, fetchProfiles, fetchAuthMe]);

  // Synchronize App Theme on body element (+ browser chrome / PWA color)
  useEffect(() => {
    if (appSettings.appTheme) {
      document.body.className = `theme-${appSettings.appTheme}`;
      requestAnimationFrame(() => {
        const bg = getComputedStyle(document.body).getPropertyValue('--bg-app').trim();
        const meta = document.querySelector('meta[name="theme-color"]');
        if (bg && meta) meta.setAttribute('content', bg);
      });
    }
  }, [appSettings.appTheme]);

  // Run Auto-Update Crawler
  const handleRunAutoUpdate = async () => {
    setIsUpdating(true);
    try {
      const res = await apiFetch('/api/tracker/auto-update', { method: 'POST' });
      if (res.ok) {
        await fetchMangaList();
        await fetchLogs();
        await fetchConfig();
      }
    } catch (err) {
      console.error('Auto update error:', err);
    } finally {
      setIsUpdating(false);
    }
  };

  // Increment Chapter (+1)
  const handleIncrementChapter = async (id: string) => {
    if (activeProfile.role === 'admin') {
      console.log('[Host Admin] Chapter progress is not tracked for the Host Administrator.');
      return;
    }
    const current = mangaList.find((m) => m.id === id);
    if (!current) return;
    const nextCh = current.currentChapter + 1;

    setMangaList((prev) =>
      prev.map((m) => {
        if (m.id === id) {
          return {
            ...m,
            currentChapter: nextCh,
            latestChapter: Math.max(m.latestChapter, nextCh),
            lastReadAt: new Date().toISOString(),
          };
        }
        return m;
      })
    );

    if (activeProfileId === 'usr_guest') {
      saveClientSessionProgress(id, nextCh);
      return;
    }

    try {
      await apiFetch(`/api/manga/increment/${id}`, { method: 'POST' });
    } catch (err) {
      console.error('Increment chapter error:', err);
    }
  };

  // Save or Update Series
  const handleSaveManga = async (mangaData: Partial<MangaItem>) => {
    try {
      if (mangaData.id) {
        const res = await apiFetch(`/api/manga/${mangaData.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(mangaData),
        });
        if (res.ok) {
          await fetchMangaList();
        }
      } else {
        const res = await apiFetch('/api/manga', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(mangaData),
        });
        if (res.ok) {
          await fetchMangaList();
        }
      }
    } catch (err) {
      console.error('Save manga error:', err);
    }
  };

  // Add directly from OpenAPI Search
  const handleAddFromOpenApi = async (m: OpenApiManga) => {
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

    await handleSaveManga(newItemData);
  };

  // Delete Series with non-blocking confirmation dialog
  const handleDeleteManga = (id: string) => {
    const item = mangaList.find((m) => m.id === id);
    const itemTitle = item ? `"${item.title}"` : 'this series';

    setConfirmModal({
      isOpen: true,
      title: 'Remove Series',
      message: `Are you sure you want to remove ${itemTitle} from your tracker?`,
      confirmLabel: 'Remove',
      variant: 'danger',
      onConfirm: async () => {
        closeConfirmModal();
        try {
          const res = await apiFetch(`/api/manga/${id}`, { method: 'DELETE' });
          if (res.ok) {
            setMangaList((prev) => prev.filter((m) => m.id !== id));
            if (selectedMangaDetail?.id === id) setSelectedMangaDetail(null);
          }
        } catch (err) {
          console.error('Delete manga error:', err);
        }
      },
    });
  };

  // Execute Duplicate Merge
  const handleExecuteMerge = async (
    primaryId: string,
    secondaryId: string,
    newTitle: string,
    newAltTitles: string[],
    newGenres: string[],
    newDescription: string
  ) => {
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
        await fetchMangaList();
        await scanDuplicates();
      }
    } catch (err) {
      console.error('Merge duplicates error:', err);
    }
  };

  // Update Subdomain
  const handleUpdateSubdomain = async (subdomain: string) => {
    try {
      const res = await apiFetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subdomain }),
      });
      if (res.ok) {
        await fetchConfig();
      }
    } catch (err) {
      console.error('Update subdomain error:', err);
    }
  };

  // Export DB
  const handleExportDb = (format: 'json' | 'csv') => {
    window.open(`/api/db/export?format=${format}`, '_blank');
  };

  // Import DB
  const handleImportDb = async (data: MangaItem[], replaceExisting: boolean) => {
    try {
      const res = await apiFetch('/api/db/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data, replaceExisting }),
      });
      if (res.ok) {
        await fetchMangaList();
        await scanDuplicates();
      }
    } catch (err) {
      console.error('Import DB error:', err);
    }
  };

  // Reset DB with non-blocking confirmation dialog
  const handleResetDb = () => {
    setConfirmModal({
      isOpen: true,
      title: 'Reset Tracker Database',
      message: 'Are you sure you want to reset the tracker database to the sample dataset? This cannot be undone.',
      confirmLabel: 'Reset Database',
      variant: 'warning',
      onConfirm: async () => {
        closeConfirmModal();
        try {
          const res = await apiFetch('/api/db/reset', { method: 'POST' });
          if (res.ok) {
            await fetchMangaList();
            await fetchLogs();
            await scanDuplicates();
          }
        } catch (err) {
          console.error('Reset DB error:', err);
        }
      },
    });
  };

  // Reader Launch Handlers
  const handleSelectMangaDetail = (manga: MangaItem | null) => {
    setSelectedMangaDetail(manga);
    if (manga) {
      updateUrl(`/series/${manga.id}`);
    } else {
      updateUrl(TAB_PATHS[activeTab] || '/');
    }
  };

  const handleOpenReader = async (manga: MangaItem, chapterNumber?: number, chapterId?: string) => {
    const isHostAdmin = activeProfile.role === 'admin';
    const isGuestClient = activeProfile.id === 'usr_guest';

    let ch: number | undefined;
    if (chapterId && chapterNumber !== undefined && chapterNumber > 0) {
      ch = chapterNumber;
    } else if (chapterNumber !== undefined && chapterNumber > 0) {
      ch = chapterNumber;
    } else if (!isHostAdmin && !isGuestClient && manga.currentChapter > 0) {
      ch = manga.currentChapter;
    } else if (isGuestClient) {
      const saved = getClientSessionHistory()[manga.id]?.currentChapter || 0;
      if (saved > 0) ch = saved;
    }

    if (ch === undefined || ch <= 0) {
      ch = manga.currentChapter > 0 ? manga.currentChapter : 0;
      try {
        const res = await apiFetch(`/api/reader/chapters/${encodeURIComponent(manga.id)}?order=desc`);
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

    setReaderTarget({ manga, chapterNumber: ch, chapterId });
    updateUrl(`/reader/${manga.id}/${ch}`);
  };

  const handleCloseReader = () => {
    setReaderTarget(null);
    updateUrl(TAB_PATHS[activeTab] || '/');
  };

  const handleOpenChapters = (manga: MangaItem) => {
    setChapterListTarget(manga);
  };

  const handleOpenSubmitBug = () => {
    setBugModalInitialData(undefined);
    setSubmitBugModalOpen(true);
  };

  const handleReportMangaIssue = (category: FlagCategory, manga: MangaItem) => {
    setBugModalInitialData({
      title: `[${category.label}] ${manga.title}`,
      description: `Flagged issue: ${category.label}.\n\nSeries: ${manga.title} (${manga.id})\nSource: ${manga.sourceName || manga.sourceUrl || 'unknown'}\nFlag reason: ${category.flagReason}`,
      file: 'server.ts (Live Source Extractor)',
      stepsToReproduce: `1. Open series "${manga.title}"\n2. Trigger reading / metadata load\n3. Observe: ${category.label}`,
      priority: 'high',
    });
    setSubmitBugModalOpen(true);
  };

  const handleMarkChapterRead = async (mangaId: string, chapterNumber: number) => {
    if (isIncognito) {
      console.log('[Incognito] Private reading mode active - read history suppressed.');
      return;
    }

    if (activeProfile.role === 'admin') {
      console.log('[Host Admin] Read progress is not tracked for the Host Administrator.');
      return;
    }

    setMangaList((prev) =>
      prev.map((m) => {
        if (m.id === mangaId) {
          const nextCh = Math.max(m.currentChapter, chapterNumber);
          return {
            ...m,
            currentChapter: nextCh,
            latestChapter: Math.max(m.latestChapter, nextCh),
            lastReadAt: new Date().toISOString(),
            status: m.status === 'plan_to_read' ? 'reading' : m.status,
          };
        }
        return m;
      })
    );

    if (activeProfileId === 'usr_guest') {
      saveClientSessionProgress(mangaId, chapterNumber);
      return;
    }

    try {
      await apiFetch('/api/reader/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mangaId, chapterNumber }),
      });

      // AniList Live Scrobbler (Sync progress to AniList if token is configured)
      if (appSettings.anilistConnected && appSettings.anilistToken && appSettings.anilistAutoSync) {
        const mangaItem = mangaList.find((m) => m.id === mangaId);
        if (mangaItem) {
          getAniListMediaId(mangaItem.title)
            .then((mediaId) => {
              if (mediaId && appSettings.anilistToken) {
                syncAniListProgress(appSettings.anilistToken, mediaId, chapterNumber, mangaItem.status === 'completed');
              }
            })
            .catch(() => {});
        }
      }
    } catch (err) {
      console.error('Mark read error:', err);
    }
  };

  const handleBulkUpdateStatus = async (ids: string[], status: ReadingStatus) => {
    const updatedList = mangaList.map((m) =>
      ids.includes(m.id)
        ? {
            ...m,
            status,
            currentChapter: status === 'completed' && m.latestChapter ? m.latestChapter : m.currentChapter,
            lastUpdated: new Date().toISOString(),
          }
        : m
    );
    setMangaList(updatedList);
    for (const id of ids) {
      const item = updatedList.find((m) => m.id === id);
      if (item) {
        apiFetch('/api/manga', {
          method: 'POST',
          body: JSON.stringify(item),
        }).catch(() => {});
      }
    }
  };

  const handleBulkDelete = (ids: string[]) => {
    showConfirm(
      'Delete Selected Series',
      `Are you sure you want to delete ${ids.length} selected series from your library?`,
      async () => {
        setMangaList((prev) => prev.filter((m) => !ids.includes(m.id)));
        for (const id of ids) {
          apiFetch(`/api/manga/${id}`, { method: 'DELETE' }).catch(() => {});
        }
      },
      'danger'
    );
  };

  const unreadCount = mangaList.filter((m) => m.latestChapter > m.currentChapter).length;

  return (
    <div className="min-h-screen bg-app text-primary font-sans antialiased flex flex-col">
      {/* Top Fixed Header & Tab Navigation */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={handleTabChange}
        subdomain={config.subdomain}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        unreadCount={unreadCount}
        duplicateCount={duplicates.length}
        onOpenAddModal={() => {
          setEditingManga(null);
          setAddModalOpen(true);
        }}
        onRunAutoUpdate={handleRunAutoUpdate}
        isUpdating={isUpdating}
        onOpenSettingsModal={() => setIsSettingsOpen(true)}
        isIncognito={isIncognito}
        onToggleIncognito={() => setIsIncognito(!isIncognito)}
        onOpenAnalytics={() => setAnalyticsOpen(true)}
        activeProfile={activeProfile}
        isHostComputer={isHostComputer}
        onOpenProfileModal={() => setUserProfileModalOpen(true)}
        onOpenAuthModal={() => setAuthModalOpen(true)}
        onOpenAdminPanel={() => setAdminPanelOpen(true)}
        onOpenSubmitBugModal={handleOpenSubmitBug}
      />

      {/* Main View Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 pt-4 pb-24 md:pb-6">
        <Suspense fallback={<ViewFallback />}>
          {activeTab === 'library' && (
            <LibraryView
              mangaList={myLibraryList}
              searchQuery={searchQuery}
              onIncrementChapter={handleIncrementChapter}
              onSelectManga={handleSelectMangaDetail}
              onQuickEdit={(manga) => {
                setEditingManga(manga);
                setAddModalOpen(true);
              }}
              onDeleteManga={handleDeleteManga}
              onAddNew={() => {
                setEditingManga(null);
                setAddModalOpen(true);
              }}
              onOpenReader={handleOpenReader}
              onOpenChapters={handleOpenChapters}
              onBulkUpdateStatus={handleBulkUpdateStatus}
              onBulkDelete={handleBulkDelete}
            />
          )}

          {activeTab === 'browse' && (
            <BrowseView
              searchQuery={searchQuery}
              onSelectManga={handleSelectMangaDetail}
              onOpenReader={handleOpenReader}
              onTrack={handleSaveManga}
            />
          )}

          {activeTab === 'sources' && (
            <KotatsuSourcesView
              onAddToTracker={handleSaveManga}
              onOpenReader={handleOpenReader}
              onSelectManga={handleSelectMangaDetail}
            />
          )}

          {activeTab === 'autoupdate' && (
            <AutoUpdateView
              logs={logs}
              config={config}
              mangaList={displayMangaList}
              onRunAutoUpdate={handleRunAutoUpdate}
              isUpdating={isUpdating}
              isAdmin={activeProfile.role === 'admin'}
              onOpenReader={handleOpenReader}
            />
          )}

          {activeTab === 'duplicates' && (
            <DuplicateFinderView
              candidates={duplicates}
              onScanDuplicates={scanDuplicates}
              isScanning={isScanningDuplicates}
              onExecuteMerge={handleExecuteMerge}
            />
          )}

          {activeTab === 'openapi' && (
            <OpenApiFinderView
              existingIds={mangaList.map((m) => m.id)}
              existingTitles={mangaList.map((m) => m.title)}
              onAddFromOpenApi={handleAddFromOpenApi}
            />
          )}
        </Suspense>
      </main>

      {/* Detail Drawer Modal */}
      {selectedMangaDetail && (
        <MangaDetailModal
          manga={selectedMangaDetail}
          onClose={() => handleSelectMangaDetail(null)}
          onUpdateManga={(updated) => {
            handleSaveManga(updated);
            setSelectedMangaDetail(updated);
          }}
          onDeleteManga={handleDeleteManga}
          onEditManga={(m) => {
            setEditingManga(m);
            setAddModalOpen(true);
          }}
          onOpenReader={handleOpenReader}
          onOpenChapters={handleOpenChapters}
          onReport={handleReportMangaIssue}
        />
      )}

      {/* Add/Edit Series Modal */}
      {addModalOpen && (
        <AddEditModal
          initialManga={editingManga}
          onClose={() => {
            setAddModalOpen(false);
            setEditingManga(null);
          }}
          onSave={handleSaveManga}
        />
      )}

      {/* Fullscreen Kotatsu Reader Mode View */}
      {readerTarget && (
        <Suspense fallback={null}>
          <ReaderView
            manga={readerTarget.manga}
            initialChapterNumber={readerTarget.chapterNumber}
            initialChapterId={readerTarget.chapterId}
            defaultSettings={appSettings.readerDefaults}
            onClose={handleCloseReader}
            onMarkChapterRead={(chNum) => handleMarkChapterRead(readerTarget.manga.id, chNum)}
            onReport={handleReportMangaIssue}
            onSaveSettings={(newReaderSettings) =>
              handleSaveSettings({ ...appSettings, readerDefaults: newReaderSettings })
            }
          />
        </Suspense>
      )}

      {/* Chapter List Modal */}
      {chapterListTarget && (
        <ChapterListModal
          manga={chapterListTarget}
          onClose={() => setChapterListTarget(null)}
          onOpenReader={(chNum, chId) => handleOpenReader(chapterListTarget, chNum, chId)}
          onMarkRead={(chNum) => handleMarkChapterRead(chapterListTarget.id, chNum)}
        />
      )}

      {/* Kotatsu Settings Modal (Contains Duplicates Merger & DB Sync) */}
      {isSettingsOpen && (
        <Suspense fallback={null}>
          <SettingsModal
            settings={appSettings}
            onSaveSettings={handleSaveSettings}
            onClose={() => setIsSettingsOpen(false)}
            onRefreshData={() => {
              fetchMangaList();
              fetchConfig();
              fetchLogs();
              fetchSettings();
            }}
            duplicateCandidates={duplicates}
            onScanDuplicates={scanDuplicates}
            isScanningDuplicates={isScanningDuplicates}
            onExecuteMerge={handleExecuteMerge}
            dbConfig={config}
            mangaCount={mangaList.length}
            onUpdateSubdomain={handleUpdateSubdomain}
            onExportDb={handleExportDb}
            onImportDb={handleImportDb}
            onResetDb={handleResetDb}
            activeProfile={activeProfile}
            logs={logs}
            mangaList={mangaList}
            onRunAutoUpdate={handleRunAutoUpdate}
            isUpdating={isUpdating}
          />
        </Suspense>
      )}

      {/* User Registration & Sign In Auth Modal */}
      {authModalOpen && (
        <AuthModal
          onLogin={handleLoginUser}
          onRegister={handleRegisterUser}
          existingUsers={profiles}
          guestProfile={GUEST_PROFILE}
          onClose={() => setAuthModalOpen(false)}
        />
      )}

      {/* User Profiles Selector Modal */}
      {userProfileModalOpen && (
        <UserProfileModal
          profiles={profiles}
          activeProfileId={activeProfileId}
          isHostComputer={isHostComputer}
          onSelectProfile={(id) => {
            setActiveProfileId(id);
            setUserProfileModalOpen(false);
          }}
          onCreateProfile={handleCreateProfile}
          onDeleteProfile={handleDeleteProfile}
          onClose={() => setUserProfileModalOpen(false)}
        />
      )}

      {/* Host / Administrator Command Panel */}
      {adminPanelOpen && activeProfile.role === 'admin' && isHostComputer && (
        <AdminPanelModal
          currentUser={activeProfile}
          allUsers={profiles}
          mangaList={mangaList}
          onPromoteUser={handlePromoteUser}
          onDeleteUser={handleDeleteProfile}
          onSwitchUserView={(u) => {
            setActiveProfileId(u.id);
            setAdminPanelOpen(false);
          }}
          onClose={() => setAdminPanelOpen(false)}
        />
      )}

      {/* Submit Bug Tracker Modal */}
      {submitBugModalOpen && (
        <SubmitBugModal
          currentUser={activeProfile}
          initialData={bugModalInitialData}
          onClose={() => setSubmitBugModalOpen(false)}
        />
      )}

      {/* Analytics Modal */}
      {analyticsOpen && (
        <AnalyticsModal
          mangaList={displayMangaList}
          onClose={() => setAnalyticsOpen(false)}
        />
      )}

      {/* Reusable Non-blocking Confirmation Modal */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        confirmLabel={confirmModal.confirmLabel}
        variant={confirmModal.variant}
        onConfirm={confirmModal.onConfirm}
        onCancel={closeConfirmModal}
      />

      {/* Footer */}
      <footer className="border-t border-edge bg-surface/60 py-6 pb-24 md:pb-6 text-center text-xs text-muted">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p>Graywood Reader and Tracker • {config.subdomain}</p>
          <p className="flex items-center gap-2">
            <span>Automatic Chapter Scanner Active</span>
            <span>•</span>
            <span className="text-accent font-bold">{mangaList.length} Series Tracked</span>
          </p>
        </div>
      </footer>
    </div>
  );
}
