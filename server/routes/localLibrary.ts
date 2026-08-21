import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import AdmZip from 'adm-zip';
import { SqliteDb } from '../../sqlite-db';
import { MangaItem } from '../../src/types';

export const localLibraryRouter = Router();

// ============================================================================
// LOCAL CBZ / CBR / PDF LIBRARY
// Scans a folder (STORAGE_PATH env or ./data/storage) for comic archives and
// exposes them for browsing and (for ZIP-based archives) page streaming.
// ============================================================================

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif)$/i;
const ARCHIVE_EXT = /\.(cbz|zip|cbr|rar|pdf)$/i;

function resolveStorageRoot(): string {
  const raw = (process.env.STORAGE_PATH || '').trim() || path.join(process.cwd(), 'data', 'storage');
  return path.resolve(raw);
}

export interface LocalArchive {
  id: string;           // stable sha256 of absolute path
  title: string;
  fileName: string;
  filePath: string;
  type: 'cbz' | 'cbr' | 'pdf' | 'other';
  pageCount: number;    // 0 when not determinable (cbr/pdf)
  sizeBytes: number;
  coverDataUrl?: string;
}

export interface CachedArchiveEntry {
  archive: LocalArchive;
  imageEntries: string[];
  mtimeMs: number;
  sizeBytes: number;
}

// In-memory cache for scanned comic archives
const archiveCache = new Map<string, CachedArchiveEntry>(); // keyed by archive.id
let lastScanTimestamp = 0;
const CACHE_TTL_MS = 60 * 1000; // 60 seconds

function detectType(fileName: string): LocalArchive['type'] {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.cbz' || ext === '.zip') return 'cbz';
  if (ext === '.cbr' || ext === '.rar') return 'cbr';
  if (ext === '.pdf') return 'pdf';
  return 'other';
}

function deriveTitle(fileName: string): string {
  return (
    path.basename(fileName, path.extname(fileName))
      .replace(/[._-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'Untitled Local Archive'
  );
}

function listArchiveImages(zip: AdmZip): string[] {
  return zip
    .getEntries()
    .filter((e) => !e.isDirectory && IMAGE_EXT.test(e.entryName))
    .sort((a, b) => a.entryName.localeCompare(b.entryName, undefined, { numeric: true }))
    .map((e) => e.entryName);
}

function scanArchive(filePath: string): CachedArchiveEntry | null {
  try {
    const stat = fs.statSync(filePath);
    const fileName = path.basename(filePath);
    const type = detectType(fileName);
    const id = crypto.createHash('sha256').update(filePath).digest('hex').slice(0, 24);

    // Check if we can reuse previous cached image entries and cover
    const existing = archiveCache.get(id);
    if (existing && existing.mtimeMs === stat.mtimeMs && existing.sizeBytes === stat.size) {
      return existing;
    }

    let imageEntries: string[] = [];
    let coverDataUrl: string | undefined;

    if (type === 'cbz') {
      const zip = new AdmZip(filePath);
      imageEntries = listArchiveImages(zip);
      const first = zip.getEntry(imageEntries[0]);
      if (first) {
        const buf = first.getData();
        if (buf && buf.length > 0 && buf.length < 3 * 1024 * 1024) {
          coverDataUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;
        }
      }
    }

    const archive: LocalArchive = {
      id,
      title: deriveTitle(fileName),
      fileName,
      filePath,
      type,
      pageCount: imageEntries.length,
      sizeBytes: stat.size,
      coverDataUrl,
    };

    return {
      archive,
      imageEntries,
      mtimeMs: stat.mtimeMs,
      sizeBytes: stat.size,
    };
  } catch (err) {
    console.warn('[Local Library] Failed to scan', filePath, err);
    return null;
  }
}

export function scanStorage(forceRefresh = false): LocalArchive[] {
  const root = resolveStorageRoot();
  if (!fs.existsSync(root)) {
    archiveCache.clear();
    lastScanTimestamp = Date.now();
    return [];
  }

  // Return cached result if TTL is active and not forcing a refresh
  const now = Date.now();
  if (!forceRefresh && (now - lastScanTimestamp < CACHE_TTL_MS) && archiveCache.size > 0) {
    return Array.from(archiveCache.values()).map((e) => e.archive);
  }

  const seenIds = new Set<string>();
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
      } else if (ARCHIVE_EXT.test(ent.name)) {
        const cached = scanArchive(full);
        if (cached) {
          archiveCache.set(cached.archive.id, cached);
          seenIds.add(cached.archive.id);
        }
      }
    }
  };

  walk(root);

  // Evict removed files
  for (const [id] of archiveCache) {
    if (!seenIds.has(id)) {
      archiveCache.delete(id);
    }
  }

  lastScanTimestamp = now;
  return Array.from(archiveCache.values()).map((e) => e.archive);
}

export function findArchive(id: string): LocalArchive | null {
  // 1. Fast O(1) lookup in memory cache
  const cached = archiveCache.get(id);
  if (cached) return cached.archive;

  // 2. If not found, rescan and try once more
  scanStorage(true);
  return archiveCache.get(id)?.archive || null;
}

