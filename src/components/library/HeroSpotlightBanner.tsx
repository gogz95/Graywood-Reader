import React, { useState, useEffect, useCallback } from 'react';
import { MangaItem, isNsfwManga } from '../../types';
import {
  Star,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Play,
  Flame,
} from 'lucide-react';

export interface HeroSpotlightProps {
  items: MangaItem[];
  onOpenReader: (manga: MangaItem, chapterNumber?: number) => void;
  onSelectManga: (manga: MangaItem) => void;
}

export const HeroSpotlightBanner = React.memo<HeroSpotlightProps>(({ items, onOpenReader, onSelectManga }) => {
  const [index, setIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  const total = Math.min(items.length, 6);

  const prevSlide = useCallback(() => {
    setIndex((prev) => (prev > 0 ? prev - 1 : total - 1));
  }, [total]);

  const nextSlide = useCallback(() => {
    setIndex((prev) => (prev < total - 1 ? prev + 1 : 0));
  }, [total]);

  // Auto-advance spotlight slide every 7 seconds when not hovered
  useEffect(() => {
    if (total <= 1 || isPaused) return;
    const timer = setInterval(() => {
      nextSlide();
    }, 7000);
    return () => clearInterval(timer);
  }, [total, isPaused, nextSlide]);

  if (!items || items.length === 0) return null;
  const current = items[Math.min(index, items.length - 1)];
  if (!current) return null;

  const progress = current.latestChapter > 0 ? Math.min(100, Math.round((current.currentChapter / current.latestChapter) * 100)) : 0;
  const hasNew = current.latestChapter > current.currentChapter;
  const isAdult = isNsfwManga(current);

  return (
    <div
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      className="relative rounded-3xl overflow-hidden border border-edge/80 shadow-2xl bg-surface/90 text-primary min-h-[300px] sm:min-h-[340px] flex flex-col justify-between group transition-all"
    >
      {/* Blurred ambient backdrop art */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <img
          src={current.coverImage}
          alt=""
          className="w-full h-full object-cover blur-3xl opacity-25 scale-125 transition-all duration-700"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-app via-app/90 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-app via-transparent to-black/50" />
        <div className="hero-ambient-glow absolute inset-0" />
      </div>

      {/* Main Hero Content */}
      <div className="relative z-10 p-5 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
        <div className="space-y-3.5 max-w-2xl">
          {/* Badges */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black tracking-wide uppercase bg-accent/20 text-accent border border-accent/30 shadow-xs flex items-center gap-1">
              <Flame className="w-3 h-3 fill-accent" />
              <span>SPOTLIGHT</span>
            </span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
              current.type === 'manhwa' ? 'bg-blue-950/80 text-info border-info/30' :
              current.type === 'manhua' ? 'bg-red-950/80 text-danger border-danger/30' :
              'bg-purple-950/80 text-accent-2 border-accent-2/30'
            }`}>
              {current.type === 'manga' ? '🇯🇵 Manga' : current.type === 'manhwa' ? '🇰🇷 Manhwa' : current.type === 'novel' ? '📖 Novel' : '🇨🇳 Manhua'}
            </span>
            {hasNew && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gradient-to-r from-accent-2 to-accent text-accent-fg shadow-sm">
                +{current.latestChapter - current.currentChapter} New Chapters
              </span>
            )}
            {isAdult && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-950 text-rose-300 border border-rose-500/40 shadow-sm">
                🔞 18+ Mature
              </span>
            )}
            <div className="flex items-center gap-1 text-xs font-bold text-accent bg-app/60 px-2 py-0.5 rounded-full border border-edge">
              <Star className="w-3 h-3 fill-accent text-accent" />
              <span>{current.rating || '9.5'}</span>
            </div>
          </div>

          {/* Title */}
          <div>
            <h2
              onClick={() => onSelectManga(current)}
              className="text-2xl sm:text-4xl font-black text-primary hover:text-accent cursor-pointer transition-colors tracking-tight line-clamp-1 sm:line-clamp-2"
            >
              {current.title}
            </h2>
            {current.altTitles && current.altTitles.length > 0 && (
              <p className="text-xs text-secondary/80 font-medium line-clamp-1 mt-0.5">
                {current.altTitles[0]}
              </p>
            )}
          </div>

          {/* Synopsis */}
          {current.description && (
            <p className="text-xs sm:text-sm text-secondary line-clamp-2 sm:line-clamp-3 leading-relaxed max-w-xl">
              {current.description}
            </p>
          )}

          {/* Progress Indicator */}
          <div className="space-y-1.5 pt-1 max-w-md">
            <div className="flex items-center justify-between text-xs font-semibold text-secondary">
              <span>Chapter {current.currentChapter} of {current.latestChapter}</span>
              <span className="text-accent font-bold">{progress}% read</span>
            </div>
            <div className="w-full h-2 rounded-full bg-app/80 border border-edge/60 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-accent to-accent-2 rounded-full transition-all duration-500 shadow-sm"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* Action CTAs */}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => onOpenReader(current, current.currentChapter + 1)}
              className="px-5 py-2.5 rounded-2xl bg-gradient-to-r from-accent to-accent-2 hover:from-accent-bright hover:to-accent-2 text-accent-fg font-black text-xs sm:text-sm flex items-center gap-2 shadow-lg shadow-accent/25 hover:shadow-accent/40 transition-all hover:scale-105 active:scale-95 cursor-pointer"
            >
              <Play className="w-4 h-4 fill-accent-fg" />
              <span>Resume Chapter {current.currentChapter + 1}</span>
            </button>

            <button
              type="button"
              onClick={() => onSelectManga(current)}
              className="px-4 py-2.5 rounded-2xl bg-elevated/80 hover:bg-elevated text-primary font-bold text-xs sm:text-sm border border-edge-strong flex items-center gap-1.5 transition-all hover:scale-105 active:scale-95 cursor-pointer"
            >
              <BookOpen className="w-4 h-4 text-accent" />
              <span>View Series Info</span>
            </button>
          </div>
        </div>

        {/* 3D Floating Cover Card (Desktop) */}
        <div
          onClick={() => onSelectManga(current)}
          className="hidden sm:block relative shrink-0 cursor-pointer group/cover"
        >
          <div className="relative aspect-[3/4] w-40 sm:w-48 rounded-2xl overflow-hidden shadow-2xl border-2 border-white/10 group-hover/cover:scale-105 group-hover/cover:border-accent transition-all duration-300">
            <img
              src={current.coverImage}
              alt={current.title}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover/cover:opacity-100 transition-opacity flex items-end p-3">
              <span className="text-xs font-bold text-white flex items-center gap-1">
                <BookOpen className="w-3.5 h-3.5 text-accent" /> View Details
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Slide Navigation Dots */}
      {total > 1 && (
        <div className="relative z-10 px-6 py-2.5 bg-app/40 backdrop-blur-md border-t border-edge/60 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {items.slice(0, total).map((item, idx) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setIndex(idx)}
                aria-label={`Slide to ${item.title}`}
                className={`h-2 rounded-full transition-all duration-300 cursor-pointer ${
                  index === idx ? 'w-8 bg-accent' : 'w-2 bg-edge-strong hover:bg-muted'
                }`}
              />
            ))}
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={prevSlide}
              className="p-1 rounded-lg bg-elevated/70 hover:bg-elevated text-secondary hover:text-primary transition-colors cursor-pointer"
              title="Previous featured series"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={nextSlide}
              className="p-1 rounded-lg bg-elevated/70 hover:bg-elevated text-secondary hover:text-primary transition-colors cursor-pointer"
              title="Next featured series"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
});
