import React, { useState, useMemo } from 'react';
import { MangaItem, MangaType, ReadingStatus, hasWorkingReaderSource } from '../types';
import {
  Compass,
  Filter,
  ArrowUpDown,
  Search,
  Star,
  BookOpen,
  Plus,
  SlidersHorizontal,
  Layers,
  Sparkles,
  Play,
  RotateCcw,
  Check,
  Grid,
  List,
} from 'lucide-react';

// Content rating helpers for 18+ / adult filtering in the Unified Catalog.
const ADULT_GENRES = new Set(['18+', 'adult', 'ecchi', 'hentai', 'smut', 'mature', 'pornhwa', 'yaoi', 'yuri']);
const NSFW_SOURCE_KEYWORDS = ['manhwa18', 'pornwa', 'nsfw'];

function isAdultManga(m: MangaItem): boolean {
  if (m.genres && m.genres.some((g) => ADULT_GENRES.has(String(g).toLowerCase()))) return true;
  const src = `${m.sourceName || ''} ${m.sourceUrl || ''}`.toLowerCase();
  return NSFW_SOURCE_KEYWORDS.some((k) => src.includes(k));
}

// Normalize a title into a stable dedup key (accent-insensitive, alphanumeric only).
function normalizeTitleKey(t: string): string {
  return (t || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

// Pick the best representative entry when the same series appears multiple times.
function pickBestRepresentative(a: MangaItem, b: MangaItem): MangaItem {
  const score = (m: MangaItem) => {
    let s = 0;
    if (m.isFavorite) s += 10000;
    s += (m.availableSources?.length || 0) * 1000;
    if (m.apiId || m.sourceUrl) s += 500;
    s += (m.latestChapter || 0);
    s += (m.rating || 0) * 10;
    return s;
  };
  return score(a) >= score(b) ? a : b;
}

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
  // Helper: Only show "Read Now" for series with accessible chapter sources/readers
  const isReaderAvailable = (manga: MangaItem) => {
    return hasWorkingReaderSource(manga);
  };

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

  // Sorting State
  const [sortBy, setSortBy] = useState<'title_asc' | 'title_desc' | 'rating_desc' | 'latest_chap_desc' | 'updated_desc'>('rating_desc');

  // Page-by-Page Pagination State (50 items per page)
  const ITEMS_PER_PAGE = 50;
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Layout Density State
  const [viewDensity, setViewDensity] = useState<'grid' | 'list'>('grid');


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
    // 1. Apply all active filters
    const filtered = mangaList.filter((m) => {
      // Search query matching (title, alt titles, genres, description)
      const q = (localSearch || searchQuery).trim().toLowerCase();
      if (q) {
        const matchTitle = m.title.toLowerCase().includes(q);
        const matchAlt = (m.altTitles || []).some((alt) => alt.toLowerCase().includes(q));
        const matchGenre = (m.genres || []).some((g) => g.toLowerCase().includes(q));
        const matchDesc = m.description.toLowerCase().includes(q);
        if (!matchTitle && !matchAlt && !matchGenre && !matchDesc) return false;
      }

      // Language Filter
      if (selectedLanguage !== 'all') {
        if (selectedLanguage === 'en' && m.type === 'manga' && m.title.includes('[JP]')) return false;
        if (selectedLanguage === 'ko' && m.type !== 'manhwa') return false;
        if (selectedLanguage === 'zh' && m.type !== 'manhua') return false;
        if (selectedLanguage === 'ja' && m.type !== 'manga') return false;
      }

      // Source filter
      if (selectedSourceName !== 'all' && m.sourceName !== selectedSourceName) return false;

      // Type filter
      if (selectedType !== 'all' && m.type !== selectedType) return false;

      // Reading Status filter
      if (selectedStatus !== 'all' && m.status !== selectedStatus) return false;

      // Genre filter
      if (selectedGenre !== 'all' && !(m.genres || []).includes(selectedGenre)) return false;

      // Content rating (18+/adult) filter
      const isAdult = isAdultManga(m);
      if (contentRating === 'hide' && isAdult) return false;
      if (contentRating === 'only' && !isAdult) return false;

      // Favorites filter
      if (favoritesOnly && !m.isFavorite) return false;



      // Unread filter
      if (unreadOnly && m.currentChapter >= m.latestChapter) return false;

      return true;
    });

    // 2. Deduplicate by normalized title so the same series never appears multiple times
    //    (across different sources OR duplicated within the same source).
    const seen = new Map<string, MangaItem>();
    for (const m of filtered) {
      const key = normalizeTitleKey(m.title);
      if (!key) {
        // Untitled/unparseable: keep with a unique key so it is never dropped.
        seen.set(`__untitled__${m.id}`, m);
        continue;
      }
      const existing = seen.get(key);
      if (!existing) {
        seen.set(key, m);
      } else {
        seen.set(key, pickBestRepresentative(existing, m));
      }
    }

    // 3. Sort the deduplicated set
    return Array.from(seen.values()).sort((a, b) => {
      if (sortBy === 'title_asc') return a.title.localeCompare(b.title);
      if (sortBy === 'title_desc') return b.title.localeCompare(a.title);
      if (sortBy === 'rating_desc') return (b.rating || 0) - (a.rating || 0);
      if (sortBy === 'latest_chap_desc') return b.latestChapter - a.latestChapter;
      if (sortBy === 'updated_desc') {
        return new Date(b.lastUpdated || 0).getTime() - new Date(a.lastUpdated || 0).getTime();
      }
      return 0;
    });
  }, [
    mangaList,
    localSearch,
    searchQuery,
    selectedLanguage,
    selectedType,
    selectedStatus,
    selectedGenre,
    selectedSourceName,
    contentRating,
    favoritesOnly,
    unreadOnly,
    sortBy,
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


  return (
    <div className="space-y-6">
      {/* Header Controls Banner */}
      <div className="bg-surface border border-edge rounded-3xl p-6 shadow-xl space-y-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-edge pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-accent/10 text-accent border border-accent/20 shadow-md">
              <Compass className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-black text-primary flex items-center gap-2">
                Unified Catalog
                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-accent/20 text-accent border border-accent/30">
                  {filteredManga.length} Series
                </span>
              </h2>
              <p className="text-xs text-secondary">Aggregated catalog grouping all series across all active connected Kotatsu sources in one place</p>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            {/* View Mode Toggle */}
            <div className="flex items-center p-1 bg-app rounded-xl border border-edge">
              <button
                onClick={() => setViewDensity('grid')}
                className={`p-1.5 rounded-lg transition-all ${
                  viewDensity === 'grid' ? 'bg-accent text-accent-fg font-bold' : 'text-secondary hover:text-primary'
                }`}
                title="Grid View"
              >
                <Grid className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewDensity('list')}
                className={`p-1.5 rounded-lg transition-all ${
                  viewDensity === 'list' ? 'bg-accent text-accent-fg font-bold' : 'text-secondary hover:text-primary'
                }`}
                title="List Table View"
              >
                <List className="w-4 h-4" />
              </button>
            </div>

            <button
              onClick={handleResetFilters}
              className="px-3 py-2 rounded-xl bg-elevated hover:bg-elevated text-secondary font-bold text-xs flex items-center gap-1.5 border border-edge-strong transition-all"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Filters</span>
            </button>
          </div>
        </div>

        {/* Filter Controls Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {/* Search Bar Input */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
            <input
              type="text"
              placeholder="Search title, genre, author..."
              value={localSearch}
              onChange={(e) => {
                setLocalSearch(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full bg-app border border-edge rounded-xl pl-9 pr-3 py-2 text-xs text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
            />
          </div>

          {/* Language Filter Dropdown */}
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-secondary flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-info" />
              Language Preference:
            </label>
            <select
              value={selectedLanguage}
              onChange={(e: any) => {
                setSelectedLanguage(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full bg-app border border-edge rounded-xl p-2 text-xs text-primary font-semibold focus:outline-none focus:ring-2 focus:ring-info/50"
            >
              <option value="en">🇬🇧 English (Preferred)</option>
              <option value="all">🌐 All Languages</option>
              <option value="ko">🇰🇷 Korean (Raw/Translated)</option>
              <option value="zh">🇨🇳 Chinese (Raw/Translated)</option>
              <option value="ja">🇯🇵 Japanese (Raw/Translated)</option>
              <option value="es">🇪🇸 Spanish</option>
              <option value="fr">🇫🇷 French</option>
            </select>
          </div>

          {/* Sort By Dropdown */}
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-secondary flex items-center gap-1">
              <ArrowUpDown className="w-3 h-3 text-accent" />
              Sort Results By:
            </label>
            <select
              value={sortBy}
              onChange={(e: any) => setSortBy(e.target.value)}
              className="w-full bg-app border border-edge rounded-xl p-2 text-xs text-primary font-semibold focus:outline-none focus:ring-2 focus:ring-accent/50"
            >
              <option value="rating_desc">⭐️ User Rating (Highest First)</option>
              <option value="title_asc">🔤 Title (A - Z)</option>
              <option value="title_desc">🔤 Title (Z - A)</option>
              <option value="latest_chap_desc">🚀 Latest Chapter Count</option>
              <option value="updated_desc">🕒 Recently Updated</option>
            </select>
          </div>

          {/* Type Filter Dropdown */}
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-secondary">Comic Format Type:</label>
            <select
              value={selectedType}
              onChange={(e: any) => setSelectedType(e.target.value)}
              className="w-full bg-app border border-edge rounded-xl p-2 text-xs text-primary font-semibold focus:outline-none focus:ring-2 focus:ring-accent/50"
            >
              <option value="all">All Formats (Manhwa, Manhua, Manga)</option>
              <option value="manhwa">🇰🇷 Korean Manhwa</option>
              <option value="manhua">🇨🇳 Chinese Manhua</option>
              <option value="manga">🇯🇵 Japanese Manga</option>
            </select>
          </div>

          {/* Reading Status Dropdown */}
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-secondary">Reading Status:</label>
            <select
              value={selectedStatus}
              onChange={(e: any) => setSelectedStatus(e.target.value)}
              className="w-full bg-app border border-edge rounded-xl p-2 text-xs text-primary font-semibold focus:outline-none focus:ring-2 focus:ring-accent/50"
            >
              <option value="all">All Statuses</option>
              <option value="reading">📖 Reading</option>
              <option value="completed">✅ Completed</option>
              <option value="plan_to_read">📌 Plan to Read</option>
              <option value="on_hold">⏸️ On Hold</option>
              <option value="dropped">❌ Dropped</option>
            </select>
          </div>

          {/* Content Rating (18+ / Adult) Filter Dropdown */}
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-secondary flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-danger" />
              18+ / Adult:
            </label>
            <select
              value={contentRating}
              onChange={(e: any) => {
                setContentRating(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full bg-app border border-edge rounded-xl p-2 text-xs text-primary font-semibold focus:outline-none focus:ring-2 focus:ring-danger/40"
            >
              <option value="all">All (Safe + 18+)</option>
              <option value="hide">🙈 Hide 18+ Content</option>
              <option value="only">🔞 Show 18+ Only</option>
            </select>
          </div>
        </div>

        {/* Source Provider Filter Pills */}
        {availableSources.length > 1 && (
          <div className="flex flex-wrap items-center gap-2 pb-3 border-b border-edge/60">
            <span className="text-[11px] font-bold text-secondary mr-1 flex items-center gap-1">
              <Layers className="w-3 h-3 text-accent" />
              Source:
            </span>
            <button
              onClick={() => setSelectedSourceName('all')}
              className={`px-3 py-1.5 rounded-xl border font-bold text-xs transition-all ${
                selectedSourceName === 'all'
                  ? 'bg-accent text-accent-fg border-accent shadow-md font-black'
                  : 'bg-app text-secondary border-edge hover:border-edge-strong'
              }`}
            >
              All Sources
            </button>
            {availableSources.map((src) => (
              <button
                key={src}
                onClick={() => setSelectedSourceName(selectedSourceName === src ? 'all' : src)}
                className={`px-3 py-1.5 rounded-xl border font-bold text-xs transition-all ${
                  selectedSourceName === src
                    ? 'bg-accent-2/30 text-accent-2 border-accent-2/50 shadow-md font-black'
                    : 'bg-app text-secondary border-edge hover:border-edge-strong'
                }`}
              >
                {src}
              </button>
            ))}
          </div>
        )}

        {/* Quick Filter Toggle Pills */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-edge/80 text-xs">
          <span className="font-bold text-secondary mr-1 text-[11px]">Quick Filters:</span>

          <button
            onClick={() => setFavoritesOnly(!favoritesOnly)}
            className={`px-3 py-1.5 rounded-xl border font-bold text-xs flex items-center gap-1.5 transition-all ${
              favoritesOnly
                ? 'bg-accent text-accent-fg border-accent shadow-md font-black'
                : 'bg-app text-secondary border-edge hover:border-edge-strong'
            }`}
          >
            <Star className={`w-3.5 h-3.5 ${favoritesOnly ? 'fill-accent-fg' : 'text-accent'}`} />
            <span>Favorites Only</span>
          </button>



          <button
            onClick={() => setUnreadOnly(!unreadOnly)}
            className={`px-3 py-1.5 rounded-xl border font-bold text-xs flex items-center gap-1.5 transition-all ${
              unreadOnly
                ? 'bg-info text-accent-fg border-info shadow-md font-black'
                : 'bg-app text-secondary border-edge hover:border-edge-strong'
            }`}
          >
            <span>🔔 Unread Chapters</span>
          </button>

          {/* Genre Badges Pills */}
          {availableGenres.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto py-1 max-w-full">
              <span className="text-muted">|</span>
              <button
                onClick={() => setSelectedGenre('all')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all ${
                  selectedGenre === 'all'
                    ? 'bg-accent text-accent-fg border-accent font-black shadow-sm'
                    : 'bg-app text-secondary border-edge'
                }`}
              >
                All Genres
              </button>
              {availableGenres.map((genre) => (
                <button
                  key={genre}
                  onClick={() => setSelectedGenre(selectedGenre === genre ? 'all' : genre)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all ${
                    selectedGenre === genre
                      ? 'bg-accent/20 text-accent border-accent/40 font-black'
                      : 'bg-app text-secondary border-edge hover:border-edge-strong'
                  }`}
                >
                  {genre}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Empty State */}
      {filteredManga.length === 0 ? (
        <div className="bg-surface border border-edge rounded-3xl p-12 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-app border border-edge text-muted flex items-center justify-center mx-auto">
            <BookOpen className="w-6 h-6" />
          </div>
          <h3 className="text-base font-extrabold text-primary">No Matching Series Found</h3>
          <p className="text-xs text-secondary max-w-sm mx-auto">
            No series in your catalog match the current filters. Try resetting filters or adding new series!
          </p>
          <button
            onClick={handleResetFilters}
            className="px-4 py-2 rounded-xl bg-accent hover:bg-accent-bright text-accent-fg font-bold text-xs"
          >
            Reset Filters
          </button>
        </div>
      ) : viewDensity === 'grid' ? (
        /* GRID CARDS VIEW */
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-3 sm:gap-4 md:gap-5">
          {displayMangaPage.map((manga) => (
            <div
              key={manga.id}
              className="bg-surface border border-edge hover:border-accent/40 rounded-2xl overflow-hidden shadow-lg flex flex-col justify-between transition-all group"
            >
              <div>
                {/* Cover Image */}
                <div
                  onClick={() => onSelectManga(manga)}
                  className="relative aspect-[3/4] w-full overflow-hidden bg-app cursor-pointer"
                >
                  <img
                    src={manga.coverImage}
                    alt={manga.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent" />

                  {/* Type Badge */}
                  <span
                    className={`absolute top-2 left-2 px-2 py-0.5 rounded-lg text-[10px] font-black uppercase backdrop-blur-md ${
                      manga.type === 'manhwa'
                        ? 'bg-blue-950/90 text-info border border-info/40'
                        : manga.type === 'manhua'
                        ? 'bg-red-950/90 text-danger border border-danger/40'
                        : 'bg-emerald-950/90 text-success border border-success/40'
                    }`}
                  >
                    {manga.type}
                  </span>

                  {/* Rating Badge */}
                  <span className="absolute top-2 right-2 px-2 py-0.5 rounded-lg text-[10px] font-bold bg-app/90 text-accent border border-edge flex items-center gap-1">
                    <Star className="w-3 h-3 fill-accent" />
                    <span>{manga.rating}</span>
                  </span>
                </div>

                {/* Body Details */}
                <div className="p-3.5 space-y-1.5">
                  <h4
                    onClick={() => onSelectManga(manga)}
                    className="text-xs font-bold text-primary truncate cursor-pointer group-hover:text-accent transition-colors"
                  >
                    {manga.title}
                  </h4>

                  <div className="flex items-center justify-between text-[11px] text-secondary">
                    <span>Ch. {manga.currentChapter} / {manga.latestChapter}</span>
                    <span className="text-accent/90 font-mono font-semibold text-[10px] truncate max-w-[120px]" title={manga.availableSources?.map(s => s.sourceName).join(' • ') || manga.sourceName}>
                      {manga.availableSources && manga.availableSources.length > 1
                        ? `${manga.availableSources.length} Sources`
                        : manga.sourceName || 'Kotatsu Source'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Bottom Quick Read / View Info Action */}
              <div className="p-3 pt-0 flex items-center gap-1.5">
                {isReaderAvailable(manga) ? (
                  <button
                    onClick={() => onOpenReader(manga)}
                    className="flex-1 py-2 rounded-xl bg-gradient-to-r from-accent to-accent-2 hover:from-accent-bright hover:to-accent-2 text-accent-fg font-black text-xs flex items-center justify-center gap-1 shadow-md transition-all"
                  >
                    <Play className="w-3 h-3 fill-accent-fg" />
                    <span>Read</span>
                  </button>
                ) : (
                  <button
                    onClick={() => onSelectManga(manga)}
                    className="flex-1 py-2 rounded-xl bg-elevated hover:bg-elevated text-primary font-bold text-xs flex items-center justify-center gap-1 border border-edge-strong transition-all"
                  >
                    <BookOpen className="w-3 h-3 text-accent" />
                    <span>View Info</span>
                  </button>
                )}

                <button
                  onClick={() => onOpenChapters(manga)}
                  className="p-2 rounded-xl bg-elevated hover:bg-elevated text-secondary text-xs font-bold border border-edge-strong"
                  title="View Chapters List"
                >
                  <BookOpen className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* TABLE LIST VIEW */
        <div className="bg-surface border border-edge rounded-3xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-app border-b border-edge text-secondary font-bold uppercase text-[10px]">
                  <th className="py-3 px-4">Series Title</th>
                  <th className="py-3 px-3">Format</th>
                  <th className="py-3 px-3">Read Progress</th>
                  <th className="py-3 px-3">Rating</th>
                  <th className="py-3 px-3">Source Provider</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge/60">
                {displayMangaPage.map((manga) => (
                  <tr key={manga.id} className="hover:bg-elevated/40 transition-colors">
                    <td className="py-3 px-4 flex items-center gap-3">
                      <img
                        src={manga.coverImage}
                        alt={manga.title}
                        className="w-10 h-12 object-cover rounded-lg bg-app border border-edge"
                      />
                      <div className="min-w-0">
                        <div
                          onClick={() => onSelectManga(manga)}
                          className="font-bold text-primary hover:text-accent cursor-pointer text-xs truncate"
                        >
                          {manga.title}
                        </div>
                        <div className="text-[10px] text-muted truncate">
                          {(manga.genres || []).slice(0, 3).join(', ')}
                        </div>
                      </div>
                    </td>

                    <td className="py-3 px-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-elevated text-secondary">
                        {manga.type}
                      </span>
                    </td>

                    <td className="py-3 px-3 font-mono font-semibold text-secondary">
                      Ch. {manga.currentChapter} / {manga.latestChapter}
                    </td>

                    <td className="py-3 px-3 font-bold text-accent flex items-center gap-1">
                      <Star className="w-3 h-3 fill-accent" />
                      <span>{manga.rating}</span>
                    </td>

                    <td className="py-3 px-3 text-secondary font-mono text-[11px]">
                      {manga.sourceName}
                    </td>

                    <td className="py-3 px-4 text-right space-x-2">
                      {isReaderAvailable(manga) ? (
                        <button
                          onClick={() => onOpenReader(manga)}
                          className="px-3 py-1.5 rounded-lg bg-accent text-accent-fg font-black text-xs"
                        >
                          Read
                        </button>
                      ) : (
                        <button
                          onClick={() => onSelectManga(manga)}
                          className="px-3 py-1.5 rounded-lg bg-elevated text-secondary font-bold text-xs border border-edge-strong"
                        >
                          View Info
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* PAGE-BY-PAGE PAGINATION CONTROLS (50 items per page) */}
      {totalPages > 1 && (
        <div className="sticky bottom-4 z-20 flex flex-col sm:flex-row items-center justify-between gap-3 p-4 bg-surface/95 backdrop-blur-md border border-edge rounded-2xl shadow-2xl">
          <div className="text-xs font-mono text-secondary">
            Showing Page <span className="font-bold text-accent">{currentPage}</span> of{' '}
            <span className="font-bold text-primary">{totalPages}</span> ({filteredManga.length} series)
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setCurrentPage((p) => Math.max(1, p - 1));
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              disabled={currentPage <= 1}
              className="px-4 py-2 rounded-xl bg-elevated hover:bg-elevated disabled:opacity-40 font-bold text-xs text-primary border border-edge-strong transition-all active:scale-95"
            >
              Previous Page
            </button>

            <span className="px-3 py-2 rounded-xl bg-accent/10 text-accent border border-accent/20 font-mono font-bold text-xs">
              Page {currentPage} / {totalPages}
            </span>

            <button
              onClick={() => {
                setCurrentPage((p) => Math.min(totalPages, p + 1));
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
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

