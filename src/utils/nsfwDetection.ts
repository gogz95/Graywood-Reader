// ---------------------------------------------------------------------------
// NSFW / 18+ Content Detection Engine
// ---------------------------------------------------------------------------
// Extracted from types.ts (which should only hold interfaces/type aliases).
// All callers that imported isNsfwManga / getNsfwDetectionReason from types.ts
// still work — both symbols are re-exported from types.ts for backward compat.
// ---------------------------------------------------------------------------

import type { MangaItem } from '../types';

type NsfwCheckTarget = {
  genres?: string[];
  title?: string;
  altTitles?: string[];
  notes?: string;
  description?: string;
  isNsfw?: boolean;
  sourceName?: string;
  sourceUrl?: string;
  availableSources?: Array<{ sourceName?: string; sourceUrl?: string }>;
};

const KNOWN_NSFW_SOURCES = [
  'manhwa18', 'adult webtoon', 'adultwebtoon', 'hiperdex', 'beehentai',
  'hentai20', 'hotcomics', 'daycomics', 'nhentai', 'hitomi', 'pururin',
  'e-hentai', 'exhentai',
];

const NSFW_GENRE_EXACT = new Set([
  '18+', 'adult', 'mature', 'smut', 'ecchi', 'hentai', 'erotica', 'nsfw',
  'r18', 'r-18', 'r18g', 'porn', 'uncensored', 'lewd', 'ntr', 'netorare',
  'netori', 'ahegao', 'bdsm', 'fetish', 'sex', 'erotic', 'doujinshi',
  'toomics 18+', 'borderline hentai', 'yaoi (explicit)', 'yuri (explicit)',
  'sexual violence', 'h-manga', 'softcore', 'hardcore',
]);

const NSFW_GENRE_PARTIAL = [
  '18+', 'adult', 'hentai', 'erotica', 'smut', 'netorare', 'nsfw',
  'r18', 'porn', 'bdsm', 'ahegao', 'lewd',
];

const NSFW_TITLE_KEYWORDS = [
  '[18+]', '(18+)', ' 18+ ', '[nsfw]', '(nsfw)', '[uncensored]',
  '(uncensored)', '[smut]', '[hentai]', '[adult]', '[r18]', '[r-18]',
  '[raw 18+]', 'uncensored ver', '18+ ver',
];

const NSFW_DESC_PHRASES = [
  '18+ only', 'explicit adult content', 'sexually explicit',
  'for adult readers', 'mature audiences only', 'erotic webtoon',
  'uncensored chapters', 'smut version',
];

/**
 * Returns a human-readable reason string if the manga is NSFW, or null if it's safe.
 * Checks (in priority order):
 *   1. `isNsfw` flag directly on the item
 *   2. Source name / URL against known adult domains
 *   3. Genre tags (exact match, then substring match)
 *   4. Title / altTitles / notes keywords
 *   5. Description disclaimers
 */
export function getNsfwDetectionReason(manga?: NsfwCheckTarget): string | null {
  if (!manga) return null;
  if (manga.isNsfw === true) return 'Flagged as 18+ / NSFW directly in series metadata';

  // 1. Source origin check
  const sourcesToCheck: Array<{ sourceName?: string; sourceUrl?: string }> = [
    { sourceName: manga.sourceName, sourceUrl: manga.sourceUrl },
    ...(Array.isArray(manga.availableSources) ? manga.availableSources : []),
  ];

  for (const src of sourcesToCheck) {
    const sName = (src.sourceName || '').toLowerCase();
    const sUrl  = (src.sourceUrl  || '').toLowerCase();
    for (const ns of KNOWN_NSFW_SOURCES) {
      if (sName.includes(ns)) return `Imported from 18+ adult source (${src.sourceName || ns})`;
      if (sUrl && sUrl.includes(ns)) return `Live URL matches known adult domain (${ns})`;
    }
  }

  // 2. Genre tag checks
  const genres = Array.isArray(manga.genres) ? manga.genres : [];
  for (const g of genres) {
    const glc = g.toLowerCase().trim();
    if (NSFW_GENRE_EXACT.has(glc)) return `Contains 18+ adult genre tag "${g}"`;
    for (const partial of NSFW_GENRE_PARTIAL) {
      if (glc.includes(partial)) return `Contains 18+ adult genre tag "${g}"`;
    }
  }

  // 3. Title / altTitles / notes keywords
  const titleText = `${manga.title || ''} ${(manga.altTitles || []).join(' ')} ${manga.notes || ''}`.toLowerCase();
  for (const kw of NSFW_TITLE_KEYWORDS) {
    if (titleText.includes(kw)) return 'Title contains 18+ / adult classification keyword';
  }

  // 4. Description disclaimer
  const descText = (manga.description || '').toLowerCase();
  for (const phrase of NSFW_DESC_PHRASES) {
    if (descText.includes(phrase)) return 'Description contains explicit adult content disclaimer';
  }

  return null;
}

/**
 * Returns true if the manga should be treated as NSFW / adult content.
 */
export function isNsfwManga(manga?: NsfwCheckTarget): boolean {
  return Boolean(getNsfwDetectionReason(manga));
}
