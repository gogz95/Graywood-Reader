/**
 * Kotatsu Backup Importer & Exporter for Graywood Reader.
 * Converts Kotatsu ZIP (.bk.zip / .zip) and JSON backups into Graywood MangaItems and vice-versa.
 */

import { MangaItem, MangaType, ReadingStatus, isMangaDexSourceLink } from '../types';

export interface KotatsuChapter {
  id?: number | string;
  manga_id?: number | string;
  mangaId?: number | string;
  name?: string;
  title?: string;
  number?: number;
  number_float?: number;
  chapter_number?: number;
  url?: string;
  uploadDate?: number | string;
  upload_date?: number | string;
  scanlator?: string;
  branch?: string;
  read?: boolean | number;
  last_page_read?: number;
  lastPageRead?: number;
  page?: number;
  pages_count?: number;
  pages?: number;
  bookmark?: any;
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
  totalChapters?: number;
}

export interface KotatsuFavouriteEntry {
  manga?: KotatsuManga;
  id?: number | string;
  title?: string;
  name?: string;
  altTitle?: string | string[];
  url?: string;
  publicUrl?: string;
  public_url?: string;
  coverUrl?: string;
  cover_url?: string;
  largeCoverUrl?: string;
  large_cover_url?: string;
  thumbnail_url?: string;
  state?: number | string;
  status?: number | string;
  source?: string;
  genres?: any;
  description?: string;
  chapters?: KotatsuChapter[];
  manga_id?: number | string;
  mangaId?: number | string;
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
  scroll?: number;
  createdAt?: number | string;
  created_at?: number | string;
  updatedAt?: number | string;
  updated_at?: number | string;
  last_read_at?: number | string;
}

export interface KotatsuTrack {
  id?: number | string;
  manga_id?: number | string;
  mangaId?: number | string;
  tracker_id?: number;
  service_id?: number;
  last_chapter_read?: number;
  lastChapterRead?: number;
  chapters_read?: number;
  chaptersRead?: number;
  progress?: number;
  chapter?: number;
  score?: number;
  rating?: number;
  status?: number | string;
  total_chapters?: number;
  totalChapters?: number;
}

