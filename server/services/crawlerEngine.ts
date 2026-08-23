// ============================================================================
// CRAWLER & SCRAPER ENGINE SERVICE
// Multi-source chapter list parsing, image extraction, and engine registry
// ============================================================================

import * as cheerio from 'cheerio';
import { MangaItem } from '../../src/types';
import { SqliteDb } from '../../sqlite-db';
import {
  mangaDatabase,
  appSettings,
  saveDatabaseToDisk,
  syncAddOrUpdateManga,
} from '../appState';
import { fetchWithChallengeBypass } from '../captchaSolver';
import { sourceCircuitBreaker } from '../circuitBreaker';
import { isAdImageSrc } from '../adFilter';
import {
  KOTATSU_SOURCES,
  ALL_SOURCES_CATALOG,
  disabledSourceIds,
  isSourceAlive,
} from '../sources/sourcesCatalog';
import {
  sourceCookieJar,
  updateSourceHealth,
} from './sourceHealthService';
import { calculateStringSimilarity } from './metadataService';
import {
  fetchWeebCentralChapterPages,
  fetchWeebCentralChapterList,
  searchWeebCentral,
} from '../scrapers/weebCentral';
import {
  fetchAsuraChapterList,
  ASURA_API_HEADERS,
} from '../scrapers/asuraScans';
import {
  fetchFlameSeriesContext,
  fetchFlameChapterList,
  mapFlameChapters,
} from '../scrapers/flameComics';

export interface ResolvedChapter {
  number: number;
  id: string;
  slug: string;
  title: string;
  url: string;
  pageCount: number;
}

export type SourceEngine = 'madara' | 'manhwa18' | 'mangareader' | 'hotcomics' | 'custom' | 'foolslide';

export interface EngineSourceConfig {
  id: string;
  name: string;
  domain: string;
  engine: SourceEngine;
  lang: string;
  isNsfw: boolean;
  madaraDatePattern?: string;
  madaraPageSize?: number;
  madaraWithoutAjax?: boolean;
  madaraSelectTestAsync?: string;
  madaraSelectChapter?: string;
  madaraSelectBodyPage?: string;
  madaraPostReq?: boolean;
  chapterListSelector?: string;
  chapterPageSelector?: string;
  catalogPath?: string;
}

export const DOMAIN_MIRRORS: Record<string, string> = {
  'asuracomic.net': 'asurascans.com',
  'asurascans.org': 'asurascans.com',
  'asura.gg': 'asurascans.com',
  'flamescans.org': 'flamecomics.xyz',
  'flamecomics.com': 'flamecomics.xyz',
  'manhwa18.net': 'manhwa18.com',
  'manhwa18.org': 'manhwa18.com',
  'manhwa18.cc': 'manhwa18.cc',
  'mangatx.to': 'mangatx.com',
  'mangatx.unblockit.ch': 'mangatx.com',
  'manhuaplus.org': 'manhuaplus.top',
  'manhuaplus.com': 'manhuaplus.top',
};

export const UA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
};

export const CURATED_ENGINE_SOURCES: EngineSourceConfig[] = [
  { id: 'manhwa18', name: 'Manhwa18', domain: 'manhwa18.com', engine: 'manhwa18', lang: 'en', isNsfw: true },
  {
    id: 'manhwa18cc', name: 'Manhwa18.cc', domain: 'manhwa18.cc', engine: 'madara', lang: 'en', isNsfw: true,
    madaraSelectTestAsync: 'ul.row-content-chapter', madaraSelectChapter: 'li.a-h', madaraSelectBodyPage: 'div.read-content',
  },
  { id: 'aquamanga', name: 'Aqua Manga', domain: 'aquareader.org', engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'manhuaplus', name: 'Manhua Plus', domain: 'manhuaplus.top', engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'manhuaplusorg', name: 'ManhuaPlus.org', domain: 'manhuaplus.top', engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'harimanga', name: 'Hari Manga', domain: 'harimanga.me', engine: 'madara', lang: 'en', isNsfw: false, madaraPageSize: 10 },
  { id: 'anisascans', name: 'Anisa Scans', domain: 'anisascans.in', engine: 'madara', lang: 'en', isNsfw: false, madaraDatePattern: 'dd MMM, yyyy' },
  { id: 'adultwebtoon', name: 'Adult Webtoon', domain: 'adultwebtoon.com', engine: 'madara', lang: 'en', isNsfw: true },
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
  { id: 'beehentai', name: 'BeeHentai', domain: 'beehentai.com', engine: 'madara', lang: 'en', isNsfw: true },
  { id: 'mangatx', name: 'Manga TX', domain: 'mangatx.com', engine: 'madara', lang: 'en', isNsfw: false },
  { id: 'ravenscans', name: 'Raven Scans', domain: 'ravenscans.net', engine: 'mangareader', lang: 'en', isNsfw: false },
  { id: 'hentai20', name: 'Hentai20', domain: 'hentai20.com', engine: 'mangareader', lang: 'en', isNsfw: true },
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
        id: src.id, name: src.name, domain, engine: 'madara',
        lang: src.lang, isNsfw: src.isNsfw,
      });
      added++;
    } else if (src.engineType === 'mangathemesia') {
      ENGINE_SOURCE_REGISTRY.push({
        id: src.id, name: src.name, domain, engine: 'mangareader',
        lang: src.lang, isNsfw: src.isNsfw,
        madaraSelectTestAsync: 'div.eplister',
        madaraSelectChapter: 'div.eplister ul li',
        madaraSelectBodyPage: 'div#readerarea',
      });
      added++;
    } else if (src.engineType === 'wpcomics') {
      ENGINE_SOURCE_REGISTRY.push({
        id: src.id, name: src.name, domain, engine: 'madara',
        lang: src.lang, isNsfw: src.isNsfw,
      });
      added++;
    } else if (src.engineType === 'foolslide') {
      ENGINE_SOURCE_REGISTRY.push({
        id: src.id, name: src.name, domain, engine: 'foolslide',
        lang: src.lang, isNsfw: src.isNsfw,
      });
      added++;
    } else if (src.engineType === 'custom_html') {
      ENGINE_SOURCE_REGISTRY.push({
        id: src.id, name: src.name, domain, engine: 'custom',
        lang: src.lang, isNsfw: src.isNsfw,
      });
      added++;
    }
  }
  if (added > 0) {
    console.log(`[Engine Registry] Auto-registered ${added} sources from catalog. Total: ${ENGINE_SOURCE_REGISTRY.length}`);
  }
}

export function buildLiveDomainsFromRegistry(): { id: string; domain: string; name: string }[] {
  return ENGINE_SOURCE_REGISTRY.map((e) => ({ id: e.id, domain: e.domain, name: e.name }));
}

export function getLiveDomains(): { id: string; domain: string; name: string }[] {
  return buildLiveDomainsFromRegistry();
}

export function matchLiveDomain(url: string): { id: string; domain: string; name: string } | undefined {
  const lower = (url || '').toLowerCase();
  let best: { id: string; domain: string; name: string } | undefined;
  for (const d of getLiveDomains()) {
    if (lower.includes(d.domain.toLowerCase())) {
      if (!best || d.domain.length > best.domain.length) best = d;
    }
  }
  return best;
}

export function getEngineConfig(domainId: string): EngineSourceConfig | undefined {
  return ENGINE_SOURCE_REGISTRY.find((s) => s.id === domainId);
}

export function normalizeAsuraPageList(rawPages: unknown): string[] {
  if (!Array.isArray(rawPages)) return [];
  const out: string[] = [];
  for (const p of rawPages) {
    let url = '';
    if (typeof p === 'string') url = p.trim();
    else if (p && typeof p === 'object') {
      const o = p as Record<string, unknown>;
      url = String(o.url || o.src || o.image || o.path || '').trim();
    }
    if (!url) continue;
    if (url.startsWith('//')) url = 'https:' + url;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = url.startsWith('/') ? `https://gg.asuracomic.net${url}` : `https://gg.asuracomic.net/${url}`;
    }
    out.push(url);
  }
  return Array.from(new Set(out));
}

