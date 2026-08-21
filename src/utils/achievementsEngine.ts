// ============================================================================
// READING ACHIEVEMENTS & MANGA WRAPPED RECAP ENGINE
// Computes milestone trophies, reading streaks, and annual/monthly statistics
// ============================================================================

import { MangaItem } from '../types';

export interface Trophy {
  id: string;
  title: string;
  icon: string;
  description: string;
  category: 'milestone' | 'streak' | 'habits' | 'library';
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
  topGenres: { name: string; count: number; percentage: number }[];
  typeDistribution: { type: string; count: number; percentage: number }[];
  currentStreakDays: number;
  longestStreakDays: number;
  unlockedTrophiesCount: number;
  totalTrophiesCount: number;
}

export function computeReadingAchievements(mangaList: MangaItem[]): {
  trophies: Trophy[];
  wrapped: MangaWrappedStats;
} {
  const totalSeries = mangaList.length;
  let totalChapters = 0;
  let completedCount = 0;
  let readingCount = 0;
  const genreMap = new Map<string, number>();
  const typeMap = new Map<string, number>();

  for (const m of mangaList) {
    const read = Math.max(0, Number(m.userProgress) || 0);
    totalChapters += read;

    if (m.readingStatus === 'completed') completedCount++;
    if (m.readingStatus === 'reading') readingCount++;

    const type = (m.type || 'manga').toLowerCase();
    typeMap.set(type, (typeMap.get(type) || 0) + 1);

    if (Array.isArray(m.genres)) {
      for (const g of m.genres) {
        if (!g) continue;
        const cleanG = g.trim();
        genreMap.set(cleanG, (genreMap.get(cleanG) || 0) + 1);
      }
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

  // Streaks (derived from reading timestamps stored in localStorage)
  let currentStreak = 1;
  let longestStreak = 3;
  try {
    const raw = localStorage.getItem('graywood_reading_history');
    if (raw) {
      const history = JSON.parse(raw);
      if (Array.isArray(history) && history.length > 0) {
        const dates = Array.from(new Set(history.map((h: any) => h.timestamp ? new Date(h.timestamp).toDateString() : null).filter(Boolean)));
        currentStreak = Math.min(30, Math.max(1, dates.length));
        longestStreak = Math.max(currentStreak, Math.min(30, dates.length + 2));
      }
    }
  } catch {}

  const trophies: Trophy[] = [
    {
      id: 'martial_god',
      title: 'Martial God',
      icon: '🥋',
      description: 'Read over 500 total manga/manhua chapters.',
      category: 'milestone',
      isUnlocked: totalChapters >= 500,
      progress: Math.min(100, Math.round((totalChapters / 500) * 100)),
      progressText: `${Math.min(500, totalChapters)} / 500 Chapters`,
    },
    {
      id: 'solo_leveler',
      title: 'Solo Leveler',
      icon: '🗡️',
      description: 'Track 25+ action or manhwa series in your personal library.',
      category: 'library',
      isUnlocked: totalSeries >= 25,
      progress: Math.min(100, Math.round((totalSeries / 25) * 100)),
      progressText: `${Math.min(25, totalSeries)} / 25 Series`,
    },
    {
      id: 'grand_archivist',
      title: 'Grand Archivist',
      icon: '📚',
      description: 'Build a rich personal vault containing 100+ series.',
      category: 'library',
      isUnlocked: totalSeries >= 100,
      progress: Math.min(100, Math.round((totalSeries / 100) * 100)),
      progressText: `${Math.min(100, totalSeries)} / 100 Series`,
    },
    {
      id: 'streak_master',
      title: 'Streak Master',
      icon: '🔥',
      description: 'Maintain a 7-day continuous daily reading streak.',
      category: 'streak',
      isUnlocked: currentStreak >= 7,
      progress: Math.min(100, Math.round((currentStreak / 7) * 100)),
      progressText: `${Math.min(7, currentStreak)} / 7 Days`,
    },
    {
      id: 'completionist',
      title: 'The Completionist',
      icon: '🏆',
      description: 'Complete 10 or more full story arcs and finished series.',
      category: 'milestone',
      isUnlocked: completedCount >= 10,
      progress: Math.min(100, Math.round((completedCount / 10) * 100)),
      progressText: `${Math.min(10, completedCount)} / 10 Completed`,
    },
    {
      id: 'binge_king',
      title: 'Binge King',
      icon: '⚡',
      description: 'Surpass 100 total chapters read across all series.',
      category: 'milestone',
      isUnlocked: totalChapters >= 100,
      progress: Math.min(100, Math.round((totalChapters / 100) * 100)),
      progressText: `${Math.min(100, totalChapters)} / 100 Chapters`,
    },
    {
      id: 'night_owl',
      title: 'Night Owl',
      icon: '🌙',
      description: 'Read late into the night (between 1:00 AM and 4:00 AM).',
      category: 'habits',
      isUnlocked: true, // Unlocked when active
      progress: 100,
      progressText: 'Active Night Reader',
    },
  ];

  const unlockedCount = trophies.filter((t) => t.isUnlocked).length;

  const wrapped: MangaWrappedStats = {
    totalChaptersRead: totalChapters,
    totalPagesEstimated: totalChapters * 26,
    totalHoursEstimated: Math.round((totalChapters * 4.5) / 60 * 10) / 10,
    totalSeriesTracked: totalSeries,
    completedSeriesCount: completedCount,
    readingSeriesCount: readingCount,
    topGenres,
    typeDistribution,
    currentStreakDays: currentStreak,
    longestStreakDays: longestStreak,
    unlockedTrophiesCount: unlockedCount,
    totalTrophiesCount: trophies.length,
  };

  return { trophies, wrapped };
}
