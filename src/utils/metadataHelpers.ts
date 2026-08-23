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
      snap[field] = Array.isArray(value) ? [...value] : value;
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
    (manga as unknown as Record<string, unknown>)[field] = Array.isArray(value) ? [...value] : value;
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

/**
 * Ensure that every core field has a non-empty value.
 * Missing fields receive a generated placeholder so downstream code never
 * has to handle `undefined`/empty strings for fundamental display data.
 * (Mirrors Jellyfin's placeholder strategy in purgeDisabledSourcesAndRefreshMetadata.)
 */
export function ensureCoreFields(item: MangaItem): MangaItem {
  const out = { ...item };

  if (!out.title || out.title.trim() === '') {
    out.title = `Untitled ${out.id}`;
  }

  if (!out.description || out.description.trim() === '') {
    out.description = `${out.title} is an active series tracked via ${out.sourceName || 'an external source'}.`;
  }

  if (!out.coverImage || out.coverImage.trim() === '') {
    out.coverImage =
      '/api/mangadex/image-proxy?url=https%3A%2F%2Fuploads.mangadex.org%2Fcovers%2F32d76d19-8a05-4db0-9fc2-e0b0648fe9d0%2Ffbc962f9-3d12-4c6e-8212-32a2cb874a7b.jpg';
  }

  if (!out.genres || out.genres.length === 0) {
    out.genres = ['Action', 'Fantasy'];
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

