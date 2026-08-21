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
  CheckSquare,
  Square,
  Download,
  Check,
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
  onBulkUpdateStatus?: (ids: string[], status: ReadingStatus) => void;
  onBulkDelete?: (ids: string[]) => void;
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
  onBulkUpdateStatus,
  onBulkDelete,
}) => {
  const [statusFilter, setStatusFilter] = useState<ReadingStatus | 'all' | 'favorites' | 'flagged'>('all');
  const [typeFilter, setTypeFilter] = useState<MangaType | 'all'>('all');
  const [sortBy, setSortBy] = useState<'updated' | 'title' | 'chapter' | 'rating' | 'unread' | 'lastRead'>('updated');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');

  // Multi-Select States
  const [isSelectMode, setIsSelectMode] = useState<boolean>(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Virtualized Chunked Loading for Smooth 60 FPS Scrolling
  const [visibleLimit, setVisibleLimit] = useState<number>(36);
  const sentinelRef = React.useRef<HTMLDivElement>(null);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === filteredList.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredList.map((m) => m.id)));
    }
  };

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
    if (sortBy === 'unread') {
      const unreadA = Math.max(0, a.latestChapter - a.currentChapter);
      const unreadB = Math.max(0, b.latestChapter - b.currentChapter);
      return unreadB - unreadA;
    }
    if (sortBy === 'lastRead') {
      return new Date(b.lastReadAt || 0).getTime() - new Date(a.lastReadAt || 0).getTime();
    }
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

  // Reset visible limit on filter changes
  React.useEffect(() => {
    setVisibleLimit(36);
  }, [statusFilter, typeFilter, sortBy, searchQuery]);

  // IntersectionObserver for lazy chunk rendering
  React.useEffect(() => {
    if (!sentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleLimit((prev) => Math.min(prev + 24, sortedList.length));
        }
      },
      { rootMargin: '400px' }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [sortedList.length]);

  const visibleList = React.useMemo(() => sortedList.slice(0, visibleLimit), [sortedList, visibleLimit]);

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
              className={`px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-md transition-all text-xs sm:text-sm ${
                typeFilter === 'all'
                  ? 'bg-elevated text-white font-semibold'
                  : 'text-secondary hover:text-primary'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setTypeFilter('manhwa')}
              className={`px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-md transition-all flex items-center gap-1 text-xs sm:text-sm ${
                typeFilter === 'manhwa'
                  ? 'bg-elevated text-white font-semibold'
                  : 'text-secondary hover:text-primary'
              }`}
            >
              <span>🇰🇷</span> Manhwa
            </button>
            <button
              onClick={() => setTypeFilter('manhua')}
              className={`px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-md transition-all flex items-center gap-1 text-xs sm:text-sm ${
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
              <button
                onClick={() => {
                  setIsSelectMode(!isSelectMode);
                  if (isSelectMode) setSelectedIds(new Set());
                }}
                className={`px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg text-xs sm:text-sm font-bold transition-all flex items-center gap-1.5 border ${
                  isSelectMode
                    ? 'bg-accent text-accent-fg border-accent shadow-sm'
                    : 'bg-app border-edge text-secondary hover:text-primary hover:bg-elevated'
                }`}
              >
                {isSelectMode ? <CheckSquare className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> : <Square className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
                <span>{isSelectMode ? 'Cancel Select' : 'Select'}</span>
              </button>

              <div className="flex items-center gap-1.5 text-secondary">
                <ArrowUpDown className="w-3.5 h-3.5 text-accent" />
                <span>Sort:</span>
                <select
                  value={sortBy}
                  onChange={(e: any) => setSortBy(e.target.value)}
                  className="bg-app border border-edge rounded px-2 py-1 text-primary focus:outline-none focus:border-accent/50"
                >
                  <option value="unread">⚡ Unread Chapters Ahead</option>
                  <option value="lastRead">🕒 Recently Read</option>
                  <option value="updated">🔄 Recently Updated</option>
                  <option value="title">🔤 Title A-Z</option>
                  <option value="rating">★ Highest Rating</option>
                  <option value="chapter">📊 Chapter Progress</option>
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
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-3 sm:gap-4 md:gap-5">
            {visibleList.map((manga) => {
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
                  onClick={() => {
                    if (isSelectMode) toggleSelect(manga.id);
                    else onSelectManga(manga);
                  }}
                  className="relative aspect-[3/4] w-full overflow-hidden bg-app cursor-pointer"
                >
                  <img
                    src={manga.coverImage}
                    alt={manga.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-app via-transparent to-black/30" />

                  {/* Multi-Select Checkbox Badge */}
                  {isSelectMode && (
                    <div className="absolute top-2.5 right-2.5 z-20">
                      <div className={`w-6 h-6 rounded-lg flex items-center justify-center border shadow-lg transition-all ${
                        selectedIds.has(manga.id)
                          ? 'bg-accent border-accent text-accent-fg scale-110'
                          : 'bg-surface/80 border-edge text-transparent backdrop-blur-md'
                      }`}>
                        <Check className="w-4 h-4 stroke-[3]" />
                      </div>
                    </div>
                  )}

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

                    {manga.isFlagged ? (
                      <span className={`px-2 py-0.5 rounded text-[10px] font-black border shadow-md flex items-center gap-1 ${
                        manga.flagReason?.toLowerCase().includes('missing source')
                          ? 'bg-amber-950/90 text-amber-300 border-amber-500/50'
                          : 'bg-danger/90 text-white border-danger'
                      }`}>
                        <AlertTriangle className="w-3 h-3" />
                        <span>{manga.flagReason?.toLowerCase().includes('missing source') ? 'NO SOURCE' : 'FLAGGED'}</span>
                      </span>
                    ) : !isReaderAvailable(manga) ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-black bg-amber-950/80 text-amber-400 border border-amber-500/30 shadow-md flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        <span>NO SOURCE</span>
                      </span>
                    ) : null}
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
        {visibleLimit < sortedList.length && (
          <div ref={sentinelRef} className="py-4 text-center text-xs font-mono text-secondary">
            Loading more series ({visibleLimit} of {sortedList.length})...
          </div>
        )}
      </div>
      ) : (
        /* TABLE VIEW */
        <div className="space-y-4">
          <div className="bg-surface border border-edge rounded-xl overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-secondary">
                <thead className="bg-app text-secondary font-semibold border-b border-edge uppercase tracking-wider">
                  <tr>
                    {isSelectMode && <th className="py-3 px-3 w-10"></th>}
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
                  {visibleList.map((manga) => {
                    const hasNew = manga.latestChapter > manga.currentChapter;
                  const isSelected = selectedIds.has(manga.id);
                  return (
                    <tr
                      key={manga.id}
                      onClick={() => {
                        if (isSelectMode) toggleSelect(manga.id);
                      }}
                      className={`hover:bg-elevated/40 transition-colors ${
                        isSelected ? 'bg-accent/10' : ''
                      } ${isSelectMode ? 'cursor-pointer' : ''}`}
                    >
                      {isSelectMode && (
                        <td className="py-3 px-3">
                          <div className={`w-5 h-5 rounded flex items-center justify-center border ${
                            isSelected ? 'bg-accent border-accent text-accent-fg' : 'border-edge bg-surface text-transparent'
                          }`}>
                            <Check className="w-3.5 h-3.5 stroke-[3]" />
                          </div>
                        </td>
                      )}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <img
                            src={manga.coverImage}
                            alt={manga.title}
                            className="w-9 h-12 rounded object-cover bg-app"
                          />
                          <div>
                            <div
                              onClick={() => {
                                if (!isSelectMode) onSelectManga(manga);
                              }}
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
                      <td className="py-3 px-4 text-secondary">
                        <div className="flex items-center gap-1.5">
                          <span>{manga.sourceName}</span>
                          {(manga.isFlagged && manga.flagReason?.toLowerCase().includes('missing source')) || !isReaderAvailable(manga) ? (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-950/80 text-amber-300 border border-amber-500/40" title="Missing reading source">
                              No Source
                            </span>
                          ) : manga.isFlagged ? (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-danger/80 text-white" title={manga.flagReason}>
                              Flagged
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenReader(manga, manga.currentChapter + 1);
                            }}
                            className="px-2.5 sm:px-3 py-1 sm:py-1.5 rounded bg-accent text-accent-fg font-bold hover:bg-accent-bright transition-all text-xs sm:text-sm flex items-center gap-1"
                          >
                            <BookOpen className="w-3 h-3 sm:w-3.5 sm:h-3.5 fill-accent-fg" />
                            Read Ch. {manga.currentChapter + 1}
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenChapters(manga);
                            }}
                            className="px-2 sm:px-2.5 py-1 sm:py-1.5 rounded bg-elevated text-secondary hover:text-white transition-all text-xs sm:text-sm"
                          >
                            Chapters
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onIncrementChapter(manga.id);
                            }}
                            className="px-2 sm:px-2.5 py-1 sm:py-1.5 rounded bg-elevated text-success hover:bg-emerald-950 transition-all text-xs sm:text-sm font-bold"
                            title="Quick mark +1 read"
                          >
                            +1
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onQuickEdit(manga);
                            }}
                            className="p-1 rounded bg-elevated text-secondary hover:text-white"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteManga(manga.id);
                            }}
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
          {visibleLimit < sortedList.length && (
            <div ref={sentinelRef} className="py-4 text-center text-xs font-mono text-secondary">
              Loading more series ({visibleLimit} of {sortedList.length})...
            </div>
          )}
        </div>
      )}

      {/* Floating Bulk Actions Toolbar */}
      {isSelectMode && selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-surface/95 backdrop-blur-md border border-edge-strong rounded-2xl shadow-2xl p-3 px-5 flex flex-wrap items-center justify-center gap-3">
          <div className="flex items-center gap-2 pr-3 border-r border-edge">
            <span className="w-6 h-6 rounded-full bg-accent text-accent-fg font-black text-xs flex items-center justify-center">
              {selectedIds.size}
            </span>
            <span className="text-xs font-bold text-primary">Selected</span>
          </div>

          <button
            onClick={selectAll}
            className="px-3 py-1.5 rounded-xl bg-elevated hover:bg-elevated text-secondary hover:text-primary font-bold text-xs transition-all"
          >
            {selectedIds.size === sortedList.length ? 'Deselect All' : 'Select All'}
          </button>

          {/* Bulk Mark Read */}
          <button
            onClick={() => {
              if (onBulkUpdateStatus) {
                onBulkUpdateStatus(Array.from(selectedIds), 'completed');
                setSelectedIds(new Set());
                setIsSelectMode(false);
              }
            }}
            className="px-3.5 py-1.5 rounded-xl bg-success/20 hover:bg-success/30 text-success border border-success/30 font-bold text-xs flex items-center gap-1.5 transition-all"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Mark as Read</span>
          </button>

          {/* Bulk Status Select */}
          <select
            onChange={(e) => {
              if (e.target.value && onBulkUpdateStatus) {
                onBulkUpdateStatus(Array.from(selectedIds), e.target.value as any);
                setSelectedIds(new Set());
                setIsSelectMode(false);
              }
            }}
            defaultValue=""
            className="bg-app border border-edge rounded-xl px-3 py-1.5 text-xs text-primary font-bold focus:outline-none"
          >
            <option value="" disabled>Set Status...</option>
            <option value="reading">Reading</option>
            <option value="completed">Completed</option>
            <option value="plan_to_read">Plan to Read</option>
            <option value="on_hold">On Hold</option>
            <option value="dropped">Dropped</option>
          </select>

          {/* Bulk Delete */}
          <button
            onClick={() => {
              if (onBulkDelete) {
                onBulkDelete(Array.from(selectedIds));
                setSelectedIds(new Set());
                setIsSelectMode(false);
              }
            }}
            className="px-3 py-1.5 rounded-xl bg-danger/20 hover:bg-danger/30 text-danger border border-danger/30 font-bold text-xs flex items-center gap-1.5 transition-all"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete</span>
          </button>

          {/* Done */}
          <button
            onClick={() => {
              setSelectedIds(new Set());
              setIsSelectMode(false);
            }}
            className="px-3 py-1.5 rounded-xl bg-elevated hover:bg-elevated text-secondary hover:text-white text-xs font-bold"
          >
            Done
          </button>
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
