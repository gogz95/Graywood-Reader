// ============================================================================
// Multi-Source Chapter List Parsing & Chapter Page Fetching Engine
// ============================================================================

import * as cheerio from 'cheerio';
import { ResolvedChapter, EngineSourceConfig, DOMAIN_MIRRORS, UA_HEADERS } from './types';
import { matchResolvedChapter, normalizeLiveTargetUrl } from './engineRegistry';
import { extractPanelImages, parseSrcsetCandidate, isValidPanelImageUrl } from './imageExtractor';
import { fetchWithChallengeBypass } from '../../captchaSolver';
import { sourceCircuitBreaker } from '../../circuitBreaker';
import { isAdUrl, isAdTitle, isAdSeries, stripAdElements } from '../../adFilter';
import { sourceCookieJar, updateSourceHealth } from '../sourceHealthService';
import { appSettings } from '../../appState';

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

export function parseGenericChapterListFromHtml(sHtml: string, origin: string): ResolvedChapter[] {
  if (!sHtml) return [];
  const $ = cheerio.load(sHtml);
  stripAdElements($);
  const out: ResolvedChapter[] = [];
  const seen = new Set<string>();

  // 1. Check for Next.js / embedded JSON chapter arrays
  const nextData = $('script#__NEXT_DATA__').html()?.trim();
  if (nextData) {
    try {
      const parsed = JSON.parse(nextData);
      const chs =
        parsed?.props?.pageProps?.chapters ||
        parsed?.props?.pageProps?.series?.chapters ||
        parsed?.props?.pageProps?.manga?.chapters ||
        parsed?.props?.pageProps?.comic?.chapters ||
        parsed?.props?.pageProps?.data?.chapters;
      if (Array.isArray(chs)) {
        for (const ch of chs) {
          const num = typeof ch.chapter === 'number' ? ch.chapter : parseFloat(ch.chapter || ch.name || ch.title || '0');
          const href = ch.url || ch.link || ch.id || ch.slug || '';
          if (Number.isFinite(num) && num > 0 && href) {
            const abs = href.startsWith('http') ? href : `${origin}${href.startsWith('/') ? '' : '/'}${href}`;
            if (!seen.has(abs)) {
              seen.add(abs);
              out.push({
                number: num,
                id: abs,
                slug: abs,
                title: ch.title || ch.name || `Chapter ${num}`,
                url: abs,
                pageCount: 0,
              });
            }
          }
        }
      }
    } catch (_) {}
  }

  if (out.length > 0) return out;

  // 2. Prioritize dedicated chapter containers to isolate from sidebar recommendations
  const dedicatedContainerSelectors = [
    'div.eplister li a',
    'ul.chapter-list li a',
    '.chapters-list li a',
    '#chapterlist li a',
    '#nt_listchapter ul li a',
    '.list-chapter ul li a',
    '.works-chapter-list a',
    '.row-content-chapter li a',
    '.listing-chapters_wrap li a',
    '.list-chapter .row a',
    '.version-chap a',
    '.chapter-container a',
    '#chapters a',
  ];

  let candidateNodes: any[] = [];
  for (const sel of dedicatedContainerSelectors) {
    const found = $(sel).toArray();
    if (found.length > 0) {
      candidateNodes.push(...found);
    }
  }

  if (candidateNodes.length === 0) {
    candidateNodes = $('a[href], select option[value], .element .title a').toArray();
  }

  const chapterRegex = /(?:chapter|chapitre|capitulo|capítulo|cap|chap|ch|episode|ep|глава|tập|tap|vol|volume|#)[^\d]*(\d+(?:\.\d+)?)/i;
  const pathNumberRegex = /\/(?:chapter|chap|ch|episode|ep)[-_/]?(\d+(?:\.\d+)?)/i;

  let autoNum = 1;
  for (const node of candidateNodes) {
    const tag = (node as any).tagName?.toLowerCase();
    const href = tag === 'option' ? ($(node).attr('value') || '') : ($(node).attr('href') || '');
    if (!href || /^(#|javascript:|mailto:|tel:)/i.test(href)) continue;
    const text = $(node).text().trim() || $(node).attr('title') || '';
    if (isAdUrl(href) || isAdTitle(text) || isAdSeries(text, href)) continue;

    const numMatch = (href + ' ' + text).match(chapterRegex) || href.match(pathNumberRegex);
    if (!numMatch && !/chapter|chap|ch/i.test(href) && !/chapter|chap|ch/i.test(text)) {
      continue;
    }
    const num = numMatch ? parseFloat(numMatch[1]) : autoNum++;
    if (!Number.isFinite(num) || num <= 0) continue;

    const abs = href.startsWith('http') ? href : `${origin}${href.startsWith('/') ? '' : '/'}${href}`;
    if (seen.has(abs) || isAdUrl(abs)) continue;
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
  const reqHeaders = { ...UA_HEADERS, Referer: origin + '/' };
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

const madaraNewChapterEndpointCache = new Map<string, boolean>();

export async function fetchMadaraChapterList(targetUrl: string, config: EngineSourceConfig): Promise<ResolvedChapter[]> {
  if (!sourceCircuitBreaker.canAttempt(config.id)) {
    console.warn(`[Madara Engine] Fast-failing ${config.name} (circuit OPEN)`);
    return [];
  }
  const origin = new URL(targetUrl).origin;
  const headers = { ...UA_HEADERS, Referer: origin + '/' };

  const fetchHtml = async (url: string, postBody?: string): Promise<string | null> => {
    const isPost = postBody !== undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const timeout = [6000, 12000, 20000][attempt] || 6000;
        const opts: any = {
          headers: isPost
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
        opts.method = isPost ? 'POST' : 'GET';
        const res = isPost
          ? await fetchWithPostBypass(url, postBody ?? '', opts)
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

  async function fetchWithPostBypass(
    url: string,
    body: string,
    opts: any
  ): Promise<{ ok: boolean; html: string | null; status: number; bypassed: boolean; methodUsed?: string }> {
    try {
      const res = await fetch(url, { method: 'POST', headers: opts.headers, body, signal: AbortSignal.timeout(opts.timeoutMs) });
      const text = await res.text();
      if (res.ok) return { ok: true, html: text, status: res.status, bypassed: false, methodUsed: 'Direct POST' };
      if (opts.enableCloudflareBypass && opts.flareSolverrUrl) {
        const { solveWithFlareSolverr } = await import('../../captchaSolver');
        const sr = await solveWithFlareSolverr(url, opts.flareSolverrUrl, Math.round(opts.timeoutMs / 1000));
        if (sr.ok && sr.html) return { ok: true, html: sr.html, status: 200, bypassed: true, methodUsed: 'FlareSolverr Fallback (POST)' };
      }
      return { ok: false, html: null, status: res.status, bypassed: false };
    } catch {
      if (opts.enableCloudflareBypass && opts.flareSolverrUrl) {
        const { solveWithFlareSolverr } = await import('../../captchaSolver');
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
      const ajaxChaptersUrl = `${targetUrl.replace(/\/$/, '')}/ajax/chapters/`;

      const tryNewEndpoint = async (): Promise<void> => {
        const relHtml = await fetchHtml(ajaxChaptersUrl, '');
        if (relHtml && relHtml.trim().length > 2) chaptersHtml = relHtml;
      };

      if (madaraNewChapterEndpointCache.get(config.id) === true) {
        await tryNewEndpoint();
      } else if (mangaId && config.madaraPostReq !== false) {
        const formBody = `action=manga_get_chapters&manga=${mangaId}`;
        const ajaxHtml = await fetchHtml(`${origin}/wp-admin/admin-ajax.php`, formBody);
        if (ajaxHtml && ajaxHtml.trim().length > 2) {
          chaptersHtml = ajaxHtml;
        } else {
          madaraNewChapterEndpointCache.set(config.id, true);
          await tryNewEndpoint();
        }
      } else {
        await tryNewEndpoint();
      }

      if (!chaptersHtml) chaptersHtml = html;
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
    if (chapters.length === 0) {
      return parseGenericChapterListFromHtml(html, origin);
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
    const headers = { ...UA_HEADERS, Referer: origin + '/' };
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
        const src = (
          $(el).attr('data-src') ||
          $(el).attr('data-lazy-src') ||
          $(el).attr('data-cfsrc') ||
          $(el).attr('data-full-url') ||
          $(el).attr('data-original') ||
          $(el).attr('src') ||
          ''
        ).trim();
        if (src) {
          const abs = src.startsWith('http') ? src : `${origin}${src.startsWith('/') ? '' : '/'}${src}`;
          if (isValidPanelImageUrl(abs) && !seenImg.has(abs)) {
            seenImg.add(abs);
            pages.push(abs);
          }
        }
      });
    };
    if (container) extractFrom(container);
    if (pages.length === 0) extractFrom($);
    if (pages.length === 0) {
      const fallbackPages = extractPanelImages(chHtml, origin);
      if (fallbackPages.length > 0) return fallbackPages;
    }
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
      headers: { ...UA_HEADERS, Referer: origin + '/' },
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
      const rawName = el.find('.chapter-name').text().trim() || el.text().trim();
      const cleanName = rawName.replace(/\s*\d+\s+view.*$/i, '').trim();
      const num = extractManhwa18ChapterNumber(href, cleanName || rawName, anchors.length - i);
      chapters.push({ number: num, id: abs, slug: abs, title: cleanName || `Chapter ${num}`, url: abs, pageCount: 0 });
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
      headers: { ...UA_HEADERS, Referer: origin + '/' },
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
      if (!/\.(jpg|jpeg|png|webp)(\?|$)/i.test(src) && !/cdn\.manhwa18/i.test(src) && !/min\.manhwa18/i.test(src)) return;
      if (/logo|avatar|icon|banner|favicon|\/covers\//i.test(src)) return;
      const abs = src.startsWith('http') ? src : `${origin}${src.startsWith('/') ? '' : '/'}${src}`;
      if (!pages.includes(abs)) pages.push(abs);
    };
    $('#chapter-content img, .chapter-content img, #chapter_content img, .read-content img, .page-break img').each((_, el) => {
      pushSrc($(el).attr('data-src') || $(el).attr('data-lazy-src') || $(el).attr('data-original') || $(el).attr('src') || '');
    });
    if (pages.length === 0) {
    }
    return pages.length > 0 ? pages : null;
  } catch (e: any) {
    console.warn('[Manhwa18 Engine] Page extraction failed:', e.message);
    return null;
  }
}

export function extractWPComicsChapterNumber(href: string, name: string, fallback: number): number {
  const rx = /chapter[-_\.\s]*(\d+(?:\.\d+)?)|ch\.?\s*(\d+(?:\.\d+)?)|chap[-_\.\s]*(\d+(?:\.\d+)?)|[-_\./]\s*(\d+(?:\.\d+)?)\s*$/i;
  const m = (href + ' ' + name).match(rx);
  const v = m ? (m[1] || m[2] || m[3] || m[4]) : null;
  const parsed = v ? parseFloat(v) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function fetchWPComicsChapterList(seriesUrl: string, domain: string): Promise<ResolvedChapter[]> {
  try {
    const normalized = normalizeLiveTargetUrl(seriesUrl);
    const origin = (() => { try { return new URL(normalized).origin; } catch { return `https://${domain}`; } })();
    const bypassRes = await fetchWithChallengeBypass(normalized, {
      headers: { ...UA_HEADERS, Referer: origin + '/' },
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
    let anchors = $('#nt_listchapter ul li a, .list-chapter ul li a, .list-chapters li a, div.list-chapter a, #list-chapter a').toArray();
    if (anchors.length === 0) anchors = $('a[href*="/chap-"], a[href*="/chapter-"], a[href*="/chapter/"]').toArray();
    if (anchors.length === 0) return [];
    const chapters: ResolvedChapter[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < anchors.length; i++) {
      const el = $(anchors[i]);
      const href = el.attr('href') || '';
      if (!href || href.startsWith('javascript') || href.startsWith('#')) continue;
      const rawText = el.text().trim();
      if (/read\s+(first|last)/i.test(rawText) || /all\s+chapters/i.test(rawText)) continue;
      const abs = (href.startsWith('http') ? href : `${origin}${href.startsWith('/') ? '' : '/'}${href}`).replace(/\/+$/, '');
      if (seen.has(abs)) continue;
      seen.add(abs);
      const name = el.find('.chapter-name, .chapter-title').text().trim() || rawText;
      const num = extractWPComicsChapterNumber(href, name, anchors.length - i);
      chapters.push({ number: num, id: abs, slug: abs, title: name || `Chapter ${num}`, url: abs, pageCount: 0 });
    }
    return chapters;
  } catch (e: any) {
    console.warn('[WPComics Engine] Chapter list failed:', e.message);
    return [];
  }
}

export async function fetchWPComicsChapterPages(chapterUrl: string, domain: string): Promise<string[] | null> {
  try {
    const origin = (() => { try { return new URL(chapterUrl).origin; } catch { return `https://${domain}`; } })();
    const bypassRes = await fetchWithChallengeBypass(chapterUrl, {
      headers: { ...UA_HEADERS, Referer: origin + '/' },
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
      if (!/\.(jpg|jpeg|png|webp)(\?|$)/i.test(src) && !/cdn/i.test(src)) return;
      if (/logo|avatar|icon|banner|favicon|loading/i.test(src)) return;
      const abs = src.startsWith('http') ? src : `${origin}${src.startsWith('/') ? '' : '/'}${src}`;
      if (!pages.includes(abs)) pages.push(abs);
    };
    $('.reading-detail .page-chapter img, .page-chapter img, .reading-detail img, .chapter-content img, #chapter-content img, .page-break img').each((_, el) => {
      pushSrc($(el).attr('data-original') || $(el).attr('data-src') || $(el).attr('data-lazy-src') || $(el).attr('data-cdn') || $(el).attr('src') || '');
    });
    if (pages.length === 0) {
      $('img.lazy, img[data-src], img[data-original]').each((_, el) => {
        pushSrc($(el).attr('data-original') || $(el).attr('data-src') || $(el).attr('src') || '');
      });
    }
    return pages.length > 0 ? pages : null;
  } catch (e: any) {
    console.warn('[WPComics Engine] Page extraction failed:', e.message);
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
    const res = await fetch(seriesUrl, { headers: { ...UA_HEADERS, Referer: origin + '/' } });
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
    const res = await fetch(chapterUrl, { headers: { ...UA_HEADERS, Referer: origin + '/' } });
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
    const reqHeaders = { ...UA_HEADERS, Referer: origin + '/' };
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
    const reqHeaders = { ...UA_HEADERS, Referer: origin + '/' };
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
  const headers = { ...UA_HEADERS, Referer: origin + '/' };
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
        Referer: targetUrl,
        Cookie: sourceCookieJar.getCookieHeader(domainId),
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
  const { getEngineConfig } = await import('./engineRegistry');
  const { fetchWeebCentralChapterList } = await import('../../scrapers/weebCentral');
  const { fetchAsuraChapterList } = await import('../../scrapers/asuraScans');
  const { fetchFlameChapterList } = await import('../../scrapers/flameComics');

  const engineConfig = getEngineConfig(domainId);
  if (engineConfig && engineConfig.engine === 'manhwa18') {
    const chapters = await fetchManhwa18ChapterList(targetUrl, engineConfig.domain || domainId);
    if (chapters.length > 0) return chapters;
  }
  if (engineConfig && engineConfig.engine === 'madara') {
    const chapters = await fetchMadaraChapterList(targetUrl, engineConfig);
    if (chapters.length > 0) return chapters;
  }
  if (engineConfig && (engineConfig.engine === 'mangareader' || engineConfig.engine === 'mangathemesia')) {
    const chapters = await fetchMangaReaderChapterList(targetUrl);
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
    const { getEngineConfig } = await import('./engineRegistry');
    const { fetchWeebCentralChapterPages, fetchWeebCentralChapterList } = await import('../../scrapers/weebCentral');
    const { fetchAsuraChapterList, ASURA_API_HEADERS } = await import('../../scrapers/asuraScans');
    const { fetchFlameSeriesContext, mapFlameChapters } = await import('../../scrapers/flameComics');

    console.log(`[Live Source Extractor] Extracting Chapter ${chapterNumber} from ${domainId} (${targetUrl})`);

    if (domainId === 'weebcentral' || targetUrl.includes('weebcentral.com')) {
      try {
        const urls = await fetchWeebCentralChapterPages(targetUrl);
        if (urls && urls.length > 0) {
          return urls;
        }
        const chapters = await fetchWeebCentralChapterList(targetUrl);
        const targetCh = matchResolvedChapter(chapters, chapterNumber);
        if (targetCh && targetCh.url) {
          const chUrls = await fetchWeebCentralChapterPages(targetCh.url);
          if (chUrls && chUrls.length > 0) {
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
      if (/\/chapter|[-_/]ch(?:apter)?[-_/]?\d+/i.test(targetUrl)) {
        const directPages = await fetchManhwa18ChapterPages(targetUrl, engCfg.domain || domainId);
        if (directPages && directPages.length > 0) return directPages;
      }
      const mhChapters = await fetchManhwa18ChapterList(targetUrl, engCfg.domain || domainId);
      const mhTarget = matchResolvedChapter(mhChapters, chapterNumber);
      if (mhTarget) {
        const mhPages = await fetchManhwa18ChapterPages(mhTarget.url, engCfg.domain || domainId);
        if (mhPages && mhPages.length > 0) return mhPages;
      }
    }
    if (engCfg && (engCfg.engine === 'mangareader' || engCfg.engine === 'mangathemesia')) {
      if (/\/chapter|[-_/]ch(?:apter)?[-_/]?\d+/i.test(targetUrl)) {
        const directPages = await fetchMangaReaderChapterPages(targetUrl);
        if (directPages && directPages.length > 0) return directPages;
      }
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
    const reqHeaders = { ...UA_HEADERS, Referer: origin + '/' };
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
    }

  } catch (err) {
    console.error(`[Live Source Extractor] Error extracting from ${domainId}:`, err);
  }

  return null;
}

