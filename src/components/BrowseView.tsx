import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { apiFetch } from '../utils/api';
import { MangaItem, hasWorkingReaderSource, isNsfwManga } from '../types';


import {
  Compass,
  Search,
  Plus,
  Check,
  Star,
  BookOpen,
  Layers,
  RefreshCw,
  Sparkles,
  Play,
  Filter,
  X,
} from 'lucide-react';

// A single series coming from the LIVE browse feed (never the local library).
export interface ExploreItem {
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
  __sourceId?: string;
  __sourceName?: string;
  previewImages?: string[];
}

/** Catalog metadata from the server: all genres/types/sources in the full buffer. */
interface CatalogMeta {
  genres: string[];
  types: string[];
  sources: { id: string; name: string }[];
  totalItems?: number;
}

const FALLBACK_COVER =
  '/api/mangadex/image-proxy?url=https%3A%2F%2Fuploads.mangadex.org%2Fcovers%2F32d76d19-8a05-4db0-9fc2-e0b0648fe9d0%2Ffbc962f9-3d12-4c6e-8212-32a2cb874a7b.jpg';

interface BrowseViewProps {
  mangaList?: MangaItem[];
  searchQuery?: string;
  onIncrementChapter?: (id: string) => void;
  onSelectManga: (manga: MangaItem) => void;
  onQuickEdit?: (manga: MangaItem) => void;
  onDeleteManga?: (id: string) => void;
  onAddNew?: () => void;
  onOpenReader: (manga: MangaItem, chapterNumber?: number) => void;
  onOpenChapters?: (manga: MangaItem) => void;
  onToggleFavorite?: (manga: MangaItem) => void;
  onTrack: (item: Partial<MangaItem>) => void;
  isGuest?: boolean;
  onOpenAuthModal?: () => void;
}

/** Compute an appropriate per-page limit based on the client's screen width. */
function computeLimit(): number {
  const w = window.innerWidth;
  if (w < 640) return 24;   // mobile
  if (w < 1024) return 36;  // tablet
  if (w < 1440) return 48;  // standard desktop
  if (w < 2560) return 60;  // large desktop
  return 84;                 // 4K+
}

