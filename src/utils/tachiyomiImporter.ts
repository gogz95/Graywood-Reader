/**
 * Tachiyomi / Mihon Backup Importer & Exporter for Graywood Reader.
 * Converts Tachiyomi/Mihon JSON backups into Graywood MangaItems and vice-versa.
 */

import { MangaItem, MangaType, ReadingStatus, isMangaDexSourceLink } from '../types';
import { cleanMangaTitle } from './metadataHelpers';

export interface TachiyomiMangaEntry {
  title?: string;
  url?: string;
  source?: number | string;
  sourceName?: string;
  artist?: string;
  author?: string;
  description?: string;
  genre?: string[];
  status?: number | string;
  thumbnail_url?: string;
  coverImage?: string;
  custom_title?: string;
  chapters?: Array<{
    url?: string;
    name?: string;
    chapter_number?: number;
    read?: boolean;
    last_page_read?: number;
  }>;
  categories?: string[];
}

export interface TachiyomiBackupJson {
  version?: number;
  mangas?: any[];
  backupManga?: any[];
}

/**
 * Parses status codes from Tachiyomi format:
 * 1: ONGOING -> 'reading'
 * 2: COMPLETED -> 'completed'
 * 3: LICENSED -> 'plan_to_read'
 * 4: PUBLISHING_FINISHED -> 'completed'
 * 5: CANCELLED -> 'dropped'
 * 6: ON_HIATUS -> 'on_hold'
 */
function mapTachiyomiStatus(status: number | string | undefined): ReadingStatus {
  if (typeof status === 'number') {
    switch (status) {
      case 1: return 'reading';
      case 2: return 'completed';
      case 4: return 'completed';
      case 5: return 'dropped';
      case 6: return 'on_hold';
      default: return 'reading';
    }
  }
  if (typeof status === 'string') {
    const s = status.toLowerCase();
    if (s.includes('complete')) return 'completed';
    if (s.includes('drop')) return 'dropped';
    if (s.includes('hold') || s.includes('hiatus')) return 'on_hold';
    if (s.includes('plan')) return 'plan_to_read';
  }
  return 'reading';
}

function detectFormatFromGenres(genres: string[], title: string): MangaType {
  const allText = `${title} ${genres.join(' ')}`.toLowerCase();
  if (allText.includes('manhwa') || allText.includes('webtoon')) return 'manhwa';
  if (allText.includes('manhua')) return 'manhua';
  return 'manga';
}

/**
 * Import and parse Tachiyomi / Mihon JSON backup text into MangaItem array.
 */
