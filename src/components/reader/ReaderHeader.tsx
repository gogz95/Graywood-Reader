import React from 'react';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  BookOpen,
  CheckCircle,
  Globe,
  Check,
  StickyNote,
  Download,
  Maximize,
} from 'lucide-react';
import { MangaItem, ChapterData, ScanGroupOption, ReaderSettings, ReaderViewMode, PageStickyNote } from '../../types';

export interface ReaderHeaderProps {
  manga: MangaItem;
  currentChapterNum: number;
  selectedScanGroup: string;
  chapterData: ChapterData | null;
  settings: ReaderSettings;
  isWebtoon: boolean;
  hasMultipleSources: boolean;
  availableScanGroups: ScanGroupOption[];
  totalChaptersList: number[];
  showChapterMenu: boolean;
  showGroupMenu: boolean;
  currentChapterNotes: PageStickyNote[];
  showNotesDrawer: boolean;
  isOfflineAvailable: boolean;
  isDownloadingOffline: boolean;
  downloadProgress: { loaded: number; total: number } | null;
  onClose: () => void;
  onPrevChapter: () => void;
  onNextChapter: () => void;
  onSelectChapter: (chNum: number) => void;
  onToggleChapterMenu: () => void;
  onToggleGroupMenu: () => void;
  onSelectScanGroup: (name: string) => void;
  onToggleNotesDrawer: () => void;
  onDownloadOffline: () => void;
  onToggleViewMode: () => void;
  onToggleFullscreen: () => void;
}

