import React, { useState, useEffect } from 'react';
import {
  X,
  Search,
  Globe,
  Check,
  RefreshCw,
  Sparkles,
  ExternalLink,
  Shield,
  Layers,
} from 'lucide-react';
import { MangaItem, SourceDefinition } from '../../types';
import { apiFetch } from '../../utils/api';

interface SourceSearchResult {
  id: string;
  name: string;
  sourceUrl: string;
  sourceName: string;
  latestChapter?: number;
  matchScore?: number;
}

interface SourceSwitcherModalProps {
  manga: MangaItem;
  isOpen: boolean;
  onClose: () => void;
  onSelectSource: (sourceUrl: string, sourceName: string) => void;
}

export const SourceSwitcherModal: React.FC<SourceSwitcherModalProps> = ({
  manga,
  isOpen,
  onClose,
  onSelectSource,
}) => {
  const [searchQuery, setSearchQuery] = useState(manga.title || '');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SourceSearchResult[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const searchSources = async (query: string) => {
    if (!query.trim()) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const res: any = await apiFetch(`/api/sources/search-live?q=${encodeURIComponent(query)}`);
      if (res && Array.isArray(res.results)) {
        setResults(res.results);
      } else {
        setResults([]);
      }
    } catch (e: any) {
      setErrorMsg(e?.message || 'Failed to search alternative sources');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      searchSources(manga.title);
    }
  }, [isOpen, manga.title]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 animate-fadeIn">
      <div className="bg-surface border border-edge rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden my-auto">
        {/* Header */}
        <div className="p-4 bg-app border-b border-edge flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-accent/15 text-accent border border-accent/30">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-black text-primary flex items-center gap-2">
                <span>In-Reader Source & Mirror Switcher</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] bg-accent/20 text-accent font-bold">
                  Zero-Stall Fallback
                </span>
              </h3>
              <p className="text-xs text-secondary truncate max-w-md">
                Current Source: <strong className="text-primary">{manga.sourceName || 'Unknown'}</strong> ({manga.sourceUrl})
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full bg-elevated text-secondary hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search Bar */}
        <div className="p-4 bg-app/50 border-b border-edge">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              searchSources(searchQuery);
            }}
            className="relative flex items-center"
          >
            <Search className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search alternate titles across 1,180+ Kotatsu & direct scrapers..."
              className="w-full bg-surface border border-edge rounded-xl pl-9 pr-24 py-2.5 text-xs text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 font-semibold"
            />
            <button
              type="submit"
              disabled={loading}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 px-3 py-1.5 rounded-lg bg-accent text-accent-fg font-bold text-xs flex items-center gap-1 shadow-sm"
            >
              <Sparkles className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Search</span>
            </button>
          </form>
        </div>

        {/* Results List */}
        <div className="p-4 flex-1 overflow-y-auto space-y-3">
          {errorMsg && (
            <div className="p-3 rounded-xl bg-danger/10 border border-danger/30 text-danger text-xs font-bold">
              {errorMsg}
            </div>
          )}

          {loading ? (
            <div className="py-12 text-center text-secondary flex flex-col items-center gap-3">
              <RefreshCw className="w-7 h-7 animate-spin text-accent" />
              <span className="text-xs font-bold">Searching alternative mirrors and scanlation providers...</span>
            </div>
          ) : results.length === 0 ? (
            <div className="py-10 text-center text-muted space-y-2">
              <Globe className="w-8 h-8 mx-auto text-muted/60" />
              <p className="text-xs font-bold text-secondary">No alternative sources found for "{searchQuery}"</p>
              <p className="text-[11px]">Try modifying the search title above to match alternate romanizations.</p>
            </div>
          ) : (
            results.map((res, idx) => {
              const isCurrent = manga.sourceUrl === res.sourceUrl;
              return (
                <div
                  key={idx}
                  className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 transition-all ${
                    isCurrent
                      ? 'bg-accent/10 border-accent/50 ring-1 ring-accent/30'
                      : 'bg-app border-edge hover:border-accent/40'
                  }`}
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-accent-2/20 text-accent-2 border border-accent-2/30">
                        {res.sourceName}
                      </span>
                      <h4 className="text-xs font-bold text-primary truncate max-w-sm">{res.name || manga.title}</h4>
                    </div>
                    <a
                      href={res.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-info hover:underline flex items-center gap-1 truncate max-w-md"
                    >
                      <span className="truncate">{res.sourceUrl}</span>
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  </div>

                  <button
                    type="button"
                    disabled={isCurrent}
                    onClick={() => {
                      onSelectSource(res.sourceUrl, res.sourceName);
                      onClose();
                    }}
                    className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all shrink-0 flex items-center gap-1.5 ${
                      isCurrent
                        ? 'bg-accent/20 text-accent border border-accent/40 opacity-80 cursor-default'
                        : 'bg-accent hover:bg-accent-bright text-accent-fg shadow-sm active:scale-95'
                    }`}
                  >
                    {isCurrent ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Active Source</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>Switch Source</span>
                      </>
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-3 bg-app border-t border-edge flex items-center justify-between text-xs text-secondary">
          <span>Found {results.length} available mirrors</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-elevated hover:bg-elevated/80 text-secondary hover:text-white font-bold"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
