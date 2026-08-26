import React, { useState, useMemo } from 'react';
import { MangaItem, RecommendationItem, isNsfwManga } from '../types';
import { Sparkles, Plus, Check, Star, RefreshCw, X, ThumbsUp } from 'lucide-react';

interface RecommendationsViewProps {
  mangaList: MangaItem[];
  nsfwFilter?: 'all' | 'safe' | '18+';
  isGuest?: boolean;
  onAddRecommended: (rec: RecommendationItem) => void;
}

// Curated recommendation candidate pool spanning multiple genres, formats, and themes
const CURATED_CANDIDATES: (Omit<RecommendationItem, 'matchScore' | 'reason'> & { isNsfw?: boolean; scoreBonus?: number })[] = [
  {
    id: 'rec_solo_leveling',
    title: 'Solo Leveling (Ragnarok)',
    type: 'manhwa',
    coverImage: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=400&auto=format&fit=crop&q=80',
    description: 'Years after the Monarch war, new gates open and heirs rise to defend the world in this high-octane hunter fantasy.',
    genres: ['Action', 'Fantasy', 'Supernatural', 'Adventure'],
    latestChapter: 45,
    scoreBonus: 8,
  },
  {
    id: 'rec_omniscient_reader',
    title: "Omniscient Reader's Viewpoint",
    type: 'manhwa',
    coverImage: 'https://images.unsplash.com/photo-1618336753974-aae8e04506aa?w=400&auto=format&fit=crop&q=80',
    description: 'An ordinary office worker discovers his favorite obscure web novel is becoming reality, and only he knows the ending.',
    genres: ['Action', 'Fantasy', 'Psychological', 'Mystery'],
    latestChapter: 210,
    scoreBonus: 9,
  },
  {
    id: 'rec_greatest_estate',
    title: 'The Greatest Estate Developer',
    type: 'manhwa',
    coverImage: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=400&auto=format&fit=crop&q=80',
    description: 'A civil engineering student wakes up in the body of a lazy noble and uses modern infrastructure engineering to conquer poverty and monsters.',
    genres: ['Comedy', 'Fantasy', 'Isekai', 'Adventure'],
    latestChapter: 160,
    scoreBonus: 7,
  },
  {
    id: 'rec_frieren',
    title: 'Frieren: Beyond Journey\'s End',
    type: 'manga',
    coverImage: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=400&auto=format&fit=crop&q=80',
    description: 'An elf mage reflects on mortality, friendship, and the passage of time on a nostalgic pilgrimage across the continent.',
    genres: ['Fantasy', 'Adventure', 'Drama', 'Slice of Life'],
    latestChapter: 135,
    scoreBonus: 9,
  },
  {
    id: 'rec_magic_emperor',
    title: 'Magic Emperor (Demonic Emperor)',
    type: 'manhua',
    coverImage: 'https://images.unsplash.com/photo-1563089145-599997674d42?w=400&auto=format&fit=crop&q=80',
    description: 'The ancient Demon Emperor is reincarnated as a servant to a falling clan and plots his return to pinnacle supremacy.',
    genres: ['Action', 'Martial Arts', 'Fantasy', 'Cultivation'],
    latestChapter: 580,
    scoreBonus: 6,
  },
  {
    id: 'rec_pick_me_up',
    title: 'Pick Me Up, Infinite Gacha',
    type: 'manhwa',
    coverImage: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=400&auto=format&fit=crop&q=80',
    description: 'The rank 1 master of a hardcore gacha mobile game wakes up as a 1-star expendable unit in a rookie player\'s town.',
    genres: ['Action', 'Fantasy', 'System', 'Adventure'],
    latestChapter: 110,
    scoreBonus: 7,
  },
  {
    id: 'rec_apotheosis',
    title: 'Apotheosis',
    type: 'manhua',
    coverImage: 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=400&auto=format&fit=crop&q=80',
    description: 'A former clan heir turned human punchbag discovers a mysterious ancient book turning his body into divine weapon artifact.',
    genres: ['Action', 'Cultivation', 'Martial Arts', 'Fantasy'],
    latestChapter: 1150,
    scoreBonus: 5,
  },
  {
    id: 'rec_nanomachine',
    title: 'Nano Machine',
    type: 'manhwa',
    coverImage: 'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=400&auto=format&fit=crop&q=80',
    description: 'A rejected illegitimate prince is injected with futuristic nanotechnology by a descendant from the distant future.',
    genres: ['Action', 'Martial Arts', 'Sci-Fi', 'Murim'],
    latestChapter: 220,
    scoreBonus: 8,
  },
  {
    id: 'rec_witch_watch',
    title: 'Witch Watch',
    type: 'manga',
    coverImage: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=400&auto=format&fit=crop&q=80',
    description: 'A teenage witch moves in with her childhood friend who is tasked as her ogre familiar, leading to chaotic magical mishaps.',
    genres: ['Comedy', 'Romance', 'Supernatural', 'School'],
    latestChapter: 155,
    scoreBonus: 6,
  },
  {
    id: 'rec_adult_sample',
    title: 'Midnight Serenade',
    type: 'manhwa',
    coverImage: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=400&auto=format&fit=crop&q=80',
    description: 'A passionate adult romance drama set against a high-stakes luxury fashion studio in Seoul.',
    genres: ['Romance', 'Drama', 'Adult', '18+'],
    latestChapter: 85,
    scoreBonus: 6,
    isNsfw: true,
  },
];

