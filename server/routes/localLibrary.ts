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
const ARCHIVE_EXT = /\.(cbz|zip|cbr|rar|pdf|epub)$/i;

function resolveStorageRoot(): string {
  const raw = (process.env.STORAGE_PATH || '').trim() || path.join(process.cwd(), 'data', 'storage');
  return path.resolve(raw);
}

export interface LocalArchive {
  id: string;           // stable sha256 of absolute path
  title: string;
  fileName: string;
  filePath: string;
  type: 'cbz' | 'cbr' | 'pdf' | 'epub' | 'other';
  pageCount: number;    // 0 when not determinable (cbr/pdf) or chapter count for EPUB
  sizeBytes: number;
  coverDataUrl?: string;
  isTextNovel?: boolean;
  toc?: { index: number; title: string; href: string }[];
}

export interface CachedArchiveEntry {
  archive: LocalArchive;
  imageEntries: string[];
  mtimeMs: number;
  sizeBytes: number;
  epubSpine?: string[];
  epubManifest?: Map<string, { href: string; mediaType: string }>;
  epubBasePath?: string;
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
  if (ext === '.epub') return 'epub';
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
    let epubSpine: string[] = [];
    let epubManifest = new Map<string, { href: string; mediaType: string }>();
    let epubBasePath = '';
    let epubToc: { index: number; title: string; href: string }[] = [];

    if (type === 'cbz' || type === 'cbr' || type === 'other') {
      try {
        const zip = new AdmZip(filePath);
        imageEntries = listArchiveImages(zip);
        const first = zip.getEntry(imageEntries[0]);
        if (first) {
          const buf = first.getData();
          if (buf && buf.length > 0 && buf.length < 3 * 1024 * 1024) {
            coverDataUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;
          }
        }
      } catch {
        // Fallback for non-zip CBR / RAR
      }
    } else if (type === 'epub') {
      try {
        const zip = new AdmZip(filePath);
        // Locate root .opf package file
        const containerEntry = zip.getEntry('META-INF/container.xml');
        let opfPath = '';
        if (containerEntry) {
          const containerXml = containerEntry.getData().toString('utf-8');
          const rootfileMatch = containerXml.match(/full-path=["']([^"']+\.opf)["']/i);
          if (rootfileMatch) opfPath = rootfileMatch[1];
        }
        if (!opfPath) {
          const allEntries = zip.getEntries();
          const opf = allEntries.find((e) => e.entryName.endsWith('.opf'));
          if (opf) opfPath = opf.entryName;
        }

        if (opfPath) {
          epubBasePath = path.posix.dirname(opfPath);
          if (epubBasePath === '.') epubBasePath = '';
          const opfEntry = zip.getEntry(opfPath);
          if (opfEntry) {
            const opfXml = opfEntry.getData().toString('utf-8');
            const itemRegex = /<item\s+[^>]*id=["']([^"']+)["'][^>]*href=["']([^"']+)["'][^>]*media-type=["']([^"']+)["'][^>]*\/?>/gi;
            let mMatch;
            while ((mMatch = itemRegex.exec(opfXml)) !== null) {
              const id = mMatch[1];
              const href = mMatch[2];
              const mediaType = mMatch[3];
              const resolvedHref = epubBasePath ? path.posix.join(epubBasePath, href) : href;
              epubManifest.set(id, { href: resolvedHref, mediaType });
              if (!coverDataUrl && (id.toLowerCase().includes('cover') || mediaType.startsWith('image/'))) {
                const imgEntry = zip.getEntry(resolvedHref);
                if (imgEntry) {
                  const buf = imgEntry.getData();
                  coverDataUrl = `data:${mediaType};base64,${buf.toString('base64')}`;
                }
              }
            }

            const spineRegex = /<itemref\s+[^>]*idref=["']([^"']+)["'][^>]*\/?>/gi;
            let sMatch;
            let sIdx = 0;
            while ((sMatch = spineRegex.exec(opfXml)) !== null) {
              const idref = sMatch[1];
              const manifestItem = epubManifest.get(idref);
              if (manifestItem && (manifestItem.mediaType.includes('xhtml') || manifestItem.mediaType.includes('html') || manifestItem.mediaType.includes('xml'))) {
                epubSpine.push(manifestItem.href);
                epubToc.push({
                  index: sIdx,
                  title: `Chapter ${sIdx + 1}`,
                  href: manifestItem.href,
                });
                sIdx++;
              }
            }
          }
        }
        imageEntries = epubSpine;
      } catch (err: any) {
        console.warn('[EPUB Parser] Failed to parse EPUB archive:', err.message);
      }
    } else if (type === 'pdf') {
      try {
        const rawHead = fs.readFileSync(filePath, { encoding: 'latin1', flag: 'r' });
        const countMatch = rawHead.match(/\/Type\s*\/Pages[^>]*\/Count\s+(\d+)/) || rawHead.match(/\/Count\s+(\d+)/);
        if (countMatch && parseInt(countMatch[1], 10) > 0) {
          const pCount = Math.min(1000, parseInt(countMatch[1], 10));
          imageEntries = Array.from({ length: pCount }, (_, i) => `page_${i + 1}.pdf`);
        } else {
          const pageMatches = rawHead.match(/\/Type\s*\/Page\b/g);
          if (pageMatches && pageMatches.length > 0) {
            imageEntries = Array.from({ length: Math.min(1000, pageMatches.length) }, (_, i) => `page_${i + 1}.pdf`);
          }
        }
      } catch {}
    }

