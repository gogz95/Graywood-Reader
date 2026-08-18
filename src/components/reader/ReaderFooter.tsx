import React from 'react';
import { Play, Pause, Grid } from 'lucide-react';
import { ChapterData, ReaderSettings } from '../../types';

export interface ReaderFooterProps {
  chapterData: ChapterData | null;
  currentPageIndex: number;
  isAutoScrolling: boolean;
  settings: ReaderSettings;
  onSeekPage: (pageIndex: number) => void;
  onToggleAutoScroll: () => void;
  onSelectAutoScrollSpeed: (speed: number) => void;
  onOpenPageGrid: () => void;
}

export const ReaderFooter: React.FC<ReaderFooterProps> = React.memo(({
  chapterData,
  currentPageIndex,
  isAutoScrolling,
  settings,
  onSeekPage,
  onToggleAutoScroll,
  onSelectAutoScrollSpeed,
  onOpenPageGrid,
}) => {
  if (!chapterData) return null;

  return (
    <footer className="sticky bottom-0 z-50 bg-surface/95 backdrop-blur-md border-t border-edge p-3 sm:p-4 flex flex-col gap-2.5 text-xs sm:text-sm">
      {/* Quick Page Slider */}
      <div className="flex items-center gap-3 max-w-2xl mx-auto w-full">
        <span className="font-mono text-secondary font-bold">1</span>
        <input
          type="range"
          min="0"
          max={chapterData.pages.length - 1}
          value={currentPageIndex}
          onChange={(e) => onSeekPage(Number(e.target.value))}
          className="flex-1 accent-accent cursor-pointer"
        />
        <span className="font-mono text-accent font-bold">
          {currentPageIndex + 1} / {chapterData.pages.length}
        </span>
      </div>

      {/* Granular Auto-Scroll Speed Selector Buttons */}
      <div className="flex flex-wrap items-center justify-between gap-2 max-w-2xl mx-auto w-full">
        <div className="flex items-center gap-1.5">
          <button
            onClick={onToggleAutoScroll}
            className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg font-bold flex items-center gap-1.5 transition-all shadow-md ${
              isAutoScrolling ? 'bg-accent text-accent-fg' : 'bg-elevated text-secondary hover:text-white'
            }`}
            title="Toggle Auto-Scroll (Space)"
          >
            {isAutoScrolling ? <Pause className="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-current" /> : <Play className="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-current" />}
            <span>{isAutoScrolling ? 'Pause' : 'Auto Scroll (Space)'}</span>
          </button>

          {/* Granular Speed Selector Bar */}
          <div className="flex items-center gap-1 bg-app p-1 rounded-lg border border-edge">
            <span className="text-[10px] sm:text-[11px] text-secondary font-bold px-1">Speed:</span>
            {[0.5, 1.0, 1.5, 2.0, 2.5, 3.0].map((spd) => (
              <button
                key={spd}
                onClick={() => onSelectAutoScrollSpeed(spd)}
                className={`px-2 py-0.5 rounded text-[10px] sm:text-[11px] font-bold transition-all ${
                  settings.autoScrollSpeed === spd
                    ? 'bg-accent text-accent-fg shadow-sm'
                    : 'text-secondary hover:text-primary hover:bg-elevated'
                }`}
              >
                {spd}x
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onOpenPageGrid}
            className="hover:text-accent flex items-center gap-1 font-semibold text-secondary"
          >
            <Grid className="w-3.5 h-3.5 text-info" />
            <span>Gallery Overview</span>
          </button>
        </div>
      </div>
    </footer>
  );
});
