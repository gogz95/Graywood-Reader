// ---------------------------------------------------------------------------
// Category Preservation During Metadata Refresh
// ---------------------------------------------------------------------------

/**
 * Preserve user-specific fields (categories, isFavorite, status, custom metadata overrides)
 * while allowing remote metadata updates for series with live sources.
 *
 * When refreshing metadata for a series with a live source (not MangaDex), we want to:
 * 1. Keep all user-assigned categories (shelf assignments)
 * 2. Keep user reading progress (currentChapter, status, notes, isFavorite)
 * 3. Keep custom metadata overrides (metadataOverrides)
 * 4. Update other fields from live sources when available
 *
 * This prevents "breaking" user organization by clearing shelves or resetting reading progress
 * during automated metadata refreshes.
 */
export function preserveUserSpecificFields(
  original: any,
  refreshed: any,
  hasLiveSourceUrl: boolean,
): any {
  // For series with live sources, preserve ALL user-specific fields
  if (hasLiveSourceUrl) {
    // Always preserve user categories - these are per-user shelf assignments
    if (Array.isArray(original.categories) && original.categories.length > 0) {
      refreshed.categories = original.categories;
    }

    // Preserve user reading tracking
    if (typeof original.currentChapter === 'number') {
      refreshed.currentChapter = original.currentChapter;
    }
    if (original.status) {
      refreshed.status = original.status;
    }
    if (original.isFavorite !== undefined) {
      refreshed.isFavorite = original.isFavorite;
    }
    if (original.notes !== undefined) {
      refreshed.notes = original.notes;
    }

    // Preserve custom metadata overrides - these are user-locked fields
    if (Array.isArray(original.metadataOverrides) && original.metadataOverrides.length > 0) {
      refreshed.metadataOverrides = original.metadataOverrides;
    }

    // Preserve other user-specific fields
    if (typeof original.isNsfw === 'boolean') {
      refreshed.isNsfw = original.isNsfw;
    }
    if (typeof original.flaggedAt === 'string' && original.isFlagged) {
      refreshed.flaggedAt = original.flaggedAt;
    }
    if (original.flagReason !== undefined) {
      refreshed.flagReason = original.flagReason;
    }

    // Preserve user-specific source associations
    if (Array.isArray(original.availableSources) && original.availableSources.length > 0) {
      refreshed.availableSources = original.availableSources;
    }

    // Preserve other custom fields that shouldn't be overwritten by live sources
    if (original.lastReadAt !== undefined) {
      refreshed.lastReadAt = original.lastReadAt;
    }
    if (original.addedAt !== undefined) {
      refreshed.addedAt = original.addedAt;
    }
    if (original.sourceName !== undefined) {
      refreshed.sourceName = original.sourceName;
    }
  }

  return refreshed;
}
/**
 * metadataHelpers.ts
 *
 * Jellyfin-inspired metadata merge pipeline for Graywood-Reader.
 *
 * Philosophy (mirrors Jellyfin's MetadataResolver):
 *  - ATOMIC fields  (title, description, coverImage, rating)
 *      → Taken exclusively from the PREFERRED source.
 *        If the preferred value is absent/empty, fall back to the other source.
 *  - AGGREGATIVE fields (altTitles, genres, metadataOverrides)
 *      → UNION of all sources, de-duplicated with a Set.
 *  - LOCAL OVERRIDE layer (metadataOverrides list)
 *      → Always wins – re-applied on top of any remote merge so manual edits
 *        can never be clobbered by a live refresh.
 */

import { MangaItem } from '../types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Sentinel "default rating" used by `ensureCoreFields` when a series has no
 * real rating yet.  We pick an implausible-but-valid float (9.0) that sits at
 * the top of the 0–10 scale so that any genuinely fetched rating from a
 * metadata provider (which is almost always < 9.0 or explicitly `undefined`)
 * can be detected and replaced during enrichment.
 *
 * N.B. A real 9.0 rating is extremely rare on the aggregate sources the app
 * enriches from (MAL max is 9, AniList max is 100/10=10, etc.); the value is
 * treated as a "no rating yet" placeholder.  Users who genuinely curate a 9.0
 * rating should pin it via `metadataOverrides`.
 */
export const DEFAULT_UNKNOWN_RATING = 9.0;

// ---------------------------------------------------------------------------
// Field categories
// ---------------------------------------------------------------------------

