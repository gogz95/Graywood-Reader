import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { apiFetch } from '../utils/api';
import { KotatsuImageLoader, PageLoadState } from '../utils/KotatsuImageLoader';
import { FLAG_CATEGORIES, FlagCategory } from './FlagIssueModal';
import {
  MangaItem,
  ChapterData,
  ReaderSettings,
  ReaderViewMode,
  ReaderBgColor,
  ReaderImageFilter,
  ScanGroupOption,
} from '../types';
import {
  detectMangaFormat,
  getRecommendedReadingMode,
  resolveInitialReaderSettings,
  saveSeriesReadingMode,
  saveFormatReadingMode,
  saveLastUsedReadingMode,
} from '../utils/readingMode';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Maximize,
  CheckCircle,
  Sliders,
  BookOpen,
  X,
  RefreshCw,
  Zap,
  Play,
  Pause,
  Grid,
  Bookmark,
  Download,
  Eye,
  Check,
  RotateCcw,
  Sparkles,
  Layers,
  Globe,
  Smartphone,
  AlertTriangle,
  Flag,
} from 'lucide-react';
import {
  saveOfflineChapter,
  getOfflineChapter,
  isChapterOffline,
} from '../utils/offlineStorage';

interface ReaderViewProps {
  manga: MangaItem;
  initialChapterNumber: number;
  initialChapterId?: string;
  defaultSettings?: ReaderSettings;
  onClose: () => void;
  onMarkChapterRead: (chapterNum: number) => void;
  /** Opens the bug-reporting tool pre-filled for the flagged series. */
  onReport: (category: FlagCategory, manga: MangaItem) => void;
  onSaveSettings?: (settings: ReaderSettings) => void;
}