export function matchResolvedChapter(chapters: ResolvedChapter[], chapterNumber: number): ResolvedChapter | undefined {
  const exact = chapters.find((c) => c.number === chapterNumber);
  if (exact) return exact;
  const rx = new RegExp(`(?:^|[_-]|ch(?:apter)?[_-]?)${chapterNumber}(?:$|[_.-])`, 'i');
  return chapters.find((c) => c.slug && rx.test(c.slug));
}

export function normalizeLiveTargetUrl(rawTargetUrl: string): string {
  let targetUrl = (rawTargetUrl || '').trim();
  if (!targetUrl) return targetUrl;
  for (const [oldDomain, newDomain] of Object.entries(DOMAIN_MIRRORS)) {
    if (targetUrl.includes(oldDomain)) {
      targetUrl = targetUrl.replace(new RegExp(oldDomain.replace(/\./g, '\\.'), 'gi'), newDomain);
      break;
    }
  }
  if (/manhwa18\.(com|net)/i.test(targetUrl)) {
    targetUrl = targetUrl
      .replace(/\/webtoon\//gi, '/manga/')
      .replace(/\/read\//gi, '/manga/')
      .replace(/\/manhwa\//gi, '/manga/');
  }
  targetUrl = targetUrl.replace(/\/+$/, '');
  return targetUrl;
}

export function isValidPanelImageUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  const u = url.trim();
  if (!u.startsWith('http://') && !u.startsWith('https://')) return false;
  if (/^(data:|blob:|javascript:|#)/i.test(u)) return false;
  
  if (/(logo|avatar|banner|covers|discord|tracker|pixel|top_ad|\/ads\/|\/banners\/|\/covers\/|\/avatar\/|\/tracker\/|\.gif(\?|$))/i.test(u)) return false;
  if (/doubleclick|googleadservices|pagead2|googlesyndication|adservice/i.test(u)) return false;
  if (isAdImageSrc(u, 'https://example.com')) return false;

  const isImageExt = /\.(jpg|jpeg|png|webp|avif)(\?|$)/i.test(u);
  const isCdnPath = /\/(images|uploads|manga|chapters|media|content|page|wp-content\/uploads)\//i.test(u) ||
    /cdn|img|static|imgproxy|imageproxy|upload/i.test(u);
  return isImageExt || isCdnPath;
}

export function parseSrcsetCandidate(srcset: string): string {
  if (!srcset || typeof srcset !== 'string') return '';
  const entries = srcset.split(',').map((s) => s.trim()).filter(Boolean);
  if (entries.length === 0) return '';
  const lastEntry = entries[entries.length - 1];
  const urlCandidate = lastEntry.split(/\s+/)[0] || '';
  return urlCandidate.trim();
}

export function extractPanelImages(htmlText: string, origin: string): string[] {
  if (!htmlText) return [];
  const pages: string[] = [];
  const seenUrls = new Set<string>();

  const addPage = (raw: string) => {
    let candidate = (raw || '').trim();
    if (!candidate) return;
    if (candidate.includes(',') && (candidate.includes(' 1x') || candidate.includes(' 2x') || candidate.includes('w'))) {
      candidate = parseSrcsetCandidate(candidate);
    }
    if (candidate.startsWith('//')) {
      candidate = 'https:' + candidate;
    } else if (candidate.startsWith('/')) {
      candidate = `${origin}${candidate}`;
    } else if (!candidate.startsWith('http://') && !candidate.startsWith('https://')) {
      candidate = `${origin}/${candidate}`;
    }
    if (!isValidPanelImageUrl(candidate)) return;
    const norm = candidate.toLowerCase();
    if (!seenUrls.has(norm)) {
      seenUrls.add(norm);
      pages.push(candidate);
    }
  };

  try {
    const $ = cheerio.load(htmlText);
    const containerSelectors = [
      '#chapter-content img', '.chapter-content img', '#chapter_content img',
      '#readerarea img', '.reading-content img', '.read-content img',
      '.viewer-cnt img', '#viewer img', '.page-break img', '.entry-content img',
      'div#images img', '.chapter-image img', '.vung-doc img', '.content-doc img',
      'div.separator img', 'div.separator a img',
    ];
    for (const sel of containerSelectors) {
      const nodes = $(sel).toArray();
      if (nodes.length >= 2) {
        for (const el of nodes) {
          const candidate =
            $(el).attr('data-src') ||
            $(el).attr('data-lazy-src') ||
            $(el).attr('data-cfsrc') ||
            $(el).attr('data-full-url') ||
            $(el).attr('data-original') ||
            $(el).attr('data-url') ||
            $(el).attr('data-img') ||
            $(el).attr('data-image') ||
            $(el).attr('data-page-url') ||
            $(el).attr('data-srcset') ||
            $(el).attr('srcset') ||
            $(el).attr('src') ||
            '';
          if (candidate) addPage(candidate);
        }
        if (pages.length >= 2) return pages;
      }
    }

    $('img').each((_, el) => {
      const candidate =
        $(el).attr('data-src') ||
        $(el).attr('data-lazy-src') ||
        $(el).attr('data-cfsrc') ||
        $(el).attr('data-full-url') ||
        $(el).attr('data-original') ||
        $(el).attr('data-url') ||
        $(el).attr('data-img') ||
        $(el).attr('data-image') ||
        $(el).attr('data-page-url') ||
        $(el).attr('data-srcset') ||
        $(el).attr('srcset') ||
        $(el).attr('src') ||
        '';
      if (candidate) addPage(candidate);
    });
  } catch (_) {
    const imgTagRegex = /<img\b([^>]*)>/gi;
    let tagMatch: RegExpExecArray | null;
    while ((tagMatch = imgTagRegex.exec(htmlText)) !== null) {
      const attrs = tagMatch[1];
      const attrMatch = attrs.match(/(?:data-src|data-lazy-src|data-cfsrc|data-full-url|data-original|data-url|data-img|data-image|data-page-url|data-srcset|srcset|src)=["']([^"']+)["']/i);
      if (attrMatch && attrMatch[1]) addPage(attrMatch[1]);
    }
  }

  if (pages.length < 2) {
    const tsMatch = htmlText.match(/ts_reader\.run\s*\(\s*(\{[\s\S]*?\})\s*\)/);
    if (tsMatch) {
      try {
        const obj = JSON.parse(tsMatch[1]);
        const imgs = obj?.sources?.[0]?.images;
        if (Array.isArray(imgs)) {
          for (const img of imgs) {
            if (typeof img === 'string') addPage(img);
          }
        }
      } catch (_) {}
    }

    const scriptArrayRegex = /(?:var|let|const|window\.)\s*(?:pages|images|chapter_images|chapter_data|img_list)\s*=\s*(\[[\s\S]*?\]|{[\s\S]*?})/gi;
    let arrayMatch: RegExpExecArray | null;
    while ((arrayMatch = scriptArrayRegex.exec(htmlText)) !== null) {
      try {
        const rawJson = arrayMatch[1];
        const parsed = JSON.parse(rawJson);
        const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.images) ? parsed.images : (Array.isArray(parsed?.pages) ? parsed.pages : []));
        for (const item of list) {
          if (typeof item === 'string') addPage(item);
          else if (typeof item === 'object' && item !== null) {
            const url = item.url || item.src || item.path || item.image || item.page;
            if (typeof url === 'string') addPage(url);
          }
        }
      } catch (_) {}
    }

    const scriptJsonRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
    let sMatch: RegExpExecArray | null;
    while ((sMatch = scriptJsonRegex.exec(htmlText)) !== null) {
      const code = sMatch[1]?.trim() || '';
      if (code.includes('"images"') || code.includes('"pages"') || code.includes('__NEXT_DATA__')) {
        try {
          const parsed = JSON.parse(code);
          const chImgs = parsed?.chapter?.images || parsed?.props?.pageProps?.chapter?.images || parsed?.pageProps?.chapter?.images;
          if (Array.isArray(chImgs)) {
            for (const it of chImgs) {
              if (typeof it === 'string') addPage(it);
              else if (typeof it === 'object' && it !== null && it.url) addPage(it.url);
            }
          }
        } catch (_) {}
      }
    }
  }

  return pages;
}

export function parseGenericChapterListFromHtml(sHtml: string, origin: string): ResolvedChapter[] {
  if (!sHtml) return [];
  const $ = cheerio.load(sHtml);
  const out: ResolvedChapter[] = [];
  const seen = new Set<string>();

  const candidateNodes = $('a[href], select option[value], ul.chapter-list li a, .chapters-list li a, #chapterlist li a, div.eplister li a, .row-content-chapter li a, .list-chapter .row a, .element .title a').toArray();

  const chapterRegex = /(?:chapter|chapitre|capitulo|capítulo|cap|chap|ch|episode|ep|глава|tập|tap|vol|volume|#)[^\d]*(\d+(?:\.\d+)?)/i;
  const pathNumberRegex = /\/(?:chapter|chap|ch|episode|ep)[-_/]?(\d+(?:\.\d+)?)/i;

  let autoNum = 1;
  for (const node of candidateNodes) {
    const tag = (node as any).tagName?.toLowerCase();
    const href = tag === 'option' ? ($(node).attr('value') || '') : ($(node).attr('href') || '');
    if (!href || /^(#|javascript:|mailto:|tel:)/i.test(href)) continue;
    const text = $(node).text().trim() || $(node).attr('title') || '';
    
    const numMatch = (href + ' ' + text).match(chapterRegex) || href.match(pathNumberRegex);
    if (!numMatch && !/chapter|chap|ch/i.test(href) && !/chapter|chap|ch/i.test(text)) {
      continue;
    }
    const num = numMatch ? parseFloat(numMatch[1]) : autoNum++;
    if (!Number.isFinite(num) || num <= 0) continue;

    const abs = href.startsWith('http') ? href : `${origin}${href.startsWith('/') ? '' : '/'}${href}`;
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push({ number: num, id: abs, slug: abs, title: text || `Chapter ${num}`, url: abs, pageCount: 0 });
  }
  return out;
}

export async function fetchDynastyChapterList(targetUrl: string): Promise<ResolvedChapter[]> {
  try {
    const seriesRes = await fetch(targetUrl, { headers: UA_HEADERS });
    if (!seriesRes.ok) return [];
    const html = await seriesRes.text();
    const chLinkRx = /<a[^>]+href=["'](\/chapters\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    const out: ResolvedChapter[] = [];
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = chLinkRx.exec(html)) !== null) {
      const href = m[1];
      const text = m[2].replace(/<[^>]+>/g, '').trim();
      if (!href || /added|tags|search/i.test(href)) continue;
      const numM = (href + ' ' + text).match(/(?:chapter|ch\.?|ch)[^\d]*(\d+(?:\.\d+)?)/i);
      if (!numM) continue;
      const num = parseFloat(numM[1]);
      if (!Number.isFinite(num) || num <= 0) continue;
      const abs = `https://dynasty-scans.com${href}`;
      if (seen.has(abs)) continue;
      seen.add(abs);
      out.push({ number: num, id: abs, slug: href, title: `Chapter ${num}`, url: abs, pageCount: 0 });
    }
    return out;
  } catch {
    return [];
  }
}

export async function fetchGenericChapterList(targetUrl: string): Promise<ResolvedChapter[]> {
  const origin = new URL(targetUrl).origin;
  const reqHeaders = { ...UA_HEADERS, 'Referer': origin + '/' };
  try {
    const bypassRes = await fetchWithChallengeBypass(targetUrl, {
      headers: reqHeaders,
      enableCloudflareBypass: appSettings.enableCloudflareBypass,
      flareSolverrUrl: appSettings.flareSolverrUrl,
      captchaSolverEnabled: appSettings.captchaSolverEnabled,
      captchaApiKey: appSettings.captchaApiKey,
      sourceId: origin,
      onCookieUpdate: (sid, cookies) => sourceCookieJar.setCookies(sid, cookies),
    });
    if (!bypassRes.ok || !bypassRes.html) return [];
    return parseGenericChapterListFromHtml(bypassRes.html, origin);
  } catch {
    return [];
  }
}

export async function fetchMadaraChapterList(targetUrl: string, config: EngineSourceConfig): Promise<ResolvedChapter[]> {
  if (!sourceCircuitBreaker.canAttempt(config.id)) {
    console.warn(`[Madara Engine] Fast-failing ${config.name} (circuit OPEN)`);
    return [];
  }
  const origin = new URL(targetUrl).origin;
  const headers = { ...UA_HEADERS, 'Referer': origin + '/' };

  const fetchHtml = async (url: string, postBody?: string): Promise<string | null> => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const timeout = [6000, 12000, 20000][attempt] || 6000;
        const opts: any = {
          headers: postBody
            ? { ...headers, 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' }
            : headers,
          enableCloudflareBypass: appSettings.enableCloudflareBypass,
          flareSolverrUrl: appSettings.flareSolverrUrl,
          captchaSolverEnabled: appSettings.captchaSolverEnabled,
          captchaApiKey: appSettings.captchaApiKey,
          timeoutMs: timeout,
          sourceId: config.id,
          onCookieUpdate: (sid: string, cookies: string[]) => sourceCookieJar.setCookies(sid, cookies),
        };
        if (postBody) opts.method = 'POST'; else { opts.method = 'GET'; }
        const res = postBody
          ? await fetchWithPostBypass(url, postBody, opts)
          : await fetchWithChallengeBypass(url, opts);

        if (res.ok && res.html) {
          updateSourceHealth(config.id, res.html, res.status);
          return res.html;
        }
        updateSourceHealth(config.id, null, res.status || 500);
        if (res.status === 404 || res.status === 410) {
          return null;
        }
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, [1000, 2500][attempt]));
        }
      } catch (err: any) {
        updateSourceHealth(config.id, null, 0, err?.message);
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, [1000, 2500][attempt]));
        }
      }
    }
    return null;
  };

  async function fetchWithPostBypass(url: string, body: string, opts: any): Promise<{ ok: boolean; html: string | null; status: number; bypassed: boolean; methodUsed?: string }> {
    try {
      const res = await fetch(url, { method: 'POST', headers: opts.headers, body, signal: AbortSignal.timeout(opts.timeoutMs) });
      const text = await res.text();
      if (res.ok) return { ok: true, html: text, status: res.status, bypassed: false, methodUsed: 'Direct POST' };
      if (opts.enableCloudflareBypass && opts.flareSolverrUrl) {
        const { solveWithFlareSolverr } = await import('../captchaSolver');
        const sr = await solveWithFlareSolverr(url, opts.flareSolverrUrl, Math.round(opts.timeoutMs / 1000));
        if (sr.ok && sr.html) return { ok: true, html: sr.html, status: 200, bypassed: true, methodUsed: 'FlareSolverr Fallback (POST)' };
      }
      return { ok: false, html: null, status: res.status, bypassed: false };
    } catch {
      if (opts.enableCloudflareBypass && opts.flareSolverrUrl) {
        const { solveWithFlareSolverr } = await import('../captchaSolver');
        const sr = await solveWithFlareSolverr(url, opts.flareSolverrUrl, Math.round(opts.timeoutMs / 1000));
        if (sr.ok && sr.html) return { ok: true, html: sr.html, status: 200, bypassed: true, methodUsed: 'FlareSolverr Fallback (POST)' };
      }
      return { ok: false, html: null, status: 0, bypassed: false };
    }
  }

  try {
    const html = await fetchHtml(targetUrl);
    if (!html) return [];
    const $ = cheerio.load(html);

    const testAsync = config.madaraSelectTestAsync || 'div.listing-chapters_wrap';
    const inline = $(testAsync).first();
    const useInline = config.madaraWithoutAjax ? true : inline.length > 0;
    let chaptersHtml: string | null = null;

    if (useInline) {
      chaptersHtml = html;
    } else {
      const holder = $('#manga-chapters-holder');
      const mangaId = holder.attr('data-id')
        || (html.match(/"post_id"\s*:\s*(\d+)/)?.[1])
        || (html.match(/"manga_id"\s*:\s*(\d+)/)?.[1]);

      if (mangaId) {
        if (config.madaraPostReq !== false) {
          const formBody = `action=manga_get_chapters&manga=${mangaId}`;
          const ajaxHtml = await fetchHtml(`${origin}/wp-admin/admin-ajax.php`, formBody);
          if (ajaxHtml && ajaxHtml.trim().length > 0) chaptersHtml = ajaxHtml;
        }
        if (!chaptersHtml) {
          const relHtml = await fetchHtml(`${targetUrl.replace(/\/$/, '')}/ajax/chapters/`, '');
          if (relHtml && relHtml.trim().length > 0) chaptersHtml = relHtml;
        }
      } else {
        chaptersHtml = html;
      }
    }

    if (!chaptersHtml) return [];

    const selectChapter = config.madaraSelectChapter || 'li.wp-manga-chapter';
    const chDoc = cheerio.load(chaptersHtml);
    const rows = chDoc(selectChapter).toArray();
    const chapters: ResolvedChapter[] = [];
    const seen = new Set<string>();
    if (rows.length === 0) {
      const chLinkRx = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let m: RegExpExecArray | null;
      let idx = 0;
      while ((m = chLinkRx.exec(chaptersHtml)) !== null) {
        const href = m[1]; const text = m[2].replace(/<[^>]+>/g, '').trim();
        if (!href || /^(#|javascript:)/i.test(href)) continue;
        if (!/chapter|chap|ch/i.test(href) && !/chapter|chap|ch/i.test(text)) continue;
        const numM = (href + ' ' + text).match(/(?:chapter|chap|ch)[^\d]*(\d+(?:\.\d+)?)/i);
        const num = numM ? parseFloat(numM[1]) : (idx + 1);
        if (!Number.isFinite(num) || num <= 0) continue;
        const abs = href.startsWith('http') ? href : `${origin}${href.startsWith('/') ? '' : '/'}${href}`;
        if (seen.has(abs)) continue; seen.add(abs);
        chapters.push({ number: num, id: abs, slug: abs, title: text || `Chapter ${num}`, url: abs, pageCount: 0 }); idx++;
      }
    } else {
      const rowsReversed = [...rows].reverse();
      rowsReversed.forEach((rowEl, i) => {
        const a = chDoc(rowEl).find('a').first();
        const href = a.attr('href') || '';
        if (!href || /^(#|javascript:)/i.test(href)) return;
        const text = a.text().trim() || chDoc(rowEl).find('p').first().text().trim();
        const numM = (href + ' ' + text).match(/(?:chapter|chap|ch)[^\d]*(\d+(?:\.\d+)?)/i);
        const num = numM ? parseFloat(numM[1]) : (i + 1);
        if (!Number.isFinite(num) || num <= 0) return;
        const abs = href.startsWith('http') ? href : `${origin}${href.startsWith('/') ? '' : '/'}${href}`;
        if (seen.has(abs)) return; seen.add(abs);
        chapters.push({ number: num, id: abs, slug: abs, title: text || `Chapter ${num}`, url: abs, pageCount: 0 });
      });
    }
    return chapters;
  } catch (e: any) {
    console.warn(`[Madara Engine] Chapter list failed for ${config.name}:`, e.message);
    return [];
  }
}

export async function fetchMadaraChapterPages(targetUrl: string, chapterNumber: number, config: EngineSourceConfig): Promise<string[] | null> {
  try {
    const chapters = await fetchMadaraChapterList(targetUrl, config);
    const target = matchResolvedChapter(chapters, chapterNumber);
    if (!target) {
      console.warn(`[Madara Engine] Ch ${chapterNumber} not found for ${config.name}`);
      return null;
    }
    const origin = new URL(target.url).origin;
    const headers = { ...UA_HEADERS, 'Referer': origin + '/' };
    const chRes = await fetch(target.url, { headers });
    if (!chRes.ok) return null;
    const chHtml = await chRes.text();
    if (/id=["']chapter-protector-data["']/i.test(chHtml)) {
      console.warn(`[Madara Engine] Chapter protector (encrypted) — not supported for ${config.name}.`);
      return null;
    }
    const $ = cheerio.load(chHtml);
    const bodySel = config.madaraSelectBodyPage || 'div.main-col-inner div.reading-content';
    const container = $(bodySel).first().length > 0 ? $(bodySel).first() : null;
    const pages: string[] = [];
    const seenImg = new Set<string>();
    const extractFrom = (root: any) => {
      root.find('img').each((_: number, el: any) => {
        const src = ($(el).attr('data-src') || $(el).attr('data-lazy-src') || $(el).attr('data-cfsrc') || $(el).attr('src') || '').trim();
        if (src && /\.(jpg|jpeg|png|webp)/i.test(src) && !/\/covers\/|logo|avatar|icon/i.test(src)) {
          const abs = src.startsWith('http') ? src : `${origin}${src.startsWith('/') ? '' : '/'}${src}`;
          if (!seenImg.has(abs)) { seenImg.add(abs); pages.push(abs); }
        }
      });
    };
    if (container) extractFrom(container); else extractFrom($);
    if (pages.length > 0) {
      console.log(`[Madara Engine] ${pages.length} pages from ${config.name} Ch ${chapterNumber}`);
      return pages;
    }
    return null;
  } catch (e: any) {
    console.warn(`[Madara Engine] Page extraction failed for ${config.name}:`, e.message);
    return null;
  }
}

export function extractManhwa18ChapterNumber(href: string, name: string, fallback: number): number {
  const rx = /chapter[-_\.\s]*(\d+(?:\.\d+)?)|ch\.?\s*(\d+(?:\.\d+)?)|[-_\./]\s*(\d+(?:\.\d+)?)\s*$/i;
  const m = (href + ' ' + name).match(rx);
  const v = m ? (m[1] || m[2] || m[3]) : null;
  const parsed = v ? parseFloat(v) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function fetchManhwa18ChapterList(seriesUrl: string, domain: string): Promise<ResolvedChapter[]> {
  try {
    const normalized = normalizeLiveTargetUrl(seriesUrl);
    const origin = (() => { try { return new URL(normalized).origin; } catch { return `https://${domain}`; } })();
    const bypassRes = await fetchWithChallengeBypass(normalized, {
      headers: { ...UA_HEADERS, 'Referer': origin + '/' },
      enableCloudflareBypass: appSettings.enableCloudflareBypass,
      flareSolverrUrl: appSettings.flareSolverrUrl,
      captchaSolverEnabled: appSettings.captchaSolverEnabled,
      captchaApiKey: appSettings.captchaApiKey,
      timeoutMs: 15000,
      sourceId: domain || origin,
      onCookieUpdate: (sid: string, cookies: string[]) => sourceCookieJar.setCookies(sid, cookies),
    });
    if (!bypassRes.ok || !bypassRes.html) return [];
    const html = bypassRes.html;
    const $ = cheerio.load(html);
    let anchors = $('.card-body > .list-chapters > a').toArray();
    if (anchors.length === 0) anchors = $('.list-chapters a, .chapter-list a, a.chapter-name, a[href*="/chap-"], a[href*="/chapter-"]').toArray();
    if (anchors.length === 0) return [];
    const chapters: ResolvedChapter[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < anchors.length; i++) {
      const el = $(anchors[i]);
      const href = el.attr('href') || '';
      if (!href || href.startsWith('javascript') || href.startsWith('#')) continue;
      const abs = (href.startsWith('http') ? href : `${origin}${href.startsWith('/') ? '' : '/'}${href}`).replace(/\/+$/, '');
      if (!/\/(chap|chapter)[-_/]/i.test(abs) && !/\/manga\/[^/]+\/[^/]+/i.test(abs)) continue;
      if (seen.has(abs)) continue;
      seen.add(abs);
      const name = el.find('.chapter-name').text().trim() || el.text().trim();
      const num = extractManhwa18ChapterNumber(href, name, anchors.length - i);
      chapters.push({ number: num, id: abs, slug: abs, title: name || `Chapter ${num}`, url: abs, pageCount: 0 });
    }
    return chapters;
  } catch (e: any) {
    console.warn('[Manhwa18 Engine] Chapter list failed:', e.message);
    return [];
  }
}

export async function fetchManhwa18ChapterPages(chapterUrl: string, domain: string): Promise<string[] | null> {
  try {
    const origin = (() => { try { return new URL(chapterUrl).origin; } catch { return `https://${domain}`; } })();
    const bypassRes = await fetchWithChallengeBypass(chapterUrl, {
      headers: { ...UA_HEADERS, 'Referer': origin + '/' },
      enableCloudflareBypass: appSettings.enableCloudflareBypass,
      flareSolverrUrl: appSettings.flareSolverrUrl,
      captchaSolverEnabled: appSettings.captchaSolverEnabled,
      captchaApiKey: appSettings.captchaApiKey,
      timeoutMs: 15000,
      sourceId: domain || origin,
      onCookieUpdate: (sid: string, cookies: string[]) => sourceCookieJar.setCookies(sid, cookies),
    });
    if (!bypassRes.ok || !bypassRes.html) return null;
    const html = bypassRes.html;
    const $ = cheerio.load(html);
    const pages: string[] = [];
    const pushSrc = (raw: string) => {
      const src = (raw || '').trim();
      if (!src) return;
      if (!/\.(jpg|jpeg|png|webp)(\?|$)/i.test(src) && !/cdn\.manhwa18/i.test(src)) return;
      if (/logo|avatar|icon|banner|favicon|\/covers\//i.test(src)) return;
      const abs = src.startsWith('http') ? src : `${origin}${src.startsWith('/') ? '' : '/'}${src}`;
      if (!pages.includes(abs)) pages.push(abs);
    };
    $('#chapter-content img, .chapter-content img, #chapter_content img, .read-content img, .page-break img').each((_, el) => {
      pushSrc($(el).attr('data-src') || $(el).attr('data-lazy-src') || $(el).attr('data-original') || $(el).attr('src') || '');
    });
    if (pages.length === 0) {
      $('img.lazy, img[data-src]').each((_, el) => {
        pushSrc($(el).attr('data-src') || $(el).attr('src') || '');
      });
    }
    return pages.length > 0 ? pages : null;
  } catch (e: any) {
    console.warn('[Manhwa18 Engine] Page extraction failed:', e.message);
    return null;
  }
}

export function stripHotComicsLang(href: string): string {
  if (href.startsWith('http')) return href;
  const cleaned = href.startsWith('/') ? href.substring(1) : href;
  const firstSlash = cleaned.indexOf('/');
  if (firstSlash <= 0 || firstSlash === cleaned.length - 1) return href;
  return '/' + cleaned.substring(firstSlash + 1);
}

export async function fetchHotComicsChapterList(seriesUrl: string, domain: string): Promise<ResolvedChapter[]> {
  try {
    const origin = (() => { try { return new URL(seriesUrl).origin; } catch { return `https://${domain}`; } })();
    const res = await fetch(seriesUrl, { headers: { ...UA_HEADERS, 'Referer': origin + '/' } });
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const lis = $('#tab-chapter li').toArray();
    if (lis.length === 0) return [];
    const chapters: ResolvedChapter[] = [];
    for (let i = 0; i < lis.length; i++) {
      const el = $(lis[i]);
      const a = el.find('a').first();
      let href = a.attr('href') || '';
      if (href.startsWith('javascript')) {
        href = (a.attr('onclick') || '').match(/href=['"]([^'"]+)['"]/)?.[1] || '';
      }
      if (!href || href === '#') continue;
      const rel = stripHotComicsLang(href);
      const abs = rel.startsWith('http') ? rel : `https://${domain}${rel.startsWith('/') ? '' : '/'}${rel}`;
      const num = parseFloat(el.find('.num').text() || '') || (i + 1);
      chapters.push({ number: num, id: abs, slug: abs, title: `Chapter ${num}`, url: abs, pageCount: 0 });
    }
    return chapters;
  } catch (e: any) {
    console.warn('[HotComics Engine] Chapter list failed:', e.message);
    return [];
  }
}

export async function fetchHotComicsChapterPages(chapterUrl: string, domain: string): Promise<string[] | null> {
  try {
    const origin = (() => { try { return new URL(chapterUrl).origin; } catch { return `https://${domain}`; } })();
    const res = await fetch(chapterUrl, { headers: { ...UA_HEADERS, 'Referer': origin + '/' } });
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);
    const pages: string[] = [];
    $('#viewer-img img').each((_, el) => {
      const src = ($(el).attr('src') || $(el).attr('data-src') || '').trim();
      if (src && /\.(jpg|jpeg|png|webp)/i.test(src) && !/logo|avatar|icon|banner/i.test(src)) {
        pages.push(src.startsWith('http') ? src : `${origin}${src.startsWith('/') ? '' : '/'}${src}`);
      }
    });
    return pages.length > 0 ? Array.from(new Set(pages)) : null;
  } catch (e: any) {
    console.warn('[HotComics Engine] Page extraction failed:', e.message);
    return null;
  }
}

export function extractMangaReaderPageUrls(html: string, origin: string): string[] {
  const $ = cheerio.load(html);
  const pages: string[] = [];

  let tsScript: string | null = null;
  $('script').each((_, el) => {
    const code = $(el).html() || '';
    if (tsScript === null && code.includes('ts_reader')) tsScript = code;
  });
  if (tsScript) {
    const start = tsScript.indexOf('(');
    const end = tsScript.lastIndexOf(')');
    if (start !== -1 && end > start) {
      try {
        const obj = JSON.parse(tsScript.substring(start + 1, end));
        const imgs = obj?.sources?.[0]?.images;
        if (Array.isArray(imgs)) pages.push(...imgs);
      } catch (_) {}
    }
  }

  if (pages.length === 0) {
    let b64: string | null = null;
    $('script[src^="data:text/javascript;base64,"]').each((_, el) => { if (b64 === null) b64 = $(el).attr('src') || null; });
    if (b64) {
      try {
        const decoded = Buffer.from(b64.replace('data:text/javascript;base64,', ''), 'base64').toString('utf-8');
        if (decoded.startsWith('ts_reader')) {
          const start = decoded.indexOf('(');
          const end = decoded.lastIndexOf(')');
          if (start !== -1 && end > start) {
            const obj = JSON.parse(decoded.substring(start + 1, end));
            const imgs = obj?.sources?.[0]?.images;
            if (Array.isArray(imgs)) pages.push(...imgs);
          }
        }
      } catch (_) {}
    }
  }

  if (pages.length === 0) {
    $('#readerarea img').each((_, el) => {
      const src = $(el).attr('data-src') || $(el).attr('data-lazy-src') || $(el).attr('src') || '';
      if (src) pages.push(src);
    });
  }

  return Array.from(new Set(pages.map((p) => p.startsWith('http') ? p : `${origin}${p.startsWith('/') ? '' : '/'}${p}`)));
}

export async function fetchMangaReaderChapterPages(chapterUrl: string): Promise<string[] | null> {
  try {
    const origin = new URL(chapterUrl).origin;
    const reqHeaders = { ...UA_HEADERS, 'Referer': origin + '/' };
    const bypassRes = await fetchWithChallengeBypass(chapterUrl, {
      headers: reqHeaders,
      enableCloudflareBypass: appSettings.enableCloudflareBypass,
      flareSolverrUrl: appSettings.flareSolverrUrl,
      captchaSolverEnabled: appSettings.captchaSolverEnabled,
      captchaApiKey: appSettings.captchaApiKey,
      timeoutMs: 15000,
      sourceId: origin,
      onCookieUpdate: (sid: string, cookies: string[]) => sourceCookieJar.setCookies(sid, cookies),
    });
    if (!bypassRes.ok || !bypassRes.html) return null;
    let pages = extractMangaReaderPageUrls(bypassRes.html, origin);
    if (pages.length === 0) {
      pages = extractPanelImages(bypassRes.html, origin);
    }
    return pages.length > 0 ? pages : null;
  } catch (e: any) {
    console.warn('[MangaReader Engine] Page extraction failed:', e.message);
    return null;
  }
}

export async function fetchMangaReaderChapterList(seriesUrl: string): Promise<ResolvedChapter[]> {
  try {
    const origin = new URL(seriesUrl).origin;
    const reqHeaders = { ...UA_HEADERS, 'Referer': origin + '/' };
    const bypassRes = await fetchWithChallengeBypass(seriesUrl, {
      headers: reqHeaders,
      enableCloudflareBypass: appSettings.enableCloudflareBypass,
      flareSolverrUrl: appSettings.flareSolverrUrl,
      captchaSolverEnabled: appSettings.captchaSolverEnabled,
      captchaApiKey: appSettings.captchaApiKey,
      timeoutMs: 15000,
      sourceId: origin,
      onCookieUpdate: (sid: string, cookies: string[]) => sourceCookieJar.setCookies(sid, cookies),
    });
    if (!bypassRes.ok || !bypassRes.html) return [];
    const $ = cheerio.load(bypassRes.html);
    const lis = $('#chapterlist > ul > li, ul.chapter-list li, li.wp-manga-chapter, div.eplister > ul > li, .eplister li, .clstyle li, #eplister li').toArray();
    if (lis.length === 0) {
      return parseGenericChapterListFromHtml(bypassRes.html, origin);
    }
    const chapters: ResolvedChapter[] = [];
    const seen = new Set<string>();
    [...lis].reverse().forEach((li, i) => {
      const a = $(li).find('a').first();
      const href = a.attr('href') || '';
      if (!href || /^(#|javascript:)/i.test(href)) return;
      const text = a.text().trim() || a.attr('title') || $(li).find('.chapternum, .epl-num').text().trim() || '';
      const numAttr = a.attr('data-num') || $(li).attr('data-num');
      const numM = (href + ' ' + text).match(/(?:chapter|chap|ch)[^\d]*(\d+(?:\.\d+)?)/i) || text.match(/^(\d+(?:\.\d+)?)/);
      const num = numAttr ? parseFloat(numAttr) : (numM ? parseFloat(numM[1]) : (i + 1));
      if (!Number.isFinite(num) || num <= 0) return;
      const abs = href.startsWith('http') ? href : `${origin}${href.startsWith('/') ? '' : '/'}${href}`;
      if (seen.has(abs)) return; seen.add(abs);
      chapters.push({ number: num, id: abs, slug: abs, title: text || `Chapter ${num}`, url: abs, pageCount: 0 });
    });
    return chapters;
  } catch (e: any) {
    console.warn('[MangaReader Engine] Chapter list failed:', e.message);
    return [];
  }
}

export async function fetchFoolSlideHtml(targetUrl: string, domainId: string): Promise<string | null> {
  const origin = new URL(targetUrl).origin;
  const headers = { ...UA_HEADERS, 'Referer': origin + '/' };
  const get = (url: string) => fetchWithChallengeBypass(url, {
    headers,
    enableCloudflareBypass: appSettings.enableCloudflareBypass,
    flareSolverrUrl: appSettings.flareSolverrUrl,
    captchaSolverEnabled: appSettings.captchaSolverEnabled,
    captchaApiKey: appSettings.captchaApiKey,
    timeoutMs: 8000,
    sourceId: domainId,
    onCookieUpdate: (sid: string, cookies: string[]) => sourceCookieJar.setCookies(sid, cookies),
  });

  const first = await get(targetUrl);
  if (!first.ok || !first.html) return null;
  updateSourceHealth(domainId, first.html, first.status);

  if (!/<form[^>]*method=["']post["'][\s\S]*?name=["']adult["']/i.test(first.html)) {
    return first.html;
  }

  try {
    await fetch(targetUrl, {
      method: 'POST',
      headers: {
        ...UA_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': targetUrl,
        'Cookie': sourceCookieJar.getCookieHeader(domainId),
      },
      body: 'adult=true',
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
    });
  } catch {}

  const second = await get(targetUrl);
  if (!second.ok || !second.html) return null;
  updateSourceHealth(domainId, second.html, second.status);
  return second.html;
}

export async function fetchFoolSlideChapterList(seriesUrl: string, domainId: string): Promise<ResolvedChapter[]> {
  try {
    const html = await fetchFoolSlideHtml(seriesUrl, domainId);
    if (!html) return [];
    const $ = cheerio.load(html);
    const origin = new URL(seriesUrl).origin;
    const chapters: ResolvedChapter[] = [];
    const seen = new Set<string>();

    const rows = $('ul.chapter-list li a, #chapter-list li a, li.chapter a, select option, .chapter a').toArray();
    for (const row of rows) {
      const tag = (row as any).tagName?.toLowerCase();
      const href = tag === 'option' ? ($(row).attr('value') || '') : ($(row).attr('href') || '');
      if (!href || /^(#|javascript:)/i.test(href)) continue;
      const text = $(row).text().trim() || $(row).attr('title') || '';
      const abs = href.startsWith('http') ? href : `${origin}${href.startsWith('/') ? '' : '/'}${href}`;
      const m = abs.match(/\/read\/[^/]+\/[^/]+\/(\d+)\/(\d+(?:\.\d+)?)\/?/i);
      const num = m ? parseFloat(m[2]) : NaN;
      if (!Number.isFinite(num) || num <= 0) continue;
      if (seen.has(abs)) continue; seen.add(abs);
      chapters.push({ number: num, id: abs, slug: abs, title: text || `Chapter ${num}`, url: abs, pageCount: 0 });
    }
    return chapters;
  } catch (e: any) {
    console.warn('[FoolSlide Engine] Chapter list failed:', e.message);
    return [];
  }
}

export async function fetchFoolSlideChapterPages(chapterUrl: string, domainId: string): Promise<string[] | null> {
  try {
    const html = await fetchFoolSlideHtml(chapterUrl, domainId);
    if (!html) return null;
    const origin = new URL(chapterUrl).origin;
    const pages = extractPanelImages(html, origin);
    return pages.length > 0 ? pages : null;
  } catch (e: any) {
    console.warn('[FoolSlide Engine] Page extraction failed:', e.message);
    return null;
  }
}

export async function fetchLiveChapterList(rawTargetUrl: string, domainId: string): Promise<ResolvedChapter[]> {
  const targetUrl = normalizeLiveTargetUrl(rawTargetUrl);
  
  const engineConfig = getEngineConfig(domainId);
  if (engineConfig && engineConfig.engine === 'madara') {
    const chapters = await fetchMadaraChapterList(targetUrl, engineConfig);
    if (chapters.length > 0) return chapters;
  }
  if (engineConfig && engineConfig.engine === 'mangareader') {
    const chapters = await fetchMangaReaderChapterList(targetUrl);
    if (chapters.length > 0) return chapters;
  }
  if (engineConfig && engineConfig.engine === 'hotcomics') {
    const chapters = await fetchHotComicsChapterList(targetUrl, engineConfig.domain || domainId);
    if (chapters.length > 0) return chapters;
  }
  if (engineConfig && engineConfig.engine === 'foolslide') {
    const chapters = await fetchFoolSlideChapterList(targetUrl, domainId);
    if (chapters.length > 0) return chapters;
  }
  
  if (domainId === 'weebcentral' || targetUrl.includes('weebcentral.com')) {
    const weebChapters = await fetchWeebCentralChapterList(targetUrl);
    if (weebChapters.length > 0) return weebChapters;
  }
  if (domainId === 'asura' || domainId === 'asurascans' || targetUrl.includes('asurascans.com') || targetUrl.includes('asuracomic.net')) {
    return (await fetchAsuraChapterList(targetUrl)).chapters;
  }
  if (domainId === 'flame' || domainId === 'flamecomics' || targetUrl.includes('flamecomics.xyz') || targetUrl.includes('flamescans')) {
    return await fetchFlameChapterList(targetUrl);
  }

  switch (domainId) {
    case 'dynasty':
      return await fetchDynastyChapterList(targetUrl);
    default:
      return await fetchGenericChapterList(targetUrl);
  }
}

export async function extractLiveDomainChapterPages(
  rawTargetUrl: string,
  domainId: string,
  chapterNumber: number = 1
): Promise<string[] | null> {
  try {
    if (domainId && !sourceCircuitBreaker.canAttempt(domainId)) {
      console.warn(`[Live Source Extractor] Fast-failing extract from ${domainId} (circuit OPEN)`);
      return null;
    }
    const targetUrl = normalizeLiveTargetUrl(rawTargetUrl);

    console.log(`[Live Source Extractor] Extracting Chapter ${chapterNumber} from ${domainId} (${targetUrl})`);

    if (domainId === 'weebcentral' || targetUrl.includes('weebcentral.com')) {
      try {
        const urls = await fetchWeebCentralChapterPages(targetUrl);
        if (urls && urls.length > 0) {
          console.log(`[WeebCentral Scraper] Successfully extracted ${urls.length} live pages for ${targetUrl}`);
          return urls;
        }
        const chapters = await fetchWeebCentralChapterList(targetUrl);
        const targetCh = matchResolvedChapter(chapters, chapterNumber);
        if (targetCh && targetCh.url) {
          const chUrls = await fetchWeebCentralChapterPages(targetCh.url);
          if (chUrls && chUrls.length > 0) {
            console.log(`[WeebCentral Scraper] Successfully extracted ${chUrls.length} live pages for ${targetCh.url}`);
            return chUrls;
          }
        }
      } catch (err: any) {
        console.warn(`[WeebCentral Scraper] Page extraction error:`, err.message);
      }
    }

    if (domainId === 'asura' || domainId === 'asurascans' || targetUrl.includes('asurascans.com') || targetUrl.includes('asuracomic.net')) {
      try {
        const { chapters, matchedSlug } = await fetchAsuraChapterList(targetUrl);

        if (chapters.length > 0 && matchedSlug) {
          const targetChapter = matchResolvedChapter(chapters, chapterNumber);

          if (targetChapter && targetChapter.slug) {
            const pagesRes = await fetch(`https://api.asurascans.com/api/series/${matchedSlug}/chapters/${targetChapter.slug}`, {
              headers: ASURA_API_HEADERS,
              signal: AbortSignal.timeout(15000),
            });

            if (pagesRes.ok) {
              const pagesData = await pagesRes.json();
              const rawPages =
                pagesData?.data?.chapter?.pages ||
                pagesData?.data?.pages ||
                pagesData?.chapter?.pages ||
                pagesData?.pages ||
                [];
              const urls = normalizeAsuraPageList(rawPages);
              if (urls.length > 0) {
                console.log(`[Asura API Engine] Successfully loaded ${urls.length} live pages for ${matchedSlug} Chapter ${chapterNumber}`);
                return urls;
              }
            }
          }
        }
      } catch (err: any) {
        console.warn(`[Asura Scans API Engine] Failed, falling back to HTML parser:`, err.message);
      }
    }

    if (domainId === 'flame' || domainId === 'flamecomics' || targetUrl.includes('flamecomics.xyz') || targetUrl.includes('flamescans')) {
      try {
        const ctx = await fetchFlameSeriesContext(targetUrl);
        if (ctx) {
          const resolved = mapFlameChapters(ctx.chapters, ctx.seriesId);
          const matchedCh = matchResolvedChapter(resolved, chapterNumber);
          if (matchedCh && matchedCh.slug) {
            const token = matchedCh.slug;
            const chRes = await fetch(`https://flamecomics.xyz/_next/data/${ctx.buildId}/series/${ctx.seriesId}/${token}.json?id=${ctx.seriesId}&token=${token}`, {
              headers: UA_HEADERS,
            });

            if (chRes.ok) {
              const chData = await chRes.json();
              const imagesObj = chData.pageProps?.chapter?.images || {};
              const imageKeys = Object.keys(imagesObj);
              if (imageKeys.length > 0) {
                console.log(`[Flame Comics API Engine] Successfully extracted ${imageKeys.length} live pages for seriesId ${ctx.seriesId} token ${token}`);
                const cdnBase = `https://cdn.flamecomics.xyz/uploads/images/series/${ctx.seriesId}/${token}`;
                return imageKeys.map((k) => {
                  const imgName = typeof imagesObj[k] === 'object' ? (imagesObj[k].name || imagesObj[k]) : imagesObj[k];
                  return `${cdnBase}/${imgName}`;
                });
              }
            }
          }
        }
      } catch (err: any) {
        console.warn(`[Flame Comics API Engine] Failed, falling back to HTML parser:`, err.message);
      }
    }

    const engCfg = getEngineConfig(domainId);
    if (engCfg && engCfg.engine === 'manhwa18') {
      const mhChapters = await fetchManhwa18ChapterList(targetUrl, engCfg.domain);
      const mhTarget = matchResolvedChapter(mhChapters, chapterNumber);
      if (mhTarget) {
        const mhPages = await fetchManhwa18ChapterPages(mhTarget.url, engCfg.domain);
        if (mhPages && mhPages.length > 0) return mhPages;
      }
    }
    if (engCfg && engCfg.engine === 'hotcomics') {
      const hcChapters = await fetchHotComicsChapterList(targetUrl, engCfg.domain);
      const hcTarget = matchResolvedChapter(hcChapters, chapterNumber);
      if (hcTarget) {
        const hcPages = await fetchHotComicsChapterPages(hcTarget.url, engCfg.domain);
        if (hcPages && hcPages.length > 0) return hcPages;
      }
    }
    if (engCfg && engCfg.engine === 'mangareader') {
      const mrChapters = await fetchMangaReaderChapterList(targetUrl);
      const mrTarget = matchResolvedChapter(mrChapters, chapterNumber);
      if (mrTarget) {
        const mrPages = await fetchMangaReaderChapterPages(mrTarget.url);
        if (mrPages && mrPages.length > 0) return mrPages;
      }
    }
    if (engCfg && engCfg.engine === 'foolslide') {
      const fsChapters = await fetchFoolSlideChapterList(targetUrl, domainId);
      const fsTarget = matchResolvedChapter(fsChapters, chapterNumber);
      if (fsTarget) {
        const fsPages = await fetchFoolSlideChapterPages(fsTarget.url, domainId);
        if (fsPages && fsPages.length > 0) return fsPages;
      }
    }
    if (engCfg && engCfg.engine === 'madara') {
      const madaraPages = await fetchMadaraChapterPages(targetUrl, chapterNumber, engCfg);
      if (madaraPages && madaraPages.length > 0) return madaraPages;
    }

    if (domainId === 'dynasty' || targetUrl.includes('dynasty-scans.com')) {
      try {
        const chapters = await fetchDynastyChapterList(targetUrl);
        if (chapters.length > 0) {
          const target = matchResolvedChapter(chapters, chapterNumber);
          if (target) {
            const res = await fetch(target.url, {
              headers: { 'User-Agent': UA_HEADERS['User-Agent'], Referer: targetUrl },
            });
            if (res.ok) {
              const html = await res.text();
              const match = html.match(/var\s+pages\s*=\s*(\[[\s\S]*?\]);/);
              if (match && match[1]) {
                let pagesObj: any[];
                try { pagesObj = JSON.parse(match[1]); } catch { pagesObj = []; }
                const pageUrls: string[] = [];
                for (const item of Array.isArray(pagesObj) ? pagesObj : []) {
                  let src = typeof item === 'string' ? item : '';
                  if (typeof item === 'object' && item !== null) {
                    const v = item.image || item.url || item.src;
                    src = typeof v === 'string' ? v : (typeof v === 'object' && v ? (v.url || v.path || v.src || '') : '');
                  }
                  if (!src) continue;
                  pageUrls.push(src.startsWith('http') ? src : `https://dynasty-scans.com${src.startsWith('/') ? '' : '/'}${src}`);
                }
                if (pageUrls.length > 0) return Array.from(new Set(pageUrls));
              }
            }
          }
        }
      } catch (err: any) {
        console.warn(`[Dynasty Scans Extractor] Error:`, err.message);
      }
    }

    const origin = new URL(targetUrl).origin;
    const reqHeaders = { ...UA_HEADERS, 'Referer': origin + '/' };
    const solverOpts = {
      headers: reqHeaders,
      enableCloudflareBypass: appSettings.enableCloudflareBypass,
      flareSolverrUrl: appSettings.flareSolverrUrl,
      captchaSolverEnabled: appSettings.captchaSolverEnabled,
      captchaApiKey: appSettings.captchaApiKey,
      sourceId: origin,
      onCookieUpdate: (sid: string, cookies: string[]) => sourceCookieJar.setCookies(sid, cookies),
    };

    const isDirectChapterUrl = /\/(chapter|chap|ch|read|reader|view|ep|episode)[-/_.]?\d+/i.test(targetUrl);
    if (isDirectChapterUrl) {
      const directBypass = await fetchWithChallengeBypass(targetUrl, solverOpts);
      if (directBypass.ok && directBypass.html) {
        const directImages = extractPanelImages(directBypass.html, origin);
        if (directImages.length > 0) return directImages;
      }
      return null;
    }

    const genericChapters = await fetchGenericChapterList(targetUrl);
    const genericTarget = matchResolvedChapter(genericChapters, chapterNumber);
    if (genericTarget) {
      const pageBypass = await fetchWithChallengeBypass(genericTarget.url, solverOpts);
      if (pageBypass.ok && pageBypass.html) {
        const images = extractPanelImages(pageBypass.html, origin);
        if (images.length > 0) return images;
      }
    } else {
      const baseClean = targetUrl.replace(/\/$/, '');
      const candidates = [
        `${baseClean}/chapter-${chapterNumber}`,
        `${baseClean}/chap-${chapterNumber}`,
        `${baseClean}/ch-${chapterNumber}`,
        `${baseClean}/${chapterNumber}`,
      ];
      for (const candidateUrl of candidates) {
        try {
          const candidateBypass = await fetchWithChallengeBypass(candidateUrl, solverOpts);
          if (candidateBypass.ok && candidateBypass.html) {
            const images = extractPanelImages(candidateBypass.html, origin);
            if (images.length > 0) return images;
          }
        } catch {}
      }
    }

  } catch (err) {
    console.error(`[Live Source Extractor] Error extracting from ${domainId}:`, err);
  }

  return null;
}

export interface KotatsuPageListCacheEntry {
  pages: string[];
  timestamp: number;
}

export class KotatsuImageEngine {
  private pageListCache = new Map<string, KotatsuPageListCacheEntry>();
  private maxCacheAgeMs = 1000 * 60 * 60 * 24; // 24 Hours Cache

  public async getChapterPages(
    targetUrl: string,
    domainId: string,
    chapterNumber: number = 1
  ): Promise<string[] | null> {
    const cacheKey = `${domainId}:${targetUrl}:${chapterNumber}`;
    const cached = this.pageListCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.maxCacheAgeMs) {
      console.log(`[Kotatsu Image Engine] Memory Cache Hit for ${cacheKey} (${cached.pages.length} pages)`);
      return cached.pages;
    }

    try {
      const sqliteCached = SqliteDb.getCachedChapterPages(domainId, chapterNumber, targetUrl);
      if (sqliteCached && sqliteCached.pages.length > 0) {
        console.log(`[Kotatsu Image Engine] SQLite Cache Hit for ${cacheKey} (${sqliteCached.pages.length} pages)`);
        this.setMemoryCache(cacheKey, { pages: sqliteCached.pages, timestamp: Date.now() });
        return sqliteCached.pages;
      }
    } catch {}

    const pages = await extractLiveDomainChapterPages(targetUrl, domainId, chapterNumber);
    if (pages && pages.length > 0) {
      this.setMemoryCache(cacheKey, { pages, timestamp: Date.now() });
      try {
        SqliteDb.setCachedChapterPages(domainId, chapterNumber, targetUrl, pages, this.maxCacheAgeMs);
      } catch {}
    }
    return pages;
  }

  private setMemoryCache(key: string, entry: KotatsuPageListCacheEntry) {
    if (this.pageListCache.size >= 300) {
      const oldest = this.pageListCache.keys().next().value;
      if (oldest) this.pageListCache.delete(oldest);
    }
    this.pageListCache.set(key, entry);
  }

  public clearCache() {
    this.pageListCache.clear();
  }

  public size(): number {
    return this.pageListCache.size;
  }
}

export const kotatsuImageEngine = new KotatsuImageEngine();

export async function searchLiveSourcesForSeries(
  title: string,
  altTitles: string[] = []
): Promise<{ sourceName: string; sourceUrl: string; confidence: number }[]> {
  const discovered: { sourceName: string; sourceUrl: string; confidence: number }[] = [];
  const seenUrls = new Set<string>();

  const candidateQueries = Array.from(new Set([
    title,
    ...(altTitles || []),
  ]))
    .map((t) => (t ? t.replace(/\s*\([^)]*\)/g, '').replace(/uncensored|reboot|hd|season \d+|ch \d+/gi, '').trim() : ''))
    .filter((t) => t.length >= 2);

  for (const q of candidateQueries.slice(0, 3)) {
    if (!disabledSourceIds.has('weebcentral') && isSourceAlive('weebcentral')) {
      try {
        const weebList = await searchWeebCentral(q);
        for (const s of weebList) {
          const sTitle = s.title || '';
          const sim = calculateStringSimilarity(q, sTitle);
          if (sim >= 55 && s.sourceUrl) {
            if (!seenUrls.has(s.sourceUrl)) {
              seenUrls.add(s.sourceUrl);
              discovered.push({ sourceName: 'Weeb Central', sourceUrl: s.sourceUrl, confidence: sim });
            }
          }
        }
      } catch {}
    }

    if (!disabledSourceIds.has('asurascans') && isSourceAlive('asurascans')) {
      try {
        const asuraRes = await fetch(`https://api.asurascans.com/api/series?search=${encodeURIComponent(q)}`, {
          headers: ASURA_API_HEADERS,
          signal: AbortSignal.timeout(6000),
        });
        if (asuraRes.ok) {
          const asuraJson = await asuraRes.json();
          const list = Array.isArray(asuraJson?.data) ? asuraJson.data : [];
          for (const s of list) {
            const sTitle = s.title || '';
            const sim = calculateStringSimilarity(q, sTitle);
            if (sim >= 55) {
              const slug = s.slug || s.id || '';
              const pubPath = s.public_url || `/comics/${slug}`;
              const sUrl = `https://asurascans.com${pubPath}`;
              if (!seenUrls.has(sUrl)) {
                seenUrls.add(sUrl);
                discovered.push({ sourceName: 'Asura Scans', sourceUrl: sUrl, confidence: sim });
              }
            }
          }
        }
      } catch {}
    }

    if (!disabledSourceIds.has('flamecomics') && isSourceAlive('flamecomics')) {
      try {
        const flameSlug = q.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const flameCtx = await fetchFlameSeriesContext(`https://flamecomics.xyz/series/${flameSlug}`);
        if (flameCtx && flameCtx.matchedSeries?.title) {
          const sim = calculateStringSimilarity(q, flameCtx.matchedSeries.title);
          if (sim >= 55) {
            const sUrl = `https://flamecomics.xyz/series/${flameCtx.seriesId || flameSlug}`;
            if (!seenUrls.has(sUrl)) {
              seenUrls.add(sUrl);
              discovered.push({ sourceName: 'Flame Comics', sourceUrl: sUrl, confidence: sim });
            }
          }
        }
      } catch {}
    }

    if (discovered.length >= 3) break;
  }

  discovered.sort((a, b) => b.confidence - a.confidence);
  return discovered;
}

export async function autoDiscoverLiveSourceForManga(
  manga: MangaItem
): Promise<{ sourceName: string; sourceUrl: string } | null> {
  if (Array.isArray(manga.availableSources) && manga.availableSources.length > 0) {
    const existingLive = manga.availableSources.find(
      (s) => s && s.sourceUrl && s.sourceUrl.startsWith('http') && !s.sourceUrl.toLowerCase().includes('mangadex.org')
    );
    if (existingLive) {
      if (!manga.sourceUrl || manga.sourceUrl.toLowerCase().includes('mangadex.org')) {
        manga.sourceUrl = existingLive.sourceUrl;
        manga.sourceName = existingLive.sourceName || manga.sourceName;
        SqliteDb.upsertManga(manga);
        const idx = mangaDatabase.findIndex((m) => m.id === manga.id);
        if (idx !== -1) mangaDatabase[idx] = manga;
        saveDatabaseToDisk();
      }
      return existingLive;
    }
  }

  const results = await searchLiveSourcesForSeries(manga.title, manga.altTitles);
  if (results.length === 0) return null;

  const best = results[0];
  if (!Array.isArray(manga.availableSources)) manga.availableSources = [];

  for (const r of results) {
    if (!manga.availableSources.some((s) => s.sourceUrl === r.sourceUrl)) {
      manga.availableSources.push({ sourceName: r.sourceName, sourceUrl: r.sourceUrl });
    }
  }

  if (!manga.sourceUrl || manga.sourceUrl.toLowerCase().includes('mangadex.org')) {
    manga.sourceUrl = best.sourceUrl;
    manga.sourceName = best.sourceName;
  }

  manga.lastUpdated = new Date().toISOString();
  SqliteDb.upsertManga(manga);
  const idx = mangaDatabase.findIndex((m) => m.id === manga.id);
  if (idx !== -1) mangaDatabase[idx] = manga;
  saveDatabaseToDisk();

  console.log(`[Live Source Discovery] Auto-linked live source "${best.sourceName}" (${best.sourceUrl}) for "${manga.title}"`);
  return best;
}
