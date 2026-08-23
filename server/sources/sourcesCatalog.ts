import fs from 'fs';
import path from 'path';
import { SourceDefinition, SourceEngineType, DatabaseSyncConfig, isMangaDexSourceLink, MangaItem } from '../../src/types';

export type { SourceDefinition, SourceEngineType };

export function isContentPath(p: string): boolean {
  if (!p) return false;
  return /\/(read|chapter|manga|comic|series|view|comic-detail)\//i.test(p) ||
         /[-_/](ch(?:apter)?|ep(?:isode)?)[-_/]?\d+/i.test(p);
}

/** Strictly checks if a URL path points to a series/manga container and NOT an individual chapter/reading page */
export function isSeriesContentPath(p: string): boolean {
  if (!p) return false;
  // Reject if it contains explicit chapter/episode/reading paths
  if (/\/(chapter|read|reader|view|episode)[-_/]?\d+/i.test(p)) return false;
  if (/[-_/](ch(?:apter)?|ep(?:isode)?)[-_/]?\d+/i.test(p)) return false;
  if (/\/chapter[-_/]/i.test(p)) return false;

  // Must match standard manga/comic/series container routes
  return /\/(manga|comic|series|webtoon|manhwa|manhua|comic-detail|title)\/[^/]+/i.test(p) ||
         /\/(manga|comic|series|webtoon|manhwa|manhua)\/[^/]+(?:\/|$)/i.test(p);
}

/** Identifies whether a text string is actually a chapter number/label rather than a genuine series title */
export function isChapterTitle(t: string): boolean {
  if (!t) return true;
  const clean = t.trim();
  if (/^(?:ch(?:apter)?\.?\s*\d+|ep(?:isode)?\.?\s*\d+|vol(?:ume)?\.?\s*\d+|season\s*\d+\s*(?:ep\s*\d+)?|\d+(?:\.\d+)?)$/i.test(clean)) return true;
  if (/^(?:read\s+chapter|chapter\s+\d+|ch\.\s*\d+|ep\.\s*\d+|all\s+chapters|previous\s+chapter|next\s+chapter)/i.test(clean)) return true;
  return false;
}

export function isNavText(t: string): boolean {
  if (!t) return true;
  const lower = t.toLowerCase().trim();
  return ['next', 'prev', 'previous', 'first', 'last', 'index', 'home', 'back', 'chapter list', 'all chapters'].includes(lower);
}

