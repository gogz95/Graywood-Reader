import React, { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../utils/api';
import {
  X,
  Play,
  Square,
  RefreshCw,
  Database,
  Layers,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Clock,
  BookOpen,
} from 'lucide-react';

interface BulkScrapeProgress {
  status: 'idle' | 'running' | 'completed' | 'stopped' | 'error';
  totalSources: number;
  completedSources: number;
  currentSourceId: string | null;
  currentSourceName: string | null;
  currentPage: number;
  maxPagesPerSource: number;
  seriesScraped: number;
  seriesMerged: number;
  seriesNew: number;
  errors: string[];
  startedAt: number | null;
  finishedAt: number | null;
}

interface BulkScrapeModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialSourceId?: string;
  sourceList?: { id: string; name: string }[];
}

export const BulkScrapeModal: React.FC<BulkScrapeModalProps> = ({
  isOpen,
  onClose,
  initialSourceId,
  sourceList = [],
}) => {
  const [targetScope, setTargetScope] = useState<'all' | 'single'>(initialSourceId ? 'single' : 'all');
  const [selectedSourceId, setSelectedSourceId] = useState<string>(initialSourceId || '');
  const [enrichMetadata, setEnrichMetadata] = useState<boolean>(true);
  const [progress, setProgress] = useState<BulkScrapeProgress | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = async () => {
    try {
      const res = await apiFetch('/api/sources/bulk-scrape/status');
      if (res.ok) {
        const data = (await res.json()) as BulkScrapeProgress;
        if (data && typeof data === 'object') {
          setProgress(data);
          if (data.status !== 'running' && pollTimerRef.current) {
            clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
          }
        }
      }
    } catch {
      // ignore status polling errors
    }
  };

  const [localSources, setLocalSources] = useState<{ id: string; name: string }[]>(sourceList);

  useEffect(() => {
    if (sourceList && sourceList.length > 0) {
      setLocalSources(sourceList);
    } else if (isOpen) {
      apiFetch('/api/kotatsu/sources')
        .then((r) => (r.ok ? r.json() : []))
        .then((list: any[]) => {
          if (Array.isArray(list) && list.length > 0) {
            setLocalSources(list.filter((s) => s.isEnabled !== false).map((s) => ({ id: s.id, name: s.name })));
          }
        })
        .catch(() => {});
    }
  }, [sourceList, isOpen]);

  useEffect(() => {
    if (isOpen) {
      fetchStatus();
      pollTimerRef.current = setInterval(fetchStatus, 1000);
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

  const isRunning = progress?.status === 'running';

  const handleStart = async () => {
    setIsStarting(true);
    try {
      const sourceIds = targetScope === 'single' && selectedSourceId ? [selectedSourceId] : undefined;
      const res = await apiFetch('/api/sources/bulk-scrape/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceIds,
          enrichMetadata,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.progress) {
          setProgress(data.progress);
        }
      }
      if (!pollTimerRef.current) {
        pollTimerRef.current = setInterval(fetchStatus, 1000);
      }
    } catch (err: any) {
      alert(`Failed to start bulk scraper: ${err.message}`);
    } finally {
      setIsStarting(false);
    }
  };

  const handleStop = async () => {
    try {
      const res = await apiFetch('/api/sources/bulk-scrape/stop', {
        method: 'POST',
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.progress) setProgress(data.progress);
      }
    } catch (err: any) {
      alert(`Failed to stop bulk scraper: ${err.message}`);
    }
  };

  const totalSourcesCount = progress?.totalSources ?? 0;
  const completedSourcesCount = progress?.completedSources ?? 0;
  const percentComplete = totalSourcesCount > 0
    ? Math.round((completedSourcesCount / totalSourcesCount) * 100)
    : 0;

  const safeSourceList = Array.isArray(localSources) && localSources.length > 0
    ? localSources
    : (Array.isArray(sourceList) ? sourceList : []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="bg-surface border border-edge rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-edge bg-app/50">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-accent-2/15 text-accent-2 border border-accent-2/25">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-black text-primary flex items-center gap-2">
                Build Library from Sources
                {isRunning && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                    <RefreshCw className="w-3 h-3 animate-spin" /> In Progress
                  </span>
                )}
              </h3>
              <p className="text-xs text-secondary">
                Crawl multi-page catalogs across your enabled sources to populate and sync your library.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-muted hover:text-primary hover:bg-elevated transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 overflow-y-auto flex-1 custom-scrollbar">
          {/* Options (Disabled when running) */}
          {!isRunning && (
            <div className="space-y-4 bg-app/40 p-4 rounded-2xl border border-edge">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Target Scope */}
                <div>
                  <label className="block text-xs font-bold text-secondary mb-1.5">Scope</label>
                  <select
                    value={targetScope}
                    onChange={(e) => setTargetScope(e.target.value as any)}
                    className="w-full bg-elevated border border-edge rounded-xl px-3 py-2 text-xs font-bold text-primary focus:outline-none focus:ring-2 focus:ring-accent-2/50"
                  >
                    <option value="all">All Active Sources</option>
                    <option value="single">Single Source Only</option>
                  </select>
                </div>

                {/* Specific Source if single */}
                {targetScope === 'single' ? (
                  <div>
                    <label className="block text-xs font-bold text-secondary mb-1.5">Select Source</label>
                    <select
                      value={selectedSourceId}
                      onChange={(e) => setSelectedSourceId(e.target.value)}
                      className="w-full bg-elevated border border-edge rounded-xl px-3 py-2 text-xs font-bold text-primary focus:outline-none focus:ring-2 focus:ring-accent-2/50"
                    >
                      <option value="">Choose a source...</option>
                      {safeSourceList.map((s) => (
                        <option key={s?.id || String(s)} value={s?.id || String(s)}>
                          {s?.name || s?.id || String(s)}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="p-3 bg-elevated/40 border border-edge rounded-xl flex items-center gap-2.5">
                    <Sparkles className="w-4 h-4 text-accent-2 shrink-0" />
                    <p className="text-[11px] text-secondary leading-snug">
                      Dynamically crawls all pages until the catalog is exhausted.
                    </p>
                  </div>
                )}
              </div>

              {/* Checkboxes */}
              <div className="pt-2 border-t border-edge flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-primary">
                  <input
                    type="checkbox"
                    checked={enrichMetadata}
                    onChange={(e) => setEnrichMetadata(e.target.checked)}
                    className="rounded border-edge text-accent-2 focus:ring-accent-2"
                  />
                  <span>Enrich Metadata & Covers (MangaDex / AniList fallback)</span>
                </label>
              </div>
            </div>
          )}

          {/* Live Progress Bar & Stats */}
          {progress && progress.status && progress.status !== 'idle' && (
            <div className="space-y-4">
              <div className="bg-app border border-edge rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between text-xs font-bold text-secondary">
                  <span>
                    {progress.status === 'running'
                      ? `Scraping: ${progress.currentSourceName || 'Preparing...'} • Page ${progress.currentPage || 1} (Crawling available series...)`
                      : progress.status === 'completed'
                      ? 'Bulk Ingestion Complete!'
                      : progress.status === 'stopped'
                      ? 'Harvesting Paused'
                      : 'Error Encountered'}
                  </span>
                  <span className="text-primary font-black">{percentComplete}%</span>
                </div>

                <div className="w-full bg-elevated rounded-full h-2.5 overflow-hidden border border-edge">
                  <div
                    className={`h-full transition-all duration-300 rounded-full ${
                      progress.status === 'completed'
                        ? 'bg-emerald-500'
                        : progress.status === 'error'
                        ? 'bg-rose-500'
                        : 'bg-accent-2'
                    }`}
                    style={{ width: `${Math.min(100, Math.max(2, percentComplete))}%` }}
                  />
                </div>

                {/* Counters */}
                <div className="grid grid-cols-4 gap-2 pt-2 text-center">
                  <div className="p-2.5 rounded-xl bg-elevated/60 border border-edge">
                    <p className="text-[10px] text-muted font-bold uppercase">Sources</p>
                    <p className="text-sm font-black text-primary">
                      {progress.completedSources ?? 0} / {progress.totalSources ?? 0}
                    </p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-elevated/60 border border-edge">
                    <p className="text-[10px] text-muted font-bold uppercase">Found</p>
                    <p className="text-sm font-black text-accent-2">
                      {(progress.seriesScraped ?? 0).toLocaleString()}
                    </p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-elevated/60 border border-edge">
                    <p className="text-[10px] text-muted font-bold uppercase">Merged</p>
                    <p className="text-sm font-black text-purple-300">
                      {(progress.seriesMerged ?? 0).toLocaleString()}
                    </p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-elevated/60 border border-edge">
                    <p className="text-[10px] text-muted font-bold uppercase">New Added</p>
                    <p className="text-sm font-black text-emerald-400">
                      {(progress.seriesNew ?? 0).toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>

              {/* Error messages if any */}
              {Array.isArray(progress.errors) && progress.errors.length > 0 && (
                <div className="p-3 bg-rose-950/30 border border-rose-500/30 rounded-xl space-y-1 max-h-28 overflow-y-auto custom-scrollbar">
                  <p className="text-[11px] font-bold text-rose-400 flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5" /> Recent warnings
                  </p>
                  {progress.errors.slice(-5).map((e, idx) => (
                    <p key={idx} className="text-[10px] text-rose-300/80 font-mono">
                      {e}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between p-4 border-t border-edge bg-app/50">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-bold text-secondary hover:text-primary hover:bg-elevated transition-all"
          >
            Close
          </button>

          <div className="flex items-center gap-2">
            {isRunning ? (
              <button
                onClick={handleStop}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center gap-1.5 transition-all shadow-md"
              >
                <Square className="w-3.5 h-3.5" /> Stop Harvester
              </button>
            ) : (
              <button
                onClick={handleStart}
                disabled={isStarting || (targetScope === 'single' && !selectedSourceId)}
                className="px-5 py-2.5 rounded-xl bg-accent-2 hover:bg-accent-2/90 text-white font-bold text-xs flex items-center gap-2 transition-all shadow-lg shadow-accent-2/20 disabled:opacity-50"
              >
                <Play className="w-3.5 h-3.5" /> Start Bulk Ingestion
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
