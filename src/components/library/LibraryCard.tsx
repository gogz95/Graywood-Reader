import React from 'react';
import {
  MangaItem,
  isNsfwManga,
} from '../../types';
import {
  BookOpen,
  Star,
  Edit2,
  Trash2,
  AlertTriangle,
  Check,
} from 'lucide-react';

import { SafeCoverImage } from '../common/SafeCoverImage';

/** Memoized Shimmer Placeholder Card for smooth loading */
export const MangaSkeletonCard = React.memo(() => (
  <div className="bg-surface/90 border border-edge/80 rounded-2xl overflow-hidden shadow-lg flex flex-col">
    <div className="aspect-[3/4] w-full skeleton-shimmer" />
    <div className="p-3.5 space-y-3 flex-1 flex flex-col justify-between">
      <div className="space-y-2">
        <div className="h-4 w-3/4 skeleton-shimmer rounded-lg" />
        <div className="h-3 w-1/2 skeleton-shimmer rounded-lg" />
      </div>
      <div className="space-y-2 pt-1 border-t border-edge/60">
        <div className="h-1.5 w-full skeleton-shimmer rounded-full" />
        <div className="h-8 w-full skeleton-shimmer rounded-xl" />
      </div>
    </div>
  </div>
));

export interface MangaGridCardProps {
  manga: MangaItem;
  isSelectMode: boolean;
  isSelected: boolean;
  isReaderAvailable: boolean;
  onToggleSelect: (id: string) => void;
  onSelectManga: (manga: MangaItem) => void;
  onOpenReader: (manga: MangaItem, chapterNumber?: number) => void;
  onOpenChapters: (manga: MangaItem) => void;
  onIncrementChapter: (id: string) => void;
  onQuickEdit: (manga: MangaItem) => void;
}