export const RecommendationsView: React.FC<RecommendationsViewProps> = ({
  mangaList,
  nsfwFilter = 'all',
  isGuest = false,
  onAddRecommended,
}) => {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [seed, setSeed] = useState(0);

  // Profile library genre affinities and highly rated entries
  const { topGenres, favoriteFormat, genreCounts } = useMemo(() => {
    const counts = new Map<string, number>();
    const formatCounts = new Map<string, number>();

    for (const m of mangaList) {
      if (m.type) formatCounts.set(m.type, (formatCounts.get(m.type) || 0) + 1);
      for (const g of m.genres || []) {
        const norm = g.trim();
        if (norm) {
          const weight = (m.rating && m.rating >= 8.5 ? 2 : 1) + (m.isFavorite ? 2 : 0);
          counts.set(norm, (counts.get(norm) || 0) + weight);
        }
      }
    }

    const sortedGenres = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g);
    const sortedFormats = [...formatCounts.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f);

    return {
      topGenres: sortedGenres.slice(0, 5),
      favoriteFormat: sortedFormats[0] || 'manhwa',
      genreCounts: counts,
    };
  }, [mangaList]);

  // Compute dynamic personalized recommendations
  const dynamicRecommendations = useMemo(() => {
    if (!mangaList || mangaList.length === 0) return [];

    const existingTitles = new Set(mangaList.map((m) => m.title.toLowerCase().trim()));

    // Filter candidate pool
    const eligible = CURATED_CANDIDATES.filter((cand) => {
      if (dismissedIds.has(cand.id)) return false;
      if (existingTitles.has(cand.title.toLowerCase().trim())) return false;

      // Check NSFW / Safe mode restrictions
      const isAdult = cand.isNsfw || isNsfwManga(cand as any);
      if (isGuest && isAdult) return false;
      if (nsfwFilter === 'safe' && isAdult) return false;
      if (nsfwFilter === '18+' && !isAdult) return false;

      return true;
    });

    // Score candidates based on user tastes
    const scored = eligible.map((cand) => {
      let score = 70 + (cand.scoreBonus || 0);
      const matchingGenres: string[] = [];

      for (const g of cand.genres) {
        if (genreCounts.has(g)) {
          score += Math.min(10, (genreCounts.get(g) || 1) * 2.5);
          matchingGenres.push(g);
        }
      }

      if (cand.type === favoriteFormat) {
        score += 5;
      }

      const finalMatchScore = Math.min(99, Math.max(78, Math.round(score)));
      const topMatchTag = matchingGenres[0] || topGenres[0] || cand.genres[0] || 'Popular';

      const reason = matchingGenres.length > 1
        ? `${finalMatchScore}% Match based on your affinity for ${matchingGenres.slice(0, 2).join(' & ')}`
        : `${finalMatchScore}% Match for fans of ${topMatchTag}`;

      return {
        ...cand,
        matchScore: finalMatchScore,
        reason,
      } as RecommendationItem;
    });

    // Sort by match score and apply shuffle rotation with seed
    scored.sort((a, b) => b.matchScore - a.matchScore);
    const offset = (seed * 3) % Math.max(1, scored.length);
    const rotated = [...scored.slice(offset), ...scored.slice(0, offset)];

    return rotated.slice(0, 3);
  }, [mangaList, dismissedIds, isGuest, nsfwFilter, genreCounts, topGenres, favoriteFormat, seed]);

  const handleDismiss = (id: string) => {
    setDismissedIds((prev) => new Set(prev).add(id));
  };

  const handleRefresh = () => {
    setSeed((s) => s + 1);
  };

  // If library is empty, prompt user
  if (!mangaList || mangaList.length === 0) {
    return (
      <div className="p-6 bg-surface/60 border border-edge rounded-2xl text-center space-y-2 border-dashed">
        <div className="w-10 h-10 rounded-xl bg-info/10 text-info border border-info/20 flex items-center justify-center mx-auto">
          <Sparkles className="w-5 h-5" />
        </div>
        <h4 className="text-sm font-extrabold text-primary">Smart AI &amp; Tag Recommendation Engine</h4>
        <p className="text-xs text-secondary max-w-md mx-auto">
          Add your favorite manhwa, manhua, or manga series to your library. The recommendation engine will automatically analyze your reading preferences and suggest matching series!
        </p>
      </div>
    );
  }

  if (dynamicRecommendations.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4 pt-6 border-t border-edge/60">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-info/10 text-info border border-info/20">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-base font-extrabold text-primary flex items-center gap-2">
              Smart AI &amp; Tag Recommendations
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-info/20 text-info border border-info/30">
                Personalized
              </span>
            </h3>
            <p className="text-xs text-secondary">
              Based on your top genres {topGenres.length > 0 ? `(${topGenres.slice(0, 3).join(', ')})` : ''} and reading ratings.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleRefresh}
          className="px-3 py-1.5 rounded-xl bg-app hover:bg-elevated text-secondary hover:text-primary text-xs font-bold flex items-center gap-1.5 border border-edge transition-all cursor-pointer"
          title="Refresh recommendations"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {dynamicRecommendations.map((rec) => {
          const alreadyAdded = mangaList.some((m) => m.title.toLowerCase().trim() === rec.title.toLowerCase().trim());

          return (
            <div
              key={rec.id}
              className="p-4 bg-surface/90 border border-edge hover:border-info/40 rounded-2xl flex flex-col justify-between gap-3 transition-all shadow-md group relative"
            >
              {/* Dismiss Button */}
              <button
                type="button"
                onClick={() => handleDismiss(rec.id)}
                className="absolute top-2.5 right-2.5 p-1 rounded-lg bg-surface/80 hover:bg-danger/20 text-muted hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity z-10 cursor-pointer"
                title="Not interested"
              >
                <X className="w-3.5 h-3.5" />
              </button>

              <div className="flex gap-3">
                {rec.coverImage ? (
                  <img
                    src={rec.coverImage}
                    alt={rec.title}
                    className="w-20 h-28 object-cover rounded-xl bg-app border border-edge group-hover:scale-105 transition-transform shrink-0"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-20 h-28 rounded-xl bg-app border border-edge flex items-center justify-center text-info shrink-0">
                    <Sparkles className="w-6 h-6" />
                  </div>
                )}

                <div className="space-y-1.5 min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="px-2 py-0.5 rounded text-[10px] font-black bg-info/15 text-info border border-info/25">
                      {rec.matchScore}% Match
                    </span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-elevated text-secondary border border-edge/60">
                      {rec.type}
                    </span>
                  </div>

                  <h4 className="text-sm font-bold text-primary truncate group-hover:text-info transition-colors" title={rec.title}>
                    {rec.title}
                  </h4>

                  <p className="text-[11px] text-info/90 font-medium line-clamp-2">
                    {rec.reason}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-edge/80 pt-2.5 text-xs">
                <div className="flex items-center gap-1 text-secondary text-[11px]">
                  <ThumbsUp className="w-3 h-3 text-accent" />
                  <span>Ch. 1 - {rec.latestChapter}</span>
                </div>

                <button
                  type="button"
                  disabled={alreadyAdded}
                  onClick={() => onAddRecommended(rec)}
                  className={`px-3.5 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer ${
                    alreadyAdded
                      ? 'bg-elevated text-muted cursor-default'
                      : 'bg-gradient-to-r from-info to-info/80 hover:from-info/90 hover:to-info text-white shadow-md shadow-info/20 active:scale-95'
                  }`}
                >
                  {alreadyAdded ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5 stroke-[3]" />}
                  <span>{alreadyAdded ? 'In Library' : 'Add to Library'}</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
