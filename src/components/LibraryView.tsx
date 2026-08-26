import React, { useState } from 'react';
import { RecommendationsView } from './RecommendationsView';
import {
  MangaItem,
  ReadingStatus,
  MangaType,
  hasWorkingReaderSource,
  UserCategory,
  isNsfwManga,
} from '../types';
import { ManageCategoriesModal } from './ManageCategoriesModal';
import { apiFetch } from '../utils/api';
import {
  BookOpen,
  CheckCircle,
  Clock,
  Star,
  Flame,
  Zap,
  AlertTriangle,
  CheckSquare,
  Square,
  Plus,
  Layers,
} from 'lucide-react';
import { MangaGridCard, MangaListRow } from './library/LibraryCard';
import { HeroSpotlightBanner } from './library/HeroSpotlightBanner';
import { JumpBackInShelf, FreshReleasesShelf } from './library/LibraryShelves';
import { LibraryBatchBar } from './library/LibraryBatchBar';
import { LibraryCategoryRibbon } from './library/LibraryCategoryRibbon';
import { LibraryFiltersDrawer } from './library/LibraryFiltersDrawer';

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
  isGuest?: boolean;
  onOpenAuthModal?: () => void;
  onRefreshLibrary?: () => void;
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
  isGuest = false,
  onOpenAuthModal,
  onRefreshLibrary,
}) => {
  const [statusFilter, setStatusFilter] = useState<ReadingStatus | 'all' | 'favorites' | 'flagged'>('all');
  const [typeFilter, setTypeFilter] = useState<MangaType | 'all'>('all');
  const [nsfwFilter, setNsfwFilter] = useState<'all' | 'safe' | '18+'>('all');
  const [sortBy, setSortBy] = useState<'unread' | 'lastRead' | 'updated' | 'addedDesc' | 'title' | 'rating' | 'chapter' | 'nsfwFirst' | 'sfwFirst'>('updated');
  const [viewMode, setViewMode] = useState<'shelves' | 'grid' | 'table'>('shelves');

  const [isAutoTagging, setIsAutoTagging] = useState<boolean>(false);
  const [autoTagToast, setAutoTagToast] = useState<string | null>(null);

  const handleAutoTagNsfw = async () => {
    setIsAutoTagging(true);
    setAutoTagToast(null);
    try {
      const res = await apiFetch('/api/manga/auto-tag-nsfw', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setAutoTagToast(`Auto-tagged ${data.newlyTaggedCount} adult series as 18+ NSFW.`);
        onRefreshLibrary?.();
      } else {
        setAutoTagToast('Failed to auto-tag series.');
      }
    } catch (e: any) {
      setAutoTagToast('Error running auto-tagger: ' + e.message);
    } finally {
      setIsAutoTagging(false);
      setTimeout(() => setAutoTagToast(null), 5000);
    }
  };

  // Categories & Custom Shelves
  const [categories, setCategories] = useState<UserCategory[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [isManageCategoriesOpen, setIsManageCategoriesOpen] = useState(false);
  const [isShelvesExpanded, setIsShelvesExpanded] = useState(false);
  const shelvesRef = React.useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkShelfScroll = React.useCallback(() => {
    if (!shelvesRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = shelvesRef.current;
    setCanScrollLeft(scrollLeft > 4);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 4);
  }, []);

  const scrollShelves = (direction: 'left' | 'right') => {
    if (!shelvesRef.current) return;
    const offset = direction === 'left' ? -260 : 260;
    shelvesRef.current.scrollBy({ left: offset, behavior: 'smooth' });
    setTimeout(checkShelfScroll, 220);
  };

  const handleShelfWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!isShelvesExpanded && shelvesRef.current && e.deltaY !== 0) {
      e.currentTarget.scrollLeft += e.deltaY * 1.5;
      checkShelfScroll();
    }
  };

  const fetchCategories = React.useCallback(async () => {
    try {
      const res = await apiFetch('/api/categories');
      if (res.ok) {
        const data = await res.json();
        setCategories(data || []);
      }
    } catch {
      // ignore
    }
  }, []);

  React.useEffect(() => {
    fetchCategories();

    const handleRefresh = () => {
      fetchCategories();
    };
    window.addEventListener('refresh-categories', handleRefresh);
    return () => window.removeEventListener('refresh-categories', handleRefresh);
  }, [fetchCategories, mangaList]);

  React.useEffect(() => {
    checkShelfScroll();
    window.addEventListener('resize', checkShelfScroll);
    return () => window.removeEventListener('resize', checkShelfScroll);
  }, [checkShelfScroll, categories]);

  // Multi-Select States
  const [isSelectMode, setIsSelectMode] = useState<boolean>(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Tri-State Genre Filter States: 'include' (+Tag) | 'exclude' (-Tag) | neutral
  const [genreStates, setGenreStates] = useState<Map<string, 'include' | 'exclude'>>(new Map());
  const [isGenreFilterOpen, setIsGenreFilterOpen] = useState<boolean>(false);

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

  // Extract all distinct library genres
  const libraryGenres = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of mangaList) {
      for (const g of m.genres || []) {
        if (g && g.trim()) {
          counts.set(g.trim(), (counts.get(g.trim()) || 0) + 1);
        }
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([tag]) => tag);
  }, [mangaList]);

  const toggleGenreTag = (tag: string) => {
    setGenreStates((prev) => {
      const next = new Map(prev);
      const cur = next.get(tag);
      if (!cur) next.set(tag, 'include');
      else if (cur === 'include') next.set(tag, 'exclude');
      else next.delete(tag);
      return next;
    });
  };

  const clearGenreTags = () => {
    setGenreStates(new Map());
  };

  // Filter & Search Logic (Memoized to prevent blocking renders on menu/modal toggles)
  const filteredList = React.useMemo(() => {
    return mangaList.filter((item) => {
      // Status Filter
      if (statusFilter === 'favorites' && !item.isFavorite) return false;
      if (statusFilter === 'flagged' && !item.isFlagged) return false;
      if (statusFilter !== 'all' && statusFilter !== 'favorites' && statusFilter !== 'flagged' && item.status !== statusFilter) return false;

      // Category / Custom Shelf Filter (Handles both manual assignment and smart dynamic rules)
      if (activeCategory) {
        const activeCatObj = categories.find((c) => c.id === activeCategory);
        if (activeCatObj?.isDynamic && activeCatObj.ruleType) {
          const rType = activeCatObj.ruleType;
          const rVal = String(activeCatObj.ruleValue || '');

          if (rType === 'unread') {
            const minUnread = Number(rVal) || 1;
            if (item.latestChapter - item.currentChapter < minUnread) return false;
          } else if (rType === 'in_progress') {
            if (item.status !== 'reading' || item.currentChapter <= 0) return false;
          } else if (rType === 'completed') {
            if (item.status !== 'completed') return false;
          } else if (rType === 'rating' || rType === 'min_rating') {
            const min = Number(rVal) || 9.0;
            if (item.rating < min) return false;
          } else if (rType === 'favorites') {
            if (!item.isFavorite) return false;
          } else if (rType === 'completed_gems') {
            const min = Number(rVal) || 8.5;
            if (item.status !== 'completed' || item.rating < min) return false;
          } else if (rType === 'updated_recently') {
            const daysDiff = (Date.now() - new Date(item.lastUpdated || 0).getTime()) / (1000 * 3600 * 24);
            if (daysDiff > (Number(rVal) || 7)) return false;
          } else if (rType === 'compound_json') {
            try {
              const rule = JSON.parse(rVal);
              if (rule.minRating !== undefined && item.rating < Number(rule.minRating)) return false;
              if (rule.status && Array.isArray(rule.status) && rule.status.length > 0 && !rule.status.includes(item.status)) return false;
              if (rule.type && Array.isArray(rule.type) && rule.type.length > 0 && !rule.type.includes(item.type)) return false;
              if (rule.minUnread !== undefined && (item.latestChapter - item.currentChapter < Number(rule.minUnread))) return false;
            } catch {
              // ignore json parse error
            }
          }
        } else {
          const activeName = activeCatObj?.name?.toLowerCase().trim();
          const hasCat = item.categories?.some((c) => {
            const cStr = String(c).trim();
            return cStr === activeCategory || (activeName && cStr.toLowerCase() === activeName);
          });
          if (!hasCat) return false;
        }
      }

      // Tri-State Genre Filtering (+Include / -Exclude / Ignore)
      if (genreStates.size > 0) {
        const itemGenres = (item.genres || []).map((g) => g.toLowerCase());
        for (const [tag, mode] of genreStates.entries()) {
          const tagNorm = tag.toLowerCase();
          const hasTag = itemGenres.some((g) => g === tagNorm || g.includes(tagNorm));
          if (mode === 'include' && !hasTag) return false;
          if (mode === 'exclude' && hasTag) return false;
        }
      }

      // Origin Type Filter
      if (typeFilter !== 'all' && item.type !== typeFilter) return false;

      // 18+ / NSFW Content Filter (Guests never have access to NSFW items)
      if (isGuest && isNsfwManga(item)) return false;
      if (nsfwFilter === 'safe' && isNsfwManga(item)) return false;
      if (nsfwFilter === '18+' && !isNsfwManga(item)) return false;

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
  }, [mangaList, statusFilter, activeCategory, categories, genreStates, typeFilter, isGuest, nsfwFilter, searchQuery]);

  // Sort Logic (Memoized)
  const sortedList = React.useMemo(() => {
    return [...filteredList].sort((a, b) => {
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
      if (sortBy === 'addedDesc') {
        return new Date((b as any).addedAt || b.lastUpdated || 0).getTime() - new Date((a as any).addedAt || a.lastUpdated || 0).getTime();
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
      if (sortBy === 'nsfwFirst') {
        const aNsfw = isNsfwManga(a) ? 1 : 0;
        const bNsfw = isNsfwManga(b) ? 1 : 0;
        if (bNsfw !== aNsfw) return bNsfw - aNsfw;
        return a.title.localeCompare(b.title);
      }
      if (sortBy === 'sfwFirst') {
        const aNsfw = isNsfwManga(a) ? 1 : 0;
        const bNsfw = isNsfwManga(b) ? 1 : 0;
        if (aNsfw !== bNsfw) return aNsfw - bNsfw;
        return a.title.localeCompare(b.title);
      }
      return 0;
    });
  }, [filteredList, sortBy]);

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

  const totalReading = React.useMemo(() => mangaList.filter((m) => m.status === 'reading').length, [mangaList]);
  const totalCompleted = React.useMemo(() => mangaList.filter((m) => m.status === 'completed').length, [mangaList]);
  const totalUnreadChapters = React.useMemo(() => {
    return mangaList.reduce((acc, m) => {
      const diff = m.latestChapter - m.currentChapter;
      return acc + (diff > 0 ? diff : 0);
    }, 0);
  }, [mangaList]);
  const nsfwCount = React.useMemo(() => mangaList.filter(isNsfwManga).length, [mangaList]);

  // Precompute shelf counts in one pass to avoid O(categories * N) loop in JSX render
  const categoryCounts = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const cat of categories) {
      const activeName = cat.name ? cat.name.toLowerCase().trim() : '';
      let c = 0;
      for (const m of mangaList) {
        const cStr = m.categories || [];
        if (cStr.includes(cat.id) || (activeName && cStr.some((s) => String(s).toLowerCase().trim() === activeName))) {
          c++;
        }
      }
      counts.set(cat.id, c);
    }
    return counts;
  }, [categories, mangaList]);

  // Helper for applying NSFW filter across library views and shelves
  const matchesNsfwFilter = React.useCallback((item: MangaItem) => {
    const isAdult = isNsfwManga(item);
    if (isGuest && isAdult) return false;
    if (nsfwFilter === 'safe' && isAdult) return false;
    if (nsfwFilter === '18+' && !isAdult) return false;
    return true;
  }, [isGuest, nsfwFilter]);

  // Spotlight items (active series / top favorites with unread or progress)
  const spotlightItems = React.useMemo(() => {
    const list = mangaList.filter(matchesNsfwFilter);
    return list.sort((a, b) => {
      const aScore = (a.lastReadAt ? new Date(a.lastReadAt).getTime() : 0) + (a.isFavorite ? 100000000000 : 0) + ((a.latestChapter - a.currentChapter > 0) ? 50000000000 : 0);
      const bScore = (b.lastReadAt ? new Date(b.lastReadAt).getTime() : 0) + (b.isFavorite ? 100000000000 : 0) + ((b.latestChapter - b.currentChapter > 0) ? 50000000000 : 0);
      return bScore - aScore;
    }).slice(0, 6);
  }, [mangaList, matchesNsfwFilter]);

  // Jump Back In items (actively in-progress reading)
  const jumpBackInItems = React.useMemo(() => {
    return mangaList
      .filter((m) => m.status === 'reading' && m.currentChapter > 0 && matchesNsfwFilter(m))
      .sort((a, b) => new Date(b.lastReadAt || 0).getTime() - new Date(a.lastReadAt || 0).getTime())
      .slice(0, 10);
  }, [mangaList, matchesNsfwFilter]);

  // Fresh releases items (latestChapter > currentChapter) - strictly adheres to NSFW safe mode
  const freshReleasesItems = React.useMemo(() => {
    return mangaList
      .filter((m) => m.latestChapter > m.currentChapter && matchesNsfwFilter(m))
      .sort((a, b) => new Date(b.lastUpdated || 0).getTime() - new Date(a.lastUpdated || 0).getTime())
      .slice(0, 12);
  }, [mangaList, matchesNsfwFilter]);

  const hasActiveFilters =
    statusFilter !== 'all' ||
    typeFilter !== 'all' ||
    nsfwFilter !== 'all' ||
    activeCategory !== null ||
    genreStates.size > 0 ||
    Boolean(searchQuery && searchQuery.trim());

  const handleResetFilters = () => {
    setStatusFilter('all');
    setTypeFilter('all');
    setNsfwFilter('all');
    setActiveCategory(null);
    setGenreStates(new Map());
  };

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
      <div className="glass-panel rounded-3xl p-4 sm:p-5 space-y-4 shadow-xl">
        {/* Row 1: Primary Status Tabs & View Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 min-w-0">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar text-xs font-semibold max-w-full pb-0.5">
            <button
              onClick={() => {
                setActiveCategory(null);
                setStatusFilter('all');
              }}
              className={`px-3.5 py-2 rounded-2xl transition-all whitespace-nowrap flex items-center gap-2 active:scale-95 cursor-pointer ${
                activeCategory === null && statusFilter === 'all'
                  ? 'bg-accent text-accent-fg font-black shadow-md shadow-accent/20'
                  : 'bg-elevated/70 text-secondary hover:bg-elevated hover:text-primary'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>All ({mangaList.length})</span>
            </button>
            <button
              onClick={() => {
                setActiveCategory(null);
                setStatusFilter('reading');
              }}
              className={`px-3.5 py-2 rounded-2xl transition-all whitespace-nowrap flex items-center gap-2 active:scale-95 cursor-pointer ${
                activeCategory === null && statusFilter === 'reading'
                  ? 'bg-accent text-accent-fg font-black shadow-md shadow-accent/20'
                  : 'bg-elevated/70 text-secondary hover:bg-elevated hover:text-primary'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Reading ({totalReading})</span>
            </button>
            <button
              onClick={() => {
                setActiveCategory(null);
                setStatusFilter('favorites');
              }}
              className={`px-3.5 py-2 rounded-2xl transition-all whitespace-nowrap flex items-center gap-2 active:scale-95 cursor-pointer ${
                activeCategory === null && statusFilter === 'favorites'
                  ? 'bg-accent text-accent-fg font-black shadow-md shadow-accent/20'
                  : 'bg-elevated/70 text-secondary hover:bg-elevated hover:text-primary'
              }`}
            >
              <Star className="w-3.5 h-3.5 fill-current" />
              <span>Favorites ({mangaList.filter((m) => m.isFavorite).length})</span>
            </button>
            <button
              onClick={() => {
                setActiveCategory(null);
                setStatusFilter('flagged');
              }}
              className={`px-3.5 py-2 rounded-2xl transition-all whitespace-nowrap flex items-center gap-2 active:scale-95 cursor-pointer ${
                activeCategory === null && statusFilter === 'flagged'
                  ? 'bg-danger text-white font-black shadow-md shadow-danger/20'
                  : 'bg-elevated/70 text-danger hover:bg-elevated'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Flagged ({mangaList.filter((m) => m.isFlagged).length})</span>
            </button>
            <button
              onClick={() => {
                setActiveCategory(null);
                setStatusFilter('completed');
              }}
              className={`px-3.5 py-2 rounded-2xl transition-all whitespace-nowrap flex items-center gap-2 active:scale-95 cursor-pointer ${
                activeCategory === null && statusFilter === 'completed'
                  ? 'bg-accent text-accent-fg font-black shadow-md shadow-accent/20'
                  : 'bg-elevated/70 text-secondary hover:bg-elevated hover:text-primary'
              }`}
            >
              <CheckCircle className="w-3.5 h-3.5" />
              <span>Completed ({totalCompleted})</span>
            </button>
          </div>

          {/* Sort & View Mode Controls */}
          <div className="flex items-center gap-2 text-xs ml-auto shrink-0">
            <button
              onClick={() => {
                setIsSelectMode(!isSelectMode);
                if (isSelectMode) setSelectedIds(new Set());
              }}
              className={`px-3 py-2 rounded-2xl font-bold transition-all flex items-center gap-1.5 border active:scale-95 cursor-pointer ${
                isSelectMode
                  ? 'bg-accent text-accent-fg border-accent shadow-md shadow-accent/20'
                  : 'bg-app/80 border-edge text-secondary hover:text-primary hover:bg-elevated'
              }`}
            >
              {isSelectMode ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
              <span>{isSelectMode ? 'Cancel' : 'Select'}</span>
            </button>

            <div className="flex items-center gap-1.5 text-secondary">
              <select
                value={sortBy}
                onChange={(e: any) => setSortBy(e.target.value)}
                className="bg-app/80 border border-edge hover:border-edge-strong rounded-2xl px-3 py-2 text-primary text-xs font-bold focus:outline-none focus:border-accent shadow-inner transition-colors"
              >
                <option value="unread">⚡ Unread Ahead</option>
                <option value="lastRead">🕒 Recently Read</option>
                <option value="updated">🔄 Updated</option>
                <option value="addedDesc">🆕 Recently Added</option>
                <option value="title">🔤 Title A-Z</option>
                <option value="rating">★ Highest Rating</option>
                <option value="chapter">📊 Progress</option>
                <option value="nsfwFirst">🔞 Adult (18+) First</option>
                <option value="sfwFirst">🛡️ Safe (SFW) First</option>
              </select>
            </div>

            <div className="flex items-center bg-app/80 border border-edge rounded-2xl p-1 shadow-inner">
              <button
                onClick={() => setViewMode('shelves')}
                className={`px-2.5 py-1.5 rounded-xl transition-all flex items-center gap-1 font-bold active:scale-95 cursor-pointer ${
                  viewMode === 'shelves' ? 'bg-accent text-accent-fg shadow-sm' : 'text-secondary hover:text-primary'
                }`}
                title="Cinematic Shelves & Spotlight Hub"
              >
                <Flame className="w-3.5 h-3.5" />
                <span className="hidden md:inline text-[11px]">Cinematic</span>
              </button>
              <button
                onClick={() => setViewMode('grid')}
                className={`px-2.5 py-1.5 rounded-xl transition-all flex items-center gap-1 font-bold active:scale-95 cursor-pointer ${
                  viewMode === 'grid' ? 'bg-accent text-accent-fg shadow-sm' : 'text-secondary hover:text-primary'
                }`}
                title="Grid View"
              >
                <Layers className="w-3.5 h-3.5" />
                <span className="hidden md:inline text-[11px]">Grid</span>
              </button>
              <button
                onClick={() => setViewMode('table')}
                className={`px-2.5 py-1.5 rounded-xl transition-all flex items-center gap-1 font-bold active:scale-95 cursor-pointer ${
                  viewMode === 'table' ? 'bg-accent text-accent-fg shadow-sm' : 'text-secondary hover:text-primary'
                }`}
                title="Table View"
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span className="hidden md:inline text-[11px]">Table</span>
              </button>
            </div>
          </div>
        </div>

        {/* Active Filters Quick Bar (Visible when any filter or search is active) */}
        {hasActiveFilters && (
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-edge/60 text-xs">
            <span className="text-muted font-bold text-[11px]">Active Filters:</span>

            {statusFilter !== 'all' && (
              <span className="px-2 py-0.5 rounded-lg bg-elevated text-primary font-bold border border-edge flex items-center gap-1">
                <span>Status: {statusFilter}</span>
                <button
                  type="button"
                  onClick={() => setStatusFilter('all')}
                  className="hover:text-danger text-muted ml-0.5 cursor-pointer"
                >
                  ✕
                </button>
              </span>
            )}

            {activeCategory && (
              <span className="px-2 py-0.5 rounded-lg bg-accent-2/15 text-accent-2 font-bold border border-accent-2/30 flex items-center gap-1">
                <span>Shelf: {categories.find((c) => c.id === activeCategory)?.name || 'Custom'}</span>
                <button
                  type="button"
                  onClick={() => setActiveCategory(null)}
                  className="hover:text-danger ml-0.5 cursor-pointer"
                >
                  ✕
                </button>
              </span>
            )}

            {typeFilter !== 'all' && (
              <span className="px-2 py-0.5 rounded-lg bg-elevated text-primary font-bold border border-edge flex items-center gap-1 uppercase">
                <span>Format: {typeFilter}</span>
                <button
                  type="button"
                  onClick={() => setTypeFilter('all')}
                  className="hover:text-danger text-muted ml-0.5 cursor-pointer"
                >
                  ✕
                </button>
              </span>
            )}

            {nsfwFilter !== 'all' && (
              <span className={`px-2 py-0.5 rounded-lg font-bold border flex items-center gap-1 ${
                nsfwFilter === 'safe'
                  ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/40'
                  : 'bg-rose-950 text-rose-300 border-rose-500/40'
              }`}>
                <span>{nsfwFilter === 'safe' ? '🛡️ Safe Mode' : '🔞 18+ Only'}</span>
                <button
                  type="button"
                  onClick={() => setNsfwFilter('all')}
                  className="hover:text-danger ml-0.5 cursor-pointer"
                >
                  ✕
                </button>
              </span>
            )}

            {genreStates.size > 0 && (
              <span className="px-2 py-0.5 rounded-lg bg-accent/15 text-accent font-bold border border-accent/30 flex items-center gap-1">
                <span>{genreStates.size} Genre Tags</span>
                <button
                  type="button"
                  onClick={() => setGenreStates(new Map())}
                  className="hover:text-danger ml-0.5 cursor-pointer"
                >
                  ✕
                </button>
              </span>
            )}

            {searchQuery && (
              <span className="px-2 py-0.5 rounded-lg bg-app text-secondary font-bold border border-edge flex items-center gap-1">
                <span>&quot;{searchQuery}&quot;</span>
              </span>
            )}

            <button
              type="button"
              onClick={handleResetFilters}
              className="ml-auto text-[11px] font-black text-danger hover:underline px-2 py-0.5 rounded bg-danger/10 hover:bg-danger/20 transition-all cursor-pointer"
            >
              Reset All Filters
            </button>
          </div>
        )}

        {/* Row 2: Dedicated Custom Shelves Ribbon */}
        <LibraryCategoryRibbon
          categories={categories}
          activeCategory={activeCategory}
          setActiveCategory={setActiveCategory}
          setStatusFilter={setStatusFilter}
          mangaList={mangaList}
          categoryCounts={categoryCounts}
          isShelvesExpanded={isShelvesExpanded}
          setIsShelvesExpanded={setIsShelvesExpanded}
          canScrollLeft={canScrollLeft}
          canScrollRight={canScrollRight}
          scrollShelves={scrollShelves}
          handleShelfWheel={handleShelfWheel}
          checkShelfScroll={checkShelfScroll}
          shelvesRef={shelvesRef}
          onOpenManageCategories={() => setIsManageCategoriesOpen(true)}
        />

        {/* Row 3 & 4: Filters Drawer */}
        <LibraryFiltersDrawer
          typeFilter={typeFilter}
          setTypeFilter={setTypeFilter}
          nsfwFilter={nsfwFilter}
          setNsfwFilter={setNsfwFilter}
          isGuest={isGuest}
          onOpenAuthModal={onOpenAuthModal}
          nsfwCount={nsfwCount}
          handleAutoTagNsfw={handleAutoTagNsfw}
          isAutoTagging={isAutoTagging}
          autoTagToast={autoTagToast}
          activeCategory={activeCategory}
          setActiveCategory={setActiveCategory}
          categories={categories}
          isGenreFilterOpen={isGenreFilterOpen}
          setIsGenreFilterOpen={setIsGenreFilterOpen}
          genreStates={genreStates}
          toggleGenreTag={toggleGenreTag}
          clearGenreTags={clearGenreTags}
          libraryGenres={libraryGenres}
        />
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
              No Manhwa or Manhua matched your current filters or search query &quot;{searchQuery}&quot;.
            </p>
          </div>
          <button
            onClick={onAddNew}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-accent text-accent-fg hover:bg-accent-bright transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Add New Series
          </button>
        </div>
      ) : viewMode === 'shelves' ? (
        /* CINEMATIC SHELVES & SPOTLIGHT VIEW */
        <div className="space-y-8 animate-fadeIn">
          {/* Hero Spotlight Carousel */}
          {!searchQuery && activeCategory === null && statusFilter === 'all' && spotlightItems.length > 0 && (
            <HeroSpotlightBanner
              items={spotlightItems}
              onOpenReader={onOpenReader}
              onSelectManga={onSelectManga}
            />
          )}

          {/* Jump Back In Shelf */}
          {!searchQuery && jumpBackInItems.length > 0 && (
            <JumpBackInShelf
              items={jumpBackInItems}
              onOpenReader={onOpenReader}
              onSelectManga={onSelectManga}
            />
          )}

          {/* Fresh Releases Shelf */}
          {!searchQuery && freshReleasesItems.length > 0 && (
            <FreshReleasesShelf
              items={freshReleasesItems}
              onOpenReader={onOpenReader}
              onSelectManga={onSelectManga}
            />
          )}

          {/* Complete Library Grid Section */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between border-b border-edge/60 pb-2">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-accent/10 text-accent border border-accent/20">
                  <Layers className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-black text-primary tracking-tight">
                    {activeCategory
                      ? `${categories.find((c) => c.id === activeCategory)?.name || 'Custom Shelf'} (${sortedList.length})`
                      : `All Series & Shelves (${sortedList.length})`}
                  </h3>
                  <p className="text-[11px] text-secondary">Browse your full library and custom categories</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-3 sm:gap-4 md:gap-5">
              {visibleList.map((manga) => (
                <MangaGridCard
                  key={manga.id}
                  manga={manga}
                  isSelectMode={isSelectMode}
                  isSelected={selectedIds.has(manga.id)}
                  isReaderAvailable={isReaderAvailable(manga)}
                  onToggleSelect={toggleSelect}
                  onSelectManga={onSelectManga}
                  onOpenReader={onOpenReader}
                  onOpenChapters={onOpenChapters}
                  onIncrementChapter={onIncrementChapter}
                  onQuickEdit={onQuickEdit}
                />
              ))}
            </div>

            {visibleLimit < sortedList.length && (
              <div ref={sentinelRef} className="py-4 text-center text-xs font-mono text-secondary">
                Loading more series ({visibleLimit} of {sortedList.length})...
              </div>
            )}
          </div>
        </div>
      ) : viewMode === 'grid' ? (
        /* STANDARD GRID VIEW */
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-3 sm:gap-4 md:gap-5">
            {visibleList.map((manga) => (
              <MangaGridCard
                key={manga.id}
                manga={manga}
                isSelectMode={isSelectMode}
                isSelected={selectedIds.has(manga.id)}
                isReaderAvailable={isReaderAvailable(manga)}
                onToggleSelect={toggleSelect}
                onSelectManga={onSelectManga}
                onOpenReader={onOpenReader}
                onOpenChapters={onOpenChapters}
                onIncrementChapter={onIncrementChapter}
                onQuickEdit={onQuickEdit}
              />
            ))}
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
                  {visibleList.map((manga) => (
                    <MangaListRow
                      key={manga.id}
                      manga={manga}
                      isSelectMode={isSelectMode}
                      isSelected={selectedIds.has(manga.id)}
                      isReaderAvailable={isReaderAvailable(manga)}
                      onToggleSelect={toggleSelect}
                      onSelectManga={onSelectManga}
                      onOpenReader={onOpenReader}
                      onOpenChapters={onOpenChapters}
                      onIncrementChapter={onIncrementChapter}
                      onQuickEdit={onQuickEdit}
                      onDeleteManga={onDeleteManga}
                    />
                  ))}
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
        <LibraryBatchBar
          selectedIds={selectedIds}
          totalCount={sortedList.length}
          categories={categories}
          onSelectAll={selectAll}
          onClearSelection={() => {
            setSelectedIds(new Set());
            setIsSelectMode(false);
          }}
          onBulkUpdateStatus={onBulkUpdateStatus}
          onBulkDelete={onBulkDelete}
          onRefreshCategories={fetchCategories}
        />
      )}

      {/* Smart AI Recommendations Section */}
      <RecommendationsView
        mangaList={mangaList}
        nsfwFilter={nsfwFilter}
        isGuest={isGuest}
        onAddRecommended={() => {
          onAddNew();
        }}
      />

      {/* Manage Categories & Shelves Modal */}
      <ManageCategoriesModal
        categories={categories}
        isOpen={isManageCategoriesOpen}
        onClose={() => setIsManageCategoriesOpen(false)}
        onCategoriesChanged={(updated) => setCategories(updated)}
      />
    </div>
  );
};
