/**
 * Kotatsu Parallel Image Loader & Preloader Queue
 * Features:
 * - Adaptive concurrency control based on hardware/network
 * - Network-aware preloading
 * - Memory management with TTL cache expiration
 * - Browser cache integration
 * - Retry with exponential backoff
 * - Preloads N pages ahead and M pages behind active page
 */

export interface PageLoadTask {
  pageIndex: number;
  rawUrl: string;
  sourceUrl?: string;
}

export type PageStatus = 'pending' | 'loading' | 'loaded' | 'error';

export interface PageLoadState {
  index: number;
  status: PageStatus;
  blobUrl?: string;
  error?: string;
  attempts: number;
  timestamp: number;
  lastUpdated: number;
}

export interface ImageLoaderConfig {
  maxConcurrency?: number;
  preloadAhead?: number;
  preloadBehind?: number;
  cacheTTL?: number;
  enableNetworkAware?: boolean;
  enableBrowserCache?: boolean;
  imageQuality?: 'auto' | 'high' | 'medium' | 'low';
  enableAdaptivePreload?: boolean;
  maxRetryAttempts?: number;
  retryDelayMs?: number;
  enableMemoryGC?: boolean;
  gcIntervalMs?: number;
  priorityMode?: 'default' | 'manual' | 'auto';
}

// Dynamic concurrency: based on device capabilities
const getAdaptiveConcurrency = (): number => {
  const cores = navigator.hardwareConcurrency || 4;
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  if (isMobile) return Math.max(1, Math.min(cores, 3));
  return Math.min(cores, 8);
};

// Fix #6: Removed unused DEFAULT_CACHING_TTL (was 30 min, never referenced).
const DEFAULT_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Browser cache expiration (24 hours)
const BROWSER_CACHE_TTL = 24 * 60 * 60 * 1000;

export class KotatsuImageLoader {
  // Fix #18: IndexedDB-backed persistent image cache (survives page reloads)
  private static dbPromise: Promise<IDBDatabase> | null = null;