export const BrowseView: React.FC<BrowseViewProps> = ({
  searchQuery: seedSearch,
  onSelectManga,
  onOpenReader,
  onTrack,
  isGuest = false,
  onOpenAuthModal,
}) => {
  const [results, setResults] = useState<ExploreItem[]>([]);
  const [meta, setMeta] = useState<CatalogMeta>({ genres: [], types: [], sources: [] });
  const [selectedSource, setSelectedSource] = useState<string>('all');
  const [query, setQuery] = useState<string>(seedSearch || '');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trackedKeys, setTrackedKeys] = useState<Set<string>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [metaLoaded, setMetaLoaded] = useState(false);

  // Device-aware items-per-page — computed once on mount.
  const limitRef = useRef(computeLimit());
  const limit = limitRef.current;

  // ── Load catalog meta (genres/types/sources from full buffer) ─────────────
  const fetchMeta = useCallback(async () => {
    try {
      const res = await apiFetch('/api/explore/meta');
      if (res.ok) {
        const data: CatalogMeta = await res.json();
        setMeta(data);
        setMetaLoaded(true);
      }
    } catch {
      // meta is optional — browse still works without it
    }
  }, []);

  useEffect(() => { fetchMeta(); }, [fetchMeta]);

  // ── Fetch the live browse feed ────────────────────────────────────────────
  const fetchBrowse = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: String(limit),
        page: String(page),
        width: String(window.innerWidth),
        height: String(window.innerHeight),
      });
      if (selectedSource !== 'all') params.set('sourceId', selectedSource);
      if (query.trim()) params.set('q', query.trim());
      const res = await apiFetch(`/api/explore?${params.toString()}`);
      if (!res.ok) throw new Error(`Browse feed returned ${res.status}`);
      const data = await res.json();
      const rawItems = Array.isArray(data.items) ? data.items : [];
      const safeItems = isGuest ? rawItems.filter((it: any) => !isNsfwManga(it)) : rawItems;
      setResults(safeItems);
      setTotalPages(Number(data.totalPages) || 0);
      setTotalCount(Number(data.totalCount) || 0);
    } catch (e: any) {
      console.error('[Browse] Feed error:', e.message);
      setError('Live browse feed unavailable. Try again or pick a different source.');
      setResults([]);
      setTotalPages(0);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [selectedSource, query, page, limit, isGuest]);

  useEffect(() => {
    setPage(1);
    setSelectedTags(new Set());
  }, [selectedSource, query, typeFilter]);

  useEffect(() => { fetchBrowse(); }, [fetchBrowse]);

  const handleTrack = (item: ExploreItem) => {
    if (isGuest && isNsfwManga(item as any)) {
      onOpenAuthModal?.();
      return;
    }
    onTrack({
      title: item.title,
      altTitles: [],
      type: (item.type as MangaItem['type']) || 'manhwa',
      coverImage: item.coverImage || FALLBACK_COVER,
      description: item.description || `Live series from ${item.__sourceName || item.sourceName}`,
      genres: item.genres && item.genres.length ? item.genres : ['Action'],
      status: 'reading',
      currentChapter: 0,
      latestChapter: item.latestChapter || 1,
      totalChapters: item.latestChapter || null,
      rating: 9.0,
      sourceUrl: item.sourceUrl,
      sourceName: item.__sourceName || item.sourceName || 'Browse',
      autoUpdateEnabled: true,
      notes: 'Added from Browse',
      isFavorite: true,
    });
    setTrackedKeys((prev) => new Set(prev).add(item.title.trim().toLowerCase()));
  };

  // Seed search from the navbar search box when it changes.
  useEffect(() => {
    if (seedSearch !== undefined) setQuery(seedSearch);
  }, [seedSearch]);

  // Tags visible in the current page — used as fallback when meta isn't loaded yet.
  const pageGenres = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of results) {
      for (const g of r.genres || []) {
        counts.set(g, (counts.get(g) || 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([tag]) => tag);
  }, [results]);

  // Use full-catalog genres from meta when available, else fall back to page genres.
  const displayGenres = metaLoaded && meta.genres.length > 0 ? meta.genres : pageGenres;

  // Client-side post-filter for type and selected tags (server handles source/query).
  const visible = useMemo(
    () =>
      results.filter((r) => {
        if (typeFilter !== 'all' && (r.type || 'manga').toLowerCase() !== typeFilter) return false;
        if (selectedTags.size > 0) {
          const rGenres = (r.genres || []).map((g) => g.toLowerCase());
          for (const t of selectedTags) {
            if (!rGenres.includes(t.toLowerCase())) return false;
          }
        }
        return true;
      }),
    [results, typeFilter, selectedTags]
  );

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      next.has(tag) ? next.delete(tag) : next.add(tag);
      return next;
    });
  };

  const toManga = (r: ExploreItem, forReader: boolean): MangaItem => ({
    id: r.id || `browse_${Date.now()}`,
    title: r.title,
    altTitles: [],
    type: (r.type as MangaItem['type']) || 'manhwa',
    coverImage: r.coverImage || FALLBACK_COVER,
    description: r.description || (forReader ? '' : `Live series from ${r.__sourceName || r.sourceName}`),
    genres: r.genres && r.genres.length ? r.genres : ['Action'],
    status: 'reading',
    currentChapter: 0,
    latestChapter: r.latestChapter || 1,
    totalChapters: r.latestChapter || null,
    rating: 9.0,
    sourceUrl: r.sourceUrl,
    sourceName: r.__sourceName || r.sourceName || 'Browse',
    autoUpdateEnabled: true,
    notes: '',
    addedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    lastReadAt: new Date().toISOString(),
  });

  // Types for the dropdown: prefer meta list, fall back to hard-coded defaults.
  const typeOptions = useMemo(() => {
    const defaults = ['manga', 'manhwa', 'manhua'];
    if (metaLoaded && meta.types.length > 0) {
      return [...new Set([...meta.types, ...defaults])].sort();
    }
    return defaults;
  }, [metaLoaded, meta.types]);

  const handleRefresh = () => {
    setPage(1);
    fetchBrowse();
    setTimeout(fetchMeta, 3000);
  };

  return (
    <div className="space-y-6">
      {/* Header / Controls */}
      <div className="bg-gradient-to-br from-surface via-surface to-indigo-950/40 rounded-3xl p-5 sm:p-6 border border-edge shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-2xl bg-accent-2/15 text-accent-2 border border-accent-2/25">
              <Compass className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-primary flex items-center gap-2">
                Browse
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-success/15 text-success border border-success/25">
                  LIVE
                </span>
                {metaLoaded && meta.totalItems != null && meta.totalItems > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-accent-2/10 text-accent-2 border border-accent-2/20">
                    {meta.totalItems.toLocaleString()} indexed
                  </span>
                )}
              </h2>
              <p className="text-[11px] text-secondary leading-snug">
                Discover series scraped live from all your enabled sources.
              </p>
            </div>
          </div>

          {/* Controls row */}
          <div className="flex-1 flex flex-col sm:flex-row gap-2 sm:ml-4">
            {/* Source selector — full list from server meta */}
            <select
              value={selectedSource}
              onChange={(e) => setSelectedSource(e.target.value)}
              className="bg-app border border-edge rounded-xl px-3 py-2 text-xs font-bold text-primary focus:outline-none focus:ring-2 focus:ring-accent/40 sm:w-52"
            >
              <option value="all">
                All Sources{meta.sources.length > 0 ? ` (${meta.sources.length})` : ''}
              </option>
              {meta.sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>

            {/* Type selector — dynamic from catalog meta */}
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="bg-app border border-edge rounded-xl px-3 py-2 text-xs font-bold text-primary focus:outline-none focus:ring-2 focus:ring-accent/40 sm:w-40"
            >
              <option value="all">All Types</option>
              {typeOptions.map((t) => (
                <option key={t} value={t}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </option>
              ))}
            </select>

            {/* Search input */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search live sources…"
                className="w-full bg-app border border-edge rounded-xl pl-9 pr-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </div>
          </div>
        </div>

        {/* Actions row */}
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => setFiltersOpen((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg bg-elevated hover:bg-elevated font-bold transition-all border text-xs sm:text-sm ${
              filtersOpen ? 'text-accent border-accent/30' : 'text-secondary border-edge'
            }`}
            title={filtersOpen ? 'Hide tags' : 'Show tags'}
          >
            <Filter className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline">{filtersOpen ? 'Hide Tags' : 'Show Tags'}</span>
            {selectedTags.size > 0 && (
              <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-accent-2 text-white text-[10px] font-black leading-none">
                {selectedTags.size}
              </span>
            )}
          </button>
          <button
            onClick={handleRefresh}
            className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg bg-elevated hover:bg-elevated text-accent border border-accent/20 font-bold transition-all text-xs sm:text-sm"
            title="Refresh the live feed"
          >
            <RefreshCw className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> Refresh
          </button>
        </div>

        {/* Tag chips — genres from the full catalog buffer */}
        {filtersOpen && displayGenres.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-[10px] font-black uppercase tracking-wider text-secondary">Tags</span>
            {selectedTags.size > 0 && (
              <button
                onClick={() => setSelectedTags(new Set())}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold border bg-danger/15 text-danger border-danger/30 hover:bg-danger/25 transition-all"
              >
                <X className="w-3 h-3" /> Clear
              </button>
            )}
            {displayGenres.slice(0, 32).map((tag) => (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-[11px] sm:text-xs font-bold border transition-all ${
                  selectedTags.has(tag)
                    ? 'bg-accent-2 text-white border-accent-2 shadow-sm'
                    : 'bg-elevated text-secondary border-edge hover:text-primary hover:border-accent-2/40'
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-muted">
          <RefreshCw className="w-8 h-8 animate-spin text-accent-2" />
          <span className="text-xs font-semibold">Loading catalog…</span>
        </div>
      ) : error ? (
        <div className="bg-surface/60 border border-edge rounded-2xl p-12 text-center space-y-3">
          <Sparkles className="w-8 h-8 text-accent mx-auto" />
          <p className="text-sm text-secondary">{error}</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="bg-surface/60 border border-edge rounded-2xl p-16 text-center text-secondary">
          <p className="text-sm font-semibold">No series found.</p>
          <p className="text-xs mt-1">Try a different source, type, or clear your tag selection.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-3 sm:gap-4 md:gap-5">
          {visible.map((r) => {
              const isTracked = trackedKeys.has(String(r.title).trim().toLowerCase());
              const readable = hasWorkingReaderSource({ sourceUrl: r.sourceUrl, sourceName: r.sourceName });
              return (
                <div
                  key={r.id || r.title}
                  onClick={() => onSelectManga(toManga(r, false))}
                  className="group bg-app border border-edge rounded-2xl overflow-hidden hover:border-accent-2/60 hover:shadow-xl transition-all flex flex-col cursor-pointer"
                >
                  <div className="relative aspect-[3/4] bg-surface overflow-hidden">
                    {r.coverImage ? (
                      <img
                        src={r.coverImage}
                        alt={r.title}
                        loading="lazy"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = FALLBACK_COVER;
                        }}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-indigo-900/40 to-surface">
                        <BookOpen className="w-10 h-10 text-accent-2/40" />
                      </div>
                    )}
                    <div className="absolute top-2 left-2">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border backdrop-blur-sm bg-app/70 text-secondary">
                        {r.__sourceName || r.sourceName}
                      </span>
                    </div>
                    {r.type && (
                      <div className="absolute top-2 right-2">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-app/80 text-secondary border border-edge">
                          {r.type}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="p-3 flex flex-col gap-2 flex-1">
                    <p className="font-bold text-primary text-sm leading-tight line-clamp-2 group-hover:text-accent-2 transition-colors">
                      {r.title}
                    </p>
                    {r.latestChapter ? (
                      <div className="text-[11px] text-secondary flex items-center gap-1">
                        <Layers className="w-3 h-3 text-accent" /> Ch. {r.latestChapter}+
                      </div>
                    ) : null}
                    <div className="flex gap-2 mt-auto pt-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTrack(r);
                        }}
                        disabled={isTracked}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all ${
                          isTracked
                            ? 'bg-success/20 text-success border border-success/30 cursor-default'
                            : 'bg-accent-2/20 hover:bg-accent-2/40 text-accent-2 border border-accent-2/30'
                        }`}
                      >
                        {isTracked ? <Check className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> : <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
                        {isTracked ? 'Tracked' : 'Track'}
                      </button>
                      <button
                        title={readable ? 'Read now' : 'View info'}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (readable) onOpenReader(toManga(r, true), 1);
                          else onSelectManga(toManga(r, false));
                        }}
                        className="flex items-center justify-center px-2.5 sm:px-3 py-2 sm:py-2.5 rounded-xl bg-elevated hover:bg-elevated text-accent border border-edge font-bold transition-all"
                      >
                        {readable ? <Play className="w-3.5 h-3.5 fill-accent" /> : <Star className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="sticky bottom-4 z-20 flex items-center justify-between gap-3 p-4 bg-surface/95 backdrop-blur-md border border-edge rounded-2xl shadow-2xl">
              <span className="text-xs font-mono text-secondary">
                Page {page} / {totalPages}
                {totalCount > 0 && ` · ${totalCount.toLocaleString()} total`}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-4 py-2 rounded-xl bg-elevated hover:bg-elevated disabled:opacity-40 font-bold text-xs text-primary border border-edge transition-all"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-accent to-accent-2 disabled:opacity-40 font-black text-xs text-accent-fg shadow-md transition-all"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

