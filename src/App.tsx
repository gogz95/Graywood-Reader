import React, { useState, useEffect, useMemo } from 'react';

import { Navbar } from './components/Navbar';
import { LibraryView } from './components/LibraryView';
import { AutoUpdateView } from './components/AutoUpdateView';
import { OpenApiFinderView } from './components/OpenApiFinderView';
import { DuplicateFinderView } from './components/DuplicateFinderView';
import { DatabaseSyncView } from './components/DatabaseSyncView';
import { MangaDetailModal } from './components/MangaDetailModal';
import { AddEditModal } from './components/AddEditModal';
import { ReaderView } from './components/ReaderView';
import { ChapterListModal } from './components/ChapterListModal';
import { SettingsModal } from './components/SettingsModal';
import { ReaderHubView } from './components/ReaderHubView';
import { TrackerView } from './components/TrackerView';
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

import { LocalMangaReaderModal } from './components/LocalMangaReaderModal';
import { AnalyticsModal } from './components/AnalyticsModal';
import { UserProfileModal } from './components/UserProfileModal';
import { AuthModal } from './components/AuthModal';
import { AdminPanelModal } from './components/AdminPanelModal';
import { BrowseView } from './components/BrowseView';
import { KotatsuSourcesView } from './components/KotatsuSourcesView';
import { UserProfile, UserRole } from './types';




