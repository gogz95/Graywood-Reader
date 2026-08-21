import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface CachedImage {
  buffer: Buffer;
  contentType: string;
  etag: string;
}

interface MetaInfo {
  contentType: string;
  etag: string;
  size: number;
  lastAccessed: number;
}

const CACHE_DIR = path.join(process.cwd(), 'data', 'image_cache');
const MAX_DISK_BYTES = 500 * 1024 * 1024; // 500 MB max disk usage
const MAX_MEM_ITEMS = 80; // Up to 80 hot items in RAM
const MEM_MAX_TOTAL_BYTES = 40 * 1024 * 1024; // 40 MB max in RAM

class ImageCacheService {
  private memCache = new Map<string, { image: CachedImage; lastAccessed: number }>();
  private inFlight = new Map<string, Promise<CachedImage | null>>();
  private totalMemBytes = 0;
  private isInitialized = false;

  constructor() {
    this.ensureDirectory();
  }

  private ensureDirectory() {
    try {
      if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
      }
      this.isInitialized = true;
    } catch (err) {
      console.warn('[ImageCache] Failed to initialize disk cache dir:', err);
    }
  }

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

  public async get(url: string): Promise<CachedImage | null> {
    const key = this.hashUrl(url);

    // 1. Tier 1: In-memory cache
    const memEntry = this.memCache.get(key);
    if (memEntry) {
      memEntry.lastAccessed = Date.now();
      return memEntry.image;
    }

    // 2. Tier 2: Disk cache
    if (!this.isInitialized) return null;
    const binPath = path.join(CACHE_DIR, `${key}.bin`);
    const metaPath = path.join(CACHE_DIR, `${key}.json`);

    try {
      if (fs.existsSync(binPath) && fs.existsSync(metaPath)) {
        const metaRaw = await fs.promises.readFile(metaPath, 'utf8');
        const meta: MetaInfo = JSON.parse(metaRaw);
        const buffer = await fs.promises.readFile(binPath);

        const cached: CachedImage = {
          buffer,
          contentType: meta.contentType || 'image/jpeg',
          etag: meta.etag || this.getEtag(url),
        };

        // Promote to RAM cache if small
        this.putMemory(key, cached);

        // Update access time asynchronously
        meta.lastAccessed = Date.now();
        fs.promises.writeFile(metaPath, JSON.stringify(meta)).catch(() => {});

        return cached;
      }
    } catch (err) {
      // Ignore read error, fallback to network
    }

    return null;
  }

  public async put(url: string, buffer: Buffer, contentType: string): Promise<CachedImage> {
    const key = this.hashUrl(url);
    const etag = this.getEtag(url);
    const cached: CachedImage = { buffer, contentType, etag };

    // Save to memory
    this.putMemory(key, cached);

    // Save to disk
    if (this.isInitialized) {
      try {
        const binPath = path.join(CACHE_DIR, `${key}.bin`);
        const metaPath = path.join(CACHE_DIR, `${key}.json`);
        const meta: MetaInfo = {
          contentType,
          etag,
          size: buffer.length,
          lastAccessed: Date.now(),
        };

        await fs.promises.writeFile(binPath, buffer);
        await fs.promises.writeFile(metaPath, JSON.stringify(meta));

        // Periodically prune disk cache in background
        if (Math.random() < 0.05) {
          this.pruneDiskCache().catch(() => {});
        }
      } catch (err) {
        console.warn('[ImageCache] Error persisting to disk:', err);
      }
    }

    return cached;
  }

  private putMemory(key: string, image: CachedImage) {
    if (image.buffer.length > 5 * 1024 * 1024) return; // Don't hold single >5MB images in memory

    // Evict oldest if exceeding count or bytes limit
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

    this.memCache.set(key, { image, lastAccessed: Date.now() });
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
   * Request Coalescing (Single-Flight Pattern):
   * If concurrent requests arrive for the same URL, collapse them onto one in-flight fetch.
   */
  public async fetchCoalesced(
    url: string,
    fetcher: () => Promise<{ buffer: Buffer; contentType: string } | null>
  ): Promise<CachedImage | null> {
    // Check cache first
    const existing = await this.get(url);
    if (existing) return existing;

    const key = this.hashUrl(url);
    if (this.inFlight.has(key)) {
      return this.inFlight.get(key)!;
    }

    const promise = (async () => {
      try {
        const fetched = await fetcher();
        if (!fetched) return null;
        return await this.put(url, fetched.buffer, fetched.contentType);
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    return promise;
  }

  private async pruneDiskCache() {
    if (!this.isInitialized) return;
    try {
      const files = await fs.promises.readdir(CACHE_DIR);
      const metaFiles = files.filter((f) => f.endsWith('.json'));

      let totalBytes = 0;
      const entries: { key: string; size: number; lastAccessed: number }[] = [];

      for (const mf of metaFiles) {
        try {
          const raw = await fs.promises.readFile(path.join(CACHE_DIR, mf), 'utf8');
          const meta: MetaInfo = JSON.parse(raw);
          const key = mf.replace('.json', '');
          totalBytes += meta.size || 0;
          entries.push({ key, size: meta.size || 0, lastAccessed: meta.lastAccessed || 0 });
        } catch {
          // ignore corrupted meta
        }
      }

      if (totalBytes > MAX_DISK_BYTES) {
        // Sort oldest first
        entries.sort((a, b) => a.lastAccessed - b.lastAccessed);

        for (const entry of entries) {
          if (totalBytes <= MAX_DISK_BYTES * 0.8) break;
          try {
            await fs.promises.unlink(path.join(CACHE_DIR, `${entry.key}.bin`)).catch(() => {});
            await fs.promises.unlink(path.join(CACHE_DIR, `${entry.key}.json`)).catch(() => {});
            totalBytes -= entry.size;
          } catch {
            // ignore unlink errors
          }
        }
      }
    } catch {
      // ignore
    }
  }
}

export const imageCacheService = new ImageCacheService();