    if (!coverDataUrl) {
      const safeTitle = deriveTitle(fileName).slice(0, 30);
      const badgeType = type.toUpperCase();
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600">
        <defs>
          <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#1e1b4b" />
            <stop offset="100%" stop-color="#0f172a" />
          </linearGradient>
        </defs>
        <rect width="400" height="600" rx="16" fill="url(#g)" />
        <rect x="20" y="20" width="360" height="560" rx="12" fill="none" stroke="#6366f1" stroke-opacity="0.3" stroke-width="2" />
        <text x="200" y="260" font-family="sans-serif" font-size="20" font-weight="bold" fill="#f8fafc" text-anchor="middle">${safeTitle}</text>
        <rect x="130" y="320" width="140" height="36" rx="18" fill="#6366f1" fill-opacity="0.2" stroke="#6366f1" stroke-width="1.5" />
        <text x="200" y="344" font-family="sans-serif" font-size="13" font-weight="bold" fill="#818cf8" text-anchor="middle">${badgeType} ARCHIVE</text>
      </svg>`;
      coverDataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
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
      isTextNovel: type === 'epub',
      toc: epubToc.length > 0 ? epubToc : undefined,
    };

    const entry: CachedArchiveEntry = {
      archive,
      imageEntries,
      mtimeMs: stat.mtimeMs,
      sizeBytes: stat.size,
      epubSpine,
      epubManifest,
      epubBasePath,
    };
    archiveCache.set(id, entry);
    return entry;
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
    if (!entry) {
      return res.status(404).json({ error: 'Archive not found' });
    }

    if (entry.imageEntries.length > 0) {
      try {
        const zip = new AdmZip(entry.archive.filePath);
        const first = zip.getEntry(entry.imageEntries[0]);
        if (first) {
          const buf = first.getData();
          res.setHeader('Content-Type', 'image/jpeg');
          res.setHeader('Cache-Control', 'public, max-age=86400');
          return res.send(buf);
        }
      } catch {}
    }

    if (entry.archive.coverDataUrl) {
      const match = entry.archive.coverDataUrl.match(/^data:(image\/[^;]+);base64,(.*)$/);
      if (match) {
        const mime = match[1];
        const buf = Buffer.from(match[2], 'base64');
        res.setHeader('Content-Type', mime);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.send(buf);
      }
    }

    res.status(404).json({ error: 'No cover available' });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to read cover', details: err.message });
  }
});

// GET /api/local/library/:id/page/:n - Stream the n-th page image
localLibraryRouter.get('/api/local/library/:id/page/:n', (req: Request, res: Response) => {
  try {
    const entry = getArchiveEntry(String(req.params.id));
    if (!entry) {
      return res.status(404).json({ error: 'Archive not found' });
    }
    const index = Number(req.params.n);
    if (!Number.isInteger(index) || index < 0) {
      return res.status(400).json({ error: 'Invalid page index' });
    }
    const entryName = entry.imageEntries[index];
    if (!entryName) return res.status(404).json({ error: 'Page index out of range' });

    try {
      const zip = new AdmZip(entry.archive.filePath);
      const zipEntry = zip.getEntry(entryName);
      const buf = zipEntry ? zipEntry.getData() : null;
      if (buf) {
        const ext = path.extname(entryName).toLowerCase().replace('.', '') || 'jpeg';
        const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
        res.setHeader('Content-Type', mime);
        res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
        return res.send(buf);
      }
    } catch {}

    // Fallback for non-zip pages: generate numbered SVG page frame
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200" viewBox="0 0 800 1200">
      <rect width="800" height="1200" fill="#0f172a" />
      <text x="400" y="600" font-family="sans-serif" font-size="28" font-weight="bold" fill="#94a3b8" text-anchor="middle">Page ${index + 1} (${entry.archive.title})</text>
    </svg>`;
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.send(Buffer.from(svg));
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to read page', details: err.message });
  }
});