export function parseTachiyomiBackup(jsonContent: string, userId: string = 'usr_admin'): MangaItem[] {
  let parsed: TachiyomiBackupJson;
  try {
    parsed = JSON.parse(jsonContent);
  } catch (err: any) {
    throw new Error(`Invalid JSON file: ${err.message}`);
  }

  const rawList: any[] = parsed.mangas || parsed.backupManga || (Array.isArray(parsed) ? parsed : []);
  if (!Array.isArray(rawList) || rawList.length === 0) {
    throw new Error('No manga entries found in the backup file.');
  }

  // Build Tachiyomi category index and ID map
  const tachiCategoryMap = new Map<number | string, string>();
  const rawCategories = (parsed as any).backupCategories || (parsed as any).categories || (parsed as any).mangaCategories || [];
  if (Array.isArray(rawCategories)) {
    rawCategories.forEach((cat, index) => {
      if (cat && typeof cat === 'object') {
        const catName = cat.name || cat.title;
        if (catName) {
          tachiCategoryMap.set(index, catName); // 0-based index
          tachiCategoryMap.set(String(index), catName);
          if (cat.order !== undefined) {
            tachiCategoryMap.set(cat.order, catName);
            tachiCategoryMap.set(String(cat.order), catName);
          }
          if (cat.id !== undefined) {
            tachiCategoryMap.set(cat.id, catName);
            tachiCategoryMap.set(String(cat.id), catName);
          }
        }
      } else if (typeof cat === 'string' && cat.trim()) {
        tachiCategoryMap.set(index, cat.trim());
        tachiCategoryMap.set(String(index), cat.trim());
      }
    });
  }

  const importedItems: MangaItem[] = [];

  for (let i = 0; i < rawList.length; i++) {
    const entry = rawList[i];
    let title = '';
    let url = '';
    let description = '';
    let coverImage = '';
    let genres: string[] = [];
    let status: ReadingStatus = 'reading';
    let sourceName = 'Tachiyomi Import';
    let currentChapter = 0;
    let totalChapters = 1;
    let isFavorite = true;

    // Handle Tuple/Array format from standard Tachiyomi v2 backup:
    // [url, title, source, artist, author, description, genre, status, thumbnail_url, ...]
    if (Array.isArray(entry.manga)) {
      const m = entry.manga;
      url = String(m[0] || '');
      title = String(m[1] || 'Untitled Series');
      description = String(m[5] || '');
      genres = Array.isArray(m[6]) ? m[6] : [];
      status = mapTachiyomiStatus(m[7]);
      coverImage = String(m[8] || '');
      sourceName = String(m[2] ? `Source #${m[2]}` : 'Tachiyomi Import');
    }
    // Handle Object-based format
    else if (typeof entry === 'object' && entry !== null) {
      const m = entry.manga || entry;
      title = m.title || m.name || m.custom_title || `Series #${i + 1}`;
      url = m.url || m.sourceUrl || '';
      description = m.description || '';
      coverImage = m.thumbnail_url || m.coverImage || m.cover || '';
      genres = Array.isArray(m.genre) ? m.genre : Array.isArray(m.genres) ? m.genres : [];
      status = mapTachiyomiStatus(m.status);
      sourceName = m.sourceName || (m.source ? `Source #${m.source}` : 'Tachiyomi Import');
      if (entry.favorite === false || entry.isFavorite === false) {
        isFavorite = false;
      }
    }

    title = cleanMangaTitle(title);
    if (!title) continue;

    // Calculate read chapters and highest chapter number from chapter list if present
    const chapters = entry.chapters || entry.manga?.chapters;
    if (Array.isArray(chapters) && chapters.length > 0) {
      let maxReadCh = 0;
      let maxTotalCh = chapters.length;
      let readCount = 0;
      for (const c of chapters) {
        const chNum = Number(c.chapter_number ?? c.number ?? c.chapterNumber);
        if (Number.isFinite(chNum) && chNum > maxTotalCh) {
          maxTotalCh = chNum;
        }
        if (c.read || (c.last_page_read && c.last_page_read > 0)) {
          readCount++;
          if (Number.isFinite(chNum) && chNum > maxReadCh) {
            maxReadCh = chNum;
          }
        }
      }
      totalChapters = maxTotalCh || chapters.length;
      currentChapter = maxReadCh > 0 ? maxReadCh : readCount;
    }

    // Check history list
    const historyList = entry.history || entry.manga?.history;
    if (Array.isArray(historyList) && historyList.length > 0) {
      for (const h of historyList) {
        const hNum = Number(h?.chapter_number ?? h?.chapterNumber ?? h?.number);
        if (Number.isFinite(hNum) && hNum > currentChapter) {
          currentChapter = Math.floor(hNum);
        }
      }
    }

    // Direct chapter progress fields
    if (typeof entry.currentChapter === 'number' && entry.currentChapter > currentChapter) {
      currentChapter = entry.currentChapter;
    }
    if (typeof (entry.manga as any)?.currentChapter === 'number' && (entry.manga as any).currentChapter > currentChapter) {
      currentChapter = (entry.manga as any).currentChapter;
    }
    if (typeof entry.last_chapter_read === 'number' && entry.last_chapter_read > currentChapter) {
      currentChapter = Math.floor(entry.last_chapter_read);
    }
    if (typeof (entry.manga as any)?.last_chapter_read === 'number' && (entry.manga as any).last_chapter_read > currentChapter) {
      currentChapter = Math.floor((entry.manga as any).last_chapter_read);
    }
    if (typeof (entry as any)?.progress === 'number' && (entry as any).progress > currentChapter) {
      currentChapter = Math.floor((entry as any).progress);
    }

    const type: MangaType = detectFormatFromGenres(genres, title);
    const hasWorkingSource = Boolean(url && url.trim().length > 0 && !isMangaDexSourceLink(sourceName, url));
    const isFlagged = !hasWorkingSource;
    const flagReason = !hasWorkingSource ? 'Missing source' : undefined;
    const id = `tachi_${Date.now()}_${i}_${title.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 16)}`;
    const categories: string[] = [];
    const rawEntryCategories = entry.categories || (entry.manga as any)?.categories || [];
    if (Array.isArray(rawEntryCategories)) {
      for (const catRef of rawEntryCategories) {
        if (typeof catRef === 'string') {
          const resolved = tachiCategoryMap.get(catRef) || (isNaN(Number(catRef)) ? catRef : tachiCategoryMap.get(Number(catRef)));
          const finalName = resolved || catRef;
          if (finalName && !categories.includes(finalName)) categories.push(finalName);
        } else if (typeof catRef === 'number') {
          const resolved = tachiCategoryMap.get(catRef) || tachiCategoryMap.get(String(catRef));
          if (resolved && !categories.includes(resolved)) categories.push(resolved);
        } else if (catRef && typeof catRef === 'object') {
          const catName = catRef.name || (catRef.id !== undefined ? tachiCategoryMap.get(catRef.id) : null);
          if (catName && !categories.includes(catName)) categories.push(catName);
        }
      }
    }

    importedItems.push({
      id,
      title,
      altTitles: [],
      type,
      coverImage: coverImage || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=400&q=80',
      description,
      genres,
      status,
      currentChapter,
      totalChapters: totalChapters || 1,
      latestChapter: totalChapters || 1,
      lastUpdated: new Date().toISOString(),
      rating: 9.0,
      sourceUrl: url,
      sourceName,
      autoUpdateEnabled: true,
      notes: 'Imported from Tachiyomi / Mihon backup',
      addedAt: new Date().toISOString(),
      lastReadAt: new Date().toISOString(),
      userId,
      isFavorite,
      isFlagged,
      flagReason,
      categories,
    });
  }

  return importedItems;
}

