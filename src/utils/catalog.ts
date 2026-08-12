import {
  MangaItem,
  isMangaDexSourceLink,
  hasWorkingReaderSource,
} from '../types';

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

/** Pick the best single representative when the same series appears multiple times. */
function pickBestRepresentative(a: MangaItem, b: MangaItem): MangaItem {
  const score = (m: MangaItem) => {
    let s = 0;
    if (m.isFavorite) s += 10000;
    s += (m.availableSources?.length || 0) * 1000;
    if (m.apiId || m.sourceUrl) s += 500;
    s += (m.latestChapter || 0);
    s += (m.rating || 0) * 10;
    return s;
  };
  return score(a) >= score(b) ? a : b;
}

/** Merge two entries that refer to the SAME series, preserving as much data as possible. */
export function mergeMangaItems(a: MangaItem, b: MangaItem): MangaItem {
  const base = pickBestRepresentative(a, b);
  const other = base === a ? b : a;

  const uniq = <T,>(arr: T[]): T[] => Array.from(new Set(arr));
  const srcKey = (s: { sourceName?: string; sourceUrl?: string }) =>
    `${(s.sourceName || '').toLowerCase()}::${(s.sourceUrl || '').toLowerCase()}`;

  const mergedSourcesMap = new Map<string, NonNullable<NonNullable<MangaItem['availableSources']>[number]>>();
  for (const s of [...(a.availableSources || []), ...(b.availableSources || [])]) {
    if (!s || (!s.sourceName && !s.sourceUrl)) continue;
    mergedSourcesMap.set(srcKey(s), s);
  }
  const mergedSources = Array.from(mergedSourcesMap.values());
  const mergedAltTitles = uniq([...(a.altTitles || []), ...(b.altTitles || [])].filter(Boolean));
  const mergedGenres = uniq([...(a.genres || []), ...(b.genres || [])].filter(Boolean));

  // Prefer the variant that is actually readable (has a working source).
  const hasReader = (m: MangaItem): boolean => {
    if (m.sourceUrl && !isMangaDexSourceLink(m.sourceName, m.sourceUrl)) return true;
    return Boolean(m.availableSources && m.availableSources.some((s) => s.sourceUrl && !isMangaDexSourceLink(s.sourceName, s.sourceUrl)));
  };
  const preferred = hasReader(base) ? base : hasReader(other) ? other : base;

  // Resolve a non-MangaDex source URL when possible so merged series stay readable.
  const readableUrl = ((): { url: string; name: string } => {
    const preferNonMd = [...(base.availableSources || []), base];
    const anyMd = [...(other.availableSources || []), other];
    const pool = [...preferNonMd, ...anyMd];
    for (const s of pool) {
      const url = (s as any).sourceUrl || '';
      const name = (s as any).sourceName || '';
      if (url && !isMangaDexSourceLink(name, url)) return { url, name };
    }
    // Fall back to a MangaDex URL only if nothing else exists (kept for metadata, not reading).
    for (const s of pool) {
      const url = (s as any).sourceUrl || '';
      const name = (s as any).sourceName || '';
      if (url) return { url, name };
    }
    return { url: '', name: '' };
  })();

  return {
    ...preferred,
    title: base.title || other.title,
    altTitles: mergedAltTitles,
    genres: mergedGenres,
    apiId: base.apiId || other.apiId || null,
    sourceUrl: readableUrl.url || preferred.sourceUrl || base.sourceUrl || other.sourceUrl || '',
    sourceName: readableUrl.name || preferred.sourceName || base.sourceName || other.sourceName || '',
    availableSources: mergedSources,
    currentChapter: Math.max(a.currentChapter || 0, b.currentChapter || 0),
    latestChapter: Math.max(a.latestChapter || 0, b.latestChapter || 0),
    rating: Math.max(a.rating || 0, b.rating || 0),
    isFavorite: Boolean(a.isFavorite || b.isFavorite),
    lastUpdated:
      new Date(b.lastUpdated || 0).getTime() > new Date(a.lastUpdated || 0).getTime()
        ? b.lastUpdated
        : a.lastUpdated,
  };
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