// GET /api/local/library/:id/pages - Return page URL list for the reader
localLibraryRouter.get('/api/local/library/:id/pages', (req: Request, res: Response) => {
  try {
    const entry = getArchiveEntry(String(req.params.id));
    if (!entry) {
      return res.status(404).json({ error: 'Archive not found' });
    }
    const count = Math.max(1, entry.archive.pageCount);
    const pages = Array.from({ length: count }, (_, i) => `/api/local/library/${entry.archive.id}/page/${i}`);
    res.json({ pages, pageCount: count, title: entry.archive.title, id: entry.archive.id });
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

// GET /api/local/library/:id/epub/toc - Get Table of Contents for an EPUB
localLibraryRouter.get('/api/local/library/:id/epub/toc', (req: Request, res: Response) => {
  try {
    const entry = getArchiveEntry(String(req.params.id));
    if (!entry) return res.status(404).json({ error: 'Archive not found' });
    res.json({
      id: entry.archive.id,
      title: entry.archive.title,
      totalChapters: entry.imageEntries.length,
      toc: entry.archive.toc || [],
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to read TOC', details: err.message });
  }
});

// GET /api/local/library/:id/epub/chapter/:index - Get chapter HTML content
localLibraryRouter.get('/api/local/library/:id/epub/chapter/:index', (req: Request, res: Response) => {
  try {
    const entry = getArchiveEntry(String(req.params.id));
    if (!entry) return res.status(404).json({ error: 'Archive not found' });
    const idx = Number(req.params.index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= entry.imageEntries.length) {
      return res.status(400).json({ error: 'Invalid chapter index' });
    }

    const chapterHref = entry.imageEntries[idx];
    const zip = new AdmZip(entry.archive.filePath);
    const chapterEntry = zip.getEntry(chapterHref);
    if (!chapterEntry) return res.status(404).json({ error: 'Chapter entry not found in EPUB' });

    let rawHtml = chapterEntry.getData().toString('utf-8');
    const chapterDir = path.posix.dirname(chapterHref);

    // Rewrite relative image srcs to use EPUB resource endpoint
    rawHtml = rawHtml.replace(/<img\s+([^>]*?)src=["']([^"']+)["']([^>]*)>/gi, (_, before, src, after) => {
      if (src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://')) {
        return `<img ${before}src="${src}"${after}>`;
      }
      const resolvedPath = chapterDir && chapterDir !== '.' ? path.posix.join(chapterDir, src) : src;
      const proxyUrl = `/api/local/library/${entry.archive.id}/epub/resource?path=${encodeURIComponent(resolvedPath)}`;
      return `<img ${before}src="${proxyUrl}"${after}>`;
    });

    // Strip dangerous script tags
    rawHtml = rawHtml.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

    res.json({
      id: entry.archive.id,
      index: idx,
      title: entry.archive.toc?.[idx]?.title || `Chapter ${idx + 1}`,
      href: chapterHref,
      html: rawHtml,
      totalChapters: entry.imageEntries.length,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to read chapter', details: err.message });
  }
});

// GET /api/local/library/:id/epub/resource - Stream embedded EPUB image or style resource
localLibraryRouter.get('/api/local/library/:id/epub/resource', (req: Request, res: Response) => {
  try {
    const entry = getArchiveEntry(String(req.params.id));
    if (!entry) return res.status(404).json({ error: 'Archive not found' });
    const targetPath = String(req.query.path || '').trim();
    if (!targetPath) return res.status(400).json({ error: 'Resource path is required' });

    const zip = new AdmZip(entry.archive.filePath);
    const resEntry = zip.getEntry(targetPath) || zip.getEntry(decodeURIComponent(targetPath));
    if (!resEntry) return res.status(404).json({ error: 'Resource not found' });

    const buf = resEntry.getData();
    const ext = path.extname(targetPath).toLowerCase().replace('.', '');
    const mime =
      ext === 'png' ? 'image/png' :
      ext === 'webp' ? 'image/webp' :
      ext === 'gif' ? 'image/gif' :
      ext === 'css' ? 'text/css' :
      ext === 'svg' ? 'image/svg+xml' :
      'image/jpeg';

    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.send(buf);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch resource', details: err.message });
  }
});


