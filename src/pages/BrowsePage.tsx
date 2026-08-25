import { useOutletContext } from 'react-router';
import { BrowseView } from '../components/BrowseView';
import {
  useLibraryStore,
  useAuthStore,
  useModalStore,
  useReaderStore,
  useDisplayMangaList,
} from '../stores';
import { MangaItem } from '../types';

export function BrowsePage() {
  const { searchQuery } = useOutletContext<{
    searchQuery: string;
    setSearchQuery: (q: string) => void;
  }>();

  const { isGuestClient } = useAuthStore();
  const { addFromOpenApi } = useLibraryStore();
  const displayMangaList = useDisplayMangaList();
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
    <BrowseView
      mangaList={displayMangaList}
      searchQuery={searchQuery}
      isGuest={isGuestClient}
      onOpenAuthModal={handleOpenAuthModal}
      onTrack={addFromOpenApi}
      onOpenReader={(manga, chNum) => openReader(manga, chNum)}
      onSelectManga={handleSelectMangaDetail}
    />
  );
}
