/**
 * Kotatsu Backup Importer & Exporter for Graywood Reader.
 * Converts Kotatsu ZIP (.bk.zip / .zip) and JSON backups into Graywood MangaItems and vice-versa.
 */

import { MangaItem, MangaType, ReadingStatus, isMangaDexSourceLink } from '../types';

export interface KotatsuChapter {
  id?: number | string;
  name?: string;
  title?: string;
  number?: number;
  chapter_number?: number;
  url?: string;
  uploadDate?: number | string;
  upload_date?: number | string;
  scanlator?: string;
  branch?: string;
  read?: boolean;
  last_page_read?: number;
}

export interface KotatsuManga {
  id?: number | string;
  title?: string;
  name?: string;
  altTitle?: string | string[];
  alt_title?: string | string[];
  url?: string;
  publicUrl?: string;
  public_url?: string;
  rating?: number;
  isNsfw?: boolean;
  is_nsfw?: boolean;
  coverUrl?: string;
  cover_url?: string;
  largeCoverUrl?: string;
  large_cover_url?: string;
  thumbnail_url?: string;
  author?: string;
  artist?: string;
  state?: number | string;
  status?: number | string;
  source?: string;
  sourceName?: string;
  genres?: Array<string | { name?: string; id?: string }>;
  description?: string;
  summary?: string;
  chapters?: KotatsuChapter[];
  favorite?: boolean;
  isFavorite?: boolean;
  currentChapter?: number;
  progress?: number;
  lastChapterRead?: number;
}

export interface KotatsuFavouriteEntry {
  manga?: KotatsuManga;
  id?: number | string;
  title?: string;
  name?: string;
  altTitle?: string | string[];
  url?: string;
  publicUrl?: string;
  coverUrl?: string;
  cover_url?: string;
  state?: number | string;
  status?: number | string;
  source?: string;
  genres?: any;
  description?: string;
  chapters?: KotatsuChapter[];
  categoryId?: number | string;
  category_id?: number | string;
  categories?: Array<string | { id?: number | string; name?: string }>;
  createdAt?: number | string;
  created_at?: number | string;
  sortKey?: number;
  sort_key?: number;
  pinned?: boolean;
  favorite?: boolean;
  isFavorite?: boolean;
  order?: number;
  currentChapter?: number;
  progress?: number;
  lastChapterRead?: number;
}

export interface KotatsuHistoryEntry {
  manga?: KotatsuManga;
  mangaId?: number | string;
  manga_id?: number | string;
  chapter?: KotatsuChapter;
  chapterId?: number | string;
  chapter_id?: number | string;
  page?: number;
  percent?: number;
  progress?: number;
  updatedAt?: number | string;
  updated_at?: number | string;
  last_read_at?: number | string;
}

export interface KotatsuCategory {
  id?: number | string;
  name?: string;
  order?: number;
  sortKey?: number;
}

export interface KotatsuBackupPayload {
  version?: number;
  favourites?: KotatsuFavouriteEntry[];
  favorites?: KotatsuFavouriteEntry[];
  manga?: KotatsuManga[];
  mangas?: KotatsuManga[];
  history?: KotatsuHistoryEntry[];
  categories?: KotatsuCategory[];
  bookmarks?: any[];
}

/**
 * Maps Kotatsu state values (numbers or string enums) to Graywood ReadingStatus:
 * 0: UNKNOWN -> 'reading'
 * 1: ONGOING -> 'reading'
 * 2: FINISHED / COMPLETED -> 'completed'
 * 3: ABANDONED / CANCELLED / DROPPED -> 'dropped'
 * 4: PAUSED / ON_HIATUS / ON_HOLD -> 'on_hold'
 * 5: UPCOMING / PLANNED / PLAN_TO_READ -> 'plan_to_read'
 */