export const ReaderHeader: React.FC<ReaderHeaderProps> = React.memo(({
  manga,
  currentChapterNum,
  selectedScanGroup,
  chapterData,
  settings,
  hasMultipleSources,
  availableScanGroups,
  totalChaptersList,
  showChapterMenu,
  showGroupMenu,
  currentChapterNotes,
  showNotesDrawer,
  isOfflineAvailable,
  isDownloadingOffline,
  downloadProgress,
  onClose,
  onPrevChapter,
  onNextChapter,
  onSelectChapter,
  onToggleChapterMenu,
  onToggleGroupMenu,
  onSelectScanGroup,
  onToggleNotesDrawer,
  onDownloadOffline,
  onToggleViewMode,
  onToggleFullscreen,
}) => {
  return (
    <header className="sticky top-0 z-50 bg-surface/95 backdrop-blur-md border-b border-edge text-primary px-4 py-2.5 flex items-center justify-between gap-2 shadow-2xl transition-all">
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={onClose}
          className="p-2 rounded-xl bg-elevated hover:bg-elevated text-secondary hover:text-white transition-all flex items-center gap-1.5 text-xs font-bold"
          title="Return to Library"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="hidden sm:inline">Exit</span>
        </button>

        <div className="min-w-0">
          <h2 className="text-sm font-bold text-primary truncate hover:text-accent transition-colors">
            {manga.title}
          </h2>
          <div className="flex items-center gap-2 text-xs text-secondary font-medium">
            <span className="text-accent font-bold">Ch. {currentChapterNum}</span>
            <span>•</span>
            <span className="truncate">{selectedScanGroup}</span>
            <span className="hidden sm:inline text-xs text-info font-semibold bg-info/10 px-1.5 py-0.5 rounded border border-info/20">
              {manga.type === 'manga' ? '🇯🇵 Manga' : manga.type === 'manhwa' ? '🇰🇷 Webtoon' : '🇨🇳 Manhua'}
            </span>
          </div>
        </div>
      </div>

      {/* Center Controls: Chapter Dropdown + Scanlation Version Selector */}
      <div className="flex items-center gap-1.5">
        <button
          disabled={!chapterData?.prevChapterNumber}
          onClick={onPrevChapter}
          className="p-2 rounded-lg bg-elevated/80 hover:bg-elevated disabled:opacity-30 disabled:pointer-events-none text-primary transition-all"
          title="Previous Chapter"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        {/* Quick Chapter Selector Dropdown */}
        <div className="relative">
          <button
            onClick={onToggleChapterMenu}
            className="px-3 py-1.5 rounded-lg bg-elevated border border-edge-strong text-accent font-bold text-xs flex items-center gap-1.5 hover:bg-elevated transition-all"
          >
            <span>Ch. {currentChapterNum}</span>
            <BookOpen className="w-3.5 h-3.5 text-secondary" />
          </button>

          {showChapterMenu && (
            <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 w-48 max-h-64 overflow-y-auto bg-surface border border-edge-strong rounded-xl shadow-2xl p-1 z-50 space-y-0.5">
              <div className="p-2 text-[11px] font-bold text-secondary uppercase tracking-wider border-b border-edge">
                Chapters List
              </div>
              {totalChaptersList.map((ch) => (
                <button
                  key={ch}
                  onClick={() => onSelectChapter(ch)}
                  className={`w-full text-left px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-between ${
                    ch === currentChapterNum
                      ? 'bg-accent text-accent-fg font-bold'
                      : 'text-secondary hover:bg-elevated'
                  }`}
                >
                  <span>Chapter {ch}</span>
                  {ch <= manga.currentChapter && ch !== currentChapterNum && (
                    <CheckCircle className="w-3 h-3 text-success" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Scanlation Release Group Version Selector */}
        {hasMultipleSources && (
          <div className="relative hidden md:block">
            <button
              onClick={onToggleGroupMenu}
              className="px-3 py-1.5 rounded-lg bg-elevated border border-edge-strong text-primary font-bold text-xs flex items-center gap-1.5 hover:bg-elevated transition-all"
            >
              <Globe className="w-3.5 h-3.5 text-info" />
              <span className="truncate max-w-[110px]">{selectedScanGroup}</span>
            </button>

            {showGroupMenu && (
              <div className="absolute top-full mt-2 left-0 w-64 bg-surface border border-edge-strong rounded-xl shadow-2xl p-1 z-50 space-y-1">
                <div className="p-2 text-[11px] font-bold text-secondary uppercase border-b border-edge">
                  Select Scanlation Version / Group
                </div>
                {availableScanGroups.map((grp) => (
                  <button
                    key={grp.id}
                    onClick={() => onSelectScanGroup(grp.name)}
                    className={`w-full text-left p-2 rounded-lg text-xs flex items-center justify-between ${
                      selectedScanGroup === grp.name
                        ? 'bg-accent text-accent-fg font-bold'
                        : 'text-secondary hover:bg-elevated'
                    }`}
                  >
                    <div>
                      <div className="font-bold">{grp.name}</div>
                      <div className="text-[10px] opacity-70">{grp.quality} • {grp.releaseDate}</div>
                    </div>
                    {selectedScanGroup === grp.name && <Check className="w-4 h-4" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <button
          disabled={!chapterData?.nextChapterNumber}
          onClick={onNextChapter}
          className="p-2 rounded-lg bg-accent hover:bg-accent-bright text-accent-fg font-bold disabled:opacity-30 disabled:pointer-events-none transition-all"
          title="Next Chapter"
        >
          <ChevronRight className="w-4 h-4 stroke-[3]" />
        </button>
      </div>

      {/* Right Action Bar */}
      <div className="flex items-center gap-1.5">
        {/* Sticky Notes Drawer Trigger */}
        <button
          onClick={onToggleNotesDrawer}
          className={`p-2 rounded-xl border text-xs font-bold transition-all relative ${
            currentChapterNotes.length > 0
              ? 'bg-amber-500/15 border-amber-500/30 text-amber-400'
              : 'bg-elevated/80 hover:bg-elevated border-edge text-secondary hover:text-primary'
          }`}
          title="Chapter Sticky Notes & Annotations (Press N to add)"
        >
          <StickyNote className="w-4 h-4" />
          {currentChapterNotes.length > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-amber-500 text-black font-black text-[9px] flex items-center justify-center">
              {currentChapterNotes.length}
            </span>
          )}
        </button>

        {/* Offline Chapter Download Button */}
        <button
          onClick={onDownloadOffline}
          disabled={isDownloadingOffline}
          className={`p-2 rounded-xl border text-xs font-bold transition-all flex items-center gap-1.5 ${
            isOfflineAvailable
              ? 'bg-success/15 border-success/30 text-success'
              : 'bg-elevated/80 hover:bg-elevated border-edge text-secondary hover:text-primary'
          }`}
          title={isOfflineAvailable ? 'Stored offline in browser' : 'Download chapter for offline reading'}
        >
          <Download className={`w-4 h-4 ${isDownloadingOffline ? 'animate-bounce text-accent' : ''}`} />
          {downloadProgress && (
            <span className="text-[10px] font-mono font-bold">
              {downloadProgress.loaded}/{downloadProgress.total}
            </span>
          )}
        </button>

        {/* Quick Reading Mode Switcher Button */}
        <button
          onClick={onToggleViewMode}
          className="px-2.5 py-1.5 rounded-lg bg-elevated/80 hover:bg-elevated border border-edge text-secondary hover:text-accent text-[11px] font-bold transition-all flex items-center gap-1.5"
          title="Click to toggle layout mode"
        >
          <span>
            {settings.viewMode === 'rtl'
              ? '🇯🇵 RTL'
              : settings.viewMode === 'ltr'
              ? '🇺🇸 LTR'
              : settings.viewMode === 'single'
              ? '📄 Single'
              : settings.viewMode === 'double'
              ? '📖 Double'
              : settings.viewMode === 'webtoon'
              ? '📜 Webtoon'
              : '📱 Seamless'}
          </span>
        </button>

        <button
          onClick={onToggleFullscreen}
          className="p-2 rounded-lg bg-elevated/80 hover:bg-elevated text-secondary hidden sm:block"
          title="Toggle Fullscreen (F)"
        >
          <Maximize className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
});
