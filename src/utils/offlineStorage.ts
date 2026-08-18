/**
 * IndexedDB Offline Chapter Storage Engine for Graywood Reader.
 * Stores downloaded manga chapter image blobs locally for 100% offline reading.
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
  pages: string[]; // Base64 data URLs or Object URLs
  pageCount: number;
  savedAt: number;
  byteSize: number;
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

/**
 * Save a chapter with all its images into IndexedDB offline storage.
 */
export async function saveOfflineChapter(
  mangaId: string,
  mangaTitle: string,
  chapterNumber: number,
  pageUrls: string[],
  onProgress?: (loaded: number, total: number) => void
): Promise<OfflineChapterData> {
  const db = await openDatabase();
  const pagesData: string[] = [];
  let totalBytes = 0;

  for (let i = 0; i < pageUrls.length; i++) {
    const url = pageUrls[i];
    try {
      // Use image proxy if needed for cross-origin images
      const fetchUrl = url.startsWith('http') && !url.includes('/api/proxy/image')
        ? `/api/proxy/image?url=${encodeURIComponent(url)}`
        : url;

      const res = await fetch(fetchUrl);
      const blob = await res.blob();
      totalBytes += blob.size;

      // Convert blob to DataURL for reliable IndexedDB persistence
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      pagesData.push(dataUrl);
      if (onProgress) onProgress(i + 1, pageUrls.length);
    } catch (err) {
      console.warn(`[OfflineStorage] Failed to cache page ${i + 1}:`, err);
      pagesData.push(url); // Fallback to raw URL
    }
  }

  const record: OfflineChapterData = {
    key: `${mangaId}_ch_${chapterNumber}`,
    mangaId,
    mangaTitle,
    chapterNumber,
    pages: pagesData,
    pageCount: pagesData.length,
    savedAt: Date.now(),
    byteSize: totalBytes,
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(record);

    req.onsuccess = () => resolve(record);
    req.onerror = () => reject(req.error || new Error('Failed to store chapter offline'));
  });
}

/**
 * Retrieve an offline chapter from IndexedDB if present.
 */
export async function getOfflineChapter(
  mangaId: string,
  chapterNumber: number
): Promise<OfflineChapterData | null> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(`${mangaId}_ch_${chapterNumber}`);

      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || new Error('Failed to fetch offline chapter'));
    });
  } catch {
    return null;
  }
}

/**
 * Check if a chapter is stored offline.
 */
export async function isChapterOffline(mangaId: string, chapterNumber: number): Promise<boolean> {
  const data = await getOfflineChapter(mangaId, chapterNumber);
  return data !== null && data.pages.length > 0;
}

/**
 * Delete a specific offline chapter.
 */
export async function deleteOfflineChapter(mangaId: string, chapterNumber: number): Promise<boolean> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(`${mangaId}_ch_${chapterNumber}`);

      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error || new Error('Failed to delete offline chapter'));
    });
  } catch {
    return false;
  }
}

/**
 * Get all stored offline chapters for a series.
 */
export async function getSeriesOfflineChapters(mangaId: string): Promise<OfflineChapterData[]> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('mangaId');
      const req = index.getAll(mangaId);

      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error || new Error('Failed to list offline chapters'));
    });
  } catch {
    return [];
  }
}

/**
 * Clear all offline chapters across the entire app.
 */
export async function clearAllOfflineStorage(): Promise<boolean> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();

      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error || new Error('Failed to clear offline storage'));
    });
  } catch {
    return false;
  }
}
