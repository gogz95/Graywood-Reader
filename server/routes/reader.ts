// ============================================================================
// READER & IMAGE PROXY ROUTER
// Webtoon/manga reader chapter resolution, image streaming, and image proxying
// ============================================================================

import { Router, Request, Response } from 'express';
import { MangaItem, isNsfwManga } from '../../src/types';
import { SqliteDb } from '../../sqlite-db';
import {
  mangaDatabase,
  resolveRequestUserId,
  syncAddOrUpdateManga,
  isNsfwAccessAllowed,
} from '../appState';
import {
  fetchWithSsrfGuard,
  assertSafeProxyTarget,
  MAX_PROXY_IMAGE_BYTES,
} from '../security';
import { imageCacheService } from '../services/imageCache';
import { eventBus } from '../services/eventBus';
import { fetchMangaDex } from '../services/metadataService';
import { KOTATSU_SOURCES } from '../sources/sourcesCatalog';
import {
  kotatsuImageEngine,
  matchLiveDomain,
  fetchLiveChapterList,
  autoDiscoverLiveSourceForManga,
  extractPanelImages,
  parseSrcsetCandidate,
  isValidPanelImageUrl,
} from '../services/crawlerEngine';

export const readerRouter = Router();

export { extractPanelImages, parseSrcsetCandidate, isValidPanelImageUrl };

export function resolveManga(mangaId: string): MangaItem | undefined {
  if (!mangaId) return undefined;
  return SqliteDb.getMangaById(mangaId) || mangaDatabase.find((m) => m.id === mangaId || m.apiId === mangaId);
}

function escapeXml(unsafe: string | number): string {
  return String(unsafe ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Universal Image Proxy Engine (Bypasses Hotlinking Restrictions & SSL blocks)
export const handleImageProxyRequest = async (req: Request, res: Response) => {
  let targetUrl = req.query.url as string;
  const sourceUrl = req.query.sourceUrl as string;
  const pageUrl = req.query.pageUrl as string;

  if (!targetUrl) {
    return res.status(400).json({ error: "Missing required 'url' parameter" });
  }

  let unwrapGuard = 0;
  while (
    unwrapGuard++ < 5 &&
    (targetUrl.includes('/api/mangadex/image-proxy?url=') ||
      targetUrl.includes('/api/reader/proxy-image?url=') ||
      targetUrl.includes('/api/proxy/image?url='))
  ) {
    const match = targetUrl.match(/[?&]url=([^&]+)/);
    if (match && match[1]) {
      try {
        targetUrl = decodeURIComponent(match[1]);
      } catch {
        break;
      }
    } else {
      break;
    }
  }

  if (targetUrl.startsWith('/api/reader/panel-image')) {
    return res.redirect(targetUrl);
  }

  if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
    return res.status(400).json({ error: 'Proxy target must be an absolute http(s) URL' });
  }

  try {
    await assertSafeProxyTarget(targetUrl);
  } catch (err: any) {
    console.warn(`[Proxy Image Engine] Blocked unsafe proxy target: ${err?.message || err}`);
    return res.status(403).json({ error: 'Blocked proxy target', message: String(err?.message || err) });
  }

  if (imageCacheService.matchesEtag(targetUrl, req.headers['if-none-match'] as string)) {
    return res.status(304).end();
  }

  try {
    const cached = await imageCacheService.fetchCoalesced(targetUrl, async () => {
      let referer: string;
      if (pageUrl) {
        referer = pageUrl;
      } else if (targetUrl.includes('pornwa') || targetUrl.includes('manhwa18')) {
        referer = 'https://manhwa18.com/';
      } else if (sourceUrl) {
        try {
          referer = new URL(sourceUrl).origin + '/';
        } catch {
          referer = 'https://mangadex.org';
        }
      } else {
        try {
          referer = new URL(targetUrl).origin + '/';
        } catch {
          referer = 'https://mangadex.org';
        }
      }

      const response = await fetchWithSsrfGuard(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
          'Referer': referer,
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(20000),
      });

      if (!response.ok) {
        console.warn(`[Proxy Image Engine] Host returned HTTP ${response.status} for ${targetUrl}`);
        return null;
      }

      const arrayBuf = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      if (buffer.length > MAX_PROXY_IMAGE_BYTES) {
        throw new Error('Proxied image exceeds size cap');
      }

      const contentType = response.headers.get('content-type') || 'image/jpeg';
      return { buffer, contentType };
    });

    if (!cached) {
      return res.redirect(`/api/reader/panel-image?manga=Page%20Panel&chapter=1&page=1`);
    }

    if (req.headers['if-none-match'] === cached.etag) {
      return res.status(304).end();
    }

    res.setHeader('Content-Type', cached.contentType);
    res.setHeader('ETag', cached.etag);
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    res.setHeader('Content-Disposition', 'inline');
    res.end(cached.buffer);
  } catch (err: any) {
    console.error(`[Proxy Image Engine] Error fetching target image (${targetUrl}):`, err?.message || err);
    if (!res.headersSent) {
      res.redirect(`/api/reader/panel-image?manga=Page%20Panel&chapter=1&page=1`);
    } else {
      res.end();
    }
  }
};

