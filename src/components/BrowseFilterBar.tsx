import React from 'react';
import { Compass, RotateCcw, Search, Sparkles, ArrowUpDown, Layers, Grid, List, Star, Dices } from 'lucide-react';
import { MangaType, ReadingStatus } from '../types';
import { SortBy } from '../utils/catalog';

interface BrowseFilterBarProps {
  filteredMangaCount: number;
  localSearch: string;
  onSearchChange: (v: string) => void;
  selectedLanguage: string;
  onLanguageChange: (v: string) => void;
  sortBy: SortBy;
  onSortChange: (v: SortBy) => void;
  selectedType: MangaType | 'all';
  onTypeChange: (v: MangaType | 'all') => void;
  selectedStatus: ReadingStatus | 'all';
  onStatusChange: (v: ReadingStatus | 'all') => void;
  selectedGenre: string;
  onGenreToggle: (g: string) => void;
  selectedSourceName: string;
  onSourceToggle: (s: string) => void;
  contentRating: 'all' | 'hide' | 'only';
  onContentRatingChange: (v: 'all' | 'hide' | 'only') => void;
  favoritesOnly: boolean;
  onToggleFavorites: () => void;
  unreadOnly: boolean;
  onToggleUnread: () => void;
  availableSources: string[];
  availableGenres: string[];
  viewDensity: 'grid' | 'list';
  onViewDensityChange: (v: 'grid' | 'list') => void;
  onReset: () => void;
  onRandom: () => void;
  isRandomPicking: boolean;
}

