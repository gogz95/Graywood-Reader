import React, { useState } from 'react';
import { MangaItem, MangaType, ReadingStatus } from '../types';
import {
  X,
  Sparkles,
  Save,
  Plus,
  RefreshCw,
  Globe,
  BookOpen,
} from 'lucide-react';

interface AddEditModalProps {
  initialManga?: MangaItem | null;
  onClose: () => void;
  onSave: (mangaData: Partial<MangaItem>) => void;
}

// Descriptive metadata fields that could be overwritten by a later metadata refresh.
const OVERRIDEABLE_METADATA = ['title', 'description', 'coverImage', 'genres', 'altTitles', 'rating'] as const;

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

  return OVERRIDEABLE_METADATA.filter((field) => overridden.has(field));
}

export const AddEditModal: React.FC<AddEditModalProps> = ({
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
  const [sourceUrl, setSourceUrl] = useState(initialManga?.sourceUrl || '');
  const [sourceName, setSourceName] = useState(initialManga?.sourceName || 'MangaDex');
  const [notes, setNotes] = useState(initialManga?.notes || '');
  const [enriching, setEnriching] = useState(false);

  const handleAutoEnrich = async () => {
    if (!title.trim()) {
      alert('Please enter a title first to auto-enrich metadata!');
      return;
    }
    setEnriching(true);
    try {
      const res = await fetch('/api/ai/enrich-metadata', {
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
      }
    } catch (err) {
      console.error(err);
    } finally {
      setEnriching(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const altTitles = altTitlesStr.split(',').map((s) => s.trim()).filter(Boolean);
    const genres = genresStr.split(',').map((s) => s.trim()).filter(Boolean);

    const nextMetadata = {
      title: title.trim(),
      altTitles,
      description: description.trim(),
      coverImage: coverImage.trim(),
      genres: genres.length ? genres : ['Action'],
      rating: Number(rating) || 8.0,
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
    <div className="fixed inset-0 z-50 bg-app/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
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
                className="px-2.5 py-1 rounded bg-accent/10 hover:bg-accent/20 text-accent border border-accent/30 font-bold text-xs flex items-center gap-1.5 transition-all"
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
            <div>
              <label className="block font-bold text-secondary mb-1">Cover Image URL:</label>
              <input
                type="text"
                placeholder="https://..."
                value={coverImage}
                onChange={(e) => setCoverImage(e.target.value)}
                className="w-full bg-app border border-edge rounded-xl p-3 text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
              />
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
              className="px-4 py-2.5 rounded-xl bg-elevated text-secondary hover:text-white font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-6 py-2.5 rounded-xl bg-accent hover:bg-accent-bright text-accent-fg font-bold shadow-lg transition-all flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              <span>{initialManga ? 'Update Series' : 'Save to Tracker'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
