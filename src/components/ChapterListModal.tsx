import React, { useState, useEffect } from 'react';
import { MangaItem, ChapterInfo, hasWorkingReaderSource } from '../types';


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

  const fetchChapters = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/reader/chapters/${manga.id}?order=${sortOrder}`);
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
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full overflow-hidden shadow-2xl flex flex-col max-h-[85vh] my-8">
        {/* Header */}
        <div className="p-5 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 border-b border-slate-800 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img
              src={manga.coverImage}
              alt={manga.title}
              className="w-12 h-16 rounded-lg object-cover bg-slate-950 border border-slate-800"
            />
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  {manga.type === 'manhwa' ? '🇰🇷 Manhwa' : '🇨🇳 Manhua'}
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  Current Read: Ch. {manga.currentChapter}
                </span>
              </div>
              <h2 className="text-lg font-black text-slate-100 line-clamp-1">{manga.title}</h2>
              <p className="text-xs text-slate-400">
                Source: <span className="text-amber-300 font-semibold">{manga.sourceName || 'Scanlation Sites'}</span>
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-full bg-slate-800/80 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick Launch Continue Reading Banner */}
        {hasWorkingReaderSource(manga) ? (
          <div className="p-4 bg-slate-950/70 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs">
              <Zap className="w-4 h-4 text-amber-400" />
              <span className="text-slate-300 font-semibold">Ready to continue reading?</span>
            </div>

            <button
              onClick={() => {
                onClose();
                onOpenReader(manga.currentChapter + 1);
              }}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-bold text-xs flex items-center gap-2 shadow-lg shadow-amber-500/10 transition-all"
            >
              <Play className="w-3.5 h-3.5 fill-slate-950" />
              <span>Read Chapter {manga.currentChapter + 1}</span>
            </button>
          </div>
        ) : (
          <div className="p-3.5 bg-slate-950/70 border-b border-slate-800/80 text-xs text-slate-400 flex items-center justify-between">
            <span>ℹ️ Reader unavailable for this source (Information & Metadata mode).</span>
            {manga.sourceUrl && (
              <a href={manga.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-amber-400 hover:underline flex items-center gap-1 font-semibold">
                <span>View on External Source</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        )}

        {/* Search & Filter Bar */}
        <div className="p-4 bg-slate-900 border-b border-slate-800/80 flex items-center justify-between gap-3 text-xs">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search chapter number or title..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
            />
          </div>

          <button
            onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 font-semibold hover:text-white transition-all"
          >
            <ArrowUpDown className="w-3.5 h-3.5 text-amber-400" />
            <span>{sortOrder === 'desc' ? 'Newest First' : 'Oldest First'}</span>
          </button>
        </div>

        {/* Chapter List Items */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading ? (
            <div className="py-12 text-center text-slate-400 space-y-2">
              <RefreshCw className="w-6 h-6 animate-spin text-amber-400 mx-auto" />
              <p className="text-xs font-semibold">Loading scanlation feeds & chapters...</p>
            </div>
          ) : filteredChapters.length === 0 ? (
            <div className="py-12 text-center text-slate-400 space-y-1">
              <p className="text-sm font-bold text-slate-300">No chapters found</p>
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
                      ? 'bg-slate-950/60 border-slate-800/60 opacity-80'
                      : 'bg-slate-800/50 hover:bg-slate-800 border-slate-700/80 shadow-sm'
                  }`}
                >
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        onClick={() => {
                          onClose();
                          onOpenReader(ch.chapterNumber, ch.id);
                        }}
                        className="font-bold text-sm text-slate-100 hover:text-amber-400 cursor-pointer transition-colors"
                      >
                        {ch.title}
                      </span>
                      {isRead && (
                        <span className="px-2 py-0.2 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                          <CheckCircle className="w-3 h-3" />
                          Read
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-slate-400">
                      <span>Group: <strong className="text-slate-300">{ch.scanGroup}</strong></span>
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
                        className="px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1 transition-all shadow-md"
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
