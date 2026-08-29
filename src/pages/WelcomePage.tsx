import React from 'react';
import { WelcomeView } from '../components/WelcomeView';
import {
  useAuthStore,
  useModalStore,
  useReaderStore,
  useDisplayMangaList,
} from '../stores';
import { MangaItem } from '../types';

export function WelcomePage() {
  const { activeProfile, isGuestClient } = useAuthStore();
  const displayMangaList = useDisplayMangaList();
  const { openModal, setModalData } = useModalStore();
  const { openReader } = useReaderStore();

  const handleSelectManga = (manga: MangaItem) => {
    setModalData({ selectedMangaDetail: manga });
  };

  const handleOpenAuthModal = (mode: 'login' | 'register') => {
    setModalData({ authModalMode: mode });
    openModal('auth');
  };

  return (
    <WelcomeView
      currentUser={activeProfile}
      isGuest={isGuestClient}
      onOpenAuthModal={handleOpenAuthModal}
      onSelectManga={handleSelectManga}
      onOpenReader={(manga, chNum) => openReader(manga, chNum)}
      libraryManga={displayMangaList}
    />
  );
}
