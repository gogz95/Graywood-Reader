import { db } from './connection';

const stmtGetAllDownloadJobs = db.prepare('SELECT * FROM download_jobs ORDER BY created_at DESC');
const stmtGetDownloadJobById = db.prepare('SELECT * FROM download_jobs WHERE id = ?');
const stmtUpsertDownloadJob = db.prepare(`
  INSERT INTO download_jobs (
    id, manga_id, manga_title, chapter_number, chapter_title,
    source_url, source_name, status, current_page, total_pages,
    bytes_downloaded, percent, error, output_path, created_at,
    started_at, finished_at, retries
  ) VALUES (
    @id, @manga_id, @manga_title, @chapter_number, @chapter_title,
    @source_url, @source_name, @status, @current_page, @total_pages,
    @bytes_downloaded, @percent, @error, @output_path, @created_at,
    @started_at, @finished_at, @retries
  ) ON CONFLICT(id) DO UPDATE SET
    status = excluded.status,
    current_page = excluded.current_page,
    total_pages = excluded.total_pages,
    bytes_downloaded = excluded.bytes_downloaded,
    percent = excluded.percent,
    error = excluded.error,
    output_path = excluded.output_path,
    started_at = excluded.started_at,
    finished_at = excluded.finished_at,
    retries = excluded.retries
`);
const stmtDeleteDownloadJob = db.prepare('DELETE FROM download_jobs WHERE id = ?');
const stmtDeleteCompletedDownloadJobs = db.prepare(`DELETE FROM download_jobs WHERE status IN ('completed', 'cancelled')`);

export interface PersistedDownloadJob {
  id: string;
  mangaId: string;
  mangaTitle: string;
  chapterNumber: number;
  chapterTitle?: string;
  sourceUrl?: string;
  sourceName?: string;
  status: 'queued' | 'downloading' | 'packaging' | 'completed' | 'paused' | 'failed' | 'cancelled';
  progress: {
    current: number;
    total: number;
    percent: number;
    bytesDownloaded: number;
  };
  error?: string | null;
  outputPath?: string | null;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  retries: number;
}

export function mapRowToDownloadJob(row: any): PersistedDownloadJob {
  return {
    id: row.id,
    mangaId: row.manga_id,
    mangaTitle: row.manga_title,
    chapterNumber: Number(row.chapter_number) || 0,
    chapterTitle: row.chapter_title || undefined,
    sourceUrl: row.source_url || undefined,
    sourceName: row.source_name || undefined,
    status: row.status,
    progress: {
      current: Number(row.current_page) || 0,
      total: Number(row.total_pages) || 0,
      percent: Number(row.percent) || 0,
      bytesDownloaded: Number(row.bytes_downloaded) || 0,
    },
    error: row.error || null,
    outputPath: row.output_path || null,
    createdAt: row.created_at,
    startedAt: row.started_at || null,
    finishedAt: row.finished_at || null,
    retries: Number(row.retries) || 0,
  };
}

export function saveDownloadJob(job: PersistedDownloadJob): void {
  stmtUpsertDownloadJob.run({
    id: job.id,
    manga_id: job.mangaId,
    manga_title: job.mangaTitle,
    chapter_number: job.chapterNumber,
    chapter_title: job.chapterTitle || null,
    source_url: job.sourceUrl || null,
    source_name: job.sourceName || null,
    status: job.status,
    current_page: job.progress?.current || 0,
    total_pages: job.progress?.total || 0,
    bytes_downloaded: job.progress?.bytesDownloaded || 0,
    percent: job.progress?.percent || 0,
    error: job.error || null,
    output_path: job.outputPath || null,
    created_at: job.createdAt || new Date().toISOString(),
    started_at: job.startedAt || null,
    finished_at: job.finishedAt || null,
    retries: job.retries || 0,
  });
}

export function getDownloadJobs(): PersistedDownloadJob[] {
  const rows = stmtGetAllDownloadJobs.all();
  return rows.map(mapRowToDownloadJob);
}

export function getDownloadJobById(id: string): PersistedDownloadJob | null {
  const row = stmtGetDownloadJobById.get(id);
  return row ? mapRowToDownloadJob(row) : null;
}

export function deleteDownloadJob(id: string): boolean {
  const res = stmtDeleteDownloadJob.run(id);
  return res.changes > 0;
}

export function clearCompletedDownloadJobs(): number {
  const res = stmtDeleteCompletedDownloadJobs.run();
  return res.changes;
}