  private static getImageCacheDB(): Promise<IDBDatabase> {
    if (KotatsuImageLoader.dbPromise) return KotatsuImageLoader.dbPromise;
    KotatsuImageLoader.dbPromise = new Promise((resolve, reject) => {
      // v2 stores Blob data (blob: URLs die on reload and must not be persisted)
      const req = indexedDB.open('kotatsu-image-cache', 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (db.objectStoreNames.contains('images')) db.deleteObjectStore('images');
        db.createObjectStore('images', { keyPath: 'url' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { console.warn('[Image Cache] IndexedDB unavailable, using in-memory only'); reject(req.error); };
    });
    return KotatsuImageLoader.dbPromise.catch(() => { KotatsuImageLoader.dbPromise = null; return Promise.reject(new Error('IDB unavailable')); });
  }

  private async getCachedBlobUrl(rawUrl: string): Promise<string | null> {
    try {
      const db = await KotatsuImageLoader.getImageCacheDB();
      return new Promise((resolve) => {
        const tx = db.transaction('images', 'readonly');
        const store = tx.objectStore('images');
        const req = store.get(rawUrl);
        req.onsuccess = () => {
          const row = req.result as { blob?: Blob; blobUrl?: string } | undefined;
          if (!row) return resolve(null);
          if (row.blob instanceof Blob) {
            resolve(URL.createObjectURL(row.blob));
            return;
          }
          // Ignore legacy dead blob: URLs
          if (typeof row.blobUrl === 'string' && !row.blobUrl.startsWith('blob:')) {
            resolve(row.blobUrl);
            return;
          }
          resolve(null);
        };
        req.onerror = () => resolve(null);
      });
    } catch { return null; }
  }

  private async setCachedBlob(rawUrl: string, blob: Blob): Promise<void> {
    try {
      const db = await KotatsuImageLoader.getImageCacheDB();
      const tx = db.transaction('images', 'readwrite');
      tx.objectStore('images').put({ url: rawUrl, blob, timestamp: Date.now() });
    } catch { /* silent fail */ }
  }

  private concurrency: number;
  private preloadAhead: number;
  private preloadBehind: number;
  private maxCacheTTL: number;
  private cache: Map<number, PageLoadState>;
  private activeDownloads: Set<number>;
  private queue: number[];
  private pageUrls: string[];
  private sourceUrl: string;
  private onStateChange?: (states: Map<number, PageLoadState>) => void;
  // Fix #5: Removed dead fields (_currentPageIndex, autoUpdateInterval, _networkMonitor).
  private _browserCache: Map<string, { url: string; timestamp: number; }>;
  private _gcInterval: ReturnType<typeof setInterval> | null = null;

  // Configuration from user or defaults
  private config: Required<ImageLoaderConfig>;

  constructor(
    pageUrls: string[],
    sourceUrl: string = '',
    onStateChange?: (states: Map<number, PageLoadState>) => void,
    config: ImageLoaderConfig = {}
  ) {
    this.pageUrls = pageUrls;
    this.sourceUrl = sourceUrl;
    this.onStateChange = onStateChange;

    // Use user config or defaults
    this.config = {
      maxConcurrency: config.maxConcurrency ?? getAdaptiveConcurrency(),
      preloadAhead: config.preloadAhead ?? 4,
      preloadBehind: config.preloadBehind ?? 2,
      cacheTTL: config.cacheTTL ?? DEFAULT_CACHE_TTL,
      enableNetworkAware: config.enableNetworkAware ?? true,
      enableBrowserCache: config.enableBrowserCache ?? true,
      imageQuality: config.imageQuality ?? 'auto',
      enableAdaptivePreload: config.enableAdaptivePreload ?? true,
      maxRetryAttempts: config.maxRetryAttempts ?? 3,
      retryDelayMs: config.retryDelayMs ?? 1000,
      enableMemoryGC: config.enableMemoryGC ?? true,
      gcIntervalMs: config.gcIntervalMs ?? 60000,
      priorityMode: config.priorityMode ?? 'default',
    };

    this.concurrency = this.config.maxConcurrency;
    this.preloadAhead = this.config.preloadAhead;
    this.preloadBehind = this.config.preloadBehind;
    this.maxCacheTTL = this.config.cacheTTL;

    // Initialize cache
    this.cache = new Map();
    this.activeDownloads = new Set();
    this.queue = [];

    // Initialize browser cache
    this._browserCache = new Map();

    // Initialize cache entries for all pages
    pageUrls.forEach((_url, idx) => {
      this.cache.set(idx, {
        index: idx,
        status: 'pending',
        attempts: 0,
        timestamp: 0,
        lastUpdated: 0,
      });
    });

    // Fix #9: Start blob GC interval to revoke stale blob URLs and prevent memory growth.
    if (this.config.enableMemoryGC && this.config.gcIntervalMs > 0) {
      this._gcInterval = setInterval(() => this.runGarbageCollection(), this.config.gcIntervalMs);
    }
  }

  /**
   * Update active reader viewport index & schedule sliding preload window
   */
  public setActiveIndex(currentIndex: number): void {
    const start = Math.max(0, currentIndex - this.preloadBehind);
    const end = Math.min(this.pageUrls.length - 1, currentIndex + this.preloadAhead);

    // Build priority list: active page first, then forward window, then backward window
    const priorityList: number[] = [currentIndex];
    for (let i = currentIndex + 1; i <= end; i++) {
      priorityList.push(i);
    }
    for (let i = currentIndex - 1; i >= start; i--) {
      priorityList.push(i);
    }

    // Add un-loaded indices to queue
    priorityList.forEach((idx) => {
      const state = this.cache.get(idx);
      if (state && (state.status === 'pending' || state.status === 'error') && !this.queue.includes(idx)) {
        this.queue.push(idx);
      }
    });

    this.processQueue();
  }

  /**
   * Trigger manual retry for a specific page index.
   * Fix #8: `recover()` now delegates here — both methods were identical.
   */
  public retryPage(pageIndex: number): void {
    const state = this.cache.get(pageIndex);
    if (state) {
      state.status = 'pending';
      state.attempts = 0;
      state.error = undefined;
      this.notify();
      if (!this.queue.includes(pageIndex)) {
        this.queue.unshift(pageIndex); // High priority
        this.processQueue();
      }
    }
  }

  /**
   * Retry a failed page download (alias for retryPage for backward compat).
   * Fix #8: Deduplicated — was a copy-paste of retryPage.
   */
  public recover(pageIndex: number): void {
    this.retryPage(pageIndex);
  }

  /**
   * Get load state for a single page
   */
  public getPageState(pageIndex: number): PageLoadState | undefined {
    return this.cache.get(pageIndex);
  }

  /**
   * Get all page load states
   */
  public getAllStates(): Map<number, PageLoadState> {
    return this.cache;
  }

  /**
   * Clean up all blob URLs and internal resources to prevent memory leaks.
   * Call this when the reader is closed or the loader is no longer needed.
   */
  public destroy(): void {
    // Revoke all active blob URLs
    this.cache.forEach((state) => {
      if (state.blobUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(state.blobUrl);
      }
    });
    this.cache.clear();
    this.queue.length = 0;
    this.activeDownloads.clear();
    this._browserCache.clear();
    if (this._gcInterval) {
      clearInterval(this._gcInterval);
      this._gcInterval = null;
    }
  }

  /**
   * Fix #9: Garbage-collect blob URLs older than maxCacheTTL to prevent
   * unbounded memory growth during long reading sessions.
   */
  private runGarbageCollection(): void {
    const now = Date.now();
    this.cache.forEach((state) => {
      if (
        state.status === 'loaded' &&
        state.blobUrl?.startsWith('blob:') &&
        state.timestamp > 0 &&
        now - state.timestamp > this.maxCacheTTL
      ) {
        URL.revokeObjectURL(state.blobUrl);
        state.blobUrl = undefined;
        state.status = 'pending';
        state.attempts = 0;
      }
    });

    // Also expire stale browser-cache entries
    for (const [key, entry] of this._browserCache) {
      if (now - entry.timestamp > BROWSER_CACHE_TTL) {
        this._browserCache.delete(key);
      }
    }
  }

  private processQueue(): void {
    while (this.activeDownloads.size < this.concurrency && this.queue.length > 0) {
      const nextIndex = this.queue.shift()!;
      const state = this.cache.get(nextIndex);

      if (state && state.status === 'pending') {
        this.downloadPage(nextIndex);
      }
    }
  }

  private async downloadPage(pageIndex: number): Promise<void> {
    let state = this.cache.get(pageIndex);
    if (!state) {
      console.warn(`[Kotatsu Image Loader] Page ${pageIndex + 1} has no state — skipping download.`);
      return;
    }

    this.activeDownloads.add(pageIndex);
    state.status = 'loading';
    state.attempts += 1;
    state.timestamp = Date.now();
    state.lastUpdated = Date.now();
    this.notify();

    const rawUrl = this.pageUrls[pageIndex];

    try {
      // Check browser cache first if enabled
      if (this.config.enableBrowserCache) {
        const cacheEntry = this.checkBrowserCache(rawUrl);
        if (cacheEntry) {
          if (state.blobUrl?.startsWith('blob:')) { URL.revokeObjectURL(state.blobUrl); }
          state.blobUrl = cacheEntry.url;
          state.status = 'loaded';
          state.lastUpdated = Date.now();
          this.notify();
          return;
        }
      }

      // IndexedDB persistent cache (Blob storage; object URLs recreated on read)
      const cachedIdxDB = await this.getCachedBlobUrl(rawUrl);
      if (cachedIdxDB) {
        if (state.blobUrl?.startsWith('blob:')) { URL.revokeObjectURL(state.blobUrl); }
        state.blobUrl = cachedIdxDB;
        state.status = 'loaded';
        state.lastUpdated = Date.now();
        this.notify();
        return;
      }

      // Fix #4: Don't double-proxy URLs that are already proxied
      const isAlreadyProxied = rawUrl.startsWith('/api/') || rawUrl.startsWith('/api/reader/proxy-image');
      const fetchUrl = isAlreadyProxied
        ? rawUrl
        : `/api/reader/proxy-image?url=${encodeURIComponent(rawUrl)}&sourceUrl=${encodeURIComponent(this.sourceUrl)}`;
      
      const response = await fetch(fetchUrl);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: Failed to fetch image panel`);
      }

      const blob = await response.blob();
      
      // Fix #17: Revoke previous blob URL before creating a new one
      if (state.blobUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(state.blobUrl);
      }
      
      const blobUrl = URL.createObjectURL(blob);

      // Persist Blob (not blob: URL) for offline reuse across reloads
      this.setCachedBlob(rawUrl, blob).catch(() => {});

      state.status = 'loaded';
      state.blobUrl = blobUrl;
      state.error = undefined;

      // Fix #24: Populate browser cache after successful download
      if (this.config.enableBrowserCache) {
        const cacheKey = this.makeCacheKey(rawUrl);
        this._browserCache.set(cacheKey, { url: blobUrl, timestamp: Date.now() });
      }
    } catch (err: any) {
      console.warn(`[Kotatsu Image Loader] Page ${pageIndex + 1} download attempt ${state.attempts} failed:`, err.message);

      // Fix #20: Use config for retry count & delay instead of hardcoded values
      if (state.attempts < this.config.maxRetryAttempts) {
        // Retry with backoff
        state.status = 'pending';
        setTimeout(() => {
          if (!this.queue.includes(pageIndex)) {
            this.queue.push(pageIndex);
            this.processQueue();
          }
        }, state.attempts * this.config.retryDelayMs);
      } else {
        state.status = 'error';
        state.error = err.message || 'Image download failed';
        // Fallback to proxy URL directly (without blobs)
        // Fix #4: Don't double-wrap already-proxied fallback URLs
        const fallbackUrl = rawUrl.startsWith('/api/')
          ? rawUrl
          : `/api/reader/proxy-image?url=${encodeURIComponent(rawUrl)}&sourceUrl=${encodeURIComponent(this.sourceUrl)}`;
        // Fix #17: Revoke old blob before replacing with raw proxy URL
        if (state.blobUrl?.startsWith('blob:')) {
          URL.revokeObjectURL(state.blobUrl);
        }
        state.blobUrl = fallbackUrl;
      }
    } finally {
      this.activeDownloads.delete(pageIndex);
      this.notify();
      this.processQueue();
    }
  }

  private notify(): void {
    if (this.onStateChange) {
      this.onStateChange(new Map(this.cache));
    }
  }

  /**
   * Fix #11: Use encodeURIComponent instead of btoa() which throws on non-Latin1 chars.
   */
  private makeCacheKey(rawUrl: string): string {
    return encodeURIComponent(rawUrl + this.sourceUrl);
  }

  /**
   * Check browser cache for a URL
   */
  private checkBrowserCache(rawUrl: string): { url: string; isCached: boolean } | null {
    const cacheKey = this.makeCacheKey(rawUrl);
    const cachedEntry = this._browserCache.get(cacheKey);
    if (cachedEntry && Date.now() - cachedEntry.timestamp < BROWSER_CACHE_TTL) {
      return { url: cachedEntry.url, isCached: true };
    }
    return null;
  }
}
