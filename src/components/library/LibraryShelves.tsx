import React from 'react';
import { MangaItem } from '../../types';
import {
  Flame,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Play,
  Star,
} from 'lucide-react';

export interface JumpBackInShelfProps {
  items: MangaItem[];
  onOpenReader: (manga: MangaItem, chapterNumber?: number) => void;
  onSelectManga: (manga: MangaItem) => void;
}

export const JumpBackInShelf = React.memo<JumpBackInShelfProps>(({ items, onOpenReader, onSelectManga }) => {
  const scrollRef = React.useRef<HTMLDivElement>(null);

  if (!items || items.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-accent/15 text-accent border border-accent/25">
            <Flame className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-base font-black text-primary tracking-tight">Jump Back In</h3>
            <p className="text-[11px] text-secondary">Continue where you left off</p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => scrollRef.current?.scrollBy({ left: -340, behavior: 'smooth' })}
            className="p-1.5 rounded-xl bg-surface border border-edge hover:border-edge-strong text-secondary hover:text-primary transition-colors cursor-pointer"
            title="Scroll left"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => scrollRef.current?.scrollBy({ left: 340, behavior: 'smooth' })}
            className="p-1.5 rounded-xl bg-surface border border-edge hover:border-edge-strong text-secondary hover:text-primary transition-colors cursor-pointer"
            title="Scroll right"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="shelf-carousel gap-4 no-scrollbar py-1 flex overflow-x-auto"
      >
        {items.map((manga) => {
          const progress = manga.latestChapter > 0 ? Math.min(100, Math.round((manga.currentChapter / manga.latestChapter) * 100)) : 0;
          const hasNew = manga.latestChapter > manga.currentChapter;

          return (
            <div
              key={manga.id}
              onClick={() => onSelectManga(manga)}
              className="w-80 sm:w-96 card-wide-resume bg-surface/90 border border-edge/80 hover:border-accent/60 rounded-2xl p-3.5 flex gap-3.5 shadow-lg group cursor-pointer shrink-0"
            >
              <div className="relative w-20 sm:w-24 aspect-[3/4] rounded-xl overflow-hidden bg-app shrink-0">
                <img
                  src={manga.coverImage}
                  alt={manga.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  loading="lazy"
                />
                {hasNew && (
                  <span className="absolute top-1 left-1 px-1.5 py-0.2 rounded text-[9px] font-black bg-accent-2 text-accent-fg shadow-md">
                    +{manga.latestChapter - manga.currentChapter}
                  </span>
                )}
              </div>

              <div className="flex-1 min-w-0 flex flex-col justify-between space-y-2">
                <div>
                  <h4 className="font-bold text-sm text-primary group-hover:text-accent transition-colors line-clamp-1">
                    {manga.title}
                  </h4>
                  <p className="text-[11px] text-secondary line-clamp-1">
                    {manga.altTitles[0] || manga.sourceName}
                  </p>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] font-semibold text-secondary">
                    <span>Ch. {manga.currentChapter} of {manga.latestChapter}</span>
                    <span className="text-accent font-bold">{progress}%</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-app overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-accent to-accent-2 rounded-full"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenReader(manga, manga.currentChapter + 1);
                  }}
                  className="w-full py-1.5 rounded-xl bg-accent text-accent-fg font-black text-xs flex items-center justify-center gap-1.5 shadow-sm hover:bg-accent-bright transition-all active:scale-95 cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5 fill-accent-fg" />
                  <span>Resume Ch. {manga.currentChapter + 1}</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

export interface FreshReleasesShelfProps {
  items: MangaItem[];
  onOpenReader: (manga: MangaItem, chapterNumber?: number) => void;
  onSelectManga: (manga: MangaItem) => void;
}

export const FreshReleasesShelf = React.memo<FreshReleasesShelfProps>(({ items, onOpenReader, onSelectManga }) => {
  const scrollRef = React.useRef<HTMLDivElement>(null);

  if (!items || items.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-accent-2/15 text-accent-2 border border-accent-2/25">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-base font-black text-primary tracking-tight">Fresh Releases &amp; Updates</h3>
            <p className="text-[11px] text-secondary">Series with new chapters waiting for you</p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => scrollRef.current?.scrollBy({ left: -340, behavior: 'smooth' })}
            className="p-1.5 rounded-xl bg-surface border border-edge hover:border-edge-strong text-secondary hover:text-primary transition-colors cursor-pointer"
            title="Scroll left"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => scrollRef.current?.scrollBy({ left: 340, behavior: 'smooth' })}
            className="p-1.5 rounded-xl bg-surface border border-edge hover:border-edge-strong text-secondary hover:text-primary transition-colors cursor-pointer"
            title="Scroll right"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="shelf-carousel gap-4 no-scrollbar py-1 flex overflow-x-auto"
      >
        {items.map((manga) => (
          <div
            key={manga.id}
            onClick={() => onSelectManga(manga)}
            className="w-36 sm:w-44 card-interactive bg-surface/90 border border-edge/80 hover:border-accent/60 rounded-2xl overflow-hidden shadow-lg flex flex-col shrink-0 cursor-pointer group"
          >
            <div className="relative aspect-[3/4] w-full overflow-hidden bg-app">
              <img
                src={manga.coverImage}
                alt={manga.title}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-app via-transparent to-black/40" />

              <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-black bg-gradient-to-r from-accent-2 to-accent text-accent-fg shadow-md">
                +{manga.latestChapter - manga.currentChapter} New
              </span>

              <div className="absolute bottom-2 left-2 flex items-center gap-1 bg-app/80 backdrop-blur-md px-1.5 py-0.5 rounded-md border border-edge text-[10px] font-bold text-accent">
                <Star className="w-2.5 h-2.5 fill-accent text-accent" />
                <span>{manga.rating || '9.0'}</span>
              </div>
            </div>

            <div className="p-2.5 space-y-1.5 flex-1 flex flex-col justify-between">
              <div>
                <h4 className="font-bold text-xs text-primary group-hover:text-accent transition-colors line-clamp-1">
                  {manga.title}
                </h4>
                <p className="text-[10px] text-secondary line-clamp-1">
                  Ch. {manga.currentChapter} / {manga.latestChapter}
                </p>
              </div>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenReader(manga, manga.currentChapter + 1);
                }}
                className="w-full py-1 rounded-lg bg-accent text-accent-fg font-black text-[11px] flex items-center justify-center gap-1 shadow-sm hover:bg-accent-bright transition-all cursor-pointer"
              >
                <Play className="w-3 h-3 fill-accent-fg" />
                <span>Read Ch. {manga.currentChapter + 1}</span>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});
