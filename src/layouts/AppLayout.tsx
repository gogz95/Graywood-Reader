import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router';
import { Navbar } from '../components/Navbar';
import { ConfirmModal } from '../components/ConfirmModal';

// Lazy-loaded modals
const MangaDetailModal = lazy(() => import('../components/MangaDetailModal').then((m) => ({ default: m.MangaDetailModal })));
const AddEditModal = lazy(() => import('../components/AddEditModal').then((m) => ({ default: m.AddEditModal })));
const ChapterListModal = lazy(() => import('../components/ChapterListModal').then((m) => ({ default: m.ChapterListModal })));
const UserProfileModal = lazy(() => import('../components/UserProfileModal').then((m) => ({ default: m.UserProfileModal })));
const AuthModal = lazy(() => import('../components/AuthModal').then((m) => ({ default: m.AuthModal })));
const SubmitBugModal = lazy(() => import('../components/SubmitBugModal').then((m) => ({ default: m.SubmitBugModal })));
const ExtensionManagerModal = lazy(() => import('../components/ExtensionManagerModal').then((m) => ({ default: m.ExtensionManagerModal })));
const AppLockOverlay = lazy(() => import('../components/AppLockOverlay').then((m) => ({ default: m.AppLockOverlay })));
const CommandPaletteModal = lazy(() => import('../components/CommandPaletteModal').then((m) => ({ default: m.CommandPaletteModal })));
const InitialSetupWizard = lazy(() => import('../components/InitialSetupWizard').then((m) => ({ default: m.InitialSetupWizard })));
const BulkScrapeModal = lazy(() => import('../components/BulkScrapeModal').then((m) => ({ default: m.BulkScrapeModal })));
const DownloadManagerModal = lazy(() => import('../components/DownloadManagerModal').then((m) => ({ default: m.DownloadManagerModal })));
const ReadlistsModal = lazy(() => import('../components/ReadlistsModal').then((m) => ({ default: m.ReadlistsModal })));
const SettingsModal = lazy(() => import('../components/SettingsModal').then((m) => ({ default: m.SettingsModal })));
const AnalyticsModal = lazy(() => import('../components/AnalyticsModal').then((m) => ({ default: m.AnalyticsModal })));
const AchievementsModal = lazy(() => import('../components/AchievementsModal').then((m) => ({ default: m.AchievementsModal })));
const AdminPanelModal = lazy(() => import('../components/AdminPanelModal').then((m) => ({ default: m.AdminPanelModal })));
const ChallengeNotificationModal = lazy(() => import('../components/ChallengeNotificationModal').then((m) => ({ default: m.ChallengeNotificationModal })));
const ReaderView = lazy(() => import('../components/ReaderView').then((m) => ({ default: m.ReaderView })));
const PwaInstallPrompt = lazy(() => import('../components/PwaInstallPrompt').then((m) => ({ default: m.PwaInstallPrompt })));

import { OfflineIndicator } from '../components/OfflineIndicator';
import { usePwaInstall } from '../hooks/usePwaInstall';
import { MangaItem, AppTheme, AppSettings, AppNavTab } from '../types';
import { apiFetch } from '../utils/api';
import { useRealtimeSync } from '../hooks/useRealtimeSync';
import {
  useAuthStore,
  useSettingsStore,
  useLibraryStore,
  useReaderStore,
  useModalStore,
  useDisplayMangaList,
  GUEST_PROFILE,
  getDeviceId,
} from '../stores';

const ViewFallback = () => (
  <div className="flex items-center justify-center py-20">
    <div className="w-8 h-8 border-3 border-accent/30 border-t-accent rounded-full animate-spin" />
  </div>
);

const TAB_PATHS: Record<string, string> = {
  welcome: '/',
  library: '/library',
  browse: '/browse',
  categories: '/categories',
  sources: '/sources',
  autoupdate: '/autoupdate',
  duplicates: '/duplicates',
  openapi: '/openapi',
};

