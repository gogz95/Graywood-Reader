import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import AdmZip from 'adm-zip';
import { MangaItem } from '../../src/types';
import { SqliteDb } from '../../sqlite-db';
import { domainRateLimiter } from './domainRateLimiter';
import { comicInfoService } from './comicInfoService';
import { logger } from '../logger';

export type DownloadStatus = 'queued' | 'downloading' | 'packaging' | 'completed' | 'paused' | 'failed' | 'cancelled';

export interface DownloadJob {
  id: string;
  mangaId: string;
  mangaTitle: string;
  chapterNumber: number;
  chapterTitle?: string;
  sourceUrl?: string;
  sourceName?: string;
  status: DownloadStatus;
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

export class DownloadManagerService {
  private jobs: Map<string, DownloadJob> = new Map();
  private isProcessing = false;
  private maxConcurrentJobs = 2;
  private activeJobCount = 0;
  private storageDir: string;

  constructor() {
    const rawStorage = (process.env.STORAGE_PATH || '').trim() || path.join(process.cwd(), 'data', 'downloads');
    this.storageDir = path.resolve(rawStorage);
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
    this.loadPersistedJobs();
  }

  /**
   * Restores download queue state from SQLite upon service boot and recovers interrupted tasks.
   */
  private loadPersistedJobs(): void {
    try {
      const persisted = SqliteDb.getDownloadJobs();
      for (const job of persisted) {
        // Crash recovery: if server restarted while a download was in-flight, reset to queued
        if (job.status === 'downloading' || job.status === 'packaging') {
          job.status = 'queued';
          job.progress.current = 0;
          job.progress.percent = 0;
          job.progress.bytesDownloaded = 0;
          SqliteDb.saveDownloadJob(job);
        }
        this.jobs.set(job.id, job);
      }
      logger.info('DownloadManager', `Restored ${this.jobs.size} download jobs from database (${persisted.filter(j => j.status === 'queued').length} queued)`);
      this.triggerQueueProcessing();
    } catch (err: any) {
      logger.warn('DownloadManager', `Could not load persisted download jobs: ${err?.message || err}`);
    }
  }

  public getStorageDirectory(): string {
    return this.storageDir;
  }

  public getJobs(): DownloadJob[] {
    return Array.from(this.jobs.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  public getJob(id: string): DownloadJob | undefined {
    return this.jobs.get(id);
  }

  public enqueue(
    manga: MangaItem,
    chapterNumbers: number[],
    options: { priority?: boolean; sourceUrl?: string; sourceName?: string } = {}
  ): DownloadJob[] {
    const createdJobs: DownloadJob[] = [];

    for (const chNum of chapterNumbers) {
      const jobId = `dl_${manga.id}_ch${chNum}_${crypto.randomBytes(4).toString('hex')}`;

      // Check if duplicate queued/downloading job already exists
      const existing = Array.from(this.jobs.values()).find(
        (j) => j.mangaId === manga.id && j.chapterNumber === chNum && (j.status === 'queued' || j.status === 'downloading')
      );
      if (existing) {
        createdJobs.push(existing);
        continue;
      }

      const job: DownloadJob = {
        id: jobId,
        mangaId: manga.id,
        mangaTitle: manga.title,
        chapterNumber: chNum,
        chapterTitle: `Chapter ${chNum}`,
        sourceUrl: options.sourceUrl || manga.sourceUrl,
        sourceName: options.sourceName || manga.sourceName,
        status: 'queued',
        progress: {
          current: 0,
          total: 0,
          percent: 0,
          bytesDownloaded: 0,
        },
        error: null,
        outputPath: null,
        createdAt: new Date().toISOString(),
        startedAt: null,
        finishedAt: null,
        retries: 0,
      };

      this.jobs.set(jobId, job);
      SqliteDb.saveDownloadJob(job);
      createdJobs.push(job);
    }

    this.triggerQueueProcessing();
    return createdJobs;
  }

  public pauseJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job || (job.status !== 'queued' && job.status !== 'downloading')) return false;
    job.status = 'paused';
    SqliteDb.saveDownloadJob(job);
    return true;
  }

