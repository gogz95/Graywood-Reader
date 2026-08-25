import { useOutletContext } from 'react-router';
import { LibraryView } from '../components/LibraryView';
import {
  useLibraryStore,
  useAuthStore,
  useModalStore,
  useReaderStore,
  useDisplayMangaList,
} from '../stores';
import { MangaItem } from '../types';

export function LibraryPage() {
  const { searchQuery } = useOutletContext<{
    searchQuery: string;
    setSearchQuery: (q: string) => void;
  }>();

  const { isGuestClient } = useAuthStore();
  const { deleteManga, incrementChapter, bulkUpdateStatus, bulkDelete } = useLibraryStore();
  const displayMangaList = useDisplayMangaList();
  const { openModal, setModalData } = useModalStore();
  const { openReader, setChapterListTarget } = useReaderStore();

  const handleSelectMangaDetail = (manga: MangaItem) => {
    setModalData({ selectedMangaDetail: manga });
  };

  const handleOpenAuthModal = () => {
    setModalData({ authModalMode: 'login' });
    openModal('auth');
  };

  return (
    <LibraryView
      mangaList={displayMangaList}
      searchQuery={searchQuery}
      onIncrementChapter={incrementChapter}
      onSelectManga={handleSelectMangaDetail}
      onQuickEdit={(m) => {
        setModalData({ editingManga: m });
        openModal('addEdit');
      }}
      onDeleteManga={deleteManga}
      onAddNew={() => {
        setModalData({ editingManga: null });
        openModal('addEdit');
      }}
      onOpenReader={(manga, chNum) => openReader(manga, chNum)}
      onOpenChapters={(manga) => setChapterListTarget(manga)}
      onBulkUpdateStatus={bulkUpdateStatus}
      onBulkDelete={bulkDelete}
      isGuest={isGuestClient}
      onOpenAuthModal={handleOpenAuthModal}
    />
  );
}
