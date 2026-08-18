/**
 * IndexedDB Offline Chapter Storage Engine for Graywood Reader.
 *
 * New downloads persist raw image Blobs (memory/quota-friendly). Legacy
 * downloads that stored base64 data-URL strings remain fully readable for
 * backward compatibility. `pages` is always resolved to an array of URL strings
 * so callers can hand it straight to <img src>, exactly as before.
 */

const DB_NAME = 'graywood_offline_db';
const DB_VERSION = 1;
const STORE_NAME = 'offline_chapters';

export interface OfflineChapterData {
  key: string; // `${mangaId}_ch_${chapterNumber}`
  mangaId: string;
  mangaTitle: string;
  chapterNumber: number;
  chapterId?: string;
  /** Resolved page sources: object URLs (blob chapters) or data URLs (legacy). */
  pages: string[];
  /** Raw image blobs (present for new downloads). */
  blobs?: Blob[];
  format?: 'blob' | 'dataurl';
  pageCount: number;
  savedAt: number;
  byteSize: number;
}

export interface OfflineStorageUsage {
  totalBytes: number;
  chapterCount: number;
  bySeries: Record<string, { bytes: number; chapters: number; title?: string }>;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return reject(new Error('IndexedDB is not supported in this environment.'));
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex('mangaId', 'mangaId', { unique: false });
        store.createIndex('savedAt', 'savedAt', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open IndexedDB'));
  });
}

function idbGet<T>(db: IDBDatabase, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error || new Error('IndexedDB get failed'));
  });
}

function idbGetAll<T>(db: IDBDatabase): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve((req.result as T[]) || []);
    req.onerror = () => reject(req.error || new Error('IndexedDB getAll failed'));
  });
}

function idbPut<T>(db: IDBDatabase, value: T): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).put(value);
    req.onsuccess = () => resolve(value);
    req.onerror = () => reject(req.error || new Error('IndexedDB put failed'));
  });
}

function idbDelete(db: IDBDatabase, key: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).delete(key);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error || new Error('IndexedDB delete failed'));
  });
}

function idbClear(db: IDBDatabase): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).clear();
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error || new Error('IndexedDB clear failed'));
  });
}

/** Resolve a stored record's `pages` to concrete URL strings (blobs -> object URLs). */
function resolveRecordPages(record: OfflineChapterData): OfflineChapterData {
  if (record.format === 'blob' && Array.isArray(record.blobs) && record.blobs.length > 0) {
    record.pages = record.blobs.map((b) => URL.createObjectURL(b));
  } else {
    record.pages = Array.isArray(record.pages) ? record.pages : [];
  }
  return record;
}

/**
 * Save a chapter with all its images into IndexedDB offline storage as raw
 * Blobs (memory-efficient). Downloads in parallel with a controlled worker pool
 * and retry logic for maximum speed and stability. Legacy data-URL records stay readable.
 */
