import React from 'react';
import { MangaType, UserCategory } from '../../types';
import { Sparkles } from 'lucide-react';

interface LibraryFiltersDrawerProps {
  typeFilter: MangaType | 'all';
  setTypeFilter: (type: MangaType | 'all') => void;
  nsfwFilter: 'all' | 'safe' | '18+';
  setNsfwFilter: (filter: 'all' | 'safe' | '18+') => void;
  isGuest: boolean;
  onOpenAuthModal?: () => void;
  nsfwCount: number;
  handleAutoTagNsfw: () => void;
  isAutoTagging: boolean;
  autoTagToast: string | null;
  activeCategory: string | null;
  setActiveCategory: (cat: string | null) => void;
  categories: UserCategory[];
  isGenreFilterOpen: boolean;
  setIsGenreFilterOpen: (open: boolean) => void;
  genreStates: Map<string, 'include' | 'exclude'>;
  toggleGenreTag: (tag: string) => void;
  clearGenreTags: () => void;
  libraryGenres: string[];
}

export const LibraryFiltersDrawer: React.FC<LibraryFiltersDrawerProps> = ({
  typeFilter,
  setTypeFilter,
  nsfwFilter,
  setNsfwFilter,
  isGuest,
  onOpenAuthModal,
  nsfwCount,
  handleAutoTagNsfw,
  isAutoTagging,
  autoTagToast,
  activeCategory,
  setActiveCategory,
  categories,
  isGenreFilterOpen,
  setIsGenreFilterOpen,
  genreStates,
  toggleGenreTag,
  clearGenreTags,
  libraryGenres,
}) => {
  return (
    <>
      {/* Row 3: Secondary Filter Bar (Origin Type, 18+ Filter & Tri-State Genres) */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs border-t border-edge/60 pt-2.5 min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          {/* Origin Type Filter */}
          <div className="flex items-center gap-1 bg-app/80 border border-edge rounded-xl p-0.5">
            <button
              type="button"
              onClick={() => setTypeFilter('all')}
              className={`px-2.5 py-1 rounded-lg transition-all font-bold cursor-pointer ${
                typeFilter === 'all'
                  ? 'bg-elevated text-primary shadow-xs'
                  : 'text-secondary hover:text-primary'
              }`}
            >
              All Formats
            </button>
            <button
              type="button"
              onClick={() => setTypeFilter('manhwa')}
              className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 font-bold cursor-pointer ${
                typeFilter === 'manhwa'
                  ? 'bg-elevated text-primary shadow-xs'
                  : 'text-secondary hover:text-primary'
              }`}
            >
              <span>🇰🇷</span> Manhwa
            </button>
            <button
              type="button"
              onClick={() => setTypeFilter('manga')}
              className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 font-bold cursor-pointer ${
                typeFilter === 'manga'
                  ? 'bg-elevated text-primary shadow-xs'
                  : 'text-secondary hover:text-primary'
              }`}
            >
              <span>🇯🇵</span> Manga
            </button>
            <button
              type="button"
              onClick={() => setTypeFilter('manhua')}
              className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 font-bold cursor-pointer ${
                typeFilter === 'manhua'
                  ? 'bg-elevated text-primary shadow-xs'
                  : 'text-secondary hover:text-primary'
              }`}
            >
              <span>🇨🇳</span> Manhua
            </button>
            <button
              type="button"
              onClick={() => setTypeFilter('novel')}
              className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 font-bold cursor-pointer ${
                typeFilter === 'novel'
                  ? 'bg-elevated text-primary shadow-xs'
                  : 'text-secondary hover:text-primary'
              }`}
            >
              <span>📖</span> Novel
            </button>
          </div>

          <button
            type="button"
            onClick={() => setIsGenreFilterOpen(!isGenreFilterOpen)}
            className={`px-2.5 py-1 rounded-xl font-bold flex items-center gap-1.5 transition-all border cursor-pointer ${
              genreStates.size > 0
                ? 'bg-accent/20 border-accent text-accent shadow-xs'
                : 'bg-app border-edge text-secondary hover:text-primary hover:bg-elevated'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Genre Filters {genreStates.size > 0 ? `(${genreStates.size})` : ''}</span>
          </button>
        </div>

        {/* 18+ NSFW Content Toggle */}
        <div className="flex items-center gap-1 bg-app/80 border border-edge rounded-xl p-0.5 shadow-inner">
          <button
            type="button"
            onClick={() => setNsfwFilter('all')}
            className={`px-2 py-1 rounded-lg font-bold transition-all text-xs cursor-pointer ${
              nsfwFilter === 'all'
                ? 'bg-elevated text-primary shadow-xs'
                : 'text-muted hover:text-secondary'
            }`}
            title="Show all content"
          >
            All Content
          </button>
          <button
            type="button"
            onClick={() => setNsfwFilter('safe')}
            className={`px-2 py-1 rounded-lg font-bold transition-all text-xs cursor-pointer ${
              nsfwFilter === 'safe'
                ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/40 shadow-xs'
                : 'text-muted hover:text-secondary'
            }`}
            title="Hide 18+ / Adult series"
          >
            Safe
          </button>
          <button
            type="button"
            onClick={() => {
              if (isGuest) {
                onOpenAuthModal?.();
              } else {
                setNsfwFilter('18+');
              }
            }}
            className={`px-2 py-1 rounded-lg font-bold transition-all text-xs flex items-center gap-1 cursor-pointer ${
              !isGuest && nsfwFilter === '18+'
                ? 'bg-rose-950 text-rose-300 border border-rose-500/50 shadow-xs'
                : 'text-muted hover:text-rose-400'
            }`}
            title={isGuest ? 'Sign in to access 18+ content' : 'Show only 18+ / Mature series'}
          >
            <span>🔞 18+</span>
            {isGuest ? (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-edge-strong text-muted flex items-center gap-0.5">🔒 Login</span>
            ) : (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-rose-900/60 text-rose-300">
                {nsfwCount}
              </span>
            )}
          </button>

          {!isGuest && (
            <button
              type="button"
              onClick={handleAutoTagNsfw}
              disabled={isAutoTagging}
              className="px-2 py-1 rounded-lg font-bold transition-all text-xs flex items-center gap-1 bg-amber-950/60 hover:bg-amber-900/80 text-amber-300 border border-amber-500/40 shadow-xs ml-1 disabled:opacity-50 cursor-pointer"
              title="Scan library and auto-tag untagged 18+ NSFW series based on source, genres, and title keywords"
            >
              <Sparkles className={`w-3 h-3 text-amber-400 ${isAutoTagging ? 'animate-spin' : ''}`} />
              <span>{isAutoTagging ? 'Scanning...' : 'Auto-Tag 18+'}</span>
            </button>
          )}
        </div>

        {autoTagToast && (
          <div className="px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-bold flex items-center gap-2 animate-fadeIn">
            <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
            <span>{autoTagToast}</span>
          </div>
        )}

        {activeCategory && (
          <div className="flex items-center gap-1.5 text-xs text-secondary bg-elevated/80 border border-edge/80 px-2.5 py-1 rounded-xl">
            <span>Active Shelf:</span>
            <span className="font-black text-accent-2">
              {categories.find((c) => c.id === activeCategory)?.name || 'Custom Shelf'}
            </span>
            <button
              type="button"
              onClick={() => setActiveCategory(null)}
              className="ml-1 text-[10px] px-1.5 py-0.5 rounded-lg bg-surface hover:bg-danger/20 text-muted hover:text-danger font-bold transition-all cursor-pointer"
              title="Clear shelf filter"
            >
              ✕ Clear
            </button>
          </div>
        )}
      </div>

      {/* Row 4: Tri-State Genre Filtering Panel */}
      {isGenreFilterOpen && (
        <div className="pt-3 border-t border-edge/60 space-y-2 animate-in fade-in duration-150">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-bold text-secondary flex items-center gap-2">
              <span>Tri-State Filter (Click: <strong>+Include</strong> &rarr; <strong>-Exclude</strong> &rarr; <strong>Neutral</strong>):</span>
              {genreStates.size > 0 && (
                <button
                  type="button"
                  onClick={clearGenreTags}
                  className="text-[10px] text-danger hover:underline font-bold cursor-pointer"
                >
                  Clear All ({genreStates.size})
                </button>
              )}
            </div>
            <span className="text-[10px] text-muted">{libraryGenres.length} tags in library</span>
          </div>

          <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto no-scrollbar p-1 bg-app/50 border border-edge/50 rounded-xl">
            {libraryGenres.map((tag) => {
              const state = genreStates.get(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleGenreTag(tag)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1 cursor-pointer ${
                    state === 'include'
                      ? 'bg-success text-black shadow-xs font-black'
                      : state === 'exclude'
                      ? 'bg-danger text-white shadow-xs font-black'
                      : 'bg-surface hover:bg-elevated text-secondary hover:text-primary border border-edge'
                  }`}
                >
                  {state === 'include' && <span>+</span>}
                  {state === 'exclude' && <span>&minus;</span>}
                  <span>{tag}</span>
                </button>
              );
            })}
            {libraryGenres.length === 0 && (
              <span className="text-xs text-muted p-2 italic">No genre tags found in library</span>
            )}
          </div>
        </div>
      )}
    </>
  );
};
