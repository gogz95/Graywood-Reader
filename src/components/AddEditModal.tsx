import React, { useState } from 'react';
import { apiFetch } from '../utils/api';
import { MangaItem, MangaType, ReadingStatus, isNsfwManga } from '../types';
import {
  X,
  Sparkles,
  Save,
  Plus,
  RefreshCw,
  Globe,
  BookOpen,
  Image as ImageIcon,
  Palette,
  Eye,
  Flame,
  ShieldAlert,
} from 'lucide-react';
const CoverArtPickerModal = React.lazy(() => import('./CoverArtPickerModal').then(m => ({ default: m.CoverArtPickerModal })));

interface AddEditModalProps {
  initialManga?: MangaItem | null;
  onClose: () => void;
  onSave: (mangaData: Partial<MangaItem>) => void;
}

// Descriptive metadata fields that could be overwritten by a later metadata refresh.
const OVERRIDEABLE_METADATA = ['title', 'description', 'coverImage', 'genres', 'altTitles', 'rating', 'isNsfw'] as const;

// Return the set of metadata fields that differ from the previous saved values.
// These get recorded in `metadataOverrides` so refreshes preserve manual edits.
function computeMetadataOverrides(
  prev: MangaItem | null | undefined,
  next: {
    title: string;
    altTitles: string[];
    description: string;
    coverImage: string;
    genres: string[];
    rating: number;
    isNsfw: boolean;
  }
): string[] {
  if (!prev) return [];
  const overridden = new Set<string>(prev.metadataOverrides || []);

  if (prev.title !== next.title) overridden.add('title');
  if (prev.altTitles.join('|') !== next.altTitles.join('|')) overridden.add('altTitles');
  if (prev.description !== next.description) overridden.add('description');
  if (prev.coverImage !== next.coverImage) overridden.add('coverImage');
  if (prev.genres.join('|') !== next.genres.join('|')) overridden.add('genres');
  if (Number(prev.rating) !== Number(next.rating)) overridden.add('rating');
  if (Boolean(prev.isNsfw !== undefined ? prev.isNsfw : isNsfwManga(prev)) !== Boolean(next.isNsfw)) {
    overridden.add('isNsfw');
    overridden.add('genres');
  }

  return OVERRIDEABLE_METADATA.filter((field) => overridden.has(field));
}