/**
 * Export current Graywood Reader library into standard Tachiyomi/Mihon JSON format.
 */
export function exportToTachiyomiBackup(mangaList: MangaItem[]): string {
  const tachiyomiData = {
    version: 2,
    mangas: mangaList.map((m) => {
      const updatedMs = m.lastUpdated ? new Date(m.lastUpdated).getTime() : Date.now();
      return {
        manga: [
          m.sourceUrl || `/manga/${m.id}`,
          m.title,
          1, // source id placeholder
          m.sourceUrl || '',
          '', // artist
          '', // author
          m.description || '',
          m.genres || [],
          m.status === 'completed' ? 2 : m.status === 'dropped' ? 5 : m.status === 'on_hold' ? 6 : 1,
          m.coverImage,
          0,
          Number.isFinite(updatedMs) ? updatedMs : Date.now(),
          1,
        ],
        categories: m.isFavorite ? ['Favorites', 'Reading'] : ['Reading'],
        chapters: Array.from({ length: m.totalChapters || 1 }, (_, idx) => ({
          url: `${m.sourceUrl || ''}/chapter-${idx + 1}`,
          name: `Chapter ${idx + 1}`,
          chapter_number: idx + 1,
          read: idx < m.currentChapter,
          last_page_read: idx < m.currentChapter ? 1 : 0,
        })),
      };
    }),
  };

  return JSON.stringify(tachiyomiData, null, 2);
}
