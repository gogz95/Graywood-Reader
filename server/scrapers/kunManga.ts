import { createMadaraListScraper, MadaraSeriesItem } from './madaraTheme';

export type KunMangaSeriesItem = MadaraSeriesItem;

const kunManga = createMadaraListScraper({
  id: 'kunmanga',
  name: 'Kun Manga',
  baseUrl: 'https://kunmanga.com',
  defaultGenres: ['Manhua', 'Manhwa', 'Manga'],
});

export const extractKunMangaSlug = kunManga.extractSlug;
export const scrapeKunManga = kunManga.scrape;
export const searchKunManga = kunManga.search;
