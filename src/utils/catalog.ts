import {
  MangaItem,
  isMangaDexSourceLink,
  hasWorkingReaderSource,
} from '../types';
import {
  resolveAtomicField,
  resolveAggregativeField,
  uniqArray,
  applyOverrides,
  ensureCoreFields,
  snapshotMetadataOverrides,
  pickBestRepresentative,
} from './metadataHelpers';

// Content rating helpers for 18+ / adult filtering in the Unified Catalog.
const ADULT_GENRES = new Set([
  '18+', 'adult', 'adults', 'ecchi', 'hentai', 'smut', 'mature', 'pornhwa', 'porndata',
  'porn', 'yaoi', 'yuri', 'nsfw', 'doujinshi', 'sex', 'erotica', 'pornographic', 'guro',
  'lolicon', 'shotacon',
]);
const NSFW_SOURCE_KEYWORDS = [
  'manhwa18', 'pornwa', 'pornwiki', 'pornhub', '8muses', 'hbrowse', 'f95zone',
  'mangago', 'doujin', 'sex', 'hentai', 'nsfw',
];

/** Detect adult/18+ content from genres, the source name/url, or any linked source. */
export function isAdultManga(m: MangaItem): boolean {
  if (m.genres && m.genres.some((g) => ADULT_GENRES.has(String(g).toLowerCase()))) return true;
  const src = `${m.sourceName || ''} ${m.sourceUrl || ''} ${m.syncedFromApi || ''}`.toLowerCase();
  if (NSFW_SOURCE_KEYWORDS.some((k) => src.includes(k))) return true;
  if (m.availableSources && m.availableSources.some((s) => NSFW_SOURCE_KEYWORDS.some((k) => `${s.sourceName || ''} ${s.sourceUrl || ''}`.toLowerCase().includes(k)))) return true;
  return false;
}

