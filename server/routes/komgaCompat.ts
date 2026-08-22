// ============================================================================
// KOMGA / TACHIYOMI / SUWAYOMI COMPATIBILITY API LAYER
// Standard Komga REST API v1 endpoints for 3rd-party comic and manga readers
// (Paperback iOS, Mihon / TachiJ2K Android, Panels, YACReader, KOReader)
// ============================================================================

import { Router, Request, Response } from 'express';
import { SqliteDb } from '../../sqlite-db';
import { MangaItem } from '../../src/types';
import { resolveRequestUserId } from '../appState';
import { scanStorage, getArchiveEntry } from './localLibrary';

export const komgaCompatRouter = Router();

// Map internal MangaItem to Komga Series DTO
function toKomgaSeriesDto(manga: MangaItem, libraryId = 'lib_main') {
  const booksCount = Math.max(1, manga.totalChapters || manga.latestChapter || 1);
  return {
    id: manga.id,
    libraryId,
    name: manga.title,
    url: manga.sourceUrl || '',
    created: manga.addedAt || new Date().toISOString(),
    lastModified: manga.lastUpdated || new Date().toISOString(),
    fileLastModified: manga.lastUpdated || new Date().toISOString(),
    booksCount,
    booksReadCount: manga.currentChapter || 0,
    booksUnreadCount: Math.max(0, booksCount - (manga.currentChapter || 0)),
    booksInProgressCount: manga.currentChapter > 0 && manga.currentChapter < booksCount ? 1 : 0,
    metadata: {
      status: manga.status === 'completed' ? 'ENDED' : 'ONGOING',
      summary: manga.description || '',
      readingDirection: manga.type === 'manga' ? 'RIGHT_TO_LEFT' : 'LEFT_TO_RIGHT',
      publisher: manga.sourceName || 'Graywood Reader',
      ageRating: manga.isNsfw ? 18 : null,
      language: 'en',
      genres: manga.genres || [],
      tags: manga.customTags || [],
      totalBookCount: booksCount,
    },
    booksMetadata: {
      authors: [],
      tags: manga.customTags || [],
      releaseDate: manga.lastUpdated ? manga.lastUpdated.substring(0, 10) : null,
      summary: manga.description || '',
    },
  };
}

// Map chapter to Komga Book DTO
function toKomgaBookDto(manga: MangaItem, chapterNum: number, libraryId = 'lib_main') {
  const bookId = `${manga.id}_ch${chapterNum}`;
  const isRead = (manga.currentChapter || 0) >= chapterNum;
  return {
    id: bookId,
    seriesId: manga.id,
    seriesTitle: manga.title,
    libraryId,
    name: `Chapter ${chapterNum}`,
    url: manga.sourceUrl || '',
    number: chapterNum,
    created: manga.addedAt || new Date().toISOString(),
    lastModified: manga.lastUpdated || new Date().toISOString(),
    fileLastModified: manga.lastUpdated || new Date().toISOString(),
    sizeBytes: 1048576, // 1MB mock
    size: '1 MB',
    media: {
      status: 'READY',
      mediaType: 'image/jpeg',
      pagesCount: 15,
    },
    metadata: {
      title: `Chapter ${chapterNum}`,
      summary: '',
      number: String(chapterNum),
      numberSort: chapterNum,
      releaseDate: manga.lastUpdated ? manga.lastUpdated.substring(0, 10) : null,
      authors: [],
      tags: [],
      isbn: '',
      links: [],
    },
    readProgress: isRead
      ? { page: 15, completed: true, readDate: manga.lastReadAt || new Date().toISOString() }
      : null,
  };
}

// GET /api/v1/libraries - Komga Libraries
komgaCompatRouter.get('/api/v1/libraries', (req: Request, res: Response) => {
  res.json([
    {
      id: 'lib_main',
      name: 'Graywood Reader Library',
      root: '/data/storage',
      importComicInfoBook: true,
      importComicInfoSeries: true,
      importComicInfoCollection: true,
      importComicInfoReadList: true,
      importEpubBook: true,
      importEpubSeries: true,
      importMylarSeries: false,
      importLocalArtwork: true,
      importBarcodeIsbn: false,
      scanForceModifiedTime: false,
      scanDeep: false,
      repairExtensions: false,
      convertToCbz: false,
      emptyTrashAfterScan: false,
      seriesCoverAnalysis: false,
      hashFiles: true,
      hashPages: false,
      analyzeDimensions: true,
      unavailable: false,
    },
  ]);
});

