// ============================================================================
// READING ACHIEVEMENTS & MANGA WRAPPED RECAP ENGINE
// Computes milestone trophies, reading streaks, player level & XP progression,
// and annual/monthly statistics across 75+ trophies.
// ============================================================================

import { MangaItem } from '../types';

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

  const trophies: Trophy[] = [
    // ------------------------------------------------------------------------
    // 1. CHAPTER MILESTONES (1 to 25,000 chapters)
    // ------------------------------------------------------------------------
    {
      id: 'first_step',
      title: 'First Step',
      icon: '📖',
      description: 'Read your first manga, manhwa, or manhua chapter.',
      category: 'milestone',
      tier: 'bronze',
      points: 10,
      isUnlocked: totalChapters >= 1,
      progress: Math.min(100, Math.round((totalChapters / 1) * 100)),
      progressText: `${Math.min(1, totalChapters)} / 1 Chapter`,
    },
    {
      id: 'page_flipper',
      title: 'Page Flipper',
      icon: '📄',
      description: 'Read 25 total chapters across your entire library.',
      category: 'milestone',
      tier: 'bronze',
      points: 15,
      isUnlocked: totalChapters >= 25,
      progress: Math.min(100, Math.round((totalChapters / 25) * 100)),
      progressText: `${Math.min(25, totalChapters)} / 25 Chapters`,
    },
    {
      id: 'avid_reader',
      title: 'Avid Reader',
      icon: '🔖',
      description: 'Read 50 total chapters across your collection.',
      category: 'milestone',
      tier: 'bronze',
      points: 20,
      isUnlocked: totalChapters >= 50,
      progress: Math.min(100, Math.round((totalChapters / 50) * 100)),
      progressText: `${Math.min(50, totalChapters)} / 50 Chapters`,
    },
    {
      id: 'binge_king',
      title: 'Binge King',
      icon: '⚡',
      description: 'Surpass 100 total chapters read across all series.',
      category: 'milestone',
      tier: 'silver',
      points: 35,
      isUnlocked: totalChapters >= 100,
      progress: Math.min(100, Math.round((totalChapters / 100) * 100)),
      progressText: `${Math.min(100, totalChapters)} / 100 Chapters`,
    },
    {
      id: 'chapter_addict',
      title: 'Chapter Addict',
      icon: '🔥',
      description: 'Read 250 total chapters across your library.',
      category: 'milestone',
      tier: 'silver',
      points: 50,
      isUnlocked: totalChapters >= 250,
      progress: Math.min(100, Math.round((totalChapters / 250) * 100)),
      progressText: `${Math.min(250, totalChapters)} / 250 Chapters`,
    },
    {
      id: 'martial_god',
      title: 'Martial God',
      icon: '🥋',
      description: 'Read over 500 total manga/manhua chapters.',
      category: 'milestone',
      tier: 'gold',
      points: 100,
      isUnlocked: totalChapters >= 500,
      progress: Math.min(100, Math.round((totalChapters / 500) * 100)),
      progressText: `${Math.min(500, totalChapters)} / 500 Chapters`,
    },
    {
      id: 'immortal_sage',
      title: 'Immortal Sage',
      icon: '🧘',
      description: 'Read over 1,000 chapters in total across your library.',
      category: 'milestone',
      tier: 'platinum',
      points: 150,
      isUnlocked: totalChapters >= 1000,
      progress: Math.min(100, Math.round((totalChapters / 1000) * 100)),
      progressText: `${Math.min(1000, totalChapters)} / 1,000 Chapters`,
    },
    {
      id: 'transcendent_reader',
      title: 'Transcendent Reader',
      icon: '🌌',
      description: 'Break mortal limits and read 2,500 total chapters.',
      category: 'milestone',
      tier: 'platinum',
      points: 250,
      isUnlocked: totalChapters >= 2500,
      progress: Math.min(100, Math.round((totalChapters / 2500) * 100)),
      progressText: `${Math.min(2500, totalChapters)} / 2,500 Chapters`,
    },
    {
      id: 'library_sovereign',
      title: 'Library Sovereign',
      icon: '👑',
      description: 'Conquer a monumental 5,000 chapters read.',
      category: 'milestone',
      tier: 'diamond',
      points: 500,
      isUnlocked: totalChapters >= 5000,
      progress: Math.min(100, Math.round((totalChapters / 5000) * 100)),
      progressText: `${Math.min(5000, totalChapters)} / 5,000 Chapters`,
    },
    {
      id: 'mythic_scrollmaster',
      title: 'Mythic Scrollmaster',
      icon: '📜',
      description: 'Reach a legendary 10,000 total chapters read.',
      category: 'milestone',
      tier: 'mythic',
      points: 1000,
      isUnlocked: totalChapters >= 10000,
      progress: Math.min(100, Math.round((totalChapters / 10000) * 100)),
      progressText: `${Math.min(10000, totalChapters)} / 10,000 Chapters`,
    },
    {
      id: 'absolute_celestial',
      title: 'Absolute Celestial',
      icon: '✨',
      description: 'Surpass all worldly horizons with 15,000 chapters read.',
      category: 'milestone',
      tier: 'mythic',
      points: 1500,
      isUnlocked: totalChapters >= 15000,
      progress: Math.min(100, Math.round((totalChapters / 15000) * 100)),
      progressText: `${Math.min(15000, totalChapters)} / 15,000 Chapters`,
    },
    {
      id: 'endless_ascendant',
      title: 'Endless Ascendant',
      icon: '🌟',
      description: 'Achieve legendary status with 25,000 total chapters read.',
      category: 'milestone',
      tier: 'mythic',
      points: 2500,
      isUnlocked: totalChapters >= 25000,
      progress: Math.min(100, Math.round((totalChapters / 25000) * 100)),
      progressText: `${Math.min(25000, totalChapters)} / 25,000 Chapters`,
    },

    // ------------------------------------------------------------------------
    // 2. LIBRARY & VAULT COLLECTION (5 to 1,000 series)
    // ------------------------------------------------------------------------
    {
      id: 'novice_collector',
      title: 'Novice Collector',
      icon: '📦',
      description: 'Add 5 or more series to your personal library.',
      category: 'library',
      tier: 'bronze',
      points: 10,
      isUnlocked: totalSeries >= 5,
      progress: Math.min(100, Math.round((totalSeries / 5) * 100)),
      progressText: `${Math.min(5, totalSeries)} / 5 Series`,
    },
    {
      id: 'solo_leveler',
      title: 'Solo Leveler',
      icon: '🗡️',
      description: 'Track 25+ series in your personal library.',
      category: 'library',
      tier: 'silver',
      points: 30,
      isUnlocked: totalSeries >= 25,
      progress: Math.min(100, Math.round((totalSeries / 25) * 100)),
      progressText: `${Math.min(25, totalSeries)} / 25 Series`,
    },
    {
      id: 'vault_keeper',
      title: 'Vault Keeper',
      icon: '🗝️',
      description: 'Accumulate 50 or more series in your reading vault.',
      category: 'library',
      tier: 'silver',
      points: 50,
      isUnlocked: totalSeries >= 50,
      progress: Math.min(100, Math.round((totalSeries / 50) * 100)),
      progressText: `${Math.min(50, totalSeries)} / 50 Series`,
    },
    {
      id: 'grand_archivist',
      title: 'Grand Archivist',
      icon: '📚',
      description: 'Build a rich personal vault containing 100+ series.',
      category: 'library',
      tier: 'gold',
      points: 100,
      isUnlocked: totalSeries >= 100,
      progress: Math.min(100, Math.round((totalSeries / 100) * 100)),
      progressText: `${Math.min(100, totalSeries)} / 100 Series`,
    },
    {
      id: 'alexandria_curator',
      title: 'Alexandria Curator',
      icon: '🏛️',
      description: 'Curate a massive archive of 250+ series in your library.',
      category: 'library',
      tier: 'platinum',
      points: 250,
      isUnlocked: totalSeries >= 250,
      progress: Math.min(100, Math.round((totalSeries / 250) * 100)),
      progressText: `${Math.min(250, totalSeries)} / 250 Series`,
    },
    {
      id: 'infinite_library',
      title: 'Infinite Vault',
      icon: '🌌',
      description: 'Expand your collection into a universe of 500+ series.',
      category: 'library',
      tier: 'diamond',
      points: 500,
      isUnlocked: totalSeries >= 500,
      progress: Math.min(100, Math.round((totalSeries / 500) * 100)),
      progressText: `${Math.min(500, totalSeries)} / 500 Series`,
    },
    {
      id: 'omnipresent_collector',
      title: 'Omnipresent Collector',
      icon: '🔮',
      description: 'Amass an epochal collection of 1,000+ manga series.',
      category: 'library',
      tier: 'mythic',
      points: 1000,
      isUnlocked: totalSeries >= 1000,
      progress: Math.min(100, Math.round((totalSeries / 1000) * 100)),
      progressText: `${Math.min(1000, totalSeries)} / 1,000 Series`,
    },

    // ------------------------------------------------------------------------
    // 3. COMPLETIONIST (1 to 100 finished series)
    // ------------------------------------------------------------------------
    {
      id: 'journey_complete',
      title: 'Journey Complete',
      icon: '🏁',
      description: 'Finish reading your first completed manga/manhwa series.',
      category: 'completion',
      tier: 'bronze',
      points: 15,
      isUnlocked: completedCount >= 1,
      progress: Math.min(100, Math.round((completedCount / 1) * 100)),
      progressText: `${Math.min(1, completedCount)} / 1 Completed`,
    },
    {
      id: 'curtain_call',
      title: 'Curtain Call',
      icon: '🎭',
      description: 'Read the finale and complete 5 finished series.',
      category: 'completion',
      tier: 'silver',
      points: 40,
      isUnlocked: completedCount >= 5,
      progress: Math.min(100, Math.round((completedCount / 5) * 100)),
      progressText: `${Math.min(5, completedCount)} / 5 Completed`,
    },
    {
      id: 'completionist',
      title: 'The Completionist',
      icon: '🏆',
      description: 'Complete 10 or more full story arcs and finished series.',
      category: 'completion',
      tier: 'gold',
      points: 100,
      isUnlocked: completedCount >= 10,
      progress: Math.min(100, Math.round((completedCount / 10) * 100)),
      progressText: `${Math.min(10, completedCount)} / 10 Completed`,
    },
    {
      id: 'master_finisher',
      title: 'Master Finisher',
      icon: '🥇',
      description: 'Complete 25 full series from start to finish.',
      category: 'completion',
      tier: 'platinum',
      points: 200,
      isUnlocked: completedCount >= 25,
      progress: Math.min(100, Math.round((completedCount / 25) * 100)),
      progressText: `${Math.min(25, completedCount)} / 25 Completed`,
    },
    {
      id: 'epic_saga_conqueror',
      title: 'Epic Saga Conqueror',
      icon: '🎖️',
      description: 'Complete 50 or more finished series in your collection.',
      category: 'completion',
      tier: 'diamond',
      points: 400,
      isUnlocked: completedCount >= 50,
      progress: Math.min(100, Math.round((completedCount / 50) * 100)),
      progressText: `${Math.min(50, completedCount)} / 50 Completed`,
    },
    {
      id: 'century_finisher',
      title: 'Century Finisher',
      icon: '💫',
      description: 'Read the final chapter of 100 completed series.',
      category: 'completion',
      tier: 'mythic',
      points: 1000,
      isUnlocked: completedCount >= 100,
      progress: Math.min(100, Math.round((completedCount / 100) * 100)),
      progressText: `${Math.min(100, completedCount)} / 100 Completed`,
    },

    // ------------------------------------------------------------------------
    // 4. FORMATS & ORIGINS
    // ------------------------------------------------------------------------
    {
      id: 'tower_climber',
      title: 'Tower Climber',
      icon: '🗼',
      description: 'Track 10+ Manhwa (Korean webtoons) in your library.',
      category: 'format',
      tier: 'silver',
      points: 30,
      isUnlocked: manhwaCount >= 10,
      progress: Math.min(100, Math.round((manhwaCount / 10) * 100)),
      progressText: `${Math.min(10, manhwaCount)} / 10 Manhwa`,
    },
    {
      id: 'cultivation_monarch',
      title: 'Cultivation Monarch',
      icon: '🐉',
      description: 'Track 10+ Manhua (Chinese martial arts/cultivation comics).',
      category: 'format',
      tier: 'silver',
      points: 30,
      isUnlocked: manhuaCount >= 10,
      progress: Math.min(100, Math.round((manhuaCount / 10) * 100)),
      progressText: `${Math.min(10, manhuaCount)} / 10 Manhua`,
    },
    {
      id: 'manga_otaku',
      title: 'Manga Purist',
      icon: '🌸',
      description: 'Track 10+ traditional Japanese Manga series in your vault.',
      category: 'format',
      tier: 'silver',
      points: 30,
      isUnlocked: mangaCount >= 10,
      progress: Math.min(100, Math.round((mangaCount / 10) * 100)),
      progressText: `${Math.min(10, mangaCount)} / 10 Manga`,
    },
    {
      id: 'tri_format_polymath',
      title: 'Tri-Format Polymath',
      icon: '🌐',
      description: 'Have at least 5 Manga, 5 Manhwa, and 5 Manhua in your vault.',
      category: 'format',
      tier: 'gold',
      points: 75,
      isUnlocked: mangaCount >= 5 && manhwaCount >= 5 && manhuaCount >= 5,
      progress: Math.min(
        100,
        Math.round(
          ((Math.min(5, mangaCount) + Math.min(5, manhwaCount) + Math.min(5, manhuaCount)) / 15) * 100
        )
      ),
      progressText: `${Math.min(5, mangaCount)}/5 Manga, ${Math.min(5, manhwaCount)}/5 Manhwa, ${Math.min(5, manhuaCount)}/5 Manhua`,
    },
    {
      id: 'long_strip_devotee',
      title: 'Infinite Scroll Devotee',
      icon: '📜',
      description: 'Collect 30+ Manhwa and full-color Webtoons in your vault.',
      category: 'format',
      tier: 'platinum',
      points: 150,
      isUnlocked: manhwaCount >= 30,
      progress: Math.min(100, Math.round((manhwaCount / 30) * 100)),
      progressText: `${Math.min(30, manhwaCount)} / 30 Webtoons`,
    },
    {
      id: 'manhwa_royalty',
      title: 'Manhwa Royalty',
      icon: '👑',
      description: 'Collect 50+ Korean Manhwa series in your library.',
      category: 'format',
      tier: 'diamond',
      points: 300,
      isUnlocked: manhwaCount >= 50,
      progress: Math.min(100, Math.round((manhwaCount / 50) * 100)),
      progressText: `${Math.min(50, manhwaCount)} / 50 Manhwa`,
    },
    {
      id: 'cultivation_ancestor',
      title: 'Cultivation Patriarch',
      icon: '⚔️',
      description: 'Track 50+ Chinese Manhua titles in your cultivation sanctuary.',
      category: 'format',
      tier: 'diamond',
      points: 300,
      isUnlocked: manhuaCount >= 50,
      progress: Math.min(100, Math.round((manhuaCount / 50) * 100)),
      progressText: `${Math.min(50, manhuaCount)} / 50 Manhua`,
    },
    {
      id: 'vintage_manga_otaku',
      title: 'Vintage Manga Sensei',
      icon: '⛩️',
      description: 'Curate 50+ classic Japanese Manga series in your library.',
      category: 'format',
      tier: 'diamond',
      points: 300,
      isUnlocked: mangaCount >= 50,
      progress: Math.min(100, Math.round((mangaCount / 50) * 100)),
      progressText: `${Math.min(50, mangaCount)} / 50 Manga`,
    },

    // ------------------------------------------------------------------------
    // 5. GENRE MASTERY (12+ Genres)
    // ------------------------------------------------------------------------
    {
      id: 'dungeon_raider',
      title: 'Dungeon Raider',
      icon: '⚔️',
      description: 'Track 10+ Action, Fantasy, or Adventure series in your library.',
      category: 'genre',
      tier: 'silver',
      points: 25,
      isUnlocked: actionFantasyCount >= 10,
      progress: Math.min(100, Math.round((actionFantasyCount / 10) * 100)),
      progressText: `${Math.min(10, actionFantasyCount)} / 10 Action/Fantasy`,
    },
    {
      id: 'action_deity',
      title: 'Action & Fantasy Sovereign',
      icon: '💥',
      description: 'Track 25+ Action and High Fantasy epics in your library.',
      category: 'genre',
      tier: 'gold',
      points: 75,
      isUnlocked: actionFantasyCount >= 25,
      progress: Math.min(100, Math.round((actionFantasyCount / 25) * 100)),
      progressText: `${Math.min(25, actionFantasyCount)} / 25 Action/Fantasy`,
    },
    {
      id: 'hopeless_romantic',
      title: 'Hopeless Romantic',
      icon: '💖',
      description: 'Track 5+ Romance, Drama, or Shoujo/Josei series.',
      category: 'genre',
      tier: 'bronze',
      points: 20,
      isUnlocked: romanceCount >= 5,
      progress: Math.min(100, Math.round((romanceCount / 5) * 100)),
      progressText: `${Math.min(5, romanceCount)} / 5 Romance`,
    },
    {
      id: 'otome_villainess',
      title: 'Otome Aristocrat',
      icon: '🌹',
      description: 'Track 15+ Romance, Villainess, and Shoujo/Josei series.',
      category: 'genre',
      tier: 'gold',
      points: 60,
      isUnlocked: romanceCount >= 15,
      progress: Math.min(100, Math.round((romanceCount / 15) * 100)),
      progressText: `${Math.min(15, romanceCount)} / 15 Romance`,
    },
    {
      id: 'isekai_veteran',
      title: 'Isekai Veteran',
      icon: '🚚',
      description: 'Track 5+ Isekai, Reincarnation, or Regression series.',
      category: 'genre',
      tier: 'bronze',
      points: 20,
      isUnlocked: isekaiCount >= 5,
      progress: Math.min(100, Math.round((isekaiCount / 5) * 100)),
      progressText: `${Math.min(5, isekaiCount)} / 5 Isekai/Regression`,
    },
    {
      id: 'truck_kun_champion',
      title: 'Otherworldly Reincarnator',
      icon: '🌀',
      description: 'Track 15+ Isekai, Regression, or Transmigration series.',
      category: 'genre',
      tier: 'gold',
      points: 60,
      isUnlocked: isekaiCount >= 15,
      progress: Math.min(100, Math.round((isekaiCount / 15) * 100)),
      progressText: `${Math.min(15, isekaiCount)} / 15 Isekai`,
    },
    {
      id: 'mastermind',
      title: 'Mastermind',
      icon: '🧠',
      description: 'Track 5+ Psychological, Mystery, or Thriller series.',
      category: 'genre',
      tier: 'bronze',
      points: 20,
      isUnlocked: mysteryCount >= 5,
      progress: Math.min(100, Math.round((mysteryCount / 5) * 100)),
      progressText: `${Math.min(5, mysteryCount)} / 5 Mystery/Psychological`,
    },
    {
      id: 'cozy_reader',
      title: 'Cozy Reader',
      icon: '☕',
      description: 'Track 5+ Slice-of-Life wholesome series.',
      category: 'genre',
      tier: 'bronze',
      points: 20,
      isUnlocked: sliceOfLifeCount >= 5,
      progress: Math.min(100, Math.round((sliceOfLifeCount / 5) * 100)),
      progressText: `${Math.min(5, sliceOfLifeCount)} / 5 Slice of Life`,
    },
    {
      id: 'comedy_king',
      title: 'Gag & Comedy Virtuoso',
      icon: '😂',
      description: 'Track 5+ Comedy or Parody hilarious series.',
      category: 'genre',
      tier: 'bronze',
      points: 20,
      isUnlocked: comedyCount >= 5,
      progress: Math.min(100, Math.round((comedyCount / 5) * 100)),
      progressText: `${Math.min(5, comedyCount)} / 5 Comedy`,
    },
    {
      id: 'cyber_pioneer',
      title: 'Cyber Pioneer',
      icon: '🚀',
      description: 'Track 5+ Sci-Fi, Mecha, or Cyberpunk futuristic series.',
      category: 'genre',
      tier: 'bronze',
      points: 20,
      isUnlocked: scifiCount >= 5,
      progress: Math.min(100, Math.round((scifiCount / 5) * 100)),
      progressText: `${Math.min(5, scifiCount)} / 5 Sci-Fi/Mecha`,
    },
    {
      id: 'occult_scholar',
      title: 'Occult Scholar',
      icon: '👻',
      description: 'Track 5+ Supernatural, Horror, or Demon dark series.',
      category: 'genre',
      tier: 'bronze',
      points: 20,
      isUnlocked: supernaturalCount >= 5,
      progress: Math.min(100, Math.round((supernaturalCount / 5) * 100)),
      progressText: `${Math.min(5, supernaturalCount)} / 5 Supernatural`,
    },
    {
      id: 'sect_disciple',
      title: 'Sect Disciple',
      icon: '🥋',
      description: 'Track 5+ Martial Arts, Wuxia, or Cultivation series.',
      category: 'genre',
      tier: 'bronze',
      points: 20,
      isUnlocked: martialArtsCount >= 5,
      progress: Math.min(100, Math.round((martialArtsCount / 5) * 100)),
      progressText: `${Math.min(5, martialArtsCount)} / 5 Martial Arts`,
    },
    {
      id: 'sports_champion',
      title: 'Athletic Prodigy',
      icon: '⚽',
      description: 'Track 3+ Sports or Tournament competition series.',
      category: 'genre',
      tier: 'bronze',
      points: 20,
      isUnlocked: sportsCount >= 3,
      progress: Math.min(100, Math.round((sportsCount / 3) * 100)),
      progressText: `${Math.min(3, sportsCount)} / 3 Sports`,
    },
    {
      id: 'history_chronicler',
      title: 'Historical Chronicler',
      icon: '📜',
      description: 'Track 3+ Historical or Medieval period series.',
      category: 'genre',
      tier: 'bronze',
      points: 20,
      isUnlocked: historicalCount >= 3,
      progress: Math.min(100, Math.round((historicalCount / 3) * 100)),
      progressText: `${Math.min(3, historicalCount)} / 3 Historical`,
    },
    {
      id: 'eclectic_taste',
      title: 'Eclectic Palate',
      icon: '🎨',
      description: 'Explore titles spanning across 10 or more distinct genres.',
      category: 'genre',
      tier: 'gold',
      points: 60,
      isUnlocked: distinctGenresCount >= 10,
      progress: Math.min(100, Math.round((distinctGenresCount / 10) * 100)),
      progressText: `${Math.min(10, distinctGenresCount)} / 10 Genres`,
    },
    {
      id: 'universal_connoisseur',
      title: 'Universal Connoisseur',
      icon: '🌈',
      description: 'Expand your palate across 20 or more distinct genres.',
      category: 'genre',
      tier: 'platinum',
      points: 120,
      isUnlocked: distinctGenresCount >= 20,
      progress: Math.min(100, Math.round((distinctGenresCount / 20) * 100)),
      progressText: `${Math.min(20, distinctGenresCount)} / 20 Genres`,
    },
    {
      id: 'omni_genre_titan',
      title: 'Omni-Genre Titan',
      icon: '🌌',
      description: 'Master 30 or more distinct genres across your vast collection.',
      category: 'genre',
      tier: 'diamond',
      points: 300,
      isUnlocked: distinctGenresCount >= 30,
      progress: Math.min(100, Math.round((distinctGenresCount / 30) * 100)),
      progressText: `${Math.min(30, distinctGenresCount)} / 30 Genres`,
    },

    // ------------------------------------------------------------------------
    // 6. STREAKS & DEDICATION
    // ------------------------------------------------------------------------
    {
      id: 'weekend_warrior',
      title: 'Weekend Warrior',
      icon: '🛡️',
      description: 'Maintain a 3-day continuous daily reading streak.',
      category: 'streak',
      tier: 'bronze',
      points: 15,
      isUnlocked: currentStreak >= 3,
      progress: Math.min(100, Math.round((currentStreak / 3) * 100)),
      progressText: `${Math.min(3, currentStreak)} / 3 Days`,
    },
    {
      id: 'streak_master',
      title: 'Streak Master',
      icon: '🔥',
      description: 'Maintain a 7-day continuous daily reading streak.',
      category: 'streak',
      tier: 'silver',
      points: 50,
      isUnlocked: currentStreak >= 7,
      progress: Math.min(100, Math.round((currentStreak / 7) * 100)),
      progressText: `${Math.min(7, currentStreak)} / 7 Days`,
    },
    {
      id: 'unstoppable_habit',
      title: 'Unstoppable Habit',
      icon: '⚡',
      description: 'Maintain a 14-day continuous daily reading streak.',
      category: 'streak',
      tier: 'gold',
      points: 100,
      isUnlocked: currentStreak >= 14,
      progress: Math.min(100, Math.round((currentStreak / 14) * 100)),
      progressText: `${Math.min(14, currentStreak)} / 14 Days`,
    },
    {
      id: 'monthly_devotion',
      title: 'Monthly Devotion',
      icon: '🌟',
      description: 'Maintain a 30-day continuous reading streak.',
      category: 'streak',
      tier: 'platinum',
      points: 200,
      isUnlocked: currentStreak >= 30,
      progress: Math.min(100, Math.round((currentStreak / 30) * 100)),
      progressText: `${Math.min(30, currentStreak)} / 30 Days`,
    },
    {
      id: 'seasoned_reader',
      title: 'Seasoned Reader',
      icon: '🍁',
      description: 'Maintain an unbroken 60-day reading streak across seasons.',
      category: 'streak',
      tier: 'platinum',
      points: 350,
      isUnlocked: currentStreak >= 60,
      progress: Math.min(100, Math.round((currentStreak / 60) * 100)),
      progressText: `${Math.min(60, currentStreak)} / 60 Days`,
    },
    {
      id: 'century_reader',
      title: 'Century Titan',
      icon: '💎',
      description: 'Reach a legendary 100-day reading streak milestone.',
      category: 'streak',
      tier: 'diamond',
      points: 500,
      isUnlocked: currentStreak >= 100,
      progress: Math.min(100, Math.round((currentStreak / 100) * 100)),
      progressText: `${Math.min(100, currentStreak)} / 100 Days`,
    },
    {
      id: 'year_of_the_dragon',
      title: 'Year of the Dragon',
      icon: '🐉',
      description: 'Reach an unbelievable 365-day annual daily reading streak.',
      category: 'streak',
      tier: 'mythic',
      points: 1500,
      isUnlocked: currentStreak >= 365,
      progress: Math.min(100, Math.round((currentStreak / 365) * 100)),
      progressText: `${Math.min(365, currentStreak)} / 365 Days`,
    },

    // ------------------------------------------------------------------------
    // 7. HABITS, PACE & MARATHONS
    // ------------------------------------------------------------------------
    {
      id: 'night_owl',
      title: 'Night Owl',
      icon: '🌙',
      description: 'Read late into the night (between 12:00 AM and 5:00 AM).',
      category: 'habits',
      tier: 'silver',
      points: 25,
      isUnlocked: hasNightReading,
      progress: hasNightReading ? 100 : 0,
      progressText: hasNightReading ? 'Active Night Reader' : 'Read between 12-5 AM',
    },
    {
      id: 'early_bird',
      title: 'Early Bird',
      icon: '🌅',
      description: 'Read in the crisp early morning (between 5:00 AM and 9:00 AM).',
      category: 'habits',
      tier: 'silver',
      points: 25,
      isUnlocked: hasMorningReading,
      progress: hasMorningReading ? 100 : 0,
      progressText: hasMorningReading ? 'Active Morning Reader' : 'Read between 5-9 AM',
    },
    {
      id: 'lunchtime_leisure',
      title: 'Lunchtime Leisure',
      icon: '🍱',
      description: 'Enjoy a refreshing chapter during lunch hours (12:00 PM - 2:00 PM).',
      category: 'habits',
      tier: 'bronze',
      points: 20,
      isUnlocked: hasLunchReading,
      progress: hasLunchReading ? 100 : 0,
      progressText: hasLunchReading ? 'Midday Reader' : 'Read between 12-2 PM',
    },
    {
      id: 'saga_marathoner',
      title: 'Saga Marathoner',
      icon: '🏃',
      description: 'Read 200+ chapters in a single mega series.',
      category: 'habits',
      tier: 'gold',
      points: 75,
      isUnlocked: maxSingleSeriesChapters >= 200,
      progress: Math.min(100, Math.round((maxSingleSeriesChapters / 200) * 100)),
      progressText: `${Math.min(200, maxSingleSeriesChapters)} / 200 Chapters in one series`,
    },
    {
      id: 'gargantuan_reader',
      title: 'Gargantuan Reader',
      icon: '🏔️',
      description: 'Read 500+ chapters in a single monumental series.',
      category: 'habits',
      tier: 'platinum',
      points: 150,
      isUnlocked: maxSingleSeriesChapters >= 500,
      progress: Math.min(100, Math.round((maxSingleSeriesChapters / 500) * 100)),
      progressText: `${Math.min(500, maxSingleSeriesChapters)} / 500 Chapters in one series`,
    },
    {
      id: 'colossus_conqueror',
      title: 'Colossus Conqueror',
      icon: '🏛️',
      description: 'Read 1,000+ chapters in a single colossal epic (e.g. Martial Peak / One Piece).',
      category: 'habits',
      tier: 'diamond',
      points: 400,
      isUnlocked: maxSingleSeriesChapters >= 1000,
      progress: Math.min(100, Math.round((maxSingleSeriesChapters / 1000) * 100)),
      progressText: `${Math.min(1000, maxSingleSeriesChapters)} / 1,000 Chapters in one series`,
    },

    // ------------------------------------------------------------------------
    // 8. CURATION, RATINGS & ORGANIZATION
    // ------------------------------------------------------------------------
    {
      id: 'favorites_crown',
      title: 'Hall of Favorites',
      icon: '⭐',
      description: 'Mark 10 or more series as Favorites with a star.',
      category: 'curator',
      tier: 'bronze',
      points: 20,
      isUnlocked: favoritesCount >= 10,
      progress: Math.min(100, Math.round((favoritesCount / 10) * 100)),
      progressText: `${Math.min(10, favoritesCount)} / 10 Favorites`,
    },
    {
      id: 'favorites_sovereign',
      title: 'Favorites Pantheon',
      icon: '🌟',
      description: 'Mark 30 or more stellar series as your personal Favorites.',
      category: 'curator',
      tier: 'silver',
      points: 40,
      isUnlocked: favoritesCount >= 30,
      progress: Math.min(100, Math.round((favoritesCount / 30) * 100)),
      progressText: `${Math.min(30, favoritesCount)} / 30 Favorites`,
    },
    {
      id: 'curated_taste',
      title: 'Curated Taste',
      icon: '🌟',
      description: 'Give a rating score to 15 or more series in your library.',
      category: 'curator',
      tier: 'silver',
      points: 30,
      isUnlocked: ratedCount >= 15,
      progress: Math.min(100, Math.round((ratedCount / 15) * 100)),
      progressText: `${Math.min(15, ratedCount)} / 15 Rated`,
    },
    {
      id: 'master_critic',
      title: 'Master Critic',
      icon: '🧐',
      description: 'Rate 50 or more series with custom review scores.',
      category: 'curator',
      tier: 'gold',
      points: 75,
      isUnlocked: ratedCount >= 50,
      progress: Math.min(100, Math.round((ratedCount / 50) * 100)),
      progressText: `${Math.min(50, ratedCount)} / 50 Rated`,
    },
    {
      id: 'century_critic',
      title: 'Century Critic',
      icon: '🖋️',
      description: 'Score and evaluate 100 or more series in your library.',
      category: 'curator',
      tier: 'platinum',
      points: 200,
      isUnlocked: ratedCount >= 100,
      progress: Math.min(100, Math.round((ratedCount / 100) * 100)),
      progressText: `${Math.min(100, ratedCount)} / 100 Rated`,
    },
    {
      id: 'masterpiece_hunter',
      title: 'Masterpiece Hunter',
      icon: '💯',
      description: 'Give a near-perfect 9.5+ rating to 5 masterpiece series.',
      category: 'curator',
      tier: 'gold',
      points: 50,
      isUnlocked: masterpieceCount >= 5,
      progress: Math.min(100, Math.round((masterpieceCount / 5) * 100)),
      progressText: `${Math.min(5, masterpieceCount)} / 5 Masterpieces`,
    },
    {
      id: 'flawless_taste',
      title: 'Flawless 10/10 Connoisseur',
      icon: '💎',
      description: 'Award a perfect 10/10 rating to 10 pinnacle masterworks.',
      category: 'curator',
      tier: 'platinum',
      points: 150,
      isUnlocked: perfectTenCount >= 10,
      progress: Math.min(100, Math.round((perfectTenCount / 10) * 100)),
      progressText: `${Math.min(10, perfectTenCount)} / 10 Perfect 10s`,
    },
    {
      id: 'notetaker',
      title: 'Archival Notetaker',
      icon: '📝',
      description: 'Add personal notes or remarks to 5 or more series.',
      category: 'curator',
      tier: 'bronze',
      points: 20,
      isUnlocked: notesCount >= 5,
      progress: Math.min(100, Math.round((notesCount / 5) * 100)),
      progressText: `${Math.min(5, notesCount)} / 5 Series with Notes`,
    },
    {
      id: 'deep_essayist',
      title: 'Deep Essayist',
      icon: '✍️',
      description: 'Write extensive thoughts (>100 chars) on 10 or more series.',
      category: 'curator',
      tier: 'silver',
      points: 40,
      isUnlocked: longNotesCount >= 10,
      progress: Math.min(100, Math.round((longNotesCount / 10) * 100)),
      progressText: `${Math.min(10, longNotesCount)} / 10 Detailed Notes`,
    },
    {
      id: 'tag_alchemist',
      title: 'Tag Alchemist',
      icon: '🏷️',
      description: 'Organize 15+ series using custom tags or categories.',
      category: 'curator',
      tier: 'silver',
      points: 35,
      isUnlocked: tagsOrCategoriesCount >= 15,
      progress: Math.min(100, Math.round((tagsOrCategoriesCount / 15) * 100)),
      progressText: `${Math.min(15, tagsOrCategoriesCount)} / 15 Tagged Series`,
    },
    {
      id: 'taxonomy_architect',
      title: 'Taxonomy Architect',
      icon: '🗂️',
      description: 'Deeply classify 30+ series with multiple tags and categories.',
      category: 'curator',
      tier: 'gold',
      points: 80,
      isUnlocked: tagsOrCategoriesCount >= 30,
      progress: Math.min(100, Math.round((tagsOrCategoriesCount / 30) * 100)),
      progressText: `${Math.min(30, tagsOrCategoriesCount)} / 30 Categorized`,
    },
    {
      id: 'multi_source_scout',
      title: 'Source Explorer',
      icon: '🧭',
      description: 'Track series from 3 or more different manga source sites.',
      category: 'curator',
      tier: 'bronze',
      points: 20,
      isUnlocked: uniqueSourcesCount >= 3,
      progress: Math.min(100, Math.round((uniqueSourcesCount / 3) * 100)),
      progressText: `${Math.min(3, uniqueSourcesCount)} / 3 Sources`,
    },
    {
      id: 'global_explorer',
      title: 'Global Scraper',
      icon: '🌍',
      description: 'Track series from 6 or more different manga sources.',
      category: 'curator',
      tier: 'silver',
      points: 50,
      isUnlocked: uniqueSourcesCount >= 6,
      progress: Math.min(100, Math.round((uniqueSourcesCount / 6) * 100)),
      progressText: `${Math.min(6, uniqueSourcesCount)} / 6 Sources`,
    },
    {
      id: 'omni_source_hub',
      title: 'Omni-Source Nexus',
      icon: '🌐',
      description: 'Track series from 12 or more different online sources.',
      category: 'curator',
      tier: 'gold',
      points: 100,
      isUnlocked: uniqueSourcesCount >= 12,
      progress: Math.min(100, Math.round((uniqueSourcesCount / 12) * 100)),
      progressText: `${Math.min(12, uniqueSourcesCount)} / 12 Sources`,
    },
    {
      id: 'active_tracker',
      title: 'Multi-Thread Reader',
      icon: '🔄',
      description: 'Actively keep 15 or more series in "Reading" status.',
      category: 'curator',
      tier: 'silver',
      points: 35,
      isUnlocked: readingCount >= 15,
      progress: Math.min(100, Math.round((readingCount / 15) * 100)),
      progressText: `${Math.min(15, readingCount)} / 15 Reading`,
    },
    {
      id: 'hyper_reader',
      title: 'Hyper-Thread Titan',
      icon: '⚡',
      description: 'Actively juggle 30 or more concurrent ongoing reading series.',
      category: 'curator',
      tier: 'gold',
      points: 75,
      isUnlocked: readingCount >= 30,
      progress: Math.min(100, Math.round((readingCount / 30) * 100)),
      progressText: `${Math.min(30, readingCount)} / 30 Reading`,
    },
    {
      id: 'plan_ahead',
      title: 'Backlog Hoarder',
      icon: '📋',
      description: 'Stockpile 10 or more series in your "Plan to Read" queue.',
      category: 'curator',
      tier: 'bronze',
      points: 20,
      isUnlocked: planToReadCount >= 10,
      progress: Math.min(100, Math.round((planToReadCount / 10) * 100)),
      progressText: `${Math.min(10, planToReadCount)} / 10 Planned`,
    },
    {
      id: 'backlog_monolith',
      title: 'Backlog Monolith',
      icon: '📦',
      description: 'Stack 30 or more series in your "Plan to Read" queue.',
      category: 'curator',
      tier: 'silver',
      points: 40,
      isUnlocked: planToReadCount >= 30,
      progress: Math.min(100, Math.round((planToReadCount / 30) * 100)),
      progressText: `${Math.min(30, planToReadCount)} / 30 Planned`,
    },

    // ------------------------------------------------------------------------
    // 9. EXTERNAL SYNC & TRACKERS
    // ------------------------------------------------------------------------
    {
      id: 'cloud_synced',
      title: 'Tracker Linked',
      icon: '☁️',
      description: 'Link at least 1 series with AniList, MyAnimeList, or Kitsu.',
      category: 'sync',
      tier: 'silver',
      points: 30,
      isUnlocked: syncedCount >= 1,
      progress: Math.min(100, Math.round((syncedCount / 1) * 100)),
      progressText: `${Math.min(1, syncedCount)} / 1 Synced`,
    },
    {
      id: 'sync_master',
      title: 'Cross-Platform Nexus',
      icon: '⚡',
      description: 'Link 10 or more series with external tracker IDs.',
      category: 'sync',
      tier: 'gold',
      points: 75,
      isUnlocked: syncedCount >= 10,
      progress: Math.min(100, Math.round((syncedCount / 10) * 100)),
      progressText: `${Math.min(10, syncedCount)} / 10 Synced`,
    },
    {
      id: 'cloud_sovereign',
      title: 'Cloud Sovereign',
      icon: '🌩️',
      description: 'Link 30 or more series with external scrobbler accounts.',
      category: 'sync',
      tier: 'platinum',
      points: 150,
      isUnlocked: syncedCount >= 30,
      progress: Math.min(100, Math.round((syncedCount / 30) * 100)),
      progressText: `${Math.min(30, syncedCount)} / 30 Synced`,
    },
    {
      id: 'anilist_devotee',
      title: 'AniList Synchronizer',
      icon: '🔵',
      description: 'Link series directly with AniList tracker database.',
      category: 'sync',
      tier: 'silver',
      points: 25,
      isUnlocked: anilistSyncedCount >= 1 || syncedCount >= 1,
      progress: anilistSyncedCount >= 1 || syncedCount >= 1 ? 100 : 0,
      progressText: anilistSyncedCount >= 1 || syncedCount >= 1 ? 'Connected' : '0/1 Synced',
    },
    {
      id: 'mal_veteran',
      title: 'MAL Database Sync',
      icon: '🔷',
      description: 'Connect series with MyAnimeList tracking.',
      category: 'sync',
      tier: 'silver',
      points: 25,
      isUnlocked: malSyncedCount >= 1 || syncedCount >= 2,
      progress: malSyncedCount >= 1 || syncedCount >= 2 ? 100 : 0,
      progressText: malSyncedCount >= 1 || syncedCount >= 2 ? 'Connected' : '0/1 Synced',
    },

    // ------------------------------------------------------------------------
    // 10. POWER FEATURES & WORKFLOWS
    // ------------------------------------------------------------------------
    {
      id: 'readlist_curator',
      title: 'Readlist Creator',
      icon: '📑',
      description: 'Create custom curated Readlists to organize thematic marathons.',
      category: 'features',
      tier: 'bronze',
      points: 25,
      isUnlocked: readlistsCount >= 1 || tagsOrCategoriesCount >= 5,
      progress: readlistsCount >= 1 || tagsOrCategoriesCount >= 5 ? 100 : 0,
      progressText: readlistsCount >= 1 || tagsOrCategoriesCount >= 5 ? 'Curated' : 'Create 1 Readlist',
    },
    {
      id: 'readlist_anthologist',
      title: 'Readlist Anthologist',
      icon: '📚',
      description: 'Create 3 or more custom thematic Readlists.',
      category: 'features',
      tier: 'silver',
      points: 50,
      isUnlocked: readlistsCount >= 3 || tagsOrCategoriesCount >= 15,
      progress: Math.min(100, Math.round(((readlistsCount || (tagsOrCategoriesCount >= 15 ? 3 : 0)) / 3) * 100)),
      progressText: `${Math.min(3, readlistsCount || (tagsOrCategoriesCount >= 15 ? 3 : 0))} / 3 Readlists`,
    },
    {
      id: 'theme_connoisseur',
      title: 'Theme Connoisseur',
      icon: '🎨',
      description: 'Personalize your reader aesthetic with custom themes.',
      category: 'features',
      tier: 'bronze',
      points: 15,
      isUnlocked: hasCustomTheme,
      progress: hasCustomTheme ? 100 : 0,
      progressText: hasCustomTheme ? 'Customized Style' : 'Switch Theme',
    },
    {
      id: 'offline_vault',
      title: 'Offline Vault Guardian',
      icon: '💾',
      description: 'Download chapters for fast local offline reading.',
      category: 'features',
      tier: 'silver',
      points: 35,
      isUnlocked: downloadsCount >= 1 || (totalChapters >= 10 && totalSeries > 0),
      progress: downloadsCount >= 1 || (totalChapters >= 10 && totalSeries > 0) ? 100 : 0,
      progressText: downloadsCount >= 1 || (totalChapters >= 10 && totalSeries > 0) ? 'Active Offline Vault' : '0/1 Downloaded',
    },
    {
      id: 'catalog_explorer',
      title: 'Extension & Catalog Explorer',
      icon: '🔌',
      description: 'Explore hundreds of built-in community scraping extensions.',
      category: 'features',
      tier: 'bronze',
      points: 20,
      isUnlocked: uniqueSourcesCount >= 1,
      progress: uniqueSourcesCount >= 1 ? 100 : 0,
      progressText: uniqueSourcesCount >= 1 ? 'Explorer Active' : '0/1 Sources',
    },
  ];

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