/** Normalize a title into a stable dedup key (accent-insensitive, alphanumeric only). */
export function normalizeTitleKey(t: string): string {
  return (t || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Merge two entries that refer to the SAME series.
 *
 * Jellyfin-inspired two-bucket merge strategy:
 *
 *  ATOMIC fields  (title, description, coverImage, rating)
 *   → Value comes exclusively from the PREFERRED source (the one with a working
 *     reader, or the higher-scored representative).  Falls back to the other
 *     source only when the preferred value is absent/empty.
 *
 *  AGGREGATIVE fields  (altTitles, genres, availableSources, metadataOverrides)
 *   → UNION of both sources, de-duplicated.  No information is discarded.
 *
 *  LOCAL OVERRIDE layer  (items recorded in `metadataOverrides`)
 *   → Always wins.  Re-applied on top of the merged result so manual user
 *     edits can never be clobbered by a remote merge.
 *
 *  English titles are preferred over romanised/native alternatives.
 */
export function mergeMangaItems(a: MangaItem, b: MangaItem): MangaItem {
  // ── 1. Pick the preferred (more authoritative) representative ────────────
  const base = pickBestRepresentative(a, b);
  const other = base === a ? b : a;

  const srcKey = (s: { sourceName?: string; sourceUrl?: string }) =>
    `${(s.sourceName || '').toLowerCase()}::${(s.sourceUrl || '').toLowerCase()}`;

  // ── 2. Determine which item has a working (non-MangaDex) reader ──────────
  const hasReader = (m: MangaItem): boolean => {
    if (m.sourceUrl && !isMangaDexSourceLink(m.sourceName, m.sourceUrl)) return true;
    return Boolean(
      m.availableSources &&
        m.availableSources.some(
          (s) => s.sourceUrl && !isMangaDexSourceLink(s.sourceName, s.sourceUrl),
        ),
    );
  };
  // The "preferred" source for ATOMIC metadata is the one with a working reader.
  // If neither has one, fall back to the best-scored representative.
  const preferred = hasReader(base) ? base : hasReader(other) ? other : base;
  const secondary = preferred === base ? other : base;

  // ── 3. Snapshot local overrides so they survive the merge ────────────────
  // We snapshot from both items and will re-apply them at the end.
  const preferredOverrideSnap = snapshotMetadataOverrides(preferred);
  const secondaryOverrideSnap = snapshotMetadataOverrides(secondary);

  // ── 4. Build merged availableSources (aggregative) ──────────────────────
  const mergedSourcesMap = new Map<
    string,
    NonNullable<NonNullable<MangaItem['availableSources']>[number]>
  >();
  for (const s of [...(a.availableSources || []), ...(b.availableSources || [])]) {
    if (!s || (!s.sourceName && !s.sourceUrl)) continue;
    mergedSourcesMap.set(srcKey(s), s);
  }
  const mergedSources = Array.from(mergedSourcesMap.values());

  // ── 5. Resolve the best readable source URL ──────────────────────────────
  const readableUrl = ((): { url: string; name: string } => {
    const pool = [
      ...(base.availableSources || []), base,
      ...(other.availableSources || []), other,
    ];
    for (const s of pool) {
      const url = (s as unknown as Record<string, string>).sourceUrl || '';
      const name = (s as unknown as Record<string, string>).sourceName || '';
      if (url && !isMangaDexSourceLink(name, url)) return { url, name };
    }
    // Fall back to MangaDex only if nothing readable exists.
    for (const s of pool) {
      const url = (s as unknown as Record<string, string>).sourceUrl || '';
      const name = (s as unknown as Record<string, string>).sourceName || '';
      if (url) return { url, name };
    }
    return { url: '', name: '' };
  })();

  // ── 6. Build the merged object ───────────────────────────────────────────
  //   Spread `preferred` first so all fields not explicitly overridden inherit
  //   its values (covers things like `status`, `type`, `addedAt`, etc.).
  const merged: MangaItem = {
    ...preferred,

    // ATOMIC — preferred wins; fall back to secondary only if empty.
    title:       resolveAtomicField(preferred, secondary, 'title'),
    description: resolveAtomicField(preferred, secondary, 'description'),
    coverImage:  resolveAtomicField(preferred, secondary, 'coverImage'),
    rating:      resolveAtomicField(preferred, secondary, 'rating'),

    // AGGREGATIVE — union of both.
    altTitles:         resolveAggregativeField(a, b, 'altTitles'),
    genres:            resolveAggregativeField(a, b, 'genres'),
    metadataOverrides: resolveAggregativeField(a, b, 'metadataOverrides'),

    // Source routing.
    apiId:      base.apiId || other.apiId || null,
    sourceUrl:  readableUrl.url  || preferred.sourceUrl  || base.sourceUrl  || other.sourceUrl  || '',
    sourceName: readableUrl.name || preferred.sourceName || base.sourceName || other.sourceName || '',
    availableSources: mergedSources,

    // Progress — always take the maximum (most advanced reading position).
    currentChapter: Math.max(a.currentChapter || 0, b.currentChapter || 0),
    latestChapter:  Math.max(a.latestChapter  || 0, b.latestChapter  || 0),

    // Booleans — logical OR so a positive flag from either item is kept.
    isFavorite: Boolean(a.isFavorite || b.isFavorite),

    // Timestamps — keep the more recent lastUpdated.
    lastUpdated:
      new Date(b.lastUpdated || 0).getTime() > new Date(a.lastUpdated || 0).getTime()
        ? b.lastUpdated
        : a.lastUpdated,
  };

  // ── 7. Re-apply local overrides (LOCAL OVERRIDE LAYER always wins) ───────
  // Preferred source overrides take priority over secondary source overrides
  // (applied last = wins), consistent with the atomic-field priority above.
  let result = applyOverrides(merged, secondaryOverrideSnap);
  result = applyOverrides(result, preferredOverrideSnap);

  // ── 8. Guarantee core fields are never empty ─────────────────────────────
  return ensureCoreFields(result);
}

// Dedupe the catalog so the same series is never shown more than once, keying on the
// authoritative apiId first (source-independent) and falling back to normalized title.
// Duplicate entries are MERGED (not just dropped) so no sources/alt-titles are lost.
// Two distinct series that merely share the same title (both carrying DIFFERENT apiIds)
// are NOT merged.
export function dedupeCatalog(list: MangaItem[]): MangaItem[] {
  const byTitle = new Map<string, MangaItem[]>(); // normalized title -> group buckets
  for (const m of list) {
    const titleKey = normalizeTitleKey(m.title);
    if (!titleKey) continue; // untitled/unparseable titles are kept as-is elsewhere

    const bucket = byTitle.get(titleKey) || (byTitle.set(titleKey, []), byTitle.get(titleKey)!);
    let merged = false;

    for (let i = 0; i < bucket.length; i++) {
      const e = bucket[i];
      // Merge unless both carry a DIFFERENT non-empty apiId (=> distinct series, same name).
      const isConflict = Boolean(e.apiId && m.apiId && e.apiId !== m.apiId);
      if (!isConflict) {
        bucket[i] = mergeMangaItems(e, m);
        merged = true;
        break;
      }
    }
    if (!merged) bucket.push(m);
  }

  // Re-add untitled entries (with a stable title fallback so they are never dropped).
  const result = list
    .filter((m) => !normalizeTitleKey(m.title))
    .map((m) => ({ ...m, title: m.title || `Untitled ${m.id}` }));
  for (const arr of byTitle.values()) result.push(...arr);
  return result;
}

/** Helper: Only show "Read Now" for series with accessible chapter sources/readers. */
export function isReaderAvailable(manga: MangaItem): boolean {
  return hasWorkingReaderSource(manga);
}

export type SortBy = 'title_asc' | 'title_desc' | 'rating_desc' | 'latest_chap_desc' | 'updated_desc';

/** Sort a (already deduped) list of manga by the given sort key. */
export function sortManga(list: MangaItem[], sortBy: SortBy): MangaItem[] {
  const sorted = [...list];
  sorted.sort((a, b) => {
    if (sortBy === 'title_asc') return a.title.localeCompare(b.title);
    if (sortBy === 'title_desc') return b.title.localeCompare(a.title);
    if (sortBy === 'rating_desc') return (b.rating || 0) - (a.rating || 0);
    if (sortBy === 'latest_chap_desc') return b.latestChapter - a.latestChapter;
    if (sortBy === 'updated_desc') {
      return new Date(b.lastUpdated || 0).getTime() - new Date(a.lastUpdated || 0).getTime();
    }
    return 0;
  });
  return sorted;
}

// Re-export helpers so callers don't need a separate import for common utilities.
export { uniqArray, ensureCoreFields, snapshotMetadataOverrides, pickBestRepresentative } from './metadataHelpers';

