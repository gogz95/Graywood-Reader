import { useState, useCallback, useEffect } from 'react';
import { apiFetch } from '../utils/api';
import { AppSettings, AppTheme, ReaderViewMode } from '../types';

// ============================================================================
// useSettingsState — App settings fetching/saving + polling extracted from App.tsx
// Manages: appSettings, settingsLoaded, challenge count, download count.
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

export interface SettingsState {
  appSettings: AppSettings;
  setAppSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  fetchSettings: () => Promise<void>;
  handleSaveSettings: (newSettings: AppSettings, onUpdateProfileTheme?: (theme: AppTheme) => Promise<void>) => Promise<void>;
  settingsLoaded: boolean;

  pendingChallengesCount: number;
  setPendingChallengesCount: React.Dispatch<React.SetStateAction<number>>;
  fetchChallengeCount: () => Promise<void>;

  activeDownloadsCount: number;
  setActiveDownloadsCount: React.Dispatch<React.SetStateAction<number>>;
}

export function useSettingsState(): SettingsState {
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [pendingChallengesCount, setPendingChallengesCount] = useState(0);
  const [activeDownloadsCount, setActiveDownloadsCount] = useState(0);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await apiFetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        setAppSettings(data);
      }
    } catch (err) {
      console.error('[Settings] Fetch settings error:', err);
    } finally {
      setSettingsLoaded(true);
    }
  }, []);

  const fetchChallengeCount = useCallback(async () => {
    try {
      const res = await apiFetch('/api/challenges');
      if (res.ok) {
        const data = await res.json();
        setPendingChallengesCount(data.count || 0);
      }
    } catch {
      // ignore — challenge count is non-critical
    }
  }, []);

  const fetchDownloadsCount = useCallback(async () => {
    try {
      const res = await apiFetch('/api/downloads/queue');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.jobs)) {
          const active = data.jobs.filter(
            (j: any) => j.status === 'downloading' || j.status === 'packaging' || j.status === 'queued'
          ).length;
          setActiveDownloadsCount(active);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  // Start polling on mount
  useEffect(() => {
    fetchSettings();
    fetchChallengeCount();
    fetchDownloadsCount();

    const intervalChallenges = setInterval(fetchChallengeCount, 30_000);
    const intervalDownloads  = setInterval(fetchDownloadsCount,  5_000);

    return () => {
      clearInterval(intervalChallenges);
      clearInterval(intervalDownloads);
    };
  }, [fetchSettings, fetchChallengeCount, fetchDownloadsCount]);

  const handleSaveSettings = useCallback(async (
    newSettings: AppSettings,
    onUpdateProfileTheme?: (theme: AppTheme) => Promise<void>,
  ) => {
    setAppSettings((prev) => ({ ...prev, ...newSettings }));
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
  }, []);

  return {
    appSettings,
    setAppSettings,
    fetchSettings,
    handleSaveSettings,
    settingsLoaded,
    pendingChallengesCount,
    setPendingChallengesCount,
    fetchChallengeCount,
    activeDownloadsCount,
    setActiveDownloadsCount,
  };
}