// Curated active fallback sources in case catalog.json is unavailable.
// IMPORTANT — engine labels:
//   asurascans  → 'custom_html' (uses api.asurascans.com — NOT the mangathemesia HTML theme)
//   flamecomics  → 'custom_html' (uses _next/data buildId pipeline — NOT the mangathemesia HTML theme)
//   batoto / comick / readm REMOVED (dead / 403 / timeout as of 2026-08 diagnostic)
const DEFAULT_PRIMARY_SOURCES: SourceDefinition[] = [
  // ── Metadata API (background only) ───────────────────────────────────────
  { id: 'mangadex',      name: 'MangaDex API v5',    baseUrl: 'https://mangadex.org',       engineType: 'mangadex',      lang: 'en', isNsfw: false },
  // ── Dedicated API scrapers (have their own modules in server/scrapers/) ──
  { id: 'weebcentral',   name: 'Weeb Central',        baseUrl: 'https://weebcentral.com',    engineType: 'custom_html',   lang: 'en', isNsfw: false },
  { id: 'asurascans',    name: 'Asura Scans',         baseUrl: 'https://asurascans.com',     engineType: 'custom_html',   lang: 'en', isNsfw: false },
  { id: 'flamecomics',   name: 'Flame Comics',        baseUrl: 'https://flamecomics.xyz',    engineType: 'custom_html',   lang: 'en', isNsfw: false },
  // ── Verified working Madara sources (diagnostic 2026-08) ─────────────────
  { id: 'manhwa18',      name: 'Manhwa18',            baseUrl: 'https://manhwa18.com',       engineType: 'custom_html',   lang: 'en', isNsfw: true  },
  { id: 'manhwa18cc',    name: 'Manhwa18.cc',         baseUrl: 'https://manhwa18.cc',        engineType: 'madara',        lang: 'en', isNsfw: true  },
  { id: 'aquamanga',     name: 'Aqua Manga',          baseUrl: 'https://aquareader.org',     engineType: 'madara',        lang: 'en', isNsfw: false },
  { id: 'manhuaplusorg', name: 'ManhuaPlus.org',      baseUrl: 'https://manhuaplus.top',     engineType: 'madara',        lang: 'en', isNsfw: false },
  { id: 'manhuaplus',    name: 'Manhua Plus',         baseUrl: 'https://manhuaplus.top',     engineType: 'madara',        lang: 'en', isNsfw: false },
  { id: 'mangaread',     name: 'MangaRead',           baseUrl: 'https://www.mangaread.org',  engineType: 'madara',        lang: 'en', isNsfw: false },
  { id: 'harimanga',     name: 'Hari Manga',          baseUrl: 'https://harimanga.me',       engineType: 'madara',        lang: 'en', isNsfw: false },
  { id: 'anisascans',    name: 'Anisa Scans',         baseUrl: 'https://anisascans.in',      engineType: 'madara',        lang: 'en', isNsfw: false },
  { id: 'adultwebtoon',  name: 'Adult Webtoon',       baseUrl: 'https://adultwebtoon.com',   engineType: 'madara',        lang: 'en', isNsfw: true  },
  { id: 'manhwabuddy',   name: 'Manhwa Buddy',        baseUrl: 'https://manhwabuddy.com',    engineType: 'madara',        lang: 'en', isNsfw: false },
  { id: 'manhuafast',    name: 'Manhua Fast',         baseUrl: 'https://manhuafast.com',     engineType: 'madara',        lang: 'en', isNsfw: false },
  { id: 'kunmanga',      name: 'Kun Manga',           baseUrl: 'https://kunmanga.com',       engineType: 'madara',        lang: 'en', isNsfw: false },
  { id: 'topmanhua',     name: 'Top Manhua',          baseUrl: 'https://topmanhua.com',      engineType: 'madara',        lang: 'en', isNsfw: false },
  { id: 'manhwaclan',    name: 'Manhwa Clan',         baseUrl: 'https://manhwaclan.com',     engineType: 'madara',        lang: 'en', isNsfw: false },
  { id: 'atsumoe',       name: 'Atsu Moe',            baseUrl: 'https://atsu.moe',           engineType: 'madara',        lang: 'en', isNsfw: false },
  { id: 'demonicscans',  name: 'Demonic Scans',       baseUrl: 'https://demonicscans.org',   engineType: 'custom_html',   lang: 'en', isNsfw: false },
  { id: 'hiperdex',      name: 'Hiperdex',            baseUrl: 'https://hiperdex.com',       engineType: 'madara',        lang: 'en', isNsfw: true  },
  { id: 'beehentai',     name: 'BeeHentai',           baseUrl: 'https://beehentai.com',      engineType: 'madara',        lang: 'en', isNsfw: true  },
  { id: 'mangatx',       name: 'Manga TX',            baseUrl: 'https://mangatx.com',        engineType: 'madara',        lang: 'en', isNsfw: false },
  // ── Verified working MangaThemesia sources ───────────────────────────────
  { id: 'ravenscans',    name: 'Raven Scans',         baseUrl: 'https://ravenscans.net',     engineType: 'mangathemesia', lang: 'en', isNsfw: false },
  { id: 'hentai20',      name: 'Hentai20',            baseUrl: 'https://hentai20.com',       engineType: 'mangathemesia', lang: 'en', isNsfw: true  },
  // ── Custom / Special HTML sources ────────────────────────────────────────
  { id: 'hotcomics',     name: 'HotComics',           baseUrl: 'https://hotcomics.net',      engineType: 'custom_html',   lang: 'en', isNsfw: true  },
  { id: 'daycomics',     name: 'DayComics',           baseUrl: 'https://daycomics.com',      engineType: 'custom_html',   lang: 'en', isNsfw: true  },
];

export const INITIAL_DEAD_SOURCES = new Set<string>([
  // ── Confirmed dead by diagnostic probes (2026-08) ────────────────────────
  'dynasty',
  'dynastyscans',
  'immortal',
  'immortalupdates',
  'luminous',
  'luminousscans',
  'night',
  'nightscans',
  'radiant',
  'radiantscans',
  'reaper',
  'reaperscans',
  // DNS-dead / permanently offline as of 2026-08 liveness scan:
  'manhuascan',        // manhuascan.us — ENOTFOUND
  'batoto',            // bato.to      — fetch failed
  'comick',            // comick.io    — HTTP 403 / decommissioned reader
  'comickfun',         // comick.fun   — DNS dead
  'readm',             // readm.org    — timeout
  'legacy_scans',      // timeout
  'luxmanga',          // ENOTFOUND
  'scanmangavf_ws',    // timeout
]);

