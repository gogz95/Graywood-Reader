import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { MangaItem, SourceDefinition, hasWorkingReaderSource } from '../types';
import { isReaderAvailable } from '../utils/catalog';

import {
  Compass,
  Search,
  Plus,
  Check,
  Star,
  BookOpen,
  Layers,
  Globe,
  RefreshCw,
  Sparkles,
  Play,
  Filter,
} from 'lucide-react';

// A single series coming from the LIVE explore feed (never the local library).
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
}

const ITEMS_PER_PAGE = 30;

export const BrowseView: React.FC<BrowseViewProps> = ({
  mangaList,
  searchQuery: seedSearch,
  onSelectManga,
  onOpenReader,
  onTrack,
}) => {
  const [results, setResults] = useState<ExploreItem[]>([]);
  const [sources, setSources] = useState<SourceDefinition[]>([]);
  const [selectedSource, setSelectedSource] = useState<string>('all');
  const [query, setQuery] = useState<string>(seedSearch || '');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trackedKeys, setTrackedKeys] = useState<Set<string>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  // Load the source list for the source filter dropdown (from server registry).
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/kotatsu/sources');
        if (res.ok) {
          const list: SourceDefinition[] = await res.json();
          const defaults = ['asurascans', 'flamecomics', 'weebcentral', 'demonic'];
          const ordered = [...defaults];
          for (const s of list) {
            if (!ordered.includes(s.id)) ordered.push(s.id);
          }
          setSources(list.filter((s) => ordered.includes(s.id)));
        }
      } catch (_) {
        /* source list optional — explore still works with defaults */
      }
    })();
  }, []);

  // Fetch the live explore feed whenever filters/page change.
  const fetchExplore = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(ITEMS_PER_PAGE), page: String(page) });
      if (selectedSource !== 'all') params.set('sourceId', selectedSource);
      if (query.trim()) params.set('q', query.trim());
      const res = await fetch(`/api/explore?${params.toString()}`);
      if (!res.ok) throw new Error(`Explore feed returned ${res.status}`);
      const data = await res.json();
      setResults(Array.isArray(data.items) ? data.items : []);
      setTotalPages(Number(data.totalPages) || 0);
    } catch (e: any) {
      console.error('[Explore] Feed error:', e.message);
      setError('Live explore feed unavailable. Try again or pick a different source.');
      setResults([]);
      setTotalPages(0);
    } finally {
      setLoading(false);
    }
  }, [selectedSource, query, page]);

  useEffect(() => {
    setPage(1);
  }, [selectedSource, query, typeFilter, selectedTag]);

  // Fetch the live explore feed on mount and whenever filters/page change.
  useEffect(() => {
    fetchExplore();
  }, [fetchExplore]);

  const handleTrack = (item: ExploreItem) => {
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
      sourceName: item.__sourceName || item.sourceName || 'Explore',
      autoUpdateEnabled: true,
      notes: 'Added from Live Explore',
      isFavorite: true,
    });
    setTrackedKeys((prev) => new Set(prev).add(item.title.trim().toLowerCase()));
  };

  // Seed search from the navbar search box when it changes.
  useEffect(() => {
    if (seedSearch !== undefined) setQuery(seedSearch);
  }, [seedSearch]);

  // Popular tags derived from the current live feed so the chips always match real data.
  const popularTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of results) {
      for (const g of r.genres || []) {
        counts.set(g, (counts.get(g) || 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 16)
      .map(([tag]) => tag);
  }, [results]);

  const visible = results.filter((r) =>
    (typeFilter === 'all' ? true : (r.type || 'manga').toLowerCase() === typeFilter) &&
    (selectedTag ? (r.genres || []).some((g) => g.toLowerCase() === selectedTag.toLowerCase()) : true)
  );

  const toManga = (r: ExploreItem, forReader: boolean): MangaItem => ({
    id: r.id || `explore_${Date.now()}`,
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
    sourceName: r.__sourceName || r.sourceName || 'Explore',
    autoUpdateEnabled: true,
    notes: '',
    addedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    lastReadAt: new Date().toISOString(),
  });

  const countLabel = results.length > 0 ? `${results.length} live series` : '';

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
                Explore
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-success/15 text-success border border-success/25">
                  LIVE
                </span>
              </h2>
              <p className="text-[11px] text-secondary leading-snug">
                Discover series scraped live from your enabled sources — not just what's in your library.
              </p>
            </div>
          </div>
<div className="flex-1 flex flex-col sm:flex-row gap-2 sm:ml-4">
            <select
              value={selectedSource}
              onChange={(e) => setSelectedSource(e.target.value)}
              className="bg-app border border-edge rounded-xl px-3 py-2 text-xs font-bold text-primary focus:outline-none focus:ring-2 focus:ring-accent/40 sm:w-52"
            >
              <option value="all">All Sources</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>

            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="bg-app border border-edge rounded-xl px-3 py-2 text-xs font-bold text-primary focus:outline-none focus:ring-2 focus:ring-accent/40 sm:w-40"
            >
              <option value="all">All Types</option>
              <option value="manhwa">Manhwa</option>
              <option value="manhua">Manhua</option>
              <option value="manga">Manga</option>
            </select>

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

        <div className="flex items-center justify-between text-[11px] text-secondary">
          <span className="inline-flex items-center gap-1.5">
            <Globe className="w-3.5 h-3.5 text-accent" /> Feed refreshes live · {countLabel}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFiltersOpen((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-elevated hover:bg-elevated font-bold transition-all border ${
                filtersOpen ? 'text-accent border-accent/30' : 'text-secondary border-edge'
              }`}
              title={filtersOpen ? 'Hide tags' : 'Show tags'}
            >
              <Filter className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{filtersOpen ? 'Hide Tags' : 'Show Tags'}</span>
            </button>
            <button
              onClick={() => setPage(1)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-elevated hover:bg-elevated text-accent border border-accent/20 font-bold transition-all"
              title="Refresh the live feed"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
          </div>
        </div>

        {filtersOpen && popularTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-[10px] font-black uppercase tracking-wider text-secondary">Tags</span>
            <button
              onClick={() => setSelectedTag(null)}
              className={`px-3 py-1.5 rounded-full text-[11px] font-bold border transition-all ${
                selectedTag === null
                  ? 'bg-accent-2 text-white border-accent-2'
                  : 'bg-elevated text-secondary border-edge hover:text-primary'
              }`}
            >
              All
            </button>
            {popularTags.map((tag) => (
              <button
                key={tag}
                onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                className={`px-3 py-1.5 rounded-full text-[11px] font-bold border transition-all ${
                  selectedTag === tag
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
          <span className="text-xs font-semibold">Streaming live catalog…</span>
        </div>
      ) : error ? (
        <div className="bg-surface/60 border border-edge rounded-2xl p-12 text-center space-y-3">
          <Sparkles className="w-8 h-8 text-accent mx-auto" />
          <p className="text-sm text-secondary">{error}</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="bg-surface/60 border border-edge rounded-2xl p-16 text-center text-secondary">
          <p className="text-sm font-semibold">No live series found.</p>
          <p className="text-xs mt-1">Try a different source or clear your search.</p>
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
                        className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold transition-all ${
                          isTracked
                            ? 'bg-success/20 text-success border border-success/30 cursor-default'
                            : 'bg-accent-2/20 hover:bg-accent-2/40 text-accent-2 border border-accent-2/30'
                        }`}
                      >
                        {isTracked ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                        {isTracked ? 'Tracked' : 'Track'}
                      </button>
                      <button
                        title={readable ? 'Read now' : 'View info'}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (readable) onOpenReader(toManga(r, true), 1);
                          else onSelectManga(toManga(r, false));
                        }}
                        className="flex items-center justify-center px-2.5 py-2 rounded-xl bg-elevated hover:bg-elevated text-accent border border-edge font-bold transition-all"
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
                Page {page} / {totalPages} ({countLabel})
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
