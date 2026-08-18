import React, { useState, useEffect } from 'react';
import { apiFetch } from '../utils/api';
import { OpenApiManga, MangaItem } from '../types';
import {
  Sparkles,
  Search,
  Plus,
  Check,
  Globe,
  Star,
  ExternalLink,
  RefreshCw,
  Tag,
  BookOpen,
} from 'lucide-react';

interface OpenApiFinderViewProps {
  existingIds: string[];
  existingTitles: string[];
  onAddFromOpenApi: (manga: OpenApiManga) => void;
}

export const OpenApiFinderView: React.FC<OpenApiFinderViewProps> = ({
  existingIds,
  existingTitles,
  onAddFromOpenApi,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState<OpenApiManga[]>([]);
  const [loading, setLoading] = useState(false);
  const [apiSource, setApiSource] = useState<'mangadex' | 'anilist'>('mangadex');
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());

  // Search function
  const fetchOpenApiResults = async (query: string, source: 'mangadex' | 'anilist') => {
    setLoading(true);
    try {
      if (source === 'mangadex') {
        const res = await apiFetch(`/api/mangadex/search?q=${encodeURIComponent(query)}`);
        if (res.ok) {
          const data = await res.json();
          setResults(data);
        }
      } else {
        const res = await apiFetch(`/api/anilist/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: query || 'Solo Leveling' }),
        });
        if (res.ok) {
          const data = await res.json();
          setResults(data);
        }
      }
    } catch (err) {
      console.error("OpenAPI fetch error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOpenApiResults(searchTerm, apiSource);
  }, [apiSource]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchOpenApiResults(searchTerm, apiSource);
  };

  const handleAdd = async (manga: OpenApiManga) => {
    try {
      if (manga.source === 'MangaDex API' || apiSource === 'mangadex') {
        await apiFetch(`/api/mangadex/import/${manga.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
      }
    } catch (err) {
      console.error("MangaDex import error:", err);
    }

    onAddFromOpenApi(manga);
    setAddedIds((prev) => new Set([...prev, manga.id]));
  };


  return (
    <div className="space-y-6">
      {/* Search Header Banner */}
      <div className="bg-gradient-to-r from-surface via-surface to-cyan-950/40 border border-edge rounded-2xl p-6 shadow-xl relative overflow-hidden">
        <div className="space-y-3 max-w-2xl relative z-10">
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-info/10 text-info border border-info/20 text-xs font-bold">
            <Sparkles className="w-3.5 h-3.5 text-info" />
            Open API & MangaDex Direct Sync Connector
          </div>
          <h2 className="text-2xl font-black text-primary tracking-tight">
            Discover & Import Manhwa & Manhua
          </h2>
          <p className="text-sm text-secondary leading-relaxed">
            Search live public databases (MangaDex REST API & AniList GraphQL API) to fetch verified cover images, alternate titles, chapter counts, and metadata directly into your database.
          </p>

          {/* Search Form */}
          <form onSubmit={handleSearchSubmit} className="pt-2 flex flex-col sm:flex-row items-stretch gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-secondary" />
              <input
                type="text"
                placeholder="Type Manhwa title (e.g. Solo Leveling, Omniscient Reader, Martial Peak)..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-app border border-edge-strong/80 rounded-xl pl-10 pr-4 py-3 text-sm text-primary placeholder-muted focus:outline-none focus:ring-2 focus:ring-info/50"
              />
            </div>

            <div className="flex items-center gap-2">
              <select
                value={apiSource}
                onChange={(e: any) => setApiSource(e.target.value)}
                className="bg-app border border-edge-strong rounded-xl px-3 py-3 text-sm text-primary focus:outline-none focus:ring-2 focus:ring-info/50 font-medium"
              >
                <option value="mangadex">MangaDex API</option>
                <option value="anilist">AniList API</option>
              </select>

              <button
                type="submit"
                disabled={loading}
                className="px-5 py-3 rounded-xl bg-info hover:bg-info text-accent-fg font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2"
              >
                {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                <span>Search</span>
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Results Grid */}
      {loading ? (
        <div className="p-16 text-center space-y-3">
          <RefreshCw className="w-8 h-8 text-info animate-spin mx-auto" />
          <p className="text-sm font-semibold text-secondary">Fetching live results from {apiSource === 'mangadex' ? 'MangaDex REST API' : 'AniList GraphQL'}...</p>
        </div>
      ) : results.length === 0 ? (
        <div className="bg-surface border border-edge rounded-xl p-12 text-center text-secondary space-y-2">
          <BookOpen className="w-8 h-8 text-muted mx-auto" />
          <p>No results found for "{searchTerm}". Try another search term!</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {results.map((manga) => {
            const isAdded =
              addedIds.has(manga.id) ||
              existingIds.includes(manga.id) ||
              existingTitles.some((t) => t.toLowerCase() === manga.title.toLowerCase());

            return (
              <div
                key={manga.id}
                className="bg-surface border border-edge hover:border-edge-strong rounded-xl overflow-hidden shadow-lg flex flex-col justify-between transition-all"
              >
                <div>
                  {/* Cover */}
                  <div className="relative aspect-[16/9] w-full overflow-hidden bg-app">
                    <img
                      src={manga.coverImage}
                      alt={manga.title}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />

                    <span
                      className={`absolute top-2.5 left-2.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase backdrop-blur-md ${
                        manga.type === 'manhwa'
                          ? 'bg-blue-950/80 text-info border border-info/30'
                          : 'bg-red-950/80 text-danger border border-danger/30'
                      }`}
                    >
                      {manga.type === 'manhwa' ? '🇰🇷 Manhwa' : '🇨🇳 Manhua'}
                    </span>

                    <span className="absolute bottom-2.5 right-2.5 px-2 py-0.5 rounded text-[10px] font-bold bg-app/80 text-info border border-edge">
                      {manga.source}
                    </span>
                  </div>

                  {/* Body Info */}
                  <div className="p-4 space-y-2">
                    <h4 className="text-sm font-bold text-primary line-clamp-1">{manga.title}</h4>
                    {manga.altTitles.length > 0 && (
                      <p className="text-xs text-secondary line-clamp-1 font-mono">
                        Alt: {manga.altTitles.join(', ')}
                      </p>
                    )}

                    <p className="text-xs text-secondary line-clamp-2 leading-relaxed">
                      {manga.description}
                    </p>

                    <div className="flex flex-wrap gap-1 pt-1">
                      {manga.genres.slice(0, 3).map((genre, idx) => (
                        <span key={idx} className="px-2 py-0.5 rounded text-[10px] bg-elevated text-secondary">
                          {genre}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Bottom Add Action */}
                <div className="p-4 pt-0 border-t border-edge/80 mt-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-accent">
                    Latest: Ch. {manga.latestChapter}
                  </span>

                  {isAdded ? (
                    <button
                      disabled
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-success/20 text-success border border-success/30 text-xs font-bold cursor-default"
                    >
                      <Check className="w-3.5 h-3.5" />
                      In Tracker
                    </button>
                  ) : (
                    <button
                      onClick={() => handleAdd(manga)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-info hover:bg-info text-accent-fg font-bold text-xs shadow-md transition-all"
                    >
                      <Plus className="w-3.5 h-3.5 stroke-[3]" />
                      Add to Tracker
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