export const DYNAMIC_DEAD_SOURCES = new Set<string>();
export const ALL_DEAD_SOURCES = new Set<string>();
export const disabledSourceIds = new Set<string>();

export function rebuildDeadSourcesSet(syncConfig?: DatabaseSyncConfig) {
  ALL_DEAD_SOURCES.clear();
  INITIAL_DEAD_SOURCES.forEach((s) => ALL_DEAD_SOURCES.add(s.toLowerCase()));
  DYNAMIC_DEAD_SOURCES.forEach((s) => ALL_DEAD_SOURCES.add(s.toLowerCase()));
  if (Array.isArray(syncConfig?.removedSources)) {
    syncConfig.removedSources.forEach((s: string) => ALL_DEAD_SOURCES.add(s.toLowerCase()));
  }
}

export function syncDeadSourcesToDisabled() {
  for (const deadId of ALL_DEAD_SOURCES) {
    disabledSourceIds.add(deadId);
  }
}

// Helper: Check if a source is alive / active
export function isSourceAlive(sourceNameOrId: string, syncConfig?: DatabaseSyncConfig): boolean {
  if (!sourceNameOrId) return false;
  const normalized = sourceNameOrId.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (Array.isArray(syncConfig?.reactivatedSources)) {
    for (const revived of syncConfig.reactivatedSources) {
      if (((revived || '').toLowerCase().replace(/[^a-z0-9]/g, '')) === normalized) {
        return true;
      }
    }
  }
  for (const dead of ALL_DEAD_SOURCES) {
    const normDead = dead.replace(/[^a-z0-9]/g, '');
    if (normalized.includes(normDead) || normDead.includes(normalized)) {
      return false;
    }
  }
  return true;
}

export function isMetadataOnlySource(idOrName: string, url?: string): boolean {
  return (
    (idOrName || '').toLowerCase() === 'mangadex' ||
    (idOrName || '').toLowerCase().includes('mangadex') ||
    isMangaDexSourceLink(idOrName, url)
  );
}

// Master Source Registry loaded from catalog.json
export const ALL_SOURCES_CATALOG: SourceDefinition[] = [];
export const SOURCE_MAP = new Map<string, SourceDefinition>();

export function loadSourcesCatalog(): SourceDefinition[] {
  ALL_SOURCES_CATALOG.length = 0;
  SOURCE_MAP.clear();

  const candidates = [
    path.join(__dirname, 'catalog.json'),
    path.join(process.cwd(), 'server', 'sources', 'catalog.json'),
    path.join(process.cwd(), 'dist-server', 'catalog.json'),
  ];

  let rawData: string | null = null;
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        rawData = fs.readFileSync(p, 'utf-8');
        break;
      } catch {
        /* try next candidate */
      }
    }
  }

  if (rawData) {
    try {
      const parsed: SourceDefinition[] = JSON.parse(rawData);
      if (Array.isArray(parsed) && parsed.length > 0) {
        ALL_SOURCES_CATALOG.push(...parsed);
      }
    } catch (e) {
      console.warn('[Sources Catalog] Failed to parse catalog.json, using defaults:', (e as Error).message);
    }
  }

  // If no external catalog, fall back to defaults
  if (ALL_SOURCES_CATALOG.length === 0) {
    ALL_SOURCES_CATALOG.push(...DEFAULT_PRIMARY_SOURCES);
  }

  // Ensure all primary curated sources exist in catalog
  for (const def of DEFAULT_PRIMARY_SOURCES) {
    if (!ALL_SOURCES_CATALOG.some((s) => s.id === def.id)) {
      ALL_SOURCES_CATALOG.push(def);
    }
  }

  // Populate fast-lookup Map
  for (const s of ALL_SOURCES_CATALOG) {
    SOURCE_MAP.set(s.id.toLowerCase(), s);
  }

  return ALL_SOURCES_CATALOG;
}

// Initialize catalog immediately on module load
loadSourcesCatalog();
rebuildDeadSourcesSet();
syncDeadSourcesToDisabled();

// Export alias KOTATSU_SOURCES for backwards compatibility across codebase
export const KOTATSU_SOURCES = ALL_SOURCES_CATALOG;

export function getAllSourcesWithExtensions(): SourceDefinition[] {
  try {
    const { extensionEngine } = require('./extensionEngine');
    const dynamicSources = extensionEngine.toSourceDefinitions();
    return [...ALL_SOURCES_CATALOG, ...dynamicSources];
  } catch {
    return ALL_SOURCES_CATALOG;
  }
}

