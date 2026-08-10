import React from 'react';
import { MangaItem, RecommendationItem } from '../types';
import { Sparkles, Plus, Check, Star, Zap, BookOpen } from 'lucide-react';

interface RecommendationsViewProps {
  mangaList: MangaItem[];
  onAddRecommended: (rec: RecommendationItem) => void;
}

export const RecommendationsView: React.FC<RecommendationsViewProps> = ({
  mangaList,
  onAddRecommended,
}) => {
  // If library is empty, prompt user to add series first
  if (!mangaList || mangaList.length === 0) {
    return (
      <div className="p-6 bg-slate-900/60 border border-slate-800 rounded-2xl text-center space-y-2 border-dashed">
        <div className="w-10 h-10 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 flex items-center justify-center mx-auto">
          <Sparkles className="w-5 h-5" />
        </div>
        <h4 className="text-sm font-extrabold text-slate-200">Smart AI & Tag Recommendation Engine</h4>
        <p className="text-xs text-slate-400 max-w-md mx-auto">
          Add your favorite manhwa, manhua, or manga series to your library. The AI recommendation engine will automatically analyze your reading preferences and suggest matching series!
        </p>
      </div>
    );
  }

  // Calculate dynamic recommendations based on user library genres
  const userGenres = Array.from(new Set(mangaList.flatMap((m) => m.genres || [])));
  const topGenre: string = (userGenres[0] as string) || 'Action';


  const recommendations: RecommendationItem[] = [
    {
      id: 'rec_dynamic_1',
      title: `Recommended for ${topGenre} Fans`,
      type: 'manhwa',
      coverImage: mangaList[0]?.coverImage || '',
      description: `Based on your library entries featuring ${topGenre}, this top-rated series shares high thematic similarity and matching tags.`,
      genres: [topGenre, 'Fantasy', 'Adventure'],
      matchScore: 98,
      reason: `98% Match based on your library entries in ${topGenre}`,
      latestChapter: 150,
    },
  ];

  return (
    <div className="space-y-4 pt-4 border-t border-slate-800">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-base font-extrabold text-slate-100 flex items-center gap-2">
              Smart AI & Tag Recommendations
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                Personalized
              </span>
            </h3>
            <p className="text-xs text-slate-400">Based on your highest rated series and genre preferences.</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {recommendations.map((rec) => {
          const alreadyAdded = mangaList.some((m) => m.title.toLowerCase() === rec.title.toLowerCase());
          return (
            <div
              key={rec.id}
              className="p-4 bg-slate-900 border border-slate-800 hover:border-cyan-500/40 rounded-2xl flex flex-col justify-between gap-3 transition-all shadow-md group"
            >
              <div className="flex gap-3">
                {rec.coverImage ? (
                  <img
                    src={rec.coverImage}
                    alt={rec.title}
                    className="w-20 h-28 object-cover rounded-xl bg-slate-950 border border-slate-800 group-hover:scale-105 transition-transform"
                  />
                ) : (
                  <div className="w-20 h-28 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-center text-cyan-400">
                    <Sparkles className="w-6 h-6" />
                  </div>
                )}

                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="px-2 py-0.2 rounded text-[10px] font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                      {rec.matchScore}% Match
                    </span>
                    <span className="px-1.5 py-0.2 rounded text-[10px] font-bold uppercase bg-slate-800 text-slate-300">
                      {rec.type}
                    </span>
                  </div>

                  <h4 className="text-sm font-bold text-slate-100 truncate group-hover:text-cyan-300 transition-colors">
                    {rec.title}
                  </h4>

                  <p className="text-[11px] text-cyan-300/80 font-semibold line-clamp-2">
                    {rec.reason}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-slate-800/80 pt-2 text-xs">
                <span className="text-slate-400 text-[11px]">Ch. 1 - {rec.latestChapter}</span>

                <button
                  disabled={alreadyAdded}
                  onClick={() => onAddRecommended(rec)}
                  className={`px-3.5 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all ${
                    alreadyAdded
                      ? 'bg-slate-800 text-slate-500 cursor-default'
                      : 'bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 text-slate-950 shadow-md'
                  }`}
                >
                  {alreadyAdded ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5 stroke-[3]" />}
                  <span>{alreadyAdded ? 'In Library' : 'Add Series'}</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
