import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { SqliteDb } from '../../sqlite-db';
import { downloadManager } from '../services/downloadManagerService';

export const downloadsRouter = Router();

// ============================================================================
// SERVER-SIDE CHAPTER DOWNLOAD MANAGER API
// ============================================================================

// POST /api/downloads/queue - Enqueue one or more chapters for downloading
downloadsRouter.post('/api/downloads/queue', async (req: Request, res: Response): Promise<void> => {
  try {
    const { mangaId, chapters, chapterNumber, priority, sourceUrl, sourceName } = req.body;

    if (!mangaId) {
      res.status(400).json({ error: 'Missing required field "mangaId"' });
      return;
    }

    const manga = SqliteDb.getMangaById(String(mangaId));
    if (!manga) {
      res.status(404).json({ error: `Series "${mangaId}" not found` });
      return;
    }

    let targetChapters: number[] = [];
    if (Array.isArray(chapters) && chapters.length > 0) {
      targetChapters = chapters.map((c: any) => Number(c)).filter((n: number) => !isNaN(n));
    } else if (chapterNumber !== undefined) {
      targetChapters = [Number(chapterNumber)];
    }

    if (targetChapters.length === 0) {
      res.status(400).json({ error: 'No valid chapter numbers provided' });
      return;
    }

    const createdJobs = downloadManager.enqueue(manga, targetChapters, {
      priority: Boolean(priority),
      sourceUrl: sourceUrl ? String(sourceUrl) : undefined,
      sourceName: sourceName ? String(sourceName) : undefined,
    });

    res.status(201).json({
      success: true,
      message: `Enqueued ${createdJobs.length} chapter download(s)`,
      jobs: createdJobs,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to enqueue downloads' });
  }
});

// GET /api/downloads/queue - List all download jobs with real-time status and progress
downloadsRouter.get('/api/downloads/queue', (_req: Request, res: Response): void => {
  const jobs = downloadManager.getJobs();
  res.json({
    total: jobs.length,
    active: jobs.filter((j) => j.status === 'downloading' || j.status === 'packaging').length,
    queued: jobs.filter((j) => j.status === 'queued').length,
    completed: jobs.filter((j) => j.status === 'completed').length,
    failed: jobs.filter((j) => j.status === 'failed').length,
    jobs,
  });
});

// GET /api/downloads/status/:id - Get status for a specific job
downloadsRouter.get('/api/downloads/status/:id', (req: Request, res: Response): void => {
  const jobId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const job = downloadManager.getJob(jobId);
  if (!job) {
    res.status(404).json({ error: 'Download job not found' });
    return;
  }
  res.json(job);
});

// POST /api/downloads/:id/pause - Pause a queued job
downloadsRouter.post('/api/downloads/:id/pause', (req: Request, res: Response): void => {
  const jobId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const ok = downloadManager.pauseJob(jobId);
  if (!ok) {
    res.status(400).json({ error: 'Could not pause job (must be queued)' });
    return;
  }
  res.json({ success: true, message: 'Job paused' });
});

// POST /api/downloads/:id/resume - Resume a paused job
downloadsRouter.post('/api/downloads/:id/resume', (req: Request, res: Response): void => {
  const jobId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const ok = downloadManager.resumeJob(jobId);
  if (!ok) {
    res.status(400).json({ error: 'Could not resume job' });
    return;
  }
  res.json({ success: true, message: 'Job resumed' });
});

// DELETE /api/downloads/:id - Cancel and remove a job
downloadsRouter.delete('/api/downloads/:id', (req: Request, res: Response): void => {
  const jobId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const ok = downloadManager.cancelJob(jobId);
  res.json({ success: ok, message: ok ? 'Job cancelled' : 'Job not found' });
});

// POST /api/downloads/clear-completed - Clear completed and cancelled jobs from list
downloadsRouter.post('/api/downloads/clear-completed', (_req: Request, res: Response): void => {
  downloadManager.clearCompleted();
  res.json({ success: true, message: 'Cleared completed jobs' });
});

// GET /api/downloads/file/:mangaId/:chapterNum - Stream/download the generated CBZ archive
downloadsRouter.get('/api/downloads/file/:mangaId/:chapterNum', (req: Request, res: Response): void => {
  const mangaId = Array.isArray(req.params.mangaId) ? req.params.mangaId[0] : req.params.mangaId;
  const rawNum = Array.isArray(req.params.chapterNum) ? req.params.chapterNum[0] : req.params.chapterNum;
  const num = parseFloat(rawNum);
  if (isNaN(num)) {
    res.status(400).json({ error: 'Invalid chapter number' });
    return;
  }

  const filePath = downloadManager.getDownloadedFilePath(mangaId, num);
  if (!filePath || !fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Downloaded chapter CBZ archive not found on server' });
    return;
  }

  const fileName = path.basename(filePath);
  res.download(filePath, fileName);
});
