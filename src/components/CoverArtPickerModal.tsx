import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { apiFetch } from '../utils/api';
import { MangaItem } from '../types';
import {
  X,
  Image as ImageIcon,
  Check,
  Sparkles,
  RefreshCw,
  Search,
  Maximize2,
  Lock,
  Wand2,
  ExternalLink,
  Layers,
  CheckCircle2,
  AlertCircle,
  Eye,
  Columns2,
  ZoomIn,
  Copy,
} from 'lucide-react';

export interface CoverOption {
  url: string;
  label: string;
  source: string;
  category: 'active' | 'mangadex' | 'scraper' | 'anilist' | 'custom';
  volume?: string;
  locale?: string;
}

interface CoverArtPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentCoverUrl: string;
  mangaId?: string;
  mangaTitle: string;
  availableSources?: Array<{ sourceName?: string; sourceUrl?: string }>;
  onSelectCover: (coverUrl: string, sourceName?: string) => void;
}

export const CoverArtPickerModal: React.FC<CoverArtPickerModalProps> = ({
  isOpen,
  onClose,
  currentCoverUrl,
  mangaId,
  mangaTitle,
  availableSources,
  onSelectCover,
}) => {
  const [selectedCover, setSelectedCover] = useState<string>(currentCoverUrl || '');
  const [loading, setLoading] = useState(false);
  const [sources, setSources] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState(mangaTitle || '');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [customInputUrl, setCustomInputUrl] = useState('');
  const [customImgValid, setCustomImgValid] = useState<boolean | null>(null);
  const [customImgLoading, setCustomImgLoading] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<{ url: string; label: string; source: string } | null>(null);
  const [isCompareMode, setIsCompareMode] = useState(false);
  const [fitMode, setFitMode] = useState<'cover' | 'contain'>('cover');

  // Fetch covers from metadata-options endpoint
  const fetchCovers = useCallback(async (queryOverride?: string) => {
    if (!mangaId) return;
    setLoading(true);
    try {
      const qParam = queryOverride ? `?q=${encodeURIComponent(queryOverride)}` : '';
      const res = await apiFetch(`/api/manga/${mangaId}/metadata-options${qParam}`);
      if (res.ok) {
        const data = await res.json();
        if (data.sources) {
          setSources(data.sources);
        }
      }
    } catch (e) {
      console.error('Failed to load covers:', e);
    } finally {
      setLoading(false);
    }
  }, [mangaId]);

  useEffect(() => {
    if (isOpen) {
      setSelectedCover(currentCoverUrl || '');
      setSearchQuery(mangaTitle || '');
      fetchCovers();
    }
  }, [isOpen, currentCoverUrl, mangaTitle, fetchCovers]);

  // Aggregate all unique cover options
  const allCovers = useMemo(() => {
    const list: CoverOption[] = [];
    const seen = new Set<string>();

    const add = (url: string, label: string, source: string, category: CoverOption['category'], volume?: string, locale?: string) => {
      if (!url) return;
      const key = url.trim();
      if (seen.has(key)) return;
      seen.add(key);
      list.push({ url: key, label, source, category, volume, locale });
    };

    // 1. Current Active
    if (currentCoverUrl) {
      add(currentCoverUrl, 'Currently Active Artwork', 'Active Cover', 'active');
    }

    // 2. Extracted from Sources
    for (const s of sources) {
      const isMd = (s.sourceName || '').toLowerCase().includes('mangadex');
      const isAni = (s.sourceName || '').toLowerCase().includes('anilist');
      const cat: CoverOption['category'] = isMd ? 'mangadex' : isAni ? 'anilist' : 'scraper';

      if (Array.isArray(s.covers) && s.covers.length > 0) {
        for (const c of s.covers) {
          add(c.url, c.label || `${s.sourceName} Artwork`, s.sourceName || 'Source', cat);
        }
      } else if (s.coverImage) {
        add(s.coverImage, `${s.sourceName} Artwork`, s.sourceName || 'Source', cat);
      }
    }

    return list;
  }, [currentCoverUrl, sources]);

  // Filtered by category tab
  const filteredCovers = useMemo(() => {
    if (activeCategory === 'all') return allCovers;
    if (activeCategory === 'mangadex') return allCovers.filter((c) => c.category === 'mangadex');
    if (activeCategory === 'scraper') return allCovers.filter((c) => c.category === 'scraper');
    if (activeCategory === 'anilist') return allCovers.filter((c) => c.category === 'anilist');
    return allCovers;
  }, [allCovers, activeCategory]);

  // Handle custom URL validation
  const validateCustomUrl = (url: string) => {
    const trimmed = url.trim();
    setCustomInputUrl(trimmed);
    if (!trimmed) {
      setCustomImgValid(null);
      setCustomImgLoading(false);
      return;
    }
    setCustomImgLoading(true);
    setCustomImgValid(null);
    const img = new Image();
    img.onload = () => {
      setCustomImgLoading(false);
      setCustomImgValid(true);
    };
    img.onerror = () => {
      setCustomImgLoading(false);
      setCustomImgValid(false);
    };
    img.src = trimmed;
  };

  const handleApply = () => {
    if (!selectedCover) return;
    const item = allCovers.find((c) => c.url === selectedCover);
    onSelectCover(selectedCover, item?.source || 'Custom Selection');
    onClose();
  };

  if (!isOpen) return null;

  const countMd = allCovers.filter((c) => c.category === 'mangadex').length;
  const countScrapers = allCovers.filter((c) => c.category === 'scraper').length;
  const countAni = allCovers.filter((c) => c.category === 'anilist').length;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 overflow-y-auto animate-in fade-in duration-200"
    >
      <div className="bg-surface border border-edge rounded-2xl max-w-5xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden my-auto">
        {/* Header */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-app via-surface to-app border-b border-edge flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 rounded-xl bg-accent/15 text-accent border border-accent/30 shrink-0">
              <ImageIcon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base sm:text-lg font-black text-primary truncate">Interactive Cover Art Studio</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-accent/15 text-accent border border-accent/30">
                  {allCovers.length} available covers
                </span>
              </div>
              <p className="text-xs text-secondary truncate">{mangaTitle}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setIsCompareMode(!isCompareMode)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 border transition-all ${
                isCompareMode
                  ? 'bg-accent text-accent-fg border-accent'
                  : 'bg-elevated text-secondary hover:text-primary border-edge'
              }`}
              title="Toggle Side-by-Side Comparison"
            >
              <Columns2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Compare Mode</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-full bg-elevated/80 text-secondary hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Search & Discovery Toolbar */}
        <div className="p-3 sm:p-4 bg-app border-b border-edge flex flex-col sm:flex-row items-center gap-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              fetchCovers(searchQuery);
            }}
            className="relative flex-1 w-full"
          >
            <Search className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search alternate titles for MangaDex volume covers & AniList art..."
              className="w-full bg-surface border border-edge rounded-xl pl-9 pr-24 py-2 text-xs text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
            />
            <button
              type="submit"
              disabled={loading}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 px-3 py-1 rounded-lg bg-accent hover:bg-accent-bright text-accent-fg font-bold text-xs flex items-center gap-1 shadow-sm transition-all"
            >
              <Sparkles className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
              <span>{loading ? 'Searching...' : 'Search Art'}</span>
            </button>
          </form>

          {/* Category Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
            <button
              onClick={() => setActiveCategory('all')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                activeCategory === 'all'
                  ? 'bg-accent text-accent-fg font-black shadow-sm'
                  : 'bg-elevated text-secondary hover:text-primary'
              }`}
            >
              All ({allCovers.length})
            </button>
            {countMd > 0 && (
              <button
                onClick={() => setActiveCategory('mangadex')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                  activeCategory === 'mangadex'
                    ? 'bg-accent text-accent-fg font-black shadow-sm'
                    : 'bg-elevated text-secondary hover:text-primary'
                }`}
              >
                MangaDex Volumes ({countMd})
              </button>
            )}
            {countScrapers > 0 && (
              <button
                onClick={() => setActiveCategory('scraper')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                  activeCategory === 'scraper'
                    ? 'bg-accent text-accent-fg font-black shadow-sm'
                    : 'bg-elevated text-secondary hover:text-primary'
                }`}
              >
                Attached Scrapers ({countScrapers})
              </button>
            )}
            {countAni > 0 && (
              <button
                onClick={() => setActiveCategory('anilist')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                  activeCategory === 'anilist'
                    ? 'bg-accent text-accent-fg font-black shadow-sm'
                    : 'bg-elevated text-secondary hover:text-primary'
                }`}
              >
                AniList HQ ({countAni})
              </button>
            )}
          </div>
        </div>

        {/* Comparison Bar (if enabled) */}
        {isCompareMode && (
          <div className="p-4 bg-accent/5 border-b border-edge grid grid-cols-2 gap-4 animate-in fade-in duration-200">
            <div className="flex items-center gap-3 p-3 bg-surface/80 rounded-xl border border-edge">
              <img
                src={currentCoverUrl}
                alt="Current"
                className="w-12 h-16 rounded-lg object-cover bg-app border border-edge shrink-0"
              />
              <div className="min-w-0">
                <span className="text-[10px] font-black uppercase tracking-wider text-muted block">Current Active Cover</span>
                <p className="text-xs font-bold text-primary truncate">{mangaTitle}</p>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 bg-surface/80 rounded-xl border border-accent/40 shadow-sm">
              <img
                src={selectedCover}
                alt="Candidate"
                className="w-12 h-16 rounded-lg object-cover bg-app border border-accent shrink-0"
              />
              <div className="min-w-0 flex-1">
                <span className="text-[10px] font-black uppercase tracking-wider text-accent block flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Selected Candidate
                </span>
                <p className="text-xs font-bold text-primary truncate">
                  {allCovers.find((c) => c.url === selectedCover)?.label || 'Custom Artwork URL'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFitMode(fitMode === 'cover' ? 'contain' : 'cover')}
                className="px-2 py-1 rounded bg-elevated text-[10px] font-bold text-secondary hover:text-primary"
              >
                Fit: {fitMode}
              </button>
            </div>
          </div>
        )}

        {/* Body Content */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-6">
          {/* Cover Grid */}
          {loading && allCovers.length <= 1 ? (
            <div className="py-16 text-center text-secondary flex flex-col items-center gap-3">
              <RefreshCw className="w-8 h-8 animate-spin text-accent" />
              <p className="text-xs font-bold text-primary">Searching connected scrapers, MangaDex & AniList for cover art...</p>
              <p className="text-[11px] text-muted">Aggregating volume covers, localized variants, and high-resolution posters.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5 sm:gap-4">
              {filteredCovers.map((cover, idx) => {
                const isSelected = selectedCover === cover.url;
                const isCurrent = currentCoverUrl === cover.url;

                return (
                  <div
                    key={idx}
                    onClick={() => setSelectedCover(cover.url)}
                    className={`group relative rounded-2xl overflow-hidden border cursor-pointer transition-all duration-200 hover:scale-[1.02] shadow-md flex flex-col ${
                      isSelected
                        ? 'border-accent ring-2 ring-accent/50 shadow-accent/25 bg-accent/5'
                        : 'border-edge bg-app/80 hover:border-accent-2/60'
                    }`}
                  >
                    {/* Poster Canvas */}
                    <div className="aspect-[3/4] w-full bg-surface relative overflow-hidden">
                      <img
                        src={cover.url}
                        alt={cover.label}
                        className={`w-full h-full ${fitMode === 'contain' ? 'object-contain bg-black/40' : 'object-cover'} group-hover:scale-105 transition-transform duration-300`}
                        loading="lazy"
                      />

                      {/* Status Badges */}
                      <div className="absolute top-2 right-2 flex flex-col gap-1 items-end">
                        {isSelected && (
                          <div className="px-2 py-0.5 rounded-lg bg-accent text-accent-fg font-black text-[10px] flex items-center gap-1 shadow-lg">
                            <Check className="w-3 h-3 stroke-[3]" />
                            <span>SELECTED</span>
                          </div>
                        )}
                        {isCurrent && (
                          <div className="px-2 py-0.5 rounded-lg bg-surface/90 text-white font-bold text-[9px] border border-edge shadow">
                            Active
                          </div>
                        )}
                      </div>

                      {/* Lightbox Trigger */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setLightboxUrl(cover);
                        }}
                        className="absolute top-2 left-2 p-1.5 rounded-lg bg-black/60 hover:bg-black/90 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Enlarge & inspect full artwork"
                      >
                        <ZoomIn className="w-3.5 h-3.5" />
                      </button>

                      {/* Bottom Meta Overlay */}
                      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/95 via-black/70 to-transparent p-2.5 pt-6">
                        <span className="text-[9px] font-black uppercase tracking-wider text-accent-2 block truncate">
                          {cover.source}
                        </span>
                        <span className="text-xs font-bold text-white block truncate">{cover.label}</span>
                      </div>
                    </div>

                    {/* Bottom Action Footer */}
                    <div className="p-2.5 bg-surface border-t border-edge flex items-center justify-between text-[11px] mt-auto">
                      <span className="text-secondary text-[10px] font-semibold truncate max-w-[90px]">{cover.label}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedCover(cover.url);
                        }}
                        className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${
                          isSelected
                            ? 'bg-accent text-accent-fg shadow-sm'
                            : 'bg-elevated group-hover:bg-accent group-hover:text-accent-fg text-secondary'
                        }`}
                      >
                        {isSelected ? 'Selected' : 'Pick'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Custom Cover URL Input Bar */}
          <div className="bg-app p-4 rounded-2xl border border-edge space-y-3">
            <div className="flex items-center justify-between">
              <h5 className="text-xs font-bold text-primary flex items-center gap-1.5">
                <Wand2 className="w-4 h-4 text-accent" />
                Custom Cover URL / Poster Link:
              </h5>
              {customImgValid === true && (
                <span className="text-[11px] font-bold text-success flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Valid Image Loaded
                </span>
              )}
              {customImgValid === false && (
                <span className="text-[11px] font-bold text-danger flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" /> Image failed to load
                </span>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={customInputUrl}
                onChange={(e) => validateCustomUrl(e.target.value)}
                placeholder="Paste any custom direct image URL (https://...jpg, png, webp)"
                className="flex-1 bg-surface border border-edge rounded-xl px-3 py-2.5 text-xs text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
              />
              <button
                type="button"
                onClick={() => {
                  if (customInputUrl.trim()) {
                    setSelectedCover(customInputUrl.trim());
                  }
                }}
                disabled={!customInputUrl.trim() || customImgValid === false}
                className="px-4 py-2.5 rounded-xl bg-accent hover:bg-accent-bright disabled:opacity-50 text-accent-fg font-bold text-xs whitespace-nowrap shadow-sm transition-all"
              >
                Use Custom Link
              </button>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 sm:p-5 bg-app border-t border-edge flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            {selectedCover && (
              <div className="flex items-center gap-2">
                <img
                  src={selectedCover}
                  alt="Chosen Cover"
                  className="w-8 h-11 rounded-md object-cover bg-surface border border-edge shrink-0"
                />
                <div className="hidden sm:block min-w-0">
                  <span className="text-[10px] font-bold text-muted block">READY TO APPLY</span>
                  <span className="text-xs font-bold text-primary truncate max-w-xs block">
                    {allCovers.find((c) => c.url === selectedCover)?.label || 'Custom Artwork Selection'}
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl bg-elevated hover:bg-elevated/80 text-secondary hover:text-white font-semibold text-xs"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={!selectedCover}
              className="px-6 py-2.5 rounded-xl bg-accent hover:bg-accent-bright text-accent-fg font-bold text-xs shadow-lg transition-all flex items-center gap-1.5"
            >
              <Check className="w-4 h-4 stroke-[3]" />
              <span>Apply Cover Art</span>
            </button>
          </div>
        </div>
      </div>

      {/* Lightbox Modal */}
      {lightboxUrl && (
        <div
          onClick={() => setLightboxUrl(null)}
          className="fixed inset-0 z-[130] bg-black/90 backdrop-blur-lg flex items-center justify-center p-4 animate-in fade-in duration-150"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-w-xl max-h-[90vh] bg-surface border border-edge rounded-2xl overflow-hidden shadow-2xl flex flex-col"
          >
            <div className="p-3 bg-app border-b border-edge flex items-center justify-between">
              <div>
                <span className="text-[10px] font-black uppercase text-accent-2 block">{lightboxUrl.source}</span>
                <span className="text-xs font-bold text-primary">{lightboxUrl.label}</span>
              </div>
              <button
                onClick={() => setLightboxUrl(null)}
                className="p-1.5 rounded-full bg-elevated text-secondary hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 flex items-center justify-center bg-black/50 overflow-auto">
              <img
                src={lightboxUrl.url}
                alt={lightboxUrl.label}
                className="max-h-[75vh] w-auto object-contain rounded-xl shadow-2xl"
              />
            </div>
            <div className="p-3 bg-app border-t border-edge flex items-center justify-between">
              <a
                href={lightboxUrl.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-accent hover:underline flex items-center gap-1 font-semibold"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Open high-res original</span>
              </a>
              <button
                type="button"
                onClick={() => {
                  setSelectedCover(lightboxUrl.url);
                  setLightboxUrl(null);
                }}
                className="px-4 py-1.5 rounded-xl bg-accent text-accent-fg font-bold text-xs"
              >
                Select This Cover
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