export async function saveOfflineChapter(
  mangaId: string,
  mangaTitle: string,
  chapterNumber: number,
  pageUrls: string[],
  onProgress?: (loaded: number, total: number) => void,
  concurrency: number = 3
): Promise<OfflineChapterData> {
  const db = await openDatabase();
  const blobs: (Blob | null)[] = new Array(pageUrls.length).fill(null);
  let completed = 0;
  let totalBytes = 0;

  async function downloadPage(idx: number, attempt = 1): Promise<void> {
    const url = pageUrls[idx];
    try {
      const fetchUrl = url.startsWith('http') && !url.includes('/api/proxy/image')
        ? `/api/proxy/image?url=${encodeURIComponent(url)}`
        : url;
      const res = await fetch(fetchUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      if (blob.size > 0) {
        blobs[idx] = blob;
        totalBytes += blob.size;
      }
    } catch (err) {
      if (attempt <= 2) {
        await new Promise((r) => setTimeout(r, 400 * attempt));
        return downloadPage(idx, attempt + 1);
      }
      console.warn(`[OfflineStorage] Failed to cache page ${idx + 1}:`, err);
    } finally {
      completed++;
      if (onProgress) onProgress(completed, pageUrls.length);
    }
  }

  // Run in parallel with controlled concurrency
  let cursor = 0;
  const poolSize = Math.max(1, Math.min(concurrency, pageUrls.length));
  const workers = Array.from({ length: poolSize }, async () => {
    while (cursor < pageUrls.length) {
      const idx = cursor++;
      await downloadPage(idx);
    }
  });

  await Promise.all(workers);

  const validBlobs = blobs.filter((b): b is Blob => b !== null && b.size > 0);

  const record: OfflineChapterData = {
    key: `${mangaId}_ch_${chapterNumber}`,
    mangaId,
    mangaTitle,
    chapterNumber,
    pages: [],
    blobs: validBlobs,
    format: 'blob',
    pageCount: validBlobs.length,
    savedAt: Date.now(),
    byteSize: totalBytes,
  };

  await idbPut(db, record);
  return record;
}


/**
 * Retrieve an offline chapter from IndexedDB if present, resolving blobs to
 * usable object URLs so callers can render pages immediately.
 */
export async function getOfflineChapter(
  mangaId: string,
  chapterNumber: number
): Promise<OfflineChapterData | null> {
  try {
    const db = await openDatabase();
    const record = await idbGet<OfflineChapterData>(db, `${mangaId}_ch_${chapterNumber}`);
    return record ? resolveRecordPages(record) : null;
  } catch {
    return null;
  }
}

/** Check if a chapter is stored offline. */
export async function isChapterOffline(mangaId: string, chapterNumber: number): Promise<boolean> {
  const data = await getOfflineChapter(mangaId, chapterNumber);
  return data !== null && data.pages.length > 0;
}

/** Delete a specific offline chapter. */
export async function deleteOfflineChapter(mangaId: string, chapterNumber: number): Promise<boolean> {
  try {
    const db = await openDatabase();
    return await idbDelete(db, `${mangaId}_ch_${chapterNumber}`);
  } catch {
    return false;
  }
}

/** Get all stored offline chapters for a series (pages resolved). */
export async function getSeriesOfflineChapters(mangaId: string): Promise<OfflineChapterData[]> {
  try {
    const db = await openDatabase();
    const all = await idbGetAll<OfflineChapterData>(db);
    return all.filter((r) => r.mangaId === mangaId).map(resolveRecordPages);
  } catch {
    return [];
  }
}

/** Get all stored offline chapters across the whole app. */
export async function getAllOfflineChapters(): Promise<OfflineChapterData[]> {
  try {
    const db = await openDatabase();
    return await idbGetAll<OfflineChapterData>(db);
  } catch {
    return [];
  }
}

/** Clear all offline chapters across the entire app. */
export async function clearAllOfflineStorage(): Promise<boolean> {
  try {
    const db = await openDatabase();
    return await idbClear(db);
  } catch {
    return false;
  }
}

/** Compute total storage used by offline chapters, broken down per series. */
export async function getOfflineStorageUsage(): Promise<OfflineStorageUsage> {
  try {
    const all = await getAllOfflineChapters();
    const usage: OfflineStorageUsage = { totalBytes: 0, chapterCount: all.length, bySeries: {} };
    for (const r of all) {
      usage.totalBytes += r.byteSize || 0;
      const s = usage.bySeries[r.mangaId] || (usage.bySeries[r.mangaId] = { bytes: 0, chapters: 0, title: r.mangaTitle });
      s.bytes += r.byteSize || 0;
      s.chapters += 1;
      if (r.mangaTitle) s.title = r.mangaTitle;
    }
    return usage;
  } catch {
    return { totalBytes: 0, chapterCount: 0, bySeries: {} };
  }
}

/**
 * Free space by deleting the least-recently-saved offline chapters until at
 * least `bytesToFree` bytes have been released (LRU eviction).
 */
export async function evictOfflineChapters(bytesToFree: number): Promise<{ freedBytes: number; deleted: number }> {
  try {
    const all = await getAllOfflineChapters();
    const oldestFirst = [...all].sort((a, b) => a.savedAt - b.savedAt);
    let freed = 0;
    let deleted = 0;
    const db = await openDatabase();
    for (const r of oldestFirst) {
      if (freed >= bytesToFree) break;
      await idbDelete(db, r.key);
      freed += r.byteSize || 0;
      deleted += 1;
    }
    return { freedBytes: freed, deleted };
  } catch {
    return { freedBytes: 0, deleted: 0 };
  }
}

/**
 * Download an entire series into offline storage. `fetchChapterPages` supplies
 * each chapter's page URLs (e.g. via the chapter-pages API). Sequential to stay
 * within the domain rate-limit and avoid hammering the image proxy.
 */
export async function bulkDownloadSeries(opts: {
  mangaId: string;
  mangaTitle: string;
  chapterNumbers: number[];
  fetchChapterPages: (chapterNumber: number) => Promise<string[]>;
  onChapterComplete?: (done: number, total: number, chapterNumber: number) => void;
  onPageProgress?: (loaded: number, total: number) => void;
}): Promise<{ downloaded: number; failed: number }> {
  let downloaded = 0;
  let failed = 0;
  for (let i = 0; i < opts.chapterNumbers.length; i++) {
    const ch = opts.chapterNumbers[i];
    try {
      const pages = await opts.fetchChapterPages(ch);
      if (!pages || pages.length === 0) throw new Error(`Chapter ${ch} returned no pages`);
      await saveOfflineChapter(opts.mangaId, opts.mangaTitle, ch, pages, opts.onPageProgress);
      downloaded += 1;
    } catch (err) {
      console.warn(`[OfflineStorage] Bulk download failed for chapter ${ch}:`, err);
      failed += 1;
    }
    if (opts.onChapterComplete) opts.onChapterComplete(i + 1, opts.chapterNumbers.length, ch);
  }
  return { downloaded, failed };
}
