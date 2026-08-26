import { describe, it, expect } from 'vitest';
import { MangaItem, isNsfwManga } from '../src/types';

describe('Library Shelves & Fresh Releases NSFW Safe Filter', () => {
  const safeMangaWithNewChapters: MangaItem = {
    id: 'manga_1',
    title: 'Solo Leveling Safe Adventure',
    altTitles: ['Na Honjaman Level Up'],
    coverImage: 'https://example.com/solo.jpg',
    description: 'A hunter story with no mature content',
    status: 'reading',
    currentChapter: 10,
    totalChapters: null,
    latestChapter: 25, // Has 15 unread
    lastReadAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
    lastUpdated: new Date().toISOString(),
    addedAt: new Date().toISOString(),
    rating: 9.8,
    type: 'manhwa',
    genres: ['Action', 'Fantasy', 'Adventure'],
    sourceName: 'AsuraScans',
    sourceUrl: 'https://asurascans.com/solo',
    autoUpdateEnabled: true,
    notes: '',
    categories: [],
    isNsfw: false,
  };

  const adultMangaWithNewChapters: MangaItem = {
    id: 'manga_2',
    title: 'Secret Class [18+ NSFW Mature]',
    altTitles: ['Secret Class Adult'],
    coverImage: 'https://example.com/secret.jpg',
    description: 'Explicit adult romance story for 18+ readers.',
    status: 'reading',
    currentChapter: 50,
    totalChapters: null,
    latestChapter: 75, // Has 25 unread
    lastReadAt: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
    lastUpdated: new Date().toISOString(),
    addedAt: new Date().toISOString(),
    rating: 9.2,
    type: 'manhwa',
    genres: ['Romance', 'Drama', 'Adult', '18+', 'Smut'],
    sourceName: 'Manhwa18',
    sourceUrl: 'https://manhwa18.com/secret',
    autoUpdateEnabled: true,
    notes: '',
    categories: [],
    isNsfw: true,
  };

  const safeMangaInProgress: MangaItem = {
    id: 'manga_3',
    title: 'Omniscient Reader in Progress',
    altTitles: [],
    coverImage: 'https://example.com/orv.jpg',
    description: 'Reading in progress',
    status: 'reading',
    currentChapter: 150,
    totalChapters: 200,
    latestChapter: 150, // Up to date
    lastReadAt: new Date(Date.now() - 1000 * 60 * 10).toISOString(),
    lastUpdated: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
    addedAt: new Date().toISOString(),
    rating: 9.9,
    type: 'manhwa',
    genres: ['Action', 'Fantasy'],
    sourceName: 'FlameScans',
    sourceUrl: 'https://flamescans.org/orv',
    autoUpdateEnabled: true,
    notes: '',
    categories: [],
    isNsfw: false,
  };

  const adultMangaInProgress: MangaItem = {
    id: 'manga_4',
    title: 'Touch to Unlock (18+)',
    altTitles: [],
    coverImage: 'https://example.com/touch.jpg',
    description: 'Adult drama in progress',
    status: 'reading',
    currentChapter: 30,
    totalChapters: 50,
    latestChapter: 30,
    lastReadAt: new Date(Date.now() - 1000 * 60 * 20).toISOString(),
    lastUpdated: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
    addedAt: new Date().toISOString(),
    rating: 8.5,
    type: 'manhwa',
    genres: ['Romance', 'Erotica', 'Adult'],
    sourceName: 'Manhwa18',
    sourceUrl: 'https://manhwa18.com/touch',
    autoUpdateEnabled: true,
    notes: '',
    categories: [],
    isNsfw: true,
  };

  const sampleLibrary = [
    safeMangaWithNewChapters,
    adultMangaWithNewChapters,
    safeMangaInProgress,
    adultMangaInProgress,
  ];

  // Helper mirroring LibraryView's matchesNsfwFilter
  function filterItems(
    items: MangaItem[],
    nsfwFilter: 'all' | 'safe' | '18+',
    isGuest: boolean
  ) {
    return items.filter((m) => {
      const isAdult = isNsfwManga(m);
      if (isGuest && isAdult) return false;
      if (nsfwFilter === 'safe' && isAdult) return false;
      if (nsfwFilter === '18+' && !isAdult) return false;
      return true;
    });
  }

  it('correctly classifies safe vs adult series using isNsfwManga', () => {
    expect(isNsfwManga(safeMangaWithNewChapters)).toBe(false);
    expect(isNsfwManga(adultMangaWithNewChapters)).toBe(true);
    expect(isNsfwManga(safeMangaInProgress)).toBe(false);
    expect(isNsfwManga(adultMangaInProgress)).toBe(true);
  });

  describe('Fresh Releases Shelf Filtering', () => {
    it('excludes all NSFW titles when nsfwFilter is safe', () => {
      const freshFiltered = filterItems(sampleLibrary, 'safe', false)
        .filter((m) => m.latestChapter > m.currentChapter);

      expect(freshFiltered.length).toBe(1);
      expect(freshFiltered[0].id).toBe('manga_1');
      expect(freshFiltered.some((m) => isNsfwManga(m))).toBe(false);
    });

    it('includes both SFW and NSFW titles with new chapters when nsfwFilter is all', () => {
      const freshFiltered = filterItems(sampleLibrary, 'all', false)
        .filter((m) => m.latestChapter > m.currentChapter);

      expect(freshFiltered.length).toBe(2);
      expect(freshFiltered.map((m) => m.id)).toContain('manga_1');
      expect(freshFiltered.map((m) => m.id)).toContain('manga_2');
    });

    it('shows only 18+ titles with new chapters when nsfwFilter is 18+', () => {
      const freshFiltered = filterItems(sampleLibrary, '18+', false)
        .filter((m) => m.latestChapter > m.currentChapter);

      expect(freshFiltered.length).toBe(1);
      expect(freshFiltered[0].id).toBe('manga_2');
      expect(isNsfwManga(freshFiltered[0])).toBe(true);
    });

    it('never shows NSFW titles to guest users even if filter is all or 18+', () => {
      const guestAllFresh = filterItems(sampleLibrary, 'all', true)
        .filter((m) => m.latestChapter > m.currentChapter);
      expect(guestAllFresh.some((m) => isNsfwManga(m))).toBe(false);

      const guestExplicit18Fresh = filterItems(sampleLibrary, '18+', true)
        .filter((m) => m.latestChapter > m.currentChapter);
      expect(guestExplicit18Fresh.length).toBe(0);
    });
  });

  describe('Jump Back In Shelf Filtering', () => {
    it('excludes NSFW reading in progress when safe mode is active', () => {
      const jumpFiltered = filterItems(sampleLibrary, 'safe', false)
        .filter((m) => m.status === 'reading' && m.currentChapter > 0);

      expect(jumpFiltered.map((m) => m.id)).toEqual(['manga_1', 'manga_3']);
      expect(jumpFiltered.some((m) => isNsfwManga(m))).toBe(false);
    });

    it('includes NSFW reading in progress when 18+ filter is active', () => {
      const jumpFiltered = filterItems(sampleLibrary, '18+', false)
        .filter((m) => m.status === 'reading' && m.currentChapter > 0);

      expect(jumpFiltered.map((m) => m.id)).toEqual(['manga_2', 'manga_4']);
      expect(jumpFiltered.every((m) => isNsfwManga(m))).toBe(true);
    });
  });

  describe('Spotlight Banner Filtering', () => {
    it('does not feature adult items when safe mode is active', () => {
      const spotlightCandidates = filterItems(sampleLibrary, 'safe', false);
      expect(spotlightCandidates.every((m) => !isNsfwManga(m))).toBe(true);
    });

    it('does not feature adult items when browsing as guest', () => {
      const guestSpotlight = filterItems(sampleLibrary, 'all', true);
      expect(guestSpotlight.every((m) => !isNsfwManga(m))).toBe(true);
    });
  });
});
