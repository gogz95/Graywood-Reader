import React from 'react';
import { RefreshCw } from 'lucide-react';

interface WebtoonRendererProps {
  pages: string[];
  pageStates: Record<number, { isLoading: boolean; isError: boolean }>;
  isSeamless: boolean;
  imageFilterStyle?: React.CSSProperties;
  showPageNumberOverlay: boolean;
  onRetryPage: (idx: number) => void;
  onPageClick?: (idx: number) => void;
  panelRefs: React.MutableRefObject<Record<number, HTMLDivElement | null>>;
  imageRefs: React.MutableRefObject<Record<number, HTMLImageElement | null>>;
}

export const WebtoonRenderer: React.FC<WebtoonRendererProps> = ({
  pages,
  pageStates,
  isSeamless,
  imageFilterStyle,
  showPageNumberOverlay,
  onRetryPage,
  onPageClick,
  panelRefs,
  imageRefs,
}) => {
  return (
    <div className={`w-full max-w-4xl mx-auto flex flex-col items-center ${isSeamless ? 'gap-0' : 'gap-4 py-4'}`}>
      {pages.map((src, idx) => {
        const state = pageStates[idx] || { isLoading: true, isError: false };
        return (
          <div
            key={`webtoon-panel-${idx}`}
            ref={(el) => { panelRefs.current[idx] = el; }}
            className="relative w-full flex justify-center group"
            onClick={() => onPageClick && onPageClick(idx)}
          >
            {state.isError ? (
              <div className="w-full h-80 bg-zinc-900 border border-red-950/60 rounded-xl flex flex-col items-center justify-center p-6 text-center gap-3">
                <p className="text-zinc-400 text-sm font-medium">Failed to load panel #{idx + 1}</p>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRetryPage(idx);
                  }}
                  className="px-4 py-2 bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/30 rounded-lg text-xs font-semibold flex items-center gap-2 transition"
                >
                  <RefreshCw className="w-3.5 h-3.5 animate-spin-hover" />
                  Retry Image Load
                </button>
              </div>
            ) : (
              <img
                ref={(el) => { imageRefs.current[idx] = el; }}
                src={src}
                alt={`Panel ${idx + 1}`}
                style={imageFilterStyle}
                className="w-full max-w-full h-auto object-contain transition-opacity duration-300 select-none"
                loading={idx < 4 ? 'eager' : 'lazy'}
              />
            )}

            {showPageNumberOverlay && (
              <span className="absolute bottom-2 right-2 px-2 py-0.5 bg-black/70 text-zinc-300 text-[10px] font-mono rounded opacity-0 group-hover:opacity-100 transition pointer-events-none">
                {idx + 1} / {pages.length}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
};
