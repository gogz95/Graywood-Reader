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
        <div className="p-4 rounded-xl bg-surface/90 border border-edge flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-accent/10 text-accent border border-accent/20">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <div className="text-2xl font-black text-primary">{mangaList.length}</div>
            <div className="text-xs text-secondary font-medium">Total Tracked</div>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-surface/90 border border-edge flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-success/10 text-success border border-success/20">
            <Flame className="w-5 h-5" />
          </div>
          <div>
            <div className="text-2xl font-black text-primary">{totalReading}</div>
            <div className="text-xs text-secondary font-medium">Active Reading</div>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-surface/90 border border-edge flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-accent-2/10 text-accent-2 border border-accent-2/20">
            <Zap className="w-5 h-5" />
          </div>
          <div>
            <div className="text-2xl font-black text-accent-2">{totalUnreadChapters}</div>
            <div className="text-xs text-secondary font-medium">Chapters Ahead</div>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-surface/90 border border-edge flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-info/10 text-info border border-info/20">
            <CheckCircle className="w-5 h-5" />
          </div>
          <div>
            <div className="text-2xl font-black text-primary">{totalCompleted}</div>
            <div className="text-xs text-secondary font-medium">Completed</div>
          </div>
        </div>
      </div>

      {/* Control Bar: Filters, Sort, View toggle */}
      <div className="bg-surface/90 border border-edge rounded-xl p-4 space-y-4">
        {/* Status Filter Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar text-xs font-semibold">
          <button
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1.5 rounded-lg transition-all whitespace-nowrap ${
              statusFilter === 'all'
                ? 'bg-accent text-accent-fg font-bold shadow-sm'
                : 'bg-elevated/80 text-secondary hover:bg-elevated'
            }`}
          >
            All ({mangaList.length})
          </button>
          <button
            onClick={() => setStatusFilter('reading')}
            className={`px-3 py-1.5 rounded-lg transition-all whitespace-nowrap ${
              statusFilter === 'reading'
                ? 'bg-accent text-accent-fg font-bold shadow-sm'
                : 'bg-elevated/80 text-secondary hover:bg-elevated'
            }`}
          >
            Reading ({totalReading})
          </button>
          <button
            onClick={() => setStatusFilter('favorites')}
            className={`px-3 py-1.5 rounded-lg transition-all whitespace-nowrap ${
              statusFilter === 'favorites'
                ? 'bg-accent text-accent-fg font-bold shadow-sm'
                : 'bg-elevated/80 text-secondary hover:bg-elevated'
            }`}
          >
            ★ Favorites ({mangaList.filter((m) => m.isFavorite).length})
          </button>
          <button
            onClick={() => setStatusFilter('flagged')}
            className={`px-3 py-1.5 rounded-lg transition-all whitespace-nowrap flex items-center gap-1 ${
              statusFilter === 'flagged'
                ? 'bg-danger text-accent-fg font-bold shadow-sm'
                : 'bg-elevated/80 text-danger hover:bg-elevated'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Flagged ({mangaList.filter((m) => m.isFlagged).length})</span>
          </button>
          <button
            onClick={() => setStatusFilter('plan_to_read')}
            className={`px-3 py-1.5 rounded-lg transition-all whitespace-nowrap ${
              statusFilter === 'plan_to_read'
                ? 'bg-accent text-accent-fg font-bold shadow-sm'
                : 'bg-elevated/80 text-secondary hover:bg-elevated'
            }`}
          >
            Plan to Read ({mangaList.filter((m) => m.status === 'plan_to_read').length})
          </button>
          <button
            onClick={() => setStatusFilter('completed')}
            className={`px-3 py-1.5 rounded-lg transition-all whitespace-nowrap ${
              statusFilter === 'completed'
                ? 'bg-accent text-accent-fg font-bold shadow-sm'
                : 'bg-elevated/80 text-secondary hover:bg-elevated'
            }`}
          >
            Completed ({totalCompleted})
          </button>
          <button
            onClick={() => setStatusFilter('on_hold')}
            className={`px-3 py-1.5 rounded-lg transition-all whitespace-nowrap ${
              statusFilter === 'on_hold'
                ? 'bg-accent text-accent-fg font-bold shadow-sm'
                : 'bg-elevated/80 text-secondary hover:bg-elevated'
            }`}
          >
            On Hold ({mangaList.filter((m) => m.status === 'on_hold').length})
          </button>
        </div>

        {/* Secondary Filter Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs border-t border-edge/80 pt-3">
          {/* Origin Type Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-secondary font-medium mr-1">Type:</span>
            <button
              onClick={() => setTypeFilter('all')}
              className={`px-2.5 py-1 rounded-md transition-all ${
                typeFilter === 'all'
                  ? 'bg-elevated text-white font-semibold'
                  : 'text-secondary hover:text-primary'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setTypeFilter('manhwa')}
              className={`px-2.5 py-1 rounded-md transition-all flex items-center gap-1 ${
                typeFilter === 'manhwa'
                  ? 'bg-elevated text-white font-semibold'
                  : 'text-secondary hover:text-primary'
              }`}
            >
              <span>🇰🇷</span> Manhwa
            </button>
            <button
              onClick={() => setTypeFilter('manhua')}
              className={`px-2.5 py-1 rounded-md transition-all flex items-center gap-1 ${
                typeFilter === 'manhua'
                  ? 'bg-elevated text-white font-semibold'
                  : 'text-secondary hover:text-primary'
              }`}
            >
              <span>🇨🇳</span> Manhua
            </button>
          </div>

          {/* Sort & View Mode Controls */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-secondary">
              <ArrowUpDown className="w-3.5 h-3.5 text-accent" />
              <span>Sort:</span>
              <select
                value={sortBy}
                onChange={(e: any) => setSortBy(e.target.value)}
                className="bg-app border border-edge rounded px-2 py-1 text-primary focus:outline-none focus:border-accent/50"
              >
                <option value="updated">Recently Updated</option>
                <option value="title">Title A-Z</option>
                <option value="chapter">Chapter Progress</option>
                <option value="rating">Highest Rating</option>
              </select>
            </div>

            <div className="flex items-center bg-app border border-edge rounded-lg p-0.5">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded ${viewMode === 'grid' ? 'bg-elevated text-accent' : 'text-secondary'}`}
                title="Grid View"
              >
                <Layers className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setViewMode('table')}
                className={`p-1.5 rounded ${viewMode === 'table' ? 'bg-elevated text-accent' : 'text-secondary'}`}
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
        <div className="bg-surface/60 border border-edge rounded-2xl p-12 text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-accent/10 text-accent border border-accent/20 flex items-center justify-center mx-auto">
            <BookOpen className="w-8 h-8" />
          </div>
          <div className="space-y-1">
            <h3 className="text-lg font-bold text-primary">No series found</h3>
            <p className="text-sm text-secondary max-w-sm mx-auto">
              No Manhwa or Manhua matched your current filters or search query "{searchQuery}".
            </p>
          </div>
          <button
            onClick={onAddNew}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-accent text-accent-fg hover:bg-accent-bright transition-all"
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
                className="group bg-surface border border-edge/80 hover:border-edge-strong rounded-xl overflow-hidden shadow-lg transition-all duration-200 hover:-translate-y-1 flex flex-col relative"
              >
                {/* Cover Image Container */}
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
                  <div className="absolute inset-0 bg-gradient-to-t from-app via-transparent to-black/30" />

                  {/* Badges Overlay */}
                  <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between gap-1">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wide uppercase border backdrop-blur-md shadow-md ${
                        manga.type === 'manhwa'
                          ? 'bg-blue-950/80 text-info border-info/30'
                          : manga.type === 'manhua'
                          ? 'bg-red-950/80 text-danger border-danger/30'
                          : 'bg-purple-950/80 text-accent-2 border-accent-2/30'
                      }`}
                    >
                      {manga.type === 'manhwa' ? '🇰🇷 Manhwa' : '🇨🇳 Manhua'}
                    </span>

                    {hasNewChapter && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-gradient-to-r from-accent-2 to-accent text-accent-fg shadow-md animate-pulse">
                        +{manga.latestChapter - manga.currentChapter} New
                      </span>
                    )}

                    {manga.isFlagged && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-black bg-danger/90 text-white border border-danger shadow-md flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        <span>FLAGGED</span>
                      </span>
                    )}
                  </div>

                  {/* Rating Badge */}
                  <div className="absolute bottom-2.5 left-2.5 flex items-center gap-1 bg-app/80 backdrop-blur-md px-2 py-0.5 rounded border border-edge text-xs font-bold text-accent">
                    <Star className="w-3 h-3 fill-accent text-accent" />
                    <span>{manga.rating}</span>
                  </div>
                </div>

                {/* Card Content */}
                <div className="p-3.5 flex-1 flex flex-col justify-between space-y-3">
                  <div className="space-y-1">
                    <h4
                      onClick={() => onSelectManga(manga)}
                      className="text-sm font-bold text-primary line-clamp-1 hover:text-accent cursor-pointer transition-colors"
                      title={manga.title}
                    >
                      {manga.title}
                    </h4>
                    <p className="text-[11px] text-secondary line-clamp-1">
                      {manga.altTitles[0] || manga.sourceName}
                    </p>
                  </div>

                  {/* Chapter Progress */}
                  <div className="space-y-1.5 pt-1 border-t border-edge/80">
                    <div className="flex items-center justify-between text-xs font-medium">
                      <span className="text-secondary">Ch. {manga.currentChapter}</span>
                      <span className="text-muted text-[11px]">of {manga.latestChapter}</span>
                    </div>

                    <div className="w-full h-1.5 rounded-full bg-app overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          progress === 100
                            ? 'bg-success'
                            : hasNewChapter
                            ? 'bg-gradient-to-r from-accent-2 to-accent-bright'
                            : 'bg-accent'
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
                        className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-gradient-to-r from-accent to-accent-2 hover:from-accent-bright hover:to-accent-2 text-accent-fg font-extrabold text-xs transition-all shadow-md"
                        title="Open Webtoon Reader for next chapter"
                      >
                        <BookOpen className="w-3.5 h-3.5 fill-accent-fg" />
                        <span>Read Ch. {manga.currentChapter + 1}</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => onSelectManga(manga)}
                        className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-elevated hover:bg-elevated text-primary font-bold text-xs transition-all border border-edge-strong"
                      >
                        <BookOpen className="w-3.5 h-3.5 text-accent" />
                        <span>View Info</span>
                      </button>
                    )}

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => onOpenChapters(manga)}
                        className="flex-1 py-1 rounded-md bg-elevated hover:bg-elevated text-secondary hover:text-white text-[11px] font-semibold transition-colors border border-edge-strong/80"
                        title="View full chapter list"
                      >
                        All Chapters
                      </button>

                      <button
                        onClick={() => onIncrementChapter(manga.id)}
                        className="px-2 py-1 rounded-md bg-elevated hover:bg-success hover:text-accent-fg text-secondary text-[11px] font-bold transition-all border border-edge-strong/80"
                        title="Quick mark +1 read without opening reader"
                      >
                        +1
                      </button>

                      <button
                        onClick={() => onQuickEdit(manga)}
                        className="p-1 rounded-md bg-elevated/80 hover:bg-elevated text-secondary hover:text-primary transition-colors border border-edge"
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
        <div className="bg-surface border border-edge rounded-xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-secondary">
              <thead className="bg-app text-secondary font-semibold border-b border-edge uppercase tracking-wider">
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
              <tbody className="divide-y divide-edge/80">
                {sortedList.map((manga) => {
                  const hasNew = manga.latestChapter > manga.currentChapter;
                  return (
                    <tr key={manga.id} className="hover:bg-elevated/40 transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <img
                            src={manga.coverImage}
                            alt={manga.title}
                            className="w-9 h-12 rounded object-cover bg-app"
                          />
                          <div>
                            <div
                              onClick={() => onSelectManga(manga)}
                              className="font-bold text-primary hover:text-accent cursor-pointer line-clamp-1"
                            >
                              {manga.title}
                            </div>
                            <div className="text-[11px] text-secondary line-clamp-1">
                              {manga.altTitles[0] || 'No alt title'}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 font-medium uppercase">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            manga.type === 'manhwa'
                              ? 'bg-blue-950 text-info border border-info/20'
                              : 'bg-red-950 text-danger border border-danger/20'
                          }`}
                        >
                          {manga.type === 'manhwa' ? '🇰🇷 Manhwa' : '🇨🇳 Manhua'}
                        </span>
                      </td>
                      <td className="py-3 px-4 capitalize">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-elevated text-secondary">
                          {manga.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-primary">Ch. {manga.currentChapter}</span>
                          <span className="text-muted">/ {manga.latestChapter}</span>
                          {hasNew && (
                            <span className="px-1.5 py-0.2 rounded text-[10px] bg-accent-2 text-accent-fg font-bold">
                              NEW
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 font-bold text-accent">★ {manga.rating}</td>
                      <td className="py-3 px-4 text-secondary">{manga.sourceName}</td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => onOpenReader(manga, manga.currentChapter + 1)}
                            className="px-2.5 py-1 rounded bg-accent text-accent-fg font-bold hover:bg-accent-bright transition-all text-xs flex items-center gap-1"
                          >
                            <BookOpen className="w-3 h-3 fill-accent-fg" />
                            Read Ch. {manga.currentChapter + 1}
                          </button>
                          <button
                            onClick={() => onOpenChapters(manga)}
                            className="px-2 py-1 rounded bg-elevated text-secondary hover:text-white transition-all text-xs"
                          >
                            Chapters
                          </button>
                          <button
                            onClick={() => onIncrementChapter(manga.id)}
                            className="px-2 py-1 rounded bg-elevated text-success hover:bg-emerald-950 transition-all text-xs font-bold"
                            title="Quick mark +1 read"
                          >
                            +1
                          </button>
                          <button
                            onClick={() => onQuickEdit(manga)}
                            className="p-1 rounded bg-elevated text-secondary hover:text-white"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => onDeleteManga(manga.id)}
                            className="p-1 rounded bg-elevated text-danger hover:bg-red-950"
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