// Image proxy endpoints
readerRouter.get('/api/mangadex/image-proxy', handleImageProxyRequest);
readerRouter.get('/api/proxy/image', handleImageProxyRequest);
readerRouter.get('/api/reader/proxy-image', handleImageProxyRequest);

// ── GET /api/reader/chapters/:mangaId - Get chapter list for a series ──────────
readerRouter.get('/api/reader/chapters/:mangaId', async (req, res) => {
  const { mangaId } = req.params;
  const order = (req.query.order as string) || 'desc';

  let manga = resolveManga(mangaId);
  let liveSourceUrl = (req.query.url as string) || manga?.sourceUrl || '';

  if (!liveSourceUrl && mangaId) {
    if (mangaId.startsWith('asura_')) {
      const slug = mangaId.replace('asura_', '');
      liveSourceUrl = `https://asurascans.com/comics/${slug}`;
    } else if (mangaId.startsWith('flame_')) {
      const slug = mangaId.replace('flame_', '');
      liveSourceUrl = `https://flamecomics.xyz/series/${slug}`;
    } else if (mangaId.startsWith('kotatsu_')) {
      for (const src of KOTATSU_SOURCES) {
        if (mangaId.startsWith(`kotatsu_${src.id}_`)) {
          const pathOrSlug = mangaId.replace(`kotatsu_${src.id}_`, '');
          liveSourceUrl = pathOrSlug.startsWith('http') ? pathOrSlug : `${src.baseUrl.replace(/\/$/, '')}/${pathOrSlug}`;
          break;
        }
      }
    }
  }

  if (!manga && !liveSourceUrl) {
    return res.status(404).json({ error: "Manga not found" });
  }

  // Gate 18+ / NSFW titles for guest users
  const isChaptersNsfw = Boolean(
    (manga && isNsfwManga(manga)) ||
    (liveSourceUrl && /manhwa18|adultwebtoon|hentai|nsfw|porn|doujin/i.test(liveSourceUrl))
  );
  if (isChaptersNsfw && !isNsfwAccessAllowed(req)) {
    return res.status(403).json({
      error: "Authentication required",
      message: "18+ Adult content is restricted for guest users. Please sign in to access chapters.",
      isNsfwRestricted: true,
    });
  }

  if (manga && liveSourceUrl && liveSourceUrl.toLowerCase().includes('mangadex.org') && manga.availableSources?.length) {
    const alt = manga.availableSources.find(
      (s) => s.sourceUrl && s.sourceUrl.startsWith('http') && !s.sourceUrl.toLowerCase().includes('mangadex.org')
    );
    if (alt) liveSourceUrl = alt.sourceUrl;
  }

  if (manga && (!liveSourceUrl || liveSourceUrl.toLowerCase().includes('mangadex.org'))) {
    const autoSource = await autoDiscoverLiveSourceForManga(manga);
    if (autoSource) {
      liveSourceUrl = autoSource.sourceUrl;
    }
  }

  if (liveSourceUrl && (liveSourceUrl.startsWith('http://') || liveSourceUrl.startsWith('https://')) && !liveSourceUrl.toLowerCase().includes('mangadex.org')) {
    const matchedDomain = matchLiveDomain(liveSourceUrl || '');
    const domainId = matchedDomain ? matchedDomain.id : 'general';
    const sourceLabel = matchedDomain ? matchedDomain.name : 'Webtoon Source';
    try {
      const realChapters = await fetchLiveChapterList(liveSourceUrl, domainId);
      if (realChapters.length > 0) {
        const sorted = [...realChapters].sort((a, b) =>
          order === 'asc' ? a.number - b.number : b.number - a.number
        );
        return res.json(
          sorted.map((c) => ({
            id: `${domainId}_${c.id}`,
            chapterNumber: c.number,
            title: c.title,
            releaseDate: '',
            scanGroup: sourceLabel,
            pageCount: c.pageCount,
            isRead: manga ? c.number <= (manga.currentChapter || 0) : false,
          }))
        );
      }
    } catch (err) {
      console.error("Real chapter list fetch error:", err);
    }
  }

  // MangaDex Direct Fallback
  const mangaDexId = manga?.apiId || (mangaId && mangaId.startsWith('md_') ? mangaId.replace('md_', '') : null) || (manga?.id && manga.id.startsWith('md_') ? manga.id.replace('md_', '') : null);
  if (mangaDexId) {
    try {
      const feedRes = await fetchMangaDex(
        `https://api.mangadex.org/manga/${mangaDexId}/feed?limit=250&translatedLanguage[]=en&order[chapter]=desc&includeExternalUrl=0`
      );
      if (feedRes && feedRes.ok) {
        const data = await feedRes.json();
        const rawChapters: any[] = data.data || [];
        if (rawChapters.length > 0) {
          const mapped = rawChapters
            .filter((c) => c.attributes?.chapter && !isNaN(parseFloat(c.attributes.chapter)))
            .map((c) => {
              const chNum = parseFloat(c.attributes.chapter);
              return {
                id: `md_${c.id}`,
                chapterNumber: chNum,
                title: c.attributes.title || `Chapter ${c.attributes.chapter}`,
                releaseDate: c.attributes.publishAt ? c.attributes.publishAt.split('T')[0] : '',
                scanGroup: 'MangaDex (Scanlation)',
                pageCount: c.attributes.pages || 0,
                isRead: manga ? chNum <= (manga.currentChapter || 0) : false,
              };
            });

          if (mapped.length > 0) {
            const sorted = [...mapped].sort((a, b) =>
              order === 'asc' ? a.chapterNumber - b.chapterNumber : b.chapterNumber - a.chapterNumber
            );
            return res.json(sorted);
          }
        }
      }
    } catch (err) {
      console.warn('[MangaDex Chapter Fallback] Feed fetch failed:', err);
    }
  }

  const totalCh = manga ? Math.max(manga.latestChapter, manga.currentChapter, 10) : 10;
  const chapters: any[] = [];
  for (let c = 1; c <= totalCh; c++) {
    chapters.push({
      id: `ch_${manga?.id || mangaId}_${c}`,
      chapterNumber: c,
      title: `Chapter ${c}`,
      releaseDate: '',
      scanGroup: '🔹 Estimated (Source Unavailable)',
      pageCount: 0,
      isRead: manga ? c <= manga.currentChapter : false,
      isEstimated: true,
    });
  }

  if (order === 'asc') {
    chapters.sort((a, b) => a.chapterNumber - b.chapterNumber);
  } else {
    chapters.sort((a, b) => b.chapterNumber - a.chapterNumber);
  }

  res.json(chapters);
});