/**
 * Atomic (single-value) fields: the preferred source's value always wins.
 * A missing/empty value on the preferred source falls back to the other source.
 * (Mirrors Jellyfin's treatment of Title / Overview / Poster etc.)
 */
export const ATOMIC_METADATA_FIELDS = [
  'title',
  'description',
  'coverImage',
  'rating',
  'isNsfw',
] as const;

export type AtomicMetadataField = (typeof ATOMIC_METADATA_FIELDS)[number];

/**
 * Aggregative (collection) fields: union of both sources, de-duplicated.
 * (Mirrors Jellyfin's treatment of Genres / Tags / People etc.)
 */
export const AGGREGATIVE_METADATA_FIELDS = [
  'altTitles',
  'genres',
  'metadataOverrides',
] as const;

export type AggregativeMetadataField = (typeof AGGREGATIVE_METADATA_FIELDS)[number];

/**
 * The complete set of fields a live metadata refresh may overwrite and that
 * the user can protect via `metadataOverrides`.
 * (Includes both atomic AND aggregative descriptive fields.)
 */
export const OVERRIDEABLE_METADATA_FIELDS = [
  ...ATOMIC_METADATA_FIELDS,
  'genres',
  'altTitles',
] as const satisfies ReadonlyArray<keyof MangaItem>;

export type OverrideableMetadataField = (typeof OVERRIDEABLE_METADATA_FIELDS)[number];

// ---------------------------------------------------------------------------
// Confidence scoring (Jellyfin's "pickBestRepresentative")
// ---------------------------------------------------------------------------

/**
 * Compute a numeric confidence score for a MangaItem.
 * Higher is "better" / more authoritative.
 *
 * Weights:
 *  +10 000  — user has marked it as a favourite (strong intent signal)
 *  +1 000   — per additional linked source (breadth)
 *  + 500    — has at least one unique identifier (apiId / sourceUrl)
 *  + n      — latestChapter count (recency proxy)
 *  + n×10   — rating (quality signal)
 */
export function scoreMangaItem(m: MangaItem): number {
  let score = 0;
  if (m.isFavorite) score += 10_000;
  score += (m.availableSources?.length ?? 0) * 1_000;
  if (m.apiId || m.sourceUrl) score += 500;
  score += m.latestChapter ?? 0;
  score += (m.rating ?? 0) * 10;
  return score;
}

/**
 * Return whichever of two items is the more authoritative representative,
 * based on `scoreMangaItem`.  Ties go to `a`.
 */
export function pickBestRepresentative(a: MangaItem, b: MangaItem): MangaItem {
  return scoreMangaItem(a) >= scoreMangaItem(b) ? a : b;
}

// ---------------------------------------------------------------------------
// Core merge helpers
// ---------------------------------------------------------------------------

/** De-duplicate an array, preserving insertion order. */
export function uniqArray<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

/**
 * Return the "best" value for an atomic field.
 *
 * Rule:
 *  1. Use `preferred[field]` if it is non-empty.
 *  2. Fall back to `other[field]` when the preferred value is absent.
 *
 * For strings: empty string / whitespace-only counts as absent.
 * For numbers: 0 counts as absent (a rating of 0 is meaningless).
 */
export function resolveAtomicField<K extends AtomicMetadataField>(
  preferred: MangaItem,
  other: MangaItem,
  field: K,
): MangaItem[K] {
  const pv = preferred[field];
  if (Array.isArray(pv)) return (pv.length > 0 ? pv : other[field]) as MangaItem[K];
  if (typeof pv === 'string') return (pv.trim() !== '' ? pv : other[field]) as MangaItem[K];
  if (typeof pv === 'number') return (pv !== 0 ? pv : other[field]) as MangaItem[K];
  return (pv ?? other[field]) as MangaItem[K];
}

/**
 * Return the union (de-duplicated) value for an aggregative field.
 * Both sources contribute; neither overwrites the other.
 */
export function resolveAggregativeField(
  a: MangaItem,
  b: MangaItem,
  field: AggregativeMetadataField,
): string[] {
  const av: unknown = a[field];
  const bv: unknown = b[field];
  const aArr = Array.isArray(av) ? (av as string[]) : [];
  const bArr = Array.isArray(bv) ? (bv as string[]) : [];
  return uniqArray([...aArr, ...bArr].filter(Boolean));
}

// ---------------------------------------------------------------------------
// Override snapshot / restore  (Jellyfin's LocalMetadataProvider pattern)
// ---------------------------------------------------------------------------

