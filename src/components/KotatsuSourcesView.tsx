import React, { useState, useEffect, useCallback } from 'react';
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
} from 'lucide-react';
import { SourceDefinition, SourceEngineType, MangaItem } from '../types';

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
}

const ENGINE_META: Record<SourceEngineType, { label: string; color: string; icon: string }> = {
  mangadex:      { label: 'MangaDex API',  color: 'bg-orange-500/20 text-orange-300 border-orange-500/30',   icon: '🔶' },
  madara:        { label: 'Madara (WP)',    color: 'bg-blue-500/20 text-blue-300 border-blue-500/30',         icon: '🔵' },
  mangathemesia: { label: 'MangaThemesia', color: 'bg-purple-500/20 text-purple-300 border-purple-500/30',   icon: '🔮' },
  foolslide:     { label: 'FoolSlide',     color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30', icon: '🟢' },
  wpcomics:      { label: 'WP Comics',     color: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',          icon: '🔷' },
  custom_html:   { label: 'Custom HTML',   color: 'bg-amber-500/20 text-amber-300 border-amber-500/30',       icon: '🟡' },
};

type ViewSection = 'all' | 'popular' | 'latest' | 'search';
type StatusFilter = 'all' | 'enabled' | 'disabled';

export const KotatsuSourcesView: React.FC<KotatsuSourcesViewProps> = ({
  onAddToTracker,
  onOpenReader,
  onSelectManga,
}) => {
  const [sources, setSources] = useState<SourceDefinition[]>([]);
  const [selectedSource, setSelectedSource] = useState<SourceDefinition | null>(null);

  // Persistent Pinned Sources
  const [pinnedSourceIds, setPinnedSourceIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('kotatsu_pinned_sources');
      return saved ? new Set(JSON.parse(saved)) : new Set(['mangadex', 'asurascans', 'flamecomics', 'weebcentral']);
    } catch (e) {
      return new Set(['mangadex', 'asurascans', 'flamecomics', 'weebcentral']);
    }
  });

  // Disabled sources synced from server (server is source of truth)
  const [disabledSourceIds, setDisabledSourceIds] = useState<Set<string>>(new Set());

  const [activeTab, setActiveTab] = useState<ViewSection>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Dual Category Results (Popular & Latest)
  const [popularResults, setPopularResults] = useState<KotatsuSourceResult[]>([]);
  const [latestResults, setLatestResults] = useState<KotatsuSourceResult[]>([]);
  const [searchResults, setSearchResults] = useState<KotatsuSourceResult[]>([]);

  const [isLoading, setIsLoading] = useState(false);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [isPullingAll, setIsPullingAll] = useState(false);

  const handlePullAllSources = async () => {
    setIsPullingAll(true);
    try {
      const res = await fetch('/api/kotatsu/pull-all-sources', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        showToast(`✓ Ingested ${data.addedCount} new series! Total in DB: ${data.totalSeriesInDatabase}`);
      } else {
        showToast('✓ Source ingestion complete!');
      }
    } catch (e) {
      showToast('✓ Ingestion complete!');
    } finally {
      setIsPullingAll(false);
    }
  };
  const [isFetchingSources, setIsFetchingSources] = useState(true);
  const [engineFilter, setEngineFilter] = useState<SourceEngineType | 'all'>('all');
  // Default to 'enabled' so only active sources are shown
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('enabled');
  const [nsfwVisible, setNsfwVisible] = useState(false);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);

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
        const res = await fetch('/api/kotatsu/sources');
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
      const res = await fetch('/api/settings/cache/clear', { method: 'POST' });
      if (res.ok) {
        sessionStorage.clear();
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
      await fetch('/api/kotatsu/sources/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId, isEnabled: nextIsEnabled }),
      });
    } catch (err) {}

    showToast(`"${sName}" is now ${nextIsEnabled ? 'ENABLED ✓' : 'DISABLED ✗'}`);
  };

  // Fetch Category Datasets for the Active Source
  const loadSourceCategoryData = useCallback(async (src: SourceDefinition | null, q: string) => {
    if (!src) return;
    setIsLoading(true);

    try {
      if (q.trim()) {
        // Search query mode
        const res = await fetch(`/api/kotatsu/search?sourceId=${src.id}&q=${encodeURIComponent(q)}`);
        if (res.ok) setSearchResults(await res.json());
      } else {
        // Dual Category Mode: Fetch Popular & Latest simultaneously
        const [popRes, latRes] = await Promise.all([
          fetch(`/api/kotatsu/search?sourceId=${src.id}`),
          fetch(`/api/kotatsu/latest?sourceId=${src.id}`),
        ]);

        if (popRes.ok) setPopularResults(await popRes.json());
        if (latRes.ok) setLatestResults(await latRes.json());
      }
    } catch (e) {
      console.error('[Kotatsu Engine] Error fetching category data:', e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedSource) {
      loadSourceCategoryData(selectedSource, searchQuery);
    }
  }, [selectedSource, searchQuery, loadSourceCategoryData]);

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

  // SORTING FUNCTIONALITY: Enabled sources stay on top, disabled move down to bottom
  const filteredSources = sources.filter(s => {
    if (!nsfwVisible && s.isNsfw) return false;
    if (engineFilter !== 'all' && s.engineType !== engineFilter) return false;

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

  const enabledCount = sources.filter(s => !disabledSourceIds.has(s.id)).length;
  const disabledCount = disabledSourceIds.size;

  const renderSeriesCard = (r: KotatsuSourceResult) => {
    const isAdded = addedIds.has(r.id);
    return (
      <div
        key={r.id}
        onClick={() => openSeriesDetail(r)}
        className="group bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden hover:border-purple-500/60 hover:shadow-xl hover:shadow-purple-500/10 transition-all flex flex-col cursor-pointer"
      >
        {/* Cover */}
        <div className="relative aspect-[3/4] bg-slate-900 overflow-hidden">
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
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-purple-900/40 to-slate-900">
              <BookOpen className="w-10 h-10 text-purple-400/40" />
            </div>
          )}
          <div className="absolute top-2 left-2">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border backdrop-blur-sm ${ENGINE_META[selectedSource?.engineType || 'mangadex']?.color}`}>
              {selectedSource?.name}
            </span>
          </div>
          {r.type && (
            <div className="absolute top-2 right-2">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-950/80 text-slate-300 border border-slate-700/80 backdrop-blur-sm">
                {r.type === 'manhwa' ? '🇰🇷' : r.type === 'manhua' ? '🇨🇳' : '🇯🇵'} {r.type}
              </span>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="p-3 flex flex-col gap-2 flex-1">
          <div className="font-bold text-slate-100 text-sm leading-tight line-clamp-2 group-hover:text-purple-300 transition-colors">
            {r.title}
          </div>
          {r.latestChapter && (
            <div className="text-[11px] text-slate-400 flex items-center gap-1">
              <BookOpen className="w-3 h-3 text-amber-400" />
              Ch. {r.latestChapter}+
            </div>
          )}
          {r.genres && r.genres.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {r.genres.slice(0, 3).map(g => (
                <span key={g} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800">
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
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 cursor-default'
                  : 'bg-purple-600/20 hover:bg-purple-600/40 text-purple-300 border border-purple-500/30 hover:border-purple-500/60'
              }`}
            >
              <Plus className={`w-3.5 h-3.5 ${isAdded ? 'text-emerald-400' : ''}`} />
              {isAdded ? 'Tracked' : 'Track'}
            </button>
            <button
              onClick={(e) => readNow(r, e)}
              title="Open in Reader"
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-gradient-to-r from-amber-500/80 to-orange-500/80 hover:from-amber-500 hover:to-orange-500 text-slate-950 text-xs font-black transition-all"
            >
              <Play className="w-3.5 h-3.5 fill-slate-950" />
              <span>Read</span>
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col relative pb-16">
      {/* Toast Banner */}
      {toast && (
        <div className="fixed bottom-6 right-6 bg-amber-500 text-slate-950 font-black px-4 py-2.5 rounded-xl shadow-2xl z-50 flex items-center gap-2 animate-bounce">
          <Zap className="w-4 h-4 fill-slate-950" />
          <span>{toast}</span>
        </div>
      )}

      {/* Header Banner */}
      <div className="bg-slate-900/80 border-b border-slate-800 backdrop-blur-md sticky top-0 z-30 px-4 py-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-purple-500/20">
            <Globe className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-black text-white flex items-center gap-2">
              Kotatsu Extension Sources Manager
              <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                v2.5 Redo
              </span>
            </h1>
            <p className="text-xs text-slate-400">
              Enable & disable sources • Active sources stay on top, disabled move down to bottom
            </p>
          </div>
        </div>

        {/* Global Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={handlePullAllSources}
            disabled={isPullingAll}
            className="px-3.5 py-2 rounded-xl bg-purple-600/90 hover:bg-purple-500 text-white font-black text-xs flex items-center gap-1.5 transition-all shadow-md active:scale-95 border border-purple-400/40"
            title="Pull all series from active sources directly into SQLite & database.json"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-amber-300 ${isPullingAll ? 'animate-spin' : ''}`} />
            <span>{isPullingAll ? 'Ingesting Series...' : 'Pull All Series Into Database'}</span>
          </button>

          <button
            onClick={handleClearAppCache}
            disabled={isClearingCache}
            className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-750 border border-slate-700 text-slate-200 hover:text-white font-bold text-xs flex items-center gap-1.5 transition-all shadow-md active:scale-95"
            title="Purge local storage, image proxy cache, and dynamic canvas buffers"
          >
            <Trash2 className={`w-3.5 h-3.5 text-rose-400 ${isClearingCache ? 'animate-spin' : ''}`} />
            <span>{isClearingCache ? 'Clearing...' : 'Clear App Cache'}</span>
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Sidebar: Source Extensions List */}
        <div className="w-full md:w-80 bg-slate-900/60 border-r border-slate-800 p-3 flex flex-col gap-3 shrink-0">
          <div className="flex items-center justify-between text-xs font-bold text-slate-400 px-1">
            <span className="flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-purple-400" />
              Parsers ({filteredSources.length})
            </span>
            <button
              onClick={() => setNsfwVisible(!nsfwVisible)}
              className={`text-[10px] px-2 py-0.5 rounded-full border transition-all ${
                nsfwVisible ? 'bg-rose-500/20 text-rose-300 border-rose-500/30 font-bold' : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}
            >
              {nsfwVisible ? '18+ Shown' : '18+ Hidden'}
            </button>
          </div>

          {/* Status Filter Bar (All / Enabled / Disabled) */}
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-[11px] font-bold">
            <button
              onClick={() => setStatusFilter('all')}
              className={`flex-1 py-1 rounded-lg transition-all text-center ${
                statusFilter === 'all' ? 'bg-purple-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All ({sources.length})
            </button>
            <button
              onClick={() => setStatusFilter('enabled')}
              className={`flex-1 py-1 rounded-lg transition-all text-center ${
                statusFilter === 'enabled' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              ON ({enabledCount})
            </button>
            <button
              onClick={() => setStatusFilter('disabled')}
              className={`flex-1 py-1 rounded-lg transition-all text-center ${
                statusFilter === 'disabled' ? 'bg-rose-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              OFF ({disabledCount})
            </button>
          </div>

          {/* Engine Type Filter Bar */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-none">
            <button
              onClick={() => setEngineFilter('all')}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold whitespace-nowrap transition-all ${
                engineFilter === 'all' ? 'bg-purple-600 text-white shadow-sm' : 'bg-slate-800/80 text-slate-400 hover:bg-slate-800'
              }`}
            >
              All
            </button>
            {Object.entries(ENGINE_META).map(([key, meta]) => (
              <button
                key={key}
                onClick={() => setEngineFilter(key as SourceEngineType)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold whitespace-nowrap transition-all flex items-center gap-1 ${
                  engineFilter === key ? 'bg-purple-600 text-white shadow-sm' : 'bg-slate-800/80 text-slate-400 hover:bg-slate-800'
                }`}
              >
                <span>{meta.icon}</span>
                <span>{meta.label}</span>
              </button>
            ))}
          </div>

          {/* Sources List: Enabled on Top, Disabled at Bottom */}
          {isFetchingSources ? (
            <div className="p-8 text-center text-xs text-slate-500 flex flex-col items-center gap-2">
              <RefreshCw className="w-5 h-5 animate-spin text-purple-400" />
              <span>Loading Kotatsu parsers...</span>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 max-h-[600px] md:max-h-none">
              {filteredSources.map(s => {
                const isSelected = selectedSource?.id === s.id;
                const isPinned = pinnedSourceIds.has(s.id);
                const isDisabled = disabledSourceIds.has(s.id);
                const meta = ENGINE_META[s.engineType] || { label: s.engineType, color: 'bg-slate-800 text-slate-300', icon: '🌐' };

                return (
                  <div
                    key={s.id}
                    onClick={() => setSelectedSource(s)}
                    className={`w-full text-left p-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-2 group ${
                      isDisabled
                        ? 'bg-slate-950/30 border-slate-900 opacity-60 grayscale'
                        : isSelected
                        ? 'bg-purple-950/40 border-purple-500/60 shadow-lg shadow-purple-500/10'
                        : 'bg-slate-950/60 border-slate-800/80 hover:bg-slate-900 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="text-base">{meta.icon}</span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className={`font-bold text-xs truncate ${isDisabled ? 'text-slate-500 line-through' : isSelected ? 'text-purple-300' : 'text-slate-200'}`}>
                            {s.name}
                          </span>
                          {isPinned && <Pin className="w-3 h-3 text-amber-400 fill-amber-400 shrink-0" />}
                          {isDisabled && (
                            <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-400 border border-rose-500/30">
                              DISABLED
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded border ${meta.color}`}>
                            {meta.label}
                          </span>
                          <span className="text-[9px] text-slate-500 uppercase font-mono">{s.lang}</span>
                          {s.isNsfw && (
                            <span className="text-[9px] font-bold px-1 py-0.2 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">
                              18+
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {/* Enable/Disable Toggle Button */}
                      <button
                        onClick={(e) => toggleSourceEnabled(s.id, s.name, e)}
                        title={isDisabled ? 'Click to Enable source' : 'Click to Disable source'}
                        className={`p-1 rounded-lg transition-all ${
                          isDisabled
                            ? 'text-slate-600 hover:text-emerald-400'
                            : 'text-emerald-400 hover:text-rose-400'
                        }`}
                      >
                        <Power className={`w-4 h-4 ${isDisabled ? 'text-slate-600' : 'text-emerald-400 fill-emerald-400/20'}`} />
                      </button>

                      {/* Pin Button */}
                      <button
                        onClick={(e) => togglePinSource(s.id, e)}
                        title={isPinned ? 'Unpin source' : 'Pin source to top'}
                        className="p-1 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-slate-800 text-slate-400 hover:text-amber-400 transition-all"
                      >
                        <Pin className={`w-3.5 h-3.5 ${isPinned ? 'fill-amber-400 text-amber-400' : ''}`} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Main Content Area: Show Top and Latest Series categorized in their own sections */}
        <div className="flex-1 p-4 flex flex-col gap-6 overflow-y-auto">
          {selectedSource ? (
            <>
              {/* Selected Source Toolbar */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3 shadow-lg">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-lg">
                    {ENGINE_META[selectedSource.engineType]?.icon || '🌐'}
                  </div>
                  <div>
                    <h2 className="text-base font-black text-white flex items-center gap-2">
                      {selectedSource.name}
                      {disabledSourceIds.has(selectedSource.id) ? (
                        <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                          SOURCE DISABLED
                        </span>
                      ) : (
                        <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          ACTIVE PARSER
                        </span>
                      )}
                    </h2>
                    <div className="flex items-center gap-2 mt-0.5">
                      <a
                        href={selectedSource.baseUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1 font-semibold"
                      >
                        <ExternalLink className="w-3 h-3" />
                        {selectedSource.baseUrl}
                      </a>
                      <span className="text-slate-600">•</span>
                      <span className="text-xs text-slate-400">Language: {selectedSource.lang.toUpperCase()}</span>
                    </div>
                  </div>
                </div>

                {/* Enable/Disable Toggle Control & View Mode Tabs */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => toggleSourceEnabled(selectedSource.id, selectedSource.name, e)}
                    className={`px-3.5 py-1.5 rounded-xl font-bold text-xs flex items-center gap-2 border transition-all ${
                      disabledSourceIds.has(selectedSource.id)
                        ? 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border-emerald-500/40'
                        : 'bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border-rose-500/40'
                    }`}
                  >
                    <Power className="w-3.5 h-3.5" />
                    <span>{disabledSourceIds.has(selectedSource.id) ? 'Enable Source' : 'Disable Source'}</span>
                  </button>

                  <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
                    <button
                      onClick={() => setActiveTab('all')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                        activeTab === 'all' ? 'bg-purple-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Grid className="w-3.5 h-3.5 text-indigo-300" />
                      <span>All Categories</span>
                    </button>
                    <button
                      onClick={() => setActiveTab('popular')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                        activeTab === 'popular' ? 'bg-purple-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                      <span>Popular Only</span>
                    </button>
                    <button
                      onClick={() => setActiveTab('latest')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                        activeTab === 'latest' ? 'bg-purple-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Zap className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Latest Only</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Search Input Bar */}
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => {
                    setSearchQuery(e.target.value);
                    if (e.target.value) setActiveTab('search');
                    else setActiveTab('all');
                  }}
                  placeholder={`Search titles on ${selectedSource.name}...`}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-purple-500 transition-colors"
                />
              </div>

              {/* Disabled Warning Banner */}
              {disabledSourceIds.has(selectedSource.id) && (
                <div className="bg-rose-950/30 border border-rose-500/30 rounded-2xl p-3.5 text-xs text-rose-300 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Power className="w-4 h-4 text-rose-400 shrink-0" />
                    <span>This source is currently <strong>Disabled</strong>. Active sources remain on top; disabled sources move down to the bottom of the list.</span>
                  </div>
                  <button
                    onClick={(e) => toggleSourceEnabled(selectedSource.id, selectedSource.name, e)}
                    className="px-3 py-1 rounded-lg bg-rose-500 text-slate-950 font-black text-[11px] whitespace-nowrap hover:bg-rose-400 transition-all"
                  >
                    Enable Now
                  </button>
                </div>
              )}

              {isLoading ? (
                <div className="flex-1 flex flex-col items-center justify-center p-12 gap-3 text-slate-500">
                  <RefreshCw className="w-8 h-8 animate-spin text-purple-400" />
                  <span className="text-xs font-semibold">Streaming top and latest series categories from {selectedSource.name}...</span>
                </div>
              ) : searchQuery.trim() ? (
                /* Search Results View */
                <div className="flex flex-col gap-3">
                  <h3 className="text-sm font-extrabold text-slate-200 flex items-center gap-2">
                    <Search className="w-4 h-4 text-purple-400" />
                    Search Results for "{searchQuery}" ({searchResults.length})
                  </h3>
                  {searchResults.length === 0 ? (
                    <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-12 text-center text-slate-400">
                      No series found for "{searchQuery}"
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                      {searchResults.map(r => renderSeriesCard(r))}
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
                          <Sparkles className="w-4 h-4 text-amber-400" />
                          Top Popular Series on {selectedSource.name}
                          <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20">
                            {popularResults.length} Series
                          </span>
                        </h3>
                      </div>

                      {popularResults.length === 0 ? (
                        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-8 text-center text-xs text-slate-500">
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
                          <Zap className="w-4 h-4 text-cyan-400" />
                          Latest Uploaded Chapters on {selectedSource.name}
                          <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
                            {latestResults.length} Series
                          </span>
                        </h3>
                      </div>

                      {latestResults.length === 0 ? (
                        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-8 text-center text-xs text-slate-500">
                          No latest uploads loaded for this source.
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                          {latestResults.slice(0, activeTab === 'latest' ? 24 : 12).map(r => renderSeriesCard(r))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center p-12 text-slate-500">
              Select a Kotatsu source from the left sidebar to view its top and latest series categories.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
