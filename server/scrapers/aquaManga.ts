import { createMadaraListScraper, MadaraSeriesItem } from './madaraTheme';

export type AquaMangaSeriesItem = MadaraSeriesItem;

const aquaManga = createMadaraListScraper({
  id: 'aquamanga',
  name: 'Aqua Manga',
  baseUrl: 'https://aquareader.org',
  defaultGenres: ['Manhwa', 'Manga'],
  inferType: () => 'manhwa',
});

export const extractAquaMangaSlug = aquaManga.extractSlug;
export const scrapeAquaManga = aquaManga.scrape;
export const searchAquaManga = aquaManga.search;
