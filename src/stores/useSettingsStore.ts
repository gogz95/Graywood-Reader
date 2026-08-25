import { create } from 'zustand';
import { apiFetch } from '../utils/api';
import { AppSettings, AppTheme } from '../types';

// ============================================================================
// useSettingsStore — Global app settings state (Zustand)
// Replaces useSettingsState() hook. Settings are now globally accessible.
// Includes polling for challenges/downloads counts.
// ============================================================================

const DEFAULT_SETTINGS: AppSettings = {
  appTheme: 'amber',
  libraryLayout: 'grid',
  gridColumns: 4,
  autoMarkReadPercent: 80,
  enableDownloadOffline: true,
  sourceTimeoutSeconds: 15,
  anilistConnected: true,
  malConnected: false,
  malAutoSync: false,
  kitsuConnected: false,
  kitsuAutoSync: false,
  privateModeEnabled: false,
  mangadexConnected: true,
  mangadexMetadataEnabled: true,
  anilistMetadataEnabled: true,
  malEnabled: true,
  kitsuMetadataEnabled: true,
  mangaUpdatesEnabled: true,
  mangaUpdatesUsername: '',
  mangaUpdatesPassword: '',
  openlibraryEnabled: true,
  googleBooksEnabled: true,
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
};

interface SettingsState {
  appSettings: AppSettings;
  settingsLoaded: boolean;
  pendingChallengesCount: number;
  activeDownloadsCount: number;

  /** Polling interval IDs (for cleanup) */
  _pollingIds: number[];

  // Actions
  setAppSettings: (settings: AppSettings | ((prev: AppSettings) => AppSettings)) => void;
  setPendingChallengesCount: (count: number) => void;
  setActiveDownloadsCount: (count: number) => void;

  fetchSettings: () => Promise<void>;
  fetchChallengeCount: () => Promise<void>;

  handleSaveSettings: (
    newSettings: AppSettings,
    onUpdateProfileTheme?: (theme: AppTheme) => Promise<void>,
  ) => Promise<void>;

  /** Initialize polling for challenges and downloads counts */
  startPolling: () => void;
  /** Clean up polling intervals */
  stopPolling: () => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  appSettings: DEFAULT_SETTINGS,
  settingsLoaded: false,
  pendingChallengesCount: 0,
  activeDownloadsCount: 0,
  _pollingIds: [],

  setAppSettings: (settings) =>
    set((state) => ({
      appSettings: typeof settings === 'function' ? settings(state.appSettings) : settings,
    })),

  setPendingChallengesCount: (count) => set({ pendingChallengesCount: count }),
  setActiveDownloadsCount: (count) => set({ activeDownloadsCount: count }),

  fetchSettings: async () => {
    try {
      const res = await apiFetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        set({ appSettings: data });
      }
    } catch (err) {
      console.error('[Settings] Fetch settings error:', err);
    } finally {
      set({ settingsLoaded: true });
    }
  },

  fetchChallengeCount: async () => {
    try {
      const res = await apiFetch('/api/challenges');
      if (res.ok) {
        const data = await res.json();
        set({ pendingChallengesCount: data.count || 0 });
      }
    } catch {
      // challenge count is non-critical
    }
  },

  handleSaveSettings: async (newSettings, onUpdateProfileTheme) => {
    set((state) => ({ appSettings: { ...state.appSettings, ...newSettings } }));
    if (newSettings.appTheme && onUpdateProfileTheme) {
      await onUpdateProfileTheme(newSettings.appTheme);
    }
    try {
      await apiFetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSettings),
      });
    } catch (err) {
      console.error('[Settings] Save settings error:', err);
    }
  },

  startPolling: () => {
    const { fetchChallengeCount } = get();

    // Initial fetches
    fetchChallengeCount();
    const fetchDownloadsCount = async () => {
      try {
        const res = await apiFetch('/api/downloads/queue');
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.jobs)) {
            const active = data.jobs.filter(
              (j: any) => j.status === 'downloading' || j.status === 'packaging' || j.status === 'queued'
            ).length;
            set({ activeDownloadsCount: active });
          }
        }
      } catch {
        // ignore
      }
    };
    fetchDownloadsCount();

    const id1 = window.setInterval(fetchChallengeCount, 30_000);
    const id2 = window.setInterval(fetchDownloadsCount, 5_000);
    set({ _pollingIds: [id1, id2] });
  },

  stopPolling: () => {
    const { _pollingIds } = get();
    _pollingIds.forEach((id) => window.clearInterval(id));
    set({ _pollingIds: [] });
  },
}));