export function getArchiveEntry(id: string): CachedArchiveEntry | null {
  const cached = archiveCache.get(id);
  if (cached) return cached;
  scanStorage(true);
  return archiveCache.get(id) || null;
}

// Clear the cache (useful for testing)
export function clearArchiveCache(): void {
  archiveCache.clear();
  lastScanTimestamp = 0;
}

// GET /api/local/library - List all scanned local archives (cached with 60s TTL)
localLibraryRouter.get('/api/local/library', (_req: Request, res: Response) => {
  try {
    const root = resolveStorageRoot();
    const archives = scanStorage();
    res.json({ root, exists: fs.existsSync(root), count: archives.length, archives });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to scan local library', details: err.message });
  }
});

// POST /api/local/library/rescan - Force immediate rescan of local library
localLibraryRouter.post('/api/local/library/rescan', (_req: Request, res: Response) => {
  try {
    const root = resolveStorageRoot();
    const archives = scanStorage(true);
    res.json({ root, exists: fs.existsSync(root), count: archives.length, archives });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to rescan local library', details: err.message });
  }
});

// GET /api/local/library/:id/cover - Stream the cover image
localLibraryRouter.get('/api/local/library/:id/cover', (req: Request, res: Response) => {
  try {
    const entry = getArchiveEntry(String(req.params.id));
    if (!entry || entry.archive.type !== 'cbz') {
      return res.status(404).json({ error: 'Archive not found or unsupported type' });
    }
    const firstImageName = entry.imageEntries[0];
    if (!firstImageName) return res.status(404).json({ error: 'No images in archive' });

    const zip = new AdmZip(entry.archive.filePath);
    const first = zip.getEntry(firstImageName);
    if (!first) return res.status(404).json({ error: 'No images in archive' });
    const buf = first.getData();
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buf);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to read cover', details: err.message });
  }
});

// GET /api/local/library/:id/page/:n - Stream the n-th page image
localLibraryRouter.get('/api/local/library/:id/page/:n', (req: Request, res: Response) => {
  try {
    const entry = getArchiveEntry(String(req.params.id));
    if (!entry || entry.archive.type !== 'cbz') {
      return res.status(404).json({ error: 'Archive not found or unsupported type' });
    }
    const index = Number(req.params.n);
    if (!Number.isInteger(index) || index < 0) {
      return res.status(400).json({ error: 'Invalid page index' });
    }
    const entryName = entry.imageEntries[index];
    if (!entryName) return res.status(404).json({ error: 'Page index out of range' });

    const zip = new AdmZip(entry.archive.filePath);
    const zipEntry = zip.getEntry(entryName);
    const buf = zipEntry ? zipEntry.getData() : null;
    if (!buf) return res.status(500).json({ error: 'Failed to read page' });
    const ext = path.extname(entryName).toLowerCase().replace('.', '') || 'jpeg';
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.send(buf);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to read page', details: err.message });
  }
});

// GET /api/local/library/:id/pages - Return page URL list for the reader
localLibraryRouter.get('/api/local/library/:id/pages', (req: Request, res: Response) => {
  try {
    const entry = getArchiveEntry(String(req.params.id));
    if (!entry || entry.archive.type !== 'cbz') {
      return res.status(404).json({ error: 'Archive not found or unsupported type' });
    }
    const pages = Array.from({ length: entry.archive.pageCount }, (_, i) => `/api/local/library/${entry.archive.id}/page/${i}`);
    res.json({ pages, pageCount: entry.archive.pageCount, title: entry.archive.title, id: entry.archive.id });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to list pages', details: err.message });
  }
});

// POST /api/local/library/:id/add - Register a local archive in the tracked library
localLibraryRouter.post('/api/local/library/:id/add', (req: Request, res: Response) => {
  try {
    const archive = findArchive(String(req.params.id));
    if (!archive) return res.status(404).json({ error: 'Archive not found' });
    const now = new Date().toISOString();
    const item: MangaItem = {
      id: `local_${archive.id}`,
      title: archive.title,
      altTitles: [archive.fileName],
      type: 'manhwa',
      coverImage: archive.coverDataUrl || `/api/local/library/${archive.id}/cover`,
      description: `Local archive (${archive.type.toUpperCase()}) — ${archive.pageCount || '?'} pages. ${archive.fileName}`,
      genres: ['Local'],
      status: 'reading',
      currentChapter: 0,
      totalChapters: archive.pageCount > 0 ? 1 : null,
      latestChapter: archive.pageCount > 0 ? 1 : 1,
      lastUpdated: now,
      rating: 8.0,
      sourceUrl: `local://${archive.id}`,
      sourceName: 'Local Library',
      availableSources: [
        { sourceName: 'Local Library', sourceUrl: `/api/local/library/${archive.id}/pages` },
      ],
      autoUpdateEnabled: false,
      notes: '',
      addedAt: now,
      lastReadAt: now,
      syncedFromApi: 'Local Library',
      isFavorite: false,
      isFlagged: false,
      metadataOverrides: [],
      customTags: [],
    };
    SqliteDb.upsertManga(item);
    res.json({ success: true, manga: item });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to add local archive', details: err.message });
  }
});

