import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../utils/api';
import { MangaItem, isNsfwManga, getNsfwDetectionReason } from '../types';
import {
  X,
  Image as ImageIcon,
  Sliders,
  Lock,
  Unlock,
  Check,
  Sparkles,
  RefreshCw,
  ExternalLink,
  Layers,
  Wand2,
  CheckCircle2,
  AlertTriangle,
  Star,
  Globe,
  Tag,
  FileText,
  BookMarked,
  ArrowRight,
  Palette,
  ShieldCheck,
  ZoomIn,
  Search,
  Flame,
} from 'lucide-react';

interface SourceOption {
  sourceName: string;
  sourceUrl: string;
  title?: string;
  description?: string;
  coverImage?: string;
  covers?: Array<{ url: string; label?: string }>;
  rating?: number;
  genres?: string[];
  altTitles?: string[];
}

interface MetadataStudioModalProps {
  manga: MangaItem;
  isOpen: boolean;
  onClose: () => void;
  onUpdateManga: (updated: MangaItem) => void;
}

export const MetadataStudioModal: React.FC<MetadataStudioModalProps> = ({
  manga,
  isOpen,
  onClose,
  onUpdateManga,
}) => {
  const [activeTab, setActiveTab] = useState<'covers' | 'fields' | 'sources'>('covers');
  const [loading, setLoading] = useState(false);
  const [sources, setSources] = useState<SourceOption[]>([]);
  const [customCoverUrl, setCustomCoverUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Field state
  const [currentCover, setCurrentCover] = useState(manga.coverImage);
  const [currentTitle, setCurrentTitle] = useState(manga.title);
  const [currentDesc, setCurrentDesc] = useState(manga.description || '');
  const [currentRating, setCurrentRating] = useState(manga.rating || 8.0);
  const [currentGenres, setCurrentGenres] = useState<string[]>(manga.genres || []);
  const [currentAltTitles, setCurrentAltTitles] = useState<string[]>(manga.altTitles || []);
  const [currentIsNsfw, setCurrentIsNsfw] = useState<boolean>(
    manga.isNsfw !== undefined ? Boolean(manga.isNsfw) : isNsfwManga(manga)
  );
  const [locks, setLocks] = useState<Set<string>>(new Set(manga.metadataOverrides || []));
  const [coverSearchQuery, setCoverSearchQuery] = useState(manga.title || '');
  const [coverCategory, setCoverCategory] = useState<string>('all');
  const [lightboxCover, setLightboxCover] = useState<{ url: string; label: string; source: string } | null>(null);

  const fetchOptions = useCallback(async (qOverride?: string) => {
    setLoading(true);
    try {
      const qParam = qOverride ? `?q=${encodeURIComponent(qOverride)}` : '';
      const res = await apiFetch(`/api/manga/${manga.id}/metadata-options${qParam}`);
      if (res.ok) {
        const data = await res.json();
        if (data.sources) {
          setSources(data.sources);
        }
      }
    } catch (e) {
      console.error('Failed to load metadata options:', e);
    } finally {
      setLoading(false);
    }
  }, [manga.id]);

  useEffect(() => {
    if (isOpen) {
      setCurrentCover(manga.coverImage);
      setCurrentTitle(manga.title);
      setCurrentDesc(manga.description || '');
      setCurrentRating(manga.rating || 8.0);
      setCurrentGenres(manga.genres || []);
      setCurrentAltTitles(manga.altTitles || []);
      setCurrentIsNsfw(manga.isNsfw !== undefined ? Boolean(manga.isNsfw) : isNsfwManga(manga));
      setLocks(new Set(manga.metadataOverrides || []));
      fetchOptions();
    }
  }, [isOpen, manga, fetchOptions]);

  if (!isOpen) return null;

  const toggleLock = (field: string) => {
    setLocks((prev) => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  };

  const handleSelectCover = async (coverUrl: string, sourceName?: string) => {
    setCurrentCover(coverUrl);
    // Automatically lock coverImage when user explicitly picks a cover (Plex/Jellyfin standard)
    const nextLocks = new Set(locks);
    nextLocks.add('coverImage');
    setLocks(nextLocks);

    setSaving(true);
    try {
      const res = await apiFetch(`/api/manga/${manga.id}/custom-metadata-update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coverImage: coverUrl,
          metadataOverrides: Array.from(nextLocks),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.manga) {
          onUpdateManga(data.manga);
          setSuccessMsg(`Cover updated${sourceName ? ` from ${sourceName}` : ''}! (Locked)`);
          setTimeout(() => setSuccessMsg(null), 3000);
        }
      }
    } catch (e) {
      console.error('Failed to save cover:', e);
    } finally {
      setSaving(false);
    }
  };

  const handleAdoptField = (field: string, value: any) => {
    const nextLocks = new Set(locks);
    nextLocks.add(field);
    setLocks(nextLocks);

    if (field === 'title') setCurrentTitle(value);
    if (field === 'description') setCurrentDesc(value);
    if (field === 'rating') setCurrentRating(Number(value));
    if (field === 'genres') setCurrentGenres(Array.isArray(value) ? value : []);
    if (field === 'altTitles') setCurrentAltTitles(Array.isArray(value) ? value : []);

    setSuccessMsg(`Adopted ${field} and locked!`);
    setTimeout(() => setSuccessMsg(null), 2500);
  };

  const handleApplyAllFromSource = async (source: SourceOption) => {
    setSaving(true);
    try {
      const res = await apiFetch(`/api/manga/${manga.id}/pull-metadata-from-source`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceUrl: source.sourceUrl,
          sourceName: source.sourceName,
          fields: ['title', 'description', 'coverImage', 'rating', 'genres', 'altTitles'],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.manga) {
          onUpdateManga(data.manga);
          setCurrentCover(data.manga.coverImage);
          setCurrentTitle(data.manga.title);
          setCurrentDesc(data.manga.description || '');
          setCurrentRating(data.manga.rating || 8.0);
          setCurrentGenres(data.manga.genres || []);
          setCurrentAltTitles(data.manga.altTitles || []);
          setLocks(new Set(data.manga.metadataOverrides || []));
          setSuccessMsg(`Applied all metadata from ${source.sourceName}!`);
          setTimeout(() => setSuccessMsg(null), 3000);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const handleMultiProviderEnrich = async () => {
    setSaving(true);
    try {
      const res = await apiFetch(`/api/metadata/enrich-manga/${manga.id}`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.manga) {
          onUpdateManga(data.manga);
          setCurrentCover(data.manga.coverImage);
          setCurrentTitle(data.manga.title);
          setCurrentDesc(data.manga.description || '');
          setCurrentRating(data.manga.rating || 8.0);
          setCurrentGenres(data.manga.genres || []);
          setCurrentAltTitles(data.manga.altTitles || []);
          setSuccessMsg(`Multi-Provider Aggregation complete! (AniList + MangaUpdates + MangaDex)`);
          setTimeout(() => setSuccessMsg(null), 3000);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };


  const handleSaveAll = async () => {
    setSaving(true);
    try {
      const res = await apiFetch(`/api/manga/${manga.id}/custom-metadata-update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: currentTitle,
          description: currentDesc,
          coverImage: currentCover,
          rating: Number(currentRating),
          genres: currentGenres,
          altTitles: currentAltTitles,
          isNsfw: currentIsNsfw,
          metadataOverrides: Array.from(locks),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.manga) {
          onUpdateManga(data.manga);
          setSuccessMsg('All metadata changes saved successfully!');
          setTimeout(() => {
            setSuccessMsg(null);
            onClose();
          }, 1000);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  // Collect all unique cover images from sources
  const allCovers: Array<{ url: string; label: string; source: string }> = [];
  const seenCoverUrls = new Set<string>();

  // Current active cover
  if (currentCover) {
    seenCoverUrls.add(currentCover);
    allCovers.push({
      url: currentCover,
      label: 'Currently Active Cover',
      source: 'Active Selection',
    });
  }

  for (const s of sources) {
    if (s.covers && s.covers.length > 0) {
      for (const c of s.covers) {
        if (!seenCoverUrls.has(c.url)) {
          seenCoverUrls.add(c.url);
          allCovers.push({
            url: c.url,
            label: c.label || `${s.sourceName} Cover`,
            source: s.sourceName,
          });
        }
      }
    } else if (s.coverImage && !seenCoverUrls.has(s.coverImage)) {
      seenCoverUrls.add(s.coverImage);
      allCovers.push({
        url: s.coverImage,
        label: `${s.sourceName} Artwork`,
        source: s.sourceName,
      });
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-surface border border-edge rounded-2xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden my-auto">
        {/* Header */}
        <div className="p-5 bg-gradient-to-r from-app via-surface to-app border-b border-edge flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-accent-2/15 text-accent-2 border border-accent-2/30">
              <Palette className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-black text-primary">Metadata & Poster Studio</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-accent/20 text-accent border border-accent/30 flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" /> Jellyfin & Plex Sync
                </span>
              </div>
              <p className="text-xs text-secondary truncate max-w-md">{manga.title}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleMultiProviderEnrich}
              disabled={saving}
              className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-accent/20 to-purple-500/20 text-accent border border-accent/40 hover:border-accent text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm disabled:opacity-50"
              title="Query AniList, MangaUpdates, MangaDex & MAL simultaneously to enrich genres, covers & description"
            >
              <Sparkles className="w-3.5 h-3.5 text-accent animate-pulse" />
              <span>Auto-Enrich (Multi-Provider)</span>
            </button>

            <button
              onClick={onClose}
              className="p-2 rounded-full bg-elevated/80 text-secondary hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="px-5 pt-3 bg-app border-b border-edge flex items-center gap-2 overflow-x-auto">
          <button
            onClick={() => setActiveTab('covers')}
            className={`px-4 py-2.5 rounded-t-xl text-xs font-bold flex items-center gap-2 border-b-2 transition-all ${
              activeTab === 'covers'
                ? 'border-accent text-accent bg-surface'
                : 'border-transparent text-secondary hover:text-primary'
            }`}
          >
            <ImageIcon className="w-4 h-4" />
            <span>Poster & Cover Artwork ({allCovers.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('fields')}
            className={`px-4 py-2.5 rounded-t-xl text-xs font-bold flex items-center gap-2 border-b-2 transition-all ${
              activeTab === 'fields'
                ? 'border-accent text-accent bg-surface'
                : 'border-transparent text-secondary hover:text-primary'
            }`}
          >
            <Sliders className="w-4 h-4" />
            <span>Field Locker & Matrix</span>
          </button>

          <button
            onClick={() => setActiveTab('sources')}
            className={`px-4 py-2.5 rounded-t-xl text-xs font-bold flex items-center gap-2 border-b-2 transition-all ${
              activeTab === 'sources'
                ? 'border-accent text-accent bg-surface'
                : 'border-transparent text-secondary hover:text-primary'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>Source Presets ({sources.length})</span>
          </button>

          <div className="ml-auto flex items-center gap-2 pb-2">
            <button
              onClick={() => fetchOptions()}
              disabled={loading}
              className="px-2.5 py-1 rounded-lg bg-elevated hover:bg-elevated/80 text-secondary hover:text-primary text-xs font-semibold flex items-center gap-1.5 transition-all"
              title="Re-query connected sources for latest art and fields"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-info' : ''}`} />
              <span>Refresh Sources</span>
            </button>
          </div>
        </div>

        {/* Banner Alert */}
        {successMsg && (
          <div className="px-5 py-2.5 bg-success/15 border-b border-success/30 text-success text-xs font-bold flex items-center gap-2 animate-fadeIn">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Body Content */}
        <div className="p-5 sm:p-6 overflow-y-auto flex-1 space-y-6">
          {/* TAB 1: COVERS & ARTWORK GALLERY */}
          {activeTab === 'covers' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-app/60 p-4 rounded-xl border border-edge">
                <div>
                  <h4 className="text-sm font-bold text-primary flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-accent" />
                    Available Artwork & Posters Across Sources
                  </h4>
                  <p className="text-xs text-secondary">
                    Click any cover art to adopt it. Custom selection locks artwork from future auto-refreshes.
                  </p>
                </div>

                <div className="flex items-center gap-2 text-xs">
                  <span className="flex items-center gap-1 text-accent font-bold">
                    <Lock className="w-3.5 h-3.5" />
                    {locks.has('coverImage') ? 'Cover is Locked' : 'Auto-sync active'}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleLock('coverImage')}
                    className="px-2.5 py-1 rounded bg-elevated text-secondary hover:text-primary text-[11px] font-semibold"
                  >
                    {locks.has('coverImage') ? 'Unlock' : 'Lock'}
                  </button>
                </div>
              </div>

              {/* Cover Art Search & Filter Bar */}
              <div className="flex flex-col sm:flex-row items-center gap-3 bg-app p-3 rounded-xl border border-edge">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    fetchOptions(coverSearchQuery);
                  }}
                  className="relative flex-1 w-full"
                >
                  <Search className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={coverSearchQuery}
                    onChange={(e) => setCoverSearchQuery(e.target.value)}
                    placeholder="Search alternate titles for MangaDex volume covers & AniList HQ art..."
                    className="w-full bg-surface border border-edge rounded-xl pl-9 pr-20 py-2 text-xs text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
                  />
                  <button
                    type="submit"
                    disabled={loading}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2.5 py-1 rounded-lg bg-accent text-accent-fg font-bold text-xs flex items-center gap-1 shadow-sm"
                  >
                    <Sparkles className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
                    <span>Search</span>
                  </button>
                </form>

                <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto">
                  <button
                    onClick={() => setCoverCategory('all')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                      coverCategory === 'all'
                        ? 'bg-accent text-accent-fg font-black shadow-sm'
                        : 'bg-elevated text-secondary hover:text-primary'
                    }`}
                  >
                    All ({allCovers.length})
                  </button>
                  <button
                    onClick={() => setCoverCategory('mangadex')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                      coverCategory === 'mangadex'
                        ? 'bg-accent text-accent-fg font-black shadow-sm'
                        : 'bg-elevated text-secondary hover:text-primary'
                    }`}
                  >
                    MangaDex ({allCovers.filter(c => c.source.toLowerCase().includes('mangadex')).length})
                  </button>
                  <button
                    onClick={() => setCoverCategory('anilist')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                      coverCategory === 'anilist'
                        ? 'bg-accent text-accent-fg font-black shadow-sm'
                        : 'bg-elevated text-secondary hover:text-primary'
                    }`}
                  >
                    AniList ({allCovers.filter(c => c.source.toLowerCase().includes('anilist')).length})
                  </button>
                </div>
              </div>

              {/* Cover Grid */}
              {loading && allCovers.length <= 1 ? (
                <div className="p-12 text-center text-secondary flex flex-col items-center gap-3">
                  <RefreshCw className="w-8 h-8 animate-spin text-accent" />
                  <span className="text-xs font-bold">Fetching artwork options from all connected sources...</span>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                  {allCovers
                    .filter((cover) => {
                      if (coverCategory === 'all') return true;
                      if (coverCategory === 'mangadex') return cover.source.toLowerCase().includes('mangadex');
                      if (coverCategory === 'anilist') return cover.source.toLowerCase().includes('anilist');
                      return true;
                    })
                    .map((cover, idx) => {
                    const isActive = currentCover === cover.url;
                    return (
                      <div
                        key={idx}
                        onClick={() => handleSelectCover(cover.url, cover.source)}
                        className={`group relative rounded-xl overflow-hidden border cursor-pointer transition-all duration-200 hover:scale-[1.02] shadow-md ${
                          isActive
                            ? 'border-accent ring-2 ring-accent/50 shadow-accent/20'
                            : 'border-edge bg-app hover:border-accent-2/60'
                        }`}
                      >
                        <div className="aspect-[3/4] w-full bg-surface relative overflow-hidden">
                          <img
                            src={cover.url}
                            alt={cover.label}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            loading="lazy"
                          />

                          {/* Active Badge */}
                          {isActive && (
                            <div className="absolute top-2 right-2 px-2 py-1 rounded-lg bg-accent text-accent-fg font-black text-[10px] flex items-center gap-1 shadow-lg">
                              <Check className="w-3 h-3 stroke-[3]" />
                              <span>ACTIVE</span>
                            </div>
                          )}

                          {/* Lightbox trigger */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setLightboxCover(cover);
                            }}
                            className="absolute top-2 left-2 p-1.5 rounded-lg bg-black/60 hover:bg-black/90 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Inspect full image"
                          >
                            <ZoomIn className="w-3.5 h-3.5" />
                          </button>

                          {/* Source Tag */}
                          <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-2.5 pt-6">
                            <span className="text-[10px] font-black uppercase text-accent-2 block truncate">
                              {cover.source}
                            </span>
                            <span className="text-xs font-bold text-white block truncate">{cover.label}</span>
                          </div>
                        </div>

                        <div className="p-2.5 bg-surface flex items-center justify-between text-[11px]">
                          <span className="text-secondary truncate">{cover.label}</span>
                          <button
                            type="button"
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              isActive
                                ? 'bg-accent/20 text-accent'
                                : 'bg-elevated group-hover:bg-accent group-hover:text-accent-fg text-secondary'
                            }`}
                          >
                            {isActive ? 'Selected' : 'Use Artwork'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Custom Cover URL Input */}
              <div className="bg-app p-4 rounded-xl border border-edge space-y-3">
                <h5 className="text-xs font-bold text-primary flex items-center gap-1.5">
                  <Wand2 className="w-3.5 h-3.5 text-accent" />
                  Custom Cover URL / Poster Link:
                </h5>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="https://..."
                    value={customCoverUrl}
                    onChange={(e) => setCustomCoverUrl(e.target.value)}
                    className="flex-1 bg-surface border border-edge rounded-xl px-3 py-2 text-xs text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (customCoverUrl.trim()) {
                        handleSelectCover(customCoverUrl.trim(), 'Custom Link');
                        setCustomCoverUrl('');
                      }
                    }}
                    disabled={!customCoverUrl.trim()}
                    className="px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs disabled:opacity-50 transition-all hover:scale-105"
                  >
                    Set Custom Cover
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: FIELD LOCKER & MATRIX */}
          {activeTab === 'fields' && (
            <div className="space-y-6">
              <div className="bg-app/60 p-4 rounded-xl border border-edge flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-primary flex items-center gap-2">
                    <Lock className="w-4 h-4 text-accent" />
                    Plex / Jellyfin Field Locking & Provider Switching
                  </h4>
                  <p className="text-xs text-secondary">
                    Locking a field protects your custom choices from automated background metadata refreshes.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (locks.size > 0) setLocks(new Set());
                    else setLocks(new Set(['title', 'description', 'coverImage', 'rating', 'genres', 'altTitles']));
                  }}
                  className="px-3 py-1.5 rounded-lg bg-elevated hover:bg-elevated/80 text-xs font-bold text-secondary hover:text-primary transition-all"
                >
                  {locks.size > 0 ? 'Unlock All Fields' : 'Lock All Fields'}
                </button>
              </div>

              {/* Title Section */}
              <div className="bg-app p-4 rounded-xl border border-edge space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-primary flex items-center gap-2">
                    <FileText className="w-4 h-4 text-info" />
                    <span>Title</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => toggleLock('title')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 border transition-all ${
                      locks.has('title')
                        ? 'bg-accent/20 text-accent border-accent/40 shadow-sm'
                        : 'bg-elevated text-secondary border-edge hover:text-primary'
                    }`}
                  >
                    {locks.has('title') ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                    <span>{locks.has('title') ? 'Locked (Manual)' : 'Unlocked (Auto)'}</span>
                  </button>
                </div>

                <input
                  type="text"
                  value={currentTitle}
                  onChange={(e) => {
                    setCurrentTitle(e.target.value);
                    const next = new Set(locks);
                    next.add('title');
                    setLocks(next);
                  }}
                  className="w-full bg-surface border border-edge rounded-xl p-2.5 text-xs text-primary font-bold focus:outline-none focus:ring-2 focus:ring-accent/50"
                />

                {/* Source Options for Title */}
                <div className="space-y-1 pt-1">
                  <span className="text-[11px] font-bold text-secondary">Options from connected sources:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {sources
                      .filter((s) => s.title && s.title.trim())
                      .map((s, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => handleAdoptField('title', s.title)}
                          className="px-2.5 py-1 rounded-lg bg-surface border border-edge hover:border-info/50 text-[11px] text-primary flex items-center gap-1.5 transition-all text-left"
                        >
                          <span className="text-[10px] font-bold text-info uppercase">[{s.sourceName}]</span>
                          <span className="truncate max-w-xs">{s.title}</span>
                          <ArrowRight className="w-3 h-3 text-muted shrink-0" />
                        </button>
                      ))}
                  </div>
                </div>
              </div>

              {/* Synopsis / Description */}
              <div className="bg-app p-4 rounded-xl border border-edge space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-primary flex items-center gap-2">
                    <FileText className="w-4 h-4 text-info" />
                    <span>Synopsis / Description</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => toggleLock('description')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 border transition-all ${
                      locks.has('description')
                        ? 'bg-accent/20 text-accent border-accent/40 shadow-sm'
                        : 'bg-elevated text-secondary border-edge hover:text-primary'
                    }`}
                  >
                    {locks.has('description') ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                    <span>{locks.has('description') ? 'Locked (Manual)' : 'Unlocked (Auto)'}</span>
                  </button>
                </div>

                <textarea
                  rows={3}
                  value={currentDesc}
                  onChange={(e) => {
                    setCurrentDesc(e.target.value);
                    const next = new Set(locks);
                    next.add('description');
                    setLocks(next);
                  }}
                  className="w-full bg-surface border border-edge rounded-xl p-2.5 text-xs text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
                />

                {/* Source Options for Description */}
                <div className="space-y-1.5 pt-1">
                  <span className="text-[11px] font-bold text-secondary">Options from connected sources:</span>
                  <div className="space-y-2">
                    {sources
                      .filter((s) => s.description && s.description.trim())
                      .map((s, idx) => (
                        <div
                          key={idx}
                          className="p-2.5 rounded-xl bg-surface border border-edge flex items-start justify-between gap-3 text-xs"
                        >
                          <div className="space-y-1 min-w-0">
                            <span className="text-[10px] font-black uppercase text-info block">{s.sourceName}:</span>
                            <p className="text-secondary line-clamp-2 text-[11px] leading-relaxed">{s.description}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleAdoptField('description', s.description)}
                            className="px-3 py-1.5 rounded-lg bg-elevated hover:bg-accent hover:text-accent-fg font-bold text-[11px] shrink-0 transition-all"
                          >
                            Adopt
                          </button>
                        </div>
                      ))}
                  </div>
                </div>
              </div>

              {/* Rating & Genres */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Rating */}
                <div className="bg-app p-4 rounded-xl border border-edge space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-primary flex items-center gap-2">
                      <Star className="w-4 h-4 text-accent" />
                      <span>Rating (1 - 10)</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => toggleLock('rating')}
                      className={`p-1 rounded ${locks.has('rating') ? 'text-accent' : 'text-secondary'}`}
                    >
                      {locks.has('rating') ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="10"
                    value={currentRating}
                    onChange={(e) => {
                      setCurrentRating(Number(e.target.value));
                      const next = new Set(locks);
                      next.add('rating');
                      setLocks(next);
                    }}
                    className="w-full bg-surface border border-edge rounded-xl p-2.5 text-xs text-primary font-bold focus:outline-none focus:ring-2 focus:ring-accent/50"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {sources
                      .filter((s) => typeof s.rating === 'number' && s.rating > 0)
                      .map((s, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => handleAdoptField('rating', s.rating)}
                          className="px-2 py-0.5 rounded bg-surface border border-edge text-[10px] text-secondary hover:text-primary"
                        >
                          {s.sourceName}: <strong className="text-accent">{s.rating}</strong>
                        </button>
                      ))}
                  </div>
                </div>

                {/* Genres */}
                <div className="bg-app p-4 rounded-xl border border-edge space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-primary flex items-center gap-2">
                      <Tag className="w-4 h-4 text-info" />
                      <span>Genres</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => toggleLock('genres')}
                      className={`p-1 rounded ${locks.has('genres') ? 'text-accent' : 'text-secondary'}`}
                    >
                      {locks.has('genres') ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <input
                    type="text"
                    value={currentGenres.join(', ')}
                    onChange={(e) => {
                      setCurrentGenres(e.target.value.split(',').map((s) => s.trim()).filter(Boolean));
                      const next = new Set(locks);
                      next.add('genres');
                      setLocks(next);
                    }}
                    className="w-full bg-surface border border-edge rounded-xl p-2.5 text-xs text-primary font-semibold focus:outline-none focus:ring-2 focus:ring-accent/50"
                  />
                  <div className="flex flex-wrap gap-1">
                    {currentGenres.map((g, i) => (
                      <span key={i} className="px-2 py-0.5 rounded text-[10px] bg-elevated text-secondary font-medium">
                        {g}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Age Rating & 18+ NSFW Content */}
                <div className={`p-4 rounded-xl border transition-all space-y-3 ${
                  currentIsNsfw
                    ? 'bg-rose-500/10 border-rose-500/30'
                    : 'bg-app border-edge'
                }`}>
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-primary flex items-center gap-2">
                      <Flame className={`w-4 h-4 ${currentIsNsfw ? 'text-rose-400' : 'text-secondary'}`} />
                      <span>Age Rating & 18+ Content (NSFW)</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => toggleLock('isNsfw')}
                      className={`p-1 rounded ${locks.has('isNsfw') ? 'text-accent' : 'text-secondary'}`}
                    >
                      {locks.has('isNsfw') ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-3 bg-surface p-3 rounded-xl border border-edge">
                    <div className="space-y-0.5">
                      <div className="font-bold text-xs text-primary flex items-center gap-1.5">
                        <span>{currentIsNsfw ? 'Marked as 18+ / Adult Explicit' : 'Safe / All Ages'}</span>
                        {currentIsNsfw && (
                          <span className="px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-400 border border-rose-500/40 text-[9px] font-extrabold uppercase">
                            18+
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted">
                        {currentIsNsfw
                          ? 'This series will be hidden when the library filter is set to Safe.'
                          : 'Standard safe content. Toggle ON to mark as 18+ and synchronize with metadata.'}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        const nextNsfw = !currentIsNsfw;
                        setCurrentIsNsfw(nextNsfw);
                        const nextLocks = new Set(locks);
                        nextLocks.add('isNsfw');
                        setLocks(nextLocks);
                        if (nextNsfw) {
                          if (!currentGenres.some((g) => g.toLowerCase() === '18+' || g.toLowerCase() === 'adult')) {
                            setCurrentGenres([...currentGenres, '18+']);
                          }
                        } else {
                          setCurrentGenres(currentGenres.filter((g) => {
                            const glc = g.toLowerCase();
                            return glc !== '18+' && glc !== 'adult' && glc !== 'smut' && glc !== 'hentai' && glc !== 'erotica' && glc !== 'nsfw' && glc !== 'r18';
                          }));
                        }
                      }}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        currentIsNsfw ? 'bg-rose-500' : 'bg-edge-strong'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          currentIsNsfw ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>

                  {getNsfwDetectionReason(manga) && (
                    <div className="p-2.5 rounded-xl bg-app border border-rose-500/30 text-rose-300 text-[11px] font-medium flex items-center gap-2">
                      <Sparkles className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                      <span><strong>Auto-Detection Engine:</strong> {getNsfwDetectionReason(manga)}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: SOURCE PRESETS */}
          {activeTab === 'sources' && (
            <div className="space-y-4">
              <div className="bg-app/60 p-4 rounded-xl border border-edge">
                <h4 className="text-sm font-bold text-primary flex items-center gap-2">
                  <Globe className="w-4 h-4 text-accent" />
                  1-Click Source Metadata Presets
                </h4>
                <p className="text-xs text-secondary">
                  Choose a preferred source to adopt all of its metadata (Title, Synopsis, Poster Artwork, Genres, Ratings) in a single action.
                </p>
              </div>

              <div className="space-y-3">
                {sources.map((source, idx) => (
                  <div
                    key={idx}
                    className="p-4 rounded-xl bg-app border border-edge hover:border-edge-strong flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all"
                  >
                    <div className="flex items-start gap-3">
                      {source.coverImage && (
                        <img
                          src={source.coverImage}
                          alt={source.sourceName}
                          className="w-12 h-16 rounded-lg object-cover bg-surface border border-edge shrink-0"
                        />
                      )}
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-primary">{source.sourceName}</span>
                          {source.rating && (
                            <span className="px-1.5 py-0.5 rounded bg-accent/20 text-accent text-[10px] font-bold flex items-center gap-0.5">
                              <Star className="w-3 h-3 fill-accent" />
                              {source.rating}
                            </span>
                          )}
                        </div>
                        <a
                          href={source.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-info hover:underline flex items-center gap-1 truncate max-w-sm"
                        >
                          <span>{source.sourceUrl}</span>
                          <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                        {source.title && (
                          <p className="text-xs text-secondary font-medium truncate max-w-md">
                            Title: {source.title}
                          </p>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleApplyAllFromSource(source)}
                      disabled={saving}
                      className="px-4 py-2 rounded-xl bg-gradient-to-r from-accent-2 to-accent hover:from-accent hover:to-accent-2 text-accent-fg font-black text-xs shadow-md flex items-center gap-1.5 shrink-0 transition-all hover:scale-105 active:scale-95"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Use All Metadata from {source.sourceName}</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-app border-t border-edge flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-secondary">
            <span className="flex items-center gap-1">
              <Lock className="w-3.5 h-3.5 text-accent" /> {locks.size} locked field{locks.size !== 1 ? 's' : ''}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-elevated hover:bg-elevated/80 text-secondary hover:text-white text-xs font-bold transition-all"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveAll}
              disabled={saving}
              className="px-5 py-2 rounded-xl bg-accent hover:bg-accent-bright text-accent-fg font-bold text-xs shadow-lg transition-all flex items-center gap-1.5"
            >
              <Check className="w-4 h-4" />
              <span>Save & Apply</span>
            </button>
          </div>
        </div>
      </div>

      {/* Lightbox Modal */}
      {lightboxCover && (
        <div
          onClick={() => setLightboxCover(null)}
          className="fixed inset-0 z-[130] bg-black/90 backdrop-blur-lg flex items-center justify-center p-4 animate-in fade-in duration-150"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-w-xl max-h-[90vh] bg-surface border border-edge rounded-2xl overflow-hidden shadow-2xl flex flex-col"
          >
            <div className="p-3 bg-app border-b border-edge flex items-center justify-between">
              <div>
                <span className="text-[10px] font-black uppercase text-accent-2 block">{lightboxCover.source}</span>
                <span className="text-xs font-bold text-primary">{lightboxCover.label}</span>
              </div>
              <button
                onClick={() => setLightboxCover(null)}
                className="p-1.5 rounded-full bg-elevated text-secondary hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 flex items-center justify-center bg-black/50 overflow-auto">
              <img
                src={lightboxCover.url}
                alt={lightboxCover.label}
                className="max-h-[75vh] w-auto object-contain rounded-xl shadow-2xl"
              />
            </div>
            <div className="p-3 bg-app border-t border-edge flex items-center justify-between">
              <a
                href={lightboxCover.url}
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
                  handleSelectCover(lightboxCover.url, lightboxCover.source);
                  setLightboxCover(null);
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
