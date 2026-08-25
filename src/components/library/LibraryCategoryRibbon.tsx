import React from 'react';
import { UserCategory, MangaItem, ReadingStatus } from '../../types';
import { renderCategoryIcon } from '../ManageCategoriesModal';
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  List,
  Grid3X3,
  Plus,
  Folder,
} from 'lucide-react';

interface LibraryCategoryRibbonProps {
  categories: UserCategory[];
  activeCategory: string | null;
  setActiveCategory: (id: string | null) => void;
  setStatusFilter: (status: ReadingStatus | 'all' | 'favorites' | 'flagged') => void;
  mangaList: MangaItem[];
  categoryCounts: Map<string, number>;
  isShelvesExpanded: boolean;
  setIsShelvesExpanded: (expanded: boolean) => void;
  canScrollLeft: boolean;
  canScrollRight: boolean;
  scrollShelves: (dir: 'left' | 'right') => void;
  handleShelfWheel: (e: React.WheelEvent<HTMLDivElement>) => void;
  checkShelfScroll: () => void;
  shelvesRef: React.RefObject<HTMLDivElement | null>;
  onOpenManageCategories: () => void;
}

export const LibraryCategoryRibbon: React.FC<LibraryCategoryRibbonProps> = ({
  categories,
  activeCategory,
  setActiveCategory,
  setStatusFilter,
  mangaList,
  categoryCounts,
  isShelvesExpanded,
  setIsShelvesExpanded,
  canScrollLeft,
  canScrollRight,
  scrollShelves,
  handleShelfWheel,
  checkShelfScroll,
  shelvesRef,
  onOpenManageCategories,
}) => {
  return (
    <div className="pt-2.5 border-t border-edge/60 space-y-2 min-w-0">
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-1.5 text-xs font-bold text-secondary shrink-0">
          <Bookmark className="w-3.5 h-3.5 text-accent" />
          <span>Shelves</span>
          {categories.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-black bg-elevated text-primary border border-edge">
              {categories.length}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0 ml-auto text-xs">
          {/* Scroll buttons (visible when single row and scrollable) */}
          {!isShelvesExpanded && categories.length > 2 && (
            <div className="flex items-center gap-0.5 bg-app border border-edge rounded-xl p-0.5">
              <button
                type="button"
                onClick={() => scrollShelves('left')}
                disabled={!canScrollLeft}
                className={`p-1 rounded-lg transition-colors cursor-pointer ${
                  canScrollLeft ? 'text-primary hover:bg-elevated hover:text-accent' : 'text-muted/40 cursor-not-allowed'
                }`}
                title="Scroll shelves left"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => scrollShelves('right')}
                disabled={!canScrollRight}
                className={`p-1 rounded-lg transition-colors cursor-pointer ${
                  canScrollRight ? 'text-primary hover:bg-elevated hover:text-accent' : 'text-muted/40 cursor-not-allowed'
                }`}
                title="Scroll shelves right"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Expand / Wrap Grid Toggle */}
          {categories.length > 2 && (
            <button
              type="button"
              onClick={() => setIsShelvesExpanded(!isShelvesExpanded)}
              className={`px-2 py-1 rounded-xl text-[11px] font-bold flex items-center gap-1 transition-all border cursor-pointer ${
                isShelvesExpanded
                  ? 'bg-accent text-accent-fg border-accent shadow-xs'
                  : 'bg-app border-edge text-secondary hover:text-primary hover:bg-elevated'
              }`}
              title={isShelvesExpanded ? 'Collapse shelves to single scrollable row' : 'Expand all shelves'}
            >
              {isShelvesExpanded ? <List className="w-3 h-3" /> : <Grid3X3 className="w-3 h-3" />}
              <span>{isShelvesExpanded ? 'Row' : 'All'}</span>
            </button>
          )}

          {/* Manage Shelves Button */}
          <button
            onClick={onOpenManageCategories}
            className="px-2.5 py-1 rounded-xl bg-accent-2/15 hover:bg-accent-2/25 text-accent-2 border border-accent-2/30 text-[11px] font-bold flex items-center gap-1 transition-all shadow-xs cursor-pointer"
            title="Add or organize custom shelves"
          >
            <Plus className="w-3 h-3" />
            <span>{categories.length === 0 ? 'Create Shelf' : 'Manage'}</span>
          </button>
        </div>
      </div>

      {/* Shelves Container */}
      <div
        ref={shelvesRef}
        onWheel={handleShelfWheel}
        onScroll={checkShelfScroll}
        className={`transition-all duration-200 min-w-0 ${
          isShelvesExpanded
            ? 'flex flex-wrap items-center gap-1.5 py-1 max-h-48 overflow-y-auto'
            : 'flex items-center gap-1.5 overflow-x-auto py-1 scroll-smooth'
        }`}
        style={{
          scrollbarWidth: 'thin',
          scrollbarColor: 'var(--color-edge, rgba(255,255,255,0.15)) transparent'
        }}
      >
        {/* All Shelves Pill */}
        <button
          onClick={() => {
            setActiveCategory(null);
            setStatusFilter('all');
          }}
          className={`px-2.5 py-1 rounded-xl transition-all whitespace-nowrap flex items-center gap-1.5 text-xs shrink-0 cursor-pointer ${
            activeCategory === null
              ? 'bg-accent text-accent-fg font-black shadow-sm ring-1 ring-white/20'
              : 'bg-elevated/60 text-secondary hover:bg-elevated hover:text-primary border border-edge/60'
          }`}
        >
          <Folder className="w-3 h-3" />
          <span>All Shelves</span>
          <span
            className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
              activeCategory === null ? 'bg-black/25 text-black' : 'bg-surface text-muted'
            }`}
          >
            {mangaList.length}
          </span>
        </button>

        {/* Individual Custom Category Shelves */}
        {categories.map((cat) => {
          const isCatActive = activeCategory === cat.id;
          const count = categoryCounts.get(cat.id) || 0;

          return (
            <button
              key={cat.id}
              onClick={() => {
                if (activeCategory === cat.id) {
                  setActiveCategory(null);
                } else {
                  setActiveCategory(cat.id);
                  setStatusFilter('all');
                }
              }}
              className={`px-2.5 py-1 rounded-xl transition-all whitespace-nowrap flex items-center gap-1.5 text-xs shrink-0 cursor-pointer ${
                isCatActive
                  ? 'font-black shadow-md ring-2 ring-white/40 scale-[1.02]'
                  : 'bg-elevated/60 text-secondary hover:bg-elevated hover:text-primary border border-edge/60 hover:border-edge'
              }`}
              style={
                isCatActive
                  ? { backgroundColor: cat.color || '#f59e0b', color: '#000' }
                  : undefined
              }
            >
              <span style={!isCatActive ? { color: cat.color || '#f59e0b' } : undefined}>
                {renderCategoryIcon(cat.icon, 'w-3 h-3')}
              </span>
              <span className="font-semibold">{cat.name}</span>
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
                  isCatActive ? 'bg-black/25 text-black' : 'bg-surface text-muted'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}

        {categories.length === 0 && (
          <span className="text-xs text-muted italic py-0.5">No custom shelves created yet. Click &quot;+ Create Shelf&quot; to make one!</span>
        )}
      </div>
    </div>
  );
};
