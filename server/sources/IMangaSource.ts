/**
 * IMangaSource.ts
 *
 * Unified interface for all manga source scrapers in Graywood-Reader.
 *
 * Inspired by Jellyfin's `IRemoteMetadataProvider<TItem, TSearchInfo>` pattern:
 * each concrete scraper registers itself in SOURCE_REGISTRY (sourcesCatalog.ts)
 * and declares what capabilities it exposes (fetchAll, search, getMetadata).
 * The core merge engine remains source-agnostic.
 *
 * Adding a new source:
 *  1. Create `server/scrapers/<name>.ts` and implement IMangaSource.
 *  2. Add it to SOURCE_REGISTRY in `server/sources/sourcesCatalog.ts`.
 *  That's it — no changes needed to the merge pipeline.
 */

import { MangaItem } from '../../src/types';

// ---------------------------------------------------------------------------
// Capability interface
// ---------------------------------------------------------------------------

export interface IMangaSource {
  /**
   * Unique, lowercase identifier — must match the `id` in ALL_SOURCES_CATALOG.
   * e.g. 'weebcentral', 'asurascans', 'flamecomics', 'mangadex'
   */
  readonly id: string;

  /** Human-readable display name. */
  readonly name: string;

  /**
   * Fetch the full catalogue of series available from this source.
   * Returns partial MangaItem objects; the merge engine fills in gaps.
   * Optional: not all sources can enumerate their entire catalogue.
   */
  fetchAll?(): Promise<Partial<MangaItem>[]>;

  /**
   * Search this source by title.
   * Optional: only implement if the source has a search API.
   */
  search?(query: string): Promise<Partial<MangaItem>[]>;

  /**
   * Fetch detailed metadata for a single series identified by its URL.
   * Optional: only implement if the source provides per-series detail pages.
   *
   * Returns a partial MangaItem (the merge engine picks the best field
   * values across all sources via resolveAtomicField / resolveAggregativeField).
   */
  getMetadata?(url: string): Promise<Partial<MangaItem> | null>;

  /**
   * Confidence score (0–100) for metadata provided by this source.
   * Higher = more authoritative.  Used by the merge engine when two sources
   * supply conflicting atomic values and a working-reader check is inconclusive.
   *
   * Defaults: dedicated API sources (MangaDex, Asura) → 90
   *           HTML scrapers → 70
   *           Metadata-only sources → 60
   */
  readonly metadataConfidence: number;

  /**
   * True when this source is metadata-only (e.g. MangaDex) and cannot serve
   * chapter pages.  The merge engine never uses a metadata-only source's URL
   * as the primary `sourceUrl`.
   */
  readonly isMetadataOnly: boolean;
}

// ---------------------------------------------------------------------------
// Minimal base class (optional convenience)
// ---------------------------------------------------------------------------

/**
 * A thin abstract base that provides sane defaults for the optional properties.
 * Concrete scrapers may extend this or implement IMangaSource directly.
 */
export abstract class BaseMangaSource implements IMangaSource {
  abstract readonly id: string;
  abstract readonly name: string;

  readonly metadataConfidence: number = 70;
  readonly isMetadataOnly: boolean = false;

  fetchAll?(): Promise<Partial<MangaItem>[]>;
  search?(query: string): Promise<Partial<MangaItem>[]>;
  getMetadata?(url: string): Promise<Partial<MangaItem> | null>;
}
