import React from 'react';
import { MangaItem } from '../types';
import { isReaderAvailable } from '../utils/catalog';
import { Star, Play, BookOpen } from 'lucide-react';

interface Props {
  manga: MangaItem[];
  onSelectManga: (m: MangaItem) => void;
  onOpenReader: (m: MangaItem, chapterNumber?: number) => void;
  onOpenChapters: (m: MangaItem) => void;
}

export const BrowseGridView: React.FC<Props> = ({ manga, onSelectManga, onOpenReader, onOpenChapters }) => (
  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-3 sm:gap-4 md:gap-5">
    {manga.map((m) => {
      const sourceLabel =
        m.availableSources && m.availableSources.length > 1
          ? `${m.availableSources.length} Sources`
          : m.sourceName || 'Kotatsu Source';
      const sourceTitle = m.availableSources?.map((s) => s.sourceName).join(' • ') || m.sourceName;
      return (
        <div
          key={m.id}
          className="bg-surface border border-edge hover:border-accent/40 rounded-2xl overflow-hidden shadow-lg flex flex-col justify-between transition-all group"
        >
          <div>
            <div
              onClick={() => onSelectManga(m)}
              className="relative aspect-[3/4] w-full overflow-hidden bg-app cursor-pointer"
            >
              <img
                src={m.coverImage}
                alt={m.title}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent" />
              <span
                className={`absolute top-2 left-2 px-2 py-0.5 rounded-lg text-[10px] font-black uppercase backdrop-blur-md ${
                  m.type === 'manhwa'
                    ? 'bg-blue-950/90 text-info border border-info/40'
                    : m.type === 'manhua'
                    ? 'bg-red-950/90 text-danger border border-danger/40'
                    : 'bg-emerald-950/90 text-success border border-success/40'
                }`}
              >
                {m.type}
              </span>
              <span className="absolute top-2 right-2 px-2 py-0.5 rounded-lg text-[10px] font-bold bg-app/90 text-accent border border-edge flex items-center gap-1">
                <Star className="w-3 h-3 fill-accent" />
                <span>{m.rating}</span>
              </span>
            </div>

            <div className="p-3.5 space-y-1.5">
              <h4
                onClick={() => onSelectManga(m)}
                className="text-xs font-bold text-primary truncate cursor-pointer group-hover:text-accent transition-colors"
              >
                {m.title}
              </h4>
              <div className="flex items-center justify-between text-[11px] text-secondary">
                <span>Ch. {m.currentChapter} / {m.latestChapter}</span>
                <span className="text-accent/90 font-mono font-semibold text-[10px] truncate max-w-[120px]" title={sourceTitle}>
                  {sourceLabel}
                </span>
              </div>
            </div>
          </div>

          <div className="p-3 pt-0 flex items-center gap-1.5">
            {isReaderAvailable(m) ? (
              <button
                onClick={() => onOpenReader(m)}
                className="flex-1 py-2 rounded-xl bg-gradient-to-r from-accent to-accent-2 hover:from-accent-bright hover:to-accent-2 text-accent-fg font-black text-xs flex items-center justify-center gap-1 shadow-md transition-all"
              >
                <Play className="w-3 h-3 fill-accent-fg" />
                <span>Read</span>
              </button>
            ) : (
              <button
                onClick={() => onSelectManga(m)}
                className="flex-1 py-2 rounded-xl bg-elevated hover:bg-elevated text-primary font-bold text-xs flex items-center justify-center gap-1 border border-edge-strong transition-all"
              >
                <BookOpen className="w-3 h-3 text-accent" />
                <span>View Info</span>
              </button>
            )}
            <button
              onClick={() => onOpenChapters(m)}
              className="p-2 rounded-xl bg-elevated hover:bg-elevated text-secondary text-xs font-bold border border-edge-strong"
              title="View Chapters List"
            >
              <BookOpen className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      );
    })}
  </div>
);
