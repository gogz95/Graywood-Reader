import React, { useMemo } from 'react';
import { MangaItem } from '../types';
import { isReaderAvailable } from '../utils/catalog';
import { Sparkles, Star, BookOpen, Play } from 'lucide-react';

interface Props {
  mangaList: MangaItem[];
  onSelectManga: (m: MangaItem) => void;
  onOpenReader: (m: MangaItem, chapterNumber?: number) => void;
}

const MAX_RECOMMENDATIONS = 12;

// Inline "Suggested For You" carousel (mirrors Kotatsu's recommendation slider).
// Ranks every series by how closely it matches the user's most common library genres,
// then surfaces the top picks as a horizontal scroller.
export const RecommendationsRow: React.FC<Props> = ({ mangaList, onSelectManga, onOpenReader }) => {
  const picks = useMemo(() => {
    if (!mangaList || mangaList.length === 0) return [];

    // 1. Weighted genre frequency across the library (favorites/reading count more).
    const genreScore = new Map<string, number>();
    mangaList.forEach((m) => {
      const weight = (m.isFavorite ? 3 : 0) + (m.status === 'reading' ? 2 : 0) + 1;
      (m.genres || []).forEach((g) => genreScore.set(g, (genreScore.get(g) || 0) + weight));
    });
    const topGenres = Array.from(genreScore.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([g]) => g);

    // 2. Rank all series by genre match + rating. Prefer showing something new.
    return mangaList
      .map((m) => {
        let score = (m.rating || 0) * 10;
        (m.genres || []).forEach((g) => {
          const idx = topGenres.indexOf(g);
          if (idx >= 0) score += 400 - idx * 100;
        });
        if (m.isFavorite) score -= 200;
        if (m.status === 'reading') score -= 100;
        return { m, score };
      })
      .filter(({ m }) => !m.isFlagged)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RECOMMENDATIONS)
      .map(({ m }) => m);
  }, [mangaList]);

  if (picks.length === 0) return null;

  return (
    <div className="bg-surface border border-edge rounded-3xl p-5 shadow-xl space-y-3">
      <div className="flex items-center gap-2">
        <div className="p-2 rounded-xl bg-info/10 text-info border border-info/20">
          <Sparkles className="w-4 h-4" />
        </div>
        <div>
          <h3 className="text-sm font-extrabold text-primary flex items-center gap-2">
            Suggested For You
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-info/20 text-info border border-info/30">
              Personalized
            </span>
          </h3>
          <p className="text-[11px] text-secondary">Based on your library genres and ratings</p>
        </div>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
        {picks.map((m) => (
          <div key={m.id} className="w-32 shrink-0 bg-app border border-edge rounded-2xl overflow-hidden flex flex-col group">
            <div
              onClick={() => onSelectManga(m)}
              className="relative aspect-[3/4] w-full overflow-hidden bg-app cursor-pointer"
            >
              <img
                src={m.coverImage}
                alt={m.title}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
              <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-app/90 text-accent border border-edge flex items-center gap-0.5">
                <Star className="w-2.5 h-2.5 fill-accent" />
                {m.rating}
              </span>
              <span className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-black/50 text-white border border-white/10">
                {m.type}
              </span>
            </div>
            <div className="p-2 space-y-1.5 flex flex-col">
              <p
                onClick={() => onSelectManga(m)}
                className="text-[11px] font-bold text-primary truncate cursor-pointer group-hover:text-info transition-colors"
                title={m.title}
              >
                {m.title}
              </p>
              <p className="text-[10px] text-secondary truncate">{(m.genres || []).slice(0, 2).join(', ')}</p>
              {isReaderAvailable(m) ? (
                <button
                  onClick={() => onOpenReader(m)}
                  className="mt-auto py-1.5 rounded-lg bg-gradient-to-r from-info to-info text-accent-fg font-black text-[10px] flex items-center justify-center gap-1 shadow-md transition-all"
                >
                  <Play className="w-2.5 h-2.5 fill-accent-fg" />
                  Read
                </button>
              ) : (
                <button
                  onClick={() => onSelectManga(m)}
                  className="mt-auto py-1.5 rounded-lg bg-elevated text-info font-bold text-[10px] flex items-center justify-center gap-1 border border-info/30 transition-all"
                >
                  <BookOpen className="w-2.5 h-2.5" />
                  View Info
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