export function getSourceById(sourceId: string): SourceDefinition | undefined {
  if (!sourceId) return undefined;
  const found = SOURCE_MAP.get(sourceId.toLowerCase());
  if (found) return found;

  try {
    const { extensionEngine } = require('./extensionEngine');
    const ext = extensionEngine.getExtensionById(sourceId);
    if (ext && ext.enabled) {
      return {
        id: ext.id,
        name: ext.name,
        baseUrl: ext.baseUrl,
        engineType: 'custom_html',
        lang: ext.lang,
        isNsfw: ext.isNsfw,
      };
    }
  } catch {}
  return undefined;
}

export function ensureSourceInRegistry(sourceId: string): SourceDefinition | null {
  if (!sourceId) return null;
  const id = String(sourceId).toLowerCase();
  const existing = SOURCE_MAP.get(id);
  if (existing) {
    if (!ALL_SOURCES_CATALOG.some((s) => s.id === existing.id)) {
      ALL_SOURCES_CATALOG.push(existing);
    }
    return existing;
  }
  return null;
}

export interface FullSourceInventoryItem extends SourceDefinition {
  isMetadataOnly: boolean;
  isEnabled: boolean;
  status: 'active' | 'disabled' | 'removed' | 'metadata';
}

export function buildFullSourceInventory(syncConfig?: DatabaseSyncConfig): FullSourceInventoryItem[] {
  const ids = new Set<string>();
  const inventory: FullSourceInventoryItem[] = [];
  const removedSet = new Set((syncConfig?.removedSources || []).map((r) => String(r).toLowerCase()));
  const revivedSet = new Set((syncConfig?.reactivatedSources || []).map((r) => String(r).toLowerCase()));
  const disabledSet = new Set([
    ...Array.from(disabledSourceIds).map((d) => d.toLowerCase()),
    ...(syncConfig?.disabledSources || []).map((d) => String(d).toLowerCase()),
  ]);

  const pushIfMissing = (s: SourceDefinition, state: 'active' | 'disabled' | 'removed') => {
    if (ids.has(s.id)) return;
    ids.add(s.id);
    const isMeta = isMetadataOnlySource(s.id, s.baseUrl);
    inventory.push({
      ...s,
      isMetadataOnly: isMeta,
      isEnabled: state === 'active' && !isMeta,
      status: isMeta ? 'metadata' : state,
    });
  };

  for (const s of ALL_SOURCES_CATALOG) {
    const isRemoved = removedSet.has(s.id) && !revivedSet.has(s.id);
    const state = isRemoved ? 'removed' : disabledSet.has(s.id.toLowerCase()) ? 'disabled' : 'active';
    pushIfMissing(s, state);
  }

  for (const id of removedSet) {
    if (ids.has(id)) continue;
    if (revivedSet.has(id)) continue;
    const src = ensureSourceInRegistry(id);
    if (src) {
      pushIfMissing(src, 'removed');
    } else if (id !== 'mangadex') {
      ids.add(id);
      inventory.push({
        id,
        name: id,
        baseUrl: '',
        engineType: 'custom_html' as SourceEngineType,
        lang: 'en',
        isNsfw: false,
        isMetadataOnly: false,
        isEnabled: false,
        status: 'removed',
      });
    }
  }

  return inventory;
}

// ---------------------------------------------------------------------------
// SOURCE_REGISTRY — Jellyfin-inspired plugin registry
//
// Maps source ID → IMangaSource adapter.
// Each entry wraps the existing fetch functions in the IMangaSource contract.
// Adding a new source = add one entry here; zero merge-engine changes needed.
//
// Confidence levels (mirrors Jellyfin provider ordering):
//   90 — dedicated JSON API (MangaDex, Asura)   — most accurate metadata
//   80 — WeebCentral (has good HTML metadata)
//   70 — generic HTML scrapers (default)
//   60 — metadata-only sources
// ---------------------------------------------------------------------------

import type { IMangaSource } from './IMangaSource';

/**
 * Lightweight adapter for sources that are registered in ALL_SOURCES_CATALOG
 * but do not have a dedicated scraper module.  Provides the IMangaSource
 * contract with sane defaults so the registry is always fully populated.
 */
class GenericSourceAdapter implements IMangaSource {
  readonly metadataConfidence: number;
  readonly isMetadataOnly: boolean;

  constructor(
    readonly id: string,
    readonly name: string,
    opts: { metadataConfidence?: number; isMetadataOnly?: boolean } = {},
  ) {
    this.metadataConfidence = opts.metadataConfidence ?? 70;
    this.isMetadataOnly = opts.isMetadataOnly ?? false;
  }
}

