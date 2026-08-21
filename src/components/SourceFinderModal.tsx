import React, { useState, useEffect } from 'react';
import { apiFetch } from '../utils/api';
import { MangaItem } from '../types';
import {
  X,
  Search,
  Globe,
  Check,
  ExternalLink,
  Loader2,
  AlertTriangle,
  Sparkles,
  Zap,
  BookOpen,
} from 'lucide-react';

export interface AlternativeSourceCandidate {
  sourceName: string;
  sourceId: string;
  sourceUrl: string;
  title: string;
  coverImage?: string;
  latestChapter?: number;
  confidence: 'exact' | 'high' | 'partial';
  isCurrent?: boolean;
}

interface SourceFinderModalProps {
  manga: MangaItem;
  isOpen: boolean;
  onClose: () => void;
  onSourceAttached: (updatedManga: MangaItem) => void;
}

export const SourceFinderModal: React.FC<SourceFinderModalProps> = ({
  manga,
  isOpen,
  onClose,
  onSourceAttached,
}) => {
  const [searchQuery, setSearchQuery] = useState(manga.title);
  const [isSearching, setIsSearching] = useState(false);
  const [candidates, setCandidates] = useState<AlternativeSourceCandidate[]>([]);
  const [attachingUrl, setAttachingUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  const handleSearch = async (overrideQuery?: string) => {
    const q = (overrideQuery !== undefined ? overrideQuery : searchQuery).trim();
    if (!q) return;

    setIsSearching(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch(`/api/manga/${manga.id}/find-sources?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const data = await res.json();
        setCandidates(data.results || []);
      } else {
        const err = await res.json().catch(() => ({}));
        setErrorMsg(err.error || 'Failed to search sources');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Network error searching sources');
    } finally {
      setIsSearching(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setSearchQuery(manga.title);
      handleSearch(manga.title);
    }
  }, [isOpen, manga.id]);

  const handleAttachSource = async (candidate: AlternativeSourceCandidate) => {
    setAttachingUrl(candidate.sourceUrl);
    setErrorMsg(null);
    try {
      const res = await apiFetch(`/api/manga/${manga.id}/attach-source`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceName: candidate.sourceName,
          sourceUrl: candidate.sourceUrl,
          latestChapter: candidate.latestChapter,
          coverImage: candidate.coverImage,
          setAsPrimary: true,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setSuccessToast(`Successfully attached ${candidate.sourceName}!`);
        if (data.manga) {
          onSourceAttached(data.manga);
        }
        setTimeout(() => {
          onClose();
        }, 1200);
      } else {
        const err = await res.json().catch(() => ({}));
        setErrorMsg(err.error || 'Failed to attach source');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error attaching source');
    } finally {
      setAttachingUrl(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto animate-in fade-in duration-200"
    >
      <div className="relative bg-surface border border-edge rounded-t-3xl sm:rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-hidden shadow-2xl flex flex-col my-0 sm:my-auto">
        
        {/* Header */}
        <div className="p-5 bg-gradient-to-r from-app via-surface to-app border-b border-edge flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-accent-2/10 text-accent-2 border border-accent-2/20 shadow-md">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-black text-primary flex items-center gap-2">
                Find Alternative Sources
              </h3>
              <p className="text-xs text-secondary line-clamp-1">
                Auto-search active sources for <span className="text-primary font-bold">{manga.title}</span>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-elevated/80 text-secondary hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search Bar & Alternative Titles */}
        <div className="p-4 bg-app/60 border-b border-edge space-y-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSearch();
            }}
            className="flex items-center gap-2"
          >
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search series title across active sources..."
                className="w-full bg-surface border border-edge rounded-xl pl-10 pr-4 py-2 text-xs sm:text-sm text-primary placeholder-muted focus:outline-none focus:border-accent-2/60 shadow-inner"
              />
            </div>
            <button
              type="submit"
              disabled={isSearching}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-accent to-accent-2 hover:from-accent-bright hover:to-accent-2 text-accent-fg font-black text-xs sm:text-sm flex items-center gap-1.5 shadow-md disabled:opacity-50 transition-all"
            >
              {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              <span>Search</span>
            </button>
          </form>

          {/* Quick Alternative Name Chips */}
          {Array.isArray(manga.altTitles) && manga.altTitles.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-[11px] font-bold text-muted">Try Alt:</span>
              {manga.altTitles.slice(0, 4).map((alt, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    setSearchQuery(alt);
                    handleSearch(alt);
                  }}
                  className="px-2.5 py-0.5 rounded-lg bg-surface hover:bg-elevated text-secondary hover:text-primary border border-edge text-[11px] font-semibold transition-all line-clamp-1 max-w-[200px]"
                >
                  {alt}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
          {errorMsg && (
            <div className="p-3 bg-danger/10 border border-danger/30 rounded-xl text-xs text-danger flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {isSearching ? (
            <div className="py-16 text-center space-y-3">
              <Loader2 className="w-8 h-8 text-accent-2 animate-spin mx-auto" />
              <p className="text-xs font-bold text-secondary">
                Searching across live chapter sources (Asura Scans, Flame Comics, Madara, MangaThemesia)...
              </p>
            </div>
          ) : candidates.length === 0 ? (
            <div className="py-12 text-center space-y-3 bg-app/40 rounded-2xl border border-edge p-6">
              <Globe className="w-10 h-10 text-muted mx-auto" />
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-primary">No matching sources found</h4>
                <p className="text-xs text-secondary max-w-sm mx-auto">
                  Try searching with a shorter title keyword or one of the romanized alternate titles above.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-xs text-secondary px-1">
                <span className="font-bold">Found {candidates.length} Available Sources</span>
                <span className="text-[11px] text-muted">Click attach to link reading source</span>
              </div>

              {candidates.map((cand, idx) => {
                const isAttaching = attachingUrl === cand.sourceUrl;
                const isCurrent = cand.isCurrent || (manga.sourceUrl && cand.sourceUrl.toLowerCase() === manga.sourceUrl.toLowerCase());

                return (
                  <div
                    key={idx}
                    className={`p-3.5 rounded-2xl border transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
                      isCurrent
                        ? 'bg-accent/10 border-accent/40 shadow-sm'
                        : 'bg-app hover:bg-elevated/50 border-edge hover:border-edge-strong'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {cand.coverImage ? (
                        <img
                          src={cand.coverImage}
                          alt={cand.title}
                          className="w-11 h-14 rounded-xl object-cover bg-surface border border-edge shrink-0 shadow-sm"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      ) : (
                        <div className="w-11 h-14 rounded-xl bg-surface border border-edge flex items-center justify-center shrink-0 text-muted">
                          <BookOpen className="w-5 h-5" />
                        </div>
                      )}

                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-accent-2/20 text-accent-2 border border-accent-2/30">
                            {cand.sourceName}
                          </span>
                          {cand.confidence === 'exact' && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-success/20 text-success border border-success/30">
                              Exact Match
                            </span>
                          )}
                          {isCurrent && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-accent/20 text-accent border border-accent/30">
                              Current Source
                            </span>
                          )}
                        </div>

                        <h4 className="text-xs sm:text-sm font-bold text-primary line-clamp-1" title={cand.title}>
                          {cand.title}
                        </h4>

                        <p className="text-[11px] text-muted line-clamp-1 font-mono">
                          {cand.sourceUrl}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 w-full sm:w-auto justify-end shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-edge/60">
                      <a
                        href={cand.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 rounded-xl bg-surface hover:bg-elevated text-secondary hover:text-primary border border-edge transition-colors"
                        title="Preview Source Webpage"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>

                      <button
                        type="button"
                        onClick={() => handleAttachSource(cand)}
                        disabled={isAttaching || isCurrent}
                        className={`px-3.5 py-2 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all shadow-md ${
                          isCurrent
                            ? 'bg-surface text-muted border border-edge cursor-default'
                            : 'bg-gradient-to-r from-accent-2 to-accent hover:from-accent-2 hover:to-accent-bright text-accent-fg hover:scale-105 active:scale-95'
                        }`}
                      >
                        {isAttaching ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : isCurrent ? (
                          <Check className="w-3.5 h-3.5" />
                        ) : (
                          <Zap className="w-3.5 h-3.5 fill-accent-fg" />
                        )}
                        <span>{isCurrent ? 'Attached' : 'Use This Source'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Floating Success Toast */}
        {successToast && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 bg-elevated/95 backdrop-blur-md border border-success/50 text-success px-4 py-2.5 rounded-2xl shadow-2xl flex items-center gap-2 animate-in fade-in duration-200">
            <Check className="w-4 h-4" />
            <span className="text-xs font-bold">{successToast}</span>
          </div>
        )}

      </div>
    </div>
  );
};
