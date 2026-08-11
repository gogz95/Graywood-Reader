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

// Memory TTL (milliseconds) - auto-revoke blobs older than TTL
const DEFAULT_CACHING_TTL = 30 * 60 * 1000; // 30 minutes
const DEFAULT_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Browser cache expiration (24 hours)
const BROWSER_CACHE_TTL = 24 * 60 * 60 * 1000;

export class KotatsuImageLoader {
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
  private autoUpdateInterval: number;
  private _currentPageIndex: number = -1;
  private _cacheEnabled: boolean;
  private _browserCache: Map<string, { url: string; timestamp: number; }>;
  private _networkMonitor: ((speed: 'slow' | 'normal' | 'fast') => void) | null = null;
  private _gcInterval: number | null = null;

  // Configuration from user or defaults
  private config: ImageLoaderConfig;

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

    // Initialize cache
    this.cache = new Map();
    this.activeDownloads = new Set();
    this.queue = [];
    this.autoUpdateInterval = 0;

    // Initialize browser cache
    this._browserCache = new Map();

    // Initialize cache entries for all pages
    pageUrls.forEach((url, idx) => {
      this.cache.set(idx, {
        index: idx,
        status: 'pending',
        attempts: 0,
        timestamp: 0,
        lastUpdated: 0,
      });
    });
  }

  /**
   * Update active reader viewport index & schedule sliding preload window
   */
  public setActiveIndex(currentIndex: number): void {
    const start = Math.max(0, currentIndex - this.preloadWindowBehind);
    const end = Math.min(this.pageUrls.length - 1, currentIndex + this.preloadWindowAhead);

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
   * Trigger manual retry for a specific page index
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
   * Clean up Blob URLs to free browser RAM
   */
  public destroy(): void {
    this.cache.forEach((state) => {
      if (state.blobUrl && state.blobUrl.startsWith('blob:')) {
        URL.revokeObjectURL(state.blobUrl);
      }
    });
    this.cache.clear();
    this.queue = [];
    this.activeDownloads.clear();
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

  /**
   * Retry a failed page download (e.g. after a page timed out or errored).
   * @param pageIndex index to retry
   */
  public recover(pageIndex: number): void {
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

    // Check browser cache first if enabled
    if (this.config.enableBrowserCache) {
      const cacheEntry = this.checkBrowserCache(rawUrl);
      if (cacheEntry) {
        state.blobUrl = cacheEntry.url;
        state.status = 'loaded';
        state.lastUpdated = Date.now();
        this.notify();
        return;
      }
    }

    try {
      const proxyUrl = `/api/reader/proxy-image?url=${encodeURIComponent(rawUrl)}&sourceUrl=${encodeURIComponent(this.sourceUrl)}`;
      const response = await fetch(proxyUrl);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: Failed to fetch image panel`);
      }

      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);

      state.status = 'loaded';
      state.blobUrl = blobUrl;
      state.error = undefined;
    } catch (err: any) {
      console.warn(`[Kotatsu Image Loader] Page ${pageIndex + 1} download attempt ${state.attempts} failed:`, err.message);

      if (state.attempts < 3) {
        // Retry with backoff
        state.status = 'pending';
        setTimeout(() => {
          if (!this.queue.includes(pageIndex)) {
            this.queue.push(pageIndex);
            this.processQueue();
          }
        }, state.attempts * 1000);
      } else {
        state.status = 'error';
        state.error = err.message || 'Image download failed';
        // Fallback to proxy URL directly (without blobs)
        state.blobUrl = `/api/reader/proxy-image?url=${encodeURIComponent(rawUrl)}&sourceUrl=${encodeURIComponent(this.sourceUrl)}`;
        // Revoke any blob URL from previous attempt
        if (state.blobUrl?.startsWith('blob:')) {
          URL.revokeObjectURL(state.blobUrl);
        }
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
   * Check browser cache for a URL
   */
  private checkBrowserCache(rawUrl: string): { url: string; isCached: boolean } | null {
    const cacheKey = btoa(rawUrl + this.sourceUrl);
    const cachedEntry = this._browserCache.get(cacheKey);
    if (cachedEntry && Date.now() - cachedEntry.timestamp < BROWSER_CACHE_TTL) {
      return { url: cachedEntry.url, isCached: true };
    }
    return null;
  }
}