/**
 * Central registry of all known sources.
 *
 * Usage:
 *   import { SOURCE_REGISTRY } from './sourcesCatalog';
 *   const src = SOURCE_REGISTRY['weebcentral'];
 *   if (src?.getMetadata) { ... }
 */
export const SOURCE_REGISTRY: Record<string, IMangaSource> = {
  // ── Metadata API sources (MangaDex) ────────────────────────────────────────
  mangadex: new GenericSourceAdapter('mangadex', 'MangaDex API v5', {
    metadataConfidence: 90,
    isMetadataOnly: true,
  }),

  // ── Dedicated API scrapers ──────────────────────────────────────────────────
  asurascans: new GenericSourceAdapter('asurascans', 'Asura Scans', {
    metadataConfidence: 90,
    isMetadataOnly: false,
  }),

  // ── HTML scrapers with good metadata ───────────────────────────────────────
  weebcentral: new GenericSourceAdapter('weebcentral', 'Weeb Central', {
    metadataConfidence: 80,
    isMetadataOnly: false,
  }),

  flamecomics: new GenericSourceAdapter('flamecomics', 'Flame Comics', {
    metadataConfidence: 75,
    isMetadataOnly: false,
  }),

  mangaread: new GenericSourceAdapter('mangaread', 'MangaRead', {
    metadataConfidence: 85,
    isMetadataOnly: false,
  }),

  manhuaplus: new GenericSourceAdapter('manhuaplus', 'Manhua Plus', {
    metadataConfidence: 85,
    isMetadataOnly: false,
  }),

  manhuaplusorg: new GenericSourceAdapter('manhuaplusorg', 'ManhuaPlus.org', {
    metadataConfidence: 85,
    isMetadataOnly: false,
  }),

  demonicscans: new GenericSourceAdapter('demonicscans', 'Demonic Scans', {
    metadataConfidence: 80,
    isMetadataOnly: false,
  }),

  aquamanga: new GenericSourceAdapter('aquamanga', 'Aqua Manga', {
    metadataConfidence: 80,
    isMetadataOnly: false,
  }),

  kunmanga: new GenericSourceAdapter('kunmanga', 'Kun Manga', {
    metadataConfidence: 80,
    isMetadataOnly: false,
  }),
};

/**
 * Register or update a source in SOURCE_REGISTRY at runtime.
 * Called automatically when a new source is added to ALL_SOURCES_CATALOG.
 */
export function registerSource(source: IMangaSource): void {
  SOURCE_REGISTRY[source.id] = source;
}

/**
 * Look up a registered IMangaSource by id (case-insensitive).
 * Returns undefined when no adapter has been registered for that id.
 */
export function getRegisteredSource(sourceId: string): IMangaSource | undefined {
  return SOURCE_REGISTRY[String(sourceId).toLowerCase()];
}

/**
 * Return the metadata confidence score for a given source id.
 * Falls back to 70 (generic HTML default) when the source is not registered.
 */
export function getSourceMetadataConfidence(sourceId: string): number {
  return getRegisteredSource(sourceId)?.metadataConfidence ?? 70;
}

/**
 * Check if a given series belongs to a disabled source using O(1) SOURCE_MAP lookups.
 */
export function isSeriesFromDisabledSource(m: MangaItem): boolean {
  if (disabledSourceIds.size === 0) return false;

  const sName = (m.sourceName || '').toLowerCase();
  const sUrl = (m.sourceUrl || '').toLowerCase();

  for (const disabledId of disabledSourceIds) {
    const sourceDef = getSourceById(disabledId);
    if (!sourceDef) continue;

    const sourceNameLower = sourceDef.name.toLowerCase();
    const sourceIdLower = sourceDef.id.toLowerCase();
    const baseDomain = sourceDef.baseUrl.replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase();

    // Check if series belongs to this disabled source
    const matchesName = sName.includes(sourceIdLower) || sName.includes(sourceNameLower);
    const matchesUrl = sUrl && (sUrl.includes(sourceIdLower) || sUrl.includes(baseDomain));

    if (matchesName || matchesUrl) {
      // MangaDex API fallback exception: if MangaDex is enabled and item has apiId, keep it!
      const mangadexIsEnabled = !disabledSourceIds.has('mangadex');
      if (mangadexIsEnabled && (m.apiId || m.id.startsWith('md_') || (m.syncedFromApi && m.syncedFromApi.includes('MangaDex')))) {
        return false;
      }
      return true;
    }
  }

  return false;
}


