import React, { useState, useMemo } from 'react';
import {
  X,
  Trophy as TrophyIcon,
  Flame,
  BookOpen,
  Sparkles,
  Award,
  Layers,
  Clock,
  Share2,
  CheckCircle2,
  Zap,
} from 'lucide-react';
import { MangaItem } from '../types';
import { computeReadingAchievements, Trophy, MangaWrappedStats } from '../utils/achievementsEngine';

interface AchievementsModalProps {
  isOpen: boolean;
  onClose: () => void;
  mangaList: MangaItem[];
}

export const AchievementsModal: React.FC<AchievementsModalProps> = ({
  isOpen,
  onClose,
  mangaList,
}) => {
  const [activeTab, setActiveTab] = useState<'trophies' | 'wrapped'>('trophies');
  const [copiedToast, setCopiedToast] = useState(false);

  const { trophies, wrapped } = useMemo(() => {
    return computeReadingAchievements(mangaList);
  }, [mangaList]);

  if (!isOpen) return null;

  const handleShareSummary = () => {
    const text = `📚 My Graywood Reader Recap:\n` +
      `🔥 Streak: ${wrapped.currentStreakDays} Days\n` +
      `📖 Chapters Read: ${wrapped.totalChaptersRead.toLocaleString()}\n` +
      `📄 Pages Turned: ~${wrapped.totalPagesEstimated.toLocaleString()}\n` +
      `🏆 Trophies: ${wrapped.unlockedTrophiesCount} / ${wrapped.totalTrophiesCount}\n` +
      `✨ Top Genres: ${wrapped.topGenres.slice(0, 3).map((g) => g.name).join(', ')}`;

    navigator.clipboard.writeText(text).then(() => {
      setCopiedToast(true);
      setTimeout(() => setCopiedToast(false), 3000);
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-surface border border-edge rounded-3xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden text-primary">
        {/* Header */}
        <div className="p-4 sm:p-6 border-b border-edge flex items-center justify-between bg-surface/90">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 text-amber-400 border border-amber-500/30 shadow-md">
              <TrophyIcon className="w-6 h-6" />
            </div>
            <div>
              <h2 className="font-black text-lg sm:text-xl flex items-center gap-2">
                Reading Hall of Fame & Recap
              </h2>
              <p className="text-secondary text-xs">
                Milestone trophies, personal reading streaks, and annual reading recap.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex bg-app p-1 rounded-xl border border-edge">
              <button
                onClick={() => setActiveTab('trophies')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                  activeTab === 'trophies'
                    ? 'bg-accent text-accent-fg shadow-sm'
                    : 'text-secondary hover:text-primary'
                }`}
              >
                Trophies ({wrapped.unlockedTrophiesCount}/{wrapped.totalTrophiesCount})
              </button>
              <button
                onClick={() => setActiveTab('wrapped')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                  activeTab === 'wrapped'
                    ? 'bg-accent text-accent-fg shadow-sm'
                    : 'text-secondary hover:text-primary'
                }`}
              >
                Manga Wrapped
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-elevated hover:bg-elevated/80 text-secondary hover:text-primary transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {activeTab === 'trophies' ? (
            <div className="space-y-4">
              {/* Top Banner */}
              <div className="p-4 bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-accent/10 border border-amber-500/20 rounded-2xl flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">👑</span>
                  <div>
                    <h3 className="font-extrabold text-sm sm:text-base text-amber-300">
                      {wrapped.unlockedTrophiesCount === wrapped.totalTrophiesCount
                        ? 'Master Archivist (100% Unlocked)'
                        : `${wrapped.unlockedTrophiesCount} of ${wrapped.totalTrophiesCount} Achievements Unlocked`}
                    </h3>
                    <p className="text-xs text-secondary">
                      Keep reading series and logging chapters to unlock higher tier milestone trophies.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 font-mono text-sm font-bold text-amber-400">
                  <Flame className="w-4 h-4 text-orange-500" />
                  <span>{wrapped.currentStreakDays}d Streak</span>
                </div>
              </div>

              {/* Trophies Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {trophies.map((trophy) => (
                  <div
                    key={trophy.id}
                    className={`p-4 rounded-2xl border transition-all ${
                      trophy.isUnlocked
                        ? 'bg-app/90 border-amber-500/30 shadow-lg shadow-amber-500/5'
                        : 'bg-app/40 border-edge opacity-60'
                    }`}
                  >
                    <div className="flex items-start gap-3.5">
                      <div
                        className={`w-12 h-12 rounded-2xl flex items-center justify-center text-2xl shrink-0 border ${
                          trophy.isUnlocked
                            ? 'bg-amber-500/15 border-amber-500/30'
                            : 'bg-surface border-edge'
                        }`}
                      >
                        {trophy.icon}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <h4 className="font-extrabold text-sm text-primary truncate">
                            {trophy.title}
                          </h4>
                          {trophy.isUnlocked ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/30">
                              Unlocked
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-surface text-secondary border border-edge">
                              Locked
                            </span>
                          )}
                        </div>

                        <p className="text-xs text-secondary mt-1">
                          {trophy.description}
                        </p>

                        <div className="mt-3 space-y-1">
                          <div className="flex justify-between text-[11px] font-bold text-secondary">
                            <span>{trophy.progressText}</span>
                            <span>{trophy.progress}%</span>
                          </div>
                          <div className="w-full bg-surface rounded-full h-2 overflow-hidden p-0.5 border border-edge">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${
                                trophy.isUnlocked ? 'bg-amber-400' : 'bg-accent/40'
                              }`}
                              style={{ width: `${trophy.progress}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* Manga Wrapped View */
            <div className="space-y-6">
              {/* Spotify-Wrapped Style Poster Card */}
              <div className="p-6 sm:p-8 rounded-3xl bg-gradient-to-br from-indigo-950 via-purple-950 to-slate-950 border border-indigo-500/30 shadow-2xl text-white space-y-6 relative overflow-hidden">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <Sparkles className="w-5 h-5 text-amber-400" />
                    <span className="text-xs font-black uppercase tracking-widest text-indigo-300">
                      Graywood Reader • Recap
                    </span>
                  </div>
                  <button
                    onClick={handleShareSummary}
                    className="px-3.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-xs font-bold flex items-center gap-1.5 transition-all"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    <span>{copiedToast ? 'Copied to Clipboard!' : 'Share Recap'}</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="p-4 bg-white/5 rounded-2xl border border-white/10">
                    <div className="text-2xl sm:text-3xl font-black text-amber-400">
                      {wrapped.totalChaptersRead.toLocaleString()}
                    </div>
                    <div className="text-xs text-indigo-200 mt-0.5">Chapters Read</div>
                  </div>

                  <div className="p-4 bg-white/5 rounded-2xl border border-white/10">
                    <div className="text-2xl sm:text-3xl font-black text-purple-300">
                      ~{wrapped.totalPagesEstimated.toLocaleString()}
                    </div>
                    <div className="text-xs text-indigo-200 mt-0.5">Pages Turned</div>
                  </div>

                  <div className="p-4 bg-white/5 rounded-2xl border border-white/10">
                    <div className="text-2xl sm:text-3xl font-black text-emerald-400">
                      {wrapped.currentStreakDays} Days
                    </div>
                    <div className="text-xs text-indigo-200 mt-0.5">Active Streak</div>
                  </div>

                  <div className="p-4 bg-white/5 rounded-2xl border border-white/10">
                    <div className="text-2xl sm:text-3xl font-black text-sky-400">
                      ~{wrapped.totalHoursEstimated}h
                    </div>
                    <div className="text-xs text-indigo-200 mt-0.5">Reading Time</div>
                  </div>
                </div>

                {/* Top Genres Breakdown */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-2">
                  <div className="space-y-3">
                    <h4 className="font-bold text-xs uppercase tracking-wider text-indigo-300">
                      Top Genre Passions
                    </h4>
                    <div className="space-y-2">
                      {wrapped.topGenres.length === 0 ? (
                        <div className="text-xs text-indigo-300">No genre data yet.</div>
                      ) : (
                        wrapped.topGenres.map((g, idx) => (
                          <div key={g.name} className="space-y-1">
                            <div className="flex justify-between text-xs font-bold">
                              <span>#{idx + 1} {g.name}</span>
                              <span className="text-indigo-300 font-mono">{g.percentage}%</span>
                            </div>
                            <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-amber-400 to-orange-500 rounded-full"
                                style={{ width: `${g.percentage}%` }}
                              />
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <h4 className="font-bold text-xs uppercase tracking-wider text-indigo-300">
                      Format Breakdown
                    </h4>
                    <div className="space-y-2">
                      {wrapped.typeDistribution.map((t) => (
                        <div key={t.type} className="space-y-1">
                          <div className="flex justify-between text-xs font-bold">
                            <span>{t.type}</span>
                            <span className="text-indigo-300 font-mono">{t.count} series ({t.percentage}%)</span>
                          </div>
                          <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-indigo-400 to-purple-400 rounded-full"
                              style={{ width: `${t.percentage}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-edge bg-surface/80 flex items-center justify-between text-xs text-secondary">
          <span>Tracked across {wrapped.totalSeriesTracked} library entries</span>
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-elevated hover:bg-elevated/80 text-primary font-bold transition-all"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
