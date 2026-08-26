// ============================================================================
// Chapter Page Panel Image Extraction Logic
// ============================================================================

import * as cheerio from 'cheerio';
import { isAdImageSrc, isAdUrl, stripAdElements } from '../../adFilter';

export function isValidPanelImageUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  const u = url.trim();
  if (!u.startsWith('http://') && !u.startsWith('https://')) return false;
  if (/^(data:|blob:|javascript:|#)/i.test(u)) return false;

  if (/(logo|avatar|banner|covers|discord|tracker|pixel|top_ad|\/ads\/|\/banners\/|\/covers\/|\/avatar\/|\/tracker\/|\.gif(\?|$))/i.test(u)) return false;
  if (/placeholder|blank\.(jpg|jpeg|png|webp|gif)|loading\.(jpg|jpeg|png|webp|gif)|spinner|lazyload|lazy-load|no-image|noimage|thumb-placeholder/i.test(u)) return false;
  if (/doubleclick|googleadservices|pagead2|googlesyndication|adservice/i.test(u)) return false;
  if (isAdUrl(u)) return false;
  if (isAdImageSrc(u, 'https://example.com')) return false;

  const isImageExt = /\.(jpg|jpeg|png|webp|avif)(\?|$)/i.test(u);
  const isCdnPath =
    /\/(images|uploads|manga|chapters|media|content|page|wp-content\/uploads)\//i.test(u) ||
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
    stripAdElements($);
    const containerSelectors = [
      '#chapter-content img',
      '.chapter-content img',
      '#chapter_content img',
      '#readerarea img',
      '.reading-content img',
      '.read-content img',
      '.viewer-cnt img',
      '#viewer img',
      '.page-break img',
      '.entry-content img',
      'div#images img',
      '.chapter-image img',
      '.vung-doc img',
      '.content-doc img',
      'div.separator img',
      'div.separator a img',
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
      const attrMatch = attrs.match(
        /(?:data-src|data-lazy-src|data-cfsrc|data-full-url|data-original|data-url|data-img|data-image|data-page-url|data-srcset|srcset|src)=["']([^"']+)["']/i
      );
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

    const scriptArrayRegex =
      /(?:var|let|const|window\.)\s*(?:pages|images|chapter_images|chapter_data|img_list)\s*=\s*(\[[\s\S]*?\]|{[\s\S]*?})/gi;
    let arrayMatch: RegExpExecArray | null;
    while ((arrayMatch = scriptArrayRegex.exec(htmlText)) !== null) {
      try {
        const rawJson = arrayMatch[1];
        const parsed = JSON.parse(rawJson);
        const list = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed?.images)
          ? parsed.images
          : Array.isArray(parsed?.pages)
          ? parsed.pages
          : [];
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
          const chImgs =
            parsed?.chapter?.images ||
            parsed?.props?.pageProps?.chapter?.images ||
            parsed?.pageProps?.chapter?.images;
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
