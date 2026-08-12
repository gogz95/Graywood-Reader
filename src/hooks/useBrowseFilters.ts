import { useState, useMemo } from 'react';
import { MangaItem, MangaType, ReadingStatus } from '../types';
import { dedupeCatalog, isAdultManga, sortManga, SortBy } from '../utils/catalog';

export interface UseBrowseFiltersOptions {
  mangaList: MangaItem[];
  searchQuery: string;
}

export function useBrowseFilters({ mangaList, searchQuery }: UseBrowseFiltersOptions) {
  // Filter States
  const [localSearch, setLocalSearch] = useState('');
  const [selectedLanguage, setSelectedLanguage] = useState<string>('en');
  const [selectedType, setSelectedType] = useState<MangaType | 'all'>('all');
  const [selectedStatus, setSelectedStatus] = useState<ReadingStatus | 'all'>('all');
  const [selectedGenre, setSelectedGenre] = useState<string>('all');
  const [selectedSourceName, setSelectedSourceName] = useState<string>('all');
  const [contentRating, setContentRating] = useState<'all' | 'hide' | 'only'>('all');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>('rating_desc');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [viewDensity, setViewDensity] = useState<'grid' | 'list'>('grid');

  const ITEMS_PER_PAGE = 50;

  // All unique source providers in the catalog
  const availableSources = useMemo(() => {
    const names = new Set<string>();
    mangaList.forEach((m) => { if (m.sourceName) names.add(m.sourceName); });
    return Array.from(names).sort();
  }, [mangaList]);

  // All unique genres from current manga database
  const availableGenres = useMemo(() => {
    const genresSet = new Set<string>();
    mangaList.forEach((m) => { (m.genres || []).forEach((g) => genresSet.add(g)); });
    return Array.from(genresSet).sort();
  }, [mangaList]);

  // Filtered, Deduplicated & Sorted Manga Collection
  const filteredManga = useMemo(() => {
    const filtered = mangaList.filter((m) => {
      const q = (localSearch || searchQuery).trim().toLowerCase();
      if (q) {
        const matchTitle = m.title.toLowerCase().includes(q);
        const matchAlt = (m.altTitles || []).some((alt) => alt.toLowerCase().includes(q));
        const matchGenre = (m.genres || []).some((g) => g.toLowerCase().includes(q));
        const matchDesc = m.description.toLowerCase().includes(q);
        if (!matchTitle && !matchAlt && !matchGenre && !matchDesc) return false;
      }
      if (selectedLanguage !== 'all') {
        if (selectedLanguage === 'en' && m.type === 'manga' && m.title.includes('[JP]')) return false;
        if (selectedLanguage === 'ko' && m.type !== 'manhwa') return false;
        if (selectedLanguage === 'zh' && m.type !== 'manhua') return false;
        if (selectedLanguage === 'ja' && m.type !== 'manga') return false;
      }
      if (selectedSourceName !== 'all' && m.sourceName !== selectedSourceName) return false;
      if (selectedType !== 'all' && m.type !== selectedType) return false;
      if (selectedStatus !== 'all' && m.status !== selectedStatus) return false;
      if (selectedGenre !== 'all' && !(m.genres || []).includes(selectedGenre)) return false;
      const isAdult = isAdultManga(m);
      if (contentRating === 'hide' && isAdult) return false;
      if (contentRating === 'only' && !isAdult) return false;
      if (favoritesOnly && !m.isFavorite) return false;
      if (unreadOnly && m.currentChapter >= m.latestChapter) return false;
      return true;
    });
    const deduped = dedupeCatalog(filtered);
    return sortManga(deduped, sortBy);
  }, [
    mangaList, localSearch, searchQuery, selectedLanguage, selectedType, selectedStatus,
    selectedGenre, selectedSourceName, contentRating, favoritesOnly, unreadOnly, sortBy,
  ]);

  const totalPages = Math.max(1, Math.ceil(filteredManga.length / ITEMS_PER_PAGE));
  const displayMangaPage = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredManga.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredManga, currentPage]);

  const handleResetFilters = () => {
    setLocalSearch('');
    setSelectedLanguage('en');
    setSelectedType('all');
    setSelectedStatus('all');
    setSelectedGenre('all');
    setSelectedSourceName('all');
    setContentRating('all');
    setFavoritesOnly(false);
    setUnreadOnly(false);
    setSortBy('rating_desc');
    setCurrentPage(1);
  };

  // Wrappers that jump back to page 1 (matching the original reset-page-on-filter behaviour).
  const setSearch = (v: string) => { setLocalSearch(v); setCurrentPage(1); };
  const setLanguage = (v: string) => { setSelectedLanguage(v); setCurrentPage(1); };
  const setRatingFilter = (v: 'all' | 'hide' | 'only') => { setContentRating(v); setCurrentPage(1); };

  return {
    localSearch, setSearch, setLocalSearch,
    selectedLanguage, setLanguage, setSelectedLanguage,
    selectedType, setSelectedType,
    selectedStatus, setSelectedStatus,
    selectedGenre, setSelectedGenre,
    selectedSourceName, setSelectedSourceName,
    contentRating, setRatingFilter, setContentRating,
    favoritesOnly, setFavoritesOnly,
    unreadOnly, setUnreadOnly,
    sortBy, setSortBy,
    currentPage, setCurrentPage,
    viewDensity, setViewDensity,
    availableSources, availableGenres,
    filteredManga, displayMangaPage, totalPages,
    handleResetFilters, ITEMS_PER_PAGE,
  };
}