export const BrowseFilterBar: React.FC<BrowseFilterBarProps> = ({
  filteredMangaCount, localSearch, onSearchChange, selectedLanguage, onLanguageChange,
  sortBy, onSortChange, selectedType, onTypeChange, selectedStatus, onStatusChange,
  selectedGenre, onGenreToggle, selectedSourceName, onSourceToggle, contentRating,
  onContentRatingChange, favoritesOnly, onToggleFavorites, unreadOnly, onToggleUnread,
  availableSources, availableGenres, viewDensity, onViewDensityChange, onReset, onRandom,
  isRandomPicking,
}) => (
  <div className="bg-surface border border-edge rounded-3xl p-6 shadow-xl space-y-5">
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-edge pb-4">
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-2xl bg-accent/10 text-accent border border-accent/20 shadow-md">
          <Compass className="w-6 h-6" />
        </div>
        <div>
          <h2 className="text-xl font-black text-primary flex items-center gap-2">
            Unified Catalog
            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-accent/20 text-accent border border-accent/30">
              {filteredMangaCount} Series
            </span>
          </h2>
          <p className="text-xs text-secondary">Aggregated catalog grouping all series across all active connected Kotatsu sources in one place</p>
        </div>
      </div>

      <div className="flex items-center gap-2 w-full sm:w-auto">
        <button
          onClick={onRandom}
          disabled={isRandomPicking || filteredMangaCount === 0}
          title="Surprise me with a random series"
          className={`px-3 py-2 rounded-xl bg-gradient-to-r from-accent to-accent-2 text-accent-fg font-black text-xs flex items-center gap-1.5 shadow-md transition-all active:scale-95 disabled:opacity-40 ${isRandomPicking ? 'animate-pulse' : ''}`}
        >
          <Dices className={`w-3.5 h-3.5 ${isRandomPicking ? 'animate-spin' : ''}`} />
          <span>{isRandomPicking ? 'Rolling...' : 'Random'}</span>
        </button>

        <div className="flex items-center p-1 bg-app rounded-xl border border-edge">
          <button
            onClick={() => onViewDensityChange('grid')}
            className={`p-1.5 rounded-lg transition-all ${viewDensity === 'grid' ? 'bg-accent text-accent-fg font-bold' : 'text-secondary hover:text-primary'}`}
            title="Grid View"
          >
            <Grid className="w-4 h-4" />
          </button>
          <button
            onClick={() => onViewDensityChange('list')}
            className={`p-1.5 rounded-lg transition-all ${viewDensity === 'list' ? 'bg-accent text-accent-fg font-bold' : 'text-secondary hover:text-primary'}`}
            title="List Table View"
          >
            <List className="w-4 h-4" />
          </button>
        </div>

        <button
          onClick={onReset}
          className="px-3 py-2 rounded-xl bg-elevated hover:bg-elevated text-secondary font-bold text-xs flex items-center gap-1.5 border border-edge-strong transition-all"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Reset Filters</span>
        </button>
      </div>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
        <input
          type="text"
          placeholder="Search title, genre, author..."
          value={localSearch}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full bg-app border border-edge rounded-xl pl-9 pr-3 py-2 text-xs text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
        />
      </div>

      <div className="space-y-1">
        <label className="text-[11px] font-bold text-secondary flex items-center gap-1">
          <Sparkles className="w-3 h-3 text-info" />
          Language Preference:
        </label>
        <select
          value={selectedLanguage}
          onChange={(e) => onLanguageChange(e.target.value)}
          className="w-full bg-app border border-edge rounded-xl p-2 text-xs text-primary font-semibold focus:outline-none focus:ring-2 focus:ring-info/50"
        >
          <option value="en">🇬🇧 English (Preferred)</option>
          <option value="ko">🇰🇷 Korean</option>
          <option value="zh">🇨🇳 Chinese</option>
          <option value="ja">🇯🇵 Japanese</option>
          <option value="all">🌍 All Languages</option>
          <option value="es">🇪🇸 Spanish</option>
          <option value="fr">🇫🇷 French</option>
        </select>
      </div>

      <div className="space-y-1">
        <label className="text-[11px] font-bold text-secondary flex items-center gap-1">
          <ArrowUpDown className="w-3 h-3 text-accent" />
          Sort Results By:
        </label>
        <select
          value={sortBy}
          onChange={(e) => onSortChange(e.target.value as SortBy)}
          className="w-full bg-app border border-edge rounded-xl p-2 text-xs text-primary font-semibold focus:outline-none focus:ring-2 focus:ring-accent/50"
        >
          <option value="rating_desc">⭐️ User Rating (Highest First)</option>
          <option value="title_asc">🔤 Title (A - Z)</option>
          <option value="title_desc">🔤 Title (Z - A)</option>
          <option value="latest_chap_desc">🚀 Latest Chapter Count</option>
          <option value="updated_desc">🕒 Recently Updated</option>
        </select>
      </div>

      <div className="space-y-1">
        <label className="text-[11px] font-bold text-secondary">Comic Format Type:</label>
        <select
          value={selectedType}
          onChange={(e) => onTypeChange(e.target.value as MangaType | 'all')}
          className="w-full bg-app border border-edge rounded-xl p-2 text-xs text-primary font-semibold focus:outline-none focus:ring-2 focus:ring-accent/50"
        >
          <option value="all">All Formats (Manhwa, Manhua, Manga)</option>
          <option value="manhwa">🇰🇷 Korean Manhwa</option>
          <option value="manhua">🇨🇳 Chinese Manhua</option>
          <option value="manga">🇯🇵 Japanese Manga</option>
        </select>
      </div>

      <div className="space-y-1">
        <label className="text-[11px] font-bold text-secondary">Reading Status:</label>
        <select
          value={selectedStatus}
          onChange={(e) => onStatusChange(e.target.value as ReadingStatus | 'all')}
          className="w-full bg-app border border-edge rounded-xl p-2 text-xs text-primary font-semibold focus:outline-none focus:ring-2 focus:ring-accent/50"
        >
          <option value="all">All Statuses</option>
          <option value="reading">📖 Reading</option>
          <option value="completed">✅ Completed</option>
          <option value="plan_to_read">📌 Plan to Read</option>
          <option value="on_hold">⏸️ On Hold</option>
          <option value="dropped">❌ Dropped</option>
        </select>
      </div>

      <div className="space-y-1">
        <label className="text-[11px] font-bold text-secondary flex items-center gap-1">
          <Sparkles className="w-3 h-3 text-danger" />
          18+ / Adult:
        </label>
        <select
          value={contentRating}
          onChange={(e) => onContentRatingChange(e.target.value as 'all' | 'hide' | 'only')}
          className="w-full bg-app border border-edge rounded-xl p-2 text-xs text-primary font-semibold focus:outline-none focus:ring-2 focus:ring-danger/40"
        >
          <option value="all">All (Safe + 18+)</option>
          <option value="hide">🙈 Hide 18+ Content</option>
          <option value="only">🔞 Show 18+ Only</option>
        </select>
      </div>
    </div>

    {availableSources.length > 1 && (
      <div className="flex flex-wrap items-center gap-2 pb-3 border-b border-edge/60">
        <span className="text-[11px] font-bold text-secondary mr-1 flex items-center gap-1">
          <Layers className="w-3 h-3 text-accent" />
          Source:
        </span>
        <button
          onClick={() => onSourceToggle('all')}
          className={`px-3 py-1.5 rounded-xl border font-bold text-xs transition-all ${
            selectedSourceName === 'all'
              ? 'bg-accent text-accent-fg border-accent shadow-md font-black'
              : 'bg-app text-secondary border-edge hover:border-edge-strong'
          }`}
        >
          All Sources
        </button>
        {availableSources.map((src) => (
          <button
            key={src}
            onClick={() => onSourceToggle(src)}
            className={`px-3 py-1.5 rounded-xl border font-bold text-xs transition-all ${
              selectedSourceName === src
                ? 'bg-accent-2/30 text-accent-2 border-accent-2/50 shadow-md font-black'
                : 'bg-app text-secondary border-edge hover:border-edge-strong'
            }`}
          >
            {src}
          </button>
        ))}
      </div>
    )}
      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-edge/80 text-xs">
        <span className="font-bold text-secondary mr-1 text-[11px]">Quick Filters:</span>

        <button
          onClick={onToggleFavorites}
          className={`px-3 py-1.5 rounded-xl border font-bold text-xs flex items-center gap-1.5 transition-all ${
            favoritesOnly
              ? 'bg-accent text-accent-fg border-accent shadow-md font-black'
              : 'bg-app text-secondary border-edge hover:border-edge-strong'
          }`}
        >
          <Star className={`w-3.5 h-3.5 ${favoritesOnly ? 'fill-accent-fg' : 'text-accent'}`} />
          <span>Favorites Only</span>
        </button>

        <button
          onClick={onToggleUnread}
          className={`px-3 py-1.5 rounded-xl border font-bold text-xs flex items-center gap-1.5 transition-all ${
            unreadOnly
              ? 'bg-info text-accent-fg border-info shadow-md font-black'
              : 'bg-app text-secondary border-edge hover:border-edge-strong'
          }`}
        >
          <span>🔔 Unread Chapters</span>
        </button>

        {availableGenres.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto py-1 max-w-full">
            <span className="text-muted">|</span>
            <button
              onClick={() => onGenreToggle('all')}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all ${
                selectedGenre === 'all'
                  ? 'bg-accent text-accent-fg border-accent font-black shadow-sm'
                  : 'bg-app text-secondary border-edge'
              }`}
            >
              All Genres
            </button>
            {availableGenres.map((genre) => (
              <button
                key={genre}
                onClick={() => onGenreToggle(genre)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all ${
                  selectedGenre === genre
                    ? 'bg-accent/20 text-accent border-accent/40 font-black'
                    : 'bg-app text-secondary border-edge hover:border-edge-strong'
                }`}
              >
                {genre}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
);

