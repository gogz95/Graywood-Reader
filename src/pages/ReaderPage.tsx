import { useParams, useNavigate } from 'react-router';
import { ReaderView } from '../components/ReaderView';
import {
  useLibraryStore,
  useAuthStore,
  useSettingsStore,
  useReaderStore,
  useModalStore,
} from '../stores';

export function ReaderPage() {
  const { id, chapter } = useParams<{ id: string; chapter?: string }>();
  const navigate = useNavigate();

  const { mangaList } = useLibraryStore();
  const { isGuestClient } = useAuthStore();
  const { appSettings, handleSaveSettings } = useSettingsStore();
  const { markChapterRead, reportMangaIssue } = useReaderStore();
  const { openModal, setModalData } = useModalStore();

  const targetManga = mangaList.find((m) => m.id === id);
  const chapterNumber = chapter ? parseInt(chapter, 10) : 1;

  const handleOpenAuthModal = (mode: 'login' | 'register') => {
    setModalData({ authModalMode: mode });
    openModal('auth');
  };

  if (!targetManga) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <p className="text-muted text-sm">Manga series not found in library.</p>
        <button
          onClick={() => navigate('/')}
          className="px-4 py-2 bg-accent text-white rounded-lg text-xs font-semibold hover:bg-accent/90 transition-colors"
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
