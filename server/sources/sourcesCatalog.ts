import fs from 'fs';
import path from 'path';
import { SourceDefinition, SourceEngineType, DatabaseSyncConfig, isMangaDexSourceLink } from '../../src/types';

// Curated active fallback sources in case catalog.json is unavailable
const DEFAULT_PRIMARY_SOURCES: SourceDefinition[] = [
  { id: 'mangadex', name: 'MangaDex API v5', baseUrl: 'https://mangadex.org', engineType: 'mangadex', lang: 'en', isNsfw: false },
  { id: 'asurascans', name: 'Asura Scans', baseUrl: 'https://asurascans.com', engineType: 'mangathemesia', lang: 'en', isNsfw: false },
  { id: 'flamecomics', name: 'Flame Comics', baseUrl: 'https://flamecomics.xyz', engineType: 'mangathemesia', lang: 'en', isNsfw: false },
  { id: 'batoto', name: 'Bato.to', baseUrl: 'https://bato.to', engineType: 'custom_html', lang: 'en', isNsfw: false },
  { id: 'comickfun', name: 'ComickFun', baseUrl: 'https://comick.fun', engineType: 'custom_html', lang: 'en', isNsfw: false },
  { id: 'comick', name: 'ComicK', baseUrl: 'https://comick.io', engineType: 'custom_html', lang: 'en', isNsfw: false },
  { id: 'readm', name: 'ReadM', baseUrl: 'https://readm.org', engineType: 'custom_html', lang: 'en', isNsfw: false },
  { id: 'manhwa18', name: 'Manhwa18', baseUrl: 'https://manhwa18.com', engineType: 'madara', lang: 'en', isNsfw: true },
  { id: 'manhwa18cc', name: 'Manhwa18.cc', baseUrl: 'https://manhwa18.cc', engineType: 'madara', lang: 'en', isNsfw: true },
  { id: 'aquamanga', name: 'Aqua Manga', baseUrl: 'https://aquareader.net', engineType: 'madara', lang: 'en', isNsfw: false },
  { id: 'manhuaplus', name: 'Manhua Plus', baseUrl: 'https://manhuaplus.com', engineType: 'madara', lang: 'en', isNsfw: false },
  { id: 'manhuaplusorg', name: 'ManhuaPlus.org', baseUrl: 'https://manhuaplus.org', engineType: 'madara', lang: 'en', isNsfw: false },
  { id: 'harimanga', name: 'Hari Manga', baseUrl: 'https://harimanga.me', engineType: 'madara', lang: 'en', isNsfw: false },
  { id: 'anisascans', name: 'Anisa Scans', baseUrl: 'https://anisascans.in', engineType: 'madara', lang: 'en', isNsfw: false },
  { id: 'adultwebtoon', name: 'Adult Webtoon', baseUrl: 'https://adultwebtoon.com', engineType: 'madara', lang: 'en', isNsfw: true },
  { id: 'mangaread', name: 'MangaRead', baseUrl: 'https://www.mangaread.org', engineType: 'madara', lang: 'en', isNsfw: false },
  { id: 'manhwabuddy', name: 'Manhwa Buddy', baseUrl: 'https://manhwabuddy.com', engineType: 'madara', lang: 'en', isNsfw: false },
  { id: 'manhuafast', name: 'Manhua Fast', baseUrl: 'https://manhuafast.com', engineType: 'madara', lang: 'en', isNsfw: false },
  { id: 'kunmanga', name: 'Kun Manga', baseUrl: 'https://kunmanga.com', engineType: 'madara', lang: 'en', isNsfw: false },
  { id: 'topmanhua', name: 'Top Manhua', baseUrl: 'https://topmanhua.com', engineType: 'madara', lang: 'en', isNsfw: false },
  { id: 'manhwaclan', name: 'Manhwa Clan', baseUrl: 'https://manhwaclan.com', engineType: 'madara', lang: 'en', isNsfw: false },
  { id: 'weebcentral', name: 'Weeb Central', baseUrl: 'https://weebcentral.com', engineType: 'madara', lang: 'en', isNsfw: false },
  { id: 'atsumoe', name: 'Atsu Moe', baseUrl: 'https://atsu.moe', engineType: 'madara', lang: 'en', isNsfw: false },
  { id: 'demonicscans', name: 'Demonic Scans', baseUrl: 'https://demonicscans.org', engineType: 'madara', lang: 'en', isNsfw: false },
  { id: 'beehentai', name: 'BeeHentai', baseUrl: 'https://beehentai.com', engineType: 'madara', lang: 'en', isNsfw: true },
  { id: 'manhuascan', name: 'ManhuaScan', baseUrl: 'https://manhuascan.us', engineType: 'mangathemesia', lang: 'en', isNsfw: true },
  { id: 'ravenscans', name: 'Raven Scans', baseUrl: 'https://ravenscans.com', engineType: 'mangathemesia', lang: 'en', isNsfw: false },
  { id: 'luminous', name: 'Luminous Scans', baseUrl: 'https://luminousscans.com', engineType: 'mangathemesia', lang: 'en', isNsfw: false },
  { id: 'night', name: 'Night Scans', baseUrl: 'https://nightscans.com', engineType: 'mangathemesia', lang: 'en', isNsfw: false },
  { id: 'hentai20', name: 'Hentai20', baseUrl: 'https://hentai20.com', engineType: 'mangathemesia', lang: 'en', isNsfw: true },
  { id: 'hotcomics', name: 'HotComics', baseUrl: 'https://hotcomics.net', engineType: 'custom_html', lang: 'en', isNsfw: true },
  { id: 'daycomics', name: 'DayComics', baseUrl: 'https://daycomics.com', engineType: 'custom_html', lang: 'en', isNsfw: true },
  { id: 'mangatx', name: 'Manga TX', baseUrl: 'https://mangatx.com', engineType: 'madara', lang: 'en', isNsfw: false },
];

export const INITIAL_DEAD_SOURCES = new Set<string>([
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

export function getSourceById(sourceId: string): SourceDefinition | undefined {
  if (!sourceId) return undefined;
  return SOURCE_MAP.get(sourceId.toLowerCase());
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
