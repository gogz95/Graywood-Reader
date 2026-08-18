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

function scanArchive(filePath: string): LocalArchive | null {
  try {
    const fileName = path.basename(filePath);
    const type = detectType(fileName);
    const base: LocalArchive = {
      id: crypto.createHash('sha256').update(filePath).digest('hex').slice(0, 24),
      title: deriveTitle(fileName),
      fileName,
      filePath,
      type,
      pageCount: 0,
      sizeBytes: fs.statSync(filePath).size,
    };
    if (type === 'cbz') {
      const zip = new AdmZip(filePath);
      const images = listArchiveImages(zip);
      base.pageCount = images.length;
      const first = zip.getEntry(images[0]);
      if (first) {
        const buf = first.getData();
        if (buf && buf.length > 0 && buf.length < 3 * 1024 * 1024) {
          base.coverDataUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;
        }
      }
    }
    return base;
  } catch (err) {
    console.warn('[Local Library] Failed to scan', filePath, err);
    return null;
  }
}

export function scanStorage(): LocalArchive[] {
  const root = resolveStorageRoot();
  if (!fs.existsSync(root)) return [];
  const results: LocalArchive[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ARCHIVE_EXT.test(ent.name)) {
        const archive = scanArchive(full);
        if (archive) results.push(archive);
      }
    }
  };
  walk(root);
  return results;
}

function findArchive(id: string): LocalArchive | null {
  return scanStorage().find((a) => a.id === id) || null;
}

// GET /api/local/library - List all scanned local archives (rescans each call)
localLibraryRouter.get('/api/local/library', (_req: Request, res: Response) => {
  try {
    const root = resolveStorageRoot();
    const archives = scanStorage();
    res.json({ root, exists: fs.existsSync(root), count: archives.length, archives });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to scan local library', details: err.message });
  }
});

// GET /api/local/library/:id/cover - Stream the cover image
localLibraryRouter.get('/api/local/library/:id/cover', (req: Request, res: Response) => {
  try {
    const archive = findArchive(String(req.params.id));
    if (!archive || archive.type !== 'cbz') {
      return res.status(404).json({ error: 'Archive not found or unsupported type' });
    }
    const zip = new AdmZip(archive.filePath);
    const first = zip.getEntry(listArchiveImages(zip)[0]);
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
    const archive = findArchive(String(req.params.id));
    if (!archive || archive.type !== 'cbz') {
      return res.status(404).json({ error: 'Archive not found or unsupported type' });
    }
    const index = Number(req.params.n);
    if (!Number.isInteger(index) || index < 0) {
      return res.status(400).json({ error: 'Invalid page index' });
    }
    const zip = new AdmZip(archive.filePath);
    const images = listArchiveImages(zip);
    const entryName = images[index];
    if (!entryName) return res.status(404).json({ error: 'Page index out of range' });
    const entry = zip.getEntry(entryName);
    const buf = entry ? entry.getData() : null;
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
    const archive = findArchive(String(req.params.id));
    if (!archive || archive.type !== 'cbz') {
      return res.status(404).json({ error: 'Archive not found or unsupported type' });
    }
    const pages = Array.from({ length: archive.pageCount }, (_, i) => `/api/local/library/${archive.id}/page/${i}`);
    res.json({ pages, pageCount: archive.pageCount, title: archive.title, id: archive.id });
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

