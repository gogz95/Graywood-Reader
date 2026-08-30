import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';
import { ReaderView } from '../components/ReaderView';
import {
  useLibraryStore,
  useAuthStore,
  useSettingsStore,
  useReaderStore,
  useModalStore,
} from '../stores';
import { MangaItem } from '../types';
import { apiFetch } from '../utils/api';

export function ReaderPage() {
  const { id, chapter } = useParams<{ id: string; chapter?: string }>();
  const navigate = useNavigate();

  const { mangaList } = useLibraryStore();
  const { isGuestClient } = useAuthStore();
  const { appSettings, handleSaveSettings } = useSettingsStore();
  const { markChapterRead, reportMangaIssue } = useReaderStore();
  const { openModal, setModalData } = useModalStore();

  const mangaInStore = mangaList.find((m) => m.id === id);
  const [fetchedManga, setFetchedManga] = useState<MangaItem | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(!mangaInStore);
  const [error, setError] = useState<string | null>(null);

  const targetManga = mangaInStore || fetchedManga;
  const chapterNumber = chapter ? parseInt(chapter, 10) : 1;

  useEffect(() => {
    if (mangaInStore) {
      setIsLoading(false);
      return;
    }
    if (!id) return;

    let isMounted = true;
    setIsLoading(true);
    setError(null);

    apiFetch(`/api/manga/${encodeURIComponent(id)}`)
      .then(async (res) => {
        if (!res.ok) {
          const errData = await res.json().catch(() => null);
          throw new Error(errData?.message || errData?.error || `Series not found (${res.status})`);
        }
        return res.json();
      })
      .then((data: MangaItem) => {
        if (isMounted) {
          setFetchedManga(data);
          setIsLoading(false);
        }
      })
      .catch((err: any) => {
        if (isMounted) {
          setError(err.message || 'Manga series not found in library.');
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [id, mangaInStore]);

  const handleOpenAuthModal = (mode: 'login' | 'register') => {
    setModalData({ authModalMode: mode });
    openModal('auth');
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <div className="w-8 h-8 border-3 border-accent/20 border-t-accent rounded-full animate-spin" />
        <p className="text-muted text-xs font-medium animate-pulse">Loading reader...</p>
      </div>
    );
  }

  if (!targetManga) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <p className="text-muted text-sm">{error || 'Manga series not found in library.'}</p>
        <button
          onClick={() => navigate('/')}
          className="px-4 py-2 bg-accent text-white rounded-lg text-xs font-semibold hover:bg-accent/90 transition-colors cursor-pointer"
        >
          Return to Library
        </button>
      </div>
    );
  }

  return (
    <ReaderView
      manga={targetManga}
      isGuest={isGuestClient}
      onOpenAuthModal={() => handleOpenAuthModal('login')}
      initialChapterNumber={chapterNumber}
      defaultSettings={appSettings.readerDefaults}
      privateModeEnabled={appSettings.privateModeEnabled}
      onClose={() => navigate('/')}
      onMarkChapterRead={(chNum) => markChapterRead(targetManga.id, chNum)}
      onReport={reportMangaIssue}
      onSaveSettings={(newReaderSettings) =>
        handleSaveSettings({ ...appSettings, readerDefaults: newReaderSettings })
      }
    />
  );
}
