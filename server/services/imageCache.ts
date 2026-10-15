import crypto from 'crypto';
import sharp from 'sharp';
import { getCoverCache, setCoverCache } from '../../db/cache';

export interface CachedImage {
  buffer: Buffer;
  contentType: string;
  etag: string;
  isCover?: boolean;
}

interface MemEntry {
  image: CachedImage;
  lastAccessed: number;
  createdAt: number;
}

const MAX_MEM_ITEMS = 250; // Max in-memory chapter page panels
const MEM_MAX_TOTAL_BYTES = 150 * 1024 * 1024; // 150 MB hard cap in RAM
const CHAPTER_PAGE_TTL_MS = 30 * 60 * 1000; // 30-minute TTL

export function isCoverUrl(url: string, isCoverHint?: boolean): boolean {
  if (isCoverHint !== undefined) return isCoverHint;
  return /(\/covers\/|covers\.openlibrary\.org|\/cover[._-]|cover\.jpg|cover\.webp|cover\.png|\.512\.jpg|\.256\.jpg)/i.test(url);
}

class ImageCacheService {
  // Strictly bounded in-memory LRU for transient chapter pages (zero permanent disk hosting)
  private memCache = new Map<string, MemEntry>();
  // In-flight request coalescing to eliminate duplicate upstream fetches across concurrent users
  private inFlight = new Map<string, Promise<CachedImage | null>>();
  private totalMemBytes = 0;

  private hashUrl(url: string): string {
    return crypto.createHash('sha256').update(url).digest('hex');
  }

  public getEtag(url: string): string {
    return `"${crypto.createHash('md5').update(url).digest('hex')}"`;
  }

  public matchesEtag(url: string, ifNoneMatch?: string): boolean {
    if (!ifNoneMatch) return false;
    const etag = this.getEtag(url);
    return ifNoneMatch === etag || ifNoneMatch === `W/${etag}`;
  }

  /**
   * Retrieves an image from permanent SQLite cover_cache (if cover)
   * or warm in-memory LRU (if chapter page panel).
   */
  public async get(url: string, isCoverHint?: boolean): Promise<CachedImage | null> {
    const key = this.hashUrl(url);
    const isCover = isCoverUrl(url, isCoverHint);

    // 1. Permanent SQLite cover thumbnail cache
    if (isCover) {
      const dbCover = getCoverCache(key);
      if (dbCover) {
        return {
          buffer: dbCover.data,
          contentType: dbCover.contentType || 'image/webp',
          etag: this.getEtag(url),
          isCover: true,
        };
      }
    }

    // 2. Bounded in-memory LRU cache for transient chapter pages
    const memEntry = this.memCache.get(key);
    if (memEntry) {
      const now = Date.now();
      if (now - memEntry.createdAt > CHAPTER_PAGE_TTL_MS) {
        // Expired transient chapter page panel
        this.totalMemBytes -= memEntry.image.buffer.length;
        this.memCache.delete(key);
        return null;
      }
      memEntry.lastAccessed = now;
      return memEntry.image;
    }

    // Fallback: check SQLite cover_cache even if not hinted as cover
    const dbCoverFallback = getCoverCache(key);
    if (dbCoverFallback) {
      return {
        buffer: dbCoverFallback.data,
        contentType: dbCoverFallback.contentType || 'image/webp',
        etag: this.getEtag(url),
        isCover: true,
      };
    }

    return null;
  }

  /**
   * Caches an image. Catalog covers are transcoded via sharp into compact WebP thumbnails
   * (~20 KB) and permanently persisted into SQLite. Chapter panels are stored ONLY in
   * bounded RAM (never written to server disk).
   */
  public async put(
    url: string,
    buffer: Buffer,
    contentType: string,
    isCoverHint?: boolean
  ): Promise<CachedImage> {
    const key = this.hashUrl(url);
    const etag = this.getEtag(url);
    const isCover = isCoverUrl(url, isCoverHint);

    if (isCover) {
      let finalBuffer = buffer;
      let finalContentType = contentType;

      // Transcode covers via sharp into compact WebP thumbnails (width: 360, quality: 80)
      try {
        finalBuffer = await sharp(buffer, { failOnError: false })
          .resize({ width: 360, withoutEnlargement: true })
          .webp({ quality: 80 })
          .toBuffer();
        finalContentType = 'image/webp';
      } catch (err) {
        // Fallback to original buffer if sharp encountered an unsupported image format (e.g. svg)
        console.warn('[ImageCache] Sharp cover transcoding fallback to original buffer:', err);
      }

      // Persist permanently in SQLite cover_cache
      setCoverCache(key, finalBuffer, finalContentType);

      const cached: CachedImage = {
        buffer: finalBuffer,
        contentType: finalContentType,
        etag,
        isCover: true,
      };

      this.putMemory(key, cached);
      return cached;
    }

    // Chapter page panels: transient in-memory LRU only (zero disk writes)
    const cached: CachedImage = {
      buffer,
      contentType,
      etag,
      isCover: false,
    };

    this.putMemory(key, cached);
    return cached;
  }

  private putMemory(key: string, image: CachedImage) {
    if (image.buffer.length > 10 * 1024 * 1024) return; // Cap single in-memory item at 10 MB

    const now = Date.now();

    // Evict expired items first
    for (const [k, entry] of this.memCache.entries()) {
      if (now - entry.createdAt > CHAPTER_PAGE_TTL_MS) {
        this.totalMemBytes -= entry.image.buffer.length;
        this.memCache.delete(k);
      }
    }

    // Evict oldest if exceeding count or memory byte cap
    while (
      (this.memCache.size >= MAX_MEM_ITEMS || this.totalMemBytes + image.buffer.length > MEM_MAX_TOTAL_BYTES) &&
      this.memCache.size > 0
    ) {
      const oldestKey = this.findOldestMemKey();
      if (!oldestKey) break;
      const old = this.memCache.get(oldestKey);
      if (old) {
        this.totalMemBytes -= old.image.buffer.length;
        this.memCache.delete(oldestKey);
      }
    }

    this.memCache.set(key, { image, lastAccessed: now, createdAt: now });
    this.totalMemBytes += image.buffer.length;
  }

  private findOldestMemKey(): string | null {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, entry] of this.memCache.entries()) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }
    return oldestKey;
  }

  /**
   * In-Flight Request Coalescing (Single-Flight Stampede Protection):
   * Multiple concurrent readers requesting the same image await a single upstream Promise.
   */
  public async fetchCoalesced(
    url: string,
    fetcher: () => Promise<{ buffer: Buffer; contentType: string } | null>,
    isCoverHint?: boolean
  ): Promise<CachedImage | null> {
    // 1. Check cache first
    const existing = await this.get(url, isCoverHint);
    if (existing) return existing;

    const key = this.hashUrl(url);
    if (this.inFlight.has(key)) {
      return this.inFlight.get(key)!;
    }

    const promise = (async () => {
      try {
        const fetched = await fetcher();
        if (!fetched) return null;
        return await this.put(url, fetched.buffer, fetched.contentType, isCoverHint);
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    return promise;
  }
}

export const imageCacheService = new ImageCacheService();