export interface KotatsuBookmark {
  id?: number | string;
  manga_id?: number | string;
  mangaId?: number | string;
  manga?: KotatsuManga;
  chapter_id?: number | string;
  chapterId?: number | string;
  chapter?: KotatsuChapter;
  page?: number;
  createdAt?: number | string;
  created_at?: number | string;
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
  chapters?: KotatsuChapter[];
  history?: KotatsuHistoryEntry[];
  categories?: KotatsuCategory[];
  bookmarks?: KotatsuBookmark[];
  tracks?: KotatsuTrack[];
  trackings?: KotatsuTrack[];
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
 * Parses chapter number from string titles / names / URLs with high tolerance.
 */
export function parseChapterNumberFromString(str: string): number {
  if (!str) return 0;
  const clean = str.trim();
  const directNum = parseFloat(clean);
  if (!isNaN(directNum) && Number.isFinite(directNum) && directNum >= 0 && clean === String(directNum)) {
    return directNum;
  }

  const regexes = [
    /(?:chapter|chapitre|capitulo|capitolo|episode|ch\.|ch|ep\.|ep|#)\s*([0-9]+(?:\.[0-9]+)?)/i,
    /(?:vol(?:ume)?\.?\s*[0-9]+\s+)?(?:ch(?:apter)?\.?\s*)([0-9]+(?:\.[0-9]+)?)/i,
    /\/chapter-?([0-9]+(?:\.[0-9]+)?)/i,
    /\/ch-?([0-9]+(?:\.[0-9]+)?)/i,
    /\b([0-9]+(?:\.[0-9]+)?)\b/,
  ];

  for (const rx of regexes) {
    const match = clean.match(rx);
    if (match && match[1]) {
      const parsed = parseFloat(match[1]);
      if (!isNaN(parsed) && Number.isFinite(parsed) && parsed >= 0) {
        return parsed;
      }
    }
  }

  return 0;
}

/**
 * Extracts a numeric chapter position from any chapter object or primitive value.
 */
export function extractChapterNumber(raw: any): number {
  if (raw === undefined || raw === null) return 0;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw >= 0 ? raw : 0;
  }
  if (typeof raw === 'object') {
    if (typeof raw.number === 'number' && Number.isFinite(raw.number) && raw.number >= 0) return raw.number;
    if (typeof raw.chapter_number === 'number' && Number.isFinite(raw.chapter_number) && raw.chapter_number >= 0) return raw.chapter_number;
    if (typeof raw.number_float === 'number' && Number.isFinite(raw.number_float) && raw.number_float >= 0) return raw.number_float;
    const str = String(raw.name || raw.title || raw.url || raw.number || raw.chapter_number || '').trim();
    return parseChapterNumberFromString(str);
  }
  if (typeof raw === 'string') {
    return parseChapterNumberFromString(raw);
  }
  return 0;
}

/**
 * Extracts files from a ZIP archive ArrayBuffer / Uint8Array in standard JS environments.
 * Uses native DecompressionStream('deflate-raw') if available (modern browsers & Node 18+),
 * with support for uncompressed stored files.
 */
async function decompressDeflateStream(slice: Uint8Array): Promise<string> {
  const cleanSlice = new Uint8Array(slice);
  if (typeof DecompressionStream !== 'undefined') {
    for (const format of ['deflate-raw', 'deflate', 'gzip'] as const) {
      try {
        const stream = new Response(cleanSlice).body!.pipeThrough(new DecompressionStream(format));
        const text = await new Response(stream).text();
        if (text) return text;
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
  userId: string = 'usr_admin',
  onProgress?: (status: string, percent: number) => void
): Promise<MangaItem[]> {
  onProgress?.('Extracting archive structure...', 8);

  const rawMangaList: KotatsuManga[] = [];
  const rawFavouritesList: KotatsuFavouriteEntry[] = [];
  const rawChaptersList: KotatsuChapter[] = [];
  const rawHistoryList: KotatsuHistoryEntry[] = [];
  const rawBookmarksList: KotatsuBookmark[] = [];
  const rawTracksList: KotatsuTrack[] = [];
  const categoriesMap: Map<string | number, string> = new Map();
  const favToCategoriesMap = new Map<string, Array<string | number>>();
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

      for (const [name, content] of Object.entries(files)) {
        const base = getBase(name);
        if (base === 'sources' || base === 'sources.json' || base === 'settings' || base === 'settings.json') continue;

        // Categories
        if (base === 'categories' || base === 'categories.json' || (base.includes('categor') && !base.includes('favourit') && !base.includes('favorit'))) {
          try {
            const parsedCats = JSON.parse(content);
            const list: any[] = Array.isArray(parsedCats)
              ? parsedCats
              : Array.isArray(parsedCats?.categories)
              ? parsedCats.categories
              : Array.isArray(parsedCats?.items)
              ? parsedCats.items
              : typeof parsedCats === 'object' && parsedCats !== null
              ? Object.entries(parsedCats).map(([k, v]) => (typeof v === 'string' ? { id: k, name: v } : { id: (v as any)?.id || k, name: (v as any)?.name || (v as any)?.title || String(v) }))
              : [];
            for (const cat of list) {
              if (!cat) continue;
              const catId = cat.id !== undefined ? cat.id : cat.category_id !== undefined ? cat.category_id : cat.categoryId;
              const catName = cat.name || cat.title || cat.category_name || cat.categoryName || (typeof cat === 'string' ? cat : undefined);
              if (catId !== undefined && catName) {
                categoriesMap.set(catId, String(catName).trim());
                categoriesMap.set(String(catId), String(catName).trim());
                if (!isNaN(Number(catId))) categoriesMap.set(Number(catId), String(catName).trim());
              }
            }
          } catch {}
        }
        // Favourites Categories junction
        else if (base === 'favourites_categories' || base === 'favourites_categories.json' || base === 'favorites_categories' || base === 'favorites_categories.json' || base.includes('favourite_categor') || base.includes('favorite_categor') || base.includes('favourites_cat') || base.includes('favorites_cat')) {
          try {
            const parsedJunction = JSON.parse(content);
            const list: any[] = Array.isArray(parsedJunction)
              ? parsedJunction
              : Array.isArray(parsedJunction?.favourites_categories)
              ? parsedJunction.favourites_categories
              : Array.isArray(parsedJunction?.favorites_categories)
              ? parsedJunction.favorites_categories
              : typeof parsedJunction === 'object' && parsedJunction !== null
              ? Object.values(parsedJunction)
              : [];
            for (const j of list) {
              if (!j) continue;
              if (Array.isArray(j) && j.length >= 2) {
                const favId = String(j[0]);
                const catId = j[1];
                const arr = favToCategoriesMap.get(favId) || [];
                arr.push(catId);
                favToCategoriesMap.set(favId, arr);
                continue;
              }
              const favId = j.favourite_id !== undefined ? String(j.favourite_id)
                : j.favouriteId !== undefined ? String(j.favouriteId)
                : j.manga_id !== undefined ? String(j.manga_id)
                : j.mangaId !== undefined ? String(j.mangaId)
                : j.fav_id !== undefined ? String(j.fav_id)
                : j.id !== undefined ? String(j.id)
                : '';
              const catId = j.category_id !== undefined ? j.category_id
                : j.categoryId !== undefined ? j.categoryId
                : j.cat_id !== undefined ? j.cat_id
                : j.category !== undefined ? j.category
                : j.id;
              if (favId && catId !== undefined) {
                const arr = favToCategoriesMap.get(favId) || [];
                arr.push(catId);
                favToCategoriesMap.set(favId, arr);
              }
            }
          } catch {}
        }
        // Chapters (critical for reading progress & chapter count)
        else if (base === 'chapters' || base === 'chapters.json' || base === 'chapter' || base === 'chapter.json' || (base.includes('chapter') && !base.includes('history'))) {
          try {
            const parsedChapters = JSON.parse(content);
            const list = Array.isArray(parsedChapters) ? parsedChapters : parsedChapters.chapters || parsedChapters.items || [];
            if (Array.isArray(list) && list.length > 0) {
              rawChaptersList.push(...list);
            }
          } catch {}
        }
        // History
        else if (base === 'history' || base === 'history.json' || (base.includes('history') && !base.includes('categor'))) {
          try {
            const parsedHistory = JSON.parse(content);
            const list = Array.isArray(parsedHistory) ? parsedHistory : parsedHistory.history || [];
            if (Array.isArray(list) && list.length > 0) {
              rawHistoryList.push(...list);
            }
          } catch {}
        }
        // Bookmarks
        else if (base === 'bookmarks' || base === 'bookmarks.json') {
          try {
            const parsedBm = JSON.parse(content);
            const list = Array.isArray(parsedBm) ? parsedBm : parsedBm.bookmarks || [];
            if (Array.isArray(list) && list.length > 0) {
              rawBookmarksList.push(...list);
            }
          } catch {}
        }
        // Tracks (tracker sync progress)
        else if (base === 'tracks' || base === 'tracks.json' || base === 'track' || base === 'track.json' || base === 'trackings' || base === 'trackings.json') {
          try {
            const parsedTracks = JSON.parse(content);
            const list = Array.isArray(parsedTracks) ? parsedTracks : parsedTracks.tracks || parsedTracks.trackings || parsedTracks.items || [];
            if (Array.isArray(list) && list.length > 0) {
              rawTracksList.push(...list);
            }
          } catch {}
        }
        // Statistics
        else if (base === 'statistics' || base === 'statistics.json' || base.includes('statistic')) {
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
        // Favourites
        else if (base === 'favourites' || base === 'favourites.json' || base === 'favorites' || base === 'favorites.json') {
          try {
            const parsedFavs = JSON.parse(content);
            const list = Array.isArray(parsedFavs) ? parsedFavs : parsedFavs.favourites || parsedFavs.favorites || [];
            if (Array.isArray(list) && list.length > 0) {
              rawFavouritesList.push(...list);
            }
          } catch {}
        }
        // Manga catalog table
        else if (base === 'manga' || base === 'mangas' || base === 'manga.json' || base === 'mangas.json') {
          try {
            const parsedManga = JSON.parse(content);
            const list = Array.isArray(parsedManga) ? parsedManga : parsedManga.mangas || parsedManga.manga || [];
            if (Array.isArray(list) && list.length > 0) {
              rawMangaList.push(...list);
            }
          } catch {}
        }
      }
    }
  }

  // 2. If no files were extracted from ZIP, parse as raw JSON or compressed JSON
  if (rawFavouritesList.length === 0 && rawMangaList.length === 0) {
    let jsonString = '';
    if (typeof input === 'string') {
      jsonString = input;
    } else {
      try {
        const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
        if (u8.length >= 2 && u8[0] === 0x1f && u8[1] === 0x8b) {
          if (typeof DecompressionStream !== 'undefined') {
            try {
              const stream = new Response(new Uint8Array(u8)).body!.pipeThrough(new DecompressionStream('gzip'));
              jsonString = await new Response(stream).text();
            } catch {}
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
        rawFavouritesList.push(...parsed);
      } else if (typeof parsed === 'object' && parsed !== null) {
        if (Array.isArray(parsed.favourites)) rawFavouritesList.push(...parsed.favourites);
        if (Array.isArray(parsed.favorites)) rawFavouritesList.push(...parsed.favorites);
        if (Array.isArray(parsed.manga)) rawMangaList.push(...parsed.manga);
        if (Array.isArray(parsed.mangas)) rawMangaList.push(...parsed.mangas);
        if (Array.isArray(parsed.chapters)) rawChaptersList.push(...parsed.chapters);
        if (Array.isArray(parsed.history)) rawHistoryList.push(...parsed.history);
        if (Array.isArray(parsed.bookmarks)) rawBookmarksList.push(...parsed.bookmarks);
        if (Array.isArray(parsed.tracks)) rawTracksList.push(...parsed.tracks);
        if (Array.isArray(parsed.trackings)) rawTracksList.push(...parsed.trackings);

        const rawCats = parsed.categories || parsed.items || [];
        if (Array.isArray(rawCats)) {
          for (const cat of rawCats) {
            if (!cat) continue;
            const catId = cat.id !== undefined ? cat.id : cat.category_id !== undefined ? cat.category_id : cat.categoryId;
            const catName = cat.name || cat.title || cat.category_name || (typeof cat === 'string' ? cat : undefined);
            if (catId !== undefined && catName) {
              categoriesMap.set(catId, String(catName).trim());
              categoriesMap.set(String(catId), String(catName).trim());
              if (!isNaN(Number(catId))) categoriesMap.set(Number(catId), String(catName).trim());
            }
          }
        } else if (typeof rawCats === 'object' && rawCats !== null) {
          for (const [k, v] of Object.entries(rawCats)) {
            if (typeof v === 'string') {
              categoriesMap.set(k, v.trim());
              if (!isNaN(Number(k))) categoriesMap.set(Number(k), v.trim());
            } else if (v && typeof v === 'object') {
              const name = (v as any).name || (v as any).title;
              if (name) {
                categoriesMap.set(k, String(name).trim());
                if (!isNaN(Number(k))) categoriesMap.set(Number(k), String(name).trim());
              }
            }
          }
        }

        const rawJunction = parsed.favourites_categories || parsed.favorites_categories || [];
        if (Array.isArray(rawJunction)) {
          for (const j of rawJunction) {
            if (!j) continue;
            const favId = j.favourite_id !== undefined ? String(j.favourite_id) : j.favouriteId !== undefined ? String(j.favouriteId) : j.manga_id !== undefined ? String(j.manga_id) : j.mangaId !== undefined ? String(j.mangaId) : '';
            const catId = j.category_id !== undefined ? j.category_id : j.categoryId !== undefined ? j.categoryId : j.id;
            if (favId && catId !== undefined) {
              const arr = favToCategoriesMap.get(favId) || [];
              arr.push(catId);
              favToCategoriesMap.set(favId, arr);
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
        seriesCount: statisticsMap.size || (rawFavouritesList.length + rawMangaList.length),
      }));
    } catch {}
  }

  // 3. Index Chapters by Chapter ID and Manga ID
  const chapterByIdMap = new Map<string, KotatsuChapter>();
  const chaptersByMangaMap = new Map<string, KotatsuChapter[]>();

  const indexChapter = (c: KotatsuChapter, defaultMangaId?: string | number) => {
    if (!c) return;
    if (c.id !== undefined) {
      chapterByIdMap.set(String(c.id), c);
    }
    const mId = c.manga_id !== undefined ? String(c.manga_id) : c.mangaId !== undefined ? String(c.mangaId) : (defaultMangaId !== undefined ? String(defaultMangaId) : '');
    if (mId) {
      const arr = chaptersByMangaMap.get(mId) || [];
      arr.push(c);
      chaptersByMangaMap.set(mId, arr);
    }
  };

  for (const ch of rawChaptersList) {
    indexChapter(ch);
  }

  // Also index chapters embedded directly on manga / favourites
  for (const m of rawMangaList) {
    if (Array.isArray(m.chapters)) {
      for (const ch of m.chapters) {
        indexChapter(ch, m.id);
      }
    }
  }
  for (const f of rawFavouritesList) {
    const m = f.manga || f;
    const mId = m.id !== undefined ? m.id : f.manga_id || f.mangaId || f.id;
    if (Array.isArray(m.chapters)) {
      for (const ch of m.chapters) {
        indexChapter(ch, mId);
      }
    }
    if (Array.isArray(f.chapters)) {
      for (const ch of f.chapters) {
        indexChapter(ch, mId);
      }
    }
  }

  // 4. Index History by Manga ID, URL, Title, and Chapter ID
  const historyByMangaMap = new Map<string, KotatsuHistoryEntry[]>();
  for (const h of rawHistoryList) {
    if (!h) continue;
    const m = h.manga;
    const keys: string[] = [];
    if (h.mangaId !== undefined) keys.push(String(h.mangaId));
    if (h.manga_id !== undefined) keys.push(String(h.manga_id));
    if (m?.id !== undefined) keys.push(String(m.id));
    if (m?.title) keys.push(m.title.toLowerCase().trim());
    if (m?.publicUrl) keys.push(m.publicUrl);
    if (m?.url) keys.push(m.url);

    // Also index if embedded chapter has mangaId
    if (h.chapter?.manga_id !== undefined) keys.push(String(h.chapter.manga_id));
    if (h.chapter?.mangaId !== undefined) keys.push(String(h.chapter.mangaId));

    // If chapterId exists, check indexed chapters to find parent manga_id
    const chId = h.chapterId !== undefined ? String(h.chapterId) : h.chapter_id !== undefined ? String(h.chapter_id) : (h.chapter?.id !== undefined ? String(h.chapter.id) : '');
    if (chId && chapterByIdMap.has(chId)) {
      const parentCh = chapterByIdMap.get(chId)!;
      const parentMId = parentCh.manga_id !== undefined ? String(parentCh.manga_id) : parentCh.mangaId !== undefined ? String(parentCh.mangaId) : '';
      if (parentMId) keys.push(parentMId);
    }

    const uniqueKeys = Array.from(new Set(keys.filter(Boolean)));
    for (const k of uniqueKeys) {
      const arr = historyByMangaMap.get(k) || [];
      arr.push(h);
      historyByMangaMap.set(k, arr);
    }
  }

  // 5. Index Tracks by Manga ID
  const tracksByMangaMap = new Map<string, KotatsuTrack[]>();
  for (const t of rawTracksList) {
    if (!t) continue;
    const keys: string[] = [];
    if (t.manga_id !== undefined) keys.push(String(t.manga_id));
    if (t.mangaId !== undefined) keys.push(String(t.mangaId));
    if (t.id !== undefined) keys.push(String(t.id));

    const uniqueKeys = Array.from(new Set(keys.filter(Boolean)));
    for (const k of uniqueKeys) {
      const arr = tracksByMangaMap.get(k) || [];
      arr.push(t);
      tracksByMangaMap.set(k, arr);
    }
  }

  // 6. Index Bookmarks by Manga ID
  const bookmarksByMangaMap = new Map<string, KotatsuBookmark[]>();
  for (const bm of rawBookmarksList) {
    if (!bm) continue;
    const keys: string[] = [];
    if (bm.manga_id !== undefined) keys.push(String(bm.manga_id));
    if (bm.mangaId !== undefined) keys.push(String(bm.mangaId));
    if (bm.manga?.id !== undefined) keys.push(String(bm.manga.id));

    const chId = bm.chapter_id !== undefined ? String(bm.chapter_id) : bm.chapterId !== undefined ? String(bm.chapterId) : '';
    if (chId && chapterByIdMap.has(chId)) {
      const parentCh = chapterByIdMap.get(chId)!;
      const parentMId = parentCh.manga_id !== undefined ? String(parentCh.manga_id) : parentCh.mangaId !== undefined ? String(parentCh.mangaId) : '';
      if (parentMId) keys.push(parentMId);
    }

    const uniqueKeys = Array.from(new Set(keys.filter(Boolean)));
    for (const k of uniqueKeys) {
      const arr = bookmarksByMangaMap.get(k) || [];
      arr.push(bm);
      bookmarksByMangaMap.set(k, arr);
    }
  }

  // 7. Unify Manga and Favourites entries
  // In Kotatsu, manga.json holds manga details, and favourites.json holds user favourites / category junctions.
  interface MergedMangaEntry {
    manga: KotatsuManga;
    favourite?: KotatsuFavouriteEntry;
    isFavorite: boolean;
  }

  const uniqueEntriesMap = new Map<string, MergedMangaEntry>();
  const aliasToCanonicalKey = new Map<string, string>();

  const getCanonicalKey = (m?: KotatsuManga, f?: KotatsuFavouriteEntry, fallbackIndex: number = 0): string => {
    const id = m?.id !== undefined && m?.id !== null ? String(m.id)
      : f?.manga_id !== undefined && f?.manga_id !== null ? String(f.manga_id)
      : f?.mangaId !== undefined && f?.mangaId !== null ? String(f.mangaId)
      : f?.id !== undefined && f?.id !== null ? String(f.id)
      : '';
    if (id) return `id:${id}`;
    const url = m?.publicUrl || m?.public_url || m?.url || f?.publicUrl || f?.public_url || f?.url;
    if (url && url.trim()) return `url:${url.toLowerCase().trim()}`;
    const title = m?.title || m?.name || f?.title || f?.name;
    if (title && String(title).trim()) return `title:${String(title).toLowerCase().trim()}`;
    return `item:${fallbackIndex}_${Math.random().toString(36).substring(2, 7)}`;
  };

  const registerAliases = (canonicalKey: string, m?: KotatsuManga, f?: KotatsuFavouriteEntry) => {
    const id = m?.id !== undefined ? String(m.id) : (f?.manga_id !== undefined ? String(f.manga_id) : (f?.mangaId !== undefined ? String(f.mangaId) : (f?.id !== undefined ? String(f.id) : '')));
    if (id) aliasToCanonicalKey.set(`id:${id}`, canonicalKey);
    const title = m?.title || m?.name || f?.title || f?.name;
    if (title && String(title).trim()) aliasToCanonicalKey.set(`title:${String(title).toLowerCase().trim()}`, canonicalKey);
    const url = m?.publicUrl || m?.public_url || m?.url || f?.publicUrl || f?.public_url || f?.url;
    if (url && url.trim()) aliasToCanonicalKey.set(`url:${url.toLowerCase().trim()}`, canonicalKey);
  };

  // Add all entries from manga table
  for (let idx = 0; idx < rawMangaList.length; idx++) {
    const m = rawMangaList[idx];
    if (!m) continue;
    const canonicalKey = getCanonicalKey(m, undefined, idx);
    let entry = uniqueEntriesMap.get(canonicalKey);
    if (!entry) {
      entry = { manga: m, isFavorite: true };
      uniqueEntriesMap.set(canonicalKey, entry);
    } else {
      entry.manga = { ...entry.manga, ...m };
    }
    registerAliases(canonicalKey, m);
  }

  // Merge entries from favourites table
  for (let idx = 0; idx < rawFavouritesList.length; idx++) {
    const f = rawFavouritesList[idx];
    if (!f) continue;
    const m = f.manga || f;
    const mId = f.manga_id !== undefined ? f.manga_id : f.mangaId !== undefined ? f.mangaId : m?.id;
    const title = m?.title || m?.name || f.title || f.name;
    const url = m?.publicUrl || m?.public_url || m?.url || f.publicUrl || f.public_url || f.url;

    let canonicalKey: string | undefined = undefined;
    if (mId !== undefined && aliasToCanonicalKey.has(`id:${mId}`)) {
      canonicalKey = aliasToCanonicalKey.get(`id:${mId}`);
    } else if (title && aliasToCanonicalKey.has(`title:${String(title).toLowerCase().trim()}`)) {
      canonicalKey = aliasToCanonicalKey.get(`title:${String(title).toLowerCase().trim()}`);
    } else if (url && aliasToCanonicalKey.has(`url:${url.toLowerCase().trim()}`)) {
      canonicalKey = aliasToCanonicalKey.get(`url:${url.toLowerCase().trim()}`);
    } else {
      canonicalKey = getCanonicalKey(m, f, idx);
    }

    let entry = uniqueEntriesMap.get(canonicalKey!);
    if (entry) {
      entry.manga = { ...entry.manga, ...(f.manga || {}) };
      if (f.title && !entry.manga.title) entry.manga.title = f.title;
      if (f.source && !entry.manga.source) entry.manga.source = f.source;
      if (f.coverUrl && !entry.manga.coverUrl) entry.manga.coverUrl = f.coverUrl;
      entry.favourite = { ...(entry.favourite || {}), ...f };
      if (f.favorite !== false && (f as any).isFavorite !== false) {
        entry.isFavorite = true;
      }
    } else {
      entry = {
        manga: m || (f.manga_id ? { id: f.manga_id } : {}),
        favourite: f,
        isFavorite: f.favorite !== false && (f as any).isFavorite !== false,
      };
      uniqueEntriesMap.set(canonicalKey!, entry);
    }
    registerAliases(canonicalKey!, m, f);
  }

  // Collect unique series to import
  const uniqueEntries = Array.from(uniqueEntriesMap.values());

  if (uniqueEntries.length === 0) {
    throw new Error('No manga entries found in the Kotatsu backup.');
  }

  onProgress?.(`Parsed ${uniqueEntries.length} series metadata entries. Resolving reading history & categories...`, 20);

  const importedItems: MangaItem[] = [];

  for (let i = 0; i < uniqueEntries.length; i++) {
    const { manga: m, favourite: entry, isFavorite } = uniqueEntries[i];
    const rawTitle = m.title || m.name || entry?.title || entry?.name;
    const title = (rawTitle && String(rawTitle).trim()) || `Series #${i + 1}`;
    if (!title || (title.startsWith('Series #') && !m.url && !m.publicUrl && !m.source)) {
      // Skip pure junction stubs with zero metadata
      continue;
    }

    // Alt titles
    const rawAlt = m.altTitle || m.alt_title || entry?.altTitle;
    const altTitles: string[] = Array.isArray(rawAlt)
      ? rawAlt.filter(Boolean).map(String)
      : typeof rawAlt === 'string' && rawAlt.trim()
        ? [rawAlt.trim()]
        : [];

    // URLs & Cover
    const sourceUrl = m.publicUrl || m.public_url || m.url || entry?.publicUrl || entry?.url || '';
    const coverImage = m.largeCoverUrl || m.large_cover_url || m.coverUrl || m.cover_url || m.thumbnail_url || entry?.coverUrl || entry?.cover_url || '';
    const rawSource = m.source || (entry as any)?.source || 'Kotatsu';
    const sourceName = formatKotatsuSourceName(rawSource);
    const description = m.description || m.summary || entry?.description || '';

    // Genres
    let genres: string[] = [];
    const rawGenres = m.genres || entry?.genres;
    if (Array.isArray(rawGenres)) {
      genres = rawGenres.map((g: any) => typeof g === 'string' ? g : g?.name || '').filter(Boolean);
    } else if (typeof rawGenres === 'string') {
      genres = rawGenres.split(',').map(s => s.trim()).filter(Boolean);
    }

    // Status
    let status = mapKotatsuStatus(m.state !== undefined ? m.state : (m.status !== undefined ? m.status : (entry?.state !== undefined ? entry.state : entry?.status)));
    const type = detectKotatsuFormat(genres, title);

    // Rating
    let rating = 9.0;
    const rawRating = m.rating !== undefined ? m.rating : (entry as any)?.rating;
    if (typeof rawRating === 'number' && Number.isFinite(rawRating)) {
      rating = rawRating <= 1 ? Number((rawRating * 10).toFixed(1)) : Number(rawRating.toFixed(1));
    }

    // ── CHAPTERS & READING PROGRESS RESOLUTION ──────────────────────────────
    const mIdStr = m.id !== undefined ? String(m.id) : (entry?.id !== undefined ? String(entry.id) : (entry?.manga_id !== undefined ? String(entry.manga_id) : ''));
    const titleKey = title.toLowerCase().trim();

    // 1. Gather all associated chapters for this manga
    const mangaChapters: KotatsuChapter[] = [
      ...(mIdStr ? (chaptersByMangaMap.get(mIdStr) || []) : []),
      ...(chaptersByMangaMap.get(titleKey) || []),
      ...(Array.isArray(m.chapters) ? m.chapters : []),
      ...(entry && Array.isArray(entry.chapters) ? entry.chapters : []),
    ];

    // Deduplicate chapters by ID or URL or number
    const seenChKeys = new Set<string>();
    const uniqueChapters: KotatsuChapter[] = [];
    for (const c of mangaChapters) {
      if (!c) continue;
      const cKey = c.id !== undefined ? `id_${c.id}` : (c.url ? `url_${c.url}` : `num_${c.number}_${c.name}`);
      if (!seenChKeys.has(cKey)) {
        seenChKeys.add(cKey);
        uniqueChapters.push(c);
      }
    }

    let currentChapter = 0;
    let totalChapters = uniqueChapters.length > 0 ? uniqueChapters.length : 1;

    // A. Calculate progress from read flags in chapters table
    for (const c of uniqueChapters) {
      const isRead = Boolean(c.read === true || c.read === 1 || (c.last_page_read && c.last_page_read > 0) || (c.page && c.page > 0));
      if (isRead) {
        const chNum = extractChapterNumber(c);
        if (chNum > currentChapter) {
          currentChapter = chNum;
        }
      }
    }
    const readCount = uniqueChapters.filter(c => c.read === true || c.read === 1 || (c.last_page_read && c.last_page_read > 0)).length;
    if (readCount > currentChapter) {
      currentChapter = readCount;
    }

    // B. Calculate progress from History entries
    const historyListForManga: KotatsuHistoryEntry[] = [
      ...(mIdStr ? (historyByMangaMap.get(mIdStr) || []) : []),
      ...(historyByMangaMap.get(titleKey) || []),
      ...(sourceUrl ? (historyByMangaMap.get(sourceUrl) || []) : []),
    ];

    let latestHistoryTimestamp: number | null = null;

    for (const hist of historyListForManga) {
      if (!hist) continue;
      const histTime = Number(hist.updatedAt || hist.updated_at || hist.last_read_at || hist.createdAt || hist.created_at);
      if (histTime && (!latestHistoryTimestamp || histTime > latestHistoryTimestamp)) {
        latestHistoryTimestamp = histTime;
      }

      // Check embedded chapter object on history
      if (hist.chapter) {
        const chNum = extractChapterNumber(hist.chapter);
        if (chNum > currentChapter) {
          currentChapter = chNum;
        }
      }

      // Resolve chapterId against indexed chapters
      const chId = hist.chapterId !== undefined ? String(hist.chapterId) : (hist.chapter_id !== undefined ? String(hist.chapter_id) : '');
      if (chId) {
        const chObj = chapterByIdMap.get(chId);
        if (chObj) {
          const chNum = extractChapterNumber(chObj);
          if (chNum > currentChapter) {
            currentChapter = chNum;
          }
        } else if (uniqueChapters.length > 0) {
          const foundIdx = uniqueChapters.findIndex(c => String(c.id) === chId);
          if (foundIdx !== -1) {
            const chNum = extractChapterNumber(uniqueChapters[foundIdx]) || (foundIdx + 1);
            if (chNum > currentChapter) {
              currentChapter = chNum;
            }
          }
        }
      }

      // Fallback: direct chapter progress on history entry
      if (typeof hist.progress === 'number' && hist.progress > currentChapter) {
        currentChapter = hist.progress;
      }
    }

    // C. Calculate progress from Tracker sync records (tracks.json)
    const tracksListForManga: KotatsuTrack[] = [
      ...(mIdStr ? (tracksByMangaMap.get(mIdStr) || []) : []),
      ...(tracksByMangaMap.get(titleKey) || []),
    ];

    for (const trk of tracksListForManga) {
      if (!trk) continue;
      const trkCh = trk.last_chapter_read ?? trk.lastChapterRead ?? trk.chapters_read ?? trk.chaptersRead ?? trk.progress ?? trk.chapter;
      if (typeof trkCh === 'number' && trkCh > currentChapter) {
        currentChapter = trkCh;
      }
      const trkTotal = trk.total_chapters ?? trk.totalChapters;
      if (typeof trkTotal === 'number' && trkTotal > totalChapters) {
        totalChapters = trkTotal;
      }
    }

    // D. Calculate progress from Bookmarks
    const bookmarksListForManga: KotatsuBookmark[] = [
      ...(mIdStr ? (bookmarksByMangaMap.get(mIdStr) || []) : []),
      ...(bookmarksByMangaMap.get(titleKey) || []),
    ];

    for (const bm of bookmarksListForManga) {
      if (!bm) continue;
      if (bm.chapter) {
        const chNum = extractChapterNumber(bm.chapter);
        if (chNum > currentChapter) currentChapter = chNum;
      }
      const bmChId = bm.chapter_id !== undefined ? String(bm.chapter_id) : (bm.chapterId !== undefined ? String(bm.chapterId) : '');
      if (bmChId) {
        const chObj = chapterByIdMap.get(bmChId);
        if (chObj) {
          const chNum = extractChapterNumber(chObj);
          if (chNum > currentChapter) currentChapter = chNum;
        }
      }
    }

    // E. Calculate progress from Statistics map
    const stat = (mIdStr ? statisticsMap.get(mIdStr) : null) || statisticsMap.get(titleKey) || (sourceUrl ? statisticsMap.get(sourceUrl) : null);
    if (stat && typeof stat.chaptersRead === 'number' && stat.chaptersRead > currentChapter) {
      currentChapter = stat.chaptersRead;
    }

    // F. Direct chapter progress fields on entry and manga
    if (typeof entry?.currentChapter === 'number' && entry.currentChapter > currentChapter) {
      currentChapter = entry.currentChapter;
    }
    if (typeof (m as any).currentChapter === 'number' && (m as any).currentChapter > currentChapter) {
      currentChapter = (m as any).currentChapter;
    }
    if (typeof entry?.progress === 'number' && entry.progress > currentChapter) {
      currentChapter = entry.progress;
    }
    if (typeof (m as any).progress === 'number' && (m as any).progress > currentChapter) {
      currentChapter = (m as any).progress;
    }
    if (typeof (entry as any)?.lastChapterRead === 'number' && (entry as any).lastChapterRead > currentChapter) {
      currentChapter = (entry as any).lastChapterRead;
    }
    if (typeof (m as any).lastChapterRead === 'number' && (m as any).lastChapterRead > currentChapter) {
      currentChapter = (m as any).lastChapterRead;
    }

    // Compute maximum chapter numbers for totalChapters
    const maxChFromList = uniqueChapters.reduce((max, c) => Math.max(max, extractChapterNumber(c)), 0);
    totalChapters = Math.max(totalChapters, uniqueChapters.length, maxChFromList, m.totalChapters || 0, currentChapter, 1);

    // If reading progress exists and status is plan_to_read, mark as reading
    if (currentChapter > 0 && status === 'plan_to_read') {
      status = 'reading';
    }
    // If status is completed and currentChapter is 0, complete it at totalChapters
    if (status === 'completed' && currentChapter === 0 && totalChapters > 0) {
      currentChapter = totalChapters;
    }

    // Timestamps
    const createdAtMs = entry?.createdAt || entry?.created_at || (m as any).createdAt || (m as any).created_at;
    const addedAt = createdAtMs ? new Date(Number(createdAtMs)).toISOString() : new Date().toISOString();
    const updatedAtMs = latestHistoryTimestamp || (stat?.lastRead ? Number(stat.lastRead) : null);
    const lastReadAt = updatedAtMs ? new Date(Number(updatedAtMs)).toISOString() : addedAt;

    let notes = 'Imported from Kotatsu backup';
    if (stat && stat.timeSpentSeconds && stat.timeSpentSeconds > 0) {
      const hrs = Math.floor(stat.timeSpentSeconds / 3600);
      const mins = Math.round((stat.timeSpentSeconds % 3600) / 60);
      const timeStr = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
      notes = `Imported from Kotatsu backup • ${timeStr} reading time`;
    }

    // ── CATEGORIES RESOLUTION ──────────────────────────────────────────────
    const categories: string[] = [];
    const catIdCandidates: Array<string | number> = [];

    const e = (entry || {}) as any;
    if (e.categoryId !== undefined && e.categoryId !== null) catIdCandidates.push(e.categoryId);
    if (e.category_id !== undefined && e.category_id !== null) catIdCandidates.push(e.category_id);
    if (e.cat_id !== undefined && e.cat_id !== null) catIdCandidates.push(e.cat_id);
    if (e.catId !== undefined && e.catId !== null) catIdCandidates.push(e.catId);
    if (e.category !== undefined && e.category !== null) {
      if (typeof e.category === 'string' || typeof e.category === 'number') catIdCandidates.push(e.category);
      else if (typeof e.category === 'object') {
        const cName = e.category?.name || e.category?.title;
        if (cName) categories.push(String(cName).trim());
      }
    }
    if (e.category_name) categories.push(String(e.category_name).trim());
    if (e.categoryName) categories.push(String(e.categoryName).trim());
    if (e.category_title) categories.push(String(e.category_title).trim());
    if (e.categoryTitle) categories.push(String(e.categoryTitle).trim());

    if (Array.isArray(e.category_ids)) catIdCandidates.push(...e.category_ids);
    if (Array.isArray(e.categoryIds)) catIdCandidates.push(...e.categoryIds);
    if (Array.isArray(e.cat_ids)) catIdCandidates.push(...e.cat_ids);
    if (Array.isArray(e.catIds)) catIdCandidates.push(...e.catIds);

    // Direct category fields on manga object
    const mAny = m as any;
    if (mAny.categoryId !== undefined && mAny.categoryId !== null) catIdCandidates.push(mAny.categoryId);
    if (mAny.category_id !== undefined && mAny.category_id !== null) catIdCandidates.push(mAny.category_id);
    if (mAny.cat_id !== undefined && mAny.cat_id !== null) catIdCandidates.push(mAny.cat_id);
    if (mAny.catId !== undefined && mAny.catId !== null) catIdCandidates.push(mAny.catId);
    if (mAny.category !== undefined && mAny.category !== null) {
      if (typeof mAny.category === 'string' || typeof mAny.category === 'number') catIdCandidates.push(mAny.category);
      else if (typeof mAny.category === 'object') {
        const cName = mAny.category?.name || mAny.category?.title;
        if (cName) categories.push(String(cName).trim());
      }
    }
    if (mAny.category_name) categories.push(String(mAny.category_name).trim());
    if (mAny.categoryName) categories.push(String(mAny.categoryName).trim());
    if (mAny.category_title) categories.push(String(mAny.category_title).trim());
    if (mAny.categoryTitle) categories.push(String(mAny.categoryTitle).trim());

    if (Array.isArray(mAny.category_ids)) catIdCandidates.push(...mAny.category_ids);
    if (Array.isArray(mAny.categoryIds)) catIdCandidates.push(...mAny.categoryIds);

    // Junction map lookup
    const entryId = entry?.id !== undefined ? String(entry.id) : '';
    const junctionCats = (entryId ? favToCategoriesMap.get(entryId) : null) ||
      (mIdStr ? favToCategoriesMap.get(mIdStr) : null) ||
      (sourceUrl ? favToCategoriesMap.get(sourceUrl) : null) ||
      favToCategoriesMap.get(titleKey);

    if (junctionCats && junctionCats.length > 0) {
      catIdCandidates.push(...junctionCats);
    }

    for (const rawCat of catIdCandidates) {
      if (rawCat === undefined || rawCat === null) continue;
      const resolvedName = categoriesMap.get(rawCat) ||
        categoriesMap.get(String(rawCat)) ||
        (!isNaN(Number(rawCat)) ? categoriesMap.get(Number(rawCat)) : null) ||
        (typeof rawCat === 'string' && isNaN(Number(rawCat)) ? rawCat.trim() : null);

      if (resolvedName && resolvedName.trim() && !categories.includes(resolvedName.trim())) {
        categories.push(resolvedName.trim());
      }
    }

    if (Array.isArray(entry?.categories)) {
      for (const c of entry.categories) {
        if (!c) continue;
        const cObj = c as any;
        let cName = typeof c === 'string'
          ? (categoriesMap.get(c) || categoriesMap.get(Number(c)) || c)
          : typeof c === 'number'
          ? categoriesMap.get(c) || categoriesMap.get(String(c))
          : (cObj.name || cObj.title || (cObj.id !== undefined ? categoriesMap.get(cObj.id) || categoriesMap.get(Number(cObj.id)) : ''));
        if (cName && typeof cName === 'string' && cName.trim() && !categories.includes(cName.trim())) {
          categories.push(cName.trim());
        }
      }
    }

    if (Array.isArray(mAny.categories)) {
      for (const c of mAny.categories) {
        if (!c) continue;
        let cName = typeof c === 'string'
          ? (categoriesMap.get(c) || categoriesMap.get(Number(c)) || c)
          : typeof c === 'number'
          ? categoriesMap.get(c) || categoriesMap.get(String(c))
          : (c.name || c.title || (c.id !== undefined ? categoriesMap.get(c.id) || categoriesMap.get(Number(c.id)) : ''));
        if (cName && typeof cName === 'string' && cName.trim() && !categories.includes(cName.trim())) {
          categories.push(cName.trim());
        }
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
        id: (idx + 1) * 10000 + (cIdx + 1),
        manga_id: idx + 1,
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
        chapterId: (idx + 1) * 10000 + m.currentChapter,
        chapter: {
          id: (idx + 1) * 10000 + m.currentChapter,
          manga_id: idx + 1,
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
