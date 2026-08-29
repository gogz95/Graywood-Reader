import React from 'react';
import { CategoriesView } from '../components/CategoriesView';
import {
  useLibraryStore,
  useAuthStore,
  useModalStore,
  useReaderStore,
  useDisplayMangaList,
} from '../stores';
import { MangaItem } from '../types';

export function CategoriesPage() {
  const { isGuestClient } = useAuthStore();
  const displayMangaList = useDisplayMangaList();
  const { openModal, setModalData } = useModalStore();
  const { openReader } = useReaderStore();

  const handleSelectManga = (manga: MangaItem) => {
    setModalData({ selectedMangaDetail: manga });
  };

  const handleOpenAuthModal = () => {
    setModalData({ authModalMode: 'login' });
    openModal('auth');
  };

  return (
    <CategoriesView
      mangaList={displayMangaList}
      onSelectManga={handleSelectManga}
      onOpenReader={(manga, chNum) => openReader(manga, chNum)}
      isGuest={isGuestClient}
      onOpenAuthModal={handleOpenAuthModal}
    />
  );
}
