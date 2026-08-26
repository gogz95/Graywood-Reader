// ============================================================================
// Crawler Engine Source Registry
// Maps hosts to parser engines (Madara, WPComics, MangaThemesia, Custom, etc.)
// ============================================================================

import { EngineSourceConfig, DOMAIN_MIRRORS } from './types';
import { ALL_SOURCES_CATALOG } from '../../sources/sourcesCatalog';

export const CURATED_ENGINE_SOURCES: EngineSourceConfig[] = [
  { id: 'manhwa18', name: 'Manhwa18', domain: 'manhwa18.com', engine: 'manhwa18', lang: 'en', isNsfw: true },
  { id: 'manhwa18cc', name: 'Manhwa18.cc', domain: 'manhwa18.cc', engine: 'manhwa18cc', lang: 'en', isNsfw: true },
  { id: 'aquamanga', name: 'Aqua Manga', domain: 'aquareader.org', engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'manhuaplus', name: 'Manhua Plus', domain: 'manhuaplus.top', engine: 'wpcomics', lang: 'en', isNsfw: false },
  { id: 'manhuaplusorg', name: 'ManhuaPlus.org', domain: 'manhuaplus.top', engine: 'wpcomics', lang: 'en', isNsfw: false },
  { id: 'harimanga', name: 'Hari Manga', domain: 'harimanga.com', engine: 'madara', lang: 'en', isNsfw: false, madaraWithoutAjax: true, madaraPageSize: 10 },
  { id: 'anisascans', name: 'Anisa Scans', domain: 'anisascans.in', engine: 'madara', lang: 'en', isNsfw: false, madaraDatePattern: 'dd MMM, yyyy' },
  { id: 'mangaread', name: 'MangaRead', domain: 'www.mangaread.org', engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'manhwabuddy', name: 'Manhwa Buddy', domain: 'manhwabuddy.com', engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'manhuafast', name: 'Manhua Fast', domain: 'manhuafast.com', engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'kunmanga', name: 'Kun Manga', domain: 'kunmanga.com', engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'topmanhua', name: 'Top Manhua', domain: 'topmanhua.com', engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'manhwaclan', name: 'Manhwa Clan', domain: 'manhwaclan.com', engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'weebcentral', name: 'Weeb Central', domain: 'weebcentral.com', engine: 'custom', lang: 'en', isNsfw: false },
  { id: 'asurascans', name: 'Asura Scans', domain: 'asurascans.com', engine: 'custom', lang: 'en', isNsfw: false },
  { id: 'flamecomics', name: 'Flame Comics', domain: 'flamecomics.xyz', engine: 'custom', lang: 'en', isNsfw: false },
  { id: 'dynasty', name: 'Dynasty Scans', domain: 'dynasty-scans.com', engine: 'custom', lang: 'en', isNsfw: false },
  { id: 'hotcomics', name: 'HotComics', domain: 'hotcomics.net', engine: 'hotcomics', lang: 'en', isNsfw: true },
  { id: 'daycomics', name: 'DayComics', domain: 'daycomics.com', engine: 'custom', lang: 'en', isNsfw: true },
  { id: 'atsumoe', name: 'Atsu Moe', domain: 'atsu.moe', engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'demonicscans', name: 'Demonic Scans', domain: 'demonicscans.org', engine: 'custom', lang: 'en', isNsfw: false },
  { id: 'hiperdex', name: 'Hiperdex', domain: 'hiperdex.com', engine: 'madara', lang: 'en', isNsfw: true },
  { id: 'beehentai', name: 'ToonTop', domain: 'toontop.io', engine: 'madara', lang: 'en', isNsfw: true },
  { id: 'mangatx', name: 'Manga TX', domain: 'mangatx.com', engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'mangacute', name: 'MangaCute', domain: 'mangacute.com', engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'mangaxyz', name: 'Mangaxyz', domain: 'mangaxyz.com', engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'mangabuddy', name: 'MangaBuddy', domain: 'mangabuddy.com', engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'arvenscans', name: 'Arven Scans', domain: 'arvencomics.com', engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'ravenscans', name: 'Raven Scans', domain: 'ravenscans.net', engine: 'mangathemesia', lang: 'en', isNsfw: false },
  { id: 'hentai20', name: 'Hentai20', domain: 'hentai20.io', engine: 'mangathemesia', lang: 'en', isNsfw: true },
];

export const ENGINE_SOURCE_REGISTRY: EngineSourceConfig[] = [...CURATED_ENGINE_SOURCES];
const curatedEngineIds = new Set(CURATED_ENGINE_SOURCES.map((s) => s.id));

export function domainFromBaseUrl(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname.replace(/^www\./, '');
  } catch {
    return baseUrl.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
  }
}

export function isPlausibleHost(d: string): boolean {
  if (!d || d.length < 4 || d.length > 253) return false;
  if (d.includes('_') || d.includes(' ') || d.includes('/') || d.includes('..')) return false;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(d)) return false;
  const tld = d.split('.').pop() || '';
  if (tld.length < 2 || tld.length > 24 || /^\d+$/.test(tld)) return false;
  return true;
}

