import { useState, useCallback, useEffect } from 'react';
import { MangaItem, ChapterData } from '../types';
import { saveOfflineChapter, isChapterOffline } from '../utils/offlineStorage';

interface UseReaderOfflineProps {
  manga: MangaItem;
  currentChapterNum: number;
  chapterData: ChapterData | null;
  triggerToast: (msg: string) => void;
}

export function useReaderOffline({
  manga,
  currentChapterNum,
  chapterData,
  triggerToast,
}: UseReaderOfflineProps) {
  const [isOfflineAvailable, setIsOfflineAvailable] = useState<boolean>(false);
  const [isDownloadingOffline, setIsDownloadingOffline] = useState<boolean>(false);
  const [downloadProgress, setDownloadProgress] = useState<{ loaded: number; total: number } | null>(null);

  // Check if current chapter is cached offline whenever manga or chapter changes
  useEffect(() => {
    let isMounted = true;
    isChapterOffline(manga.id, currentChapterNum)
      .then((available) => {
        if (isMounted) setIsOfflineAvailable(available);
      })
      .catch(() => {
        if (isMounted) setIsOfflineAvailable(false);
      });
    return () => {
      isMounted = false;
    };
  }, [manga.id, currentChapterNum]);

  const handleDownloadChapter = useCallback(async () => {
    if (!chapterData || !chapterData.pages || chapterData.pages.length === 0) return;
    setIsDownloadingOffline(true);
    setDownloadProgress({ loaded: 0, total: chapterData.pages.length });
    try {
      await saveOfflineChapter(
        manga.id,
        manga.title,
        currentChapterNum,
        chapterData.pages,
        (loaded, total) => setDownloadProgress({ loaded, total })
      );
      setIsOfflineAvailable(true);
      triggerToast(`Chapter ${currentChapterNum} downloaded for offline reading!`);
    } catch (err: any) {
      triggerToast(`Offline download failed: ${err?.message || String(err)}`);
    } finally {
      setIsDownloadingOffline(false);
      setDownloadProgress(null);
    }
  }, [chapterData, currentChapterNum, manga.id, manga.title, triggerToast]);

  return {
    isOfflineAvailable,
    setIsOfflineAvailable,
    isDownloadingOffline,
    downloadProgress,
    handleDownloadChapter,
  };
}
