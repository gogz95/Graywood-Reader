import React from 'react';
import { X, Grid, Bookmark } from 'lucide-react';
import { ChapterData } from '../../types';

export interface PageGridModalProps {
  chapterData: ChapterData;
  currentPageIndex: number;
  bookmarkedPages: number[];
  isWebtoon: boolean;
  onClose: () => void;
  onSelectPage: (idx: number) => void;
}

export const PageGridModal: React.FC<PageGridModalProps> = React.memo(({
  chapterData,
  currentPageIndex,
  bookmarkedPages,
  onClose,
  onSelectPage,
}) => {
  return (
    <div className="fixed inset-0 z-50 bg-app/85 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-surface border border-edge rounded-2xl max-w-4xl w-full p-6 space-y-4 max-h-[85vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between border-b border-edge pb-3">
          <div className="font-black text-primary text-base flex items-center gap-2">
            <Grid className="w-5 h-5 text-accent" />
            Graphical Overview Gallery ({chapterData.pages.length} Pages)
          </div>
          <button onClick={onClose} className="text-secondary hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3 p-2">
          {chapterData.pages.map((pUrl, idx) => (
            <div
              key={idx}
              onClick={() => onSelectPage(idx)}
              className={`relative rounded-xl overflow-hidden border-2 cursor-pointer transition-all hover:scale-105 ${
                currentPageIndex === idx
                  ? 'border-accent ring-2 ring-accent/50 shadow-xl'
                  : 'border-edge hover:border-edge-strong'
              }`}
            >
              <img src={pUrl} alt={`Page ${idx + 1}`} className="w-full h-36 object-cover bg-app" />
              <div className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-app/90 text-[10px] font-mono font-bold text-accent">
                PAGE {idx + 1}
              </div>
              {bookmarkedPages.includes(idx) && (
                <div className="absolute top-1 left-1 p-1 rounded bg-accent text-accent-fg shadow-md">
                  <Bookmark className="w-3 h-3 fill-current" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});
