// ============================================================================
// READING ACHIEVEMENTS & MANGA WRAPPED RECAP ENGINE
// Computes milestone trophies, reading streaks, player level & XP progression,
// and annual/monthly statistics across 75+ trophies.
// ============================================================================

import { MangaItem } from '../types';
import trophiesData from '../data/trophies.json';

export type TrophyCategory =
  | 'milestone'
  | 'library'
  | 'completion'
  | 'format'
  | 'genre'
  | 'streak'
  | 'habits'
  | 'curator'
  | 'sync'
  | 'features';

export type TrophyTier = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond' | 'mythic';

export interface Trophy {
  id: string;
  title: string;
  icon: string;
  description: string;
  category: TrophyCategory;
  tier: TrophyTier;
  points: number;
  isUnlocked: boolean;
  progress: number; // 0 to 100
  progressText: string;
  unlockedAt?: string;
}

export interface MangaWrappedStats {
  totalChaptersRead: number;
  totalPagesEstimated: number;
  totalHoursEstimated: number;
  totalSeriesTracked: number;
  completedSeriesCount: number;
  readingSeriesCount: number;
  planToReadCount: number;
  favoriteSeriesCount: number;
  topGenres: { name: string; count: number; percentage: number }[];
  typeDistribution: { type: string; count: number; percentage: number }[];
  currentStreakDays: number;
  longestStreakDays: number;
  unlockedTrophiesCount: number;
  totalTrophiesCount: number;
  totalScore: number;
  maxScore: number;
  scorePercentage: number;
  tierBreakdown: Record<TrophyTier, { unlocked: number; total: number }>;
  playerLevel: number;
  playerLevelTitle: string;
  currentLevelXp: number;
  nextLevelXp: number;
  levelProgressPct: number;
}

export function getPlayerLevelInfo(score: number): {
  level: number;
  title: string;
  currentLevelXp: number;
  nextLevelXp: number;
  levelProgressPct: number;
} {
  // Score to Level conversion: Level 1 at 0 XP, Level 100 cap
  // Level threshold grows smoothly: XP = (Level - 1) * 75
  const baseLevel = Math.max(1, Math.min(100, Math.floor(score / 60) + 1));
  const currentThreshold = (baseLevel - 1) * 60;
  const nextThreshold = baseLevel * 60;
  const currentLevelXp = score - currentThreshold;
  const nextLevelXp = 60;
  const levelProgressPct = Math.min(100, Math.round((currentLevelXp / nextLevelXp) * 100));

  let title = 'Novice Reader';
  if (baseLevel >= 90) title = 'Endless Sovereign';
  else if (baseLevel >= 75) title = 'Celestial Sage';
  else if (baseLevel >= 60) title = 'Transcendent Scholar';
  else if (baseLevel >= 45) title = 'Martial Grandmaster';
  else if (baseLevel >= 30) title = 'Vault Sovereign';
  else if (baseLevel >= 20) title = 'Chapter Connoisseur';
  else if (baseLevel >= 10) title = 'Dedicated Bookworm';
  else if (baseLevel >= 5) title = 'Apprentice Reader';

  return {
    level: baseLevel,
    title,
    currentLevelXp,
    nextLevelXp,
    levelProgressPct,
  };
}

