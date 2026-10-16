// ============================================================================
// server/services/reader/pageResolverService.ts — Chapter Page Resolution Engine
// Resolves chapter pages with in-flight deduplication and mirror fallback.
// ============================================================================

import { MangaItem, isNsfwManga } from '../../../src/types';
import { SqliteDb } from '../../../db';
import {
  kotatsuImageEngine,
  matchLiveDomain,
  autoDiscoverLiveSourceForManga,
} from '../crawlerEngine';
import {
  KOTATSU_SOURCES,
  isSourceUrlOrNameDisabled,
  getSourceById,
  resolveChapterUrl,
  resolveSourceUrl,
} from '../../sources/sourcesCatalog';
import { sourceCircuitBreaker } from '../../circuitBreaker';
import { fetchMangaDex } from '../metadataService';
import { recordTrace } from '../../diagnostics/traceBuffer';
import { extractDomainFromUrl } from '../../network/sourceHttpClient';

export interface ResolvePagesInput {
  mangaId: string;
  chapterNumber: number;
  chapterId?: string;
  requestedUrl?: string;
  requestedSourceId?: string;
  requestedTitle?: string;
}

export interface ChapterPagesResult {
  mangaId: string;
  chapterNumber: number;
  chapterId: string;
  totalPages: number;
  pages: string[];
  sourceType: string;
  sourceDomain: string;
  sourceName: string;
  resolvedChapterUrl?: string;
  isRealImages: boolean;
  contentUnavailable?: boolean;
  isPlaceholder?: boolean;
  loadError?: string;
  notice?: string;
  activeSourceId?: string;
  fallbackUsed?: boolean;
  fallbackOccurred?: boolean;
  fallbackSource?: string;
}

// In-flight request stampede coalescing map
const inFlightResolutions = new Map<string, Promise<ChapterPagesResult>>();

export function resolveMangaEntity(mangaId: string): MangaItem | undefined {
  if (!mangaId) return undefined;
  return SqliteDb.getMangaById(mangaId) || SqliteDb.getMangaByApiId(mangaId) || undefined;
}

/**
 * Core business logic to resolve chapter pages with in-flight request coalescing and fallback.
 */