export function syncEngineRegistryFromCatalog(): void {
  const catalog = ALL_SOURCES_CATALOG;
  const SCRAPER_ONLY_IDS = new Set(['asurascans', 'flamecomics', 'mangadex']);
  let added = 0;
  for (const src of catalog) {
    if (curatedEngineIds.has(src.id)) continue;
    if (SCRAPER_ONLY_IDS.has(src.id)) continue;
    const domain = domainFromBaseUrl(src.baseUrl);
    if (!domain || !isPlausibleHost(domain)) continue;
    if (src.engineType === 'madara') {
      ENGINE_SOURCE_REGISTRY.push({
        id: src.id,
        name: src.name,
        domain,
        engine: 'madara',
        lang: src.lang,
        isNsfw: src.isNsfw,
      });
      added++;
    } else if (src.engineType === 'mangathemesia') {
      ENGINE_SOURCE_REGISTRY.push({
        id: src.id,
        name: src.name,
        domain,
        engine: 'mangathemesia',
        lang: src.lang,
        isNsfw: src.isNsfw,
        madaraSelectTestAsync: 'div.eplister',
        madaraSelectChapter: 'div.eplister ul li',
        madaraSelectBodyPage: 'div#readerarea',
      });
      added++;
    } else if (src.engineType === 'wpcomics') {
      ENGINE_SOURCE_REGISTRY.push({
        id: src.id,
        name: src.name,
        domain,
        engine: 'wpcomics',
        lang: src.lang,
        isNsfw: src.isNsfw,
      });
      added++;
    } else if (src.engineType === 'foolslide') {
      ENGINE_SOURCE_REGISTRY.push({
        id: src.id,
        name: src.name,
        domain,
        engine: 'foolslide',
        lang: src.lang,
        isNsfw: src.isNsfw,
      });
      added++;
    } else if (src.engineType === 'custom_html') {
      ENGINE_SOURCE_REGISTRY.push({
        id: src.id,
        name: src.name,
        domain,
        engine: 'custom',
        lang: src.lang,
        isNsfw: src.isNsfw,
      });
      added++;
    }
  }
  if (added > 0) {
    console.log(`[Source Engine] Dynamic registry expanded by ${added} catalog sources (total: ${ENGINE_SOURCE_REGISTRY.length})`);
  }
}

export function getEngineConfig(domainOrUrl: string): EngineSourceConfig | undefined {
  const norm = domainOrUrl.toLowerCase().trim();
  let domain = norm.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  if (DOMAIN_MIRRORS[domain]) {
    domain = DOMAIN_MIRRORS[domain];
  }
  return ENGINE_SOURCE_REGISTRY.find(
    (cfg) => cfg.domain.toLowerCase() === domain || domain.endsWith('.' + cfg.domain.toLowerCase())
  );
}

export function matchLiveDomain(url: string, targetDomain?: string): any {
  if (!url) return undefined;
  if (targetDomain) {
    try {
      const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
      const canonicalTarget = (DOMAIN_MIRRORS[targetDomain.toLowerCase()] || targetDomain.toLowerCase()).replace(/^www\./, '');
      const canonicalHost = DOMAIN_MIRRORS[host] || host;
      return canonicalHost === canonicalTarget || canonicalHost.endsWith('.' + canonicalTarget);
    } catch {
      return false;
    }
  }
  return getEngineConfig(url);
}

export function getLiveDomains(targetDomain: string): string[] {
  const norm = (targetDomain || '').toLowerCase().trim().replace(/^www\./, '');
  const canonical = DOMAIN_MIRRORS[norm] || norm;
  const set = new Set<string>([canonical]);
  for (const [mirror, target] of Object.entries(DOMAIN_MIRRORS)) {
    if (target.toLowerCase() === canonical) set.add(mirror);
  }
  return Array.from(set);
}

export function matchResolvedChapter(chapters: { number: number; url: string; title: string; slug?: string }[], targetNumber: number) {
  if (!chapters || chapters.length === 0) return undefined;
  const exact = chapters.find((c) => Math.abs(c.number - targetNumber) < 0.001);
  if (exact) return exact;
  const targetInt = Math.floor(targetNumber);
  const intMatch = chapters.find((c) => Math.floor(c.number) === targetInt);
  if (intMatch) return intMatch;
  return undefined;
}

export function normalizeLiveTargetUrl(url: string): string {
  if (!url) return '';
  let u = url.trim();
  for (const [mirror, target] of Object.entries(DOMAIN_MIRRORS)) {
    if (u.includes(`://${mirror}`) || u.includes(`://www.${mirror}`)) {
      u = u.replace(`://${mirror}`, `://${target}`).replace(`://www.${mirror}`, `://${target}`);
      break;
    }
  }
  return u;
}

// Auto-sync registry on load
syncEngineRegistryFromCatalog();
