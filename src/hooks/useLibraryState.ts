import { useState, useCallback, useEffect } from 'react';
import { apiFetch } from '../utils/api';
import { MangaItem, AutoUpdateLog, DatabaseSyncConfig, DuplicateCandidate } from '../types';

// ============================================================================
// useLibraryState — Library data fetching & mutation logic extracted from App.tsx
// Manages: mangaList, logs, duplicates, config, update/duplicate operations.
// ============================================================================

export interface LibraryState {
  mangaList: MangaItem[];
  setMangaList: React.Dispatch<React.SetStateAction<MangaItem[]>>;
  fetchMangaList: () => Promise<void>;

  logs: AutoUpdateLog[];
  setLogs: React.Dispatch<React.SetStateAction<AutoUpdateLog[]>>;
  fetchLogs: () => Promise<void>;

  duplicates: DuplicateCandidate[];
  setDuplicates: React.Dispatch<React.SetStateAction<DuplicateCandidate[]>>;

  config: DatabaseSyncConfig;
  setConfig: React.Dispatch<React.SetStateAction<DatabaseSyncConfig>>;
  fetchConfig: () => Promise<void>;

  isUpdating: boolean;
  setIsUpdating: React.Dispatch<React.SetStateAction<boolean>>;

  isScanningDuplicates: boolean;

  scanDuplicates: () => Promise<void>;
}

const DEFAULT_CONFIG: DatabaseSyncConfig = {
  subdomain: 'tracker.manhuahub.app',
  autoUpdateIntervalMinutes: 60,
  enableWebCrawling: true,
  sources: ['MangaDex API', 'AniList GraphQL', 'AsuraScans Feeds', 'FlameComics', 'WeebCentral', 'DemonicScans'],
  lastSyncTime: new Date().toISOString(),
  totalTracked: 0,
};

export function useLibraryState(): LibraryState {
  const [mangaList, setMangaList] = useState<MangaItem[]>([]);
  const [logs, setLogs] = useState<AutoUpdateLog[]>([]);
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[]>([]);
  const [config, setConfig] = useState<DatabaseSyncConfig>(DEFAULT_CONFIG);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isScanningDuplicates, setIsScanningDuplicates] = useState(false);

  const fetchMangaList = useCallback(async () => {
    try {
      const res = await apiFetch('/api/manga');
      if (res.ok) {
        const data = await res.json();
        setMangaList(data);
      }
    } catch (err) {
      console.error('[Library] Fetch manga list error:', err);
    }
  }, []);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await apiFetch('/api/tracker/logs');
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
      }
    } catch (err) {
      console.error('[Library] Fetch logs error:', err);
    }
  }, []);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await apiFetch('/api/config');
      if (res.ok) {
        const data = await res.json();
        setConfig(data);
      }
    } catch (err) {
      console.error('[Library] Fetch config error:', err);
    }
  }, []);

  const scanDuplicates = useCallback(async () => {
    setIsScanningDuplicates(true);
    try {
      const res = await apiFetch('/api/tracker/detect-duplicates', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setDuplicates(data);
      }
    } catch (err) {
      console.error('[Library] Scan duplicates error:', err);
    } finally {
      setIsScanningDuplicates(false);
    }
  }, []);

  return {
    mangaList,
    setMangaList,
    fetchMangaList,
    logs,
    setLogs,
    fetchLogs,
    duplicates,
    setDuplicates,
    config,
    setConfig,
    fetchConfig,
    isUpdating,
    setIsUpdating,
    isScanningDuplicates,
    scanDuplicates,
  };
}