export async function resolveChapterPages(
  input: ResolvePagesInput
): Promise<ChapterPagesResult> {
  const { mangaId, requestedSourceId } = input;
  const chapterNumber = Math.max(1, input.chapterNumber || 1);
  const chapterId = input.chapterId || '';
  const manga = resolveMangaEntity(mangaId);
  const mangaTitle = input.requestedTitle || manga?.title || 'Webtoon Series';

  let targetUrl = input.requestedUrl || manga?.sourceUrl || '';

  // Generate target URL from conventional slug prefixes if missing
  if (!targetUrl && mangaId) {
    if (mangaId.startsWith('asura_')) {
      const slug = mangaId.replace('asura_', '');
      targetUrl = `https://asurascans.com/comics/${slug}`;
    } else if (mangaId.startsWith('flame_')) {
      const slug = mangaId.replace('flame_', '');
      targetUrl = `https://flamecomics.xyz/series/${slug}`;
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

  // Promote alternative live source over disabled or metadata-only MangaDex link
  if (
    targetUrl &&
    (targetUrl.toLowerCase().includes('mangadex.org') || isSourceUrlOrNameDisabled(mangaTitle, targetUrl, mangaId)) &&
    manga?.availableSources?.length
  ) {
    const altSource = manga.availableSources.find(
      (s) =>
        s.sourceUrl &&
        s.sourceUrl.startsWith('http') &&
        !s.sourceUrl.toLowerCase().includes('mangadex.org') &&
        !isSourceUrlOrNameDisabled(s.sourceName, s.sourceUrl)
    );
    if (altSource) {
      targetUrl = altSource.sourceUrl;
    }
  }

  if (manga && (!targetUrl || targetUrl.toLowerCase().includes('mangadex.org') || isSourceUrlOrNameDisabled(manga.sourceName, targetUrl, manga.id))) {
    const autoSource = await autoDiscoverLiveSourceForManga(manga);
    if (autoSource) {
      targetUrl = autoSource.sourceUrl;
    }
  }

  // Check if target source is completely disabled
  if (targetUrl && isSourceUrlOrNameDisabled(mangaTitle, targetUrl, mangaId)) {
    return {
      mangaId,
      chapterNumber,
      chapterId: chapterId || `ch_${chapterNumber}`,
      totalPages: 0,
      pages: [],
      sourceType: 'none',
      sourceDomain: '',
      sourceName: 'Source Disabled',
      isRealImages: false,
      contentUnavailable: true,
      isPlaceholder: false,
      loadError: `Chapter ${chapterNumber} is unavailable because this source has been flagged as broken or disabled. Please switch to another source from the mirror menu.`,
      notice: `Source is flagged as broken.`,
    };
  }

  // Request coalescing key
  const coalesceKey = `${mangaId}:${chapterNumber}:${targetUrl}:${requestedSourceId || ''}`;
  if (inFlightResolutions.has(coalesceKey)) {
    return inFlightResolutions.get(coalesceKey)!;
  }

  const resolutionPromise = (async (): Promise<ChapterPagesResult> => {
    let realPages: string[] | null = null;
    const matchedDomain = matchLiveDomain(targetUrl);
    let activeDomainId = requestedSourceId || (matchedDomain ? matchedDomain.id : 'general');
    let activeSourceLabel = matchedDomain ? matchedDomain.name : 'Live Webtoon Source';
    let activeTargetUrl = targetUrl;
    let usedFallback = false;
    let fallbackSourceLabel = '';

    // 1. Attempt primary upstream crawl
    if (
      activeTargetUrl &&
      (activeTargetUrl.startsWith('http://') || activeTargetUrl.startsWith('https://')) &&
      !activeTargetUrl.toLowerCase().includes('mangadex.org') &&
      !isSourceUrlOrNameDisabled(mangaTitle, activeTargetUrl, mangaId)
    ) {
      try {
        realPages = await kotatsuImageEngine.getChapterPages(activeTargetUrl, activeDomainId, chapterNumber);
      } catch (err: any) {
        console.warn(`[PageResolverService] Primary source error (${activeDomainId}):`, err?.message || err);
      }
    }

    // 2. Automatic Failover: If primary upstream failed or returned 0 pages, check alternative mirrors from manga_chapters
    if ((!realPages || realPages.length === 0) && mangaId) {
      const chapterMirrors = SqliteDb.getMirrorsForChapter(mangaId, chapterNumber);
      const alternativeMirrors = chapterMirrors.filter(
        (m) => m.source_id.toLowerCase() !== String(activeDomainId).toLowerCase()
      );

      for (const mirror of alternativeMirrors) {
        if (sourceCircuitBreaker.canAttempt(mirror.source_id) && !isSourceUrlOrNameDisabled(mirror.source_id, mirror.url)) {
          const mirrorResolvedUrl = resolveSourceUrl(mirror.source_id, mirror.url);
          try {
            const fallbackPages = await kotatsuImageEngine.getChapterPages(mirrorResolvedUrl, mirror.source_id, chapterNumber);
            if (fallbackPages && fallbackPages.length > 0) {
              const srcDef = getSourceById(mirror.source_id);
              fallbackSourceLabel = srcDef?.name || mirror.source_id;
              realPages = fallbackPages;
              activeTargetUrl = mirrorResolvedUrl;
              activeDomainId = mirror.source_id;
              activeSourceLabel = fallbackSourceLabel;
              usedFallback = true;

              recordTrace({
                domain: extractDomainFromUrl(mirrorResolvedUrl),
                sourceId: mirror.source_id,
                stage: 'MIRROR_FALLBACK',
                status: 'ok',
                durationMs: 0,
                message: `Auto-failover recovered Ch. ${chapterNumber} via mirror "${fallbackSourceLabel}"`,
              });
              break;
            }
          } catch (mirrorErr: any) {
            console.warn(`[PageResolverService] Mirror fallback ${mirror.source_id} failed:`, mirrorErr?.message || mirrorErr);
          }
        }
      }

      // Secondary fallback: check manga.availableSources if still no pages found
      if ((!realPages || realPages.length === 0) && manga?.availableSources?.length) {
        for (const alt of manga.availableSources) {
          if (!alt.sourceUrl || alt.sourceUrl === activeTargetUrl || isSourceUrlOrNameDisabled(alt.sourceName, alt.sourceUrl)) continue;
          const matchedAlt = matchLiveDomain(alt.sourceUrl);
          const altDomainId = matchedAlt ? matchedAlt.id : 'general';
          if (altDomainId === activeDomainId) continue;
          if (sourceCircuitBreaker.canAttempt(altDomainId)) {
            try {
              const fallbackPages = await kotatsuImageEngine.getChapterPages(alt.sourceUrl, altDomainId, chapterNumber);
              if (fallbackPages && fallbackPages.length > 0) {
                fallbackSourceLabel = alt.sourceName || (matchedAlt ? matchedAlt.name : altDomainId);
                realPages = fallbackPages;
                activeTargetUrl = alt.sourceUrl;
                activeDomainId = altDomainId;
                activeSourceLabel = fallbackSourceLabel;
                usedFallback = true;

                recordTrace({
                  domain: extractDomainFromUrl(alt.sourceUrl),
                  sourceId: altDomainId,
                  stage: 'MIRROR_FALLBACK',
                  status: 'ok',
                  durationMs: 0,
                  message: `Auto-failover recovered Ch. ${chapterNumber} via catalog source "${fallbackSourceLabel}"`,
                });
                break;
              }
            } catch {}
          }
        }
      }
    }

    if (realPages && realPages.length > 0) {
      const proxiedPages = realPages.map((pageUrl, idx) => {
        const cleanUrl = pageUrl.trim();
        if (cleanUrl.startsWith('/api/reader/panel-image')) return cleanUrl;
        if (cleanUrl.startsWith('/api/')) return cleanUrl;
        return `/api/reader/proxy-image?url=${encodeURIComponent(cleanUrl)}&sourceUrl=${encodeURIComponent(activeTargetUrl)}&page=${idx + 1}&manga=${encodeURIComponent(mangaTitle)}&mangaId=${encodeURIComponent(mangaId || '')}`;
      });

      return {
        mangaId,
        chapterNumber,
        chapterId: chapterId || `ch_${chapterNumber}`,
        totalPages: proxiedPages.length,
        pages: proxiedPages,
        sourceType: 'live_webtoon_crawler',
        sourceDomain: activeDomainId,
        sourceName: activeSourceLabel,
        resolvedChapterUrl: activeTargetUrl,
        isRealImages: true,
        activeSourceId: activeDomainId,
        fallbackUsed: usedFallback,
        fallbackOccurred: usedFallback,
        fallbackSource: usedFallback ? fallbackSourceLabel : undefined,
        notice: usedFallback
          ? `Failover active: Streaming ${proxiedPages.length} panels from fallback mirror "${fallbackSourceLabel}".`
          : `Streaming ${proxiedPages.length} high-res panels from ${activeSourceLabel}.`,
      };
    }

    // 3. MangaDex direct reading fallback
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
        console.warn('[PageResolverService] MangaDex feed resolution error:', err);
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
              return `/api/mangadex/image-proxy?url=${encodeURIComponent(directCdnUrl)}&page=${idx + 1}&manga=${encodeURIComponent(mangaTitle)}&mangaId=${encodeURIComponent(mangaId || '')}`;
            });

            return {
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
            };
          }
        }
      } catch (err) {
        console.warn('[PageResolverService] MangaDex At-Home fetch error:', err);
      }
    }

    // Missing pages: report unavailable cleanly without placeholder panels
    return {
      mangaId,
      chapterNumber,
      chapterId: chapterId || `ch_${chapterNumber}`,
      totalPages: 0,
      pages: [],
      sourceType: 'none',
      sourceDomain: '',
      sourceName: 'Source Unavailable',
      isRealImages: false,
      contentUnavailable: true,
      isPlaceholder: false,
      loadError: `Chapter ${chapterNumber} is missing pages. No readable panel images could be extracted from the source (${targetUrl || 'unavailable'}). Try switching to another mirror or source.`,
      notice: `Chapter ${chapterNumber} is missing pages.`,
    };
  })();

  inFlightResolutions.set(coalesceKey, resolutionPromise);
  try {
    return await resolutionPromise;
  } finally {
    inFlightResolutions.delete(coalesceKey);
  }
}