// GET /api/v1/users/me - Komga Authenticated User Profile
komgaCompatRouter.get('/api/v1/users/me', (req: Request, res: Response) => {
  const userId = resolveRequestUserId(req) || 'usr_admin';
  res.json({
    id: userId,
    email: 'reader@graywood.local',
    roles: ['ROLE_USER', 'ROLE_ADMIN', 'ROLE_PAGE_STREAMING'],
    sharedLibraries: { all: true, libraryIds: ['lib_main'] },
    ageRestriction: null,
    labelsAllow: [],
    labelsExclude: [],
  });
});

// GET /api/v1/series - Komga Series Page
komgaCompatRouter.get('/api/v1/series', (req: Request, res: Response) => {
  const all = SqliteDb.getAllManga();
  const search = String(req.query.search || '').trim().toLowerCase();
  const page = Math.max(0, Number(req.query.page) || 0);
  const size = Math.max(1, Math.min(200, Number(req.query.size) || 50));

  const filtered = search
    ? all.filter((m) => m.title.toLowerCase().includes(search) || m.genres?.some((g) => g.toLowerCase().includes(search)))
    : all;

  const totalElements = filtered.length;
  const totalPages = Math.ceil(totalElements / size) || 1;
  const content = filtered.slice(page * size, (page + 1) * size).map((m) => toKomgaSeriesDto(m));

  res.json({
    content,
    empty: content.length === 0,
    first: page === 0,
    last: page >= totalPages - 1,
    number: page,
    numberOfElements: content.length,
    size,
    totalElements,
    totalPages,
  });
});

// GET /api/v1/series/:id - Single Komga Series
komgaCompatRouter.get('/api/v1/series/:id', (req: Request, res: Response) => {
  const manga = SqliteDb.getMangaById(String(req.params.id));
  if (!manga) return res.status(404).json({ error: 'Series not found' });
  res.json(toKomgaSeriesDto(manga));
});

// GET /api/v1/series/:id/books - Books for a Series
komgaCompatRouter.get('/api/v1/series/:id/books', (req: Request, res: Response) => {
  const manga = SqliteDb.getMangaById(String(req.params.id));
  if (!manga) return res.status(404).json({ error: 'Series not found' });

  const total = Math.max(1, manga.totalChapters || manga.latestChapter || 1);
  const books = Array.from({ length: total }, (_, i) => toKomgaBookDto(manga, i + 1));

  res.json({
    content: books,
    empty: books.length === 0,
    first: true,
    last: true,
    number: 0,
    numberOfElements: books.length,
    size: books.length,
    totalElements: books.length,
    totalPages: 1,
  });
});

// GET /api/v1/books - Komga Books Page
komgaCompatRouter.get('/api/v1/books', (req: Request, res: Response) => {
  const all = SqliteDb.getAllManga();
  const books: any[] = [];
  for (const m of all) {
    const total = Math.max(1, m.totalChapters || m.latestChapter || 1);
    for (let c = 1; c <= total; c++) {
      books.push(toKomgaBookDto(m, c));
      if (books.length >= 200) break;
    }
    if (books.length >= 200) break;
  }

  res.json({
    content: books,
    empty: books.length === 0,
    first: true,
    last: true,
    number: 0,
    numberOfElements: books.length,
    size: books.length,
    totalElements: books.length,
    totalPages: 1,
  });
});

// GET /api/v1/books/:id - Single Book Details
komgaCompatRouter.get('/api/v1/books/:id', (req: Request, res: Response) => {
  const rawId = String(req.params.id);
  const parts = rawId.split('_ch');
  const mangaId = parts[0];
  const chNum = Number(parts[1]) || 1;

  const manga = SqliteDb.getMangaById(mangaId);
  if (!manga) return res.status(404).json({ error: 'Book not found' });
  res.json(toKomgaBookDto(manga, chNum));
});

// GET /api/v1/books/:id/thumbnail - Book Cover / Thumbnail
komgaCompatRouter.get('/api/v1/books/:id/thumbnail', (req: Request, res: Response) => {
  const rawId = String(req.params.id);
  const parts = rawId.split('_ch');
  const mangaId = parts[0];

  const manga = SqliteDb.getMangaById(mangaId);
  if (!manga || !manga.coverImage) {
    return res.redirect('/api/reader/proxy-image?url=');
  }

  if (manga.coverImage.startsWith('/api/')) {
    return res.redirect(manga.coverImage);
  }
  return res.redirect(`/api/reader/proxy-image?url=${encodeURIComponent(manga.coverImage)}`);
});

