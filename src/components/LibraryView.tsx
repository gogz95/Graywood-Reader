import React, { useState } from 'react';
import { RecommendationsView } from './RecommendationsView';
import {
  MangaItem,
  ReadingStatus,
  MangaType,
  hasWorkingReaderSource,
} from '../types';

import {
  Plus,
  BookOpen,
  CheckCircle,
  Clock,
  PauseCircle,
  XCircle,
  Star,
  Flame,
  ArrowUpDown,
  ExternalLink,
  Zap,
  Edit2,
  Trash2,
  Sparkles,
  Layers,
  AlertTriangle,
  Flag,
} from 'lucide-react';

interface LibraryViewProps {
  mangaList: MangaItem[];
  searchQuery: string;
  onIncrementChapter: (id: string) => void;
  onSelectManga: (manga: MangaItem) => void;
  onQuickEdit: (manga: MangaItem) => void;
  onDeleteManga: (id: string) => void;
  onAddNew: () => void;
  onOpenReader: (manga: MangaItem, chapterNumber?: number) => void;
  onOpenChapters: (manga: MangaItem) => void;
}

export const LibraryView: React.FC<LibraryViewProps> = ({
  mangaList,
  searchQuery,
  onIncrementChapter,
  onSelectManga,
  onQuickEdit,
  onDeleteManga,
  onAddNew,
  onOpenReader,
  onOpenChapters,
}) => {
  const [statusFilter, setStatusFilter] = useState<ReadingStatus | 'all' | 'favorites' | 'flagged'>('all');
  const [typeFilter, setTypeFilter] = useState<MangaType | 'all'>('all');
  const [sortBy, setSortBy] = useState<'updated' | 'title' | 'chapter' | 'rating'>('updated');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');

  const isReaderAvailable = (manga: MangaItem) => {
    return hasWorkingReaderSource(manga);
  };


  // Filter & Search Logic
  const filteredList = mangaList.filter((item) => {
    // Status Filter
    if (statusFilter === 'favorites' && !item.isFavorite) return false;
    if (statusFilter === 'flagged' && !item.isFlagged) return false;
    if (statusFilter !== 'all' && statusFilter !== 'favorites' && statusFilter !== 'flagged' && item.status !== statusFilter) return false;

    // Type Filter
    if (typeFilter !== 'all' && item.type !== typeFilter) return false;

    // Search Query
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const titleMatch = item.title.toLowerCase().includes(q);
      const altMatch = item.altTitles.some((alt) => alt.toLowerCase().includes(q));
      const tagMatch = item.genres.some((g) => g.toLowerCase().includes(q));
      const sourceMatch = item.sourceName.toLowerCase().includes(q);
      if (!titleMatch && !altMatch && !tagMatch && !sourceMatch) return false;
    }

    return true;
  });

  // Sort Logic
  const sortedList = [...filteredList].sort((a, b) => {
    if (sortBy === 'updated') {
      return new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime();
    }
    if (sortBy === 'title') {
      return a.title.localeCompare(b.title);
    }
    if (sortBy === 'chapter') {
      return b.currentChapter - a.currentChapter;
    }
    if (sortBy === 'rating') {
      return b.rating - a.rating;
    }
    return 0;
  });

  // Stats Counters
  const totalReading = mangaList.filter((m) => m.status === 'reading').length;
  const totalCompleted = mangaList.filter((m) => m.status === 'completed').length;
  const totalUnreadChapters = mangaList.reduce((acc, m) => {
    const diff = m.latestChapter - m.currentChapter;
    return acc + (diff > 0 ? diff : 0);
  }, 0);

  return (
    <div className="space-y-6">
      {/* Top Banner Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <div className="text-2xl font-black text-slate-100">{mangaList.length}</div>
            <div className="text-xs text-slate-400 font-medium">Total Tracked</div>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <Flame className="w-5 h-5" />
          </div>
          <div>
            <div className="text-2xl font-black text-slate-100">{totalReading}</div>
            <div className="text-xs text-slate-400 font-medium">Active Reading</div>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-orange-500/10 text-orange-400 border border-orange-500/20">
            <Zap className="w-5 h-5" />
          </div>
          <div>
            <div className="text-2xl font-black text-orange-400">{totalUnreadChapters}</div>
            <div className="text-xs text-slate-400 font-medium">Chapters Ahead</div>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <CheckCircle className="w-5 h-5" />
          </div>
          <div>
            <div className="text-2xl font-black text-slate-100">{totalCompleted}</div>
            <div className="text-xs text-slate-400 font-medium">Completed</div>
          </div>
        </div>
      </div>

      {/* Control Bar: Filters, Sort, View toggle */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-4">
        {/* Status Filter Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar text-xs font-semibold">
          <button
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1.5 rounded-lg transition-all whitespace-nowrap ${
              statusFilter === 'all'
                ? 'bg-amber-500 text-slate-950 font-bold shadow-sm'
                : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800'
            }`}
          >
            All ({mangaList.length})
          </button>
          <button
            onClick={() => setStatusFilter('reading')}
            className={`px-3 py-1.5 rounded-lg transition-all whitespace-nowrap ${
              statusFilter === 'reading'
                ? 'bg-amber-500 text-slate-950 font-bold shadow-sm'
                : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800'
            }`}
          >
            Reading ({totalReading})
          </button>
          <button
            onClick={() => setStatusFilter('favorites')}
            className={`px-3 py-1.5 rounded-lg transition-all whitespace-nowrap ${
              statusFilter === 'favorites'
                ? 'bg-amber-500 text-slate-950 font-bold shadow-sm'
                : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800'
            }`}
          >
            ★ Favorites ({mangaList.filter((m) => m.isFavorite).length})
          </button>
          <button
            onClick={() => setStatusFilter('flagged')}
            className={`px-3 py-1.5 rounded-lg transition-all whitespace-nowrap flex items-center gap-1 ${
              statusFilter === 'flagged'
                ? 'bg-red-500 text-slate-950 font-bold shadow-sm'
                : 'bg-slate-800/80 text-red-400 hover:bg-slate-800'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Flagged ({mangaList.filter((m) => m.isFlagged).length})</span>
          </button>
          <button
            onClick={() => setStatusFilter('plan_to_read')}
            className={`px-3 py-1.5 rounded-lg transition-all whitespace-nowrap ${
              statusFilter === 'plan_to_read'
                ? 'bg-amber-500 text-slate-950 font-bold shadow-sm'
                : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800'
            }`}
          >
            Plan to Read ({mangaList.filter((m) => m.status === 'plan_to_read').length})
          </button>
          <button
            onClick={() => setStatusFilter('completed')}
            className={`px-3 py-1.5 rounded-lg transition-all whitespace-nowrap ${
              statusFilter === 'completed'
                ? 'bg-amber-500 text-slate-950 font-bold shadow-sm'
                : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800'
            }`}
          >
            Completed ({totalCompleted})
          </button>
          <button
            onClick={() => setStatusFilter('on_hold')}
            className={`px-3 py-1.5 rounded-lg transition-all whitespace-nowrap ${
              statusFilter === 'on_hold'
                ? 'bg-amber-500 text-slate-950 font-bold shadow-sm'
                : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800'
            }`}
          >
            On Hold ({mangaList.filter((m) => m.status === 'on_hold').length})
          </button>
        </div>

        {/* Secondary Filter Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs border-t border-slate-800/80 pt-3">
          {/* Origin Type Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 font-medium mr-1">Type:</span>
            <button
              onClick={() => setTypeFilter('all')}
              className={`px-2.5 py-1 rounded-md transition-all ${
                typeFilter === 'all'
                  ? 'bg-slate-700 text-white font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setTypeFilter('manhwa')}
              className={`px-2.5 py-1 rounded-md transition-all flex items-center gap-1 ${
                typeFilter === 'manhwa'
                  ? 'bg-slate-700 text-white font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>🇰🇷</span> Manhwa
            </button>
            <button
              onClick={() => setTypeFilter('manhua')}
              className={`px-2.5 py-1 rounded-md transition-all flex items-center gap-1 ${
                typeFilter === 'manhua'
                  ? 'bg-slate-700 text-white font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>🇨🇳</span> Manhua
            </button>
          </div>

          {/* Sort & View Mode Controls */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-slate-400">
              <ArrowUpDown className="w-3.5 h-3.5 text-amber-400" />
              <span>Sort:</span>
              <select
                value={sortBy}
                onChange={(e: any) => setSortBy(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-amber-500/50"
              >
                <option value="updated">Recently Updated</option>
                <option value="title">Title A-Z</option>
                <option value="chapter">Chapter Progress</option>
                <option value="rating">Highest Rating</option>
              </select>
            </div>

            <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-0.5">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded ${viewMode === 'grid' ? 'bg-slate-800 text-amber-400' : 'text-slate-400'}`}
                title="Grid View"
              >
                <Layers className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setViewMode('table')}
                className={`p-1.5 rounded ${viewMode === 'table' ? 'bg-slate-800 text-amber-400' : 'text-slate-400'}`}
                title="Table View"
              >
                <BookOpen className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Manga List */}
      {sortedList.length === 0 ? (
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-12 text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center justify-center mx-auto">
            <BookOpen className="w-8 h-8" />
          </div>
          <div className="space-y-1">
            <h3 className="text-lg font-bold text-slate-200">No series found</h3>
            <p className="text-sm text-slate-400 max-w-sm mx-auto">
              No Manhwa or Manhua matched your current filters or search query "{searchQuery}".
            </p>
          </div>
          <button
            onClick={onAddNew}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-amber-500 text-slate-950 hover:bg-amber-400 transition-all"
          >
            <Plus className="w-4 h-4" />
            Add New Series
          </button>
        </div>
      ) : viewMode === 'grid' ? (
        /* GRID VIEW */
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-3 sm:gap-4 md:gap-5">
          {sortedList.map((manga) => {
            const hasNewChapter = manga.latestChapter > manga.currentChapter;
            const progress =
              manga.latestChapter > 0
                ? Math.min(100, Math.round((manga.currentChapter / manga.latestChapter) * 100))
                : 0;

            return (
              <div
                key={manga.id}
                className="group bg-slate-900 border border-slate-800/80 hover:border-slate-700 rounded-xl overflow-hidden shadow-lg transition-all duration-200 hover:-translate-y-1 flex flex-col relative"
              >
                {/* Cover Image Container */}
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
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-black/30" />

                  {/* Badges Overlay */}
                  <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between gap-1">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wide uppercase border backdrop-blur-md shadow-md ${
                        manga.type === 'manhwa'
                          ? 'bg-blue-950/80 text-blue-300 border-blue-500/30'
                          : manga.type === 'manhua'
                          ? 'bg-red-950/80 text-red-300 border-red-500/30'
                          : 'bg-purple-950/80 text-purple-300 border-purple-500/30'
                      }`}
                    >
                      {manga.type === 'manhwa' ? '🇰🇷 Manhwa' : '🇨🇳 Manhua'}
                    </span>

                    {hasNewChapter && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-gradient-to-r from-orange-500 to-amber-500 text-slate-950 shadow-md animate-pulse">
                        +{manga.latestChapter - manga.currentChapter} New
                      </span>
                    )}

                    {manga.isFlagged && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-black bg-red-600/90 text-white border border-red-400 shadow-md flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        <span>FLAGGED</span>
                      </span>
                    )}
                  </div>

                  {/* Rating Badge */}
                  <div className="absolute bottom-2.5 left-2.5 flex items-center gap-1 bg-slate-950/80 backdrop-blur-md px-2 py-0.5 rounded border border-slate-800 text-xs font-bold text-amber-400">
                    <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                    <span>{manga.rating}</span>
                  </div>
                </div>

                {/* Card Content */}
                <div className="p-3.5 flex-1 flex flex-col justify-between space-y-3">
                  <div className="space-y-1">
                    <h4
                      onClick={() => onSelectManga(manga)}
                      className="text-sm font-bold text-slate-100 line-clamp-1 hover:text-amber-400 cursor-pointer transition-colors"
                      title={manga.title}
                    >
                      {manga.title}
                    </h4>
                    <p className="text-[11px] text-slate-400 line-clamp-1">
                      {manga.altTitles[0] || manga.sourceName}
                    </p>
                  </div>

                  {/* Chapter Progress */}
                  <div className="space-y-1.5 pt-1 border-t border-slate-800/80">
                    <div className="flex items-center justify-between text-xs font-medium">
                      <span className="text-slate-400">Ch. {manga.currentChapter}</span>
                      <span className="text-slate-500 text-[11px]">of {manga.latestChapter}</span>
                    </div>

                    <div className="w-full h-1.5 rounded-full bg-slate-950 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          progress === 100
                            ? 'bg-emerald-500'
                            : hasNewChapter
                            ? 'bg-gradient-to-r from-orange-500 to-amber-400'
                            : 'bg-amber-500'
                        }`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="space-y-1.5 pt-1">
                    {isReaderAvailable(manga) ? (
                      <button
                        onClick={() => onOpenReader(manga, manga.currentChapter + 1)}
                        className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-extrabold text-xs transition-all shadow-md"
                        title="Open Webtoon Reader for next chapter"
                      >
                        <BookOpen className="w-3.5 h-3.5 fill-slate-950" />
                        <span>Read Ch. {manga.currentChapter + 1}</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => onSelectManga(manga)}
                        className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs transition-all border border-slate-700"
                      >
                        <BookOpen className="w-3.5 h-3.5 text-amber-400" />
                        <span>View Info</span>
                      </button>
                    )}

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => onOpenChapters(manga)}
                        className="flex-1 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[11px] font-semibold transition-colors border border-slate-700/80"
                        title="View full chapter list"
                      >
                        All Chapters
                      </button>

                      <button
                        onClick={() => onIncrementChapter(manga.id)}
                        className="px-2 py-1 rounded-md bg-slate-800 hover:bg-emerald-500 hover:text-slate-950 text-slate-300 text-[11px] font-bold transition-all border border-slate-700/80"
                        title="Quick mark +1 read without opening reader"
                      >
                        +1
                      </button>

                      <button
                        onClick={() => onQuickEdit(manga)}
                        className="p-1 rounded-md bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors border border-slate-800"
                        title="Edit series"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* TABLE VIEW */
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-950 text-slate-400 font-semibold border-b border-slate-800 uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4">Title</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Progress</th>
                  <th className="py-3 px-4">Rating</th>
                  <th className="py-3 px-4">Source</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {sortedList.map((manga) => {
                  const hasNew = manga.latestChapter > manga.currentChapter;
                  return (
                    <tr key={manga.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <img
                            src={manga.coverImage}
                            alt={manga.title}
                            className="w-9 h-12 rounded object-cover bg-slate-950"
                          />
                          <div>
                            <div
                              onClick={() => onSelectManga(manga)}
                              className="font-bold text-slate-100 hover:text-amber-400 cursor-pointer line-clamp-1"
                            >
                              {manga.title}
                            </div>
                            <div className="text-[11px] text-slate-400 line-clamp-1">
                              {manga.altTitles[0] || 'No alt title'}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 font-medium uppercase">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            manga.type === 'manhwa'
                              ? 'bg-blue-950 text-blue-300 border border-blue-500/20'
                              : 'bg-red-950 text-red-300 border border-red-500/20'
                          }`}
                        >
                          {manga.type === 'manhwa' ? '🇰🇷 Manhwa' : '🇨🇳 Manhua'}
                        </span>
                      </td>
                      <td className="py-3 px-4 capitalize">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-slate-800 text-slate-300">
                          {manga.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-200">Ch. {manga.currentChapter}</span>
                          <span className="text-slate-500">/ {manga.latestChapter}</span>
                          {hasNew && (
                            <span className="px-1.5 py-0.2 rounded text-[10px] bg-orange-500 text-slate-950 font-bold">
                              NEW
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 font-bold text-amber-400">★ {manga.rating}</td>
                      <td className="py-3 px-4 text-slate-400">{manga.sourceName}</td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => onOpenReader(manga, manga.currentChapter + 1)}
                            className="px-2.5 py-1 rounded bg-amber-500 text-slate-950 font-bold hover:bg-amber-400 transition-all text-xs flex items-center gap-1"
                          >
                            <BookOpen className="w-3 h-3 fill-slate-950" />
                            Read Ch. {manga.currentChapter + 1}
                          </button>
                          <button
                            onClick={() => onOpenChapters(manga)}
                            className="px-2 py-1 rounded bg-slate-800 text-slate-300 hover:text-white transition-all text-xs"
                          >
                            Chapters
                          </button>
                          <button
                            onClick={() => onIncrementChapter(manga.id)}
                            className="px-2 py-1 rounded bg-slate-800 text-emerald-400 hover:bg-emerald-950 transition-all text-xs font-bold"
                            title="Quick mark +1 read"
                          >
                            +1
                          </button>
                          <button
                            onClick={() => onQuickEdit(manga)}
                            className="p-1 rounded bg-slate-800 text-slate-300 hover:text-white"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => onDeleteManga(manga.id)}
                            className="p-1 rounded bg-slate-800 text-red-400 hover:bg-red-950"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Smart AI Recommendations Section */}
      <RecommendationsView
        mangaList={mangaList}
        onAddRecommended={(rec) => {
          onAddNew();
        }}
      />
    </div>
  );
};

