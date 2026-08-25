import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../utils/api';
import { MangaItem, isNsfwManga, getNsfwDetectionReason } from '../types';
import {
  X,
  ImageIcon,
  Sliders,
  Sparkles,
  RefreshCw,
  Layers,
  Palette,
  ShieldCheck,
  Check,
  CheckCircle2,
  Lock,
  ExternalLink,
} from 'lucide-react';
import { MetadataCoversTab } from './metadata/MetadataCoversTab';
import { MetadataFieldsTab } from './metadata/MetadataFieldsTab';
import { MetadataSourcesTab } from './metadata/MetadataSourcesTab';

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
      const query = qOverride || manga.title;
      const res: any = await apiFetch(`/api/manga/${manga.id}/metadata-options?q=${encodeURIComponent(query)}`);
      if (res && res.sources) {
        setSources(res.sources);
      }
    } catch (e) {
      console.error('[MetadataStudio] Failed to fetch metadata options:', e);
    } finally {
      setLoading(false);
    }
  }, [manga.id, manga.title]);

  useEffect(() => {
    if (isOpen) {
      fetchOptions();
    }
  }, [isOpen, fetchOptions]);

  const toggleLock = (field: string) => {
    setLocks((prev) => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  };

  const handleMultiProviderEnrich = async () => {
    setLoading(true);
    try {
      const res: any = await apiFetch(`/api/manga/${manga.id}/enrich`, { method: 'POST' });
      if (res && res.manga) {
        onUpdateManga(res.manga);
        setSuccessMsg('Enriched metadata from AniList, MangaUpdates & MangaDex!');
        setTimeout(() => setSuccessMsg(null), 3000);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveAll = async () => {
    setSaving(true);
    try {
      const updated: MangaItem = {
        ...manga,
        title: currentTitle,
        description: currentDesc,
        coverImage: currentCover,
        rating: currentRating,
        genres: currentGenres,
        altTitles: currentAltTitles,
        isNsfw: currentIsNsfw,
        metadataOverrides: Array.from(locks),
      };

      const res = await apiFetch(`/api/manga/${manga.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });

      if (res) {
        onUpdateManga(updated);
        setSuccessMsg('Metadata saved successfully!');
        setTimeout(() => {
          setSuccessMsg(null);
          onClose();
        }, 1000);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const handleApplyAllFromSource = (source: SourceOption) => {
    if (source.coverImage) setCurrentCover(source.coverImage);
    if (source.title) setCurrentTitle(source.title);
    if (source.description) setCurrentDesc(source.description);
    if (typeof source.rating === 'number') setCurrentRating(source.rating);
    if (source.genres) setCurrentGenres(source.genres);
    if (source.altTitles) setCurrentAltTitles(source.altTitles);
    setSuccessMsg(`Adopted preset metadata from ${source.sourceName}`);
    setTimeout(() => setSuccessMsg(null), 2000);
  };

  const allCovers: Array<{ url: string; label: string; source: string }> = [];
  const seenCoverUrls = new Set<string>();

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

  if (!isOpen) return null;

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
              type="button"
              onClick={handleMultiProviderEnrich}
              disabled={saving}
              className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-accent/20 to-purple-500/20 text-accent border border-accent/40 hover:border-accent text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm disabled:opacity-50"
              title="Query AniList, MangaUpdates, MangaDex & MAL simultaneously"
            >
              <Sparkles className="w-3.5 h-3.5 text-accent animate-pulse" />
              <span>Auto-Enrich (Multi-Provider)</span>
            </button>

            <button
              type="button"
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
            type="button"
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
            type="button"
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
            type="button"
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
              type="button"
              onClick={() => fetchOptions()}
              disabled={loading}
              className="px-2.5 py-1 rounded-lg bg-elevated hover:bg-elevated/80 text-secondary hover:text-primary text-xs font-semibold flex items-center gap-1.5 transition-all"
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
          {activeTab === 'covers' && (
            <MetadataCoversTab
              allCovers={allCovers}
              currentCover={currentCover}
              setCurrentCover={setCurrentCover}
              locks={locks}
              toggleLock={toggleLock}
              coverSearchQuery={coverSearchQuery}
              setCoverSearchQuery={setCoverSearchQuery}
              coverCategory={coverCategory}
              setCoverCategory={setCoverCategory}
              customCoverUrl={customCoverUrl}
              setCustomCoverUrl={setCustomCoverUrl}
              loading={loading}
              onSearch={fetchOptions}
              setLightboxCover={setLightboxCover}
            />
          )}

          {activeTab === 'fields' && (
            <MetadataFieldsTab
              currentTitle={currentTitle}
              setCurrentTitle={setCurrentTitle}
              currentDesc={currentDesc}
              setCurrentDesc={setCurrentDesc}
              currentRating={currentRating}
              setCurrentRating={setCurrentRating}
              currentGenres={currentGenres}
              setCurrentGenres={setCurrentGenres}
              currentAltTitles={currentAltTitles}
              setCurrentAltTitles={setCurrentAltTitles}
              currentIsNsfw={currentIsNsfw}
              setCurrentIsNsfw={setCurrentIsNsfw}
              locks={locks}
              toggleLock={toggleLock}
            />
          )}

          {activeTab === 'sources' && (
            <MetadataSourcesTab
              sources={sources}
              onApplySourcePreset={handleApplyAllFromSource}
            />
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
          className="fixed inset-0 z-[130] bg-black/90 backdrop-blur-lg flex items-center justify-center p-4"
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
                type="button"
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
                  setCurrentCover(lightboxCover.url);
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
