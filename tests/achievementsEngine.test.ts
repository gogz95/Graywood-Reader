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
      userProgress: 200,
      readingStatus: 'completed',
      isFavorite: true,
      genres: ['Action', 'Fantasy', 'Dungeon'],
      type: 'manhwa',
    },
    {
      id: 'm2',
      title: 'Martial Peak',
      sourceName: 'ManhuaPlus',
      sourceUrl: 'https://manhuaplus.org/manga/martial-peak',
      latestChapter: 3500,
      currentChapter: 350,
      userProgress: 350,
      readingStatus: 'reading',
      isFavorite: true,
      genres: ['Action', 'Martial Arts', 'Cultivation'],
      type: 'manhua',
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

  it('computes top genres and format distribution', () => {
    const { wrapped } = computeReadingAchievements(sampleList);

    expect(wrapped.topGenres.length).toBeGreaterThan(0);
    expect(wrapped.topGenres.some((g) => g.name === 'Action')).toBe(true);

    const manhwaType = wrapped.typeDistribution.find((t) => t.type.toLowerCase() === 'manhwa');
    expect(manhwaType).toBeDefined();
    expect(manhwaType?.count).toBe(1);
  });

  it('handles empty library without crashing', () => {
    const { trophies, wrapped } = computeReadingAchievements([]);
    expect(wrapped.totalChaptersRead).toBe(0);
    expect(wrapped.totalSeriesTracked).toBe(0);
    expect(wrapped.topGenres.length).toBe(0);
    expect(trophies.length).toBeGreaterThan(0);
  });
});