/**
 * Snapshot the current values of any fields that the user has manually
 * overridden (recorded in `metadataOverrides`).  Call this BEFORE a remote
 * refresh so the values can be re-applied afterwards.
 */
export function snapshotMetadataOverrides(manga: MangaItem): Record<string, unknown> {
  const overridden = Array.isArray(manga.metadataOverrides) ? manga.metadataOverrides : [];
  const snap: Record<string, unknown> = {};
  for (const field of OVERRIDEABLE_METADATA_FIELDS) {
    if (overridden.includes(field)) {
      const value = (manga as unknown as Record<string, unknown>)[field];
      if (
        value !== undefined &&
        value !== null &&
        value !== '' &&
        !(Array.isArray(value) && value.length === 0)
      ) {
        snap[field] = Array.isArray(value) ? [...value] : value;
      }
    }
  }
  return snap;
}

/**
 * Re-apply user-overridden metadata fields from a previously taken snapshot.
 * Call this AFTER a remote refresh to prevent clobbering manual edits.
 */
export function restoreMetadataOverrides(
  manga: MangaItem,
  snap: Record<string, unknown>,
): void {
  for (const field of OVERRIDEABLE_METADATA_FIELDS) {
    if (!(field in snap)) continue;
    const value = snap[field];
    if (
      value !== undefined &&
      value !== null &&
      value !== '' &&
      !(Array.isArray(value) && value.length === 0)
    ) {
      (manga as unknown as Record<string, unknown>)[field] = Array.isArray(value) ? [...value] : value;
    }
  }
}

/**
 * Shallow-merge a pre-computed override snapshot onto a MangaItem.
 * Useful when building a merged object via spread instead of mutation.
 */
export function applyOverrides(
  item: MangaItem,
  snap: Record<string, unknown>,
): MangaItem {
  if (Object.keys(snap).length === 0) return item;
  return { ...item, ...snap };
}

// ---------------------------------------------------------------------------
// Safety net for empty core fields
// ---------------------------------------------------------------------------

export function decodeHtmlEntities(str: string): string {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&hellip;/g, '…')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * Filter common naming faults, status badges, and source watermarks from series titles
 * so that ONLY the clean, genuine series name is retained.
 *
 * Handles:
 *  - Status badges: Hot, New, 18+, +18, R-18, Mature, Adult (in brackets [], parens (), or standalone)
 *  - Release tags: [Official], (Official English), [RAW], (HD), [Colored], [Uncensored], etc.
 *  - Source watermarks: "Read at Asura Scans", "Read on Website", "Read Free at ...", " - Read Manga Online"
 *  - Source suffixes: " - Asura Scans", " | MangaDex", " : Flame Comics", " - MangaClash", " - AsuraComic.net"
 *  - Domain name suffixes: .com, .net, .xyz, .top, .io, .org, .me, .to, .cc, etc.
 *  - Leaked chapter suffixes: " - Chapter 5", " Ch. 12"
 */
