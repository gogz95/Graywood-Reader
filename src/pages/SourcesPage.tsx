import { KotatsuSourcesView } from '../components/KotatsuSourcesView';
import {
  useLibraryStore,
  useAuthStore,
  useModalStore,
  useReaderStore,
} from '../stores';
import { MangaItem } from '../types';

export function SourcesPage() {
  const { isGuestClient } = useAuthStore();
  const { addFromOpenApi } = useLibraryStore();
  const { openModal, setModalData } = useModalStore();
  const { openReader } = useReaderStore();

  const handleSelectMangaDetail = (manga: MangaItem) => {
    setModalData({ selectedMangaDetail: manga });
  };

  const handleOpenAuthModal = () => {
    setModalData({ authModalMode: 'login' });
    openModal('auth');
  };

  return (
    <KotatsuSourcesView
      isGuest={isGuestClient}
      onOpenAuthModal={handleOpenAuthModal}
      onAddToTracker={addFromOpenApi}
      onOpenReader={(manga, chNum) => openReader(manga, chNum)}
      onSelectManga={handleSelectMangaDetail}
    />
  );
}
