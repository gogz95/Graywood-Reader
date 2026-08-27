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
        let chNum = 0;
        let isRead = false;
        let lastPage = 0;

        if (Array.isArray(c)) {
          // Tuple format: [url, name, scanlator, read, bookmark, last_page_read, date_fetch, date_upload, chapter_number, source_order]
          isRead = Boolean(c[3] === true || c[3] === 1);
          lastPage = Number(c[5]) || 0;
          const rawNum = Number(c[8]);
          if (Number.isFinite(rawNum) && rawNum >= 0) {
            chNum = rawNum;
          } else if (c[1]) {
            const match = String(c[1]).match(/(?:chapter|ch\.?|ep\.?|#)\s*([0-9]+(?:\.[0-9]+)?)/i) || String(c[1]).match(/\b([0-9]+(?:\.[0-9]+)?)\b/);
            if (match && match[1]) chNum = parseFloat(match[1]);
          }
        } else if (typeof c === 'object' && c !== null) {
          isRead = Boolean(c.read === true || c.read === 1);
          lastPage = Number(c.last_page_read ?? c.lastPageRead ?? c.page) || 0;
          const rawNum = Number(c.chapter_number ?? c.number ?? c.chapterNumber ?? c.chapter_num);
          if (Number.isFinite(rawNum) && rawNum >= 0) {
            chNum = rawNum;
          } else if (c.name || c.title) {
            const match = String(c.name || c.title).match(/(?:chapter|ch\.?|ep\.?|#)\s*([0-9]+(?:\.[0-9]+)?)/i) || String(c.name || c.title).match(/\b([0-9]+(?:\.[0-9]+)?)\b/);
            if (match && match[1]) chNum = parseFloat(match[1]);
          }
        }

        if (Number.isFinite(chNum) && chNum > maxTotalCh) {
          maxTotalCh = chNum;
        }
        if (isRead || lastPage > 0) {
          readCount++;
          if (Number.isFinite(chNum) && chNum > maxReadCh) {
            maxReadCh = chNum;
          }
        }
      }
      totalChapters = maxTotalCh || chapters.length;
      currentChapter = maxReadCh > 0 ? maxReadCh : readCount;
    }

    // Check history list inside entry
    const historyList = entry.history || entry.manga?.history;
    if (Array.isArray(historyList) && historyList.length > 0) {
      for (const h of historyList) {
        let hNum = 0;
        if (Array.isArray(h)) {
          // [chapterUrl, lastReadTime, timeRead] or [chapterNumber]
          const rawH0 = Number(h[0]);
          if (Number.isFinite(rawH0) && rawH0 > 0) {
            hNum = rawH0;
          } else if (typeof h[0] === 'string' && Array.isArray(chapters)) {
            const matched = chapters.find((ch: any) => (Array.isArray(ch) ? ch[0] === h[0] : ch?.url === h[0]));
            if (matched) {
              hNum = Array.isArray(matched) ? (Number(matched[8]) || 0) : (Number(matched.chapter_number ?? matched.number) || 0);
            }
          }
        } else if (typeof h === 'object' && h !== null) {
          hNum = Number(h?.chapter_number ?? h?.chapterNumber ?? h?.number ?? h?.chapter ?? h?.lastChapterRead ?? 0);
          if ((!hNum || hNum <= 0) && h.url && Array.isArray(chapters)) {
            const matched = chapters.find((ch: any) => (Array.isArray(ch) ? ch[0] === h.url : ch?.url === h.url));
            if (matched) {
              hNum = Array.isArray(matched) ? (Number(matched[8]) || 0) : (Number(matched.chapter_number ?? matched.number) || 0);
            }
          }
        }
        if (Number.isFinite(hNum) && hNum > currentChapter) {
          currentChapter = Math.floor(hNum);
        }
      }
    }

    // Check tracking entries (MAL / AniList / Kitsu / MangaUpdates synced progress)
    const trackList = entry.tracking || entry.tracks || entry.manga?.tracking || entry.manga?.tracks;
    if (Array.isArray(trackList) && trackList.length > 0) {
      for (const t of trackList) {
        const lastRead = Number(t?.last_chapter_read ?? t?.lastChapterRead ?? t?.chapters_read ?? t?.chaptersRead ?? t?.progress ?? 0);
        if (Number.isFinite(lastRead) && lastRead > currentChapter) {
          currentChapter = Math.floor(lastRead);
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

  // Also parse standalone history entries if present in backup (restores reading history for series not in library)
  const rawHistory = (parsed as any).history || (parsed as any).backupHistory || [];
  if (Array.isArray(rawHistory)) {
    for (const h of rawHistory) {
      let hUrl = '';
      let hTitle = '';
      let hChapter = 0;

      if (Array.isArray(h)) {
        // [mangaUrl, lastRead, timeRead] or [url, title, chapter]
        hUrl = typeof h[0] === 'string' ? h[0] : '';
        hTitle = typeof h[1] === 'string' ? h[1] : '';
        hChapter = typeof h[2] === 'number' ? h[2] : (typeof h[0] === 'number' ? h[0] : 0);
      } else if (typeof h === 'object' && h !== null) {
        hUrl = h.url || h.mangaUrl || h.manga_url || (Array.isArray(h.manga) ? h.manga[0] : '');
        hTitle = h.title || h.mangaTitle || h.manga_title || (Array.isArray(h.manga) ? h.manga[1] : '');
        hChapter = Number(h.lastChapterRead ?? h.chapterNumber ?? h.chapter_number ?? h.chapter ?? h.progress ?? 0);
      }

      const existing = importedItems.find((item) => (hUrl && item.sourceUrl === hUrl) || (hTitle && item.title.toLowerCase() === hTitle.toLowerCase()));
      if (existing) {
        if (hChapter > existing.currentChapter) {
          existing.currentChapter = hChapter;
        }
      } else if (hTitle || hUrl) {
        const cleanTitle = cleanMangaTitle(hTitle || 'External Series');
        importedItems.push({
          id: `tachi_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          title: cleanTitle,
          altTitles: [],
          type: 'manhwa',
          coverImage: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=400&q=80',
          description: 'Reading history imported from backup',
          genres: ['Manhwa'],
          status: 'reading',
          currentChapter: hChapter,
          totalChapters: Math.max(hChapter, 1),
          latestChapter: Math.max(hChapter, 1),
          lastUpdated: new Date().toISOString(),
          rating: 8.0,
          sourceUrl: hUrl || '',
          sourceName: 'Tachiyomi History',
          autoUpdateEnabled: false,
          notes: 'Imported history entry',
          addedAt: new Date().toISOString(),
          lastReadAt: new Date().toISOString(),
          userId,
          isFavorite: false,
          categories: [],
        });
      }
    }
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