export function mapKotatsuStatus(state: number | string | undefined): ReadingStatus {
  if (typeof state === 'number') {
    switch (state) {
      case 1: return 'reading';
      case 2: return 'completed';
      case 3: return 'dropped';
      case 4: return 'on_hold';
      case 5: return 'plan_to_read';
      default: return 'reading';
    }
  }
  if (typeof state === 'string') {
    const s = state.toUpperCase().trim();
    if (s.includes('FINISH') || s.includes('COMPLETE')) return 'completed';
    if (s.includes('ABANDON') || s.includes('DROP') || s.includes('CANCEL')) return 'dropped';
    if (s.includes('PAUS') || s.includes('HOLD') || s.includes('HIATUS')) return 'on_hold';
    if (s.includes('UPCOM') || s.includes('PLAN')) return 'plan_to_read';
    if (s.includes('ONGOING') || s.includes('READ')) return 'reading';
  }
  return 'reading';
}

/**
 * Formats Kotatsu source identifier into a user-friendly source name.
 * e.g. "ASURASCANS" -> "Asura Scans", "MANGADEX" -> "MangaDex"
 */
export function formatKotatsuSourceName(rawSource?: string): string {
  if (!rawSource) return 'Kotatsu Import';
  const clean = rawSource.trim();
  const known: Record<string, string> = {
    MANGADEX: 'MangaDex',
    ASURASCANS: 'Asura Scans',
    REAPERSCANS: 'Reaper Scans',
    FLAME_COMICS: 'Flame Comics',
    FLAMECOMICS: 'Flame Comics',
    MANGAKAKALOT: 'Mangakakalot',
    MANGANATO: 'Manganato',
    MANGA_PARK: 'MangaPark',
    MANGAPARK: 'MangaPark',
    MANGASEE: 'MangaSee',
    BATOTO: 'Bato.to',
    WEBTOONS: 'Webtoons',
  };
  if (known[clean.toUpperCase()]) {
    return known[clean.toUpperCase()];
  }
  // Convert SNAKE_CASE or UPPERCASE to Capitalized Words
  return clean
    .split(/[_\-\s]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export function detectKotatsuFormat(genres: string[], title: string): MangaType {
  const allText = `${title} ${genres.join(' ')}`.toLowerCase();
  if (allText.includes('manhwa') || allText.includes('webtoon')) return 'manhwa';
  if (allText.includes('manhua')) return 'manhua';
  return 'manga';
}

/**
 * Extracts files from a ZIP archive ArrayBuffer / Uint8Array in standard JS environments.
 * Uses native DecompressionStream('deflate-raw') if available (modern browsers & Node 18+),
 * with support for uncompressed stored files.
 */
/**
 * Helper to decompress deflate-raw or deflate payload.
 */
async function decompressDeflateStream(slice: Uint8Array): Promise<string> {
  const cleanSlice = new Uint8Array(slice);
  if (typeof DecompressionStream !== 'undefined') {
    try {
      const ds = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      await writer.write(cleanSlice);
      await writer.close();
      const response = new Response(ds.readable);
      return await response.text();
    } catch {
      try {
        const ds = new DecompressionStream('deflate');
        const writer = ds.writable.getWriter();
        await writer.write(cleanSlice);
        await writer.close();
        const response = new Response(ds.readable);
        return await response.text();
      } catch {}
    }
  }

  // Node.js fallback (tests & server)
  if (typeof process !== 'undefined' && (process as any).versions?.node) {
    try {
      const zlib = await import('zlib');
      try {
        return zlib.inflateRawSync(Buffer.from(cleanSlice)).toString('utf-8');
      } catch {
        return zlib.inflateSync(Buffer.from(cleanSlice)).toString('utf-8');
      }
    } catch {}
  }
  return '';
}

/**
 * Extracts files from a ZIP archive ArrayBuffer / Uint8Array in standard JS environments.
 * Uses standard ZIP Central Directory parsing (accurate for all Android ZipOutputStream & desktop formats)
 * with a local headers scan fallback.
 */
export async function unzipArchive(buffer: ArrayBuffer | Uint8Array): Promise<Record<string, string>> {
  const uint8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(uint8.buffer, uint8.byteOffset, uint8.byteLength);
  const files: Record<string, string> = {};
  const len = uint8.byteLength;

  // 1. Primary: Central Directory Reader (EOCD search from end of file)
  let eocdOffset = -1;
  for (let i = len - 22; i >= Math.max(0, len - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset !== -1) {
    const cdCount = view.getUint16(eocdOffset + 10, true);
    const cdOffset = view.getUint32(eocdOffset + 16, true);
    const entriesToDecompress: Array<{ fileName: string; method: number; slice: Uint8Array }> = [];

    let currCd = cdOffset;
    for (let i = 0; i < cdCount && currCd + 46 <= len; i++) {
      const sig = view.getUint32(currCd, true);
      if (sig !== 0x02014b50) break;

      const compressionMethod = view.getUint16(currCd + 10, true);
      const compressedSize = view.getUint32(currCd + 20, true);
      const fileNameLen = view.getUint16(currCd + 28, true);
      const extraLen = view.getUint16(currCd + 30, true);
      const commentLen = view.getUint16(currCd + 32, true);
      const localHeaderOffset = view.getUint32(currCd + 42, true);

      const nameBytes = uint8.subarray(currCd + 46, currCd + 46 + fileNameLen);
      const fileName = new TextDecoder('utf-8').decode(nameBytes);

      currCd += 46 + fileNameLen + extraLen + commentLen;

      if (fileName.endsWith('/') || fileNameLen === 0) continue;

      if (localHeaderOffset + 30 <= len && view.getUint32(localHeaderOffset, true) === 0x04034b50) {
        const localFileNameLen = view.getUint16(localHeaderOffset + 26, true);
        const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
        const dataOffset = localHeaderOffset + 30 + localFileNameLen + localExtraLen;

        if (dataOffset + compressedSize <= len) {
          const compressedSlice = uint8.subarray(dataOffset, dataOffset + compressedSize);
          entriesToDecompress.push({ fileName, method: compressionMethod, slice: compressedSlice });
        }
      }
    }

    if (entriesToDecompress.length > 0) {
      await Promise.all(
        entriesToDecompress.map(async ({ fileName, method, slice }) => {
          try {
            if (method === 0) {
              files[fileName] = new TextDecoder('utf-8').decode(slice);
            } else if (method === 8) {
              const decompressed = await decompressDeflateStream(slice);
              if (decompressed) {
                files[fileName] = decompressed;
              }
            }
          } catch (e) {
            console.warn(`[Kotatsu Importer] Failed to decompress ${fileName}:`, e);
          }
        })
      );
    }

    if (Object.keys(files).length > 0) {
      return files;
    }
  }

  // 2. Fallback: Sequential Local Headers Scanning
  let offset = 0;
  while (offset + 30 <= len) {
    const signature = view.getUint32(offset, true);
    if (signature !== 0x04034b50) break;

    const compressionMethod = view.getUint16(offset + 8, true);
    let compressedSize = view.getUint32(offset + 18, true);
    const fileNameLen = view.getUint16(offset + 26, true);
    const extraFieldLen = view.getUint16(offset + 28, true);

    const nameOffset = offset + 30;
    const nameBytes = uint8.subarray(nameOffset, nameOffset + fileNameLen);
    const fileName = new TextDecoder('utf-8').decode(nameBytes);

    const dataOffset = nameOffset + fileNameLen + extraFieldLen;
    if (dataOffset > len) break;

    if (compressedSize === 0) {
      let nextHeader = dataOffset;
      while (nextHeader + 4 <= len) {
        const sig = view.getUint32(nextHeader, true);
        if (sig === 0x04034b50 || sig === 0x02014b50 || sig === 0x06054b50) {
          break;
        }
        nextHeader++;
      }
      compressedSize = nextHeader - dataOffset;
    }

    const compressedSlice = uint8.subarray(dataOffset, dataOffset + compressedSize);
    if (!fileName.endsWith('/') && fileNameLen > 0) {
      try {
        if (compressionMethod === 0) {
          files[fileName] = new TextDecoder('utf-8').decode(compressedSlice);
        } else if (compressionMethod === 8) {
          const decompressed = await decompressDeflateStream(compressedSlice);
          if (decompressed) {
            files[fileName] = decompressed;
          }
        }
      } catch {}
    }

    offset = dataOffset + compressedSize;
  }

  return files;
}

/**
 * Checks if input is a ZIP archive by verifying the PK signature (0x50 0x4B 0x03 0x04).
 */
export function isZipBuffer(input: ArrayBuffer | Uint8Array): boolean {
  const uint8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (uint8.byteLength < 4) return false;
  return uint8[0] === 0x50 && uint8[1] === 0x4b && uint8[2] === 0x03 && uint8[3] === 0x04;
}

/**
 * Parses Kotatsu backup data (from ZIP archive or raw JSON) into Graywood MangaItems.
 */
export async function parseKotatsuBackup(
  input: string | ArrayBuffer | Uint8Array,
  userId: string = 'usr_admin'
): Promise<MangaItem[]> {
  let favouritesList: KotatsuFavouriteEntry[] = [];
  let historyList: KotatsuHistoryEntry[] = [];
  const categoriesMap: Map<string | number, string> = new Map();
  const statisticsMap = new Map<string, { timeSpentSeconds?: number; chaptersRead?: number; lastRead?: number | string; pagesRead?: number }>();
  let totalImportedReadingTime = 0;
  let totalImportedChaptersStat = 0;

  // 1. If binary input or string starting with PK signature -> Unpack ZIP
  if (input instanceof ArrayBuffer || input instanceof Uint8Array || (typeof input === 'string' && input.startsWith('PK'))) {
    let buf: ArrayBuffer | Uint8Array;
    if (typeof input === 'string') {
      const bytes = new Uint8Array(input.length);
      for (let i = 0; i < input.length; i++) {
        bytes[i] = input.charCodeAt(i) & 0xff;
      }
      buf = bytes;
    } else {
      buf = input;
    }

    if (isZipBuffer(buf)) {
      const files = await unzipArchive(buf);

      const getBase = (filePath: string) => {
        const parts = filePath.replace(/\\/g, '/').split('/');
        return (parts[parts.length - 1] || '').toLowerCase().trim();
      };
      
      // Parse categories if available
      for (const [name, content] of Object.entries(files)) {
        const base = getBase(name);
        if (base === 'sources' || base === 'sources.json') continue; // Ignore sources file
        if (base === 'categories' || base === 'categories.json' || base === 'favourites_categories' || base === 'favourites_categories.json' || base.includes('categor')) {
          try {
            const parsedCats = JSON.parse(content);
            const list: KotatsuCategory[] = Array.isArray(parsedCats) ? parsedCats : parsedCats.categories || [];
            for (const cat of list) {
              if (cat && cat.id !== undefined && cat.name) {
                categoriesMap.set(cat.id, cat.name);
              }
            }
          } catch {}
        }
      }

      // Parse history if available
      for (const [name, content] of Object.entries(files)) {
        const base = getBase(name);
        if (base === 'sources' || base === 'sources.json') continue;
        if (base === 'history' || base === 'history.json' || (base.includes('history') && !base.includes('categor'))) {
          try {
            const parsedHistory = JSON.parse(content);
            const list = Array.isArray(parsedHistory) ? parsedHistory : parsedHistory.history || [];
            if (Array.isArray(list) && list.length > 0) {
              historyList.push(...list);
            }
          } catch {}
        }
      }

      // Parse bookmarks if available
      const bookmarksList: any[] = [];
      for (const [name, content] of Object.entries(files)) {
        const base = getBase(name);
        if (base === 'sources' || base === 'sources.json') continue;
        if (base === 'bookmarks' || base === 'bookmarks.json') {
          try {
            const parsedBm = JSON.parse(content);
            const list = Array.isArray(parsedBm) ? parsedBm : parsedBm.bookmarks || [];
            if (Array.isArray(list) && list.length > 0) {
              bookmarksList.push(...list);
            }
          } catch {}
        }
      }

      // Parse statistics if available (e.g. statistics or statistics.json)
      for (const [name, content] of Object.entries(files)) {
        const base = getBase(name);
        if (base === 'sources' || base === 'sources.json') continue;
        if (base === 'statistics' || base === 'statistics.json' || base.includes('statistic')) {
          try {
            const parsedStats = JSON.parse(content);
            const rawList = Array.isArray(parsedStats)
              ? parsedStats
              : parsedStats.manga || parsedStats.items || parsedStats.entries || (typeof parsedStats === 'object' ? Object.values(parsedStats).filter((v: any) => typeof v === 'object' && v !== null) : []);

            if (typeof parsedStats.totalReadingTime === 'number') {
              totalImportedReadingTime = parsedStats.totalReadingTime > 100000 ? Math.round(parsedStats.totalReadingTime / 1000) : parsedStats.totalReadingTime;
            } else if (typeof parsedStats.timeSpent === 'number') {
              totalImportedReadingTime = parsedStats.timeSpent;
            }

            for (const item of rawList) {
              if (!item || typeof item !== 'object') continue;
              const id = item.mangaId !== undefined ? String(item.mangaId) : item.manga_id !== undefined ? String(item.manga_id) : item.id !== undefined ? String(item.id) : '';
              const title = item.manga?.title || item.title ? String(item.manga?.title || item.title).toLowerCase().trim() : '';
              
              const rawTime = item.timeSpent || item.time || item.duration || item.totalReadingTime || 0;
              const timeSpentSeconds = rawTime > 100000 ? Math.round(rawTime / 1000) : rawTime;
              const chaptersRead = item.chaptersRead || item.chapters || item.read || item.count || 0;
              const lastRead = item.lastRead || item.last_read || item.updatedAt || item.updated_at || item.time;
              const pagesRead = item.pagesRead || item.pages || item.page;

              const statObj = { timeSpentSeconds, chaptersRead, lastRead, pagesRead };
              if (id) statisticsMap.set(id, statObj);
              if (title) statisticsMap.set(title, statObj);
              if (timeSpentSeconds > 0) totalImportedReadingTime += timeSpentSeconds;
              if (chaptersRead > 0) totalImportedChaptersStat += chaptersRead;
            }
          } catch {}
        }
      }

      // Parse favourites / manga (ignore sources)
      for (const [name, content] of Object.entries(files)) {
        const base = getBase(name);
        if (base === 'sources' || base === 'sources.json') continue; // Explicitly ignore sources
        if (
          base === 'favourites' ||
          base === 'favourites.json' ||
          base === 'favorites' ||
          base === 'favorites.json' ||
          base === 'manga' ||
          base === 'mangas' ||
          base === 'manga.json' ||
          ((base.includes('favourit') || base.includes('favorit') || base.includes('manga')) && !base.includes('categor'))
        ) {
          try {
            const parsedFavs = JSON.parse(content);
            const list = Array.isArray(parsedFavs) 
              ? parsedFavs 
              : parsedFavs.favourites || parsedFavs.favorites || parsedFavs.mangas || parsedFavs.manga || [];
            if (Array.isArray(list) && list.length > 0) {
              favouritesList.push(...list);
            }
          } catch {}
        }
      }

      // If history is empty but bookmarks exist, use bookmarks as history fallback
      if (historyList.length === 0 && bookmarksList.length > 0) {
        for (const bm of bookmarksList) {
          if (bm) {
            historyList.push({
              manga: bm.manga,
              mangaId: bm.mangaId || bm.manga_id || bm.manga?.id,
              chapter: bm.chapter,
              chapterId: bm.chapterId || bm.chapter_id || bm.chapter?.id,
              page: bm.page,
              updatedAt: bm.createdAt || bm.created_at,
            });
          }
        }
      }
    }
  }

  // 2. If no files were extracted from ZIP, parse as raw JSON or compressed JSON
  if (favouritesList.length === 0) {
    let jsonString = '';
    if (typeof input === 'string') {
      jsonString = input;
    } else {
      try {
        const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
        // Check if GZIP format (0x1F, 0x8B)
        if (u8.length >= 2 && u8[0] === 0x1f && u8[1] === 0x8b) {
          if (typeof DecompressionStream !== 'undefined') {
            const ds = new DecompressionStream('gzip');
            const writer = ds.writable.getWriter();
            await writer.write(new Uint8Array(u8));
            await writer.close();
            jsonString = await new Response(ds.readable).text();
          } else if (typeof process !== 'undefined' && (process as any).versions?.node) {
            const zlib = await import('zlib');
            jsonString = zlib.gunzipSync(Buffer.from(u8)).toString('utf-8');
          }
        } else {
          jsonString = new TextDecoder('utf-8').decode(u8);
        }
      } catch {
        jsonString = typeof input === 'string' ? input : new TextDecoder('utf-8').decode(input);
      }
    }

    if (jsonString && jsonString.trim().length > 0) {
      let parsed: any;
      try {
        parsed = JSON.parse(jsonString);
      } catch (err: any) {
        throw new Error(`Invalid Kotatsu backup format: ${err.message}`);
      }

      if (Array.isArray(parsed)) {
        favouritesList = parsed;
      } else if (typeof parsed === 'object' && parsed !== null) {
        favouritesList = parsed.favourites || parsed.favorites || parsed.manga || parsed.mangas || [];
        if (Array.isArray(parsed.history)) {
          historyList = parsed.history;
        }
        if (Array.isArray(parsed.categories)) {
          for (const cat of parsed.categories) {
            if (cat && cat.id !== undefined && cat.name) {
              categoriesMap.set(cat.id, cat.name);
            }
          }
        }
        if (parsed.statistics) {
          const rawList = Array.isArray(parsed.statistics) ? parsed.statistics : parsed.statistics.manga || [];
          for (const item of rawList) {
            if (!item || typeof item !== 'object') continue;
            const id = item.mangaId !== undefined ? String(item.mangaId) : item.manga_id !== undefined ? String(item.manga_id) : '';
            const title = item.title ? String(item.title).toLowerCase().trim() : '';
            const timeSpentSeconds = item.timeSpent || item.time || 0;
            const chaptersRead = item.chaptersRead || item.read || 0;
            const statObj = { timeSpentSeconds, chaptersRead, lastRead: item.lastRead };
            if (id) statisticsMap.set(id, statObj);
            if (title) statisticsMap.set(title, statObj);
            if (timeSpentSeconds > 0) totalImportedReadingTime += timeSpentSeconds;
          }
        }
      }
    }
  }

  // Save imported statistics summary to localStorage if in browser
  if (typeof window !== 'undefined' && window.localStorage && (totalImportedReadingTime > 0 || statisticsMap.size > 0)) {
    try {
      window.localStorage.setItem('kotatsu_imported_statistics', JSON.stringify({
        importedAt: new Date().toISOString(),
        totalReadingTimeSeconds: totalImportedReadingTime,
        totalChaptersRead: totalImportedChaptersStat,
        seriesCount: statisticsMap.size || favouritesList.length,
      }));
    } catch {}
  }

  if (favouritesList.length === 0) {
    throw new Error('No manga entries found in the Kotatsu backup.');
  }

  // 3. Index history by manga identifier / url / title for reading progress
  const historyMap = new Map<string, KotatsuHistoryEntry>();
  for (const h of historyList) {
    const m = h.manga;
    const key1 = h.mangaId !== undefined ? String(h.mangaId) : '';
    const key2 = h.manga_id !== undefined ? String(h.manga_id) : '';
    const key3 = m?.id !== undefined ? String(m.id) : '';
    const key4 = m?.title ? m.title.toLowerCase().trim() : '';
    const key5 = m?.publicUrl || m?.url || '';

    if (key1) historyMap.set(key1, h);
    if (key2) historyMap.set(key2, h);
    if (key3) historyMap.set(key3, h);
    if (key4) historyMap.set(key4, h);
    if (key5) historyMap.set(key5, h);
  }

  const importedItems: MangaItem[] = [];

  for (let i = 0; i < favouritesList.length; i++) {
    const entry = favouritesList[i];
    const m: KotatsuManga = entry.manga || entry;

    const title = m.title || m.name || `Series #${i + 1}`;
    if (!title) continue;

    // Alt titles
    const rawAlt = m.altTitle || m.alt_title;
    const altTitles: string[] = Array.isArray(rawAlt) 
      ? rawAlt.filter(Boolean).map(String)
      : typeof rawAlt === 'string' && rawAlt.trim() 
        ? [rawAlt.trim()] 
        : [];

    // URLs & Cover
    const sourceUrl = m.publicUrl || m.public_url || m.url || '';
    const coverImage = m.largeCoverUrl || m.large_cover_url || m.coverUrl || m.cover_url || m.thumbnail_url || '';
    const rawSource = m.source || (entry as any).source || 'Kotatsu';
    const sourceName = formatKotatsuSourceName(rawSource);
    const description = m.description || m.summary || '';

    // Genres
    let genres: string[] = [];
    if (Array.isArray(m.genres)) {
      genres = m.genres.map((g: any) => typeof g === 'string' ? g : g?.name || '').filter(Boolean);
    } else if (typeof m.genres === 'string') {
      genres = (m.genres as string).split(',').map(s => s.trim()).filter(Boolean);
    }

    // Status
    const status = mapKotatsuStatus(m.state !== undefined ? m.state : m.status);
    const type = detectKotatsuFormat(genres, title);

    // Rating
    let rating = 9.0;
    if (typeof m.rating === 'number' && Number.isFinite(m.rating)) {
      rating = m.rating <= 1 ? Number((m.rating * 10).toFixed(1)) : Number(m.rating.toFixed(1));
    }

    // Chapters & Reading Progress
    const chapters = m.chapters || entry.chapters || [];
    let totalChapters = chapters.length > 0 ? chapters.length : 1;
    let currentChapter = 0;

    // Check history map for this manga
    const mId = m.id !== undefined ? String(m.id) : '';
    const hist = (mId ? historyMap.get(mId) : null) || historyMap.get(title.toLowerCase().trim()) || (sourceUrl ? historyMap.get(sourceUrl) : null);

    if (hist) {
      if (hist.chapter?.number !== undefined && Number.isFinite(hist.chapter.number)) {
        currentChapter = Math.max(currentChapter, Math.floor(hist.chapter.number));
      } else if (hist.chapter?.chapter_number !== undefined && Number.isFinite(hist.chapter.chapter_number)) {
        currentChapter = Math.max(currentChapter, Math.floor(hist.chapter.chapter_number));
      } else if (hist.chapterId !== undefined && chapters.length > 0) {
        const foundIdx = chapters.findIndex(c => String(c.id) === String(hist.chapterId));
        if (foundIdx !== -1) {
          currentChapter = foundIdx + 1;
        }
      }
    }

    // Also check read flags on chapter objects if present
    if (chapters.length > 0) {
      const readCount = chapters.filter(c => c.read || (c.last_page_read && c.last_page_read > 0)).length;
      if (readCount > currentChapter) {
        currentChapter = readCount;
      }
    }

    // Check statistics map for reading chapters and time integration
    const stat = (mId ? statisticsMap.get(mId) : null) || statisticsMap.get(title.toLowerCase().trim()) || (sourceUrl ? statisticsMap.get(sourceUrl) : null);
    if (stat) {
      if (stat.chaptersRead && stat.chaptersRead > currentChapter) {
        currentChapter = stat.chaptersRead;
      }
    }

    // Direct chapter progress fields
    if (typeof entry.currentChapter === 'number' && entry.currentChapter > currentChapter) {
      currentChapter = entry.currentChapter;
    }
    if (typeof (m as any).currentChapter === 'number' && (m as any).currentChapter > currentChapter) {
      currentChapter = (m as any).currentChapter;
    }
    if (typeof entry.progress === 'number' && entry.progress > currentChapter) {
      currentChapter = entry.progress;
    }
    if (typeof (m as any).progress === 'number' && (m as any).progress > currentChapter) {
      currentChapter = (m as any).progress;
    }
    if (typeof (entry as any).lastChapterRead === 'number' && (entry as any).lastChapterRead > currentChapter) {
      currentChapter = (entry as any).lastChapterRead;
    }

    // Favorites & Library inclusion: all items in a Kotatsu backup are user library items
    const isFavorite = entry.favorite !== false && (entry as any).isFavorite !== false;

    // Timestamps
    const createdAtMs = entry.createdAt || entry.created_at || (m as any).createdAt;
    const addedAt = createdAtMs ? new Date(Number(createdAtMs)).toISOString() : new Date().toISOString();
    const updatedAtMs = hist?.updatedAt || hist?.updated_at || hist?.last_read_at || (stat?.lastRead ? Number(stat.lastRead) : null);
    const lastReadAt = updatedAtMs ? new Date(Number(updatedAtMs)).toISOString() : addedAt;

    let notes = 'Imported from Kotatsu backup';
    if (stat && stat.timeSpentSeconds && stat.timeSpentSeconds > 0) {
      const hrs = Math.floor(stat.timeSpentSeconds / 3600);
      const mins = Math.round((stat.timeSpentSeconds % 3600) / 60);
      const timeStr = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
      notes = `Imported from Kotatsu backup • ${timeStr} reading time`;
    }

    const categories: string[] = [];
    if (entry.categoryId !== undefined && entry.categoryId !== null) {
      categories.push(String(entry.categoryId));
    } else if (entry.category_id !== undefined && entry.category_id !== null) {
      categories.push(String(entry.category_id));
    }
    if (Array.isArray(entry.categories)) {
      for (const c of entry.categories) {
        const cName = typeof c === 'string' ? c : (c.name || (c.id ? String(c.id) : ''));
        if (cName && !categories.includes(cName)) categories.push(cName);
      }
    }

    const hasWorkingSource = Boolean(sourceUrl && sourceUrl.trim().length > 0 && !isMangaDexSourceLink(sourceName, sourceUrl));
    const isFlagged = !hasWorkingSource;
    const flagReason = !hasWorkingSource ? 'Missing source' : undefined;
    const id = `kotatsu_${Date.now()}_${i}_${title.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 16)}`;

    importedItems.push({
      id,
      title,
      altTitles,
      type,
      coverImage: coverImage || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=400&q=80',
      description,
      genres,
      status,
      currentChapter: Math.max(0, currentChapter),
      totalChapters: Math.max(totalChapters, currentChapter, 1),
      latestChapter: Math.max(totalChapters, currentChapter, 1),
      lastUpdated: new Date().toISOString(),
      rating,
      sourceUrl,
      sourceName,
      autoUpdateEnabled: true,
      notes,
      addedAt,
      lastReadAt,
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
 * Export Graywood Reader library into standard Kotatsu JSON backup format.
 */
export function exportToKotatsuBackup(mangaList: MangaItem[]): string {
  const kotatsuData: KotatsuBackupPayload = {
    version: 1,
    categories: [
      { id: 0, name: 'Default', order: 0 },
      { id: 1, name: 'Favorites', order: 1 },
    ],
    favourites: mangaList.map((m, idx) => {
      const state = m.status === 'completed' ? 'FINISHED'
        : m.status === 'dropped' ? 'ABANDONED'
        : m.status === 'on_hold' ? 'PAUSED'
        : m.status === 'plan_to_read' ? 'UPCOMING'
        : 'ONGOING';

      const chapters: KotatsuChapter[] = Array.from({ length: m.totalChapters || 1 }, (_, cIdx) => ({
        id: cIdx + 1,
        name: `Chapter ${cIdx + 1}`,
        number: cIdx + 1,
        url: `${m.sourceUrl || ''}/chapter-${cIdx + 1}`,
        read: cIdx < m.currentChapter,
        last_page_read: cIdx < m.currentChapter ? 1 : 0,
      }));

      const mangaObj: KotatsuManga = {
        id: idx + 1,
        title: m.title,
        altTitle: m.altTitles?.length ? m.altTitles : undefined,
        url: m.sourceUrl || `/manga/${m.id}`,
        publicUrl: m.sourceUrl || undefined,
        rating: Number((m.rating / 10).toFixed(2)),
        coverUrl: m.coverImage,
        state,
        source: m.sourceName ? m.sourceName.toUpperCase().replace(/\s+/g, '_') : 'KOTATSU',
        genres: m.genres || [],
        description: m.description || '',
        chapters,
      };

      return {
        manga: mangaObj,
        categoryId: m.isFavorite ? 1 : 0,
        createdAt: m.addedAt ? new Date(m.addedAt).getTime() : Date.now(),
        pinned: Boolean(m.isFavorite),
        order: idx + 1,
      };
    }),
    history: mangaList
      .filter(m => m.currentChapter > 0)
      .map((m, idx) => ({
        mangaId: idx + 1,
        chapter: {
          id: m.currentChapter,
          name: `Chapter ${m.currentChapter}`,
          number: m.currentChapter,
        },
        page: 1,
        percent: 1.0,
        updatedAt: m.lastReadAt ? new Date(m.lastReadAt).getTime() : Date.now(),
      })),
  };

  return JSON.stringify(kotatsuData, null, 2);
}
