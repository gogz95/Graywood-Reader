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

  const [selectedType, setSelectedType] = useState<MangaType | 'all'>('all');
  const [selectedStatus, setSelectedStatus] = useState<ReadingStatus | 'all'>('all');
  const [selectedGenre, setSelectedGenre] = useState<string>('all');
  const [selectedSourceName, setSelectedSourceName] = useState<string>('all');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [autoUpdateOnly, setAutoUpdateOnly] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);

  // Sorting State
  const [sortBy, setSortBy] = useState<'title_asc' | 'title_desc' | 'rating_desc' | 'latest_chap_desc' | 'updated_desc'>('rating_desc');

  // Pagination State (Show 8 items initially, load 8 more on click)
  const [visibleCount, setVisibleCount] = useState<number>(8);

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

  // Filtered & Sorted Manga Collection
  const filteredManga = useMemo(() => {
    return mangaList
      .filter((m) => {
        // Search query matching (title, alt titles, genres, description)
        const q = (localSearch || searchQuery).trim().toLowerCase();
        if (q) {
          const matchTitle = m.title.toLowerCase().includes(q);
          const matchAlt = (m.altTitles || []).some((alt) => alt.toLowerCase().includes(q));
          const matchGenre = (m.genres || []).some((g) => g.toLowerCase().includes(q));
          const matchDesc = m.description.toLowerCase().includes(q);
          if (!matchTitle && !matchAlt && !matchGenre && !matchDesc) return false;
        }

        // Source filter
        if (selectedSourceName !== 'all' && m.sourceName !== selectedSourceName) return false;

        // Type filter
        if (selectedType !== 'all' && m.type !== selectedType) return false;

        // Reading Status filter
        if (selectedStatus !== 'all' && m.status !== selectedStatus) return false;

        // Genre filter
        if (selectedGenre !== 'all' && !(m.genres || []).includes(selectedGenre)) return false;

        // Favorites filter
        if (favoritesOnly && !m.isFavorite) return false;

        // Auto-update filter
        if (autoUpdateOnly && !m.autoUpdateEnabled) return false;

        // Unread filter
        if (unreadOnly && m.currentChapter >= m.latestChapter) return false;

        return true;
      })
      .sort((a, b) => {
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
    selectedType,
    selectedStatus,
    selectedGenre,
    selectedSourceName,
    favoritesOnly,
    autoUpdateOnly,
    unreadOnly,
    sortBy,
  ]);

  // Sliced Visible Collection for Pagination
  const visibleManga = useMemo(() => {
    return filteredManga.slice(0, visibleCount);
  }, [filteredManga, visibleCount]);

  const handleResetFilters = () => {
    setLocalSearch('');
    setSelectedType('all');
    setSelectedStatus('all');
    setSelectedGenre('all');
    setSelectedSourceName('all');
    setFavoritesOnly(false);
    setAutoUpdateOnly(false);
    setUnreadOnly(false);
    setSortBy('rating_desc');
    setVisibleCount(8);
  };


  return (
    <div className="space-y-6">
      {/* Header Controls Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-amber-500/10 text-amber-400 border border-amber-500/20 shadow-md">
              <Compass className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-100 flex items-center gap-2">
                Browse & Explore Catalog
                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  {filteredManga.length} Series
                </span>
              </h2>
              <p className="text-xs text-slate-400">Showing series from active sources: AquaManga · Asura Scans · Flame Comics · Manhwa18</p>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            {/* View Mode Toggle */}
            <div className="flex items-center p-1 bg-slate-950 rounded-xl border border-slate-800">
              <button
                onClick={() => setViewDensity('grid')}
                className={`p-1.5 rounded-lg transition-all ${
                  viewDensity === 'grid' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Grid View"
              >
                <Grid className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewDensity('list')}
                className={`p-1.5 rounded-lg transition-all ${
                  viewDensity === 'list' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
                title="List Table View"
              >
                <List className="w-4 h-4" />
              </button>
            </div>

            <button
              onClick={handleResetFilters}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs flex items-center gap-1.5 border border-slate-700 transition-all"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Filters</span>
            </button>
          </div>
        </div>

        {/* Filter Controls Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {/* Search Bar Input */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search title, genre, author..."
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2.5 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
            />
          </div>

          {/* Sort By Dropdown */}
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-slate-400 flex items-center gap-1">
              <ArrowUpDown className="w-3 h-3 text-amber-400" />
              Sort Results By:
            </label>
            <select
              value={sortBy}
              onChange={(e: any) => setSortBy(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs text-slate-200 font-semibold focus:outline-none focus:ring-2 focus:ring-amber-500/50"
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
            <label className="text-[11px] font-bold text-slate-400">Comic Format Type:</label>
            <select
              value={selectedType}
              onChange={(e: any) => setSelectedType(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs text-slate-200 font-semibold focus:outline-none focus:ring-2 focus:ring-amber-500/50"
            >
              <option value="all">All Formats (Manhwa, Manhua, Manga)</option>
              <option value="manhwa">🇰🇷 Korean Manhwa</option>
              <option value="manhua">🇨🇳 Chinese Manhua</option>
              <option value="manga">🇯🇵 Japanese Manga</option>
            </select>
          </div>

          {/* Reading Status Dropdown */}
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-slate-400">Reading Status:</label>
            <select
              value={selectedStatus}
              onChange={(e: any) => setSelectedStatus(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs text-slate-200 font-semibold focus:outline-none focus:ring-2 focus:ring-amber-500/50"
            >
              <option value="all">All Statuses</option>
              <option value="reading">📖 Reading</option>
              <option value="completed">✅ Completed</option>
              <option value="plan_to_read">📌 Plan to Read</option>
              <option value="on_hold">⏸️ On Hold</option>
              <option value="dropped">❌ Dropped</option>
            </select>
          </div>
        </div>

        {/* Source Provider Filter Pills */}
        {availableSources.length > 1 && (
          <div className="flex flex-wrap items-center gap-2 pb-3 border-b border-slate-800/60">
            <span className="text-[11px] font-bold text-slate-400 mr-1 flex items-center gap-1">
              <Layers className="w-3 h-3 text-amber-400" />
              Source:
            </span>
            <button
              onClick={() => setSelectedSourceName('all')}
              className={`px-3 py-1.5 rounded-xl border font-bold text-xs transition-all ${
                selectedSourceName === 'all'
                  ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-md font-black'
                  : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
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
                    ? 'bg-purple-500/30 text-purple-200 border-purple-500/50 shadow-md font-black'
                    : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
                }`}
              >
                {src}
              </button>
            ))}
          </div>
        )}

        {/* Quick Filter Toggle Pills */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800/80 text-xs">
          <span className="font-bold text-slate-400 mr-1 text-[11px]">Quick Filters:</span>

          <button
            onClick={() => setFavoritesOnly(!favoritesOnly)}
            className={`px-3 py-1.5 rounded-xl border font-bold text-xs flex items-center gap-1.5 transition-all ${
              favoritesOnly
                ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-md font-black'
                : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
            }`}
          >
            <Star className={`w-3.5 h-3.5 ${favoritesOnly ? 'fill-slate-950' : 'text-amber-400'}`} />
            <span>Favorites Only</span>
          </button>

          <button
            onClick={() => setAutoUpdateOnly(!autoUpdateOnly)}
            className={`px-3 py-1.5 rounded-xl border font-bold text-xs flex items-center gap-1.5 transition-all ${
              autoUpdateOnly
                ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow-md font-black'
                : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
            }`}
          >
            <span>🔄 Auto-Update Enabled</span>
          </button>

          <button
            onClick={() => setUnreadOnly(!unreadOnly)}
            className={`px-3 py-1.5 rounded-xl border font-bold text-xs flex items-center gap-1.5 transition-all ${
              unreadOnly
                ? 'bg-cyan-500 text-slate-950 border-cyan-400 shadow-md font-black'
                : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
            }`}
          >
            <span>🔔 Unread Chapters</span>
          </button>

          {/* Genre Badges Pills */}
          {availableGenres.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto py-1 max-w-full">
              <span className="text-slate-500">|</span>
              <button
                onClick={() => setSelectedGenre('all')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all ${
                  selectedGenre === 'all'
                    ? 'bg-slate-200 text-slate-950 border-slate-100 font-black'
                    : 'bg-slate-950 text-slate-400 border-slate-800'
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
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 font-black'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
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
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-12 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-slate-950 border border-slate-800 text-slate-500 flex items-center justify-center mx-auto">
            <BookOpen className="w-6 h-6" />
          </div>
          <h3 className="text-base font-extrabold text-slate-200">No Matching Series Found</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            No series in your catalog match the current filters. Try resetting filters or adding new series!
          </p>
          <button
            onClick={handleResetFilters}
            className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs"
          >
            Reset Filters
          </button>
        </div>
      ) : viewDensity === 'grid' ? (
        /* GRID CARDS VIEW */
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {visibleManga.map((manga) => (
            <div
              key={manga.id}
              className="bg-slate-900 border border-slate-800 hover:border-amber-500/40 rounded-2xl overflow-hidden shadow-lg flex flex-col justify-between transition-all group"
            >
              <div>
                {/* Cover Image */}
                <div
                  onClick={() => onSelectManga(manga)}
                  className="relative aspect-[3/4] w-full overflow-hidden bg-slate-950 cursor-pointer"
                >
                  <img
                    src={manga.coverImage}
                    alt={manga.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent" />

                  {/* Type Badge */}
                  <span
                    className={`absolute top-2 left-2 px-2 py-0.5 rounded-lg text-[10px] font-black uppercase backdrop-blur-md ${
                      manga.type === 'manhwa'
                        ? 'bg-blue-950/90 text-blue-300 border border-blue-500/40'
                        : manga.type === 'manhua'
                        ? 'bg-red-950/90 text-red-300 border border-red-500/40'
                        : 'bg-emerald-950/90 text-emerald-300 border border-emerald-500/40'
                    }`}
                  >
                    {manga.type}
                  </span>

                  {/* Rating Badge */}
                  <span className="absolute top-2 right-2 px-2 py-0.5 rounded-lg text-[10px] font-bold bg-slate-950/90 text-amber-400 border border-slate-800 flex items-center gap-1">
                    <Star className="w-3 h-3 fill-amber-400" />
                    <span>{manga.rating}</span>
                  </span>
                </div>

                {/* Body Details */}
                <div className="p-3.5 space-y-1.5">
                  <h4
                    onClick={() => onSelectManga(manga)}
                    className="text-xs font-bold text-slate-100 truncate cursor-pointer group-hover:text-amber-400 transition-colors"
                  >
                    {manga.title}
                  </h4>

                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>Ch. {manga.currentChapter} / {manga.latestChapter}</span>
                    <span className="text-amber-400/90 font-mono font-semibold text-[10px] truncate max-w-[120px]" title={manga.availableSources?.map(s => s.sourceName).join(' • ') || manga.sourceName}>
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
                    className="flex-1 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black text-xs flex items-center justify-center gap-1 shadow-md transition-all"
                  >
                    <Play className="w-3 h-3 fill-slate-950" />
                    <span>Read</span>
                  </button>
                ) : (
                  <button
                    onClick={() => onSelectManga(manga)}
                    className="flex-1 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs flex items-center justify-center gap-1 border border-slate-700 transition-all"
                  >
                    <BookOpen className="w-3 h-3 text-amber-400" />
                    <span>View Info</span>
                  </button>
                )}

                <button
                  onClick={() => onOpenChapters(manga)}
                  className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold border border-slate-700"
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
        <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-950 border-b border-slate-800 text-slate-400 font-bold uppercase text-[10px]">
                  <th className="py-3 px-4">Series Title</th>
                  <th className="py-3 px-3">Format</th>
                  <th className="py-3 px-3">Read Progress</th>
                  <th className="py-3 px-3">Rating</th>
                  <th className="py-3 px-3">Source Provider</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {visibleManga.map((manga) => (
                  <tr key={manga.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-3 px-4 flex items-center gap-3">
                      <img
                        src={manga.coverImage}
                        alt={manga.title}
                        className="w-10 h-12 object-cover rounded-lg bg-slate-950 border border-slate-800"
                      />
                      <div className="min-w-0">
                        <div
                          onClick={() => onSelectManga(manga)}
                          className="font-bold text-slate-100 hover:text-amber-400 cursor-pointer text-xs truncate"
                        >
                          {manga.title}
                        </div>
                        <div className="text-[10px] text-slate-500 truncate">
                          {(manga.genres || []).slice(0, 3).join(', ')}
                        </div>
                      </div>
                    </td>

                    <td className="py-3 px-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-800 text-slate-300">
                        {manga.type}
                      </span>
                    </td>

                    <td className="py-3 px-3 font-mono font-semibold text-slate-300">
                      Ch. {manga.currentChapter} / {manga.latestChapter}
                    </td>

                    <td className="py-3 px-3 font-bold text-amber-400 flex items-center gap-1">
                      <Star className="w-3 h-3 fill-amber-400" />
                      <span>{manga.rating}</span>
                    </td>

                    <td className="py-3 px-3 text-slate-400 font-mono text-[11px]">
                      {manga.sourceName}
                    </td>

                    <td className="py-3 px-4 text-right space-x-2">
                      {isReaderAvailable(manga) ? (
                        <button
                          onClick={() => onOpenReader(manga)}
                          className="px-3 py-1.5 rounded-lg bg-amber-500 text-slate-950 font-black text-xs"
                        >
                          Read
                        </button>
                      ) : (
                        <button
                          onClick={() => onSelectManga(manga)}
                          className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 font-bold text-xs border border-slate-700"
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


      {/* LOAD MORE SERIES BUTTON */}
      {visibleCount < filteredManga.length && (
        <div className="pt-6 text-center space-y-2">
          <button
            onClick={() => setVisibleCount((prev) => prev + 8)}
            className="px-6 py-3.5 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black text-xs flex items-center justify-center gap-2 mx-auto shadow-xl shadow-amber-500/20 transition-all hover:scale-105 active:scale-95"
          >
            <span>Load More Series</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-slate-950/20 text-slate-950 font-mono font-bold">
              +{Math.min(8, filteredManga.length - visibleCount)}
            </span>
          </button>

          <p className="text-[11px] font-semibold text-slate-400 font-mono">
            Showing {visibleManga.length} of {filteredManga.length} total series
          </p>
        </div>
      )}
    </div>
  );
};

