import React from 'react';
import { MangaItem, hasWorkingReaderSource } from '../types';

import { BookOpen, Play, CheckCircle, Clock, Zap, Download, Sparkles, Layers } from 'lucide-react';

interface ReaderHubViewProps {
  mangaList: MangaItem[];
  onOpenReader: (manga: MangaItem, chapterNumber?: number) => void;
  onOpenChapters: (manga: MangaItem) => void;
  onSelectManga: (manga: MangaItem) => void;
}

export const ReaderHubView: React.FC<ReaderHubViewProps> = ({
  mangaList,
  onOpenReader,
  onOpenChapters,
  onSelectManga,
}) => {
  const readingList = mangaList.filter((m) => m.status === 'reading' && hasWorkingReaderSource(m));


  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-red-500/10 border border-amber-500/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-amber-500 text-slate-950">
              READER HUB
            </span>
            <span className="text-xs text-slate-400 font-mono">
              {readingList.length} Active Series Reading
            </span>
          </div>
          <h2 className="text-xl font-black text-slate-100">Direct Reading & Scanlation Center</h2>
          <p className="text-xs text-slate-400">
            Click any series title or cover to launch details, view chapters, or read instantly.
          </p>
        </div>

        {readingList.length > 0 && (
          <button
            onClick={() => onOpenReader(readingList[0], readingList[0].currentChapter + 1)}
            className="px-5 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black text-xs flex items-center gap-2 shadow-lg shadow-amber-500/20 transition-all hover:scale-105"
          >
            <Play className="w-4 h-4 fill-slate-950" />
            <span>Continue {readingList[0].title} (Ch. {readingList[0].currentChapter + 1})</span>
          </button>
        )}
      </div>

      {/* Currently Reading Cards Grid */}
      <div className="space-y-3">
        <h3 className="text-sm font-extrabold text-slate-200 flex items-center justify-between">
          <span className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-amber-400" />
            Continue Reading List ({readingList.length})
          </span>
          <span className="text-xs text-slate-400 font-normal">
            Sorted by reading status
          </span>
        </h3>

        {readingList.length === 0 ? (
          <div className="p-8 text-center bg-slate-900/50 border border-slate-800 rounded-2xl space-y-2">
            <BookOpen className="w-8 h-8 text-slate-600 mx-auto" />
            <div className="text-sm font-bold text-slate-300">No active reading series</div>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Add series to your library or mark series as "Reading" to see them in the Reader Hub.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {readingList.map((manga) => {
              const hasNewCh = manga.latestChapter > manga.currentChapter;
              const sourceLabel = manga.syncedFromApi || manga.sourceName || 'Scanlation';
              return (
                <div
                  key={manga.id}
                  className="bg-slate-900 border border-slate-800 hover:border-amber-500/50 rounded-2xl p-4 flex gap-4 transition-all shadow-md group"
                >
                  <img
                    src={manga.coverImage}
                    alt={manga.title}
                    loading="lazy"
                    onClick={() => onSelectManga(manga)}
                    className="w-20 h-28 object-cover rounded-xl bg-slate-950 border border-slate-800 group-hover:scale-105 transition-transform cursor-pointer"
                    title="Click to view details"
                  />

                  <div className="flex-1 flex flex-col justify-between min-w-0">
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="px-2 py-0.2 rounded text-[10px] font-bold uppercase bg-amber-500/10 text-amber-400 border border-amber-500/20">
                          {manga.type === 'manhwa' ? '🇰🇷 Manhwa' : manga.type === 'manhua' ? '🇨🇳 Manhua' : '🇯🇵 Manga'}
                        </span>
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 truncate max-w-[100px]">
                          {sourceLabel}
                        </span>
                        {hasNewCh && (
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-orange-500 text-slate-950 animate-pulse">
                            +{manga.latestChapter - manga.currentChapter} New
                          </span>
                        )}
                      </div>

                      <h4
                        onClick={() => onSelectManga(manga)}
                        className="text-sm font-bold text-slate-100 truncate hover:text-amber-400 cursor-pointer transition-colors"
                        title="Click to view details"
                      >
                        {manga.title}
                      </h4>

                      <p className="text-xs text-slate-400">
                        Progress: <strong className="text-amber-300">Ch. {manga.currentChapter}</strong> / {manga.latestChapter}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 pt-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenReader(manga, manga.currentChapter + 1);
                        }}
                        className="flex-1 py-1.5 px-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-1 shadow-md transition-all hover:scale-102"
                      >
                        <Play className="w-3.5 h-3.5 fill-slate-950" />
                        <span>Read Ch. {manga.currentChapter + 1}</span>
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenChapters(manga);
                        }}
                        className="py-1.5 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs transition-colors"
                      >
                        Chapters
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
