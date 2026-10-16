import React from 'react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { ReaderViewMode, ReadingMode, ReadingDirection, ImageFitMode } from '../../types';

interface PagedRendererProps {
  currentPageIndex: number;
  totalPages: number;
  pages: string[];
  pageStates: Record<number, { isLoading: boolean; isError: boolean }>;
  viewMode?: ReaderViewMode;
  mode?: ReadingMode;
  direction?: ReadingDirection;
  spreadCoverOffset?: boolean;
  fit?: ImageFitMode;
  imageFilterStyle?: React.CSSProperties;
  onNextPage: () => void;
  onPrevPage: () => void;
  onRetryPage: (idx: number) => void;
}

export const PagedRenderer: React.FC<PagedRendererProps> = ({
  currentPageIndex,
  totalPages,
  pages,
  pageStates,
  viewMode = 'single',
  mode,
  direction,
  spreadCoverOffset = true,
  fit = 'fit-height',
  imageFilterStyle,
  onNextPage,
  onPrevPage,
  onRetryPage,
}) => {
  const isDouble = mode === 'double' || viewMode === 'double';
  const isRtl = direction === 'rtl' || viewMode === 'rtl';

  const isCover = isDouble && spreadCoverOffset && currentPageIndex === 0;
  const firstIdx = currentPageIndex;
  const secondIdx = isDouble && !isCover && firstIdx + 1 < totalPages ? firstIdx + 1 : null;

  const activeIndices = isRtl && secondIdx !== null ? [secondIdx, firstIdx] : [firstIdx, secondIdx].filter((i): i is number => i !== null);

  const fitClasses =
    fit === 'fit-width'
      ? 'w-full h-auto object-contain'
      : fit === 'fit-both'
      ? 'max-w-full max-h-[85vh] w-auto h-auto object-contain'
      : fit === 'original'
      ? 'max-w-none max-h-none w-auto h-auto'
      : 'max-w-full max-h-[85vh] object-contain';

  return (
    <div className="relative w-full h-full flex items-center justify-center select-none overflow-hidden">
      {/* Navigation Touch Zones / Buttons */}
      <button
        onClick={isRtl ? onNextPage : onPrevPage}
        className="absolute left-2 top-1/2 -translate-y-1/2 z-20 p-3 bg-zinc-900/60 hover:bg-zinc-800 text-zinc-300 rounded-full backdrop-blur-md opacity-0 group-hover:opacity-100 transition duration-200 border border-zinc-700/50"
        title={isRtl ? 'Next Page' : 'Previous Page'}
      >
        <ChevronLeft className="w-6 h-6" />
      </button>

      <button
        onClick={isRtl ? onPrevPage : onNextPage}
        className="absolute right-2 top-1/2 -translate-y-1/2 z-20 p-3 bg-zinc-900/60 hover:bg-zinc-800 text-zinc-300 rounded-full backdrop-blur-md opacity-0 group-hover:opacity-100 transition duration-200 border border-zinc-700/50"
        title={isRtl ? 'Previous Page' : 'Next Page'}
      >
        <ChevronRight className="w-6 h-6" />
      </button>

      {/* Pages Container */}
      <div className="flex items-center justify-center gap-2 max-w-full max-h-full p-2">
        {activeIndices.map((idx) => {
          const src = pages[idx];
          const state = pageStates[idx] || { isLoading: true, isError: false };

          if (!src) return null;

          return (
            <div key={`paged-panel-${idx}`} className="relative flex justify-center items-center max-w-full max-h-[85vh]">
              {state.isError ? (
                <div className="w-96 h-96 bg-zinc-900 border border-red-950/60 rounded-xl flex flex-col items-center justify-center p-6 text-center gap-3">
                  <p className="text-zinc-400 text-sm font-medium">Failed to load page #{idx + 1}</p>
                  <button
                    onClick={() => onRetryPage(idx)}
                    className="px-4 py-2 bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/30 rounded-lg text-xs font-semibold flex items-center gap-2 transition"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Retry Page Load
                  </button>
                </div>
              ) : (
                <img
                  src={src}
                  alt={`Page ${idx + 1}`}
                  style={imageFilterStyle}
                  className={`${fitClasses} transition-opacity duration-200`}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
