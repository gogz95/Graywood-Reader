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
  Search,
  Filter,
  Check,
  Lock,
  Compass,
  Star,
  Tag,
  Calendar,
  Cloud,
  ChevronRight,
  ShieldAlert,
  Wand2,
} from 'lucide-react';
import { MangaItem } from '../types';
import {
  computeReadingAchievements,
  Trophy,
  MangaWrappedStats,
  TrophyCategory,
  TrophyTier,
} from '../utils/achievementsEngine';

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
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<TrophyCategory | 'all'>('all');
  const [selectedTier, setSelectedTier] = useState<TrophyTier | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'unlocked' | 'locked'>('all');

  const { trophies, wrapped } = useMemo(() => {
    return computeReadingAchievements(mangaList);
  }, [mangaList]);

  // Filter trophies by search, category, tier, and status
  const filteredTrophies = useMemo(() => {
    return trophies.filter((t) => {
      if (selectedCategory !== 'all' && t.category !== selectedCategory) {
        return false;
      }
      if (selectedTier !== 'all' && t.tier !== selectedTier) {
        return false;
      }
      if (statusFilter === 'unlocked' && !t.isUnlocked) {
        return false;
      }
      if (statusFilter === 'locked' && t.isUnlocked) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = t.title.toLowerCase().includes(q);
        const matchesDesc = t.description.toLowerCase().includes(q);
        const matchesCat = t.category.toLowerCase().includes(q);
        const matchesTier = t.tier.toLowerCase().includes(q);
        if (!matchesTitle && !matchesDesc && !matchesCat && !matchesTier) {
          return false;
        }
      }
      return true;
    });
  }, [trophies, selectedCategory, selectedTier, statusFilter, searchQuery]);

  if (!isOpen) return null;

  const handleShareSummary = () => {
    const text =
      `📚 My Graywood Reader Recap:\n` +
      `👑 Reader Rank: Level ${wrapped.playerLevel} (${wrapped.playerLevelTitle})\n` +
      `🏆 Score: ${(wrapped.totalScore ?? 0).toLocaleString()} / ${(wrapped.maxScore ?? 0).toLocaleString()} Pts (${wrapped.unlockedTrophiesCount}/${wrapped.totalTrophiesCount} Trophies)\n` +
      `🔥 Streak: ${wrapped.currentStreakDays} Days\n` +
      `📖 Chapters Read: ${(wrapped.totalChaptersRead ?? 0).toLocaleString()}\n` +
      `📄 Pages Turned: ~${(wrapped.totalPagesEstimated ?? 0).toLocaleString()}\n` +
      `✨ Top Genres: ${wrapped.topGenres.slice(0, 3).map((g) => g.name).join(', ')}`;

    if (navigator?.clipboard?.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(() => {
          setCopiedToast(true);
          setTimeout(() => setCopiedToast(false), 3000);
        })
        .catch(() => {
          // Clipboard write fallback
        });
    }
  };

  const categories: { id: TrophyCategory | 'all'; label: string; icon: string }[] = [
    { id: 'all', label: 'All', icon: '✨' },
    { id: 'milestone', label: 'Chapters', icon: '📖' },
    { id: 'library', label: 'Vault', icon: '📚' },
    { id: 'completion', label: 'Completed', icon: '🏆' },
    { id: 'format', label: 'Formats', icon: '🌐' },
    { id: 'genre', label: 'Genres', icon: '🎨' },
    { id: 'streak', label: 'Streaks', icon: '🔥' },
    { id: 'habits', label: 'Habits', icon: '🌙' },
    { id: 'curator', label: 'Curation', icon: '⭐' },
    { id: 'sync', label: 'Trackers', icon: '☁️' },
    { id: 'features', label: 'Features', icon: '⚡' },
  ];

  const tiers: { id: TrophyTier | 'all'; label: string; color: string }[] = [
    { id: 'all', label: 'All Tiers', color: 'text-primary' },
    { id: 'bronze', label: 'Bronze', color: 'text-amber-500' },
    { id: 'silver', label: 'Silver', color: 'text-slate-300' },
    { id: 'gold', label: 'Gold', color: 'text-amber-400' },
    { id: 'platinum', label: 'Platinum', color: 'text-cyan-300' },
    { id: 'diamond', label: 'Diamond', color: 'text-sky-400' },
    { id: 'mythic', label: 'Mythic', color: 'text-fuchsia-400' },
  ];

  const getTierStyles = (tier: TrophyTier, isUnlocked: boolean) => {
    if (!isUnlocked) {
      return {
        cardBorder: 'border-edge bg-app/30 opacity-60 hover:opacity-85 transition-opacity',
        iconBg: 'bg-surface border-edge text-secondary/60',
        badge: 'bg-surface text-secondary border border-edge',
        progressBar: 'bg-accent/40',
        glow: '',
      };
    }
    switch (tier) {
      case 'mythic':
        return {
          cardBorder: 'border-fuchsia-500/50 bg-gradient-to-br from-fuchsia-950/25 via-app/95 to-purple-950/25 shadow-lg shadow-fuchsia-500/10 hover:border-fuchsia-400/80',
          iconBg: 'bg-gradient-to-br from-fuchsia-500/30 to-purple-500/30 border-fuchsia-400/60 text-fuchsia-200 shadow-sm shadow-fuchsia-500/20',
          badge: 'bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/40 font-black',
          progressBar: 'bg-gradient-to-r from-fuchsia-400 via-pink-400 to-purple-400',
          glow: 'text-fuchsia-400',
        };
      case 'diamond':
        return {
          cardBorder: 'border-sky-400/50 bg-gradient-to-br from-sky-950/25 via-app/95 to-cyan-950/25 shadow-lg shadow-sky-500/10 hover:border-sky-300/80',
          iconBg: 'bg-sky-500/20 border-sky-400/50 text-sky-200 shadow-sm shadow-sky-500/20',
          badge: 'bg-sky-500/20 text-sky-300 border border-sky-500/40 font-bold',
          progressBar: 'bg-gradient-to-r from-sky-400 to-cyan-300',
          glow: 'text-sky-400',
        };
      case 'platinum':
        return {
          cardBorder: 'border-cyan-500/40 bg-app/90 shadow-md shadow-cyan-500/5 hover:border-cyan-400/70',
          iconBg: 'bg-cyan-500/20 border-cyan-500/40 text-cyan-200',
          badge: 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-bold',
          progressBar: 'bg-cyan-400',
          glow: 'text-cyan-400',
        };
      case 'gold':
        return {
          cardBorder: 'border-amber-500/40 bg-app/90 shadow-md shadow-amber-500/5 hover:border-amber-400/70',
          iconBg: 'bg-amber-500/20 border-amber-500/40 text-amber-300',
          badge: 'bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold',
          progressBar: 'bg-amber-400',
          glow: 'text-amber-400',
        };
      case 'silver':
        return {
          cardBorder: 'border-slate-400/30 bg-app/85 shadow-sm hover:border-slate-300/50',
          iconBg: 'bg-slate-500/20 border-slate-400/30 text-slate-200',
          badge: 'bg-slate-500/20 text-slate-200 border border-slate-500/30 font-semibold',
          progressBar: 'bg-slate-300',
          glow: 'text-slate-300',
        };
      case 'bronze':
      default:
        return {
          cardBorder: 'border-amber-700/30 bg-app/80 shadow-sm hover:border-amber-600/50',
          iconBg: 'bg-amber-700/15 border-amber-700/30 text-amber-400',
          badge: 'bg-amber-800/20 text-amber-400 border border-amber-700/30 font-semibold',
          progressBar: 'bg-amber-500',
          glow: 'text-amber-500',
        };
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 md:p-6 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-surface border border-edge rounded-2xl sm:rounded-3xl w-full max-w-6xl max-h-[95vh] sm:max-h-[92vh] flex flex-col shadow-2xl overflow-hidden text-primary">
        {/* Header */}
        <div className="p-3.5 sm:p-5 border-b border-edge flex flex-wrap items-center justify-between gap-3 bg-surface/95 sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div className="p-2 sm:p-2.5 rounded-xl sm:rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 text-amber-400 border border-amber-500/30 shadow-md">
              <TrophyIcon className="w-5 h-5 sm:w-6 h-6" />
            </div>
            <div>
              <h2 className="font-black text-base sm:text-xl flex items-center gap-2">
                Reading Hall of Fame & Recap
              </h2>
              <p className="text-secondary text-[11px] sm:text-xs">
                75+ milestone trophies, player leveling progression, streaks, and annual recap.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex bg-app p-1 rounded-xl border border-edge">
              <button
                onClick={() => setActiveTab('trophies')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  activeTab === 'trophies'
                    ? 'bg-accent text-accent-fg shadow-sm'
                    : 'text-secondary hover:text-primary'
                }`}
              >
                Trophies ({wrapped.unlockedTrophiesCount}/{wrapped.totalTrophiesCount})
              </button>
              <button
                onClick={() => setActiveTab('wrapped')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
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
              className="p-2 rounded-xl bg-elevated hover:bg-elevated/80 text-secondary hover:text-primary transition-colors active:scale-95"
              aria-label="Close Achievements Modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-3.5 sm:p-6 space-y-5">
          {activeTab === 'trophies' ? (
            <div className="space-y-5">
              {/* Player Level & XP Progression Banner */}
              <div className="p-4 sm:p-5 bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-purple-500/15 border border-amber-500/25 rounded-2xl shadow-lg relative overflow-hidden">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="relative">
                      <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-600 flex flex-col items-center justify-center text-accent-fg font-black shadow-lg border-2 border-amber-300">
                        <span className="text-[10px] uppercase font-bold tracking-wider opacity-90">LVL</span>
                        <span className="text-xl sm:text-2xl font-black leading-none">{wrapped.playerLevel}</span>
                      </div>
                      <div className="absolute -bottom-1 -right-1 p-1 bg-surface rounded-full border border-edge text-amber-400 shadow">
                        <Sparkles className="w-3.5 h-3.5" />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-extrabold text-base sm:text-lg text-primary">
                          {wrapped.playerLevelTitle}
                        </h3>
                        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-black bg-amber-500/20 text-amber-300 border border-amber-500/30">
                          {wrapped.scorePercentage}% Complete
                        </span>
                      </div>
                      <p className="text-xs text-secondary max-w-xl">
                        Gain GamerScore XP by conquering reading milestones, curating series, and expanding your archive.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 sm:gap-4 shrink-0">
                    <div className="p-2.5 rounded-xl bg-app/80 border border-edge text-center min-w-[90px]">
                      <div className="text-[11px] text-secondary font-bold">GamerScore</div>
                      <div className="text-sm sm:text-base font-black text-amber-400 font-mono">
                        {(wrapped.totalScore ?? 0).toLocaleString()} <span className="text-[10px] text-muted">/ {(wrapped.maxScore ?? 0).toLocaleString()}</span>
                      </div>
                    </div>

                    <div className="p-2.5 rounded-xl bg-app/80 border border-edge text-center min-w-[85px]">
                      <div className="text-[11px] text-secondary font-bold">Daily Streak</div>
                      <div className="flex items-center justify-center gap-1 text-sm sm:text-base font-black text-orange-400 font-mono">
                        <Flame className="w-4 h-4 text-orange-500 fill-orange-500" />
                        <span>{wrapped.currentStreakDays}d</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Level XP Bar */}
                <div className="mt-4 pt-3 border-t border-amber-500/20 space-y-1.5">
                  <div className="flex justify-between text-xs font-bold text-secondary">
                    <span className="flex items-center gap-1 text-amber-300">
                      <Zap className="w-3.5 h-3.5" />
                      <span>Level Progress</span>
                    </span>
                    <span className="font-mono text-primary">
                      {wrapped.currentLevelXp} / {wrapped.nextLevelXp} XP ({wrapped.levelProgressPct}%)
                    </span>
                  </div>
                  <div className="w-full bg-app/80 rounded-full h-2.5 overflow-hidden p-0.5 border border-amber-500/30">
                    <div
                      className="h-full bg-gradient-to-r from-amber-400 via-orange-400 to-yellow-300 rounded-full transition-all duration-700 shadow-sm"
                      style={{ width: `${wrapped.levelProgressPct}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Search, Tier & Status Filters Toolbar */}
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
                  {/* Search bar */}
                  <div className="relative flex-1 max-w-md">
                    <Search className="w-4 h-4 text-secondary absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search 75+ achievements by name, description, tier..."
                      className="w-full pl-9 pr-8 py-2 bg-app border border-edge rounded-xl text-xs text-primary placeholder-muted focus:outline-none focus:border-accent transition-all"
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-primary"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Status filter buttons */}
                  <div className="flex items-center gap-1 bg-app p-1 rounded-xl border border-edge self-start sm:self-auto text-xs font-semibold">
                    <button
                      onClick={() => setStatusFilter('all')}
                      className={`px-3 py-1 rounded-lg transition-all ${
                        statusFilter === 'all'
                          ? 'bg-elevated text-primary font-bold shadow-sm'
                          : 'text-secondary hover:text-primary'
                      }`}
                    >
                      All ({trophies.length})
                    </button>
                    <button
                      onClick={() => setStatusFilter('unlocked')}
                      className={`px-3 py-1 rounded-lg transition-all ${
                        statusFilter === 'unlocked'
                          ? 'bg-amber-500/20 text-amber-300 font-bold'
                          : 'text-secondary hover:text-primary'
                      }`}
                    >
                      Unlocked ({wrapped.unlockedTrophiesCount})
                    </button>
                    <button
                      onClick={() => setStatusFilter('locked')}
                      className={`px-3 py-1 rounded-lg transition-all ${
                        statusFilter === 'locked'
                          ? 'bg-surface text-secondary font-bold'
                          : 'text-secondary hover:text-primary'
                      }`}
                    >
                      Locked ({trophies.length - wrapped.unlockedTrophiesCount})
                    </button>
                  </div>
                </div>

                {/* Tier Selection Pills */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs no-scrollbar">
                  {tiers.map((t) => {
                    const count =
                      t.id === 'all'
                        ? trophies.length
                        : wrapped.tierBreakdown[t.id]?.total || 0;
                    const unlockedCount =
                      t.id === 'all'
                        ? wrapped.unlockedTrophiesCount
                        : wrapped.tierBreakdown[t.id]?.unlocked || 0;
                    const isSelected = selectedTier === t.id;

                    return (
                      <button
                        key={t.id}
                        onClick={() => setSelectedTier(t.id)}
                        className={`px-3 py-1.5 rounded-xl font-bold shrink-0 flex items-center gap-1.5 transition-all border ${
                          isSelected
                            ? 'bg-accent text-accent-fg border-accent shadow-sm'
                            : 'bg-app border-edge text-secondary hover:text-primary hover:bg-elevated/60'
                        }`}
                      >
                        <span className={isSelected ? 'text-accent-fg' : t.color}>●</span>
                        <span>{t.label}</span>
                        <span className="text-[10px] opacity-75 font-mono">
                          ({unlockedCount}/{count})
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Category Selection Pills */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs no-scrollbar">
                  {categories.map((cat) => {
                    const count =
                      cat.id === 'all'
                        ? trophies.length
                        : trophies.filter((t) => t.category === cat.id).length;
                    const isSelected = selectedCategory === cat.id;

                    return (
                      <button
                        key={cat.id}
                        onClick={() => setSelectedCategory(cat.id)}
                        className={`px-3 py-1.5 rounded-xl font-bold shrink-0 flex items-center gap-1.5 transition-all border ${
                          isSelected
                            ? 'bg-elevated text-primary border-edge-strong shadow-sm'
                            : 'bg-app border-edge text-secondary hover:text-primary hover:bg-elevated/40'
                        }`}
                      >
                        <span>{cat.icon}</span>
                        <span>{cat.label}</span>
                        <span className="text-[10px] opacity-75 font-mono">({count})</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Trophies Grid */}
              {filteredTrophies.length === 0 ? (
                <div className="py-16 text-center bg-app/40 rounded-2xl border border-edge p-6 space-y-2">
                  <TrophyIcon className="w-10 h-10 text-muted mx-auto" />
                  <h4 className="text-sm font-bold text-primary">No Achievements Found</h4>
                  <p className="text-xs text-secondary max-w-sm mx-auto">
                    Try adjusting your search query, tier filters, or category filters.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                  {filteredTrophies.map((trophy) => {
                    const styles = getTierStyles(trophy.tier, trophy.isUnlocked);

                    return (
                      <div
                        key={trophy.id}
                        className={`p-4 rounded-2xl border transition-all relative overflow-hidden group flex flex-col justify-between ${styles.cardBorder}`}
                      >
                        <div className="space-y-3">
                          <div className="flex items-start gap-3">
                            <div
                              className={`w-11 h-11 rounded-2xl flex items-center justify-center text-2xl shrink-0 border transition-transform group-hover:scale-105 ${styles.iconBg}`}
                            >
                              {trophy.icon}
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-1.5">
                                <h4 className="font-extrabold text-sm text-primary truncate">
                                  {trophy.title}
                                </h4>
                                <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.2 rounded font-black ${styles.badge}`}>
                                  {trophy.tier}
                                </span>
                              </div>

                              <p className="text-[11px] text-secondary mt-1 leading-snug line-clamp-2">
                                {trophy.description}
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="mt-3.5 pt-2.5 border-t border-edge/60 space-y-1.5">
                          <div className="flex items-center justify-between text-[11px] font-bold">
                            <span className="font-mono text-secondary truncate max-w-[150px]">{trophy.progressText}</span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="text-[10px] font-mono font-black text-amber-400">
                                +{trophy.points} pts
                              </span>
                              {trophy.isUnlocked ? (
                                <span className="px-1.5 py-0.2 rounded-full text-[9px] font-black uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-0.5">
                                  <Check className="w-2.5 h-2.5" />
                                  <span>Unlocked</span>
                                </span>
                              ) : (
                                <span className="px-1.5 py-0.2 rounded-full text-[9px] font-black uppercase tracking-wider bg-surface text-secondary border border-edge flex items-center gap-0.5">
                                  <Lock className="w-2.5 h-2.5" />
                                  <span>{trophy.progress}%</span>
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="w-full bg-surface rounded-full h-1.5 overflow-hidden border border-edge">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${styles.progressBar}`}
                              style={{ width: `${trophy.progress}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
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
                      Graywood Reader • Reading Recap
                    </span>
                  </div>
                  <button
                    onClick={handleShareSummary}
                    className="px-3.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-xs font-bold flex items-center gap-1.5 transition-all active:scale-95"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    <span>{copiedToast ? 'Copied to Clipboard!' : 'Share Recap'}</span>
                  </button>
                </div>

                {/* Level & Rank Highlight */}
                <div className="p-4 bg-white/5 rounded-2xl border border-white/10 flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-slate-950 flex flex-col items-center justify-center font-black">
                      <span className="text-[9px] uppercase">LVL</span>
                      <span className="text-xl leading-none">{wrapped.playerLevel}</span>
                    </div>
                    <div>
                      <div className="text-xs text-indigo-300 font-bold">Reader Rank</div>
                      <div className="text-lg font-black text-amber-300">{wrapped.playerLevelTitle}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-center">
                    <div>
                      <div className="text-[11px] text-indigo-300 font-bold">Achievements</div>
                      <div className="text-sm font-black text-white font-mono">
                        {wrapped.unlockedTrophiesCount} / {wrapped.totalTrophiesCount}
                      </div>
                    </div>
                    <div className="w-px h-8 bg-white/10" />
                    <div>
                      <div className="text-[11px] text-indigo-300 font-bold">Total GamerScore</div>
                      <div className="text-sm font-black text-amber-400 font-mono">
                        {(wrapped.totalScore ?? 0).toLocaleString()} pts
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="p-4 bg-white/5 rounded-2xl border border-white/10">
                    <div className="text-2xl sm:text-3xl font-black text-amber-400 font-mono">
                      {(wrapped.totalChaptersRead ?? 0).toLocaleString()}
                    </div>
                    <div className="text-xs text-indigo-200 mt-0.5">Chapters Read</div>
                  </div>

                  <div className="p-4 bg-white/5 rounded-2xl border border-white/10">
                    <div className="text-2xl sm:text-3xl font-black text-purple-300 font-mono">
                      ~{(wrapped.totalPagesEstimated ?? 0).toLocaleString()}
                    </div>
                    <div className="text-xs text-indigo-200 mt-0.5">Pages Turned</div>
                  </div>

                  <div className="p-4 bg-white/5 rounded-2xl border border-white/10">
                    <div className="text-2xl sm:text-3xl font-black text-emerald-400 font-mono">
                      {wrapped.currentStreakDays} Days
                    </div>
                    <div className="text-xs text-indigo-200 mt-0.5">Active Streak</div>
                  </div>

                  <div className="p-4 bg-white/5 rounded-2xl border border-white/10">
                    <div className="text-2xl sm:text-3xl font-black text-sky-400 font-mono">
                      ~{wrapped.totalHoursEstimated}h
                    </div>
                    <div className="text-xs text-indigo-200 mt-0.5">Reading Time</div>
                  </div>
                </div>

                {/* Tier Medals Showcase */}
                <div className="p-4 bg-white/5 rounded-2xl border border-white/10 space-y-2.5">
                  <div className="flex items-center justify-between text-xs font-bold text-indigo-200">
                    <span>Trophy Tier Breakdown</span>
                    <span className="font-mono text-amber-300 font-black">{(wrapped.totalScore ?? 0).toLocaleString()} / {(wrapped.maxScore ?? 0).toLocaleString()} Points</span>
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center text-xs">
                    <div className="p-2 bg-white/5 rounded-xl border border-amber-700/30">
                      <div className="text-[10px] text-amber-400 font-bold uppercase">Bronze</div>
                      <div className="text-sm font-black text-white">{wrapped.tierBreakdown.bronze.unlocked} / {wrapped.tierBreakdown.bronze.total}</div>
                    </div>
                    <div className="p-2 bg-white/5 rounded-xl border border-slate-400/30">
                      <div className="text-[10px] text-slate-300 font-bold uppercase">Silver</div>
                      <div className="text-sm font-black text-white">{wrapped.tierBreakdown.silver.unlocked} / {wrapped.tierBreakdown.silver.total}</div>
                    </div>
                    <div className="p-2 bg-white/5 rounded-xl border border-amber-500/40">
                      <div className="text-[10px] text-amber-300 font-bold uppercase">Gold</div>
                      <div className="text-sm font-black text-white">{wrapped.tierBreakdown.gold.unlocked} / {wrapped.tierBreakdown.gold.total}</div>
                    </div>
                    <div className="p-2 bg-white/5 rounded-xl border border-cyan-500/40">
                      <div className="text-[10px] text-cyan-300 font-bold uppercase">Platinum</div>
                      <div className="text-sm font-black text-white">{wrapped.tierBreakdown.platinum.unlocked} / {wrapped.tierBreakdown.platinum.total}</div>
                    </div>
                    <div className="p-2 bg-white/5 rounded-xl border border-sky-400/50">
                      <div className="text-[10px] text-sky-300 font-bold uppercase">Diamond</div>
                      <div className="text-sm font-black text-white">{wrapped.tierBreakdown.diamond.unlocked} / {wrapped.tierBreakdown.diamond.total}</div>
                    </div>
                    <div className="p-2 bg-white/5 rounded-xl border border-fuchsia-500/50">
                      <div className="text-[10px] text-fuchsia-300 font-bold uppercase">Mythic</div>
                      <div className="text-sm font-black text-white">{wrapped.tierBreakdown.mythic.unlocked} / {wrapped.tierBreakdown.mythic.total}</div>
                    </div>
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
                              <span>
                                #{idx + 1} {g.name}
                              </span>
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
                            <span className="text-indigo-300 font-mono">
                              {t.count} series ({t.percentage}%)
                            </span>
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
        <div className="p-3.5 sm:p-4 border-t border-edge bg-surface/90 flex items-center justify-between text-xs text-secondary sticky bottom-0">
          <span>Tracked across {wrapped.totalSeriesTracked} library entries</span>
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-elevated hover:bg-elevated/80 text-primary font-bold transition-all active:scale-95"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
