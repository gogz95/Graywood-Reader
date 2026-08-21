import { describe, it, expect } from 'vitest';
import { computeReadingAchievements } from '../src/utils/achievementsEngine';
import { MangaItem } from '../src/types';

describe('Achievements Engine', () => {
  const sampleList: MangaItem[] = [
    {
      id: 'm1',
      title: 'Solo Leveling',
      sourceName: 'Asura Scans',
      sourceUrl: 'https://asurascans.com/comics/solo-leveling',
      latestChapter: 200,
      currentChapter: 200,
      status: 'completed',
      isFavorite: true,
      genres: ['Action', 'Fantasy', 'Dungeon'],
      type: 'manhwa',
      altTitles: [],
      coverImage: '',
      description: '',
      totalChapters: 200,
      lastUpdated: '',
      rating: 9.8,
      autoUpdateEnabled: true,
      notes: 'One of the best manhwa ever.',
      addedAt: '',
      lastReadAt: '2026-08-21T02:30:00.000Z', // 2:30 AM night owl
      customTags: ['S-Rank', 'Favorite'],
      categories: ['Read Again'],
      syncedFromApi: 'anilist',
    },
    {
      id: 'm2',
      title: 'Martial Peak',
      sourceName: 'ManhuaPlus',
      sourceUrl: 'https://manhuaplus.org/manga/martial-peak',
      latestChapter: 3500,
      currentChapter: 350,
      status: 'reading',
      isFavorite: true,
      genres: ['Action', 'Martial Arts', 'Cultivation'],
      type: 'manhua',
      altTitles: [],
      coverImage: '',
      description: '',
      totalChapters: null,
      lastUpdated: '',
      rating: 8.0,
      autoUpdateEnabled: true,
      notes: '',
      addedAt: '',
      lastReadAt: '',
    },
  ];

  it('calculates total chapters and unlocks Martial God milestone', () => {
    const { trophies, wrapped } = computeReadingAchievements(sampleList);

    expect(wrapped.totalChaptersRead).toBe(550);
    expect(wrapped.completedSeriesCount).toBe(1);
    expect(wrapped.readingSeriesCount).toBe(1);

    const martialGod = trophies.find((t) => t.id === 'martial_god');
    expect(martialGod).toBeDefined();
    expect(martialGod?.isUnlocked).toBe(true);
    expect(martialGod?.progress).toBe(100);
  });

  it('calculates achievements score, tiers, and point values', () => {
    const { trophies, wrapped } = computeReadingAchievements(sampleList);

    expect(trophies.length).toBeGreaterThanOrEqual(40);
    expect(wrapped.totalScore).toBeGreaterThan(0);
    expect(wrapped.maxScore).toBeGreaterThan(wrapped.totalScore);
    expect(wrapped.tierBreakdown.bronze.total).toBeGreaterThan(0);
    expect(wrapped.tierBreakdown.mythic.total).toBeGreaterThan(0);
  });

  it('computes top genres and format distribution', () => {
    const { wrapped } = computeReadingAchievements(sampleList);

    expect(wrapped.topGenres.length).toBeGreaterThan(0);
    expect(wrapped.topGenres.some((g) => g.name === 'Action')).toBe(true);

    const manhwaType = wrapped.typeDistribution.find((t) => t.type.toLowerCase() === 'manhwa');
    expect(manhwaType).toBeDefined();
    expect(manhwaType?.count).toBe(1);
  });

  it('correctly detects Night Owl habit from lastReadAt timestamp', () => {
    const { trophies } = computeReadingAchievements(sampleList);
    const nightOwl = trophies.find((t) => t.id === 'night_owl');
    expect(nightOwl).toBeDefined();
    expect(nightOwl?.isUnlocked).toBe(true);
  });

  it('detects single series saga marathoner', () => {
    const { trophies } = computeReadingAchievements(sampleList);
    const saga = trophies.find((t) => t.id === 'saga_marathoner');
    expect(saga).toBeDefined();
    expect(saga?.isUnlocked).toBe(true); // m2 has 350 chapters >= 200
  });

  it('handles empty library without crashing', () => {
    const { trophies, wrapped } = computeReadingAchievements([]);
    expect(wrapped.totalChaptersRead).toBe(0);
    expect(wrapped.totalSeriesTracked).toBe(0);
    expect(wrapped.topGenres.length).toBe(0);
    expect(wrapped.totalScore).toBe(0);
    expect(trophies.length).toBeGreaterThanOrEqual(40);
  });
});

