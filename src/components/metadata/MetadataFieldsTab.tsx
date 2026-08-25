import React from 'react';
import {
  FileText,
  Lock,
  Star,
  Tag,
  BookMarked,
  ShieldCheck,
} from 'lucide-react';

interface MetadataFieldsTabProps {
  currentTitle: string;
  setCurrentTitle: (title: string) => void;
  currentDesc: string;
  setCurrentDesc: (desc: string) => void;
  currentRating: number;
  setCurrentRating: (rating: number) => void;
  currentGenres: string[];
  setCurrentGenres: (genres: string[]) => void;
  currentAltTitles: string[];
  setCurrentAltTitles: (titles: string[]) => void;
  currentIsNsfw: boolean;
  setCurrentIsNsfw: (nsfw: boolean) => void;
  locks: Set<string>;
  toggleLock: (field: string) => void;
}

export const MetadataFieldsTab: React.FC<MetadataFieldsTabProps> = ({
  currentTitle,
  setCurrentTitle,
  currentDesc,
  setCurrentDesc,
  currentRating,
  setCurrentRating,
  currentGenres,
  setCurrentGenres,
  currentAltTitles,
  setCurrentAltTitles,
  currentIsNsfw,
  setCurrentIsNsfw,
  locks,
  toggleLock,
}) => {
  return (
    <div className="space-y-6">
      {/* Title Field */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-primary flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-accent" />
            Canonical Series Title
          </label>
          <button
            type="button"
            onClick={() => toggleLock('title')}
            className="flex items-center gap-1 text-[11px] font-bold text-secondary hover:text-primary"
          >
            <Lock className={`w-3 h-3 ${locks.has('title') ? 'text-accent' : ''}`} />
            {locks.has('title') ? 'Locked' : 'Unlocked'}
          </button>
        </div>
        <input
          type="text"
          value={currentTitle}
          onChange={(e) => setCurrentTitle(e.target.value)}
          className="w-full bg-surface border border-edge rounded-xl px-3.5 py-2 text-xs text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 font-semibold"
        />
      </div>

      {/* Description Field */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-primary flex items-center gap-1.5">
            <BookMarked className="w-3.5 h-3.5 text-accent" />
            Series Synopsis & Description
          </label>
          <button
            type="button"
            onClick={() => toggleLock('description')}
            className="flex items-center gap-1 text-[11px] font-bold text-secondary hover:text-primary"
          >
            <Lock className={`w-3 h-3 ${locks.has('description') ? 'text-accent' : ''}`} />
            {locks.has('description') ? 'Locked' : 'Unlocked'}
          </button>
        </div>
        <textarea
          rows={4}
          value={currentDesc}
          onChange={(e) => setCurrentDesc(e.target.value)}
          className="w-full bg-surface border border-edge rounded-xl p-3.5 text-xs text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 leading-relaxed"
        />
      </div>

      {/* Rating & NSFW Toggle */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2 bg-app p-4 rounded-xl border border-edge">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-primary flex items-center gap-1.5">
              <Star className="w-3.5 h-3.5 text-amber-400" />
              Series Community Rating (1.0 - 10.0)
            </label>
            <button
              type="button"
              onClick={() => toggleLock('rating')}
              className="flex items-center gap-1 text-[11px] font-bold text-secondary hover:text-primary"
            >
              <Lock className={`w-3 h-3 ${locks.has('rating') ? 'text-accent' : ''}`} />
              {locks.has('rating') ? 'Locked' : 'Unlocked'}
            </button>
          </div>
          <input
            type="number"
            step="0.1"
            min="1.0"
            max="10.0"
            value={currentRating}
            onChange={(e) => setCurrentRating(parseFloat(e.target.value) || 8.0)}
            className="w-full bg-surface border border-edge rounded-xl px-3 py-2 text-xs text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 font-bold"
          />
        </div>

        <div className="space-y-2 bg-app p-4 rounded-xl border border-edge flex items-center justify-between">
          <div>
            <span className="text-xs font-bold text-primary flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-rose-400" />
              18+ NSFW Content Classification
            </span>
            <p className="text-[11px] text-muted">Flag series as mature/explicit content</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setCurrentIsNsfw(!currentIsNsfw);
              if (!locks.has('isNsfw')) toggleLock('isNsfw');
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              currentIsNsfw
                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-sm'
                : 'bg-elevated text-secondary hover:text-primary'
            }`}
          >
            {currentIsNsfw ? '18+ Adult' : 'Safe / All Ages'}
          </button>
        </div>
      </div>

      {/* Genres Tag List */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-primary flex items-center gap-1.5">
            <Tag className="w-3.5 h-3.5 text-accent" />
            Genres & Descriptors (Comma separated)
          </label>
          <button
            type="button"
            onClick={() => toggleLock('genres')}
            className="flex items-center gap-1 text-[11px] font-bold text-secondary hover:text-primary"
          >
            <Lock className={`w-3 h-3 ${locks.has('genres') ? 'text-accent' : ''}`} />
            {locks.has('genres') ? 'Locked' : 'Unlocked'}
          </button>
        </div>
        <input
          type="text"
          value={currentGenres.join(', ')}
          onChange={(e) =>
            setCurrentGenres(
              e.target.value
                .split(',')
                .map((g) => g.trim())
                .filter(Boolean)
            )
          }
          className="w-full bg-surface border border-edge rounded-xl px-3.5 py-2 text-xs text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
        />
      </div>

      {/* Alternate Titles List */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-primary flex items-center gap-1.5">
            <Tag className="w-3.5 h-3.5 text-accent" />
            Alternate Titles & Aliases (Comma separated)
          </label>
          <button
            type="button"
            onClick={() => toggleLock('altTitles')}
            className="flex items-center gap-1 text-[11px] font-bold text-secondary hover:text-primary"
          >
            <Lock className={`w-3 h-3 ${locks.has('altTitles') ? 'text-accent' : ''}`} />
            {locks.has('altTitles') ? 'Locked' : 'Unlocked'}
          </button>
        </div>
        <input
          type="text"
          value={currentAltTitles.join(', ')}
          onChange={(e) =>
            setCurrentAltTitles(
              e.target.value
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean)
            )
          }
          className="w-full bg-surface border border-edge rounded-xl px-3.5 py-2 text-xs text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
        />
      </div>
    </div>
  );
};