export default function App() {
  const [activeTab, setActiveTab] = useState<AppNavTab>('library');

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
      storageFolderPath: 'C:\\Users\\gogz9\\MangaStorage\\Admin',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'usr_jordan',
      name: 'Jordan',
      username: 'jordan',
      email: 'jordan@manga.dev',
      avatar: '🦊',
      role: 'user',
      storageFolderPath: 'C:\\Users\\gogz9\\MangaStorage\\Jordan',
      createdAt: new Date().toISOString(),
    },
  ]);
  const [activeProfileId, setActiveProfileId] = useState<string>('usr_admin');
  const [userProfileModalOpen, setUserProfileModalOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [adminPanelOpen, setAdminPanelOpen] = useState(false);

  // New Modals State
  const [localReaderOpen, setLocalReaderOpen] = useState(false);
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


  const handleCreateProfile = (name: string, avatar: string, storageFolderPath: string) => {
    const newProf: UserProfile = {
      id: 'usr_' + Date.now(),
      name,
      username: name.toLowerCase().replace(/\s+/g, '_'),
      email: `${name.toLowerCase().replace(/\s+/g, '_')}@manga.dev`,
      avatar,
      role: 'user',
      storageFolderPath,
      createdAt: new Date().toISOString(),
    };
    setProfiles([...profiles, newProf]);
    setActiveProfileId(newProf.id);
  };

  const handleRegisterUser = (newUser: UserProfile) => {
    setProfiles([...profiles, newUser]);
  };

  const handlePromoteUser = (userId: string, newRole: UserRole) => {
    setProfiles((prev) =>
      prev.map((p) => (p.id === userId ? { ...p, role: newRole } : p))
    );
  };

  const handleUpdateProfileFolder = (profileId: string, folderPath: string) => {
    setProfiles((prev) =>
      prev.map((p) => (p.id === profileId ? { ...p, storageFolderPath: folderPath } : p))
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
    customUserAgent: 'Kotatsu/4.8.2 (Android 14; Mobile; OmniManga-Sync)',
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

  useEffect(() => {
    fetchMangaList();
    fetchConfig();
    fetchLogs();
    fetchSettings();
  }, []);


  // Synchronize App Theme on body element
  useEffect(() => {
    if (appSettings.appTheme) {
      document.body.className = `theme-${appSettings.appTheme}`;
    }
  }, [appSettings.appTheme]);



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
    // Optimistic UI update
    setMangaList((prev) =>
      prev.map((m) => {
        if (m.id === id) {
          const nextCh = m.currentChapter + 1;
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

  // Toggle Auto-Update per series
  const handleToggleAutoUpdateItem = async (id: string, enabled: boolean) => {
    const item = mangaList.find((m) => m.id === id);
    if (item) {
      await handleSaveManga({ ...item, autoUpdateEnabled: enabled });
    }
  };

  // Reader Launch Handlers
  const handleOpenReader = (manga: MangaItem, chapterNumber?: number, chapterId?: string) => {
    const chNum = chapterNumber !== undefined ? chapterNumber : Math.max(1, manga.currentChapter + 1);
    setReaderTarget({ manga, chapterNumber: chNum, chapterId });
  };

  const handleOpenChapters = (manga: MangaItem) => {
    setChapterListTarget(manga);
  };

  const handleMarkChapterRead = async (mangaId: string, chapterNumber: number) => {
    if (isIncognito) {
      console.log("[Incognito] Private reading mode active - read history suppressed.");
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
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans antialiased selection:bg-amber-500 selection:text-slate-950 flex flex-col">
      {/* Top Fixed Header & Tab Navigation */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
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
        onOpenLocalReader={() => setLocalReaderOpen(true)}
        onOpenAnalytics={() => setAnalyticsOpen(true)}
        activeProfile={activeProfile}
        onOpenProfileModal={() => setUserProfileModalOpen(true)}
        onOpenAuthModal={() => setAuthModalOpen(true)}
        onOpenAdminPanel={() => setAdminPanelOpen(true)}
      />

      {/* Main View Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {activeTab === 'library' && (
          <LibraryView
            mangaList={myLibraryList}
            searchQuery={searchQuery}

            onIncrementChapter={handleIncrementChapter}
            onSelectManga={(manga) => setSelectedMangaDetail(manga)}
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
            mangaList={displayMangaList}
            searchQuery={searchQuery}
            onIncrementChapter={handleIncrementChapter}
            onSelectManga={(manga) => setSelectedMangaDetail(manga)}
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

        {activeTab === 'reader' && (

          <ReaderHubView
            mangaList={displayMangaList}
            onOpenReader={handleOpenReader}
            onOpenChapters={handleOpenChapters}
            onSelectManga={(manga) => setSelectedMangaDetail(manga)}
          />
        )}

        {activeTab === 'tracker' && (
          <TrackerView mangaList={displayMangaList} />
        )}


        {activeTab === 'autoupdate' && (
          <AutoUpdateView
            logs={logs}
            config={config}
            mangaList={mangaList}
            onRunAutoUpdate={handleRunAutoUpdate}
            isUpdating={isUpdating}
            onToggleAutoUpdateItem={handleToggleAutoUpdateItem}
          />
        )}

        {activeTab === 'sources' && (
          <KotatsuSourcesView
            onAddToTracker={handleSaveManga}
            onOpenReader={handleOpenReader}
            onSelectManga={(manga) => setSelectedMangaDetail(manga)}
          />
        )}
      </main>

      {/* Detail Drawer Modal */}
      {selectedMangaDetail && (
        <MangaDetailModal
          manga={selectedMangaDetail}
          onClose={() => setSelectedMangaDetail(null)}
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
        <ReaderView
          manga={readerTarget.manga}
          initialChapterNumber={readerTarget.chapterNumber}
          initialChapterId={readerTarget.chapterId}
          defaultSettings={appSettings.readerDefaults}
          onClose={() => setReaderTarget(null)}
          onMarkChapterRead={(chNum) => handleMarkChapterRead(readerTarget.manga.id, chNum)}
        />
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
        />
      )}

      {/* Local Offline CBZ / Folder Reader Modal */}

      {localReaderOpen && (
        <LocalMangaReaderModal
          onClose={() => setLocalReaderOpen(false)}
          onOpenCustomPagesReader={(title, pages) => {
            const tempManga: MangaItem = {
              id: 'local_' + Date.now(),
              title,
              altTitles: ['Local CBZ Archive'],
              type: 'manga',
              coverImage: pages[0] || '',
              description: 'Local offline manga CBZ file',
              genres: ['Offline', 'Local'],
              status: 'reading',
              currentChapter: 1,
              totalChapters: 1,
              latestChapter: 1,
              lastUpdated: new Date().toISOString(),
              rating: 10,
              sourceUrl: 'file://local',
              sourceName: 'Local CBZ Reader',
              autoUpdateEnabled: false,
              notes: 'Local file',
              addedAt: new Date().toISOString(),
              lastReadAt: new Date().toISOString(),
            };
            setReaderTarget({ manga: tempManga, chapterNumber: 1 });
          }}
        />
      )}

      {/* User Registration & Sign In Auth Modal */}
      {authModalOpen && (
        <AuthModal
          onLogin={(user) => {
            setActiveProfileId(user.id);
            setAuthModalOpen(false);
          }}
          onRegister={handleRegisterUser}
          existingUsers={profiles}
          onClose={() => setAuthModalOpen(false)}
        />
      )}

      {/* Host / Administrator Command Panel */}
      {adminPanelOpen && activeProfile.role === 'admin' && (
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






      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950 py-6 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p>OmniManga Subdomain Tracking Platform • {config.subdomain}</p>
          <p className="flex items-center gap-2">
            <span>Automatic Chapter Scanner Active</span>
            <span>•</span>
            <span className="text-amber-400 font-bold">{mangaList.length} Series Tracked</span>
          </p>
        </div>
      </footer>
    </div>
  );
}