export const ReaderView: React.FC<ReaderViewProps> = ({
  manga,
  initialChapterNumber,
  initialChapterId,
  defaultSettings,
  onClose,
  onMarkChapterRead,
  onReport,
  onSaveSettings,
}) => {
  const [currentChapterNum, setCurrentChapterNum] = useState<number>(initialChapterNumber || 1);
  const [chapterData, setChapterData] = useState<ChapterData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Single / RTL / LTR page index
  const [currentPageIndex, setCurrentPageIndex] = useState<number>(0);

  // Kotatsu Parallel Worker Loader Instance & State
  const loaderRef = useRef<KotatsuImageLoader | null>(null);
  const [pageLoadStates, setPageLoadStates] = useState<Map<number, PageLoadState>>(new Map());

  // HUD Visibility
  const [showHud, setShowHud] = useState<boolean>(true);

  // Settings state
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [showChapterMenu, setShowChapterMenu] = useState<boolean>(false);
  const [showPageGridModal, setShowPageGridModal] = useState<boolean>(false);
  const [showGroupMenu, setShowGroupMenu] = useState<boolean>(false);

  // Selected Scanlation Release Group Version
  const [selectedScanGroup, setSelectedScanGroup] = useState<string>(manga.sourceName || 'AsuraScans');

  const detectedFormat = useMemo(() => detectMangaFormat(manga), [manga]);

  // Persistent Reader Settings with Format Auto-Detection
  const [settings, setSettingsState] = useState<ReaderSettings>(() =>
    resolveInitialReaderSettings(manga, defaultSettings)
  );

  const setSettings = useCallback(
    (newSettings: ReaderSettings) => {
      setSettingsState(newSettings);
      saveSeriesReadingMode(manga.id, newSettings);
      saveFormatReadingMode(detectedFormat, newSettings);
      saveLastUsedReadingMode(newSettings);
      if (onSaveSettings) {
        onSaveSettings(newSettings);
      }
    },
    [manga.id, detectedFormat, onSaveSettings]
  );

  const isWebtoon = settings.viewMode === 'webtoon' || settings.viewMode === 'webtoon-seamless';

  // Auto-scroll state
  const [isAutoScrolling, setIsAutoScrolling] = useState<boolean>(false);
  const [autoNextCountdown, setAutoNextCountdown] = useState<number | null>(null);

  // Bookmarking & Downloading
  const [bookmarkedPages, setBookmarkedPages] = useState<number[]>([]);
  const [downloading, setDownloading] = useState<boolean>(false);

  // Scroll progress tracking
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [readProgressPercent, setReadProgressPercent] = useState<number>(0);

  // Toast notice
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const triggerToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2500);
  }, []);

  // Offline Chapter Storage States
  const [isOfflineAvailable, setIsOfflineAvailable] = useState<boolean>(false);
  const [isDownloadingOffline, setIsDownloadingOffline] = useState<boolean>(false);
  const [downloadProgress, setDownloadProgress] = useState<{ loaded: number; total: number } | null>(null);

  const [isFlagged, setIsFlagged] = useState<boolean>(Boolean(manga.isFlagged));
  const [flagReason, setFlagReason] = useState<string>(manga.flagReason || '');
  const [showFlagDropdown, setShowFlagDropdown] = useState<boolean>(false);

  // Dynamically compute available scanlation group versions from manga.availableSources
  const availableScanGroups: ScanGroupOption[] = (manga.availableSources && manga.availableSources.length > 0)
    ? manga.availableSources.map((src, idx) => ({
        id: `src_${idx}`,
        name: src.sourceName,
        quality: '1080p Web',
        releaseDate: 'Active Source',
      }))
    : [];

  const hasMultipleSources = availableScanGroups.length > 1;

  // Fetch chapter page image URLs
  const fetchChapterPages = useCallback(async (chNum: number) => {
    setLoading(true);
    setError(null);
    setCurrentPageIndex(0);
    setAutoNextCountdown(null);

    // Destroy existing loader instance if present
    if (loaderRef.current) {
      loaderRef.current.destroy();
      loaderRef.current = null;
    }

    try {
      // Step 1: Check offline IndexedDB storage first for instant loading
      const offlineCopy = await getOfflineChapter(manga.id, chNum);
      if (offlineCopy && offlineCopy.pages && offlineCopy.pages.length > 0) {
        setIsOfflineAvailable(true);
        setChapterData({
          mangaId: manga.id,
          mangaTitle: manga.title,
          chapterId: String(chNum),
          chapterNumber: chNum,
          title: `Chapter ${chNum}`,
          pages: offlineCopy.pages,
          scanGroup: 'Offline Storage',
          totalChapters: manga.totalChapters || 1,
          nextChapterNumber: chNum + 1,
          prevChapterNumber: chNum > 1 ? chNum - 1 : null,
        });
        setCurrentPageIndex(0);
        setLoading(false);
        return;
      } else {
        setIsOfflineAvailable(false);
      }

      const url = `/api/reader/chapter-pages?mangaId=${encodeURIComponent(
        manga.id
      )}&chapterNumber=${chNum}${initialChapterId ? `&chapterId=${encodeURIComponent(initialChapterId)}` : ''}`;
      const res = await apiFetch(url);
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error((errBody as any).message || (errBody as any).error || `Failed to load chapter content (HTTP ${res.status})`);
      }
      const data: ChapterData = await res.json();
      setChapterData(data);

      if (data.isPlaceholder || data.loadError || data.contentUnavailable || !data.pages?.length) {
        setError(
          data.loadError ||
            'Live chapter pages could not be loaded from the source. The chapter may be missing, the source may be blocking requests, or the series URL is stale.'
        );
      }

      // Resume mid-chapter page if the server has stored progress for this chapter
      let resumePage = 0;
      try {
        const histRes = await apiFetch(`/api/reader/history/${encodeURIComponent(manga.id)}`);
        if (histRes.ok) {
          const rows = await histRes.json();
          if (Array.isArray(rows)) {
            const match = rows.find((r: any) => Number(r.chapter_number) === Number(chNum));
            if (match && Number(match.page_index) > 0) {
              resumePage = Math.min(
                Number(match.page_index) || 0,
                Math.max(0, (data.pages?.length || 1) - 1)
              );
            }
          }
        }
      } catch {
        /* resume is best-effort */
      }
      setCurrentPageIndex(resumePage);

      // Initialize Kotatsu Parallel Image Loader Engine
      if (data.pages && data.pages.length > 0 && !data.isPlaceholder && !data.contentUnavailable) {
        const loader = new KotatsuImageLoader(data.pages, manga.sourceUrl, (states) => {
          setPageLoadStates(new Map(states));
        });
        loaderRef.current = loader;
        loader.setActiveIndex(resumePage);
      }

      if (settings.autoMarkRead && !data.isPlaceholder && !data.contentUnavailable && data.pages?.length) {
        onMarkChapterRead(chNum);
      }

      // Persist open position so analytics/history stay warm
      if (!data.isPlaceholder && data.pages?.length) {
        apiFetch('/api/reader/progress', {
          method: 'POST',
          body: JSON.stringify({
            mangaId: manga.id,
            chapterNumber: chNum,
            pageIndex: resumePage,
            pageCount: data.pages.length,
            percent: data.pages.length ? Math.round((resumePage / data.pages.length) * 100) : 0,
          }),
        }).catch(() => {});
      }
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Could not load chapter pages. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [initialChapterId, manga.id, manga.sourceUrl, settings.autoMarkRead, onMarkChapterRead]);

  useEffect(() => {
    fetchChapterPages(currentChapterNum);

    return () => {
      if (loaderRef.current) {
        loaderRef.current.destroy();
        loaderRef.current = null;
      }
    };
  }, [currentChapterNum]);

  // Update image loader sliding window whenever active page changes
  useEffect(() => {
    if (loaderRef.current) {
      loaderRef.current.setActiveIndex(currentPageIndex);
    }
  }, [currentPageIndex]);

  // Micro-step Smooth Auto-scroll Engine
  useEffect(() => {
    if (!isAutoScrolling || !isWebtoon) return;

    // Smooth continuous micro steps based on speed level (0.5x to 3.0x)
    const step = settings.autoScrollSpeed * 1.2;
    const timer = setInterval(() => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop += step;
      }
    }, 16); // ~60 FPS smooth scrolling

    return () => clearInterval(timer);
  }, [isAutoScrolling, settings.autoScrollSpeed, isWebtoon]);

  // Handle Scroll Progress & Auto-Next Chapter Trigger
  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current || !chapterData) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    if (scrollHeight <= clientHeight) {
      setReadProgressPercent(100);
      return;
    }
    const percent = Math.min(100, Math.round((scrollTop / (scrollHeight - clientHeight)) * 100));
    setReadProgressPercent(percent);

    if (chapterData.pages.length > 0) {
      const pIdx = Math.min(
        chapterData.pages.length - 1,
        Math.floor((scrollTop / (scrollHeight - clientHeight + 1)) * chapterData.pages.length)
      );
      setCurrentPageIndex(pIdx);
    }

    if (percent > 85 && settings.autoMarkRead) {
      onMarkChapterRead(currentChapterNum);
    }

    // Auto-Next Chapter trigger for Webtoons at scroll end
    if (percent >= 98 && settings.autoNextChapter && chapterData.nextChapterNumber && !autoNextCountdown) {
      triggerToast(`Auto-loading Chapter ${chapterData.nextChapterNumber} in 3s...`);
      setAutoNextCountdown(3);
      setTimeout(() => {
        if (chapterData.nextChapterNumber) {
          setCurrentChapterNum(chapterData.nextChapterNumber);
        }
      }, 3000);
    }
  }, [scrollContainerRef, chapterData, settings.autoMarkRead, onMarkChapterRead, settings.autoNextChapter, autoNextCountdown, triggerToast, setAutoNextCountdown, setCurrentChapterNum, currentChapterNum]);

  // Debounced server progress persistence (page + percent) for analytics/resume
  useEffect(() => {
    if (!chapterData || chapterData.isPlaceholder || chapterData.contentUnavailable || !chapterData.pages?.length) return;
    const timer = setTimeout(() => {
      apiFetch('/api/reader/progress', {
        method: 'POST',
        body: JSON.stringify({
          mangaId: manga.id,
          chapterNumber: currentChapterNum,
          pageIndex: currentPageIndex,
          pageCount: chapterData.pages.length,
          percent: readProgressPercent,
        }),
      }).catch(() => {});
    }, 1200);
    return () => clearTimeout(timer);
  }, [manga.id, currentChapterNum, currentPageIndex, readProgressPercent, chapterData]);

  // Keyboard Navigation (Space for Auto-scroll, A/D, Arrow keys, F)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        setIsAutoScrolling((prev) => {
          const nextState = !prev;
          triggerToast(nextState ? `Auto-Scroll Started (${settings.autoScrollSpeed}x)` : 'Auto-Scroll Paused');
          return nextState;
        });
      } else if (e.key === 'ArrowRight' || e.key === 'd') {
        if (settings.viewMode === 'rtl' && chapterData) {
          if (currentPageIndex > 0) setCurrentPageIndex((prev) => prev - 1);
        } else if (chapterData) {
          if (currentPageIndex < chapterData.pages.length - 1) {
            setCurrentPageIndex((prev) => prev + 1);
          } else if (chapterData.nextChapterNumber) {
            setCurrentChapterNum(chapterData.nextChapterNumber);
          }
        }
      } else if (e.key === 'ArrowLeft' || e.key === 'a') {
        if (settings.viewMode === 'rtl' && chapterData) {
          if (currentPageIndex < chapterData.pages.length - 1) setCurrentPageIndex((prev) => prev + 1);
        } else if (chapterData) {
          if (currentPageIndex > 0) {
            setCurrentPageIndex((prev) => prev - 1);
          } else if (chapterData.prevChapterNumber) {
            setCurrentChapterNum(chapterData.prevChapterNumber);
          }
        }
      } else if (e.key === 'f') {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => {});
        } else {
          document.exitFullscreen().catch(() => {});
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [settings.viewMode, currentPageIndex, chapterData, settings.autoScrollSpeed]);

  // Handle Offline Download Chapter
  const handleDownloadChapter = useCallback(async () => {
    if (!chapterData || !chapterData.pages || chapterData.pages.length === 0) return;
    setIsDownloadingOffline(true);
    setDownloadProgress({ loaded: 0, total: chapterData.pages.length });
    try {
      await saveOfflineChapter(
        manga.id,
        manga.title,
        currentChapterNum,
        chapterData.pages,
        (loaded, total) => setDownloadProgress({ loaded, total })
      );
      setIsOfflineAvailable(true);
      triggerToast(`Chapter ${currentChapterNum} downloaded for offline reading!`);
    } catch (err: any) {
      triggerToast(`Offline download failed: ${err.message}`);
    } finally {
      setIsDownloadingOffline(false);
      setDownloadProgress(null);
    }
  }, [chapterData, currentChapterNum, manga.id, manga.title, triggerToast]);

  // Toggle bookmark for page
  const toggleBookmarkPage = useCallback((pageIdx: number) => {
    setBookmarkedPages((prev) => {
      const newBookmarks = prev.includes(pageIdx)
        ? prev.filter((p) => p !== pageIdx)
        : [...prev, pageIdx];
      triggerToast(
        prev.includes(pageIdx)
          ? `Removed page ${pageIdx + 1} from bookmarks.`
          : `Bookmarked page ${pageIdx + 1}!`
      );
      return newBookmarks;
    });
  }, [triggerToast]);

  // Canvas background style mapping
  const bgStyleClass = useMemo(() => {
    if (settings.bgColor === 'black') return 'bg-black text-primary';
    if (settings.bgColor === 'charcoal') return 'bg-zinc-950 text-primary';
    if (settings.bgColor === 'sepia') return 'bg-[#1c1813] text-[#e8d5b7]';
    if (settings.bgColor === 'white') return 'bg-slate-100 text-accent-fg';
    return 'bg-app text-primary';
  }, [settings.bgColor]);

  // CSS Image Filters Mapping (Including OLED pitch black optimization!)
  const imageFilterStyle = useMemo(() => {
    if (settings.imageFilter === 'oled') return { filter: 'contrast(130%) brightness(90%)' };
    if (settings.imageFilter === 'grayscale') return { filter: 'grayscale(100%)' };
    if (settings.imageFilter === 'sepia') return { filter: 'sepia(70%) contrast(105%)' };
    if (settings.imageFilter === 'invert') return { filter: 'invert(100%) hue-rotate(180deg)' };
    if (settings.imageFilter === 'brightness') return { filter: 'contrast(120%) brightness(110%)' };
    return {};
  }, [settings.imageFilter]);

  const totalChaptersList = useMemo(() => {
    return Array.from({
      length: Math.max(manga.latestChapter, manga.currentChapter, 10),
    }, (_, i) => i + 1).reverse();
  }, [manga.latestChapter, manga.currentChapter]);

  return (
    <div className={`fixed inset-0 z-50 flex flex-col ${settings.imageFilter === 'oled' ? 'bg-black text-white' : bgStyleClass} font-sans select-none overflow-hidden`}>
      {/* Toast Notice */}
      {toastMsg && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-accent text-accent-fg font-bold text-xs rounded-xl shadow-2xl flex items-center gap-2 animate-bounce">
          <Sparkles className="w-4 h-4" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Persistent Page & Chapter Badge Indicator (BUG-003: toggleable & semi-transparent) */}
      {settings.showPersistentPageBadge && chapterData && (
        <div className="fixed top-14 left-4 z-40 px-3 py-1.5 rounded-xl bg-surface/50 backdrop-blur-sm border border-edge-strong/50 text-primary/90 text-xs font-mono font-bold shadow-lg flex items-center gap-2 pointer-events-none transition-opacity">
          <span className="text-accent/90">Ch. {currentChapterNum}</span>
          <span className="text-muted/80">•</span>
          <span>Page {currentPageIndex + 1} / {chapterData.pages.length}</span>
        </div>
      )}

      {/* TOP KOTATSU HUD HEADER BAR */}
      {showHud && (
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
              onClick={() => chapterData?.prevChapterNumber && setCurrentChapterNum(chapterData.prevChapterNumber)}
              className="p-2 rounded-lg bg-elevated/80 hover:bg-elevated disabled:opacity-30 disabled:pointer-events-none text-primary transition-all"
              title="Previous Chapter"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            {/* Quick Chapter Selector Dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowChapterMenu(!showChapterMenu)}
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
                      onClick={() => {
                        setCurrentChapterNum(ch);
                        setShowChapterMenu(false);
                      }}
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

            {/* Scanlation Release Group Version Selector (Only available if item has multiple sources) */}
            {hasMultipleSources && (
              <div className="relative hidden md:block">
                <button
                  onClick={() => setShowGroupMenu(!showGroupMenu)}
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
                        onClick={() => {
                          setSelectedScanGroup(grp.name);
                          setShowGroupMenu(false);
                          triggerToast(`Switched scanlation group to ${grp.name}`);
                        }}
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
              onClick={() => chapterData?.nextChapterNumber && setCurrentChapterNum(chapterData.nextChapterNumber)}
              className="p-2 rounded-lg bg-accent hover:bg-accent-bright text-accent-fg font-bold disabled:opacity-30 disabled:pointer-events-none transition-all"
              title="Next Chapter"
            >
              <ChevronRight className="w-4 h-4 stroke-[3]" />
            </button>
          </div>

          {/* Right Action Bar */}
          <div className="flex items-center gap-1.5">
            {/* Offline Chapter Download Button */}
            <button
              onClick={async () => {
                if (!chapterData || !chapterData.pages || chapterData.pages.length === 0) return;
                setIsDownloadingOffline(true);
                setDownloadProgress({ loaded: 0, total: chapterData.pages.length });
                try {
                  await saveOfflineChapter(
                    manga.id,
                    manga.title,
                    currentChapterNum,
                    chapterData.pages,
                    (loaded, total) => setDownloadProgress({ loaded, total })
                  );
                  setIsOfflineAvailable(true);
                  triggerToast(`Chapter ${currentChapterNum} saved offline!`);
                } catch (err: any) {
                  triggerToast(`Offline download failed: ${err.message}`);
                } finally {
                  setIsDownloadingOffline(false);
                  setDownloadProgress(null);
                }
              }}
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
              onClick={() => {
                const nextMode: ReaderViewMode = isWebtoon ? 'rtl' : 'webtoon-seamless';
                setSettings({
                  ...settings,
                  viewMode: nextMode,
                  noPanelSpacing: nextMode === 'webtoon-seamless',
                  pageGap: nextMode === 'webtoon-seamless' ? 0 : 8,
                });
                triggerToast(nextMode === 'rtl' ? 'Switched to 🇯🇵 Manga (RTL)' : 'Switched to 📱 Webtoon (Seamless 0px)');
              }}
              className="px-2.5 py-1.5 rounded-lg bg-elevated/80 hover:bg-elevated border border-edge text-secondary hover:text-accent text-[11px] font-bold transition-all flex items-center gap-1.5"
              title="Click to toggle between Webtoon and Manga RTL"
            >
              <span>{settings.viewMode === 'rtl' ? '🇯🇵 RTL' : settings.viewMode === 'ltr' ? '🇺🇸 LTR' : settings.viewMode === 'single' ? '📄 Single' : settings.viewMode === 'double' ? '📖 Double Spread' : settings.viewMode === 'webtoon' ? '📜 Webtoon' : '📱 Seamless'}</span>
            </button>

            <button
              onClick={() => setShowPageGridModal(true)}
              className="p-2 rounded-lg bg-elevated/80 hover:bg-elevated text-secondary transition-all hidden sm:block"
              title="Page Overview Gallery"
            >
              <Grid className="w-4 h-4 text-info" />
            </button>

            <button
              onClick={() => toggleBookmarkPage(currentPageIndex)}
              className={`p-2 rounded-lg transition-all ${
                bookmarkedPages.includes(currentPageIndex)
                  ? 'bg-accent text-accent-fg'
                  : 'bg-elevated/80 text-secondary hover:bg-elevated'
              }`}
              title="Bookmark Current Page"
            >
              <Bookmark className="w-4 h-4 fill-current" />
            </button>

            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`p-2 rounded-lg transition-all ${
                showSettings ? 'bg-accent text-accent-fg font-bold' : 'bg-elevated/80 text-secondary hover:bg-elevated'
              }`}
              title="Display & Speed Settings"
            >
              <Sliders className="w-4 h-4" />
            </button>

            {/* Flag Issue Dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowFlagDropdown(!showFlagDropdown)}
                className={`p-2 rounded-lg transition-all ${
                  isFlagged ? 'bg-danger text-white font-bold animate-pulse' : 'bg-elevated/80 text-secondary hover:bg-elevated hover:text-danger'
                }`}
                title={isFlagged ? `Flagged: ${flagReason}` : "Flag Series / Report Loading Error"}
              >
                <AlertTriangle className="w-4 h-4" />
              </button>
              {showFlagDropdown && (
                <div className="absolute right-0 top-full mt-1 z-[999] w-60 bg-surface border border-edge rounded-xl shadow-2xl overflow-hidden">
                  <div className="p-2 border-b border-edge">
                    <p className="text-[11px] font-bold text-primary">What went wrong?</p>
                  </div>
                  {FLAG_CATEGORIES.map((cat) => (
                    <button
                      key={cat.id}
                      onClick={async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setShowFlagDropdown(false);
                        try {
                          await apiFetch('/api/manga/toggle-flag', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ id: manga.id, isFlagged: true, flagReason: cat.flagReason }),
                          });
                        } catch (_) {}
                        setIsFlagged(true);
                        setFlagReason(cat.flagReason);
                        triggerToast('⚠️ Series flagged');
                        onReport(cat, manga);
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-medium text-primary hover:bg-danger/10 hover:text-danger transition-colors text-left border-b border-edge/50 last:border-0"
                    >
                      <span className="p-1 rounded bg-danger/10 text-danger">{cat.icon}</span>
                      <span>
                        <span className="block font-bold">{cat.label}</span>
                        <span className="block text-[10px] text-secondary">{cat.description}</span>
                      </span>
                    </button>
                  ))}
                  {isFlagged && (
                    <button
                      onClick={async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setShowFlagDropdown(false);
                        try {
                          await apiFetch('/api/manga/toggle-flag', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ id: manga.id, isFlagged: false }),
                          });
                        } catch (_) {}
                        setIsFlagged(false);
                        setFlagReason('');
                        triggerToast('✓ Flag removed');
                      }}
                      className="w-full px-3 py-2 text-xs font-bold text-secondary hover:text-danger hover:bg-danger/10 transition-colors text-center border-t border-edge flex items-center justify-center gap-1.5"
                    >
                      <Check className="w-3 h-3" /> Remove Flag
                    </button>
                  )}
                </div>
              )}
            </div>

            <button
              onClick={() => {
                if (!document.fullscreenElement) {
                  document.documentElement.requestFullscreen().catch(() => {});
                } else {
                  document.exitFullscreen().catch(() => {});
                }
              }}
              className="p-2 rounded-lg bg-elevated/80 hover:bg-elevated text-secondary hidden sm:block"
              title="Toggle Fullscreen (F)"
            >
              <Maximize className="w-4 h-4" />
            </button>
          </div>
        </header>
      )}

      {/* Top Scroll Reading Progress Bar */}
      <div className="w-full h-1 bg-surface relative">
        <div
          className="h-full bg-accent-grad transition-all duration-150"
          style={{ width: `${readProgressPercent}%` }}
        />
      </div>

      {/* GRAPHICAL PAGE OVERVIEW GALLERY MODAL */}
      {showPageGridModal && chapterData && (
        <div className="fixed inset-0 z-50 bg-app/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-surface border border-edge rounded-2xl max-w-4xl w-full p-6 space-y-4 max-h-[85vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between border-b border-edge pb-3">
              <div className="font-black text-primary text-base flex items-center gap-2">
                <Grid className="w-5 h-5 text-accent" />
                Graphical Overview Gallery ({chapterData.pages.length} Pages)
              </div>
              <button onClick={() => setShowPageGridModal(false)} className="text-secondary hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3 p-2">
              {chapterData.pages.map((pUrl, idx) => (
                <div
                  key={idx}
                  onClick={() => {
                    setCurrentPageIndex(idx);
                    setShowPageGridModal(false);
                    if (isWebtoon && scrollContainerRef.current) {
                      const totalH = scrollContainerRef.current.scrollHeight;
                      scrollContainerRef.current.scrollTop = (totalH / chapterData.pages.length) * idx;
                    }
                  }}
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
      )}

      {/* DISPLAY & SPEED SETTINGS MODAL */}
      {showSettings && (
        <div className="fixed inset-0 z-50 bg-app/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-surface border border-edge rounded-2xl max-w-xl w-full p-6 space-y-5 max-h-[90vh] overflow-y-auto shadow-2xl text-primary">
            <div className="flex items-center justify-between border-b border-edge pb-3">
              <div className="font-extrabold text-primary text-base flex items-center gap-2">
                <Sliders className="w-5 h-5 text-accent" />
                Reader Layout, Display & Speed Settings
              </div>
              <button
                onClick={() => setShowSettings(false)}
                className="p-1.5 rounded-full bg-elevated text-secondary hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* FORMAT AUTO-DETECTION BADGE & TOGGLE */}
            <div className="p-3 bg-app/90 rounded-xl border border-edge flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <Sparkles className="w-4 h-4 text-accent flex-shrink-0" />
                <div>
                  <div className="text-xs font-bold text-primary flex items-center gap-1.5">
                    <span>Format:</span>
                    <span className="text-accent uppercase font-mono">
                      {detectedFormat === 'manga' ? '🇯🇵 Japanese Manga' : detectedFormat === 'manhwa' ? '🇰🇷 Korean Manhwa' : '🇨🇳 Chinese Manhua'}
                    </span>
                  </div>
                  <div className="text-[10px] text-secondary">
                    {settings.autoFormatMode !== false ? 'Auto-detection active (remembering your layout)' : 'Manual layout override active'}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  const next = settings.autoFormatMode === false;
                  if (next) {
                    const rec = getRecommendedReadingMode(manga);
                    setSettings({
                      ...settings,
                      autoFormatMode: true,
                      viewMode: rec.viewMode,
                      noPanelSpacing: rec.noPanelSpacing,
                      pageGap: rec.pageGap,
                    });
                    triggerToast(`Auto-Format Active: ${rec.viewMode.toUpperCase()}`);
                  } else {
                    setSettings({ ...settings, autoFormatMode: false });
                    triggerToast('Auto-Format Disabled');
                  }
                }}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all ${
                  settings.autoFormatMode !== false
                    ? 'bg-accent/15 text-accent border-accent/40'
                    : 'bg-elevated text-secondary border-edge hover:text-primary'
                }`}
              >
                {settings.autoFormatMode !== false ? 'Auto-Format ON' : 'Auto-Format OFF'}
              </button>
            </div>

            {/* 1. READER VIEWING MODE (KOTATSU INSPIRED) */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-secondary flex items-center gap-1.5">
                <BookOpen className="w-3.5 h-3.5 text-accent" />
                Reading Mode & Page Layout
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                {[
                  { id: 'webtoon-seamless', label: '📱 Webtoon Seamless (0px Gap)', desc: 'Continuous vertical (No panel spacing)' },
                  { id: 'webtoon', label: '📜 Webtoon Standard', desc: 'Continuous vertical (Custom gap)' },
                  { id: 'rtl', label: '🇯🇵 Manga (RTL)', desc: 'Right to Left page turn' },
                  { id: 'ltr', label: '🇺🇸 Western / Manhua', desc: 'Left to Right page turn' },
                  { id: 'single', label: '📄 Single Page', desc: 'One page per view' },
                  { id: 'vertical-paged', label: '📑 Paged Vertical', desc: 'Top to bottom paged' },
                ].map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => {
                      setSettings({
                        ...settings,
                        viewMode: mode.id as any,
                        noPanelSpacing: mode.id === 'webtoon-seamless',
                        pageGap: mode.id === 'webtoon-seamless' ? 0 : settings.pageGap || 8,
                      });
                      triggerToast(`Reader Mode: ${mode.label}`);
                    }}
                    className={`p-2.5 rounded-xl border text-left flex flex-col gap-1 transition-all ${
                      settings.viewMode === mode.id || (mode.id === 'webtoon-seamless' && settings.noPanelSpacing && isWebtoon)
                        ? 'border-accent bg-accent/10 text-accent font-bold'
                        : 'border-edge bg-app text-secondary hover:bg-elevated'
                    }`}
                  >
                    <span className="text-xs font-bold text-primary">{mode.label}</span>
                    <span className="text-[10px] opacity-70 line-clamp-1">{mode.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* 2. WEBTOON PANEL SPACING / GAP */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-secondary flex items-center justify-between">
                <span>Webtoon Vertical Panel Spacing (Gap):</span>
                <span className="text-accent font-mono font-bold">
                  {settings.noPanelSpacing || settings.pageGap === 0 ? '0px (Seamless)' : `${settings.pageGap}px`}
                </span>
              </label>
              <div className="flex items-center gap-2">
                {[0, 4, 8, 12, 16, 24].map((gap) => (
                  <button
                    key={gap}
                    type="button"
                    onClick={() => setSettings({ ...settings, pageGap: gap, noPanelSpacing: gap === 0 })}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                      (gap === 0 && (settings.noPanelSpacing || settings.pageGap === 0)) || settings.pageGap === gap
                        ? 'border-accent bg-accent text-accent-fg'
                        : 'border-edge bg-app text-secondary hover:bg-elevated'
                    }`}
                  >
                    {gap === 0 ? 'Seamless' : `${gap}px`}
                  </button>
                ))}
              </div>
            </div>

            {/* 3. CONTAINER MAX WIDTH */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-secondary">Container Max Width (Reader Canvas):</label>
              <div className="grid grid-cols-5 gap-2 text-xs">
                {['600px', '750px', '850px', '1000px', '100%'].map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setSettings({ ...settings, maxWidth: w })}
                    className={`py-1.5 rounded-lg font-bold border transition-all ${
                      settings.maxWidth === w
                        ? 'border-accent bg-accent text-accent-fg'
                        : 'border-edge bg-app text-secondary hover:bg-elevated'
                    }`}
                  >
                    {w === '100%' ? 'Full' : w}
                  </button>
                ))}
              </div>
            </div>

            {/* 4. IMAGE FIT MODE */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-secondary">Image Scaling & Fit Mode:</label>
              <div className="grid grid-cols-3 gap-2 text-xs">
                {[
                  { id: 'fit-width', label: 'Fit Width' },
                  { id: 'fit-height', label: 'Fit Screen Height' },
                  { id: 'original', label: 'Original Size' },
                ].map((fit) => (
                  <button
                    key={fit.id}
                    type="button"
                    onClick={() => setSettings({ ...settings, mangaFitMode: fit.id as any })}
                    className={`py-1.5 rounded-lg font-bold border text-center transition-all ${
                      settings.mangaFitMode === fit.id
                        ? 'border-accent bg-accent text-accent-fg'
                        : 'border-edge bg-app text-secondary hover:bg-elevated'
                    }`}
                  >
                    {fit.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 5. BACKGROUND THEME */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-secondary">Background Canvas Theme:</label>
              <div className="grid grid-cols-4 gap-2 text-xs">
                {[
                  { id: 'slate', name: 'Dark Slate', bg: 'bg-surface text-primary' },
                  { id: 'black', name: 'AMOLED Black', bg: 'bg-black text-primary' },
                  { id: 'sepia', name: 'Soft Sepia', bg: 'bg-[#f4ecd8] text-[#5b4636]' },
                  { id: 'white', name: 'Paper White', bg: 'bg-white text-accent-fg' },
                ].map((bg) => (
                  <button
                    key={bg.id}
                    type="button"
                    onClick={() => setSettings({ ...settings, bgColor: bg.id as any })}
                    className={`py-2 rounded-lg font-bold border text-center transition-all ${bg.bg} ${
                      settings.bgColor === bg.id ? 'ring-2 ring-accent border-accent' : 'border-edge-strong'
                    }`}
                  >
                    {bg.name}
                  </button>
                ))}
              </div>
            </div>

            {/* 6. AUTO-SCROLL SPEED */}
            <div className="p-3.5 bg-app rounded-xl border border-edge space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-primary flex items-center gap-1.5">
                  <Play className="w-3.5 h-3.5 text-accent" />
                  Auto-Scroll Speed Controls
                </span>
                <span className="text-accent font-mono font-bold text-xs">{settings.autoScrollSpeed}x Speed</span>
              </div>
              <div className="flex items-center gap-1.5">
                {[0.5, 1.0, 1.5, 2.0, 3.0, 5.0].map((speed) => (
                  <button
                    key={speed}
                    type="button"
                    onClick={() => setSettings({ ...settings, autoScrollSpeed: speed })}
                    className={`flex-1 py-1 rounded text-xs font-bold border transition-all ${
                      settings.autoScrollSpeed === speed
                        ? 'border-accent bg-accent text-accent-fg'
                        : 'border-edge bg-surface text-secondary hover:bg-elevated'
                    }`}
                  >
                    {speed}x
                  </button>
                ))}
              </div>
            </div>

            {/* 7. FLAGGING SYSTEM BUTTON */}
            <div className="p-3.5 bg-red-950/30 border border-red-900/50 rounded-xl flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <div className="text-xs font-bold text-danger flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Flag Series Loading / Chapter Error
                </div>
                <div className="text-[11px] text-secondary">Report missing panels, unreadable images, or source issues.</div>
              </div>
              <button
                type="button"
                onClick={() => setShowFlagDropdown(!showFlagDropdown)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                  isFlagged
                    ? 'bg-danger text-white shadow-md'
                    : 'bg-elevated hover:bg-red-950 text-danger border border-danger/30'
                }`}
              >
                {isFlagged ? '✓ Flagged' : 'Flag Issue'}
              </button>
            </div>

            <div className="pt-2 border-t border-edge flex justify-end">
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="px-5 py-2 rounded-xl bg-accent hover:bg-accent-bright text-accent-fg font-extrabold text-xs"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MAIN READER SCROLL CANVAS */}
      <main
        ref={scrollContainerRef}
        onScroll={handleScroll}
        onClick={() => setShowHud(!showHud)}
        className="flex-1 overflow-y-auto overflow-x-hidden p-0 relative cursor-pointer"
      >
        {loading ? (
          <div className="min-h-[70vh] flex flex-col items-center justify-center p-8 space-y-4 text-center">
            <div className="w-12 h-12 border-4 border-accent border-t-transparent rounded-full animate-spin mx-auto" />
            <div className="space-y-1">
              <h3 className="text-lg font-bold text-primary">Fetching Chapter {currentChapterNum}...</h3>
              <p className="text-xs text-secondary">Scanlation Version: {selectedScanGroup}</p>
            </div>
          </div>
        ) : error ? (
          <div className="min-h-[70vh] flex flex-col items-center justify-center p-8 space-y-4 text-center max-w-lg mx-auto">
            <div className="w-14 h-14 rounded-2xl bg-accent/10 text-accent border border-accent/30 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-black text-primary">Content Unavailable</h3>
              <p className="text-sm text-secondary leading-relaxed">{error}</p>
              <p className="text-xs text-muted">
                Series: <span className="text-primary font-semibold">{manga.title}</span>
                {' · '}Chapter {currentChapterNum}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
              <button
                onClick={() => fetchChapterPages(currentChapterNum)}
                className="px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Retry Chapter
              </button>
              {chapterData?.nextChapterNumber ? (
                <button
                  onClick={() => setCurrentChapterNum(chapterData.nextChapterNumber!)}
                  className="px-4 py-2 rounded-xl bg-elevated border border-edge text-primary font-bold text-xs flex items-center gap-2"
                >
                  Try Next Chapter
                  <ChevronRight className="w-4 h-4" />
                </button>
              ) : null}
              {chapterData?.prevChapterNumber ? (
                <button
                  onClick={() => setCurrentChapterNum(chapterData.prevChapterNumber!)}
                  className="px-4 py-2 rounded-xl bg-elevated border border-edge text-primary font-bold text-xs flex items-center gap-2"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Previous Chapter
                </button>
              ) : null}
              <button
                onClick={() => setShowChapterMenu(true)}
                className="px-4 py-2 rounded-xl bg-elevated border border-edge text-primary font-bold text-xs flex items-center gap-2"
              >
                <BookOpen className="w-4 h-4" />
                Pick Chapter
              </button>
            </div>
          </div>
        ) : chapterData && isWebtoon ? (
          /* WEBTOON VERTICAL LONG STRIP MODE (STANDARD OR SEAMLESS) */
          <div className="flex flex-col items-center w-full py-4 space-y-0 relative">
            {/* Phone/Tablet Center Touch Overlay for HUD Toggle */}
            <div
              className="absolute inset-0 z-10 pointer-events-auto cursor-pointer"
              onClick={(e) => {
                // Toggle HUD on center tap
                const clickX = e.clientX / window.innerWidth;
                if (clickX >= 0.3 && clickX <= 0.7) {
                  setShowHud(!showHud);
                }
              }}
            />

            <div
              className="w-full mx-auto flex flex-col items-center shadow-2xl relative z-20"
              style={{
                maxWidth: settings.maxWidth,
                gap: `${settings.noPanelSpacing ? 0 : settings.pageGap}px`
              }}
            >
              {chapterData.pages.map((pageSrc, idx) => {
                const pageState = pageLoadStates.get(idx);
                const displaySrc = pageState?.blobUrl || pageSrc;
                const isLoading = pageState?.status === 'loading';
                const isError = pageState?.status === 'error';
                const isSeamless = settings.noPanelSpacing || settings.pageGap === 0;

                return (
                  <div
                    key={idx}
                    className={`w-full relative flex items-center justify-center overflow-hidden transition-all ${
                      isSeamless ? 'border-none p-0 m-0 bg-transparent min-h-0' : 'bg-app min-h-[300px] border border-edge/50'
                    }`}
                  >
                    {/* Image Render */}
                    <img
                      src={displaySrc}
                      alt={`Page ${idx + 1}`}
                      style={imageFilterStyle}
                      className={`w-full h-auto block object-contain transition-opacity duration-300 ${
                        isSeamless ? 'm-0 p-0 border-0' : ''
                      } ${isLoading ? 'opacity-40 blur-xs min-h-[250px]' : 'opacity-100'}`}
                      loading="eager"
                    />

                    {/* Preloader Spinner Overlay */}
                    {isLoading && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-app/60 backdrop-blur-xs text-accent gap-2">
                        <div className="w-8 h-8 border-3 border-accent border-t-transparent rounded-full animate-spin" />
                        <span className="text-[11px] font-mono font-bold text-secondary">Loading Page {idx + 1}...</span>
                      </div>
                    )}

                    {/* Page Download Error & Retry Button */}
                    {isError && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-app/90 text-primary gap-3 p-4 text-center">
                        <div className="w-10 h-10 rounded-full bg-danger/20 text-danger flex items-center justify-center">
                          <X className="w-5 h-5" />
                        </div>
                        <p className="text-xs font-bold text-secondary">Failed to load Page {idx + 1}</p>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            loaderRef.current?.retryPage(idx);
                          }}
                          className="px-4 py-2 rounded-xl bg-accent hover:bg-accent-bright text-accent-fg font-bold text-xs flex items-center gap-1.5 shadow-lg transition-all"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>Retry Loading</span>
                        </button>
                      </div>
                    )}

                    {settings.showPageNumberOverlay && (
                      <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded-md bg-app/40 backdrop-blur-[2px] text-[10px] text-secondary/80 font-mono border border-edge/40 pointer-events-none">
                        Page {idx + 1} / {chapterData.pages.length}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* End of Chapter Navigation Card */}
              <div className="w-full p-8 my-8 bg-surface border border-edge rounded-2xl text-center space-y-4 max-w-lg mx-auto shadow-2xl relative z-30">
                <div className="w-12 h-12 rounded-2xl bg-success/10 text-success border border-success/20 flex items-center justify-center mx-auto">
                  <CheckCircle className="w-6 h-6" />
                </div>

                <div className="space-y-1">
                  <h3 className="text-xl font-black text-primary">Finished Chapter {currentChapterNum}</h3>
                  <p className="text-xs text-secondary">Marked read in your library.</p>
                </div>

                <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
                  <button
                    onClick={onClose}
                    className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-elevated hover:bg-elevated text-primary font-bold text-xs"
                  >
                    Back to Library
                  </button>

                  {chapterData.nextChapterNumber && (
                    <button
                      onClick={() => setCurrentChapterNum(chapterData.nextChapterNumber!)}
                      className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-gradient-to-r from-accent to-accent-2 hover:from-accent-bright hover:to-accent-2 text-accent-fg font-bold text-xs shadow-lg flex items-center justify-center gap-2"
                    >
                      <span>Read Chapter {chapterData.nextChapterNumber}</span>
                      <ChevronRight className="w-4 h-4 stroke-[3]" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* SINGLE / DOUBLE BOOK SPREAD / RTL / LTR PAGE MODE WITH TOUCH TAP ZONES */
          <div className="min-h-[85vh] flex flex-col items-center justify-center p-4 relative select-none">
            <div
              className={`relative w-full mx-auto flex items-center justify-center ${
                settings.viewMode === 'double' ? 'max-w-6xl' : ''
              }`}
              style={{ maxWidth: settings.viewMode === 'double' ? '1200px' : settings.maxWidth }}
            >
              {settings.viewMode === 'double' && chapterData ? (
                /* DOUBLE-PAGE SPREAD RENDERING */
                (() => {
                  const isCover = currentPageIndex === 0;
                  const idx1 = currentPageIndex;
                  const idx2 = !isCover && currentPageIndex + 1 < chapterData.pages.length ? currentPageIndex + 1 : null;
                  
                  // For RTL (Manga), the earlier page is on the right, later on the left.
                  const isRtl = detectMangaFormat(manga) === 'manga';
                  const leftIndex = isRtl ? idx2 : idx1;
                  const rightIndex = isRtl ? idx1 : idx2;

                  return (
                    <div className="flex items-center justify-center gap-1 w-full max-h-[85vh]">
                      {leftIndex !== null && chapterData.pages[leftIndex] && (
                        <div className="flex-1 flex justify-end">
                          <img
                            src={pageLoadStates.get(leftIndex)?.blobUrl || chapterData.pages[leftIndex]}
                            alt={`Page ${leftIndex + 1}`}
                            style={imageFilterStyle}
                            className="max-h-[82vh] w-auto object-contain rounded-l-xl shadow-2xl border-r border-edge/30"
                          />
                        </div>
                      )}
                      {rightIndex !== null && chapterData.pages[rightIndex] && (
                        <div className="flex-1 flex justify-start">
                          <img
                            src={pageLoadStates.get(rightIndex)?.blobUrl || chapterData.pages[rightIndex]}
                            alt={`Page ${rightIndex + 1}`}
                            style={imageFilterStyle}
                            className="max-h-[82vh] w-auto object-contain rounded-r-xl shadow-2xl"
                          />
                        </div>
                      )}
                    </div>
                  );
                })()
              ) : (
                /* SINGLE PAGE RENDERING */
                chapterData?.pages[currentPageIndex] && (() => {
                  const pageState = pageLoadStates.get(currentPageIndex);
                  const displaySrc = pageState?.blobUrl || chapterData.pages[currentPageIndex];
                  const isLoading = pageState?.status === 'loading';
                  const isError = pageState?.status === 'error';

                  return (
                    <div className="relative w-full flex items-center justify-center">
                      <img
                        src={displaySrc}
                        alt={`Page ${currentPageIndex + 1}`}
                        style={imageFilterStyle}
                        className={`w-full rounded-xl shadow-2xl transition-all ${
                          settings.mangaFitMode === 'fit-height'
                            ? 'max-h-[82vh] w-auto object-contain'
                            : settings.mangaFitMode === 'fit-width'
                            ? 'w-full h-auto'
                            : 'w-auto h-auto'
                        }`}
                      />

                      {isLoading && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-app/70 backdrop-blur-xs text-accent gap-2 rounded-xl">
                          <div className="w-10 h-10 border-4 border-accent border-t-transparent rounded-full animate-spin" />
                          <span className="text-xs font-mono font-bold text-primary">Loading Page {currentPageIndex + 1}...</span>
                        </div>
                      )}

                      {isError && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-app/90 text-primary gap-3 p-4 text-center rounded-xl">
                          <p className="text-xs font-bold text-secondary">Failed to load Page {currentPageIndex + 1}</p>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              loaderRef.current?.retryPage(currentPageIndex);
                            }}
                            className="px-4 py-2 rounded-xl bg-accent hover:bg-accent-bright text-accent-fg font-bold text-xs flex items-center gap-1.5 shadow-lg"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            <span>Retry Page</span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })()
              )}

              {/* Touch Tap Zone - Left 30% (Prev) */}
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  const step = settings.viewMode === 'double' && currentPageIndex > 0 ? 2 : 1;
                  if (settings.viewMode === 'rtl') {
                    if (currentPageIndex < chapterData!.pages.length - 1) setCurrentPageIndex((prev) => Math.min(prev + step, chapterData!.pages.length - 1));
                  } else {
                    if (currentPageIndex > 0) setCurrentPageIndex((prev) => Math.max(0, prev - step));
                  }
                }}
                className="absolute left-0 top-0 bottom-0 w-[30%] cursor-pointer hover:bg-accent/5 transition-colors flex items-center justify-start pl-4 z-30"
              >
                <div className="p-3 rounded-full bg-surface/80 text-secondary opacity-0 hover:opacity-100 transition-opacity">
                  <ChevronLeft className="w-6 h-6" />
                </div>
              </div>

              {/* Touch Tap Zone - Center 40% (Toggle HUD) */}
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  setShowHud(!showHud);
                }}
                className="absolute left-[30%] right-[30%] top-0 bottom-0 cursor-pointer z-30"
              />

              {/* Touch Tap Zone - Right 30% (Next) */}
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  const step = settings.viewMode === 'double' ? 2 : 1;
                  if (settings.viewMode === 'rtl') {
                    if (currentPageIndex > 0) setCurrentPageIndex((prev) => Math.max(0, prev - step));
                  } else {
                    if (currentPageIndex < chapterData!.pages.length - 1) {
                      setCurrentPageIndex((prev) => Math.min(prev + step, chapterData!.pages.length - 1));
                    } else if (chapterData?.nextChapterNumber) {
                      setCurrentChapterNum(chapterData.nextChapterNumber);
                    }
                  }
                }}
                className="absolute right-0 top-0 bottom-0 w-[30%] cursor-pointer hover:bg-accent/5 transition-colors flex items-center justify-end pr-4 z-30"
              >
                <div className="p-3 rounded-full bg-accent/90 text-accent-fg opacity-0 hover:opacity-100 transition-opacity">
                  <ChevronRight className="w-6 h-6 stroke-[3]" />
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* BOTTOM HUD AUTO-SCROLL GRANULAR SPEED SELECTOR & PAGE SLIDER */}
      {showHud && chapterData && (
        <footer className="sticky bottom-0 z-50 bg-surface/95 backdrop-blur-md border-t border-edge p-3 flex flex-col gap-2.5 text-xs">
          {/* Quick Page Slider */}
          <div className="flex items-center gap-3 max-w-2xl mx-auto w-full">
            <span className="font-mono text-secondary font-bold">1</span>
            <input
              type="range"
              min="0"
              max={chapterData.pages.length - 1}
              value={currentPageIndex}
              onChange={(e) => setCurrentPageIndex(Number(e.target.value))}
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
                onClick={() => setIsAutoScrolling(!isAutoScrolling)}
                className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition-all shadow-md ${
                  isAutoScrolling ? 'bg-accent text-accent-fg' : 'bg-elevated text-secondary hover:text-white'
                }`}
                title="Toggle Auto-Scroll (Space)"
              >
                {isAutoScrolling ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                <span>{isAutoScrolling ? 'Pause' : 'Auto Scroll (Space)'}</span>
              </button>

              {/* Granular Speed Selector Bar */}
              <div className="flex items-center gap-1 bg-app p-1 rounded-lg border border-edge">
                <span className="text-[10px] text-secondary font-bold px-1">Speed:</span>
                {[0.5, 1.0, 1.5, 2.0, 2.5, 3.0].map((spd) => (
                  <button
                    key={spd}
                    onClick={() => {
                      setSettings({ ...settings, autoScrollSpeed: spd });
                      triggerToast(`Auto-Scroll Speed: ${spd}x`);
                    }}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${
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
                onClick={() => setShowPageGridModal(true)}
                className="hover:text-accent flex items-center gap-1 font-semibold text-secondary"
              >
                <Grid className="w-3.5 h-3.5 text-info" />
                <span>Gallery Overview</span>
              </button>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
};
