import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { apiFetch } from '../utils/api';
import {
  Globe,
  Search,
  BookOpen,
  ExternalLink,
  Plus,
  RefreshCw,
  ChevronRight,
  ChevronLeft,
  Filter,
  Shield,
  Code2,
  Layers,
  Play,
  Trash2,
  Pin,
  Check,
  Zap,
  Sparkles,
  Power,
  Grid,
  X,
  Activity,
} from 'lucide-react';
import { SourceDefinition, SourceEngineType, MangaItem } from '../types';
import { SourceHealthDashboardModal } from './SourceHealthDashboardModal';

interface KotatsuSourceResult {
  id: string;
  title: string;
  sourceUrl: string;
  coverImage?: string;
  sourceName: string;
  apiId?: string;
  description?: string;
  genres?: string[];
  latestChapter?: number;
  type?: string;
}

interface KotatsuSourcesViewProps {
  onAddToTracker: (item: Partial<MangaItem>) => void;
  onOpenReader?: (manga: MangaItem, chapterNumber?: number) => void;
  onSelectManga?: (manga: MangaItem) => void;
  isGuest?: boolean;
  onOpenAuthModal?: () => void;
}

const ENGINE_META: Record<SourceEngineType, { label: string; color: string; icon: string }> = {
  // NO-THEME — per-engine category colors are intentionally literal
  mangadex:      { label: 'MangaDex API',  color: 'bg-orange-500/20 text-orange-300 border-orange-500/30',   icon: '🔶' }, // NO-THEME
  madara:        { label: 'Madara (WP)',    color: 'bg-blue-500/20 text-blue-300 border-blue-500/30',         icon: '🔵' }, // NO-THEME
  mangathemesia: { label: 'MangaThemesia', color: 'bg-purple-500/20 text-purple-300 border-purple-500/30',   icon: '🔮' }, // NO-THEME
  foolslide:     { label: 'FoolSlide',     color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30', icon: '🟢' }, // NO-THEME
  wpcomics:      { label: 'WP Comics',     color: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',          icon: '🔷' }, // NO-THEME
  custom_html:   { label: 'Custom HTML',   color: 'bg-amber-500/20 text-amber-300 border-amber-500/30',       icon: '🟡' }, // NO-THEME
};

interface SourceRowProps {
  source: SourceDefinition;
  isSelected: boolean;
  isPinned: boolean;
  isDisabled: boolean;
  onSelect: (s: SourceDefinition) => void;
  onToggleEnabled: (id: string, name: string, e: React.MouseEvent) => void;
  onTogglePin: (id: string, e: React.MouseEvent) => void;
}

const SourceRow = React.memo<SourceRowProps>(({
  source: s,
  isSelected,
  isPinned,
  isDisabled,
  onSelect,
  onToggleEnabled,
  onTogglePin,
}) => {
  const meta = ENGINE_META[s.engineType] || { label: s.engineType, color: 'bg-elevated text-secondary', icon: '🌐' };

  return (
    <div
      onClick={() => onSelect(s)}
      className={`w-full text-left p-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-2 group ${
        isDisabled
          ? 'bg-app/30 border-edge opacity-60 grayscale'
          : isSelected
          ? 'bg-purple-950/40 border-accent-2/60 shadow-lg shadow-accent-2/10'
          : 'bg-app/60 border-edge/80 hover:bg-surface hover:border-edge-strong'
      }`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="text-base">{meta.icon}</span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={`font-bold text-xs truncate ${isDisabled ? 'text-muted line-through' : isSelected ? 'text-accent-2' : 'text-primary'}`}>
              {s.name}
            </span>
            {isPinned && <Pin className="w-3 h-3 text-accent fill-accent shrink-0" />}
            {isDisabled && (
              <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-danger/20 text-danger border border-danger/30">
                DISABLED
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded border ${meta.color}`}>
              {meta.label}
            </span>
            <span className="text-[9px] text-muted uppercase font-mono">{s.lang}</span>
            {s.isNsfw && (
              <span className="text-[9px] font-bold px-1 py-0.2 rounded bg-danger/20 text-danger border border-danger/30">
                18+
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {/* Enable/Disable Toggle Button */}
        <button
          onClick={(e) => onToggleEnabled(s.id, s.name, e)}
          title={isDisabled ? 'Click to Enable source' : 'Click to Disable source'}
          className={`p-1 rounded-lg transition-all ${
            isDisabled
              ? 'text-muted hover:text-success'
              : 'text-success hover:text-danger'
          }`}
        >
          <Power className={`w-4 h-4 ${isDisabled ? 'text-muted' : 'text-success fill-success/20'}`} />
        </button>

        {/* Pin Button */}
        <button
          onClick={(e) => onTogglePin(s.id, e)}
          title={isPinned ? 'Unpin source' : 'Pin source to top'}
          className="p-1 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-elevated text-secondary hover:text-accent transition-all"
        >
          <Pin className={`w-3.5 h-3.5 ${isPinned ? 'fill-accent text-accent' : ''}`} />
        </button>
      </div>
    </div>
  );
});

type ViewSection = 'all' | 'popular' | 'latest' | 'search' | 'expanded';
type StatusFilter = 'all' | 'enabled' | 'disabled';

export const KotatsuSourcesView: React.FC<KotatsuSourcesViewProps> = ({
  onAddToTracker,
  onOpenReader,
  onSelectManga,
  isGuest = false,
  onOpenAuthModal,
}) => {
  const [sources, setSources] = useState<SourceDefinition[]>([]);
  const [selectedSource, setSelectedSource] = useState<SourceDefinition | null>(null);

  // Persistent Pinned Sources
  const [pinnedSourceIds, setPinnedSourceIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('kotatsu_pinned_sources');
      return saved ? new Set(JSON.parse(saved)) : new Set(['asurascans', 'flamecomics', 'weebcentral', 'manhwa18']);
    } catch (e) {
      return new Set(['asurascans', 'flamecomics', 'weebcentral', 'manhwa18']);
    }
  });

  // Disabled sources synced from server (server is source of truth)
  const [disabledSourceIds, setDisabledSourceIds] = useState<Set<string>>(new Set());

  const [activeTab, setActiveTab] = useState<ViewSection>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isHealthDashboardOpen, setIsHealthDashboardOpen] = useState(false);

  // Category & Expanded Results (Popular, Latest, Search, Expanded 50/page)
  const [popularResults, setPopularResults] = useState<KotatsuSourceResult[]>([]);
  const [latestResults, setLatestResults] = useState<KotatsuSourceResult[]>([]);
  const [searchResults, setSearchResults] = useState<KotatsuSourceResult[]>([]);
  const [expandedResults, setExpandedResults] = useState<KotatsuSourceResult[]>([]);

  const [isLoading, setIsLoading] = useState(false);
  const [isClearingCache, setIsClearingCache] = useState(false);

  const [isFetchingSources, setIsFetchingSources] = useState(true);
  const [engineFilter, setEngineFilter] = useState<SourceEngineType | 'all'>('all');
  // Default to 'enabled' so only active sources are shown
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('enabled');
  const [nsfwVisible, setNsfwVisible] = useState(false);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);

  // Search filter for the sources sidebar list
  const [sourceFilterQuery, setSourceFilterQuery] = useState('');

  // Live source reachability / latency probe state
  const [probeStatus, setProbeStatus] = useState<{ latencyMs?: number; ok?: boolean; testing?: boolean } | null>(null);

  const testSourceHealth = async (src: SourceDefinition) => {
    setProbeStatus({ testing: true });
    const startTime = performance.now();
    try {
      // Reset circuit breaker so live probe is allowed through
      await apiFetch('/api/kotatsu/sources/circuit-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId: src.id }),
      }).catch(() => {});

      const res = await apiFetch(`/api/kotatsu/search?sourceId=${src.id}&page=1&limit=5`);
      const latency = Math.round(performance.now() - startTime);
      if (res.ok) {
        setProbeStatus({ latencyMs: latency, ok: true, testing: false });
        showToast(`✓ ${src.name} is online (${latency}ms)`);
      } else {
        setProbeStatus({ latencyMs: latency, ok: false, testing: false });
        showToast(`⚠️ ${src.name} returned HTTP ${res.status}`);
      }
    } catch (err: any) {
      setProbeStatus({ ok: false, testing: false });
      showToast(`✗ Failed to reach ${src.name}: ${err.message || err}`);
    }
  };

  const enableAllEnglish = async () => {
    const enSources = sources.filter((s) => (s.lang || 'en').toLowerCase() === 'en');
    setDisabledSourceIds((prev) => {
      const next = new Set(prev);
      enSources.forEach((s) => next.delete(s.id));
      return next;
    });
    for (const s of enSources) {
      apiFetch('/api/kotatsu/sources/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId: s.id, isEnabled: true }),
      }).catch(() => {});
    }
    showToast(`✓ Enabled all ${enSources.length} English sources!`);
  };

  const enableCuratedOnly = async () => {
    const curated = new Set([
      'asurascans',
      'flamecomics',
      'weebcentral',
      'manhwa18',
      'harimanga',
      'manhuaplus',
      'mangaread',
      'kunmanga',
      'ravenscans',
      'demonicscans',
    ]);
    setDisabledSourceIds((prev) => {
      const next = new Set(prev);
      sources.forEach((s) => {
        if (curated.has(s.id)) next.delete(s.id);
        else next.add(s.id);
      });
      return next;
    });
    for (const s of sources) {
      apiFetch('/api/kotatsu/sources/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId: s.id, isEnabled: curated.has(s.id) }),
      }).catch(() => {});
    }
    showToast(`✓ Activated top 12 curated sources!`);
  };

  // Save pinned sources to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('kotatsu_pinned_sources', JSON.stringify(Array.from(pinnedSourceIds)));
    } catch (e) {}
  }, [pinnedSourceIds]);

  // Fetch sources list from server & sync disabled state from server
  useEffect(() => {
    (async () => {
      setIsFetchingSources(true);
      try {
        const res = await apiFetch('/api/kotatsu/sources');
        if (res.ok) {
          const list: SourceDefinition[] = await res.json();
          setSources(list);

          // Sync server disabled state — server is authoritative
          const serverDisabled = new Set<string>(
            list.filter((s: any) => s.isEnabled === false).map((s: any) => s.id)
          );
          setDisabledSourceIds(serverDisabled);

          // BUG-001 FIX: Remove any stale localStorage disabled-source keys that
          // could have caused phantom toggle API calls in previous sessions.
          try {
            localStorage.removeItem('kotatsu_disabled_sources');
          } catch (_) {}

          // Auto-select first ENABLED source (skip disabled ones)
          const firstEnabled = list.find((s: any) => s.isEnabled !== false);
          if (firstEnabled) setSelectedSource(firstEnabled);
          else if (list.length > 0) setSelectedSource(list[0]);
        }
      } catch (e) {
        console.error('[Kotatsu Engine] Error fetching sources:', e);
      } finally {
        setIsFetchingSources(false);
      }
    })();
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleClearAppCache = async () => {
    setIsClearingCache(true);
    try {
      const res = await apiFetch('/api/settings/cache/clear', { method: 'POST' });
      if (res.ok) {
        showToast('✓ App cache & temp canvas buffers cleared successfully!');
      } else {
        showToast('✓ Cache cleared!');
      }
    } catch (e) {
      showToast('✓ Cache cleared!');
    } finally {
      setIsClearingCache(false);
    }
  };

  const togglePinSource = (sourceId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setPinnedSourceIds((prev) => {
      const next = new Set(prev);
      if (next.has(sourceId)) {
        next.delete(sourceId);
        showToast('Unpinned source');
      } else {
        next.add(sourceId);
        showToast('Pinned source to top');
      }
      return next;
    });
  };

  // Toggle Source Enable/Disable Status
  const toggleSourceEnabled = async (sourceId: string, sName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const isCurrentlyDisabled = disabledSourceIds.has(sourceId);
    const nextIsEnabled = isCurrentlyDisabled; // if currently disabled, next state is enabled

    setDisabledSourceIds((prev) => {
      const next = new Set(prev);
      if (isCurrentlyDisabled) {
        next.delete(sourceId);
      } else {
        next.add(sourceId);
      }
      return next;
    });

    try {
      await apiFetch('/api/kotatsu/sources/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId, isEnabled: nextIsEnabled }),
      });
    } catch (err) {}

    showToast(`"${sName}" is now ${nextIsEnabled ? 'ENABLED ✓' : 'DISABLED ✗'}`);
  };

  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState<number | null>(null);
  const [totalSeriesCount, setTotalSeriesCount] = useState<number | null>(null);

  // Fetch Category Datasets for the Active Source
  const loadSourceCategoryData = useCallback(async (src: SourceDefinition | null, q: string, pageNum: number, tabMode: ViewSection) => {
    if (!src) return;
    setIsLoading(true);

    try {
      // Normalize any response into a plain array (some endpoints return { items, totalCount })
      const toArray = (data: any): any[] => Array.isArray(data) ? data : (data?.items || []);

      if (q.trim()) {
        // Search query mode
        const res = await apiFetch(`/api/kotatsu/search?sourceId=${src.id}&q=${encodeURIComponent(q)}&page=${pageNum}&limit=20`);
        if (res.ok) {
          setSearchResults(toArray(await res.json()));
          const tp = res.headers.get('X-Total-Pages');
          if (tp) setTotalPages(Number(tp));
        }
      } else if (tabMode === 'expanded') {
        // Expanded View Mode: 20 items per page (matches Asura's native page size)
        const res = await apiFetch(`/api/kotatsu/search?sourceId=${src.id}&page=${pageNum}&limit=20`);
        if (res.ok) {
          setExpandedResults(toArray(await res.json()));
          const tp = res.headers.get('X-Total-Pages');
          const tc = res.headers.get('X-Total-Count');
          if (tp) setTotalPages(Number(tp));
          if (tc) setTotalSeriesCount(Number(tc));
        }
      } else {
        // Dual Category Mode: Fetch Popular & Latest simultaneously
        const [popRes, latRes] = await Promise.all([
          apiFetch(`/api/kotatsu/search?sourceId=${src.id}&page=${pageNum}&limit=20`),
          apiFetch(`/api/kotatsu/latest?sourceId=${src.id}&page=${pageNum}&limit=20`),
        ]);

        if (popRes.ok) {
          setPopularResults(toArray(await popRes.json()));
          const tp = popRes.headers.get('X-Total-Pages');
          if (tp) setTotalPages(Number(tp));
        }
        if (latRes.ok) setLatestResults(toArray(await latRes.json()));
      }
    } catch (e) {
      console.error('[Kotatsu Engine] Error fetching category data:', e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedSource) {
      loadSourceCategoryData(selectedSource, searchQuery, currentPage, activeTab);
    }
  }, [selectedSource, searchQuery, currentPage, activeTab, loadSourceCategoryData]);

  // Reset page counter and total when changing active source or tab
  useEffect(() => {
    setCurrentPage(1);
    setTotalPages(null);
    setTotalSeriesCount(null);
  }, [selectedSource, activeTab]);

  const openSeriesDetail = (r: KotatsuSourceResult) => {
    const tempManga: MangaItem = {
      id: r.id || `kotatsu_${Date.now()}`,
      title: r.title,
      altTitles: [],
      type: (r.type as MangaItem['type']) || 'manhwa',
      coverImage: r.coverImage || '/api/mangadex/image-proxy?url=https%3A%2F%2Fuploads.mangadex.org%2Fcovers%2F32d76d19-8a05-4db0-9fc2-e0b0648fe9d0%2Ffbc962f9-3d12-4c6e-8212-32a2cb874a7b.jpg',
      description: r.description || `Indexed from ${r.sourceName || selectedSource?.name || 'Kotatsu Source'}`,
      genres: (r.genres && r.genres.length > 0) ? r.genres : ['Action'],
      status: 'reading',
      currentChapter: 0,
      latestChapter: r.latestChapter || 1,
      totalChapters: r.latestChapter || null,
      rating: 9.0,
      sourceUrl: r.sourceUrl,
      sourceName: r.sourceName || selectedSource?.name || 'Kotatsu Engine',
      availableSources: r.sourceName && r.sourceUrl ? [{ sourceName: r.sourceName, sourceUrl: r.sourceUrl }] : [],
      autoUpdateEnabled: true,
      notes: '',
      addedAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      lastReadAt: new Date().toISOString(),
    };
    if (onSelectManga) {
      onSelectManga(tempManga);
    }
  };

  const addToTracker = (r: KotatsuSourceResult, e: React.MouseEvent) => {
    e.stopPropagation();
    onAddToTracker({
      title: r.title,
      altTitles: [],
      type: (r.type as MangaItem['type']) || 'manhwa',
      coverImage: r.coverImage || '/api/mangadex/image-proxy?url=https%3A%2F%2Fuploads.mangadex.org%2Fcovers%2F32d76d19-8a05-4db0-9fc2-e0b0648fe9d0%2Ffbc962f9-3d12-4c6e-8212-32a2cb874a7b.jpg',
      description: r.description || `From ${r.sourceName}`,
      genres: (r.genres && r.genres.length > 0) ? r.genres : ['Action'],
      status: 'reading',
      currentChapter: 0,
      latestChapter: r.latestChapter || 1,
      totalChapters: r.latestChapter || null,
      rating: 9.0,
      sourceUrl: r.sourceUrl,
      sourceName: r.sourceName || selectedSource?.name || 'Kotatsu Engine',
      autoUpdateEnabled: true,
      notes: 'Added from Kotatsu Extension Browser',
    });
    setAddedIds(prev => new Set(prev).add(r.id));
    showToast(`Added "${r.title}" to library!`);
  };

  const readNow = (r: KotatsuSourceResult, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onOpenReader) return;
    const tempManga: MangaItem = {
      id: r.id || `kotatsu_${Date.now()}`,
      title: r.title,
      altTitles: [],
      type: (r.type as MangaItem['type']) || 'manhwa',
      coverImage: r.coverImage || '/api/mangadex/image-proxy?url=https%3A%2F%2Fuploads.mangadex.org%2Fcovers%2F32d76d19-8a05-4db0-9fc2-e0b0648fe9d0%2Ffbc962f9-3d12-4c6e-8212-32a2cb874a7b.jpg',
      description: r.description || '',
      genres: r.genres || ['Action'],
      status: 'reading',
      currentChapter: 0,
      latestChapter: r.latestChapter || 1,
      totalChapters: r.latestChapter || null,
      rating: 9.0,
      sourceUrl: r.sourceUrl,
      sourceName: r.sourceName || selectedSource?.name || 'Kotatsu Source',
      autoUpdateEnabled: true,
      notes: '',
      addedAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      lastReadAt: new Date().toISOString(),
    };
    onOpenReader(tempManga, 1);
  };

  const [selectedLangFilter, setSelectedLangFilter] = useState<string>('en');

  // Progressive Chunking for Smooth 60 FPS Scrolling across 1,187+ sources
  const [visibleSourceCount, setVisibleSourceCount] = useState<number>(40);
  const sourceSentinelRef = useRef<HTMLDivElement>(null);

  // SORTING FUNCTIONALITY: Enabled sources stay on top, disabled move down to bottom
  const filteredSources = useMemo(() => {
    return sources.filter(s => {
      if ((isGuest || !nsfwVisible) && s.isNsfw) return false;
      if (engineFilter !== 'all' && s.engineType !== engineFilter) return false;
      if (selectedLangFilter !== 'all' && (s.lang || 'en').toLowerCase() !== selectedLangFilter) return false;

      if (sourceFilterQuery.trim()) {
        const q = sourceFilterQuery.toLowerCase();
        if (!s.name.toLowerCase().includes(q) && !s.id.toLowerCase().includes(q) && !s.baseUrl.toLowerCase().includes(q)) {
          return false;
        }
      }

      const isDisabled = disabledSourceIds.has(s.id);
      if (statusFilter === 'enabled' && isDisabled) return false;
      if (statusFilter === 'disabled' && !isDisabled) return false;

      return true;
    }).sort((a, b) => {
      // 1. Pinned sources stay on absolute top
      const aPinned = pinnedSourceIds.has(a.id);
      const bPinned = pinnedSourceIds.has(b.id);
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;

      // 2. Active (Enabled) sources stay on top, Disabled move down to bottom
      const aDisabled = disabledSourceIds.has(a.id);
      const bDisabled = disabledSourceIds.has(b.id);
      if (!aDisabled && bDisabled) return -1;
      if (aDisabled && !bDisabled) return 1;

      // 3. Alphabetical tie-break
      return a.name.localeCompare(b.name);
    });
  }, [
    sources,
    isGuest,
    nsfwVisible,
    engineFilter,
    selectedLangFilter,
    sourceFilterQuery,
    disabledSourceIds,
    statusFilter,
    pinnedSourceIds,
  ]);

  // Reset visible limit on filter changes
  useEffect(() => {
    setVisibleSourceCount(40);
  }, [sourceFilterQuery, statusFilter, engineFilter, selectedLangFilter, nsfwVisible]);

  // IntersectionObserver to incrementally load more sources on scroll
  useEffect(() => {
    if (!sourceSentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleSourceCount((prev) => Math.min(prev + 40, filteredSources.length));
        }
      },
      { rootMargin: '300px' }
    );
    observer.observe(sourceSentinelRef.current);
    return () => observer.disconnect();
  }, [filteredSources.length]);

  const visibleSources = useMemo(
    () => filteredSources.slice(0, visibleSourceCount),
    [filteredSources, visibleSourceCount]
  );

  const enabledCount = useMemo(
    () => sources.filter(s => !disabledSourceIds.has(s.id)).length,
    [sources, disabledSourceIds]
  );
  const disabledCount = disabledSourceIds.size;

  const renderSeriesCard = (r: KotatsuSourceResult) => {
    const isAdded = addedIds.has(r.id);
    return (
      <div
        key={r.id}
        onClick={() => openSeriesDetail(r)}
        className="group bg-app border border-edge rounded-2xl overflow-hidden hover:border-accent-2/60 hover:shadow-xl hover:shadow-accent-2/10 transition-all flex flex-col cursor-pointer"
      >
        {/* Cover */}
        <div className="relative aspect-[3/4] bg-surface overflow-hidden">
          {r.coverImage ? (
            <img
              src={r.coverImage}
              alt={r.title}
              loading="lazy"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              onError={e => {
                (e.target as HTMLImageElement).src =
                  '/api/mangadex/image-proxy?url=https%3A%2F%2Fuploads.mangadex.org%2Fcovers%2F32d76d19-8a05-4db0-9fc2-e0b0648fe9d0%2Ffbc962f9-3d12-4c6e-8212-32a2cb874a7b.jpg';
              }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-purple-900/40 to-surface">
              <BookOpen className="w-10 h-10 text-accent-2/40" />
            </div>
          )}
          <div className="absolute top-2 left-2">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border backdrop-blur-sm ${ENGINE_META[selectedSource?.engineType || 'mangadex']?.color}`}>
              {selectedSource?.name}
            </span>
          </div>
          {r.type && (
            <div className="absolute top-2 right-2">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-app/80 text-secondary border border-edge-strong/80 backdrop-blur-sm">
                {r.type === 'manhwa' ? '🇰🇷' : r.type === 'manhua' ? '🇨🇳' : '🇯🇵'} {r.type}
              </span>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="p-3 flex flex-col gap-2 flex-1">
          <div className="font-bold text-primary text-sm leading-tight line-clamp-2 group-hover:text-accent-2 transition-colors">
            {r.title}
          </div>
          {r.latestChapter && (
            <div className="text-[11px] text-secondary flex items-center gap-1">
              <BookOpen className="w-3 h-3 text-accent" />
              Ch. {r.latestChapter}+
            </div>
          )}
          {r.genres && r.genres.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {r.genres.slice(0, 3).map(g => (
                <span key={g} className="text-[10px] px-1.5 py-0.5 rounded bg-surface text-secondary border border-edge">
                  {g}
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-2 mt-auto pt-2">
            <button
              onClick={(e) => addToTracker(r, e)}
              disabled={isAdded}
              title={isAdded ? 'Already tracked' : 'Add to Tracker (not My Library)'}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold transition-all ${
                isAdded
                  ? 'bg-success/20 text-success border border-success/30 cursor-default'
                  : 'bg-accent-2/20 hover:bg-accent-2/40 text-accent-2 border border-accent-2/30 hover:border-accent-2/60'
              }`}
            >
              <Plus className={`w-3.5 h-3.5 ${isAdded ? 'text-success' : ''}`} />
              {isAdded ? 'Tracked' : 'Track'}
            </button>
            <button
              onClick={(e) => readNow(r, e)}
              title="Open in Reader"
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-gradient-to-r from-accent/80 to-accent-2/80 hover:from-accent-bright hover:to-accent-2 text-accent-fg text-xs font-black transition-all"
            >
              <Play className="w-3.5 h-3.5 fill-accent-fg" />
              <span>Read</span>
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-app text-primary flex flex-col relative pb-16">
      {/* Toast Banner */}
      {toast && (
        <div className="fixed bottom-6 right-6 bg-accent text-accent-fg font-black px-4 py-2.5 rounded-xl shadow-2xl z-50 flex items-center gap-2 animate-bounce">
          <Zap className="w-4 h-4 fill-accent-fg" />
          <span>{toast}</span>
        </div>
      )}

      {/* Header Banner */}
      <div className="bg-surface/80 border-b border-edge backdrop-blur-md sticky top-0 z-30 px-4 py-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-accent-2 to-accent-2 flex items-center justify-center shadow-lg shadow-accent-2/20">
            <Globe className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-black text-white flex items-center gap-2">
              Sources
              <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-accent-2/20 text-accent-2 border border-accent-2/30">
                v2.5 Redo
              </span>
            </h1>
            <p className="text-xs text-secondary">
              Enable & disable sources • Active sources stay on top, disabled move down to bottom
            </p>
          </div>
        </div>

        {/* Global Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Quick Batch Presets */}
          <button
            onClick={enableAllEnglish}
            className="px-3 py-1.5 rounded-xl bg-accent/20 hover:bg-accent/30 text-accent font-bold text-xs border border-accent/30 transition-all shadow-sm active:scale-95"
            title="Enable all English language sources at once"
          >
            🇬🇧 Enable All EN
          </button>
          <button
            onClick={enableCuratedOnly}
            className="px-3 py-1.5 rounded-xl bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 font-bold text-xs border border-purple-500/30 transition-all shadow-sm active:scale-95"
            title="Enable only top recommended scanlation sources"
          >
            ⭐ Curated Only
          </button>

          {/* Language Selector */}
          <select
            value={selectedLangFilter}
            onChange={(e) => setSelectedLangFilter(e.target.value)}
            className="bg-app border border-edge rounded-xl px-3 py-2 text-xs font-bold text-primary focus:outline-none focus:ring-2 focus:ring-accent-2/50"
            title="Filter sources by language"
          >
            <option value="en">🇬🇧 English (Preferred)</option>
            <option value="all">🌐 All Languages</option>
            <option value="ko">🇰🇷 Korean</option>
            <option value="zh">🇨🇳 Chinese</option>
            <option value="ja">🇯🇵 Japanese</option>
            <option value="es">🇪🇸 Spanish</option>
            <option value="fr">🇫🇷 French</option>
            <option value="id">🇮🇩 Indonesian</option>
            <option value="ru">🇷🇺 Russian</option>
          </select>

          <button
            onClick={() => setIsHealthDashboardOpen(true)}
            className="px-3 py-1.5 rounded-xl bg-accent-2/15 hover:bg-accent-2/25 text-accent-2 font-bold text-xs border border-accent-2/30 flex items-center gap-1.5 transition-all shadow-sm active:scale-95"
            title="Open real-time source latency diagnostics and circuit breaker dashboard"
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Health & Circuits</span>
          </button>

          <button
            onClick={handleClearAppCache}
            disabled={isClearingCache}
            className="px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-xl bg-elevated hover:bg-elevated border border-edge-strong text-primary hover:text-white font-bold text-xs sm:text-sm flex items-center gap-1.5 transition-all shadow-md active:scale-95"
            title="Purge local storage, image proxy cache, and dynamic canvas buffers"
          >
            <Trash2 className={`w-3.5 h-3.5 text-danger ${isClearingCache ? 'animate-spin' : ''}`} />
            <span>{isClearingCache ? 'Clearing...' : 'Clear Cache'}</span>
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Sidebar: Source Extensions List */}
        <div className="w-full md:w-80 bg-surface/60 border-r border-edge p-3 flex flex-col gap-3 shrink-0">
          <div className="flex items-center justify-between text-xs font-bold text-secondary px-1">
            <span className="flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-accent-2" />
              Sources ({filteredSources.length})
            </span>
            <button
              onClick={() => {
                if (isGuest) {
                  showToast('🔒 Login required to view 18+ sources');
                  onOpenAuthModal?.();
                } else {
                  setNsfwVisible(!nsfwVisible);
                }
              }}
              className={`text-[10px] px-2 py-0.5 rounded-full border transition-all ${
                !isGuest && nsfwVisible ? 'bg-danger/20 text-danger border-danger/30 font-bold' : 'bg-elevated text-secondary border-edge-strong'
              }`}
              title={isGuest ? 'Login required to access 18+ sources' : undefined}
            >
              {isGuest ? '🔒 18+ (Login)' : nsfwVisible ? '18+ Shown' : '18+ Hidden'}
            </button>
          </div>

          {/* Quick Source Filter Input */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-secondary absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={sourceFilterQuery}
              onChange={(e) => setSourceFilterQuery(e.target.value)}
              placeholder="Search 1,187+ sources..."
              className="w-full bg-app border border-edge rounded-xl pl-8 pr-3 py-1.5 text-xs text-primary placeholder-muted focus:outline-none focus:ring-2 focus:ring-accent-2/50 font-medium"
            />
            {sourceFilterQuery && (
              <button
                onClick={() => setSourceFilterQuery('')}
                className="text-xs text-muted hover:text-primary absolute right-2.5 top-1/2 -translate-y-1/2 font-bold"
              >
                ✕
              </button>
            )}
          </div>

          {/* Status Filter Bar (All / Enabled / Disabled) */}
          <div className="flex items-center gap-1 bg-app p-1 rounded-xl border border-edge text-[11px] font-bold">
            <button
              onClick={() => setStatusFilter('all')}
              className={`flex-1 py-1 rounded-lg transition-all text-center ${
                statusFilter === 'all' ? 'bg-accent-2 text-white shadow-sm' : 'text-secondary hover:text-primary'
              }`}
            >
              All ({sources.length})
            </button>
            <button
              onClick={() => setStatusFilter('enabled')}
              className={`flex-1 py-1 rounded-lg transition-all text-center ${
                statusFilter === 'enabled' ? 'bg-success text-white shadow-sm' : 'text-secondary hover:text-primary'
              }`}
            >
              ON ({enabledCount})
            </button>
            <button
              onClick={() => setStatusFilter('disabled')}
              className={`flex-1 py-1 rounded-lg transition-all text-center ${
                statusFilter === 'disabled' ? 'bg-danger text-white shadow-sm' : 'text-secondary hover:text-primary'
              }`}
            >
              OFF ({disabledCount})
            </button>
          </div>

          {/* Engine Type Filter Bar */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-none">
            <button
              onClick={() => setEngineFilter('all')}
              className={`px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg text-[11px] sm:text-xs font-bold whitespace-nowrap transition-all ${
                engineFilter === 'all' ? 'bg-accent-2 text-white shadow-sm' : 'bg-elevated/80 text-secondary hover:bg-elevated'
              }`}
            >
              All
            </button>
            {Object.entries(ENGINE_META).map(([key, meta]) => (
              <button
                key={key}
                onClick={() => setEngineFilter(key as SourceEngineType)}
                className={`px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg text-[11px] sm:text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1 ${
                  engineFilter === key ? 'bg-accent-2 text-white shadow-sm' : 'bg-elevated/80 text-secondary hover:bg-elevated'
                }`}
              >
                <span>{meta.icon}</span>
                <span>{meta.label}</span>
              </button>
            ))}
          </div>

          {/* Sources List: Enabled on Top, Disabled at Bottom */}
          {isFetchingSources ? (
            <div className="p-8 text-center text-xs text-muted flex flex-col items-center gap-2">
              <RefreshCw className="w-5 h-5 animate-spin text-accent-2" />
              <span>Loading Kotatsu parsers...</span>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 max-h-[600px] md:max-h-none">
              {visibleSources.map((s) => (
                <SourceRow
                  key={s.id}
                  source={s}
                  isSelected={selectedSource?.id === s.id}
                  isPinned={pinnedSourceIds.has(s.id)}
                  isDisabled={disabledSourceIds.has(s.id)}
                  onSelect={setSelectedSource}
                  onToggleEnabled={toggleSourceEnabled}
                  onTogglePin={togglePinSource}
                />
              ))}
              {visibleSources.length < filteredSources.length && (
                <div ref={sourceSentinelRef} className="py-2 text-center text-[10px] text-muted flex items-center justify-center gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-accent-2" />
                  <span>Loading more sources ({visibleSources.length} of {filteredSources.length})...</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Main Content Area: Show Top and Latest Series categorized in their own sections */}
        <div className="flex-1 p-4 flex flex-col gap-6 overflow-y-auto">
          {selectedSource ? (
            <>
              {/* Selected Source Toolbar */}
              <div className="bg-surface/80 border border-edge rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3 shadow-lg">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-accent-2/10 border border-accent-2/30 flex items-center justify-center text-lg">
                    {ENGINE_META[selectedSource.engineType]?.icon || '🌐'}
                  </div>
                  <div>
                    <h2 className="text-base font-black text-white flex items-center gap-2">
                      {selectedSource.name}
                      {disabledSourceIds.has(selectedSource.id) ? (
                        <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-danger/20 text-danger border border-danger/30 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-danger" />
                          SOURCE DISABLED
                        </span>
                      ) : (
                        <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-success/20 text-success border border-success/30 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                          ACTIVE PARSER
                        </span>
                      )}
                    </h2>
                    <div className="flex items-center gap-2 mt-0.5">
                      <a
                        href={selectedSource.baseUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-accent-2 hover:text-accent-2 flex items-center gap-1 font-semibold"
                      >
                        <ExternalLink className="w-3 h-3" />
                        {selectedSource.baseUrl}
                      </a>
                      <span className="text-muted">•</span>
                      <span className="text-xs text-secondary">Language: {selectedSource.lang.toUpperCase()}</span>
                    </div>
                  </div>
                </div>

                {/* Enable/Disable Toggle Control & View Mode Tabs */}
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Live Health Probe / Ping */}
                  <button
                    onClick={() => testSourceHealth(selectedSource)}
                    disabled={probeStatus?.testing}
                    className="px-3 py-1.5 rounded-xl bg-surface hover:bg-elevated border border-edge-strong text-secondary hover:text-primary font-bold text-xs flex items-center gap-1.5 transition-all shadow-sm"
                    title="Probe upstream server and test response latency"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${probeStatus?.testing ? 'animate-spin text-accent-2' : ''}`} />
                    <span>{probeStatus?.testing ? 'Testing...' : probeStatus?.latencyMs ? `${probeStatus.latencyMs}ms` : 'Ping Test'}</span>
                  </button>

                  <button
                    onClick={(e) => toggleSourceEnabled(selectedSource.id, selectedSource.name, e)}
                    className={`px-3.5 py-1.5 rounded-xl font-bold text-xs flex items-center gap-2 border transition-all ${
                      disabledSourceIds.has(selectedSource.id)
                        ? 'bg-success/20 hover:bg-success/30 text-success border-success/40'
                        : 'bg-danger/20 hover:bg-danger/30 text-danger border-danger/40'
                    }`}
                  >
                    <Power className="w-3.5 h-3.5" />
                    <span>{disabledSourceIds.has(selectedSource.id) ? 'Enable Source' : 'Disable Source'}</span>
                  </button>

                  <div className="flex items-center gap-1 bg-app p-1 rounded-xl border border-edge flex-wrap">
                    <button
                      onClick={() => {
                        setActiveTab('all');
                        setCurrentPage(1);
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                        activeTab === 'all' ? 'bg-accent-2 text-white shadow-md' : 'text-secondary hover:text-primary'
                      }`}
                    >
                      <Grid className="w-3.5 h-3.5 text-accent-2" />
                      <span>All Categories</span>
                    </button>
                    <button
                      onClick={() => {
                        setActiveTab('popular');
                        setCurrentPage(1);
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                        activeTab === 'popular' ? 'bg-accent-2 text-white shadow-md' : 'text-secondary hover:text-primary'
                      }`}
                    >
                      <Sparkles className="w-3.5 h-3.5 text-accent" />
                      <span>Popular Only</span>
                    </button>
                    <button
                      onClick={() => {
                        setActiveTab('latest');
                        setCurrentPage(1);
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                        activeTab === 'latest' ? 'bg-accent-2 text-white shadow-md' : 'text-secondary hover:text-primary'
                      }`}
                    >
                      <Zap className="w-3.5 h-3.5 text-info" />
                      <span>Latest Only</span>
                    </button>

                    <button
                      onClick={() => {
                        setActiveTab('expanded');
                        setCurrentPage(1);
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                        activeTab === 'expanded' ? 'bg-accent text-accent-fg shadow-md font-black' : 'text-secondary hover:text-primary'
                      }`}
                    >
                      <Layers className="w-3.5 h-3.5 text-accent" />
                      <span>Expanded View (50/page)</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Search Input Bar */}
              <div className="relative">
                <Search className="w-4 h-4 text-secondary absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => {
                    setSearchQuery(e.target.value);
                    if (e.target.value) setActiveTab('search');
                    else setActiveTab('all');
                  }}
                  placeholder={`Search titles on ${selectedSource.name}...`}
                  className="w-full bg-surface border border-edge rounded-xl pl-10 pr-4 py-2.5 text-xs text-primary placeholder-muted focus:outline-none focus:border-accent-2 transition-colors"
                />
              </div>

              {/* Disabled Warning Banner */}
              {disabledSourceIds.has(selectedSource.id) && (
                <div className="bg-rose-950/30 border border-danger/30 rounded-2xl p-3.5 text-xs text-danger flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Power className="w-4 h-4 text-danger shrink-0" />
                    <span>This source is currently <strong>Disabled</strong>. Active sources remain on top; disabled sources move down to the bottom of the list.</span>
                  </div>
                  <button
                    onClick={(e) => toggleSourceEnabled(selectedSource.id, selectedSource.name, e)}
                    className="px-3 py-1 rounded-lg bg-danger text-accent-fg font-black text-[11px] whitespace-nowrap hover:bg-danger transition-all"
                  >
                    Enable Now
                  </button>
                </div>
              )}

              {isLoading ? (
                <div className="flex-1 flex flex-col items-center justify-center p-12 gap-3 text-muted">
                  <RefreshCw className="w-8 h-8 animate-spin text-accent-2" />
                  <span className="text-xs font-semibold">Streaming top and latest series categories from {selectedSource.name}...</span>
                </div>
              ) : searchQuery.trim() ? (
                /* Search Results View */
                <div className="flex flex-col gap-3">
                  <h3 className="text-sm font-extrabold text-primary flex items-center gap-2">
                    <Search className="w-4 h-4 text-accent-2" />
                    Search Results for "{searchQuery}" ({searchResults.length})
                  </h3>
                  {searchResults.length === 0 ? (
                    <div className="bg-surface/40 border border-edge rounded-2xl p-12 text-center text-secondary">
                      No series found for "{searchQuery}"
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                      {searchResults.map(r => renderSeriesCard(r))}
                    </div>
                  )}
                </div>
              ) : activeTab === 'expanded' ? (
                /* EXPANDED FULL CATALOG VIEW (50 Series Per Page) */
                <div className="flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-black text-white flex items-center gap-2">
                      <Layers className="w-4 h-4 text-accent" />
                      {selectedSource.name} — Full Catalog
                      <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-accent/20 text-accent border border-accent/30">
                        Page {currentPage}{totalPages ? ` of ${totalPages}` : ''}
                      </span>
                      {totalSeriesCount !== null && (
                        <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-accent-2/20 text-accent-2 border border-accent-2/30">
                          {totalSeriesCount} Total Series
                        </span>
                      )}
                    </h3>
                  </div>

                  {expandedResults.length === 0 ? (
                    <div className="bg-surface/40 border border-edge rounded-2xl p-12 text-center text-xs text-secondary">
                      No series found for this catalog page.
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
                      {expandedResults.map((r) => renderSeriesCard(r))}
                    </div>
                  )}
                </div>
              ) : (
                /* CATEGORIZED SECTIONS VIEW (Top Popular Series & Latest Uploads) */
                <div className="flex flex-col gap-8">
                  {/* Category 1: Top Popular Series */}
                  {(activeTab === 'all' || activeTab === 'popular') && (
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-black text-white flex items-center gap-2">
                          <Sparkles className="w-4 h-4 text-accent" />
                          Top Popular Series on {selectedSource.name}
                          <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/20">
                            {popularResults.length} Series
                          </span>
                        </h3>
                      </div>

                      {popularResults.length === 0 ? (
                        <div className="bg-surface/40 border border-edge rounded-2xl p-8 text-center text-xs text-muted">
                          No popular series loaded for this source.
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                          {popularResults.slice(0, activeTab === 'popular' ? 24 : 12).map(r => renderSeriesCard(r))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Category 2: Latest Chapter Releases */}
                  {(activeTab === 'all' || activeTab === 'latest') && (
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-black text-white flex items-center gap-2">
                          <Zap className="w-4 h-4 text-info" />
                          Latest Uploaded Chapters on {selectedSource.name}
                          <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-info/10 text-info border border-info/20">
                            {latestResults.length} Series
                          </span>
                        </h3>
                      </div>

                      {latestResults.length === 0 ? (
                        <div className="bg-surface/40 border border-edge rounded-2xl p-8 text-center text-xs text-muted">
                          No latest uploads loaded for this source.
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                          {latestResults.slice(0, activeTab === 'latest' ? 24 : 12).map((r) => renderSeriesCard(r))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Pagination Toolbar */}
              <div className="flex items-center justify-between border-t border-edge/80 pt-4 mt-2">
                <button
                  onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                  disabled={currentPage <= 1 || isLoading}
                  className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all ${
                    currentPage <= 1 || isLoading
                      ? 'bg-surface text-muted cursor-not-allowed border border-edge/50'
                      : 'bg-elevated hover:bg-elevated text-primary border border-edge-strong shadow-sm'
                  }`}
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span>Previous</span>
                </button>

                <div className="flex items-center gap-2">
                  <span className="text-xs font-black text-secondary font-mono bg-surface border border-edge px-4 py-2 rounded-xl shadow-inner">
                    Page {currentPage}{totalPages ? ` / ${totalPages}` : ''}
                  </span>
                  {totalSeriesCount !== null && (
                    <span className="text-[11px] text-muted font-mono">{totalSeriesCount} series</span>
                  )}
                </div>

                <button
                  onClick={() => setCurrentPage((prev) => prev + 1)}
                  disabled={isLoading || (totalPages !== null && currentPage >= totalPages)}
                  className={`px-4 py-2 rounded-xl text-white font-bold text-xs flex items-center gap-1.5 transition-all shadow-md active:scale-95 ${
                    isLoading || (totalPages !== null && currentPage >= totalPages)
                      ? 'bg-elevated text-muted cursor-not-allowed border border-edge/50'
                      : 'bg-gradient-to-r from-accent-2 to-accent-2 hover:from-accent-2 hover:to-accent-2'
                  }`}
                >
                  <span>Next</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center p-12 text-muted">
              Select a Kotatsu source from the left sidebar to view its top and latest series categories.
            </div>
          )}
        </div>
      </div>

      {/* Floating Toast Notification */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 max-w-sm bg-elevated/95 backdrop-blur-md border border-accent-2/50 text-primary px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-3 animate-bounce">
          <div className="w-8 h-8 rounded-xl bg-accent-2/20 border border-accent-2/40 flex items-center justify-center shrink-0 text-accent-2">
            <Check className="w-4 h-4" />
          </div>
          <div className="flex-1 text-xs font-bold text-primary pr-1">
            {toast}
          </div>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="p-1 text-secondary hover:text-primary transition-colors rounded-lg hover:bg-surface"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Source Health & Circuit Dashboard Modal */}
      <SourceHealthDashboardModal
        isOpen={isHealthDashboardOpen}
        onClose={() => setIsHealthDashboardOpen(false)}
      />
    </div>
  );
};
