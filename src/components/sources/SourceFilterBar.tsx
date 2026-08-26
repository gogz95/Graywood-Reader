import React from 'react';
import { Search, Filter } from 'lucide-react';
import { SourceEngineType } from '../../types';

interface SourceFilterBarProps {
  searchQuery: string;
  selectedEngine: string;
  showDisabledOnly: boolean;
  totalSourcesCount: number;
  filteredSourcesCount: number;
  onSearchChange: (q: string) => void;
  onEngineChange: (engine: string) => void;
  onToggleShowDisabled: () => void;
}

export const SourceFilterBar: React.FC<SourceFilterBarProps> = ({
  searchQuery,
  selectedEngine,
  showDisabledOnly,
  totalSourcesCount,
  filteredSourcesCount,
  onSearchChange,
  onEngineChange,
  onToggleShowDisabled,
}) => {
  return (
    <div className="flex flex-col gap-2 p-3 bg-surface/50 border-b border-edge">
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={`Search ${totalSourcesCount} sources...`}
          className="w-full pl-9 pr-3 py-1.5 bg-app border border-edge rounded-lg text-xs text-primary placeholder-muted focus:outline-none focus:border-accent"
        />
      </div>

      <div className="flex items-center justify-between gap-2 text-xs">
        <select
          value={selectedEngine}
          onChange={(e) => onEngineChange(e.target.value)}
          className="px-2 py-1 bg-app border border-edge rounded-lg text-secondary text-xs focus:outline-none"
        >
          <option value="all">All Engines</option>
          <option value="mangadex">MangaDex API</option>
          <option value="madara">Madara (WP)</option>
          <option value="mangathemesia">MangaThemesia</option>
          <option value="foolslide">FoolSlide</option>
          <option value="wpcomics">WP Comics</option>
          <option value="custom_html">Custom HTML</option>
        </select>

        <button
          onClick={onToggleShowDisabled}
          className={`px-2.5 py-1 rounded-lg border text-xs font-medium transition ${
            showDisabledOnly
              ? 'bg-red-500/20 text-red-300 border-red-500/40'
              : 'bg-app text-muted border-edge hover:text-primary'
          }`}
        >
          {showDisabledOnly ? 'Disabled Only' : `Showing (${filteredSourcesCount})`}
        </button>
      </div>
    </div>
  );
};
