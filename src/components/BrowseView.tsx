import React, { useState } from 'react';
import { MangaItem } from '../types';
import { useBrowseFilters } from '../hooks/useBrowseFilters';
import { isReaderAvailable } from '../utils/catalog';
import { BrowseFilterBar } from './BrowseFilterBar';
import { BrowseGridView } from './BrowseGridView';
import { BrowseTableView } from './BrowseTableView';
import { BrowseEmptyState } from './BrowseEmptyState';
import { RecommendationsRow } from './RecommendationsRow';

interface BrowseViewProps {
  mangaList: MangaItem[];
  searchQuery: string;
  onIncrementChapter: (id: string) => void;
  onSelectManga: (manga: MangaItem) => void;
  onQuickEdit: (manga: MangaItem) => void;
  onDeleteManga: (id: string) => void;
  onAddNew: () => void;
  onOpenReader: (manga: MangaItem, chapterNumber?: number) => void;
  onOpenChapters: (manga: MangaItem) => void;
  onToggleFavorite?: (manga: MangaItem) => void;
}

export const BrowseView: React.FC<BrowseViewProps> = ({
  mangaList,
  searchQuery,
  onIncrementChapter,
  onSelectManga,
  onQuickEdit,
  onDeleteManga,
  onAddNew,
  onOpenReader,
  onOpenChapters,
  onToggleFavorite,
}) => {
  const {
    localSearch, setSearch,
    selectedLanguage, setLanguage,
    selectedType, setSelectedType,
    selectedStatus, setSelectedStatus,
    selectedGenre, setSelectedGenre,
    selectedSourceName, setSelectedSourceName,
    contentRating, setRatingFilter,
    favoritesOnly, setFavoritesOnly,
    unreadOnly, setUnreadOnly,
    sortBy, setSortBy,
    currentPage, setCurrentPage,
    viewDensity, setViewDensity,
    availableSources, availableGenres,
    filteredManga, displayMangaPage, totalPages,
    handleResetFilters,
  } = useBrowseFilters({ mangaList, searchQuery });

  // Surprise Me: pick a random series from the currently-filtered catalog.
  const [isRandomPicking, setIsRandomPicking] = useState(false);
  const handleRandom = () => {
    if (filteredManga.length === 0) return;
    const pick = filteredManga[Math.floor(Math.random() * filteredManga.length)];
    setIsRandomPicking(true);
    setTimeout(() => setIsRandomPicking(false), 600);
    if (isReaderAvailable(pick)) {
      onOpenReader(pick);
    } else {
      onSelectManga(pick);
    }
  };

  const goPage = (p: number) => {
    setCurrentPage(p);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="space-y-6">
      <BrowseFilterBar
        filteredMangaCount={filteredManga.length}
        localSearch={localSearch}
        onSearchChange={setSearch}
        selectedLanguage={selectedLanguage}
        onLanguageChange={setLanguage}
        sortBy={sortBy}
        onSortChange={setSortBy}
        selectedType={selectedType}
        onTypeChange={setSelectedType}
        selectedStatus={selectedStatus}
        onStatusChange={setSelectedStatus}
        selectedGenre={selectedGenre}
        onGenreToggle={setSelectedGenre}
        selectedSourceName={selectedSourceName}
        onSourceToggle={setSelectedSourceName}
        contentRating={contentRating}
        onContentRatingChange={setRatingFilter}
        favoritesOnly={favoritesOnly}
        onToggleFavorites={() => setFavoritesOnly(!favoritesOnly)}
        unreadOnly={unreadOnly}
        onToggleUnread={() => setUnreadOnly(!unreadOnly)}
        availableSources={availableSources}
        availableGenres={availableGenres}
        viewDensity={viewDensity}
        onViewDensityChange={setViewDensity}
        onReset={handleResetFilters}
        onRandom={handleRandom}
        isRandomPicking={isRandomPicking}
      />

      <RecommendationsRow
        mangaList={filteredManga}
        onSelectManga={onSelectManga}
        onOpenReader={onOpenReader}
      />

      {filteredManga.length === 0 ? (
        <BrowseEmptyState onReset={handleResetFilters} />
      ) : viewDensity === 'grid' ? (
        <BrowseGridView
          manga={displayMangaPage}
          onSelectManga={onSelectManga}
          onOpenReader={onOpenReader}
          onOpenChapters={onOpenChapters}
        />
      ) : (
        <BrowseTableView
          manga={displayMangaPage}
          onSelectManga={onSelectManga}
          onOpenReader={onOpenReader}
        />
      )}

      {totalPages > 1 && (
        <div className="sticky bottom-4 z-20 flex flex-col sm:flex-row items-center justify-between gap-3 p-4 bg-surface/95 backdrop-blur-md border border-edge rounded-2xl shadow-2xl">
          <div className="text-xs font-mono text-secondary">
            Showing Page <span className="font-bold text-accent">{currentPage}</span> of{' '}
            <span className="font-bold text-primary">{totalPages}</span> ({filteredManga.length} series)
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => goPage(Math.max(1, currentPage - 1))}
              disabled={currentPage <= 1}
              className="px-4 py-2 rounded-xl bg-elevated hover:bg-elevated disabled:opacity-40 font-bold text-xs text-primary border border-edge-strong transition-all active:scale-95"
            >
              Previous Page
            </button>
            <span className="px-3 py-2 rounded-xl bg-accent/10 text-accent border border-accent/20 font-mono font-bold text-xs">
              Page {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => goPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage >= totalPages}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-accent to-accent-2 hover:from-accent-bright hover:to-accent-2 disabled:opacity-40 font-black text-xs text-accent-fg shadow-md transition-all active:scale-95"
            >
              Next Page
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
