// ============================================================================
// db/chapters.ts — Relational Chapter Mirror & Metadata Data Access Layer
// ============================================================================

import { db } from './connection';

export interface ChapterRecord {
  id: string;
  manga_id: string;
  source_id: string;
  chapter_number: number;
  title?: string | null;
  url: string;
  branch?: string | null;
  scanlator?: string | null;
  upload_date?: string | null;
  created_at?: number;
  updated_at?: number;
}

export type ChapterRow = ChapterRecord;

export interface ChapterInput {
  id?: string;
  chapterNumber?: number;
  chapter_number?: number;
  title?: string | null;
  url: string;
  branch?: string | null;
  scanlator?: string | null;
  uploadDate?: string | null;
  upload_date?: string | null;
  created_at?: number;
  updated_at?: number;
}

const upsertChapterStmt = db.prepare(`
  INSERT INTO manga_chapters (
    id, manga_id, source_id, chapter_number, title, url, branch, scanlator, upload_date, created_at, updated_at
  ) VALUES (
    ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, strftime('%s', 'now')), strftime('%s', 'now')
  )
  ON CONFLICT(id) DO UPDATE SET
    manga_id = excluded.manga_id,
    source_id = excluded.source_id,
    chapter_number = excluded.chapter_number,
    title = excluded.title,
    url = excluded.url,
    branch = excluded.branch,
    scanlator = excluded.scanlator,
    upload_date = excluded.upload_date,
    updated_at = strftime('%s', 'now')
`);

const getChaptersByMangaIdStmt = db.prepare(`
  SELECT id, manga_id, source_id, chapter_number, title, url, branch, scanlator, upload_date, created_at, updated_at
  FROM manga_chapters
  WHERE manga_id = ?
  ORDER BY chapter_number DESC, created_at DESC
`);

const getChapterByNumberAndSourceStmt = db.prepare(`
  SELECT id, manga_id, source_id, chapter_number, title, url, branch, scanlator, upload_date, created_at, updated_at
  FROM manga_chapters
  WHERE manga_id = ? AND chapter_number = ? AND source_id = ?
  LIMIT 1
`);

const getChapterByNumberAnySourceStmt = db.prepare(`
  SELECT id, manga_id, source_id, chapter_number, title, url, branch, scanlator, upload_date, created_at, updated_at
  FROM manga_chapters
  WHERE manga_id = ? AND chapter_number = ?
  LIMIT 1
`);

const getAlternativeMirrorsExcludeStmt = db.prepare(`
  SELECT id, manga_id, source_id, chapter_number, title, url, branch, scanlator, upload_date, created_at, updated_at
  FROM manga_chapters
  WHERE manga_id = ? AND chapter_number = ? AND LOWER(source_id) != LOWER(?)
  ORDER BY created_at DESC
`);

const getAlternativeMirrorsAllStmt = db.prepare(`
  SELECT id, manga_id, source_id, chapter_number, title, url, branch, scanlator, upload_date, created_at, updated_at
  FROM manga_chapters
  WHERE manga_id = ? AND chapter_number = ?
  ORDER BY created_at DESC
`);

/**
 * Upsert chapter records into manga_chapters table inside a single batch transaction.
 * Supports both (chapters: ChapterRecord[]) and (mangaId, sourceId, chapters: ChapterInput[])
 */
export function upsertChapters(chapters: ChapterRecord[]): void;
export function upsertChapters(mangaId: string, sourceId: string, chapters: ChapterInput[]): void;
export function upsertChapters(
  arg1: string | ChapterRecord[],
  arg2?: string,
  arg3?: (ChapterInput | ChapterRecord)[]
): void {
  if (Array.isArray(arg1)) {
    const chapters = arg1;
    if (!chapters || chapters.length === 0) return;

    const insertBatch = db.transaction((rows: ChapterRecord[]) => {
      for (const ch of rows) {
        upsertChapterStmt.run(
          ch.id,
          ch.manga_id,
          ch.source_id,
          ch.chapter_number,
          ch.title ?? null,
          ch.url,
          ch.branch ?? null,
          ch.scanlator ?? null,
          ch.upload_date ?? null,
          ch.created_at ?? null
        );
      }
    });

    insertBatch(chapters);
  } else {
    const mangaId = arg1;
    const sourceId = arg2 || '';
    const chapters = arg3 || [];
    if (!chapters.length) return;

    const insertBatch = db.transaction((rows: (ChapterInput | ChapterRecord)[]) => {
      for (const ch of rows) {
        const chNum = Number(ch.chapter_number ?? (ch as any).chapterNumber ?? 0);
        const branchVal = ch.branch ?? null;
        const id = ch.id || `${mangaId}_${sourceId}_${chNum}_${branchVal || ''}`;
        const uploadDate = ch.upload_date ?? (ch as any).uploadDate ?? null;
        upsertChapterStmt.run(
          id,
          mangaId,
          sourceId,
          chNum,
          ch.title ?? null,
          ch.url,
          branchVal,
          ch.scanlator ?? null,
          uploadDate,
          ch.created_at ?? null
        );
      }
    });

    insertBatch(chapters);
  }
}

/**
 * Retrieve all chapters for a given mangaId ordered by chapter_number DESC.
 */
export function getChaptersByMangaId(mangaId: string): ChapterRecord[] {
  if (!mangaId) return [];
  return getChaptersByMangaIdStmt.all(mangaId) as ChapterRecord[];
}

export function getChaptersForManga(mangaId: string): ChapterRow[] {
  return getChaptersByMangaId(mangaId);
}

/**
 * Retrieve a specific chapter for a manga by chapter number and optional sourceId.
 */
export function getChapterByNumberAndSource(
  mangaId: string,
  chapterNumber: number,
  sourceId?: string
): ChapterRecord | undefined {
  if (!mangaId || !Number.isFinite(chapterNumber)) return undefined;
  if (sourceId) {
    return getChapterByNumberAndSourceStmt.get(mangaId, chapterNumber, sourceId) as ChapterRecord | undefined;
  }
  return getChapterByNumberAnySourceStmt.get(mangaId, chapterNumber) as ChapterRecord | undefined;
}

/**
 * Find alternative mirror records for a specific chapter number, optionally excluding a source.
 */
export function getAlternativeMirrorsForChapter(
  mangaId: string,
  chapterNumber: number,
  excludeSourceId?: string
): ChapterRecord[] {
  if (!mangaId || !Number.isFinite(chapterNumber)) return [];
  if (excludeSourceId) {
    return getAlternativeMirrorsExcludeStmt.all(mangaId, chapterNumber, excludeSourceId) as ChapterRecord[];
  }
  return getAlternativeMirrorsAllStmt.all(mangaId, chapterNumber) as ChapterRecord[];
}

export function getMirrorsForChapter(mangaId: string, chapterNumber: number): ChapterRow[] {
  return getAlternativeMirrorsForChapter(mangaId, chapterNumber);
}