/** Memoized Manga Grid Card to eliminate redundant re-renders on large libraries */
export const MangaGridCard = React.memo<MangaGridCardProps>(({
  manga,
  isSelectMode,
  isSelected,
  isReaderAvailable,
  onToggleSelect,
  onSelectManga,
  onOpenReader,
  onOpenChapters,
  onIncrementChapter,
  onQuickEdit,
}) => {
  const hasNewChapter = manga.latestChapter > manga.currentChapter;
  const progress =
    manga.latestChapter > 0
      ? Math.min(100, Math.round((manga.currentChapter / manga.latestChapter) * 100))
      : 0;

  return (
    <div className="group card-interactive bg-surface/95 border border-edge/80 hover:border-accent/50 rounded-2xl overflow-hidden shadow-xl flex flex-col relative transition-all duration-300">
      {/* Cover Image Container */}
      <div
        onClick={() => {
          if (isSelectMode) onToggleSelect(manga.id);
          else onSelectManga(manga);
        }}
        className="relative aspect-[3/4] w-full overflow-hidden bg-app cursor-pointer"
      >
        <SafeCoverImage
          src={manga.coverImage}
          alt={manga.title}
          fallbackMessage="Missing Cover"
          className="w-full h-full object-cover group-hover:scale-108 transition-all duration-500 ease-out"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-app via-transparent to-black/30 group-hover:from-app/90 transition-colors pointer-events-none" />

        {/* Multi-Select Checkbox Badge */}
        {isSelectMode && (
          <div className="absolute top-2.5 right-2.5 z-20">
            <div className={`w-6 h-6 rounded-xl flex items-center justify-center border shadow-lg transition-all ${
              isSelected
                ? 'bg-accent border-accent text-accent-fg scale-110'
                : 'bg-surface/80 border-edge text-transparent backdrop-blur-md'
            }`}>
              <Check className="w-4 h-4 stroke-[3]" />
            </div>
          </div>
        )}

        {/* Badges Overlay */}
        <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between gap-1">
          <span
            className={`px-2 py-0.5 rounded-lg text-[10px] font-extrabold tracking-wide uppercase border backdrop-blur-md shadow-md ${
              manga.type === 'manhwa'
                ? 'bg-blue-950/80 text-info border-info/30'
                : manga.type === 'manhua'
                ? 'bg-red-950/80 text-danger border-danger/30'
                : 'bg-purple-950/80 text-accent-2 border-accent-2/30'
            }`}
          >
            {manga.type === 'manga' ? '🇯🇵 Manga' : manga.type === 'manhwa' ? '🇰🇷 Manhwa' : manga.type === 'novel' ? '📖 Novel' : '🇨🇳 Manhua'}
          </span>

          {hasNewChapter && (
            <span className="px-2 py-0.5 rounded-lg text-[10px] font-black bg-gradient-to-r from-accent-2 to-accent text-accent-fg shadow-md shadow-accent/20 animate-pulse">
              +{manga.latestChapter - manga.currentChapter} New
            </span>
          )}

          {isNsfwManga(manga) && (
            <span className="px-1.5 py-0.5 rounded-lg text-[10px] font-black bg-rose-950/90 text-rose-300 border border-rose-500/50 shadow-md">
              🔞 18+
            </span>
          )}

          {manga.isFlagged ? (
            <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black border shadow-md flex items-center gap-1 ${
              manga.flagReason?.toLowerCase().includes('missing source')
                ? 'bg-amber-950/90 text-amber-300 border-amber-500/50'
                : 'bg-danger/90 text-white border-danger'
            }`}>
              <AlertTriangle className="w-3 h-3" />
              <span>{manga.flagReason?.toLowerCase().includes('missing source') ? 'NO SOURCE' : 'FLAGGED'}</span>
            </span>
          ) : !isReaderAvailable ? (
            <span className="px-2 py-0.5 rounded-lg text-[10px] font-black bg-amber-950/80 text-amber-400 border border-amber-500/30 shadow-md flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              <span>NO SOURCE</span>
            </span>
          ) : null}
        </div>

        {/* Rating Badge */}
        <div className="absolute bottom-2.5 left-2.5 flex items-center gap-1 bg-app/85 backdrop-blur-md px-2 py-0.5 rounded-lg border border-edge/80 text-xs font-bold text-accent shadow-sm">
          <Star className="w-3 h-3 fill-accent text-accent" />
          <span>{manga.rating}</span>
        </div>
      </div>

      {/* Card Content */}
      <div className="p-3.5 flex-1 flex flex-col justify-between space-y-3">
        <div className="space-y-1">
          <h4
            onClick={() => onSelectManga(manga)}
            className="text-sm font-bold font-display text-primary line-clamp-1 hover:text-accent cursor-pointer transition-colors"
            title={manga.title}
          >
            {manga.title}
          </h4>
          <p className="text-[11px] text-secondary line-clamp-1 font-medium">
            {manga.altTitles[0] || manga.sourceName}
          </p>
        </div>

        {/* Chapter Progress */}
        <div className="space-y-1.5 pt-1 border-t border-edge/70">
          <div className="flex items-center justify-between text-xs font-semibold">
            <span className="text-secondary">Ch. {manga.currentChapter}</span>
            <span className="text-muted text-[11px] font-mono">of {manga.latestChapter}</span>
          </div>

          <div className="w-full h-1.5 rounded-full bg-app/90 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                progress === 100
                  ? 'bg-success'
                  : hasNewChapter
                  ? 'bg-gradient-to-r from-accent-2 to-accent-bright'
                  : 'bg-accent'
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-1.5 pt-1">
          {isReaderAvailable ? (
            <button
              onClick={() => onOpenReader(manga, manga.currentChapter + 1)}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl bg-gradient-to-r from-accent to-accent-2 hover:from-accent-bright hover:to-accent-2 text-accent-fg font-black text-xs transition-all shadow-md shadow-accent/20 hover:shadow-accent/40 active:scale-[0.97] cursor-pointer"
              title="Open Webtoon Reader for next chapter"
            >
              <BookOpen className="w-3.5 h-3.5 fill-accent-fg" />
              <span>Read Ch. {manga.currentChapter + 1}</span>
            </button>
          ) : (
            <button
              onClick={() => onSelectManga(manga)}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl bg-elevated hover:bg-elevated/80 text-primary font-bold text-xs transition-all border border-edge-strong active:scale-[0.97] cursor-pointer"
            >
              <BookOpen className="w-3.5 h-3.5 text-accent" />
              <span>View Info</span>
            </button>
          )}

          <div className="flex items-center gap-1">
            <button
              onClick={() => onOpenChapters(manga)}
              className="flex-1 py-1.5 rounded-lg bg-elevated hover:bg-elevated/80 text-secondary hover:text-white text-[11px] font-bold transition-colors border border-edge-strong/80 active:scale-[0.97] cursor-pointer"
              title="View full chapter list"
            >
              Chapters
            </button>

            <button
              onClick={() => onIncrementChapter(manga.id)}
              className="px-2.5 py-1.5 rounded-lg bg-elevated hover:bg-success hover:text-accent-fg text-secondary text-[11px] font-black transition-all border border-edge-strong/80 active:scale-[0.97] cursor-pointer"
              title="Quick mark +1 read without opening reader"
            >
              +1
            </button>

            <button
              onClick={() => onQuickEdit(manga)}
              className="p-1.5 rounded-lg bg-elevated/80 hover:bg-elevated text-secondary hover:text-primary transition-colors border border-edge active:scale-[0.97] cursor-pointer"
              title="Edit series"
            >
              <Edit2 className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

export interface MangaListRowProps {
  manga: MangaItem;
  isSelectMode: boolean;
  isSelected: boolean;
  isReaderAvailable: boolean;
  onToggleSelect: (id: string) => void;
  onSelectManga: (manga: MangaItem) => void;
  onOpenReader: (manga: MangaItem, chapterNumber?: number) => void;
  onOpenChapters: (manga: MangaItem) => void;
  onIncrementChapter: (id: string) => void;
  onQuickEdit: (manga: MangaItem) => void;
  onDeleteManga: (id: string) => void;
}

/** Memoized Manga List Row for high-performance table view */
export const MangaListRow = React.memo<MangaListRowProps>(({
  manga,
  isSelectMode,
  isSelected,
  isReaderAvailable,
  onToggleSelect,
  onSelectManga,
  onOpenReader,
  onOpenChapters,
  onIncrementChapter,
  onQuickEdit,
  onDeleteManga,
}) => {
  const hasNew = manga.latestChapter > manga.currentChapter;

  return (
    <tr
      onClick={() => {
        if (isSelectMode) onToggleSelect(manga.id);
      }}
      className={`hover:bg-elevated/40 transition-colors ${
        isSelected ? 'bg-accent/10' : ''
      } ${isSelectMode ? 'cursor-pointer' : ''}`}
    >
      {isSelectMode && (
        <td className="py-3 px-3">
          <div className={`w-5 h-5 rounded flex items-center justify-center border ${
            isSelected ? 'bg-accent border-accent text-accent-fg' : 'border-edge bg-surface text-transparent'
          }`}>
            <Check className="w-3.5 h-3.5 stroke-[3]" />
          </div>
        </td>
      )}
      <td className="py-3 px-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-12 shrink-0">
            <SafeCoverImage
              src={manga.coverImage}
              alt={manga.title}
              compact
              fallbackMessage="Missing"
              className="w-9 h-12 rounded-lg object-cover bg-app border border-edge/60 shrink-0"
            />
          </div>
          <div>
            <div
              onClick={() => {
                if (!isSelectMode) onSelectManga(manga);
              }}
              className="font-bold text-primary hover:text-accent cursor-pointer line-clamp-1 flex items-center gap-1.5"
            >
              <span>{manga.title}</span>
              {isNsfwManga(manga) && (
                <span className="px-1.5 py-0.2 rounded text-[9px] font-black bg-rose-950/80 text-rose-300 border border-rose-500/40">
                  🔞 18+
                </span>
              )}
            </div>
            <div className="text-[11px] text-secondary line-clamp-1">
              {manga.altTitles[0] || 'No alt title'}
            </div>
          </div>
        </div>
      </td>
      <td className="py-3 px-4 font-medium uppercase">
        <span
          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
            manga.type === 'manhwa'
              ? 'bg-blue-950 text-info border border-info/20'
              : manga.type === 'manhua'
              ? 'bg-red-950 text-danger border border-danger/20'
              : 'bg-purple-950 text-accent-2 border border-accent-2/20'
          }`}
        >
          {manga.type === 'manga' ? '🇯🇵 Manga' : manga.type === 'manhwa' ? '🇰🇷 Manhwa' : manga.type === 'novel' ? '📖 Novel' : '🇨🇳 Manhua'}
        </span>
      </td>
      <td className="py-3 px-4 capitalize">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-elevated text-secondary">
          {manga.status.replace(/_/g, ' ')}
        </span>
      </td>
      <td className="py-3 px-4">
        <div className="flex items-center gap-2">
          <span className="font-bold text-primary">Ch. {manga.currentChapter}</span>
          <span className="text-muted">/ {manga.latestChapter}</span>
          {hasNew && (
            <span className="px-1.5 py-0.2 rounded text-[10px] bg-accent-2 text-accent-fg font-bold">
              NEW
            </span>
          )}
        </div>
      </td>
      <td className="py-3 px-4 font-bold text-accent">★ {manga.rating}</td>
      <td className="py-3 px-4 text-secondary">
        <div className="flex items-center gap-1.5">
          <span>{manga.sourceName}</span>
          {(manga.isFlagged && manga.flagReason?.toLowerCase().includes('missing source')) || !isReaderAvailable ? (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-950/80 text-amber-300 border border-amber-500/40" title="Missing reading source">
              No Source
            </span>
          ) : manga.isFlagged ? (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-danger/80 text-white" title={manga.flagReason}>
              Flagged
            </span>
          ) : null}
        </div>
      </td>
      <td className="py-3 px-4 text-right">
        <div className="flex items-center justify-end gap-1.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenReader(manga, manga.currentChapter + 1);
            }}
            className="px-2.5 sm:px-3 py-1 sm:py-1.5 rounded bg-accent text-accent-fg font-bold hover:bg-accent-bright transition-all text-xs sm:text-sm flex items-center gap-1 cursor-pointer"
          >
            <BookOpen className="w-3 h-3 sm:w-3.5 sm:h-3.5 fill-accent-fg" />
            Read Ch. {manga.currentChapter + 1}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenChapters(manga);
            }}
            className="px-2 sm:px-2.5 py-1 sm:py-1.5 rounded bg-elevated text-secondary hover:text-white transition-all text-xs sm:text-sm cursor-pointer"
          >
            Chapters
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onIncrementChapter(manga.id);
            }}
            className="px-2 sm:px-2.5 py-1 sm:py-1.5 rounded bg-elevated text-success hover:bg-emerald-950 transition-all text-xs sm:text-sm font-bold cursor-pointer"
            title="Quick mark +1 read"
          >
            +1
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onQuickEdit(manga);
            }}
            className="p-1 rounded bg-elevated text-secondary hover:text-white cursor-pointer"
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDeleteManga(manga.id);
            }}
            className="p-1 rounded bg-elevated text-danger hover:bg-red-950 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
});
