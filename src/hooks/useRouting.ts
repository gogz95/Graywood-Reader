import { useState, useEffect, useRef, useCallback } from 'react';
import { AppNavTab, MangaItem } from '../types';

export const TAB_PATHS: Record<string, string> = {
  library: '/',
  browse: '/browse',
  sources: '/sources',
  autoupdate: '/autoupdate',
  duplicates: '/duplicates',
  openapi: '/openapi',
};

export interface UseRoutingOptions {
  mangaList: MangaItem[];
  onOpenSeriesDetail: (manga: MangaItem) => void;
  onOpenReaderFromUrl: (manga: MangaItem, chapterNumber: number) => void;
}

export function useRouting({
  mangaList,
  onOpenSeriesDetail,
  onOpenReaderFromUrl,
}: UseRoutingOptions) {
  const [activeTab, setActiveTab] = useState<AppNavTab>('library');

  const mangaListRef = useRef(mangaList);
  mangaListRef.current = mangaList;

  const onOpenSeriesDetailRef = useRef(onOpenSeriesDetail);
  onOpenSeriesDetailRef.current = onOpenSeriesDetail;

  const onOpenReaderFromUrlRef = useRef(onOpenReaderFromUrl);
  onOpenReaderFromUrlRef.current = onOpenReaderFromUrl;

  const updateUrl = useCallback((path: string) => {
    if (window.location.pathname !== path) {
      window.history.pushState(null, '', path);
    }
  }, []);

  const handleTabChange = useCallback(
    (tab: AppNavTab) => {
      setActiveTab(tab);
      updateUrl(TAB_PATHS[tab] || '/');
    },
    [updateUrl]
  );

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
        const item = mangaListRef.current.find((m) => m.id === id);
        if (item) onOpenSeriesDetailRef.current(item);
      } else if (path.startsWith('/reader/')) {
        const parts = path.split('/reader/')[1]?.split('/');
        const id = parts?.[0];
        const ch = parts?.[1] ? parseInt(parts[1], 10) : 1;
        const item = mangaListRef.current.find((m) => m.id === id);
        if (item) onOpenReaderFromUrlRef.current(item, ch);
      } else {
        setActiveTab('library');
      }
    };

    syncRouteFromUrl();
    window.addEventListener('popstate', syncRouteFromUrl);
    return () => window.removeEventListener('popstate', syncRouteFromUrl);
  }, []);

  return {
    activeTab,
    setActiveTab,
    updateUrl,
    handleTabChange,
  };
}