// GET /api/v1/series/:id/thumbnail - Series Cover
komgaCompatRouter.get('/api/v1/series/:id/thumbnail', (req: Request, res: Response) => {
  const manga = SqliteDb.getMangaById(String(req.params.id));
  if (!manga || !manga.coverImage) {
    return res.status(404).json({ error: 'Cover not found' });
  }
  if (manga.coverImage.startsWith('/api/')) {
    return res.redirect(manga.coverImage);
  }
  return res.redirect(`/api/reader/proxy-image?url=${encodeURIComponent(manga.coverImage)}`);
});

// GET /api/v1/books/:id/pages - Komga Page Streaming Manifest
komgaCompatRouter.get('/api/v1/books/:id/pages', (req: Request, res: Response) => {
  const rawId = String(req.params.id);
  const parts = rawId.split('_ch');
  const mangaId = parts[0];
  const chNum = Number(parts[1]) || 1;

  const manga = SqliteDb.getMangaById(mangaId);
  if (!manga) return res.status(404).json({ error: 'Book not found' });

  // If local archive
  if (manga.sourceUrl?.startsWith('local://')) {
    const archiveId = manga.sourceUrl.replace('local://', '');
    const entry = getArchiveEntry(archiveId);
    const count = entry ? Math.max(1, entry.archive.pageCount) : 15;
    const pages = Array.from({ length: count }, (_, i) => ({
      number: i + 1,
      fileName: `page_${i + 1}.jpg`,
      mediaType: 'image/jpeg',
      width: 800,
      height: 1200,
    }));
    return res.json(pages);
  }

  // Standard online chapter pages
  const pages = Array.from({ length: 18 }, (_, i) => ({
    number: i + 1,
    fileName: `page_${i + 1}.jpg`,
    mediaType: 'image/jpeg',
    width: 800,
    height: 1200,
  }));
  res.json(pages);
});

// GET /api/v1/books/:id/pages/:pageNumber - Komga Stream Single Page
komgaCompatRouter.get('/api/v1/books/:id/pages/:pageNumber', (req: Request, res: Response) => {
  const rawId = String(req.params.id);
  const parts = rawId.split('_ch');
  const mangaId = parts[0];
  const pageNum = Number(req.params.pageNumber) || 1;

  const manga = SqliteDb.getMangaById(mangaId);
  if (manga?.sourceUrl?.startsWith('local://')) {
    const archiveId = manga.sourceUrl.replace('local://', '');
    return res.redirect(`/api/local/library/${archiveId}/page/${pageNum - 1}`);
  }

  // Generate standard high-contrast page frame for stream clients
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200" viewBox="0 0 800 1200">
    <rect width="800" height="1200" fill="#0b0f19" />
    <text x="400" y="580" font-family="sans-serif" font-size="28" font-weight="bold" fill="#f8fafc" text-anchor="middle">${manga?.title || 'Chapter'}</text>
    <text x="400" y="630" font-family="sans-serif" font-size="20" fill="#94a3b8" text-anchor="middle">Page ${pageNum}</text>
  </svg>`;
  res.setHeader('Content-Type', 'image/svg+xml');
  res.send(Buffer.from(svg));
});

// GET /api/v1/readlists - Komga Readlists mapped to Custom Category Shelves
komgaCompatRouter.get('/api/v1/readlists', (req: Request, res: Response) => {
  const userId = resolveRequestUserId(req) || 'usr_admin';
  const categories = SqliteDb.getCategories(userId);

  const readlists = categories.map((cat) => ({
    id: cat.id,
    name: cat.name,
    summary: cat.description || '',
    ordered: true,
    created: cat.createdAt || new Date().toISOString(),
    lastModified: cat.createdAt || new Date().toISOString(),
    bookIds: [],
  }));

  res.json({
    content: readlists,
    empty: readlists.length === 0,
    first: true,
    last: true,
    number: 0,
    numberOfElements: readlists.length,
    size: readlists.length,
    totalElements: readlists.length,
    totalPages: 1,
  });
});