export const AddEditModal: React.FC<AddEditModalProps> = React.memo(({
  initialManga,
  onClose,
  onSave,
}) => {
  const [title, setTitle] = useState(initialManga?.title || '');
  const [altTitlesStr, setAltTitlesStr] = useState(initialManga?.altTitles.join(', ') || '');
  const [type, setType] = useState<MangaType>(initialManga?.type || 'manhwa');
  const [coverImage, setCoverImage] = useState(initialManga?.coverImage || '');
  const [description, setDescription] = useState(initialManga?.description || '');
  const [genresStr, setGenresStr] = useState(initialManga?.genres.join(', ') || 'Action, Fantasy');
  const [status, setStatus] = useState<ReadingStatus>(initialManga?.status || 'reading');
  const [currentChapter, setCurrentChapter] = useState(initialManga?.currentChapter || 0);
  const [latestChapter, setLatestChapter] = useState(initialManga?.latestChapter || 1);
  const [rating, setRating] = useState(initialManga?.rating || 9.0);
  const [isNsfw, setIsNsfw] = useState<boolean>(
    initialManga?.isNsfw !== undefined ? Boolean(initialManga.isNsfw) : Boolean(initialManga && isNsfwManga(initialManga))
  );
  const [sourceUrl, setSourceUrl] = useState(initialManga?.sourceUrl || '');
  const [sourceName, setSourceName] = useState(initialManga?.sourceName || 'MangaDex');
  const [notes, setNotes] = useState(initialManga?.notes || '');
  const [enriching, setEnriching] = useState(false);
  const [isCoverPickerOpen, setIsCoverPickerOpen] = useState(false);

  const handleAutoEnrich = async () => {
    if (!title.trim()) {
      alert('Please enter a title first to auto-enrich metadata!');
      return;
    }
    setEnriching(true);
    try {
      const res = await apiFetch('/api/ai/enrich-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.title) setTitle(data.title);
        if (Array.isArray(data.altTitles)) setAltTitlesStr(data.altTitles.join(', '));
        if (data.type) setType(data.type);
        if (data.description) setDescription(data.description);
        if (Array.isArray(data.genres)) setGenresStr(data.genres.join(', '));
        if (data.latestChapter) setLatestChapter(data.latestChapter);
        if (data.rating) setRating(data.rating);
        if (typeof data.isNsfw === 'boolean') {
          setIsNsfw(data.isNsfw);
        } else if (Array.isArray(data.genres) && data.genres.some((g: string) => typeof g === 'string' && (g.toLowerCase().includes('18+') || g.toLowerCase().includes('adult') || g.toLowerCase().includes('hentai')))) {
          setIsNsfw(true);
        }
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || `AI enrichment failed (HTTP ${res.status}).`);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setEnriching(false);
    }
  };

  const handleToggleNsfw = () => {
    const nextNsfw = !isNsfw;
    setIsNsfw(nextNsfw);
    const parts = genresStr.split(',').map((s) => s.trim()).filter(Boolean);
    if (nextNsfw) {
      if (!parts.some((g) => g.toLowerCase() === '18+' || g.toLowerCase() === 'adult' || g.toLowerCase() === 'mature')) {
        setGenresStr([...parts, '18+'].join(', '));
      }
    } else {
      const filtered = parts.filter((g) => {
        const glc = g.toLowerCase();
        return glc !== '18+' && glc !== 'adult' && glc !== 'smut' && glc !== 'hentai' && glc !== 'erotica' && glc !== 'nsfw' && glc !== 'r18';
      });
      setGenresStr(filtered.length ? filtered.join(', ') : 'Action');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const altTitles = altTitlesStr.split(',').map((s) => s.trim()).filter(Boolean);
    let genres = genresStr.split(',').map((s) => s.trim()).filter(Boolean);
    if (genres.length === 0) genres = ['Action'];

    if (isNsfw && !genres.some((g) => g.toLowerCase() === '18+' || g.toLowerCase() === 'adult' || g.toLowerCase() === 'mature')) {
      genres = [...genres, '18+'];
    } else if (!isNsfw) {
      genres = genres.filter((g) => {
        const glc = g.toLowerCase();
        return glc !== '18+' && glc !== 'adult' && glc !== 'smut' && glc !== 'hentai' && glc !== 'erotica' && glc !== 'nsfw' && glc !== 'r18';
      });
      if (genres.length === 0) genres = ['Action'];
    }

    const nextMetadata = {
      title: title.trim(),
      altTitles,
      description: description.trim(),
      coverImage: coverImage.trim(),
      genres,
      rating: Number(rating) || 8.0,
      isNsfw,
    };

    onSave({
      ...(initialManga || {}),
      // Record which metadata fields the user customized so a later metadata
      // refresh preserves them instead of overwriting the manual edits.
      metadataOverrides: computeMetadataOverrides(initialManga, nextMetadata),
      title: nextMetadata.title,
      altTitles,
      type,
      coverImage: nextMetadata.coverImage || '/api/mangadex/image-proxy?url=https%3A%2F%2Fuploads.mangadex.org%2Fcovers%2F32d76d19-8a05-4db0-9fc2-e0b0648fe9d0%2Ffbc962f9-3d12-4c6e-8212-32a2cb874a7b.jpg',
      description: nextMetadata.description,
      genres: nextMetadata.genres,
      isNsfw,
      status,
      currentChapter: Number(currentChapter) || 0,
      latestChapter: Number(latestChapter) || Number(currentChapter) || 1,
      rating: nextMetadata.rating,
      sourceUrl: sourceUrl.trim(),
      sourceName: sourceName.trim() || 'Manual',
      notes: notes.trim(),
    });

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-surface border border-edge rounded-2xl max-w-2xl w-full overflow-hidden shadow-2xl space-y-0 my-8">
        <div className="p-5 bg-app border-b border-edge flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-accent" />
            <h3 className="text-lg font-bold text-primary">
              {initialManga ? 'Edit Series Details' : 'Add New Manhwa / Manhua'}
            </h3>
          </div>

          <button onClick={onClose} className="text-secondary hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs sm:text-sm">
          {/* Title & Gemini Auto Enrich */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="font-bold text-secondary">Series Title *</label>
              <button
                type="button"
                onClick={handleAutoEnrich}
                disabled={enriching}
                className="px-2.5 sm:px-3 py-1 sm:py-1.5 rounded bg-accent/10 hover:bg-accent/20 text-accent border border-accent/30 font-bold text-xs sm:text-sm flex items-center gap-1.5 transition-all"
              >
                <Sparkles className={`w-3.5 h-3.5 ${enriching ? 'animate-spin' : ''}`} />
                <span>{enriching ? 'Enriching...' : 'Auto-Fill with Gemini AI'}</span>
              </button>
            </div>
            <input
              type="text"
              required
              placeholder="e.g. Solo Leveling, Omniscient Reader, Martial Peak..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-app border border-edge-strong rounded-xl p-3 text-primary font-semibold focus:outline-none focus:ring-2 focus:ring-accent/50"
            />
          </div>

          {/* Alt Titles */}
          <div>
            <label className="block font-bold text-secondary mb-1">
              Alternate / Romanized Titles (comma-separated):
            </label>
            <input
              type="text"
              placeholder="e.g. Na Honjaman Level Up, Only I Level Up"
              value={altTitlesStr}
              onChange={(e) => setAltTitlesStr(e.target.value)}
              className="w-full bg-app border border-edge rounded-xl p-3 text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
            />
          </div>

          {/* Origin Type & Status */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-bold text-secondary mb-1">Origin Format:</label>
              <select
                value={type}
                onChange={(e: any) => setType(e.target.value)}
                className="w-full bg-app border border-edge rounded-xl p-3 text-primary font-bold focus:outline-none focus:ring-2 focus:ring-accent/50"
              >
                <option value="manhwa">🇰🇷 Korean Manhwa</option>
                <option value="manhua">🇨🇳 Chinese Manhua</option>
                <option value="manga">🇯🇵 Manga / Other</option>
              </select>
            </div>

            <div>
              <label className="block font-bold text-secondary mb-1">Reading Status:</label>
              <select
                value={status}
                onChange={(e: any) => setStatus(e.target.value)}
                className="w-full bg-app border border-edge rounded-xl p-3 text-primary font-bold focus:outline-none focus:ring-2 focus:ring-accent/50"
              >
                <option value="reading">Reading</option>
                <option value="plan_to_read">Plan to Read</option>
                <option value="completed">Completed</option>
                <option value="on_hold">On Hold</option>
                <option value="dropped">Dropped</option>
              </select>
            </div>
          </div>

          {/* Chapter Numbers & Rating */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block font-bold text-secondary mb-1">Current Chapter:</label>
              <input
                type="number"
                value={currentChapter}
                onChange={(e) => setCurrentChapter(Number(e.target.value))}
                className="w-full bg-app border border-edge rounded-xl p-3 text-primary font-bold focus:outline-none focus:ring-2 focus:ring-accent/50"
              />
            </div>

            <div>
              <label className="block font-bold text-secondary mb-1">Latest Released:</label>
              <input
                type="number"
                value={latestChapter}
                onChange={(e) => setLatestChapter(Number(e.target.value))}
                className="w-full bg-app border border-edge rounded-xl p-3 text-primary font-bold focus:outline-none focus:ring-2 focus:ring-accent/50"
              />
            </div>

            <div>
              <label className="block font-bold text-secondary mb-1">Rating (1-10):</label>
              <input
                type="number"
                step="0.1"
                min="0"
                max="10"
                value={rating}
                onChange={(e) => setRating(Number(e.target.value))}
                className="w-full bg-app border border-edge rounded-xl p-3 text-primary font-bold focus:outline-none focus:ring-2 focus:ring-accent/50"
              />
            </div>
          </div>

          {/* Cover Image & Genres */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="font-bold text-secondary">Cover Artwork:</label>
                <button
                  type="button"
                  onClick={() => setIsCoverPickerOpen(true)}
                  className="px-2.5 py-1 rounded bg-accent/15 hover:bg-accent/25 text-accent border border-accent/30 font-bold text-xs flex items-center gap-1.5 transition-all"
                  title="Browse volume covers, alternate posters, and source artwork"
                >
                  <Palette className="w-3.5 h-3.5" />
                  <span>Browse All Covers</span>
                </button>
              </div>

              <div className="flex gap-3 items-start bg-app p-2.5 rounded-xl border border-edge">
                <div
                  onClick={() => setIsCoverPickerOpen(true)}
                  className="w-14 h-20 rounded-lg overflow-hidden bg-surface border border-edge shrink-0 relative group cursor-pointer shadow-sm"
                  title="Click to change cover"
                >
                  {coverImage ? (
                    <img
                      src={coverImage}
                      alt="Cover Preview"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-muted gap-1">
                      <ImageIcon className="w-5 h-5" />
                      <span className="text-[9px] font-bold">No Art</span>
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white">
                    <Eye className="w-4 h-4" />
                  </div>
                </div>

                <div className="flex-1 min-w-0 space-y-1.5">
                  <input
                    type="text"
                    placeholder="https://... (or click Browse All Covers)"
                    value={coverImage}
                    onChange={(e) => setCoverImage(e.target.value)}
                    className="w-full bg-surface border border-edge rounded-lg p-2 text-xs text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
                  />
                  <div className="flex items-center justify-between text-[11px] text-muted">
                    <span className="truncate">Standard 3:4 Manga Poster Ratio</span>
                    {coverImage && (
                      <button
                        type="button"
                        onClick={() => setIsCoverPickerOpen(true)}
                        className="text-accent hover:underline font-semibold"
                      >
                        Change Art
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div>
              <label className="block font-bold text-secondary mb-1">Genres (comma-separated):</label>
              <input
                type="text"
                placeholder="Action, System, Murim, Cultivation"
                value={genresStr}
                onChange={(e) => setGenresStr(e.target.value)}
                className="w-full bg-app border border-edge rounded-xl p-3 text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
              />
            </div>
          </div>

          {/* 18+ Adult Content (NSFW) Marking */}
          <div className={`p-3.5 rounded-xl border transition-all flex items-center justify-between gap-3 ${
            isNsfw
              ? 'bg-rose-500/10 border-rose-500/30'
              : 'bg-app border-edge hover:border-edge-strong'
          }`}>
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center font-black text-xs transition-colors shrink-0 ${
                isNsfw
                  ? 'bg-rose-500/25 text-rose-400 border border-rose-500/50 shadow-sm shadow-rose-500/10'
                  : 'bg-surface text-muted border border-edge'
              }`}>
                {isNsfw ? <Flame className="w-4 h-4 text-rose-400" /> : '18+'}
              </div>
              <div className="space-y-0.5">
                <div className="font-bold text-primary flex items-center gap-2">
                  <span>18+ Adult Content / NSFW</span>
                  {isNsfw ? (
                    <span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-400 border border-rose-500/40 text-[10px] font-extrabold tracking-wide uppercase">
                      Marked 18+
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded bg-surface text-muted border border-edge text-[10px] font-medium">
                      Safe / General
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-secondary">
                  {isNsfw
                    ? 'Synchronized with metadata database. Filtered when library is in Safe mode.'
                    : 'Toggle to mark this series as 18+ / NSFW and synchronize with metadata database.'}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleToggleNsfw}
              aria-label="Toggle 18+ NSFW Content"
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-rose-500/40 ${
                isNsfw ? 'bg-rose-500' : 'bg-edge-strong'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                  isNsfw ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Description */}
          <div>
            <label className="block font-bold text-secondary mb-1">Synopsis / Description:</label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-app border border-edge rounded-xl p-3 text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
            />
          </div>

          {/* Footer Submit */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-edge">
            <button
              type="button"
              onClick={onClose}
              className="px-4 sm:px-5 py-2.5 sm:py-3 rounded-xl bg-elevated text-secondary hover:text-white font-semibold text-xs sm:text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-6 sm:px-7 py-2.5 sm:py-3 rounded-xl bg-accent hover:bg-accent-bright text-accent-fg font-bold shadow-lg transition-all flex items-center gap-2 text-xs sm:text-sm"
            >
              <Save className="w-4 h-4 sm:w-5 sm:h-5" />
              <span>{initialManga ? 'Update Series' : 'Save to Tracker'}</span>
            </button>
          </div>
        </form>
      </div>

      {/* Cover Art Picker Modal */}
      {isCoverPickerOpen && (
        <React.Suspense fallback={null}>
          <CoverArtPickerModal
            isOpen={isCoverPickerOpen}
            onClose={() => setIsCoverPickerOpen(false)}
            currentCoverUrl={coverImage}
            mangaId={initialManga?.id}
            mangaTitle={title || initialManga?.title || 'Unknown'}
            availableSources={initialManga?.availableSources}
            onSelectCover={(newCoverUrl) => {
              setCoverImage(newCoverUrl);
            }}
          />
        </React.Suspense>
      )}
    </div>
  );
});