export function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();

  const {
    profiles,
    activeProfileId,
    setActiveProfileId,
    activeProfile,
    isHostComputer,
    isGuestClient,
    fetchClientContext,
    fetchProfiles,
    fetchAuthMe,
    handleRegisterUser,
    handleLoginUser,
    handleLogoutUser,
    handleUpdateProfile,
    handlePromoteUser,
    handleDeleteProfile,
  } = useAuthStore();

  const {
    appSettings,
    settingsLoaded,
    pendingChallengesCount,
    activeDownloadsCount,
    fetchSettings,
    handleSaveSettings: saveSettingsBase,
    startPolling,
    stopPolling,
  } = useSettingsStore();

  const {
    mangaList,
    logs,
    duplicates,
    config,
    isUpdating,
    isScanningDuplicates,
    fetchMangaList,
    fetchLogs,
    fetchConfig,
    scanDuplicates,
    saveManga,
    addFromOpenApi,
    deleteManga,
    executeMerge,
    dismissDuplicate,
    runAutoUpdate,
    incrementChapter,
    bulkUpdateStatus,
    bulkDelete,
    updateSubdomain,
    importDb,
    resetDb,
  } = useLibraryStore();

  const displayMangaList = useDisplayMangaList();

  const {
    readerTarget,
    chapterListTarget,
    setChapterListTarget,
    isIncognito,
    toggleIncognito,
    openReader,
    closeReader,
    markChapterRead,
    reportMangaIssue,
  } = useReaderStore();

  const { openModals, isOpen, openModal, closeModal, data: modalData, setModalData } = useModalStore();

  const { canInstall } = usePwaInstall();
  const [pwaModalOpen, setPwaModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isAppLocked, setIsAppLocked] = useState<boolean>(false);

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

  const activeTab: AppNavTab = (() => {
    const p = location.pathname;
    if (p === '/' || p.startsWith('/welcome')) return 'welcome';
    if (p.startsWith('/library')) return 'library';
    if (p.startsWith('/browse')) return 'browse';
    if (p.startsWith('/categories')) return 'categories';
    if (p.startsWith('/sources')) return 'sources';
    if (p.startsWith('/autoupdate')) return 'autoupdate';
    if (p.startsWith('/duplicates')) return 'duplicates';
    if (p.startsWith('/openapi')) return 'openapi';
    return 'welcome';
  })();

  const handleTabChange = useCallback((tab: AppNavTab) => {
    navigate(TAB_PATHS[tab] || '/');
  }, [navigate]);

  useRealtimeSync('*', (event) => {
    if (event.type === 'library_updated' || event.type === 'progress_updated') {
      fetchMangaList();
    }
  });

  useEffect(() => {
    fetchClientContext();
    fetchProfiles();
    fetchAuthMe();
    fetchSettings();
    fetchMangaList();
    fetchConfig();
    fetchLogs();
    startPolling();
    return () => stopPolling();
  }, []);

  // Manga Together: Deep Link & Auto-join room via ?room=CODE
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const roomCode = params.get('room');
    if (!roomCode || mangaList.length === 0) return;

    apiFetch(`/api/rooms/${roomCode.toUpperCase()}`)
      .then(async (res) => {
        if (!res.ok) return;
        const room = await res.json();
        if (room && room.mangaId) {
          const targetManga = mangaList.find((m) => m.id === room.mangaId);
          if (targetManga) {
            openReader(targetManga, room.chapterNumber || 1);
          }
        }
      })
      .catch(() => {});
  }, [location.search, mangaList, openReader]);

  const effectiveTheme = useMemo(() => {
    if ((appSettings.appTheme as string) === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return appSettings.appTheme || 'dark';
  }, [appSettings.appTheme]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('theme-light', 'theme-dark', 'theme-oled');
    root.classList.add(`theme-${effectiveTheme}`);
  }, [effectiveTheme]);

  const handleSaveSettings = useCallback(
    async (newSettings: AppSettings) => {
      await saveSettingsBase(newSettings);
      if (newSettings.appLockEnabled && newSettings.appLockPinHash && !isAppLocked) {
        setIsAppLocked(true);
      }
    },
    [saveSettingsBase, isAppLocked]
  );

  const selectedMangaDetail = modalData.selectedMangaDetail;

  const handleSelectMangaDetail = useCallback((manga: MangaItem | null) => {
    setModalData({ selectedMangaDetail: manga });
  }, [setModalData]);

  const handleOpenReaderWithUrl = useCallback(
    (manga: MangaItem, chapterNumber?: number, chapterId?: string) => {
      openReader(manga, chapterNumber, chapterId);
    },
    [openReader]
  );

  const handleCloseReaderWithUrl = useCallback(() => {
    closeReader();
  }, [closeReader]);

  const handleDeleteMangaWithConfirm = useCallback(
    (id: string) => {
      const manga = mangaList.find((m) => m.id === id);
      const title = manga?.title || 'this series';
      setConfirmModal({
        isOpen: true,
        title: 'Delete Series',
        message: `Are you sure you want to remove "${title}" from your library?`,
        confirmLabel: 'Delete Series',
        variant: 'danger',
        onConfirm: () => {
          deleteManga(id);
          handleSelectMangaDetail(null);
          closeConfirmModal();
        },
      });
    },
    [mangaList, deleteManga, handleSelectMangaDetail]
  );

  const handleResetDbWithConfirm = useCallback(() => {
    setConfirmModal({
      isOpen: true,
      title: 'Reset Database',
      message: 'This will purge all tracked series and reset settings to default. Are you sure?',
      confirmLabel: 'Reset Database',
      variant: 'danger',
      onConfirm: () => {
        resetDb();
        closeConfirmModal();
      },
    });
  }, [resetDb]);

  const handleOpenSubmitBug = (initialData?: any) => {
    setModalData({ bugReportInitialData: initialData });
    openModal('submitBug');
  };

  const handleOpenAddModal = () => {
    setModalData({ editingManga: null });
    openModal('addEdit');
  };

  const handleOpenAuthModal = (mode: 'login' | 'register' = 'login') => {
    setModalData({ authModalMode: mode });
    openModal('auth');
  };

  return (
    <div className="min-h-screen bg-app-bg text-main font-sans antialiased selection:bg-accent/20 selection:text-accent flex flex-col">
      <Navbar
        activeTab={activeTab}
        setActiveTab={handleTabChange}
        subdomain={config.subdomain || 'local'}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        unreadCount={mangaList.filter((m) => m.latestChapter > m.currentChapter).length}
        duplicateCount={duplicates.length}
        pendingChallengesCount={pendingChallengesCount}
        activeDownloadsCount={activeDownloadsCount}
        onOpenAddModal={handleOpenAddModal}
        onRunAutoUpdate={runAutoUpdate}
        isUpdating={isUpdating}
        onOpenSettingsModal={() => openModal('settings')}
        isIncognito={isIncognito}
        onToggleIncognito={toggleIncognito}
        onOpenAnalytics={() => openModal('analytics')}
        onOpenAchievements={() => openModal('achievements')}
        onOpenChallengesModal={() => openModal('challenges')}
        onOpenDownloadManager={() => openModal('downloadManager')}
        onOpenReadlists={() => openModal('readlists')}
        activeProfile={activeProfile}
        isHostComputer={isHostComputer}
        onOpenProfileModal={() => openModal('userProfile')}
        onOpenAuthModal={(mode) => handleOpenAuthModal(mode || 'login')}
        onOpenAdminPanel={() => openModal('adminPanel')}
        onOpenSubmitBugModal={handleOpenSubmitBug}
        onOpenExtensionManager={() => openModal('extensionManager')}
        onOpenCommandPalette={() => openModal('commandPalette')}
        onOpenPwaInstall={() => setPwaModalOpen(true)}
        canInstallPwa={canInstall}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-6">
        <Suspense fallback={<ViewFallback />}>
          <Outlet context={{ searchQuery, setSearchQuery }} />
        </Suspense>
      </main>

      {/* Detail Drawer Modal */}
      {selectedMangaDetail && (
        <Suspense fallback={null}>
          <MangaDetailModal
            manga={selectedMangaDetail}
            isGuest={isGuestClient}
            onOpenAuthModal={() => handleOpenAuthModal('login')}
            onClose={() => handleSelectMangaDetail(null)}
            onUpdateManga={(updated) => {
              saveManga(updated);
              handleSelectMangaDetail(updated);
            }}
            onDeleteManga={handleDeleteMangaWithConfirm}
            onEditManga={(m) => {
              setModalData({ editingManga: m });
              openModal('addEdit');
            }}
            onOpenReader={handleOpenReaderWithUrl}
            onOpenChapters={(manga) => setChapterListTarget(manga)}
            onReport={reportMangaIssue}
          />
        </Suspense>
      )}

      {/* Add/Edit Series Modal */}
      {isOpen('addEdit') && (
        <Suspense fallback={null}>
          <AddEditModal
            initialManga={modalData.editingManga}
            onClose={() => {
              closeModal('addEdit');
              setModalData({ editingManga: null });
            }}
            onSave={saveManga}
          />
        </Suspense>
      )}

      {/* Fullscreen Kotatsu Reader Mode View */}
      {readerTarget && (
        <Suspense fallback={null}>
          <ReaderView
            manga={readerTarget.manga}
            isGuest={isGuestClient}
            onOpenAuthModal={() => handleOpenAuthModal('login')}
            initialChapterNumber={readerTarget.chapterNumber}
            initialChapterId={readerTarget.chapterId}
            defaultSettings={appSettings.readerDefaults}
            privateModeEnabled={appSettings.privateModeEnabled}
            onClose={handleCloseReaderWithUrl}
            onMarkChapterRead={(chNum) => markChapterRead(readerTarget.manga.id, chNum)}
            onReport={reportMangaIssue}
            onSaveSettings={(newReaderSettings) =>
              handleSaveSettings({ ...appSettings, readerDefaults: newReaderSettings })
            }
          />
        </Suspense>
      )}

      {/* Chapter List Modal */}
      {chapterListTarget && (
        <Suspense fallback={null}>
          <ChapterListModal
            manga={chapterListTarget}
            onClose={() => setChapterListTarget(null)}
            onOpenReader={(chNum, chId) => handleOpenReaderWithUrl(chapterListTarget, chNum, chId)}
            onMarkRead={(chNum) => markChapterRead(chapterListTarget.id, chNum)}
          />
        </Suspense>
      )}

      {/* Kotatsu Settings Modal */}
      {isOpen('settings') && (
        <Suspense fallback={null}>
          <SettingsModal
            settings={appSettings}
            onSaveSettings={handleSaveSettings}
            onClose={() => closeModal('settings')}
            onRefreshData={() => {
              fetchMangaList();
              fetchConfig();
              fetchLogs();
              fetchSettings();
            }}
            duplicateCandidates={duplicates}
            onScanDuplicates={scanDuplicates}
            isScanningDuplicates={isScanningDuplicates}
            onExecuteMerge={executeMerge}
            dbConfig={config}
            mangaCount={mangaList.length}
            onUpdateSubdomain={updateSubdomain}
            onExportDb={(format) => window.open(`/api/db/export?format=${format}`, '_blank')}
            onImportDb={importDb}
            onResetDb={handleResetDbWithConfirm}
            activeProfile={activeProfile}
            logs={logs}
            mangaList={mangaList}
            onRunAutoUpdate={runAutoUpdate}
            isUpdating={isUpdating}
            onOpenSetupWizard={() => openModal('setupWizard')}
          />
        </Suspense>
      )}

      {/* Auth Modal */}
      {isOpen('auth') && (
        <Suspense fallback={null}>
          <AuthModal
            onLogin={handleLoginUser}
            onRegister={handleRegisterUser}
            existingUsers={profiles}
            initialMode={modalData.authModalMode}
            guestProfile={GUEST_PROFILE}
            onClose={() => closeModal('auth')}
          />
        </Suspense>
      )}

      {/* User Profiles Selector Modal */}
      {isOpen('userProfile') && (
        <Suspense fallback={null}>
          <UserProfileModal
            profiles={profiles}
            activeProfileId={activeProfileId}
            isHostComputer={isHostComputer}
            onSelectProfile={(id) => {
              setActiveProfileId(id);
              closeModal('userProfile');
            }}
            onOpenAuthModal={(mode) => handleOpenAuthModal(mode || 'login')}
            onUpdateProfile={handleUpdateProfile}
            onLogout={handleLogoutUser}
            onDeleteProfile={handleDeleteProfile}
            onClose={() => closeModal('userProfile')}
          />
        </Suspense>
      )}

      {/* Host / Administrator Command Panel */}
      {isOpen('adminPanel') && activeProfile.role === 'admin' && isHostComputer && (
        <Suspense fallback={null}>
          <AdminPanelModal
            currentUser={activeProfile}
            allUsers={profiles}
            mangaList={mangaList}
            onPromoteUser={handlePromoteUser}
            onDeleteUser={handleDeleteProfile}
            onSwitchUserView={(u) => {
              setActiveProfileId(u.id);
              closeModal('adminPanel');
            }}
            onClose={() => closeModal('adminPanel')}
          />
        </Suspense>
      )}

      {/* Submit Bug Tracker Modal */}
      {isOpen('submitBug') && (
        <Suspense fallback={null}>
          <SubmitBugModal
            currentUser={activeProfile}
            initialData={modalData.bugReportInitialData}
            onClose={() => closeModal('submitBug')}
          />
        </Suspense>
      )}

      {/* Analytics Modal */}
      {isOpen('analytics') && (
        <Suspense fallback={null}>
          <AnalyticsModal
            mangaList={displayMangaList}
            onClose={() => closeModal('analytics')}
          />
        </Suspense>
      )}

      {/* Reading Achievements & Manga Wrapped Modal */}
      {isOpen('achievements') && (
        <Suspense fallback={null}>
          <AchievementsModal
            isOpen={isOpen('achievements')}
            onClose={() => closeModal('achievements')}
            mangaList={displayMangaList}
          />
        </Suspense>
      )}

      {/* Community Extension Store */}
      {isOpen('extensionManager') && (
        <Suspense fallback={null}>
          <ExtensionManagerModal
            isOpen={isOpen('extensionManager')}
            onClose={() => closeModal('extensionManager')}
          />
        </Suspense>
      )}

      {/* Global Cmd+K Command Palette */}
      {isOpen('commandPalette') && (
        <Suspense fallback={null}>
          <CommandPaletteModal
            isOpen={isOpen('commandPalette')}
            onClose={() => closeModal('commandPalette')}
            mangaList={displayMangaList}
            activeTab={activeTab}
            setActiveTab={handleTabChange}
            isIncognito={isIncognito}
            onToggleIncognito={toggleIncognito}
            onOpenAddModal={handleOpenAddModal}
            onRunAutoUpdate={runAutoUpdate}
            onOpenSettingsModal={() => openModal('settings')}
            onOpenAnalytics={() => openModal('analytics')}
            onOpenAchievements={() => openModal('achievements')}
            onOpenExtensionManager={() => openModal('extensionManager')}
            onOpenSubmitBugModal={handleOpenSubmitBug}
            onSelectManga={handleSelectMangaDetail}
            onOpenReader={handleOpenReaderWithUrl}
          />
        </Suspense>
      )}

      {/* Manual Challenge & Captcha Notification Modal */}
      <Suspense fallback={null}>
        <ChallengeNotificationModal
          isOpen={isOpen('challenges')}
          onClose={() => closeModal('challenges')}
          onChallengesCountChange={(cnt) => useSettingsStore.getState().setPendingChallengesCount(cnt)}
        />
      </Suspense>

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

      {/* Glassmorphic Application Lock Overlay */}
      {appSettings.appLockEnabled && (
        <Suspense fallback={null}>
          <AppLockOverlay
            isLocked={isAppLocked}
            pinHash={appSettings.appLockPinHash || ''}
            lockType={appSettings.appLockType || 'pin'}
            onUnlock={() => setIsAppLocked(false)}
          />
        </Suspense>
      )}

      {/* Initial Setup Wizard Modal */}
      {isOpen('setupWizard') && (
        <Suspense fallback={null}>
          <InitialSetupWizard
            isOpen={isOpen('setupWizard')}
            onComplete={() => {
              closeModal('setupWizard');
              fetchSettings();
              fetchMangaList();
            }}
            onClose={() => closeModal('setupWizard')}
            isHostComputer={isHostComputer}
            activeProfile={activeProfile}
            appSettings={appSettings}
            onSaveSettings={handleSaveSettings}
            onOpenBulkScrapeModal={() => openModal('bulkScrape')}
          />
        </Suspense>
      )}

      {/* Global Bulk Scraper Harvester Modal */}
      {isOpen('bulkScrape') && (
        <Suspense fallback={null}>
          <BulkScrapeModal
            isOpen={isOpen('bulkScrape')}
            onClose={() => {
              closeModal('bulkScrape');
              fetchMangaList();
            }}
          />
        </Suspense>
      )}

      {/* Download Manager Modal */}
      {isOpen('downloadManager') && (
        <Suspense fallback={null}>
          <DownloadManagerModal
            isOpen={isOpen('downloadManager')}
            onClose={() => closeModal('downloadManager')}
            mangaList={mangaList}
            onOpenReader={(manga, chNum) => handleOpenReaderWithUrl(manga, chNum)}
          />
        </Suspense>
      )}

      {/* Cross-Series Story Arcs & Custom Readlists Modal */}
      {isOpen('readlists') && (
        <Suspense fallback={null}>
          <ReadlistsModal
            isOpen={isOpen('readlists')}
            onClose={() => closeModal('readlists')}
            mangaList={mangaList}
            onOpenReaderPlaylist={(readlist, startIndex = 0) => {
              closeModal('readlists');
              const items = readlist.items || [];
              const startItem = items[startIndex] || items[0];
              if (startItem) {
                const targetManga = mangaList.find((m) => m.id === startItem.mangaId) || {
                  id: startItem.mangaId,
                  title: startItem.mangaTitle || 'Untitled Series',
                  altTitles: [],
                  type: 'manhwa' as const,
                  coverImage: startItem.mangaCover || '',
                  description: '',
                  genres: [],
                  status: 'reading' as const,
                  currentChapter: startItem.chapterNumber - 1,
                  latestChapter: startItem.chapterNumber,
                  totalChapters: null,
                  lastUpdated: new Date().toISOString(),
                  rating: 9.0,
                  sourceUrl: startItem.mangaSourceUrl || '',
                  sourceName: startItem.mangaSourceName || '',
                  autoUpdateEnabled: true,
                  isFavorite: true,
                  isFlagged: false,
                  notes: '',
                  addedAt: new Date().toISOString(),
                  lastReadAt: new Date().toISOString(),
                  metadataOverrides: [],
                  customTags: [],
                  categories: [],
                  isNsfw: false,
                };
                openReader(targetManga, startItem.chapterNumber);
              }
            }}
          />
        </Suspense>
      )}

      {/* Offline Connectivity Status Toast */}
      <OfflineIndicator />

      {/* PWA App Installation Dialog */}
      {pwaModalOpen && (
        <Suspense fallback={null}>
          <PwaInstallPrompt
            isOpen={pwaModalOpen}
            onClose={() => setPwaModalOpen(false)}
          />
        </Suspense>
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
