import React, { useState, useEffect } from 'react';
import { apiFetch } from '../utils/api';
import { MangaItem, ChapterInfo, hasWorkingReaderSource } from '../types';
import { bulkDownloadSeries, getOfflineStorageUsage } from '../utils/offlineStorage';


import {
  X,
  Search,
  BookOpen,
  CheckCircle,
  ExternalLink,
  ArrowUpDown,
  Play,
  RefreshCw,
  Globe,
  Zap,
  Download,
  Loader2,
  HardDrive,
} from 'lucide-react';

interface ChapterListModalProps {
  manga: MangaItem;
  onClose: () => void;
  onOpenReader: (chapterNumber: number, chapterId?: string) => void;
  onMarkRead: (chapterNumber: number) => void;
}

export const ChapterListModal: React.FC<ChapterListModalProps> = ({
  manga,
  onClose,
  onOpenReader,
  onMarkRead,
}) => {
  const [chapters, setChapters] = useState<ChapterInfo[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [isDownloadingAll, setIsDownloadingAll] = useState<boolean>(false);
  const [downloadStatus, setDownloadStatus] = useState({ done: 0, total: 0 });
  const [downloadSummary, setDownloadSummary] = useState<string>('');
  const [storageUsage, setStorageUsage] = useState<{ totalBytes: number; chapterCount: number }>({ totalBytes: 0, chapterCount: 0 });

  const refreshStorageUsage = async () => {
    const usage = await getOfflineStorageUsage();
    setStorageUsage({ totalBytes: usage.totalBytes, chapterCount: usage.chapterCount });
  };

  const handleDownloadAll = async () => {
    if (!manga.id || chapters.length === 0 || isDownloadingAll) return;
    setIsDownloadingAll(true);
    setDownloadSummary('');
    setDownloadStatus({ done: 0, total: chapters.length });
    try {
      const result = await bulkDownloadSeries({
        mangaId: manga.id,
        mangaTitle: manga.title,
        chapterNumbers: chapters.map((c) => c.chapterNumber),
        fetchChapterPages: async (chNum) => {
          const res = await apiFetch(`/api/reader/chapter-pages?mangaId=${encodeURIComponent(manga.id)}&chapterNumber=${chNum}${manga.sourceUrl ? `&url=${encodeURIComponent(manga.sourceUrl)}` : ''}${manga.title ? `&title=${encodeURIComponent(manga.title)}` : ''}`);
          if (!res.ok) return [];
          const data = await res.json();
          return Array.isArray(data.pages) ? data.pages : [];
        },
        onChapterComplete: (done, total) => setDownloadStatus({ done, total }),
      });
      setDownloadSummary(
        result.downloaded > 0
          ? `Saved ${result.downloaded}/${chapters.length} chapters offline.${result.failed ? ` ${result.failed} failed.` : ''}`
          : 'No chapters could be downloaded.'
      );
    } catch (err) {
      console.error('[ChapterListModal] Bulk download error:', err);
      setDownloadSummary('Bulk download failed.');
    } finally {
      setIsDownloadingAll(false);
      await refreshStorageUsage();
    }
  };

  useEffect(() => {
    refreshStorageUsage();
  }, []);

  const fetchChapters = async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/reader/chapters/${encodeURIComponent(manga.id)}?order=${sortOrder}${manga.sourceUrl ? `&url=${encodeURIComponent(manga.sourceUrl)}` : ''}`);
      if (res.ok) {
        const data = await res.json();
        setChapters(data);
      }
    } catch (err) {
      console.error("Fetch chapters error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchChapters();
  }, [manga.id, sortOrder]);

  const filteredChapters = chapters.filter((ch) => {
    if (!searchFilter) return true;
    const q = searchFilter.toLowerCase();
    return (
      ch.title.toLowerCase().includes(q) ||
      ch.chapterNumber.toString().includes(q) ||
      ch.scanGroup.toLowerCase().includes(q)
    );
  });

  return (
    <div className="fixed inset-0 z-50 bg-app/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-surface border border-edge rounded-2xl max-w-2xl w-full overflow-hidden shadow-2xl flex flex-col max-h-[85vh] my-8">
        {/* Header */}
        <div className="p-5 bg-gradient-to-r from-app via-surface to-app border-b border-edge flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img
              src={manga.coverImage}
              alt={manga.title}
              className="w-12 h-16 rounded-lg object-cover bg-app border border-edge"
            />
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-accent/10 text-accent border border-accent/20">
                  {manga.type === 'manhwa' ? '🇰🇷 Manhwa' : '🇨🇳 Manhua'}
                </span>
                <span className="text-xs text-secondary font-mono">
                  Current Read: Ch. {manga.currentChapter}
                </span>
              </div>
              <h2 className="text-lg font-black text-primary line-clamp-1">{manga.title}</h2>
              <p className="text-xs text-secondary">
                Source: <span className="text-accent font-semibold">{manga.sourceName || 'Scanlation Sites'}</span>
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-full bg-elevated/80 text-secondary hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick Launch Continue Reading Banner */}
        {hasWorkingReaderSource(manga) ? (
          <div className="p-4 bg-app/70 border-b border-edge/80 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2 text-xs">
                <Zap className="w-4 h-4 text-accent" />
                <span className="text-secondary font-semibold">Ready to continue reading?</span>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-secondary/80">
                <HardDrive className="w-3 h-3 text-accent" />
                <span>Offline storage: {(storageUsage.totalBytes / 1048576).toFixed(1)} MB · {storageUsage.chapterCount} chapters</span>
                {downloadSummary && <span className="text-accent font-semibold">· {downloadSummary}</span>}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleDownloadAll}
                disabled={isDownloadingAll || chapters.length === 0}
                className="px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-xl bg-elevated border border-edge-strong/60 hover:bg-elevated/80 text-secondary font-bold text-xs sm:text-sm flex items-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isDownloadingAll ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
                ) : (
                  <Download className="w-3.5 h-3.5 text-accent" />
                )}
                <span>
                  {isDownloadingAll
                    ? `Downloading ${downloadStatus.done}/${downloadStatus.total}...`
                    : `Download All (${chapters.length})`}
                </span>
              </button>

              <button
                onClick={() => {
                  onClose();
                  onOpenReader(manga.currentChapter + 1);
                }}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-accent to-accent-2 hover:from-accent-bright hover:to-accent-2 text-accent-fg font-bold text-xs flex items-center gap-2 shadow-lg shadow-accent/10 transition-all"
              >
                <Play className="w-3.5 h-3.5 fill-accent-fg" />
                <span>Read Chapter {manga.currentChapter + 1}</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="p-3.5 bg-app/70 border-b border-edge/80 text-xs text-secondary flex items-center justify-between">
            <span>ℹ️ Reader unavailable for this source (Information & Metadata mode).</span>
            {manga.sourceUrl && (
              <a href={manga.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline flex items-center gap-1 font-semibold">
                <span>View on External Source</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        )}

        {/* Search & Filter Bar */}
        <div className="p-4 bg-surface border-b border-edge/80 flex items-center justify-between gap-3 text-xs">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
            <input
              type="text"
              placeholder="Search chapter number or title..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="w-full bg-app border border-edge rounded-lg pl-8 pr-3 py-1.5 text-primary placeholder-muted focus:outline-none focus:ring-1 focus:ring-accent/50"
            />
          </div>

          <button
            onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-elevated text-secondary font-semibold hover:text-white transition-all"
          >
            <ArrowUpDown className="w-3.5 h-3.5 text-accent" />
            <span>{sortOrder === 'desc' ? 'Newest First' : 'Oldest First'}</span>
          </button>
        </div>

        {/* Chapter List Items */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading ? (
            <div className="py-12 text-center text-secondary space-y-2">
              <RefreshCw className="w-6 h-6 animate-spin text-accent mx-auto" />
              <p className="text-xs font-semibold">Loading scanlation feeds & chapters...</p>
            </div>
          ) : filteredChapters.length === 0 ? (
            <div className="py-12 text-center text-secondary space-y-1">
              <p className="text-sm font-bold text-secondary">No chapters found</p>
              <p className="text-xs">Try adjusting your search filter.</p>
            </div>
          ) : (
            filteredChapters.map((ch) => {
              const isRead = ch.chapterNumber <= manga.currentChapter;
              return (
                <div
                  key={ch.id}
                  className={`p-3 rounded-xl border flex items-center justify-between gap-3 transition-all ${
                    isRead
                      ? 'bg-app/60 border-edge/60 opacity-80'
                      : 'bg-elevated/50 hover:bg-elevated border-edge-strong/80 shadow-sm'
                  }`}
                >
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        onClick={() => {
                          onClose();
                          onOpenReader(ch.chapterNumber, ch.id);
                        }}
                        className="font-bold text-sm text-primary hover:text-accent cursor-pointer transition-colors"
                      >
                        {ch.title}
                      </span>
                      {isRead && (
                        <span className="px-2 py-0.2 rounded text-[10px] font-bold bg-success/10 text-success border border-success/20 flex items-center gap-1">
                          <CheckCircle className="w-3 h-3" />
                          Read
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-secondary">
                      <span>Group: <strong className="text-secondary">{ch.scanGroup}</strong></span>
                      <span>•</span>
                      <span>{ch.releaseDate}</span>
                      <span>•</span>
                      <span>{ch.pageCount} Pages</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {hasWorkingReaderSource(manga) && (
                      <button
                        onClick={() => {
                          onClose();
                          onOpenReader(ch.chapterNumber, ch.id);
                        }}
                        className="px-3.5 py-1.5 rounded-lg bg-accent hover:bg-accent-bright text-accent-fg font-bold text-xs flex items-center gap-1 transition-all shadow-md"
                      >
                        <BookOpen className="w-3.5 h-3.5" />
                        <span>Read</span>
                      </button>
                    )}
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
