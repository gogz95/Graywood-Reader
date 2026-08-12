import React from 'react';
import { MangaItem } from '../types';
import { isReaderAvailable } from '../utils/catalog';
import { Star } from 'lucide-react';

interface Props {
  manga: MangaItem[];
  onSelectManga: (m: MangaItem) => void;
  onOpenReader: (m: MangaItem, chapterNumber?: number) => void;
}

export const BrowseTableView: React.FC<Props> = ({ manga, onSelectManga, onOpenReader }) => (
  <div className="bg-surface border border-edge rounded-3xl overflow-hidden shadow-xl">
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse text-xs">
        <thead>
          <tr className="bg-app border-b border-edge text-secondary font-bold uppercase text-[10px]">
            <th className="py-3 px-4">Series Title</th>
            <th className="py-3 px-3">Format</th>
            <th className="py-3 px-3">Read Progress</th>
            <th className="py-3 px-3">Rating</th>
            <th className="py-3 px-3">Source Provider</th>
            <th className="py-3 px-4 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-edge/60">
          {manga.map((m) => (
            <tr key={m.id} className="hover:bg-elevated/40 transition-colors">
              <td className="py-3 px-4 flex items-center gap-3">
                <img
                  src={m.coverImage}
                  alt={m.title}
                  className="w-10 h-12 object-cover rounded-lg bg-app border border-edge"
                />
                <div className="min-w-0">
                  <div
                    onClick={() => onSelectManga(m)}
                    className="font-bold text-primary hover:text-accent cursor-pointer text-xs truncate"
                  >
                    {m.title}
                  </div>
                  <div className="text-[10px] text-muted truncate">
                    {(m.genres || []).slice(0, 3).join(', ')}
                  </div>
                </div>
              </td>
              <td className="py-3 px-3">
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-elevated text-secondary">
                  {m.type}
                </span>
              </td>
              <td className="py-3 px-3 font-mono font-semibold text-secondary">
                Ch. {m.currentChapter} / {m.latestChapter}
              </td>
              <td className="py-3 px-3 font-bold text-accent flex items-center gap-1">
                <Star className="w-3 h-3 fill-accent" />
                <span>{m.rating}</span>
              </td>
              <td className="py-3 px-3 text-secondary font-mono text-[11px]">
                {m.sourceName}
              </td>
              <td className="py-3 px-4 text-right space-x-2">
                {isReaderAvailable(m) ? (
                  <button
                    onClick={() => onOpenReader(m)}
                    className="px-3 py-1.5 rounded-lg bg-accent text-accent-fg font-black text-xs"
                  >
                    Read
                  </button>
                ) : (
                  <button
                    onClick={() => onSelectManga(m)}
                    className="px-3 py-1.5 rounded-lg bg-elevated text-secondary font-bold text-xs border border-edge-strong"
                  >
                    View Info
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);
