import React, { useState, useEffect, useRef, useMemo } from 'react';
import { apiFetch } from '../utils/api';
import {
  X,
  Download,
  Pause,
  Play,
  Trash2,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Clock,
  HardDrive,
  FileArchive,
  BookOpen,
  Sparkles,
  ExternalLink,
  ChevronRight,
} from 'lucide-react';
import { MangaItem } from '../types';

export interface DownloadJob {
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

interface DownloadManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenReader?: (manga: MangaItem, chapterNumber: number) => void;
  mangaList?: MangaItem[];
}

export const DownloadManagerModal: React.FC<DownloadManagerModalProps> = ({
  isOpen,
  onClose,
  onOpenReader,
  mangaList = [],
}) => {
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [activeTab, setActiveTab] = useState<'all' | 'active' | 'queued' | 'completed' | 'failed'>('all');
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchJobs = async () => {
    try {
      const res = await apiFetch('/api/downloads/queue');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.jobs)) {
          setJobs(data.jobs);
        }
      }
    } catch {
      // ignore status polling errors
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchJobs();
      pollTimerRef.current = setInterval(fetchJobs, 1500);
    } else {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    }
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const activeCount = jobs.filter((j) => j.status === 'downloading' || j.status === 'packaging').length;
  const queuedCount = jobs.filter((j) => j.status === 'queued').length;
  const completedCount = jobs.filter((j) => j.status === 'completed').length;
  const failedCount = jobs.filter((j) => j.status === 'failed').length;

  const totalBytes = jobs
    .filter((j) => j.status === 'completed')
    .reduce((acc, j) => acc + (j.progress?.bytesDownloaded || 0), 0);

  const formatBytes = (bytes: number): string => {
    if (!bytes || bytes <= 0) return '0 MB';
    const mb = bytes / (1024 * 1024);
    if (mb >= 1024) {
      return `${(mb / 1024).toFixed(2)} GB`;
    }
    return `${mb.toFixed(1)} MB`;
  };

  const filteredJobs = useMemo(() => {
    switch (activeTab) {
      case 'active':
        return jobs.filter((j) => j.status === 'downloading' || j.status === 'packaging');
      case 'queued':
        return jobs.filter((j) => j.status === 'queued' || j.status === 'paused');
      case 'completed':
        return jobs.filter((j) => j.status === 'completed');
      case 'failed':
        return jobs.filter((j) => j.status === 'failed');
      default:
        return jobs;
    }
  }, [jobs, activeTab]);

  const handlePauseJob = async (jobId: string) => {
    await apiFetch(`/api/downloads/${jobId}/pause`, { method: 'POST' });
    fetchJobs();
  };

  const handleResumeJob = async (jobId: string) => {
    await apiFetch(`/api/downloads/${jobId}/resume`, { method: 'POST' });
    fetchJobs();
  };

  const handleCancelJob = async (jobId: string) => {
    await apiFetch(`/api/downloads/${jobId}`, { method: 'DELETE' });
    fetchJobs();
  };

  const handleClearCompleted = async () => {
    await apiFetch('/api/downloads/clear-completed', { method: 'POST' });
    fetchJobs();
  };

  const handleRetryJob = async (job: DownloadJob) => {
    await apiFetch('/api/downloads/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mangaId: job.mangaId,
        chapterNumber: job.chapterNumber,
        sourceUrl: job.sourceUrl,
        sourceName: job.sourceName,
        priority: true,
      }),
    });
    fetchJobs();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="bg-surface border border-edge rounded-3xl w-full max-w-4xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-edge bg-app/50">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-accent/15 text-accent border border-accent/25 relative">
              <Download className="w-5 h-5" />
              {activeCount > 0 && (
                <span className="absolute -top-1 -right-1 w-3 h-3 bg-accent rounded-full animate-ping" />
              )}
            </div>
            <div>
              <h3 className="text-base font-black text-primary flex items-center gap-2">
                Download Manager & Offline CBZ Vault
                {activeCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-accent/20 text-accent border border-accent/30 flex items-center gap-1">
                    <RefreshCw className="w-3 h-3 animate-spin" /> {activeCount} Active
                  </span>
                )}
              </h3>
              <p className="text-xs text-secondary">
                Download chapters into standardized ComicInfo.xml-tagged .cbz archives for 100% offline reading.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {completedCount > 0 && (
              <button
                type="button"
                onClick={handleClearCompleted}
                className="px-3 py-1.5 rounded-xl bg-elevated hover:bg-surface text-secondary hover:text-primary text-xs font-bold border border-edge transition-all flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear Finished</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-muted hover:text-primary hover:bg-elevated transition-all"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 bg-app/30 border-b border-edge text-xs">
          <div className="p-3 bg-surface border border-edge rounded-2xl flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-500/10 text-blue-400">
              <RefreshCw className={`w-4 h-4 ${activeCount > 0 ? 'animate-spin' : ''}`} />
            </div>
            <div>
              <span className="text-[10px] font-bold text-muted block uppercase">Active / Queued</span>
              <span className="text-sm font-black text-primary">{activeCount} / {queuedCount}</span>
            </div>
          </div>

          <div className="p-3 bg-surface border border-edge rounded-2xl flex items-center gap-3">
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <div>
              <span className="text-[10px] font-bold text-muted block uppercase">Completed</span>
              <span className="text-sm font-black text-primary">{completedCount}</span>
            </div>
          </div>

          <div className="p-3 bg-surface border border-edge rounded-2xl flex items-center gap-3">
            <div className="p-2 rounded-xl bg-rose-500/10 text-rose-400">
              <AlertCircle className="w-4 h-4" />
            </div>
            <div>
              <span className="text-[10px] font-bold text-muted block uppercase">Failed</span>
              <span className="text-sm font-black text-primary">{failedCount}</span>
            </div>
          </div>

          <div className="p-3 bg-surface border border-edge rounded-2xl flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400">
              <HardDrive className="w-4 h-4" />
            </div>
            <div>
              <span className="text-[10px] font-bold text-muted block uppercase">Vault Storage</span>
              <span className="text-sm font-black text-primary">{formatBytes(totalBytes)}</span>
            </div>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex border-b border-edge bg-app/20 px-6 pt-3 gap-2">
          {[
            { id: 'all', label: `All (${jobs.length})` },
            { id: 'active', label: `Active (${activeCount})` },
            { id: 'queued', label: `Queued (${queuedCount})` },
            { id: 'completed', label: `Completed (${completedCount})` },
            { id: 'failed', label: `Failed (${failedCount})` },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`pb-2.5 px-3 font-bold text-xs flex items-center gap-1.5 border-b-2 transition-all ${
                activeTab === tab.id
                  ? 'border-accent text-accent'
                  : 'border-transparent text-secondary hover:text-primary'
              }`}
            >
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Jobs List */}
        <div className="p-6 overflow-y-auto flex-1 custom-scrollbar space-y-3">
          {filteredJobs.length === 0 ? (
            <div className="py-16 text-center text-secondary space-y-3">
              <div className="w-14 h-14 mx-auto rounded-3xl bg-elevated flex items-center justify-center text-muted">
                <FileArchive className="w-7 h-7 opacity-50" />
              </div>
              <div>
                <p className="font-bold text-primary text-sm">No download jobs in this view</p>
                <p className="text-xs text-muted max-w-sm mx-auto mt-1">
                  You can download individual chapters or batch download entire series from any chapter list.
                </p>
              </div>
            </div>
          ) : (
            filteredJobs.map((job) => {
              const matchedManga = mangaList.find((m) => m.id === job.mangaId);
              return (
                <div
                  key={job.id}
                  className="p-4 rounded-2xl bg-app/50 border border-edge hover:border-edge-strong transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
                >
                  <div className="flex items-start gap-3.5 flex-1 min-w-0">
                    <div className="w-10 h-14 rounded-xl bg-surface border border-edge shrink-0 overflow-hidden flex items-center justify-center">
                      {matchedManga?.coverImage ? (
                        <img
                          src={matchedManga.coverImage}
                          alt={job.mangaTitle}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <FileArchive className="w-5 h-5 text-muted" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-bold text-primary text-sm truncate max-w-md">
                          {job.mangaTitle}
                        </h4>
                        <span className="px-2 py-0.5 rounded-md bg-accent/15 text-accent text-[11px] font-black">
                          Ch. {job.chapterNumber}
                        </span>
                        {job.sourceName && (
                          <span className="px-1.5 py-0.5 rounded bg-surface text-secondary text-[10px] font-medium border border-edge">
                            {job.sourceName}
                          </span>
                        )}
                      </div>

                      {/* Status & Progress info */}
                      <div className="flex items-center gap-3 text-xs text-secondary">
                        {job.status === 'downloading' && (
                          <span className="text-accent font-semibold flex items-center gap-1">
                            <RefreshCw className="w-3 h-3 animate-spin" />
                            Downloading page {job.progress.current} / {job.progress.total || '?'} ({job.progress.percent}%)
                          </span>
                        )}
                        {job.status === 'packaging' && (
                          <span className="text-amber-400 font-semibold flex items-center gap-1">
                            <Sparkles className="w-3 h-3 animate-pulse" />
                            Injecting ComicInfo.xml & Packaging CBZ...
                          </span>
                        )}
                        {job.status === 'queued' && (
                          <span className="text-muted flex items-center gap-1">
                            <Clock className="w-3 h-3" /> Queued in rate-limited queue
                          </span>
                        )}
                        {job.status === 'paused' && (
                          <span className="text-amber-400 font-semibold flex items-center gap-1">
                            <Pause className="w-3 h-3" /> Paused
                          </span>
                        )}
                        {job.status === 'completed' && (
                          <span className="text-emerald-400 font-semibold flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Completed ({formatBytes(job.progress.bytesDownloaded)}, {job.progress.total} pages)
                          </span>
                        )}
                        {job.status === 'failed' && (
                          <span className="text-rose-400 font-semibold flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" /> Failed: {job.error || 'Unknown error'}
                          </span>
                        )}
                      </div>

                      {/* Progress Bar for Active Jobs */}
                      {(job.status === 'downloading' || job.status === 'packaging') && (
                        <div className="w-full bg-surface rounded-full h-1.5 overflow-hidden border border-edge mt-1.5">
                          <div
                            className="bg-gradient-to-r from-accent to-accent-bright h-full transition-all duration-300 rounded-full"
                            style={{ width: `${job.progress.percent}%` }}
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                    {job.status === 'completed' && (
                      <>
                        <a
                          href={`/api/downloads/file/${job.mangaId}/${job.chapterNumber}`}
                          download
                          className="px-3 py-1.5 rounded-xl bg-accent/15 hover:bg-accent/25 text-accent border border-accent/30 text-xs font-bold transition-all flex items-center gap-1"
                          title="Save CBZ file to your device"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Save CBZ</span>
                        </a>

                        {matchedManga && onOpenReader && (
                          <button
                            type="button"
                            onClick={() => {
                              onClose();
                              onOpenReader(matchedManga, job.chapterNumber);
                            }}
                            className="px-3 py-1.5 rounded-xl bg-elevated hover:bg-surface text-primary text-xs font-bold border border-edge transition-all flex items-center gap-1"
                          >
                            <BookOpen className="w-3.5 h-3.5 text-accent" />
                            <span>Read</span>
                          </button>
                        )}
                      </>
                    )}

                    {job.status === 'queued' && (
                      <button
                        type="button"
                        onClick={() => handlePauseJob(job.id)}
                        className="p-2 rounded-xl bg-elevated hover:bg-surface text-secondary hover:text-primary transition-all"
                        title="Pause job"
                      >
                        <Pause className="w-4 h-4" />
                      </button>
                    )}

                    {job.status === 'paused' && (
                      <button
                        type="button"
                        onClick={() => handleResumeJob(job.id)}
                        className="p-2 rounded-xl bg-accent/20 text-accent hover:bg-accent/30 transition-all"
                        title="Resume job"
                      >
                        <Play className="w-4 h-4" />
                      </button>
                    )}

                    {job.status === 'failed' && (
                      <button
                        type="button"
                        onClick={() => handleRetryJob(job)}
                        className="px-3 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 text-xs font-bold transition-all flex items-center gap-1"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Retry</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleCancelJob(job.id)}
                      className="p-2 rounded-xl text-muted hover:text-danger hover:bg-danger/10 transition-all"
                      title="Cancel / remove job"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
