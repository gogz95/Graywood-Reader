/**
 * Kotatsu Backup Importer & Exporter for Graywood Reader.
 * Converts Kotatsu ZIP (.bk.zip / .zip) and JSON backups into Graywood MangaItems and vice-versa.
 */

import { MangaItem, MangaType, ReadingStatus } from '../types';

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
  order?: number;
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
export async function unzipArchive(buffer: ArrayBuffer | Uint8Array): Promise<Record<string, string>> {
  const uint8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(uint8.buffer, uint8.byteOffset, uint8.byteLength);
  const files: Record<string, string> = {};

  let offset = 0;
  const len = uint8.byteLength;

  while (offset + 30 <= len) {
    const signature = view.getUint32(offset, true);
    // Local file header signature = 0x04034b50 ("PK\x03\x04")
    if (signature !== 0x04034b50) {
      break;
    }

    const flags = view.getUint16(offset + 6, true);
    const compressionMethod = view.getUint16(offset + 8, true);
    let compressedSize = view.getUint32(offset + 18, true);
    const fileNameLen = view.getUint16(offset + 26, true);
    const extraFieldLen = view.getUint16(offset + 28, true);

    const nameOffset = offset + 30;
    const nameBytes = uint8.subarray(nameOffset, nameOffset + fileNameLen);
    const fileName = new TextDecoder('utf-8').decode(nameBytes);

    const dataOffset = nameOffset + fileNameLen + extraFieldLen;

    // Handle data descriptor flag (bit 3) where sizes might follow compressed data
    if ((flags & 0x08) && compressedSize === 0) {
      let nextHeader = dataOffset;
      while (nextHeader + 4 <= len) {
        const sig = view.getUint32(nextHeader, true);
        if (sig === 0x04034b50 || sig === 0x02014b50 || sig === 0x08074b50) {
          break;
        }
        nextHeader++;
      }
      compressedSize = nextHeader - dataOffset;
    }

    if (dataOffset + compressedSize > len) {
      break;
    }

    const compressedSlice = uint8.subarray(dataOffset, dataOffset + compressedSize);

    // Skip directories
    if (!fileName.endsWith('/') && fileNameLen > 0) {
      try {
        if (compressionMethod === 0) {
          // Stored (no compression)
          const text = new TextDecoder('utf-8').decode(compressedSlice);
          files[fileName] = text;
        } else if (compressionMethod === 8) {
          // Deflate
          let decompressedText = '';
          if (typeof DecompressionStream !== 'undefined') {
            try {
              const ds = new DecompressionStream('deflate-raw');
              const writer = ds.writable.getWriter();
              writer.write(compressedSlice as any);
              writer.close();
              const response = new Response(ds.readable);
              decompressedText = await response.text();
            } catch {
              try {
                const ds = new DecompressionStream('deflate');
                const writer = ds.writable.getWriter();
                writer.write(compressedSlice as any);
                writer.close();
                const response = new Response(ds.readable);
                decompressedText = await response.text();
              } catch {}
            }
          }
          
          // Node.js fallback if DecompressionStream was not present or threw
          if (!decompressedText && typeof process !== 'undefined') {
            try {
              const zlib = await import('zlib');
              const uncompressedBuf = zlib.inflateRawSync(Buffer.from(compressedSlice));
              decompressedText = uncompressedBuf.toString('utf-8');
            } catch {}
          }

          if (decompressedText) {
            files[fileName] = decompressedText;
          }
        }
      } catch (err) {
        console.warn(`[Kotatsu Importer] Failed decompressing ${fileName}:`, err);
      }
    }

    offset = dataOffset + compressedSize;
    // Check if followed by data descriptor (0x08074b50)
    if (offset + 4 <= len && view.getUint32(offset, true) === 0x08074b50) {
      offset += 16;
    }
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
      
      // Parse categories if available
      for (const [name, content] of Object.entries(files)) {
        const lower = name.toLowerCase();
        if (lower.includes('categor') && lower.endsWith('.json')) {
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
        const lower = name.toLowerCase();
        if (lower.includes('history') && lower.endsWith('.json')) {
          try {
            const parsedHistory = JSON.parse(content);
            historyList = Array.isArray(parsedHistory) ? parsedHistory : parsedHistory.history || [];
          } catch {}
        }
      }

      // Parse favourites / manga
      for (const [name, content] of Object.entries(files)) {
        const lower = name.toLowerCase();
        if ((lower.includes('favourit') || lower.includes('favorit') || lower.includes('manga')) && lower.endsWith('.json')) {
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
    }
  }

  // 2. If no files were extracted, parse as raw JSON
  if (favouritesList.length === 0 && typeof input === 'string') {
    let parsed: any;
    try {
      parsed = JSON.parse(input);
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
    }
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

    // Favorites & Pinning
    const catId = entry.categoryId !== undefined ? entry.categoryId : entry.category_id;
    const catName = catId !== undefined ? categoriesMap.get(catId) : '';
    const isFavorite = Boolean(
      entry.pinned || 
      (catName && catName.toLowerCase().includes('favorit')) ||
      (Array.isArray(entry.categories) && entry.categories.some((c: any) => String(c.name || c).toLowerCase().includes('favorit')))
    );

    // Timestamps
    const createdAtMs = entry.createdAt || entry.created_at || (m as any).createdAt;
    const addedAt = createdAtMs ? new Date(Number(createdAtMs)).toISOString() : new Date().toISOString();
    const updatedAtMs = hist?.updatedAt || hist?.updated_at || hist?.last_read_at;
    const lastReadAt = updatedAtMs ? new Date(Number(updatedAtMs)).toISOString() : addedAt;

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
      notes: 'Imported from Kotatsu backup',
      addedAt,
      lastReadAt,
      userId,
      isFavorite,
      isFlagged: false,
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