  public resumeJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'paused') return false;
    job.status = 'queued';
    SqliteDb.saveDownloadJob(job);
    this.triggerQueueProcessing();
    return true;
  }

  public cancelJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    job.status = 'cancelled';
    this.jobs.delete(jobId);
    SqliteDb.deleteDownloadJob(jobId);
    return true;
  }

  public clearCompleted(): void {
    for (const [id, job] of this.jobs.entries()) {
      if (job.status === 'completed' || job.status === 'cancelled') {
        this.jobs.delete(id);
      }
    }
    SqliteDb.clearCompletedDownloadJobs();
  }

  public getDownloadedFilePath(mangaId: string, chapterNumber: number): string | null {
    // Find job with matching mangaId and chapterNumber
    const job = Array.from(this.jobs.values()).find(
      (j) => j.mangaId === mangaId && j.chapterNumber === chapterNumber && j.status === 'completed' && j.outputPath
    );
    if (job && job.outputPath && fs.existsSync(job.outputPath)) {
      return job.outputPath;
    }

    // Direct filesystem lookup in storageDir
    try {
      const manga = SqliteDb.getMangaById(mangaId);
      const safeSeries = (manga?.title || mangaId).replace(/[/\\?%*:|"<>]/g, '_').trim();
      const seriesDir = path.join(this.storageDir, safeSeries);
      const possiblePath = path.join(seriesDir, `${safeSeries} - Ch.${chapterNumber}.cbz`);
      if (fs.existsSync(possiblePath)) {
        return possiblePath;
      }
    } catch (_) {}

    return null;
  }

  private triggerQueueProcessing(): void {
    if (this.isProcessing || this.activeJobCount >= this.maxConcurrentJobs) return;
    this.processNextJobs();
  }

  private async processNextJobs(): Promise<void> {
    const queuedJobs = Array.from(this.jobs.values()).filter((j) => j.status === 'queued');
    if (queuedJobs.length === 0) return;

    while (this.activeJobCount < this.maxConcurrentJobs) {
      const nextJob = queuedJobs.shift();
      if (!nextJob) break;

      this.activeJobCount++;
      this.executeDownloadJob(nextJob).finally(() => {
        this.activeJobCount--;
        this.processNextJobs();
      });
    }
  }

  private async executeDownloadJob(job: DownloadJob): Promise<void> {
    job.status = 'downloading';
    job.startedAt = new Date().toISOString();
    job.error = null;
    SqliteDb.saveDownloadJob(job);

    logger.info('DownloadManager', `Starting download for "${job.mangaTitle}" Chapter ${job.chapterNumber}`);

    try {
      // 1. Fetch chapter page URLs using the reader crawler/scraper
      const manga = SqliteDb.getMangaById(job.mangaId);
      if (!manga) {
        throw new Error(`Series "${job.mangaTitle}" not found in database`);
      }

      const effectiveUrl = job.sourceUrl || manga.sourceUrl;
      const pages = await this.resolveChapterPages(manga, job.chapterNumber, effectiveUrl);

      if (!pages || pages.length === 0) {
        throw new Error(`No pages found for Chapter ${job.chapterNumber}`);
      }

      job.progress.total = pages.length;
      job.progress.current = 0;
      job.progress.percent = 0;
      SqliteDb.saveDownloadJob(job);

      const zip = new AdmZip();
      const safeSeriesName = (manga.title || 'Untitled').replace(/[/\\?%*:|"<>]/g, '_').trim();
      const seriesDir = path.join(this.storageDir, safeSeriesName);
      if (!fs.existsSync(seriesDir)) {
        fs.mkdirSync(seriesDir, { recursive: true });
      }

      // 2. Download page images with per-domain rate limiting and retry logic
      let pageIdx = 0;
      for (const pageUrl of pages) {
        const currentStatus = job.status as string;
        if (currentStatus === 'cancelled' || currentStatus === 'paused') {
          return;
        }

        const imgBuffer = await this.downloadPageWithRetry(pageUrl, effectiveUrl, 3);
        const ext = this.guessExtension(pageUrl);
        const paddedNum = String(pageIdx + 1).padStart(3, '0');
        const entryName = `page_${paddedNum}${ext}`;

        zip.addFile(entryName, imgBuffer);

        pageIdx++;
        job.progress.current = pageIdx;
        job.progress.bytesDownloaded += imgBuffer.length;
        job.progress.percent = Math.round((pageIdx / pages.length) * 100);

        // Periodically checkpoint progress to database every 5 pages or at 100%
        if (pageIdx % 5 === 0 || pageIdx === pages.length) {
          SqliteDb.saveDownloadJob(job);
        }
      }

      // 3. Inject standard ComicInfo.xml into CBZ
      job.status = 'packaging';
      SqliteDb.saveDownloadJob(job);

      comicInfoService.injectIntoZip(zip, manga, {
        chapterNumber: job.chapterNumber,
        title: job.chapterTitle,
        pageCount: pages.length,
        scanGroup: job.sourceName,
      });

      // 4. Write CBZ archive to disk
      const cbzFilename = `${safeSeriesName} - Ch.${job.chapterNumber}.cbz`;
      const finalPath = path.join(seriesDir, cbzFilename);

      zip.writeZip(finalPath);

      job.status = 'completed';
      job.outputPath = finalPath;
      job.finishedAt = new Date().toISOString();
      job.progress.percent = 100;
      SqliteDb.saveDownloadJob(job);

      logger.info('DownloadManager', `Successfully saved "${cbzFilename}" (${job.progress.bytesDownloaded} bytes, ${pages.length} pages)`);
    } catch (err: any) {
      logger.error('DownloadManager', `Download failed for "${job.mangaTitle}" Ch.${job.chapterNumber}: ${err?.message || err}`);
      job.status = 'failed';
      job.error = err.message || 'Download failed';
      job.finishedAt = new Date().toISOString();
      SqliteDb.saveDownloadJob(job);
    }
  }

  private async resolveChapterPages(manga: MangaItem, chapterNum: number, sourceUrl?: string): Promise<string[]> {
    const { kotatsuImageEngine } = await import('./crawlerEngine');
    const targetUrl = sourceUrl || manga.sourceUrl;
    const pages = await kotatsuImageEngine.getChapterPages(targetUrl, 'general', chapterNum);
    return pages || [];
  }

  private async downloadPageWithRetry(pageUrl: string, refererUrl?: string, maxRetries = 3): Promise<Buffer> {
    let lastError: any;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await domainRateLimiter.schedule(pageUrl, async () => {
          const headers: Record<string, string> = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          };
          if (refererUrl) {
            headers['Referer'] = refererUrl;
          }

          const res = await fetch(pageUrl, {
            headers,
            signal: AbortSignal.timeout(15000),
          });

          if (!res.ok) {
            const err: any = new Error(`HTTP ${res.status} ${res.statusText}`);
            err.status = res.status;
            throw err;
          }

          const arrayBuf = await res.arrayBuffer();
          return Buffer.from(arrayBuf);
        });
      } catch (err: any) {
        lastError = err;
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
    }

    throw lastError || new Error(`Failed to download image from ${pageUrl}`);
  }

  private guessExtension(url: string): string {
    const clean = url.split('?')[0].toLowerCase();
    if (clean.endsWith('.webp')) return '.webp';
    if (clean.endsWith('.png')) return '.png';
    if (clean.endsWith('.gif')) return '.gif';
    if (clean.endsWith('.avif')) return '.avif';
    return '.jpg';
  }
}

export const downloadManager = new DownloadManagerService();