export function cleanMangaTitle(rawTitle: string): string {
  if (!rawTitle || typeof rawTitle !== 'string') return '';

  // 1. Strip XML/HTML tags and decode entities
  let title = decodeHtmlEntities(rawTitle.replace(/<[^>]*>/g, ' '));

  // 2. Normalize whitespace
  title = title.replace(/\s+/g, ' ').trim();
  if (!title) return '';

  // 3. Strip bracketed & parenthetical badges/tags anywhere in the string
  title = title
    .replace(/\[(?:hot|new|18\+|\+18|r-?18|mature|adult|official|official\s+english|english|eng|raw|raw\s+hd|hd|hq|4k|uncensored|censored|color|colored|full\s+color|reboot|remake|end|complete|completed|hiatus|webtoon|manhwa|manhua|manga|novel|scan|scanlation)[^\]]*\]/gi, ' ')
    .replace(/\((?:hot|new|18\+|\+18|r-?18|mature|adult|official|official\s+english|english|eng|raw|raw\s+hd|hd|hq|4k|uncensored|censored|color|colored|full\s+color|reboot|remake|end|complete|completed|hiatus|webtoon|manhwa|manhua|manga|novel|scan|scanlation)[^)]*\)/gi, ' ')
    .replace(/【(?:hot|new|18\+|\+18|r-?18|mature|adult|official|raw|hd|colored|uncensored)[^】]*】/gi, ' ');

  // 4. Strip standalone tag prefixes/suffixes (e.g. "HOT! Title", "NEW - Title", "18+ Title", "(18+) Title")
  title = title.replace(/^(?:hot|new|18\+|\+18|r-?18)\s*[-–—:|!]\s*/gi, '');
  title = title.replace(/\s*[-–—:|!]\s*(?:hot|new|18\+|\+18|r-?18)$/gi, '');
  title = title.replace(/(?:^|\s)(?:18\+|\+18|r-?18)(?:\s|$)/gi, ' ');

  // 5. Strip promotional "Read at / Read on / Read Free at <website>"
  title = title.replace(/(?:[-–—|:]\s*)?read\s+(?:free\s+)?(?:online\s+)?(?:manga|manhwa|manhua|comic|chapters?)?\s*(?:free\s+)?(?:at|on)\s+["']?[a-z0-9\s._-]+["']?/gi, '');
  title = title.replace(/read\s+(?:free\s+)?(?:online\s+)?(?:manga|manhwa|manhua|comic)?\s*(?:at|on)\s+.*$/gi, '');
  title = title.replace(/\s*[-–—|:]\s*read\s+(?:free\s+)?(?:manga|manhwa|manhua|comic)?\s*(?:online)?\s*(?:free)?.*$/gi, '');
  title = title.replace(/\s*[-–—|:]\s*free\s+(?:online\s+)?(?:manga|manhwa|comic).*$/gi, '');

  // 6. Strip "at <SiteName>" or "@ <SiteName>" suffix
  title = title.replace(/\s+(?:at|@)\s+(?:asurascans?|flamecomics?|reaperscans?|manhuaplus|manhwa18|mangadex|weebcentral|mangaread|kunmanga|topmanhua|batoto|bato\.to|mangakakalot|manganato|manga[\w]+)\b.*$/gi, '');

  // 7. Strip known site names and scanlation group suffixes
  title = title.replace(/\s*[-–—|:]\s*(?:Asura\s*Scans?|Flame\s*Comics?|Reaper\s*Scans?|Manhwa18|Manhua\s*Plus|Aqua\s*Manga|Hari\s*Manga|Weeb\s*Central|Manga\s*Read|Hiperdex|Adult\s*Webtoon|Top\s*Manhua|Bato(?:\.to)?|MangaDex|Dynasty(?:\s*Scans)?|Kun\s*Manga|Manga\s*Buddy|Manga\s*Clash|Manga\s*TX|Manga\s*Kakalot|Manga\s*Nato|Toon\s*Top|Demonic\s*Scans?|Raven\s*Scans?|Anisa\s*Scans?|Luminous\s*Scans?|Zero\s*Scans?|Night\s*Scans?|Drake\s*Scans?|Vortex\s*Scans?|Void\s*Scans?|Immortal\s*Updates?|ComicK|Webtoon(?:\.com)?)\b.*$/gi, '');

  // 8. Strip generic domain name suffixes (.com, .net, .xyz, etc.)
  title = title.replace(/\s*[-–—|:]\s*[a-z0-9-]+\.(?:com|org|net|xyz|top|io|me|to|cc|gg|in|tv|fun|co|site|online)\b.*$/gi, '');

  // 9. Strip chapter / episode numbers appended to title
  title = title.replace(/(?:\s*[-–—:]\s*)?(?:(?:Chapter|Chapitre|Capitulo|Ch\.?|Episode|Ep\.?|Season|S)\s*\d+).*$/i, '');

  // 10. Clean up dangling leading/trailing punctuation and trim whitespace
  title = title
    .replace(/^[\s\-–—:|/.,]+|[\s\-–—:|/.,]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return title || rawTitle.trim();
}

/**
 * Ensure all core fields required by MangaItem are populated with valid defaults.
 */
export function ensureCoreFields(item: Partial<MangaItem>): MangaItem {
  const cleanedTitle = cleanMangaTitle(item.title || '');
  const out: MangaItem = {
    id: item.id || `m_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    title: cleanedTitle,
    altTitles: item.altTitles || [],
    type: item.type || 'manhwa',
    coverImage: item.coverImage || '',
    description: item.description || '',
    genres: item.genres && item.genres.length > 0 ? item.genres : ['Action', 'Fantasy'],
    status: item.status || 'plan_to_read',
    currentChapter: item.currentChapter || 0,
    latestChapter: item.latestChapter || 1,
    totalChapters: item.totalChapters,
    lastUpdated: item.lastUpdated || new Date().toISOString(),
    rating: item.rating !== undefined ? item.rating : DEFAULT_UNKNOWN_RATING,
    sourceUrl: item.sourceUrl || '',
    sourceName: item.sourceName || 'Unknown Source',
    autoUpdateEnabled: item.autoUpdateEnabled !== undefined ? item.autoUpdateEnabled : true,
    notes: item.notes,
    addedAt: item.addedAt || new Date().toISOString(),
    lastReadAt: item.lastReadAt,
    syncedFromApi: item.syncedFromApi,
    apiId: item.apiId,
    userId: item.userId,
    isFavorite: item.isFavorite,
    isFlagged: item.isFlagged,
    flagReason: item.flagReason,
    flaggedAt: item.flaggedAt,
    availableSources: item.availableSources,
    metadataOverrides: item.metadataOverrides,
    customTags: item.customTags,
    categories: item.categories,
    isNsfw: item.isNsfw,
  };

  if (!out.title || out.title.trim() === '') {
    out.title = `Untitled ${out.id}`;
  }

  if (!out.description || out.description.trim() === '') {
    out.description = `${out.title} is an active series tracked via ${out.sourceName || 'an external source'}.`;
  }

  if (!out.coverImage || out.coverImage.trim() === '') {
    out.coverImage = '';
  }

  return out;
}

// ---------------------------------------------------------------------------
// English title preference helper
// ---------------------------------------------------------------------------

/**
 * Given a map of language → title (e.g. from a MangaDex attrs.title object),
 * return the English title if present, otherwise the first available value.
 * This ensures we always prefer an English title over romanised/native titles.
 */
export function preferEnglishTitle(
  titleMap: Record<string, string> | null | undefined,
): string | null {
  if (!titleMap || typeof titleMap !== 'object') return null;
  if (titleMap['en']) return titleMap['en'];
  const values = Object.values(titleMap).filter(Boolean);
  return values[0] ?? null;
}

// ---------------------------------------------------------------------------
// Ad & Spam Series Protection Helpers
// ---------------------------------------------------------------------------

export const AD_SERIES_PATTERNS = [
  /\bcam\s*model\b/i,
  /\bfree\s*live\s*sex\s*show\b/i,
  /\blive\s*sex\s*chat\b/i,
  /\bsex\s*chat\b/i,
  /\blive\s*cam\b/i,
  /\bwebcam\s*girl/i,
  /\bchaturbate\b/i,
  /\bstripchat\b/i,
  /\bcamsoda\b/i,
  /\blivejasmin\b/i,
  /\bbongacams\b/i,
  /\bmeet\s*(?:hot\s*)?singles\b/i,
  /\bhot\s*girls?\s*in\s*your\s*area\b/i,
  /\badult\s*dating\b/i,
  /\bfree\s*sex\s*simulator\b/i,
  /\bplay\s*(?:online\s*)?(?:casino|slot|poker)\b/i,
  /\bslot\s*gacor\b/i,
  /\bjudi\s*online\b/i,
  /\bfree\s*coins\b/i,
  /\bclaim\s*(?:free\s*)?bonus\b/i,
  /\bdownload\s*pc\s*game\b/i,
  /\binstall\s*app\s*now\b/i,
  /\bwatch\s*free\s*porn\b/i,
  /\bclick\s*here\s*to\s*(?:watch|play|chat|join)\b/i,
  /\bjoin\s*free\s*now\b/i,
  /\bonlyfans\s*leak\b/i,
  /\bwin\s*real\s*money\b/i,
  /\b18\+\s*(?:game|dating|cam|chat)\b/i,
];

export function isAdSeries(title: string, url?: string, description?: string): boolean {
  if (!title || typeof title !== 'string') return false;
  const cleanTitle = title.trim();
  for (const p of AD_SERIES_PATTERNS) {
    if (p.test(cleanTitle)) return true;
  }
  if (url && typeof url === 'string') {
    const cleanUrl = url.trim().toLowerCase();
    if (/(?:trafficjunky|exoclick|adsterra|juicyads|ero-advertising|chaturbate|stripchat|bongacams|livejasmin|realsrv|plugrush|popcash|popads)/i.test(cleanUrl)) {
      return true;
    }
  }
  if (description && typeof description === 'string') {
    for (const p of AD_SERIES_PATTERNS) {
      if (p.test(description)) return true;
    }
  }
  return false;
}