// ── GET /api/reader/sources/:mangaId - List / discover available live reading sources ──
readerRouter.get('/api/reader/sources/:mangaId', async (req, res) => {
  const { mangaId } = req.params;
  const manga = resolveManga(mangaId);
  if (!manga) return res.status(404).json({ error: "Manga not found" });

  const existing = (manga.availableSources || []).filter(
    (s) => s && s.sourceUrl && !s.sourceUrl.toLowerCase().includes('mangadex.org')
  );

  res.json({
    mangaId: manga.id,
    title: manga.title,
    primarySource: manga.sourceUrl,
    sources: existing,
  });
});

// ── GET /api/reader/chapter-pages - Resolve chapter page image URLs ───────────
readerRouter.get('/api/reader/chapter-pages', async (req, res) => {
  const mangaId = req.query.mangaId as string;
  const chapterNumber = Math.max(1, parseFloat(req.query.chapterNumber as string) || 1);
  let chapterId = (req.query.chapterId as string) || '';

  const manga = resolveManga(String(mangaId || '')) || mangaDatabase.find((m) => m.apiId === mangaId);
  let mangaTitle = (req.query.title as string) || (manga ? manga.title : 'Webtoon Series');
  const totalChapters = manga ? Math.max(manga.latestChapter || 1, manga.currentChapter || 1, chapterNumber) : 1;

  let targetUrl = (req.query.url as string) || manga?.sourceUrl || '';

  if (!targetUrl && mangaId) {
    if (mangaId.startsWith('asura_')) {
      const slug = mangaId.replace('asura_', '');
      targetUrl = `https://asurascans.com/comics/${slug}`;
      if (mangaTitle === 'Webtoon Series') {
        mangaTitle = slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      }
    } else if (mangaId.startsWith('flame_')) {
      const slug = mangaId.replace('flame_', '');
      targetUrl = `https://flamecomics.xyz/series/${slug}`;
      if (mangaTitle === 'Webtoon Series') {
        mangaTitle = slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      }
    } else if (mangaId.startsWith('kotatsu_')) {
      for (const src of KOTATSU_SOURCES) {
        if (mangaId.startsWith(`kotatsu_${src.id}_`)) {
          const pathOrSlug = mangaId.replace(`kotatsu_${src.id}_`, '');
          targetUrl = pathOrSlug.startsWith('http') ? pathOrSlug : `${src.baseUrl.replace(/\/$/, '')}/${pathOrSlug}`;
          break;
        }
      }
    }
  }

  if (targetUrl && targetUrl.toLowerCase().includes('mangadex.org') && manga?.availableSources?.length) {
    const altSource = manga.availableSources.find(
      (s) => s.sourceUrl && s.sourceUrl.startsWith('http') && !s.sourceUrl.toLowerCase().includes('mangadex.org')
    );
    if (altSource) {
      console.log(`[Reader Stream Engine] Promoting alternative live source "${altSource.sourceName}" over MangaDex metadata-only sourceUrl.`);
      targetUrl = altSource.sourceUrl;
    }
  }

  if (manga && (!targetUrl || targetUrl.toLowerCase().includes('mangadex.org'))) {
    const autoSource = await autoDiscoverLiveSourceForManga(manga);
    if (autoSource) {
      targetUrl = autoSource.sourceUrl;
    }
  }

  // Gate 18+ / NSFW titles for guest users
  const isPagesNsfw = Boolean(
    (manga && isNsfwManga(manga)) ||
    (targetUrl && /manhwa18|adultwebtoon|hentai|nsfw|porn|doujin/i.test(targetUrl))
  );
  if (isPagesNsfw && !isNsfwAccessAllowed(req)) {
    return res.status(403).json({
      error: "Authentication required",
      message: "18+ Adult content is restricted for guest users. Please sign in to read this series.",
      isNsfwRestricted: true,
    });
  }

  if (targetUrl && (targetUrl.startsWith('http://') || targetUrl.startsWith('https://')) && !targetUrl.toLowerCase().includes('mangadex.org')) {
    const matchedDomain = matchLiveDomain(targetUrl);
    const domainId = matchedDomain ? matchedDomain.id : 'general';

    try {
      const realPages = await kotatsuImageEngine.getChapterPages(targetUrl, domainId, chapterNumber);

      if (realPages && realPages.length > 0) {
        const proxiedPages = realPages.map((pageUrl, idx) => {
          const cleanUrl = pageUrl.trim();
          if (cleanUrl.startsWith('/api/reader/panel-image')) return cleanUrl;
          if (cleanUrl.startsWith('/api/')) return cleanUrl;
          return `/api/reader/proxy-image?url=${encodeURIComponent(cleanUrl)}&sourceUrl=${encodeURIComponent(targetUrl)}&page=${idx + 1}&manga=${encodeURIComponent(mangaTitle)}`;
        });

        return res.json({
          mangaId,
          chapterNumber,
          chapterId: chapterId || `ch_${chapterNumber}`,
          totalPages: proxiedPages.length,
          pages: proxiedPages,
          sourceType: 'live_webtoon_crawler',
          sourceDomain: matchedDomain ? matchedDomain.domain : 'webtoon-source',
          sourceName: matchedDomain ? matchedDomain.name : 'Live Webtoon Source',
          isRealImages: true,
          notice: `Streaming ${proxiedPages.length} high-res panels from ${matchedDomain ? matchedDomain.name : 'Source'}.`,
        });
      }
    } catch (err: any) {
      console.error("[Reader Stream Engine] Error crawling real webtoon pages:", err?.message || err);
    }
  }

  // MangaDex direct reading fallback
  let mdChapterUuid = chapterId.startsWith('md_') ? chapterId.replace('md_', '') : null;
  const mangaDexId = manga?.apiId || (mangaId && mangaId.startsWith('md_') ? mangaId.replace('md_', '') : null);

  if (!mdChapterUuid && mangaDexId) {
    try {
      const feedRes = await fetchMangaDex(
        `https://api.mangadex.org/manga/${mangaDexId}/feed?limit=100&translatedLanguage[]=en&order[chapter]=desc&includeExternalUrl=0`
      );
      if (feedRes && feedRes.ok) {
        const data = await feedRes.json();
        const rawChapters: any[] = data.data || [];
        const matched = rawChapters.find((c: any) => parseFloat(c.attributes?.chapter) === chapterNumber);
        if (matched && matched.id) {
          mdChapterUuid = matched.id;
        }
      }
    } catch (err) {
      console.warn('[MangaDex Direct Stream] Feed resolution error:', err);
    }
  }

  if (mdChapterUuid) {
    try {
      const atHomeRes = await fetchMangaDex(`https://api.mangadex.org/at-home/server/${mdChapterUuid}`);
      if (atHomeRes && atHomeRes.ok) {
        const atHomeData = await atHomeRes.json();
        const baseUrl = atHomeData.baseUrl;
        const chapterHash = atHomeData.chapter?.hash;
        const pageFileNames: string[] = atHomeData.chapter?.data || [];

        if (baseUrl && chapterHash && pageFileNames.length > 0) {
          const proxiedPages = pageFileNames.map((fileName, idx) => {
            const directCdnUrl = `${baseUrl}/data/${chapterHash}/${fileName}`;
            return `/api/mangadex/image-proxy?url=${encodeURIComponent(directCdnUrl)}&page=${idx + 1}&manga=${encodeURIComponent(mangaTitle)}`;
          });

          return res.json({
            mangaId,
            chapterNumber,
            chapterId: `md_${mdChapterUuid}`,
            totalPages: proxiedPages.length,
            pages: proxiedPages,
            sourceType: 'mangadex_athome_cdn',
            sourceDomain: 'mangadex.org',
            sourceName: 'MangaDex (@Home CDN)',
            isRealImages: true,
            notice: `Streaming ${proxiedPages.length} high-res panels directly from MangaDex @Home CDN.`,
          });
        }
      }
    } catch (err) {
      console.warn('[MangaDex Direct Stream] At-Home fetch error:', err);
    }
  }

  // Placeholder fallback panel
  const totalPages = 14;
  const placeholderPages: string[] = [];
  for (let p = 1; p <= totalPages; p++) {
    placeholderPages.push(
      `/api/reader/panel-image?manga=${encodeURIComponent(mangaTitle)}&chapter=${chapterNumber}&totalPages=${totalPages}&page=${p}&type=${encodeURIComponent(manga?.type || 'manhwa')}&genre=${encodeURIComponent(manga?.genres?.[0] || 'Action')}`
    );
  }

  return res.json({
    mangaId,
    chapterNumber,
    chapterId: chapterId || `ch_${chapterNumber}`,
    totalPages: placeholderPages.length,
    pages: placeholderPages,
    sourceType: 'offline_aesthetic_generator',
    sourceDomain: 'graywood.local',
    sourceName: 'Offline Aesthetic Reader Generator',
    isRealImages: false,
    notice: `Generating ${placeholderPages.length} styled aesthetic panels for Chapter ${chapterNumber}.`,
  });
});