export function computeReadingAchievements(mangaList: MangaItem[]): {
  trophies: Trophy[];
  wrapped: MangaWrappedStats;
} {
  const totalSeries = mangaList.length;
  let totalChapters = 0;
  let completedCount = 0;
  let readingCount = 0;
  let planToReadCount = 0;
  let onHoldCount = 0;
  let droppedCount = 0;
  let favoritesCount = 0;
  let manhwaCount = 0;
  let manhuaCount = 0;
  let mangaCount = 0;
  let ratedCount = 0;
  let masterpieceCount = 0;
  let perfectTenCount = 0;
  let notesCount = 0;
  let longNotesCount = 0;
  let tagsOrCategoriesCount = 0;
  let highTagCount = 0;
  let syncedCount = 0;
  let anilistSyncedCount = 0;
  let malSyncedCount = 0;
  let kitsuSyncedCount = 0;
  let maxSingleSeriesChapters = 0;

  // Genre clusters
  let actionFantasyCount = 0;
  let romanceCount = 0;
  let isekaiCount = 0;
  let mysteryCount = 0;
  let sliceOfLifeCount = 0;
  let scifiCount = 0;
  let supernaturalCount = 0;
  let martialArtsCount = 0;
  let sportsCount = 0;
  let historicalCount = 0;
  let comedyCount = 0;

  const genreMap = new Map<string, number>();
  const typeMap = new Map<string, number>();
  const sourceSet = new Set<string>();

  for (const m of mangaList) {
    const read = Math.max(0, Number(m.currentChapter) || 0);
    totalChapters += read;
    if (read > maxSingleSeriesChapters) {
      maxSingleSeriesChapters = read;
    }

    if (m.status === 'completed') completedCount++;
    if (m.status === 'reading') readingCount++;
    if (m.status === 'plan_to_read') planToReadCount++;
    if (m.status === 'on_hold') onHoldCount++;
    if (m.status === 'dropped') droppedCount++;

    if (m.isFavorite) favoritesCount++;
    if (m.rating && m.rating > 0) {
      ratedCount++;
      if (m.rating >= 9.5) masterpieceCount++;
      if (m.rating >= 10) perfectTenCount++;
    }

    if (m.notes && m.notes.trim().length > 0) {
      notesCount++;
      if (m.notes.trim().length > 100) longNotesCount++;
    }

    const tagCount = (m.customTags?.length || 0) + (m.categories?.length || 0);
    if (tagCount > 0) {
      tagsOrCategoriesCount++;
      if (tagCount >= 3) highTagCount++;
    }

    if (m.syncedFromApi || m.apiId) {
      syncedCount++;
      const syncStr = String(m.syncedFromApi || '').toLowerCase();
      if (syncStr.includes('anilist')) anilistSyncedCount++;
      if (syncStr.includes('mal') || syncStr.includes('myanimelist')) malSyncedCount++;
      if (syncStr.includes('kitsu')) kitsuSyncedCount++;
    }

    const src = (m.sourceName || '').trim();
    if (src) sourceSet.add(src.toLowerCase());

    const type = (m.type || 'manga').toLowerCase();
    typeMap.set(type, (typeMap.get(type) || 0) + 1);
    if (type === 'manhwa') manhwaCount++;
    else if (type === 'manhua') manhuaCount++;
    else mangaCount++;

    if (Array.isArray(m.genres)) {
      let isActionFantasy = false;
      let isRomance = false;
      let isIsekai = false;
      let isMystery = false;
      let isSlice = false;
      let isSciFi = false;
      let isSupernatural = false;
      let isMartial = false;
      let isSports = false;
      let isHist = false;
      let isCom = false;

      for (const g of m.genres) {
        if (!g) continue;
        const cleanG = g.trim();
        const lowerG = cleanG.toLowerCase();
        genreMap.set(cleanG, (genreMap.get(cleanG) || 0) + 1);

        if (lowerG.includes('action') || lowerG.includes('fantasy') || lowerG.includes('adventure') || lowerG.includes('dungeon')) {
          isActionFantasy = true;
        }
        if (lowerG.includes('romance') || lowerG.includes('shoujo') || lowerG.includes('josei') || lowerG.includes('drama') || lowerG.includes('otome')) {
          isRomance = true;
        }
        if (lowerG.includes('isekai') || lowerG.includes('reincarnation') || lowerG.includes('transmigration') || lowerG.includes('regression') || lowerG.includes('rebirth')) {
          isIsekai = true;
        }
        if (lowerG.includes('mystery') || lowerG.includes('psychological') || lowerG.includes('thriller') || lowerG.includes('suspense') || lowerG.includes('crime')) {
          isMystery = true;
        }
        if (lowerG.includes('slice of life') || lowerG.includes('school life') || lowerG.includes('iyashikei')) {
          isSlice = true;
        }
        if (lowerG.includes('comedy') || lowerG.includes('parody') || lowerG.includes('gag')) {
          isCom = true;
        }
        if (lowerG.includes('sci-fi') || lowerG.includes('mecha') || lowerG.includes('cyberpunk') || lowerG.includes('science fiction') || lowerG.includes('space')) {
          isSciFi = true;
        }
        if (lowerG.includes('supernatural') || lowerG.includes('horror') || lowerG.includes('demon') || lowerG.includes('magic') || lowerG.includes('ghost') || lowerG.includes('vampire')) {
          isSupernatural = true;
        }
        if (lowerG.includes('martial') || lowerG.includes('wuxia') || lowerG.includes('xianxia') || lowerG.includes('cultivation') || lowerG.includes('murim')) {
          isMartial = true;
        }
        if (lowerG.includes('sport') || lowerG.includes('basketball') || lowerG.includes('soccer') || lowerG.includes('boxing')) {
          isSports = true;
        }
        if (lowerG.includes('historical') || lowerG.includes('history') || lowerG.includes('period') || lowerG.includes('medieval')) {
          isHist = true;
        }
      }

      if (isActionFantasy) actionFantasyCount++;
      if (isRomance) romanceCount++;
      if (isIsekai) isekaiCount++;
      if (isMystery) mysteryCount++;
      if (isSlice) sliceOfLifeCount++;
      if (isSciFi) scifiCount++;
      if (isSupernatural) supernaturalCount++;
      if (isMartial) martialArtsCount++;
      if (isSports) sportsCount++;
      if (isHist) historicalCount++;
      if (isCom) comedyCount++;
    }
  }

  // Calculate top genres
  const sortedGenres = Array.from(genreMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const totalGenreHits = sortedGenres.reduce((acc, g) => acc + g[1], 0) || 1;
  const topGenres = sortedGenres.map(([name, count]) => ({
    name,
    count,
    percentage: Math.round((count / totalGenreHits) * 100),
  }));

  // Calculate type distribution
  const typeDistribution = Array.from(typeMap.entries()).map(([type, count]) => ({
    type: type.charAt(0).toUpperCase() + type.slice(1),
    count,
    percentage: Math.round((count / (totalSeries || 1)) * 100),
  }));

  // Streaks & reading history analysis
  let currentStreak = 1;
  let longestStreak = 3;
  let hasNightReading = false;
  let hasMorningReading = false;
  let hasLunchReading = false;
  let readlistsCount = 0;
  let downloadsCount = 0;
  let hasCustomTheme = false;

  // Check current local time
  const currentHour = new Date().getHours();
  if (currentHour >= 0 && currentHour < 5) hasNightReading = true;
  if (currentHour >= 5 && currentHour < 9) hasMorningReading = true;
  if (currentHour >= 12 && currentHour <= 14) hasLunchReading = true;

  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem('graywood_reading_history');
      if (raw) {
        const history = JSON.parse(raw);
        if (Array.isArray(history) && history.length > 0) {
          const dates = Array.from(
            new Set(
              history
                .map((h: any) => (h.timestamp ? new Date(h.timestamp).toDateString() : null))
                .filter(Boolean)
            )
          );
          currentStreak = Math.min(365, Math.max(1, dates.length));
          longestStreak = Math.max(currentStreak, Math.min(365, dates.length + 2));

          for (const h of history) {
            if (h.timestamp) {
              const hHour = new Date(h.timestamp).getHours();
              if (hHour >= 0 && hHour < 5) hasNightReading = true;
              if (hHour >= 5 && hHour < 9) hasMorningReading = true;
              if (hHour >= 12 && hHour <= 14) hasLunchReading = true;
            }
          }
        }
      }

      const rawReadlists = localStorage.getItem('graywood_custom_readlists');
      if (rawReadlists) {
        const rl = JSON.parse(rawReadlists);
        if (Array.isArray(rl)) readlistsCount = rl.length;
      }

      const rawTheme = localStorage.getItem('graywood_theme') || localStorage.getItem('theme');
      if (rawTheme && rawTheme !== 'cyber_amber') hasCustomTheme = true;

      const rawDownloads = localStorage.getItem('graywood_offline_downloads');
      if (rawDownloads) {
        const dl = JSON.parse(rawDownloads);
        if (Array.isArray(dl)) downloadsCount = dl.length;
      }
    }
  } catch {}

  // Also check client session storage
  try {
    if (typeof localStorage !== 'undefined') {
      const rawSession = localStorage.getItem('graywood_client_session_reading_history');
      if (rawSession) {
        const sess = JSON.parse(rawSession);
        for (const val of Object.values(sess) as any[]) {
          if (val.lastReadAt) {
            const sHour = new Date(val.lastReadAt).getHours();
            if (sHour >= 0 && sHour < 5) hasNightReading = true;
            if (sHour >= 5 && sHour < 9) hasMorningReading = true;
            if (sHour >= 12 && sHour <= 14) hasLunchReading = true;
          }
        }
      }
    }
  } catch {}

  // If user has any library items with lastReadAt
  for (const m of mangaList) {
    if (m.lastReadAt) {
      const mHour = new Date(m.lastReadAt).getHours();
      if (mHour >= 0 && mHour < 5) hasNightReading = true;
      if (mHour >= 5 && mHour < 9) hasMorningReading = true;
      if (mHour >= 12 && mHour <= 14) hasLunchReading = true;
    }
  }

  // Also factor imported Kotatsu statistics if available
  try {
    if (typeof localStorage !== 'undefined') {
      const rawKotatsu = localStorage.getItem('kotatsu_imported_statistics');
      if (rawKotatsu) {
        const kStats = JSON.parse(rawKotatsu);
        if (kStats.streakDays && kStats.streakDays > currentStreak) {
          currentStreak = kStats.streakDays;
          longestStreak = Math.max(longestStreak, currentStreak);
        }
      }
    }
  } catch {}

  if (totalChapters === 0 && mangaList.length === 0) {
    hasNightReading = false;
    hasMorningReading = false;
    hasLunchReading = false;
    hasCustomTheme = false;
    currentStreak = 0;
    longestStreak = 0;
  }

  const uniqueSourcesCount = sourceSet.size;
  const distinctGenresCount = genreMap.size;


  const metrics: Record<string, number> = {
    totalChapters,
    maxSingleSeriesChapters,
    totalSeries,
    completedCount,
    manhwaCount,
    manhuaCount,
    mangaCount,
    actionFantasyCount,
    romanceCount,
    isekaiCount,
    mysteryCount,
    sliceOfLifeCount,
    comedyCount,
    scifiCount,
    supernaturalCount,
    martialArtsCount,
    sportsCount,
    historicalCount,
    distinctGenresCount,
    currentStreak,
    longestStreak,
    hasNightReading: hasNightReading ? 1 : 0,
    hasMorningReading: hasMorningReading ? 1 : 0,
    hasLunchReading: hasLunchReading ? 1 : 0,
    ratedCount,
    masterpieceCount,
    perfectTenCount,
    notesCount,
    tagsOrCategoriesCount,
    anilistSyncedCount,
    malSyncedCount,
    kitsuSyncedCount,
    readlistsCount,
    hasCustomTheme: hasCustomTheme ? 1 : 0,
    downloadsCount,
    uniqueSourcesCount,
  };

  const trophies: Trophy[] = (trophiesData as Array<{
    id: string;
    title: string;
    icon: string;
    description: string;
    category: TrophyCategory;
    tier: TrophyTier;
    points: number;
    target: number;
    metric: string;
    unit: string;
  }>).map((def) => {
    const val = metrics[def.metric] ?? 0;
    const isUnlocked = val >= def.target;
    const progress = Math.min(100, Math.round((val / def.target) * 100));
    let progressText = `${Math.min(def.target, val)} / ${def.target} ${def.unit}`;
    if (def.target === 1) {
      if (def.metric.startsWith('has')) {
        progressText = isUnlocked ? 'Unlocked' : `0/1 ${def.unit}`;
      } else if (def.metric.endsWith('SyncedCount')) {
        progressText = isUnlocked ? 'Connected' : `0/1 ${def.unit}`;
      }
    }

    return {
      id: def.id,
      title: def.title,
      icon: def.icon,
      description: def.description,
      category: def.category,
      tier: def.tier,
      points: def.points,
      isUnlocked,
      progress,
      progressText,
    };
  });

  const unlockedCount = trophies.filter((t) => t.isUnlocked).length;
  const totalScore = trophies.filter((t) => t.isUnlocked).reduce((sum, t) => sum + t.points, 0);
  const maxScore = trophies.reduce((sum, t) => sum + t.points, 0);
  const scorePercentage = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;

  const tierBreakdown: Record<TrophyTier, { unlocked: number; total: number }> = {
    bronze: { unlocked: 0, total: 0 },
    silver: { unlocked: 0, total: 0 },
    gold: { unlocked: 0, total: 0 },
    platinum: { unlocked: 0, total: 0 },
    diamond: { unlocked: 0, total: 0 },
    mythic: { unlocked: 0, total: 0 },
  };

  for (const t of trophies) {
    if (tierBreakdown[t.tier]) {
      tierBreakdown[t.tier].total++;
      if (t.isUnlocked) {
        tierBreakdown[t.tier].unlocked++;
      }
    }
  }

  const levelInfo = getPlayerLevelInfo(totalScore);

  const wrapped: MangaWrappedStats = {
    totalChaptersRead: totalChapters,
    totalPagesEstimated: totalChapters * 26,
    totalHoursEstimated: Math.round(((totalChapters * 4.5) / 60) * 10) / 10,
    totalSeriesTracked: totalSeries,
    completedSeriesCount: completedCount,
    readingSeriesCount: readingCount,
    planToReadCount,
    favoriteSeriesCount: favoritesCount,
    topGenres,
    typeDistribution,
    currentStreakDays: currentStreak,
    longestStreakDays: longestStreak,
    unlockedTrophiesCount: unlockedCount,
    totalTrophiesCount: trophies.length,
    totalScore,
    maxScore,
    scorePercentage,
    tierBreakdown,
    playerLevel: levelInfo.level,
    playerLevelTitle: levelInfo.title,
    currentLevelXp: levelInfo.currentLevelXp,
    nextLevelXp: levelInfo.nextLevelXp,
    levelProgressPct: levelInfo.levelProgressPct,
  };

  return { trophies, wrapped };
}
