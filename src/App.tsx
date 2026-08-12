import React, { useState, useEffect, useMemo, lazy, Suspense } from 'react';

import { Navbar } from './components/Navbar';
import { MangaDetailModal } from './components/MangaDetailModal';
import { AddEditModal } from './components/AddEditModal';
import { ChapterListModal } from './components/ChapterListModal';

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
  AppNavTab,
} from './types';
import { INITIAL_MANGA_DATABASE } from './data/initialManga';
import { UserProfile, UserRole } from './types';




const GUEST_PROFILE: UserProfile = {
  id: 'usr_guest',
  name: 'Guest Reader',
  username: 'guest',
  email: 'guest@graywood.app',
  avatar: '👤',
  role: 'user',
  createdAt: new Date().toISOString(),
};

// Lightweight skeleton shown while lazy chunk loads
const ViewFallback = () => (
  <div className="flex items-center justify-center py-20">
    <div className="w-8 h-8 border-3 border-accent/30 border-t-accent rounded-full animate-spin" />
  </div>
);

export default function App() {
  const [activeTab, setActiveTab] = useState<AppNavTab>('library');

  // Host PC Connection & Security State
  const [isHostComputer, setIsHostComputer] = useState<boolean>(true);

  // Incognito Mode State
  const [isIncognito, setIsIncognito] = useState(false);

  // Multi-User Profile & Auth State
  const [profiles, setProfiles] = useState<UserProfile[]>([
    {
      id: 'usr_admin',
      name: 'Host Administrator',
      username: 'admin',
      email: 'admin@manga.dev',
      avatar: '🛡️',
      role: 'admin',
      createdAt: new Date().toISOString(),
    },
    GUEST_PROFILE,
  ]);
  const [activeProfileId, setActiveProfileId] = useState<string>('usr_admin');
  const [userProfileModalOpen, setUserProfileModalOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [adminPanelOpen, setAdminPanelOpen] = useState(false);

  const [analyticsOpen, setAnalyticsOpen] = useState(false);


  // Manga Library Database State
  const [mangaList, setMangaList] = useState<MangaItem[]>(INITIAL_MANGA_DATABASE);



  const activeProfile = profiles.find((p) => p.id === activeProfileId) || profiles[0];

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


  const handleCreateProfile = (name: string, avatar: string) => {
    const newProf: UserProfile = {
      id: 'usr_' + Date.now(),
      name,
      username: name.toLowerCase().replace(/\s+/g, '_'),
      email: `${name.toLowerCase().replace(/\s+/g, '_')}@manga.dev`,
      avatar,
      role: 'user',
      createdAt: new Date().toISOString(),
    };
    setProfiles([...profiles, newProf]);
    setActiveProfileId(newProf.id);
  };

  const handleRegisterUser = (newUser: UserProfile) => {
    setProfiles([...profiles, newUser]);
    setActiveProfileId(newUser.id);
    migrateClientSessionHistoryToUser(newUser.id);
  };

  const handlePromoteUser = (userId: string, newRole: UserRole) => {
    setProfiles((prev) =>
      prev.map((p) => (p.id === userId ? { ...p, role: newRole } : p))
    );
  };

  const handleDeleteProfile = (profileId: string) => {
    if (profiles.length <= 1) return;
    const remaining = profiles.filter((p) => p.id !== profileId);
    setProfiles(remaining);
    if (activeProfileId === profileId) {
      setActiveProfileId(remaining[0].id);
    }
  };


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

  // Modals state
  const [selectedMangaDetail, setSelectedMangaDetail] = useState<MangaItem | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editingManga, setEditingManga] = useState<MangaItem | null>(null);
  const [submitBugModalOpen, setSubmitBugModalOpen] = useState(false);
  const [bugModalInitialData, setBugModalInitialData] = useState<BugReportInitialData | undefined>(undefined);

  // Reader Mode state
  const [readerTarget, setReaderTarget] = useState<{ manga: MangaItem; chapterNumber: number; chapterId?: string } | null>(null);
  const [chapterListTarget, setChapterListTarget] = useState<MangaItem | null>(null);

  // Fetch initial data from server
  const fetchMangaList = async () => {
    try {
      const res = await fetch('/api/manga');
      if (res.ok) {
        const data = await res.json();
        setMangaList(data);
      }
    } catch (err) {
      console.error("Fetch manga list error:", err);
    }
  };

  const fetchConfig = async () => {
    try {
      const res = await fetch('/api/config');
      if (res.ok) {
        const data = await res.json();
        setConfig(data);
      }
    } catch (err) {
      console.error("Fetch config error:", err);
    }
  };

  const fetchLogs = async () => {
    try {
      const res = await fetch('/api/tracker/logs');
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
      }
    } catch (err) {
      console.error("Fetch logs error:", err);
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
    readerDefaults: {

      viewMode: 'webtoon',
      maxWidth: '850px',
      pageGap: 8,
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
    },
  });

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        setAppSettings(data);
      }
    } catch (err) {
      console.error("Fetch settings error:", err);
    }
  };

  const handleSaveSettings = async (newSettings: AppSettings) => {
    setAppSettings(newSettings);
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSettings),
      });
    } catch (err) {
      console.error("Save settings error:", err);
    }
  };

  const scanDuplicates = async () => {
    setIsScanningDuplicates(true);
    try {
      const res = await fetch('/api/tracker/detect-duplicates', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setDuplicates(data);
      }
    } catch (err) {
      console.error("Scan duplicates error:", err);
    } finally {
      setIsScanningDuplicates(false);
    }
  };

  // Device-Specific Cache Helper (Stores preferences per device)
  const getDeviceId = (): string => {
    try {
      let devId = localStorage.getItem('graywood_device_id');
      if (!devId) {
        devId = 'dev_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
        localStorage.setItem('graywood_device_id', devId);
      }
      return devId;
    } catch (_) {
      return 'dev_default';
    }
  };

  const fetchClientContext = async () => {
    try {
      const res = await fetch('/api/auth/client-context');
      if (res.ok) {
        const data = await res.json();
        setIsHostComputer(data.isHost);
        if (!data.isHost) {
          setActiveProfileId('usr_guest');
        } else {
          // Check per-device cached profile for host PC
          const cachedProfileId = localStorage.getItem(`graywood_${getDeviceId()}_active_profile`);
          if (cachedProfileId && profiles.some((p) => p.id === cachedProfileId)) {
            setActiveProfileId(cachedProfileId);
          }
        }
      }
    } catch (err) {
      console.error("Fetch client context error:", err);
    }
  };

  // ── CLIENT-SIDE SESSION READING HISTORY ENGINE ─────────────────────────────────────
  const CLIENT_SESSION_STORAGE_KEY = 'graywood_client_session_reading_history';

  const getClientSessionHistory = (): Record<string, { currentChapter: number; lastReadAt: string }> => {
    try {
      const raw = localStorage.getItem(CLIENT_SESSION_STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_) {
      return {};
    }
  };

  const saveClientSessionProgress = (mangaId: string, chapterNumber: number) => {
    try {
      const history = getClientSessionHistory();
      const existingCh = history[mangaId]?.currentChapter || 0;
      const nextCh = Math.max(existingCh, chapterNumber);
      history[mangaId] = {
        currentChapter: nextCh,
        lastReadAt: new Date().toISOString(),
      };
      localStorage.setItem(CLIENT_SESSION_STORAGE_KEY, JSON.stringify(history));
      console.log(`[Client Session Engine] Saved reading progress Ch. ${nextCh} for ${mangaId} in client session storage.`);
    } catch (err) {
      console.error("[Client Session Engine] Storage error:", err);
    }
  };

  const migrateClientSessionHistoryToUser = async (targetUserId: string) => {
    const sessionHistory = getClientSessionHistory();
    const entries = Object.entries(sessionHistory);
    if (entries.length === 0) return;

    console.log(`[Client Session Engine] Migrating ${entries.length} client session reading entries to user ${targetUserId}...`);

    for (const [mangaId, record] of entries) {
      try {
        await fetch('/api/reader/mark-read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mangaId, chapterNumber: record.currentChapter, userId: targetUserId }),
        });
      } catch (_) {}
    }

    try {
      localStorage.removeItem(CLIENT_SESSION_STORAGE_KEY);
    } catch (_) {}
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
    fetchClientContext();
    fetchMangaList();
    fetchConfig();
    fetchLogs();
    fetchSettings();
  }, []);


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

  // ── URL & HTML5 HISTORY ROUTING ENGINE ─────────────────────────────────────
  const updateUrl = (path: string) => {
    if (window.location.pathname !== path) {
      window.history.pushState(null, '', path);
    }
  };

  const handleTabChange = (tab: AppNavTab) => {
    setActiveTab(tab);
    const tabPaths: Record<string, string> = {
      library: '/',
      browse: '/browse',
      sources: '/sources',
      autoupdate: '/autoupdate',
      duplicates: '/duplicates',
      openapi: '/openapi',
    };
    updateUrl(tabPaths[tab] || '/');
  };

  useEffect(() => {
    const syncRouteFromUrl = () => {
      const path = window.location.pathname;
      if (path.startsWith('/browse')) {
        setActiveTab('browse');
      } else if (path.startsWith('/sources')) {
        setActiveTab('sources');
      } else if (path.startsWith('/autoupdate')) {
        setActiveTab('autoupdate');
      } else if (path.startsWith('/duplicates')) {
        setActiveTab('duplicates');
      } else if (path.startsWith('/openapi')) {
        setActiveTab('openapi');
      } else if (path.startsWith('/series/')) {
        const id = path.split('/series/')[1]?.split('?')[0];
        const item = mangaList.find((m) => m.id === id);
        if (item) setSelectedMangaDetail(item);
      } else if (path.startsWith('/reader/')) {
        const parts = path.split('/reader/')[1]?.split('/');
        const id = parts?.[0];
        const ch = parts?.[1] ? parseInt(parts[1], 10) : 1;
        const item = mangaList.find((m) => m.id === id);
        if (item) setReaderTarget({ manga: item, chapterNumber: ch });
      } else {
        setActiveTab('library');
      }
    };

    syncRouteFromUrl();
    window.addEventListener('popstate', syncRouteFromUrl);
    return () => window.removeEventListener('popstate', syncRouteFromUrl);
  }, [mangaList]);



  // Run Auto-Update Crawler
  const handleRunAutoUpdate = async () => {
    setIsUpdating(true);
    try {
      const res = await fetch('/api/tracker/auto-update', { method: 'POST' });
      if (res.ok) {
        await fetchMangaList();
        await fetchLogs();
        await fetchConfig();
      }
    } catch (err) {
      console.error("Auto update error:", err);
    } finally {
      setIsUpdating(false);
    }
  };

  // Increment Chapter (+1)
  const handleIncrementChapter = async (id: string) => {
    if (activeProfile.role === 'admin') {
      // Host Administrator never keeps read-chapter history.
      console.log("[Host Admin] Chapter progress is not tracked for the Host Administrator.");
      return;
    }
    let nextCh = 1;
    setMangaList((prev) =>
      prev.map((m) => {
        if (m.id === id) {
          nextCh = m.currentChapter + 1;
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
      // Guest / Unregistered Client: Save strictly on client side!
      saveClientSessionProgress(id, nextCh);
      return;
    }

    try {
      await fetch(`/api/manga/increment/${id}`, { method: 'POST' });
    } catch (err) {
      console.error("Increment chapter error:", err);
    }
  };

  // Save or Update Series
  const handleSaveManga = async (mangaData: Partial<MangaItem>) => {
    try {
      if (mangaData.id) {
        // Edit existing
        const res = await fetch(`/api/manga/${mangaData.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(mangaData),
        });
        if (res.ok) {
          await fetchMangaList();
        }
      } else {
        // Add new
        const res = await fetch('/api/manga', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(mangaData),
        });
        if (res.ok) {
          await fetchMangaList();
        }
      }
    } catch (err) {
      console.error("Save manga error:", err);
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

  // Delete Series
  const handleDeleteManga = async (id: string) => {
    if (!confirm('Are you sure you want to remove this series from your tracker?')) return;
    try {
      const res = await fetch(`/api/manga/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setMangaList((prev) => prev.filter((m) => m.id !== id));
        if (selectedMangaDetail?.id === id) setSelectedMangaDetail(null);
      }
    } catch (err) {
      console.error("Delete manga error:", err);
    }
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
      const res = await fetch('/api/tracker/merge-duplicates', {
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
      console.error("Merge duplicates error:", err);
    }
  };

  // Update Subdomain
  const handleUpdateSubdomain = async (subdomain: string) => {
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subdomain }),
      });
      if (res.ok) {
        await fetchConfig();
      }
    } catch (err) {
      console.error("Update subdomain error:", err);
    }
  };

  // Export DB
  const handleExportDb = (format: 'json' | 'csv') => {
    window.open(`/api/db/export?format=${format}`, '_blank');
  };

  // Import DB
  const handleImportDb = async (data: MangaItem[], replaceExisting: boolean) => {
    try {
      const res = await fetch('/api/db/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data, replaceExisting }),
      });
      if (res.ok) {
        await fetchMangaList();
        await scanDuplicates();
      }
    } catch (err) {
      console.error("Import DB error:", err);
    }
  };

  // Reset DB
  const handleResetDb = async () => {
    if (!confirm('Reset tracker database to sample dataset?')) return;
    try {
      const res = await fetch('/api/db/reset', { method: 'POST' });
      if (res.ok) {
        await fetchMangaList();
        await fetchLogs();
        await scanDuplicates();
      }
    } catch (err) {
      console.error("Reset DB error:", err);
    }
  };

  // Reader Launch Handlers
  const handleSelectMangaDetail = (manga: MangaItem | null) => {
    setSelectedMangaDetail(manga);
    if (manga) {
      updateUrl(`/series/${manga.id}`);
    } else {
      const tabPaths: Record<string, string> = {
        library: '/',
        browse: '/browse',
        sources: '/sources',
        updates: '/updates',
        autoupdate: '/autoupdate',
        duplicates: '/duplicates',
        openapi: '/openapi',
      };
      updateUrl(tabPaths[activeTab] || '/');
    }
  };

  const handleOpenReader = (manga: MangaItem, chapterNumber?: number, chapterId?: string) => {
    const isHostAdmin = activeProfile.role === 'admin';
    const isGuestClient = activeProfile.id === 'usr_guest';

    let ch: number;
    if (chapterId) {
      // Explicit chapter picked from the chapter list — always honor it.
      ch = chapterNumber || 1;
    } else if (isHostAdmin) {
      // Host Administrator never tracks progress; always open the first chapter.
      ch = 1;
    } else if (isGuestClient) {
      // Clients (guest) start at the first real chapter on their first connect,
      // resuming only from their own locally-saved progress, if any.
      const saved = getClientSessionHistory()[manga.id]?.currentChapter || 0;
      ch = saved > 0 ? saved : 1;
    } else {
      // Registered returning user: resume from tracked progress.
      ch = chapterNumber !== undefined ? chapterNumber : manga.currentChapter || 1;
    }

    setReaderTarget({ manga, chapterNumber: ch, chapterId });
    updateUrl(`/reader/${manga.id}/${ch}`);
  };

  const handleCloseReader = () => {
    setReaderTarget(null);
    const tabPaths: Record<string, string> = {
      library: '/',
      browse: '/browse',
      sources: '/sources',
      autoupdate: '/autoupdate',
      duplicates: '/duplicates',
      openapi: '/openapi',
    };
    updateUrl(tabPaths[activeTab] || '/');
  };

  const handleOpenChapters = (manga: MangaItem) => {
    setChapterListTarget(manga);
  };

  const handleOpenSubmitBug = () => {
    setBugModalInitialData(undefined);
    setSubmitBugModalOpen(true);
  };

  // Called by the Flag Issue modal after a user picks a category: opens the bug-reporting tool
  // pre-filled with the chosen category and the flagged series context.
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
      console.log("[Incognito] Private reading mode active - read history suppressed.");
      return;
    }

    if (activeProfile.role === 'admin') {
      // Host Administrator never keeps read-chapter history.
      console.log("[Host Admin] Read progress is not tracked for the Host Administrator.");
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
      // Guest / Unregistered Client: Save strictly on client side!
      saveClientSessionProgress(mangaId, chapterNumber);
      return;
    }

    try {
      await fetch('/api/reader/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mangaId, chapterNumber }),
      });
    } catch (err) {
      console.error("Mark read error:", err);
    }
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
          onLogin={(user) => {
            setActiveProfileId(user.id);
            migrateClientSessionHistoryToUser(user.id);
            setAuthModalOpen(false);
          }}
          onRegister={handleRegisterUser}
          existingUsers={profiles}
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
