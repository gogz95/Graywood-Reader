/**
 * Kotatsu Parallel Image Loader & Preloader Queue
 * Features:
 * - Concurrency-limited worker queue (4 parallel page downloads)
 * - Blob Memory Caching (ArrayBuffer -> URL.createObjectURL(blob)) to bypass CORS and anti-hotlinking
 * - Exponential backoff retry logic (3 attempts)
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
}

export class KotatsuImageLoader {
  private concurrency: number = 4;
  private preloadWindowAhead: number = 4;
  private preloadWindowBehind: number = 2;
  private cache: Map<number, PageLoadState> = new Map();
  private activeDownloads: Set<number> = new Set();
  private queue: number[] = [];
  private pageUrls: string[] = [];
  private sourceUrl: string = '';
  private onStateChange?: (states: Map<number, PageLoadState>) => void;

  constructor(
    pageUrls: string[],
    sourceUrl: string = '',
    onStateChange?: (states: Map<number, PageLoadState>) => void
  ) {
    this.pageUrls = pageUrls;
    this.sourceUrl = sourceUrl;
    this.onStateChange = onStateChange;

    // Initialize pending state for all pages
    pageUrls.forEach((url, idx) => {
      this.cache.set(idx, {
        index: idx,
        status: 'pending',
        attempts: 0,
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

  private async downloadPage(pageIndex: number): Promise<void> {
    const state = this.cache.get(pageIndex);
    if (!state) return;

    this.activeDownloads.add(pageIndex);
    state.status = 'loading';
    state.attempts += 1;
    this.notify();

    const rawUrl = this.pageUrls[pageIndex];

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
        // Fallback to rawUrl or proxy URL directly
        state.blobUrl = `/api/reader/proxy-image?url=${encodeURIComponent(rawUrl)}`;
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
}
