import React from 'react';
import {
  Sparkles,
  Lock,
  Search,
  Check,
  ZoomIn,
  Wand2,
  Image as ImageIcon,
} from 'lucide-react';

interface CoverItem {
  url: string;
  label: string;
  source: string;
}

interface MetadataCoversTabProps {
  allCovers: CoverItem[];
  currentCover: string;
  setCurrentCover: (url: string) => void;
  locks: Set<string>;
  toggleLock: (field: string) => void;
  coverSearchQuery: string;
  setCoverSearchQuery: (q: string) => void;
  coverCategory: string;
  setCoverCategory: (cat: string) => void;
  customCoverUrl: string;
  setCustomCoverUrl: (url: string) => void;
  loading: boolean;
  onSearch: (query: string) => void;
  setLightboxCover: (cover: CoverItem | null) => void;
}

export const MetadataCoversTab: React.FC<MetadataCoversTabProps> = ({
  allCovers,
  currentCover,
  setCurrentCover,
  locks,
  toggleLock,
  coverSearchQuery,
  setCoverSearchQuery,
  coverCategory,
  setCoverCategory,
  customCoverUrl,
  setCustomCoverUrl,
  loading,
  onSearch,
  setLightboxCover,
}) => {
  const filteredCovers = allCovers.filter((cover) => {
    if (coverCategory === 'all') return true;
    return cover.source.toLowerCase().includes(coverCategory);
  });

  return (
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
            onSearch(coverSearchQuery);
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
            type="button"
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
            type="button"
            onClick={() => setCoverCategory('mangadex')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
              coverCategory === 'mangadex'
                ? 'bg-accent text-accent-fg font-black shadow-sm'
                : 'bg-elevated text-secondary hover:text-primary'
            }`}
          >
            MangaDex ({allCovers.filter((c) => c.source.toLowerCase().includes('mangadex')).length})
          </button>
          <button
            type="button"
            onClick={() => setCoverCategory('anilist')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
              coverCategory === 'anilist'
                ? 'bg-accent text-accent-fg font-black shadow-sm'
                : 'bg-elevated text-secondary hover:text-primary'
            }`}
          >
            AniList ({allCovers.filter((c) => c.source.toLowerCase().includes('anilist')).length})
          </button>
        </div>
      </div>

      {/* Cover Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
        {filteredCovers.map((cover, idx) => {
          const isSelected = currentCover === cover.url;
          return (
            <div
              key={idx}
              className={`group relative rounded-xl overflow-hidden border transition-all ${
                isSelected
                  ? 'ring-2 ring-accent border-accent scale-[1.02] shadow-lg'
                  : 'border-edge hover:border-accent/50'
              }`}
            >
              <div className="aspect-[2/3] bg-app relative overflow-hidden">
                <img
                  src={cover.url}
                  alt={cover.label}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />

                {isSelected && (
                  <div className="absolute top-2 right-2 p-1.5 rounded-full bg-accent text-accent-fg font-bold shadow-md">
                    <Check className="w-4 h-4" />
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setLightboxCover(cover)}
                  className="absolute bottom-2 right-2 p-1.5 rounded-lg bg-black/70 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/90"
                  title="View Full Resolution Poster"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
              </div>

              <div className="p-2.5 bg-surface space-y-1">
                <p className="text-[11px] font-bold text-primary truncate" title={cover.label}>
                  {cover.label}
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted truncate">{cover.source}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setCurrentCover(cover.url);
                      if (!locks.has('coverImage')) toggleLock('coverImage');
                    }}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${
                      isSelected
                        ? 'bg-accent/20 text-accent border border-accent/40'
                        : 'bg-elevated hover:bg-accent hover:text-accent-fg text-secondary'
                    }`}
                  >
                    {isSelected ? 'Active' : 'Select'}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Manual Cover URL Input */}
      <div className="p-4 bg-app/50 border border-edge rounded-xl space-y-2">
        <label className="text-xs font-bold text-primary flex items-center gap-1.5">
          <ImageIcon className="w-3.5 h-3.5 text-accent" />
          <span>Custom Image / Poster URL Override</span>
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={customCoverUrl}
            onChange={(e) => setCustomCoverUrl(e.target.value)}
            placeholder="Paste custom cover image URL (e.g. https://domain.com/cover.jpg)"
            className="flex-1 bg-surface border border-edge rounded-xl px-3 py-2 text-xs text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
          />
          <button
            type="button"
            onClick={() => {
              if (customCoverUrl.trim()) {
                setCurrentCover(customCoverUrl.trim());
                if (!locks.has('coverImage')) toggleLock('coverImage');
              }
            }}
            className="px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs flex items-center gap-1 hover:bg-accent/90 transition-all shadow-sm"
          >
            <Wand2 className="w-3.5 h-3.5" />
            <span>Apply Cover</span>
          </button>
        </div>
      </div>
    </div>
  );
};