// ── GET /api/reader/panel-image - SVG Generator for unavailable / aesthetic panels ─
readerRouter.get('/api/reader/panel-image', (req, res) => {
  const manga = escapeXml((req.query.manga as string) || 'Webtoon');
  const chapter = Math.max(1, Math.floor(Number(req.query.chapter) || 1));
  const totalPages = Math.max(1, Math.floor(Number(req.query.totalPages) || 14));
  const page = Math.max(1, Math.floor(Number(req.query.page) || 1));
  const type = (req.query.type as string) || 'manhwa';
  const genre = String((req.query.genre as string) || 'Action').toLowerCase();

  const rawTitle = String((req.query.manga as string) || 'Series');
  if (/page panel|missing|unavailable|content unavailable/i.test(rawTitle) || String(req.query.reason || '') === 'unavailable') {
    const msg = escapeXml(rawTitle === 'Page Panel' ? 'Content Unavailable' : rawTitle);
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200" viewBox="0 0 800 1200">
<rect width="100%" height="100%" fill="#0b1220"/>
<rect x="40" y="360" width="720" height="420" rx="24" fill="#111827" stroke="#f59e0b" stroke-width="2"/>
<text x="400" y="480" text-anchor="middle" fill="#f8fafc" font-family="system-ui,sans-serif" font-size="32" font-weight="800">Content Unavailable</text>
<text x="400" y="540" text-anchor="middle" fill="#94a3b8" font-family="system-ui,sans-serif" font-size="18">${msg}</text>
<text x="400" y="600" text-anchor="middle" fill="#64748b" font-family="system-ui,sans-serif" font-size="15">Chapter may be missing, source blocked, or URL stale.</text>
<text x="400" y="650" text-anchor="middle" fill="#475569" font-family="system-ui,sans-serif" font-size="14">Try another chapter or source from the series detail page.</text>
</svg>`;
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', 'attachment; filename="panel.svg"');
    return res.send(svg);
  }
  const chapterNext = escapeXml(chapter + 1);

  let bgGrad1 = '#0f172a';
  let bgGrad2 = '#1e1b4b';
  let auraColor = '#f59e0b';
  let accentColor = '#38bdf8';
  let soundEffect = 'BOOM!';
  let dialogueText = 'This energy... It is breaking through my limits!';

  if (genre.toLowerCase().includes('cultivation') || type === 'manhua') {
    bgGrad1 = '#090d16';
    bgGrad2 = '#1a0d2e';
    auraColor = '#ef4444';
    accentColor = '#f97316';
    soundEffect = 'SHING!';
    dialogueText = 'Kowtow three times and I shall leave your corpse intact!';
  } else if (genre.toLowerCase().includes('system') || genre.toLowerCase().includes('dungeon')) {
    bgGrad1 = '#030712';
    bgGrad2 = '#0284c7';
    auraColor = '#06b6d4';
    accentColor = '#3b82f6';
    soundEffect = 'SYSTEM NOTIFICATION';
    dialogueText = '[ Quest Completed: Defeat the Dungeon Monarch ]';
  } else if (genre.toLowerCase().includes('murim') || genre.toLowerCase().includes('martial')) {
    bgGrad1 = '#111827';
    bgGrad2 = '#312e81';
    auraColor = '#eab308';
    accentColor = '#a855f7';
    soundEffect = 'SWOOSH!';
    dialogueText = 'The Heavenly Sword Technique has no equal under heaven.';
  }

  const isTitleCoverPage = page === 1;
  const isEndingPage = page === totalPages;
  const svgWidth = 800;
  const svgHeight = 1200;

  let panelContent = '';

  if (isTitleCoverPage) {
    panelContent = `
      <rect width="100%" height="100%" fill="url(#bgGrad)"/>
      <rect x="30" y="30" width="740" height="1140" rx="20" fill="none" stroke="${auraColor}" stroke-width="4" opacity="0.6"/>
      <circle cx="400" cy="450" r="220" fill="${auraColor}" opacity="0.15" filter="url(#blur)"/>
      <polygon points="400,280 480,500 320,500" fill="url(#auraGrad)" opacity="0.8"/>
      
      <text x="400" y="160" text-anchor="middle" fill="#f8fafc" font-family="system-ui, sans-serif" font-size="22" font-weight="900" letter-spacing="4">
        ${type === 'manhwa' ? '🇰🇷 KOREAN WEBTOON' : '🇨🇳 CHINESE MANHUA'}
      </text>
      
      <text x="400" y="230" text-anchor="middle" fill="#ffffff" font-family="system-ui, sans-serif" font-size="36" font-weight="900">
        ${manga}
      </text>

      <rect x="250" y="270" width="300" height="40" rx="20" fill="${auraColor}"/>
      <text x="400" y="296" text-anchor="middle" fill="#090d16" font-family="system-ui, sans-serif" font-size="20" font-weight="800">
        CHAPTER ${chapter}
      </text>

      <g transform="translate(200, 380)">
        <path d="M200,50 L250,220 L320,220 L200,380 L180,250 L100,250 Z" fill="${accentColor}" opacity="0.9"/>
        <circle cx="200" cy="180" r="90" fill="#ffffff" opacity="0.1"/>
        <text x="200" y="210" text-anchor="middle" fill="#fef08a" font-family="Impact, sans-serif" font-size="64" font-weight="bold" transform="rotate(-8 200 210)">
          ${soundEffect}
        </text>
      </g>

      <path d="M 120 850 Q 120 800 170 800 L 630 800 Q 680 800 680 850 L 680 930 Q 680 980 630 980 L 320 980 L 260 1030 L 280 980 L 170 980 Q 120 980 120 930 Z" fill="#0f172a" stroke="${auraColor}" stroke-width="3"/>
      <text x="400" y="890" text-anchor="middle" fill="#f8fafc" font-family="system-ui, sans-serif" font-size="22" font-weight="700">
        ${escapeXml(dialogueText)}
      </text>

      <text x="400" y="1120" text-anchor="middle" fill="#94a3b8" font-family="sans-serif" font-size="16" font-weight="600">
        [ Page 1 / ${totalPages} • Scroll down for next panel ]
      </text>
    `;
  } else if (isEndingPage) {
    panelContent = `
      <rect width="100%" height="100%" fill="#090d16"/>
      <rect x="40" y="100" width="720" height="1000" rx="16" fill="#1e293b" stroke="${auraColor}" stroke-width="2"/>
      
      <text x="400" y="280" text-anchor="middle" fill="#fef08a" font-family="Impact, sans-serif" font-size="72" font-weight="bold" transform="rotate(-5 400 280)">
        TO BE CONTINUED...
      </text>

      <circle cx="400" cy="520" r="140" fill="${auraColor}" opacity="0.2" filter="url(#blur)"/>
      <path d="M 320 480 L 480 480 L 400 620 Z" fill="${auraColor}"/>

      <rect x="150" y="700" width="500" height="120" rx="16" fill="#0f172a" stroke="#334155" stroke-width="2"/>
      <text x="400" y="750" text-anchor="middle" fill="#f8fafc" font-family="system-ui, sans-serif" font-size="24" font-weight="800">
        End of Chapter ${chapter}
      </text>
      <text x="400" y="785" text-anchor="middle" fill="#38bdf8" font-family="system-ui, sans-serif" font-size="16" font-weight="600">
        Click "Next Chapter" to continue reading Chapter ${chapterNext}!
      </text>
    `;
  } else {
    const panelY1 = 80;
    const panelH1 = 480;
    const panelY2 = 620;
    const panelH2 = 480;

    panelContent = `
      <rect width="100%" height="100%" fill="#090d16"/>
      
      <g>
        <rect x="40" y="${panelY1}" width="720" height="${panelH1}" rx="12" fill="url(#bgGrad)" stroke="#334155" stroke-width="2"/>
        <line x1="40" y1="80" x2="760" y2="560" stroke="${auraColor}" stroke-width="2" opacity="0.3"/>
        <line x1="760" y1="80" x2="40" y2="560" stroke="${auraColor}" stroke-width="2" opacity="0.3"/>
        <circle cx="${300 + (page * 20) % 200}" cy="320" r="120" fill="${auraColor}" opacity="0.25" filter="url(#blur)"/>
        <path d="M 80 130 Q 80 100 110 100 L 520 100 Q 550 100 550 130 L 550 190 Q 550 220 520 220 L 220 220 L 180 250 L 190 220 L 110 220 Q 80 220 80 190 Z" fill="#0f172a" stroke="${auraColor}" stroke-width="2"/>
        <text x="315" y="150" text-anchor="middle" fill="#ffffff" font-family="system-ui, sans-serif" font-size="18" font-weight="700">
          Page ${escapeXml(page)}: "Unleashing the ${escapeXml(genre)} aura power!"
        </text>
        <text x="315" y="180" text-anchor="middle" fill="#cbd5e1" font-family="system-ui, sans-serif" font-size="14">
          The power level is increasing exponentially...
        </text>
        <text x="620" y="420" text-anchor="middle" fill="#fef08a" font-family="Impact, sans-serif" font-size="48" transform="rotate(-15 620 420)">
          ${page % 2 === 0 ? 'WHAM!' : 'KRAKOOM!'}
        </text>
      </g>

      <g>
        <rect x="40" y="${panelY2}" width="720" height="${panelH2}" rx="12" fill="#020617" stroke="#334155" stroke-width="2"/>
        <path d="M100,680 L700,680 L600,1020 L200,1020 Z" fill="${auraColor}" opacity="0.1"/>
        <path d="M 220 700 Q 220 670 250 670 L 680 670 Q 710 670 710 700 L 710 760 Q 710 790 680 790 L 400 790 L 360 820 L 370 790 L 250 790 Q 220 790 220 760 Z" fill="#1e293b" stroke="${accentColor}" stroke-width="2"/>
        <text x="465" y="720" text-anchor="middle" fill="#f8fafc" font-family="system-ui, sans-serif" font-size="18" font-weight="700">
          "Observe closely! This is the ultimate stage!"
        </text>
        <text x="465" y="750" text-anchor="middle" fill="#94a3b8" font-family="system-ui, sans-serif" font-size="14">
          [ Reading Chapter ${chapter} • Panel ${page} of ${totalPages} ]
        </text>
        <circle cx="400" cy="940" r="60" fill="${accentColor}" opacity="0.3"/>
      </g>

      <text x="400" y="1160" text-anchor="middle" fill="#64748b" font-family="sans-serif" font-size="14" font-weight="600">
        Graywood Reader and Tracker • Page ${page} / ${totalPages}
      </text>
    `;
  }

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}">
      <defs>
        <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${bgGrad1}"/>
          <stop offset="100%" stop-color="${bgGrad2}"/>
        </linearGradient>
        <linearGradient id="auraGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="${auraColor}" stop-opacity="0.9"/>
          <stop offset="100%" stop-color="${accentColor}" stop-opacity="0.2"/>
        </linearGradient>
        <filter id="blur" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="25"/>
        </filter>
      </defs>
      ${panelContent}
    </svg>
  `;

  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('Content-Disposition', 'attachment; filename="panel.svg"');
  res.send(svg);
});

// ── POST /api/reader/mark-read - Mark chapter as read ─────────────────────────
readerRouter.post('/api/reader/mark-read', (req, res) => {
  const { mangaId, chapterNumber, manga: mangaPayload } = req.body || {};
  let manga = SqliteDb.getMangaById(String(mangaId)) || mangaDatabase.find((m) => m.id === mangaId);
  if (!manga && mangaPayload && typeof mangaPayload === 'object') {
    const rawManga: MangaItem = {
      id: String(mangaId || mangaPayload.id || `manga_${Date.now()}`),
      title: String(mangaPayload.title || 'Untitled Series'),
      altTitles: Array.isArray(mangaPayload.altTitles) ? mangaPayload.altTitles : [],
      type: ['manga', 'manhwa', 'manhua'].includes(mangaPayload.type) ? mangaPayload.type : 'manhwa',
      coverImage: String(mangaPayload.coverImage || ''),
      description: String(mangaPayload.description || ''),
      genres: Array.isArray(mangaPayload.genres) ? mangaPayload.genres : ['Action'],
      status: 'reading',
      currentChapter: Number(chapterNumber) || 0,
      totalChapters: mangaPayload.totalChapters ? Number(mangaPayload.totalChapters) : null,
      latestChapter: Number(mangaPayload.latestChapter) || Number(chapterNumber) || 1,
      rating: Number(mangaPayload.rating) || 9.0,
      sourceUrl: String(mangaPayload.sourceUrl || ''),
      sourceName: String(mangaPayload.sourceName || 'Live Source'),
      autoUpdateEnabled: true,
      notes: '',
      addedAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      lastReadAt: new Date().toISOString(),
      isFavorite: false,
    };
    syncAddOrUpdateManga(rawManga);
    manga = rawManga;
  }

  if (!manga) {
    return res.status(404).json({ error: "Manga not found" });
  }

  const userId = resolveRequestUserId(req) || 'usr_guest';
  const newChapterNum = Math.max(Number(chapterNumber) || 1, 0);
  SqliteDb.setUserLibraryChapter(userId, manga.id, newChapterNum, {
    status: manga.status === 'plan_to_read' ? 'reading' : manga.status,
  });
  // Auto-add to user favorites / library on reading
  SqliteDb.setUserFavorite(userId, manga.id, true);

  // Keep page-level progress row in sync for resume
  SqliteDb.upsertReadingProgress({
    manga_id: manga.id,
    user_id: userId,
    chapter_number: newChapterNum,
    page_index: 0,
    percent: 100,
  });

  try {
    SqliteDb.recordReadingActivity(userId, { chaptersRead: 1 });
  } catch (err) {
    console.error('[Progress Engine] Failed to record reading activity:', err);
  }

  const overlay = SqliteDb.applyUserOverlay([manga], userId)[0];
  try {
    eventBus.publish('chapter_read', {
      mangaId: manga.id,
      chapterNumber: newChapterNum,
      manga: overlay,
    }, userId);
  } catch (err) {
    console.error('[EventBus] Failed to publish chapter_read event:', err);
  }

  res.json({
    success: true,
    manga: overlay,
    message: `Marked Chapter ${newChapterNum} as read`,
  });
});

// ── Discord Rich Presence (RPC) Endpoint ──────────────────────────────────────
import { updateDiscordPresence } from '../services/discordRpcService';

readerRouter.post('/api/reader/discord-presence', (req, res) => {
  const { mangaTitle, chapterNumber, totalChapters, coverImage, isReading } = req.body || {};
  const result = updateDiscordPresence({
    mangaTitle,
    chapterNumber: Number(chapterNumber) || 1,
    totalChapters: totalChapters ? Number(totalChapters) : null,
    coverImage,
    isReading: Boolean(isReading),
  });
  res.json(result);
});

// ── GET /api/reader/prefetch-chapter - Speculative pre-warming endpoint ───────
readerRouter.get('/api/reader/prefetch-chapter', async (req, res) => {
  const mangaId = req.query.mangaId as string;
  const chapterNumber = Number(req.query.chapterNumber) || 1;

  if (!mangaId) {
    return res.status(400).json({ error: 'Missing mangaId query parameter' });
  }

  const manga = resolveManga(mangaId);
  if (!manga) {
    return res.status(404).json({ error: 'Series not found' });
  }

  // Preload in the background without blocking response
  setImmediate(async () => {
    try {
      if (manga.sourceUrl) {
        const matched = matchLiveDomain(manga.sourceUrl);
        const domainId = matched ? matched.id : 'generic';
        await fetchLiveChapterList(manga.sourceUrl, domainId);
      }
    } catch {
      // Best-effort prefetch
    }
  });

  return res.json({
    success: true,
    mangaId,
    chapterNumber,
    prefetched: true,
  });
});


