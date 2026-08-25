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
  PageStickyNote,
  isNsfwManga,
} from '../types';
import {
  detectMangaFormat,
  getRecommendedReadingMode,
  resolveInitialReaderSettings,
  saveSeriesReadingMode,
  saveFormatReadingMode,
  saveLastUsedReadingMode,
  fetchSeriesReadingModeFromServer,
  pushSeriesReadingModeToServer,
} from '../utils/readingMode';
import { ReaderHeader } from './reader/ReaderHeader';
import { ReaderFooter } from './reader/ReaderFooter';
import { ReaderSettingsModal } from './reader/ReaderSettingsModal';
import { PageGridModal } from './reader/PageGridModal';
import { StickyNotesDrawer } from './reader/StickyNotesDrawer';
import { ShortcutsHelpModal } from './reader/ShortcutsHelpModal';
import { QuickJumpModal } from './reader/QuickJumpModal';
import { AmbientSoundModal } from './reader/AmbientSoundModal';
import { MirrorSourceModal } from './reader/MirrorSourceModal';
import { soundscapes } from '../utils/soundscapes';
import { useGamepadNavigation } from '../hooks/useGamepadNavigation';
import { useLiveReadingSessionSync, RemoteProgressUpdate } from '../hooks/useReaderSession';
import { useReaderZoom } from '../hooks/useReaderZoom';
import { performPanelOcr, OcrResult } from '../utils/ocrEngine';
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
  StickyNote,
  Plus,
  Trash2,
  Edit2,
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
  privateModeEnabled?: boolean;
  onClose: () => void;
  onMarkChapterRead: (chapterNum: number) => void;
  /** Opens the bug-reporting tool pre-filled for the flagged series. */
  onReport: (category: FlagCategory, manga: MangaItem) => void;
  onSaveSettings?: (settings: ReaderSettings) => void;
  isGuest?: boolean;
  onOpenAuthModal?: () => void;
}

interface WebtoonPanelProps {
  idx: number;
  totalPages: number;
  displaySrc: string;
  isLoading: boolean;
  isError: boolean;
  isSeamless: boolean;
  imageFilterStyle?: React.CSSProperties;
  isLoupeActive: boolean;
  showPageNumberOverlay: boolean;
  onMouseMove?: (e: React.MouseEvent<HTMLImageElement>) => void;
  onMouseLeave?: () => void;
  onRetry: (idx: number) => void;
  onDoubleTap?: (clientX: number, clientY: number, rect?: DOMRect) => void;
}

/** Memoized Virtualized Webtoon Panel for smooth 60/120 FPS continuous vertical reading */
const WebtoonPanel = React.memo<WebtoonPanelProps>(({
  idx,
  totalPages,
  displaySrc,
  isLoading,
  isError,
  isSeamless,
  imageFilterStyle,
  isLoupeActive,
  showPageNumberOverlay,
  onMouseMove,
  onMouseLeave,
  onRetry,
  onDoubleTap,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState<boolean>(idx < 4);
  const [cachedHeight, setCachedHeight] = useState<number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting) {
          setIsVisible(true);
        } else {
          // Offscreen beyond 1200px -> unmount heavy image bitmap
          setIsVisible(false);
        }
      },
      {
        rootMargin: '1200px 0px 1200px 0px',
        threshold: 0,
      }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    // Use naturalHeight (intrinsic pixel size) rather than clientHeight (rendered
    // CSS size) so the cached placeholder stays correct after zoom or layout changes.
    const naturalH = e.currentTarget.naturalHeight || e.currentTarget.clientHeight;
    if (naturalH > 50) {
      setCachedHeight(naturalH);
    }
  };

  const handlePanelClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.detail === 2 && onDoubleTap) {
      const rect = containerRef.current?.getBoundingClientRect();
      onDoubleTap(e.clientX, e.clientY, rect);
    }
  };

  return (
    <div
      ref={containerRef}
      onClick={handlePanelClick}
      style={{ minHeight: cachedHeight ? `${cachedHeight}px` : isSeamless ? undefined : '300px' }}
      className={`w-full relative flex items-center justify-center overflow-hidden transition-all reader-page-panel ${
        isSeamless ? 'border-none p-0 m-0 bg-transparent min-h-0' : 'bg-app min-h-[300px] border border-edge/50'
      }`}
    >
      {isVisible ? (
        <img
          src={displaySrc}
          alt={`Page ${idx + 1}`}
          style={imageFilterStyle}
          onMouseMove={onMouseMove}
          onMouseLeave={onMouseLeave}
          onLoad={handleImageLoad}
          decoding="async"
          className={`w-full h-auto block object-contain transition-opacity duration-300 ${
            isSeamless ? 'm-0 p-0 border-0' : ''
          } ${isLoading ? 'opacity-40 blur-xs min-h-[250px]' : 'opacity-100'} ${isLoupeActive ? 'cursor-crosshair' : ''}`}
          loading={idx < 3 ? 'eager' : 'lazy'}
        />
      ) : (
        <div
          className="w-full flex items-center justify-center text-muted/40 font-mono text-[10px]"
          style={{ height: cachedHeight ? `${cachedHeight}px` : '400px' }}
        >
          Page {idx + 1}
        </div>
      )}

      {isVisible && isLoading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center skeleton-shimmer text-accent gap-2">
          <div className="w-8 h-8 border-3 border-accent border-t-transparent rounded-full animate-spin" />
          <span className="text-[11px] font-mono font-bold text-primary bg-app/80 backdrop-blur-sm px-2.5 py-1 rounded-lg border border-edge/60">
            Loading Page {idx + 1}...
          </span>
        </div>
      )}

      {isVisible && isError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-app/90 text-primary gap-3 p-4 text-center">
          <div className="w-10 h-10 rounded-full bg-danger/20 text-danger flex items-center justify-center">
            <X className="w-5 h-5" />
          </div>
          <p className="text-xs font-bold text-secondary">Failed to load Page {idx + 1}</p>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRetry(idx);
            }}
            className="px-4 py-2 rounded-xl bg-accent hover:bg-accent-bright text-accent-fg font-bold text-xs flex items-center gap-1.5 shadow-lg transition-all"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Retry Loading</span>
          </button>
        </div>
      )}

      {showPageNumberOverlay && isVisible && (
        <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded-md bg-app/40 backdrop-blur-[2px] text-[10px] text-secondary/80 font-mono border border-edge/40 pointer-events-none">
          Page {idx + 1} / {totalPages}
        </div>
      )}
    </div>
  );
});

export const ReaderView: React.FC<ReaderViewProps> = ({
  manga,
  initialChapterNumber,
  initialChapterId,
  defaultSettings,
  privateModeEnabled,
  onClose,
  onMarkChapterRead,
  onReport,
  onSaveSettings,
  isGuest = false,
  onOpenAuthModal,
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
  const [showShortcutsModal, setShowShortcutsModal] = useState<boolean>(false);
  const [showQuickJumpModal, setShowQuickJumpModal] = useState<boolean>(false);

  // Selected Scanlation Release Group Version
  const [selectedScanGroup, setSelectedScanGroup] = useState<string>(manga.sourceName || 'AsuraScans');
  const [activeSourceName, setActiveSourceName] = useState<string>(manga.sourceName || '');
  const [activeSourceUrl, setActiveSourceUrl] = useState<string>(manga.sourceUrl || '');
  const [showMirrorModal, setShowMirrorModal] = useState<boolean>(false);

  // High-performance Gesture Pinch-to-Zoom & Double-Tap Hook
  const zoom = useReaderZoom();

  const detectedFormat = useMemo(() => detectMangaFormat(manga), [manga]);

  // Persistent Reader Settings with Format Auto-Detection
  const [settings, setSettingsState] = useState<ReaderSettings>(() =>
    resolveInitialReaderSettings(manga, defaultSettings)
  );

  const setSettings = useCallback(
    (newSettings: ReaderSettings) => {
      hydratedRef.current = true; // user took control — don't let hydration override
      setSettingsState(newSettings);
      saveSeriesReadingMode(manga.id, newSettings);
      saveFormatReadingMode(detectedFormat, newSettings);
      saveLastUsedReadingMode(newSettings);
      // Durable server-side sync so settings roam across devices/browsers.
      pushSeriesReadingModeToServer(manga.id, newSettings);
      if (onSaveSettings) {
        onSaveSettings(newSettings);
      }
    },
    [manga.id, detectedFormat, onSaveSettings]
  );

  // On mount, hydrate per-series reader settings from the server (durable
  // source of truth) and merge any that were saved on another device/browser.
  // Local (localStorage) is the fast first paint; the server wins if it has a
  // snapshot. A `hydratedRef` prevents this from racing a quick user edit.
  const hydratedRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const remote = await fetchSeriesReadingModeFromServer(manga.id);
        if (!remote || cancelled || hydratedRef.current) return;
        hydratedRef.current = true;
        setSettingsState((prev) => ({ ...prev, ...remote }));
      } catch {
        /* best-effort */
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manga.id]);
  // Guard against double-firing mark-read (autoMarkRead on load + 85% scroll),
  // which otherwise sends duplicate mark-read + AniList scrobble calls.
  const markedReadRef = useRef<Set<number>>(new Set());
  const markChapterReadOnce = useCallback(
    (chNum: number) => {
      if (markedReadRef.current.has(chNum)) return;
      markedReadRef.current.add(chNum);
      onMarkChapterRead(chNum);
    },
    [onMarkChapterRead]
  );


  const isWebtoon = settings.viewMode === 'webtoon' || settings.viewMode === 'webtoon-seamless';

  // Auto-scroll state
  const [isAutoScrolling, setIsAutoScrolling] = useState<boolean>(false);
  const [autoNextCountdown, setAutoNextCountdown] = useState<number | null>(null);

  // Ambient Soundscape state
  const [showAmbientModal, setShowAmbientModal] = useState<boolean>(false);
  const [pageTurnSfxEnabled, setPageTurnSfxEnabled] = useState<boolean>(true);

  // Panel Magnifier Loupe Tool state
  const [isLoupeActive, setIsLoupeActive] = useState<boolean>(false);
  const [loupeData, setLoupeData] = useState<{ x: number; y: number; bgX: number; bgY: number; imgSrc: string } | null>(null);

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

  // Private Page Sticky Notes State
  const [stickyNotes, setStickyNotes] = useState<PageStickyNote[]>([]);
  const [showNotesDrawer, setShowNotesDrawer] = useState<boolean>(false);
  const [activeNoteModal, setActiveNoteModal] = useState<{
    pageIndex: number;
    noteId?: string;
    initialText?: string;
    color?: 'yellow' | 'blue' | 'purple' | 'green';
  } | null>(null);
  const [noteInputText, setNoteInputText] = useState<string>('');
  const [noteInputColor, setNoteInputColor] = useState<'yellow' | 'blue' | 'purple' | 'green'>('yellow');

  const fetchNotes = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/notes/${encodeURIComponent(manga.id)}`);
      if (res.ok) {
        const data = await res.json();
        setStickyNotes(data || []);
      }
    } catch (_) {}
  }, [manga.id]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  const handleSaveNote = async () => {
    if (!activeNoteModal || !noteInputText.trim()) return;
    try {
      const res = await apiFetch('/api/notes', {
        method: 'POST',
        body: JSON.stringify({
          id: activeNoteModal.noteId,
          mangaId: manga.id,
          chapterNumber: currentChapterNum,
          pageIndex: activeNoteModal.pageIndex,
          noteText: noteInputText.trim(),
          color: noteInputColor,
        }),
      });
      if (res.ok) {
        fetchNotes();
        setActiveNoteModal(null);
        setNoteInputText('');
        triggerToast('Sticky note pinned to page!');
      }
    } catch (err: any) {
      triggerToast(`Failed to save note: ${err.message}`);
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    try {
      const res = await apiFetch(`/api/notes/${encodeURIComponent(noteId)}`, { method: 'DELETE' });
      if (res.ok) {
        setStickyNotes((prev) => prev.filter((n) => n.id !== noteId));
        triggerToast('Note deleted');
      }
    } catch (err: any) {
      triggerToast(`Failed to delete: ${err.message}`);
    }
  };

  const [isFlagged, setIsFlagged] = useState<boolean>(Boolean(manga.isFlagged));
  const [flagReason, setFlagReason] = useState<string>(manga.flagReason || '');
  const [showFlagDropdown, setShowFlagDropdown] = useState<boolean>(false);

  // Panel OCR State
  const [ocrActive, setOcrActive] = useState<boolean>(false);
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null);
  const [ocrLoading, setOcrLoading] = useState<boolean>(false);

  // EPUB Reflowable Text Content State
  const [epubChapterHtml, setEpubChapterHtml] = useState<string | null>(null);

  // Live SSE Session Sync across all devices / active tabs
  useLiveReadingSessionSync((update: RemoteProgressUpdate) => {
    if (update.mangaId === manga.id && update.chapterNumber !== currentChapterNum) {
      triggerToast(`Synced reading progress from remote device (Chapter ${update.chapterNumber})`);
      setCurrentChapterNum(update.chapterNumber);
    }
  });

  // Gamepad & Bluetooth Remotes & Stylus Navigation
  useGamepadNavigation({
    onNextPage: () => {
      if (pageTurnSfxEnabled) soundscapes.playPageTurn();
      if (settings.viewMode === 'rtl' && chapterData) {
        if (currentPageIndex > 0) setCurrentPageIndex((prev) => prev - 1);
      } else if (chapterData) {
        if (currentPageIndex < chapterData.pages.length - 1) {
          setCurrentPageIndex((prev) => prev + 1);
        } else if (chapterData.nextChapterNumber) {
          setCurrentChapterNum(chapterData.nextChapterNumber);
        }
      }
    },
    onPrevPage: () => {
      if (pageTurnSfxEnabled) soundscapes.playPageTurn();
      if (settings.viewMode === 'rtl' && chapterData) {
        if (currentPageIndex < chapterData.pages.length - 1) setCurrentPageIndex((prev) => prev + 1);
      } else if (chapterData) {
        if (currentPageIndex > 0) {
          setCurrentPageIndex((prev) => prev - 1);
        } else if (chapterData.prevChapterNumber) {
          setCurrentChapterNum(chapterData.prevChapterNumber);
        }
      }
    },
    onScrollUp: () => {
      if (scrollContainerRef.current) scrollContainerRef.current.scrollBy({ top: -300, behavior: 'smooth' });
    },
    onScrollDown: () => {
      if (scrollContainerRef.current) scrollContainerRef.current.scrollBy({ top: 300, behavior: 'smooth' });
    },
    onToggleHud: () => setShowHud((prev) => !prev),
  });

  // Chapter N+1 Silent Background Prefetch Worker
  const prefetchedChapterRef = useRef<number | null>(null);

  useEffect(() => {
    if (!chapterData || !chapterData.nextChapterNumber || settings.prefetchNextChapter === false) return;
    const nextCh = chapterData.nextChapterNumber;
    if (prefetchedChapterRef.current === nextCh) return;

    const shouldPrefetch = isWebtoon
      ? readProgressPercent >= 70
      : currentPageIndex >= Math.max(0, (chapterData.pages?.length || 1) - 3);

    if (shouldPrefetch) {
      prefetchedChapterRef.current = nextCh;
      apiFetch(`/api/reader/chapter-pages?mangaId=${encodeURIComponent(manga.id)}&chapterNumber=${nextCh}`)
        .then((res) => res.json())
        .then(async (nextData: ChapterData) => {
          if (nextData && nextData.pages && nextData.pages.length > 0 && !nextData.isPlaceholder) {
            nextData.pages.slice(0, 6).forEach((url) => {
              const img = new Image();
              img.src = url;
            });
          }
        })
        .catch(() => {});
    }
  }, [readProgressPercent, currentPageIndex, chapterData, isWebtoon, manga.id, settings.prefetchNextChapter]);

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
  const fetchChapterPages = useCallback(async (chNum: number, overrideUrl?: string) => {
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

      const effectiveUrl = overrideUrl || activeSourceUrl || manga.sourceUrl;
      const url = `/api/reader/chapter-pages?mangaId=${encodeURIComponent(
        manga.id
      )}&chapterNumber=${chNum}${initialChapterId ? `&chapterId=${encodeURIComponent(initialChapterId)}` : ''}${effectiveUrl ? `&url=${encodeURIComponent(effectiveUrl)}` : ''}${manga.title ? `&title=${encodeURIComponent(manga.title)}` : ''}`;
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
        const loader = new KotatsuImageLoader(data.pages, effectiveUrl, (states) => {
          setPageLoadStates(new Map(states));
        });
        loaderRef.current = loader;
        loader.setActiveIndex(resumePage);
      }

      if (settings.autoMarkRead && !data.isPlaceholder && !data.contentUnavailable && data.pages?.length) {
        markChapterReadOnce(chNum);
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
  }, [initialChapterId, manga.id, manga.sourceUrl, activeSourceUrl, settings.autoMarkRead, markChapterReadOnce]);

  const handleSelectSource = useCallback(async (sourceName: string, sourceUrl: string, persistToDatabase: boolean) => {
    setActiveSourceName(sourceName);
    setActiveSourceUrl(sourceUrl);
    setShowMirrorModal(false);
    triggerToast(`Switched source to ${sourceName}`);

    if (persistToDatabase) {
      try {
        await apiFetch(`/api/manga/${encodeURIComponent(manga.id)}`, {
          method: 'PUT',
          body: JSON.stringify({
            sourceName,
            sourceUrl,
          }),
        });
      } catch (e) {
        console.error('Failed to persist source to database', e);
      }
    }

    fetchChapterPages(currentChapterNum, sourceUrl);
  }, [manga.id, currentChapterNum, fetchChapterPages, triggerToast]);

  useEffect(() => {
    fetchChapterPages(currentChapterNum);
    markedReadRef.current.clear();

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
      const pIdx = settings.viewMode === 'vertical-paged'
        ? Math.min(chapterData.pages.length - 1, Math.max(0, Math.round(scrollTop / window.innerHeight)))
        : Math.min(
            chapterData.pages.length - 1,
            Math.floor((scrollTop / (scrollHeight - clientHeight + 1)) * chapterData.pages.length)
          );
      setCurrentPageIndex(pIdx);
    }

    if (percent > 85 && settings.autoMarkRead) {
      markChapterReadOnce(currentChapterNum);
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
  }, [scrollContainerRef, chapterData, settings.autoMarkRead, markChapterReadOnce, settings.autoNextChapter, autoNextCountdown, triggerToast, setAutoNextCountdown, setCurrentChapterNum, currentChapterNum, settings.viewMode]);

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

  // Keyboard Navigation (Space for Auto-scroll, A/D, Arrow keys, F, G, H, B, S)
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
        if (pageTurnSfxEnabled) soundscapes.playPageTurn();
        if (settings.viewMode === 'rtl' && chapterData) {
          if (currentPageIndex > 0) setCurrentPageIndex((prev) => prev - 1);
        } else if (settings.viewMode === 'vertical-paged' && scrollContainerRef.current) {
          e.preventDefault();
          const el = scrollContainerRef.current;
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4) {
            if (chapterData?.nextChapterNumber) setCurrentChapterNum(chapterData.nextChapterNumber);
          } else {
            el.scrollBy({ top: window.innerHeight, behavior: 'smooth' });
          }
        } else if (chapterData) {
          if (currentPageIndex < chapterData.pages.length - 1) {
            setCurrentPageIndex((prev) => prev + 1);
          } else if (chapterData.nextChapterNumber) {
            setCurrentChapterNum(chapterData.nextChapterNumber);
          }
        }
      } else if (e.key === 'ArrowLeft' || e.key === 'a') {
        if (pageTurnSfxEnabled) soundscapes.playPageTurn();
        if (settings.viewMode === 'rtl' && chapterData) {
          if (currentPageIndex < chapterData.pages.length - 1) setCurrentPageIndex((prev) => prev + 1);
        } else if (settings.viewMode === 'vertical-paged' && scrollContainerRef.current) {
          e.preventDefault();
          scrollContainerRef.current.scrollBy({ top: -window.innerHeight, behavior: 'smooth' });
        } else if (chapterData) {
          if (currentPageIndex > 0) {
            setCurrentPageIndex((prev) => prev - 1);
          } else if (chapterData.prevChapterNumber) {
            setCurrentChapterNum(chapterData.prevChapterNumber);
          }
        }
      } else if (e.key === 'ArrowDown' || e.key === 'j') {
        if (isWebtoon || settings.viewMode === 'vertical-paged') {
          if (scrollContainerRef.current) {
            e.preventDefault();
            const step = settings.viewMode === 'vertical-paged' ? window.innerHeight : (settings.guidedPanelView ? window.innerHeight * 0.75 : 250);
            scrollContainerRef.current.scrollBy({ top: step, behavior: 'smooth' });
          }
        }
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        if (isWebtoon || settings.viewMode === 'vertical-paged') {
          if (scrollContainerRef.current) {
            e.preventDefault();
            const step = settings.viewMode === 'vertical-paged' ? window.innerHeight : (settings.guidedPanelView ? window.innerHeight * 0.75 : 250);
            scrollContainerRef.current.scrollBy({ top: -step, behavior: 'smooth' });
          }
        }
      } else if (e.key === 'n') {
        setNoteInputText('');
        setNoteInputColor('yellow');
        setActiveNoteModal({ pageIndex: currentPageIndex });
      } else if (e.key === 'm' || e.key === 'M') {
        setIsLoupeActive((prev) => {
          const next = !prev;
          triggerToast(next ? 'Panel Magnifier: Active (hover image)' : 'Panel Magnifier: Disabled');
          return next;
        });
      } else if (e.key === 'f') {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => {});
        } else {
          document.exitFullscreen().catch(() => {});
        }
      } else if (e.key === 'g' || e.key === 'G') {
        setShowQuickJumpModal((prev) => !prev);
      } else if (e.key === '?' || e.key === 'h' || e.key === 'H') {
        setShowShortcutsModal((prev) => !prev);
      } else if (e.key === '+' || e.key === '=') {
        const nextSpeed = Math.min(5.0, Number((settings.autoScrollSpeed + 0.5).toFixed(1)));
        setSettings({ ...settings, autoScrollSpeed: nextSpeed });
        triggerToast(`Auto-Scroll Speed: ${nextSpeed}x`);
      } else if (e.key === '-' || e.key === '_') {
        const nextSpeed = Math.max(0.5, Number((settings.autoScrollSpeed - 0.5).toFixed(1)));
        setSettings({ ...settings, autoScrollSpeed: nextSpeed });
        triggerToast(`Auto-Scroll Speed: ${nextSpeed}x`);
      } else if (e.key === 'b' || e.key === 'B') {
        toggleBookmarkPage(currentPageIndex);
      } else if (e.key === 's' || e.key === 'S') {
        setShowSettings((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [settings.viewMode, settings.guidedPanelView, currentPageIndex, chapterData, settings.autoScrollSpeed, isWebtoon, toggleBookmarkPage]);

  // Gamepad Controller Support (e.g. 8BitDo, Bluetooth remote, Xbox, PlayStation controllers)
  useEffect(() => {
    let animId: number;
    let lastButtonPress = 0;

    const pollGamepad = () => {
      const gamepads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
      for (const gp of gamepads) {
        if (!gp) continue;
        const now = Date.now();
        if (now - lastButtonPress > 250) {
          // D-Pad Right (button 15), R1 (button 5), or A (button 0) -> Next
          if (gp.buttons[15]?.pressed || gp.buttons[5]?.pressed) {
            lastButtonPress = now;
            if (settings.viewMode === 'rtl' && chapterData) {
              if (currentPageIndex > 0) setCurrentPageIndex((prev) => prev - 1);
            } else if (chapterData) {
              if (currentPageIndex < chapterData.pages.length - 1) {
                setCurrentPageIndex((prev) => prev + 1);
              } else if (chapterData.nextChapterNumber) {
                setCurrentChapterNum(chapterData.nextChapterNumber);
              }
            }
          }
          // D-Pad Left (button 14) or L1 (button 4) -> Prev
          else if (gp.buttons[14]?.pressed || gp.buttons[4]?.pressed) {
            lastButtonPress = now;
            if (settings.viewMode === 'rtl' && chapterData) {
              if (currentPageIndex < chapterData.pages.length - 1) setCurrentPageIndex((prev) => prev + 1);
            } else if (chapterData) {
              if (currentPageIndex > 0) {
                setCurrentPageIndex((prev) => prev - 1);
              } else if (chapterData.prevChapterNumber) {
                setCurrentChapterNum(chapterData.prevChapterNumber);
              }
            }
          }
          // Y button (button 3) -> Toggle Auto-Scroll
          else if (gp.buttons[3]?.pressed) {
            lastButtonPress = now;
            setIsAutoScrolling((prev) => {
              const next = !prev;
              triggerToast(next ? `Auto-Scroll Started (${settings.autoScrollSpeed}x)` : 'Auto-Scroll Paused');
              return next;
            });
          }
          // X button (button 2) -> Toggle HUD
          else if (gp.buttons[2]?.pressed) {
            lastButtonPress = now;
            setShowHud((prev) => !prev);
          }
        }
      }
      animId = requestAnimationFrame(pollGamepad);
    };

    animId = requestAnimationFrame(pollGamepad);
    return () => cancelAnimationFrame(animId);
  }, [chapterData, currentPageIndex, settings.viewMode, settings.autoScrollSpeed, triggerToast]);

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

  // Canvas background style mapping
  const bgStyleClass = useMemo(() => {
    if (settings.bgColor === 'black') return 'bg-black text-primary';
    if (settings.bgColor === 'charcoal') return 'bg-zinc-950 text-primary';
    if (settings.bgColor === 'sepia') return 'bg-[#1c1813] text-[#e8d5b7]';
    if (settings.bgColor === 'white') return 'bg-slate-100 text-accent-fg';
    return 'bg-app text-primary';
  }, [settings.bgColor]);

  // CSS Image Filters Mapping (Including OLED pitch black, Warm Amber, E-Ink and Line-Art Sharpener)
  const imageFilterStyle = useMemo(() => {
    if (settings.imageFilter === 'warm-amber') return { filter: 'sepia(45%) hue-rotate(-20deg) contrast(98%) brightness(95%)' };
    if (settings.imageFilter === 'oled') return { filter: 'contrast(135%) brightness(90%)' };
    if (settings.imageFilter === 'grayscale') return { filter: 'grayscale(100%)' };
    if (settings.imageFilter === 'sepia') return { filter: 'sepia(75%) contrast(100%) brightness(95%)' };
    if (settings.imageFilter === 'invert') return { filter: 'invert(100%) hue-rotate(180deg)' };
    if (settings.imageFilter === 'brightness') return { filter: 'contrast(120%) brightness(110%)' };
    if (settings.imageFilter === 'e-ink') return { filter: 'grayscale(100%) contrast(175%) brightness(105%)' };
    if (settings.imageFilter === 'dithered-1bit') return { filter: 'grayscale(100%) contrast(250%) brightness(110%) drop-shadow(0px 0px 1px #000)' };
    if (settings.imageFilter === 'sharpener') return { filter: 'contrast(125%) brightness(98%) drop-shadow(0px 0px 0.5px rgba(0,0,0,0.8))' };
    if (settings.imageFilter === 'high-contrast') return { filter: 'contrast(140%) brightness(100%)' };
    return {};
  }, [settings.imageFilter]);

  const currentChapterNotes = useMemo(() => {
    return stickyNotes.filter((n) => Number(n.chapterNumber) === Number(currentChapterNum));
  }, [stickyNotes, currentChapterNum]);

  const totalChaptersList = useMemo(() => {
    return Array.from({
      length: Math.max(manga.latestChapter, manga.currentChapter, 10),
    }, (_, i) => i + 1).reverse();
  }, [manga.latestChapter, manga.currentChapter]);

  const handleImageMouseMove = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!isLoupeActive) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    const relX = Math.max(0, Math.min(100, ((x - rect.left) / rect.width) * 100));
    const relY = Math.max(0, Math.min(100, ((y - rect.top) / rect.height) * 100));
    setLoupeData({ x, y, bgX: relX, bgY: relY, imgSrc: e.currentTarget.src });
  };

  const handleImageMouseLeave = () => {
    if (isLoupeActive) setLoupeData(null);
  };

  if (isGuest && isNsfwManga(manga)) {
    return (
      <div className="fixed inset-0 z-50 bg-app/95 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center">
        <div className="max-w-md w-full bg-surface border border-rose-500/40 rounded-3xl p-8 shadow-2xl space-y-5">
          <div className="w-16 h-16 rounded-3xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-3xl flex items-center justify-center mx-auto">
            🔞
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-black text-primary">18+ Adult Content Restricted</h2>
            <p className="text-xs text-secondary leading-relaxed">
              This series contains 18+ adult explicit material. Guest users cannot view NSFW content. Please sign in to read this series.
            </p>
          </div>
          <div className="flex flex-col gap-2.5 pt-2">
            <button
              onClick={() => {
                onClose();
                onOpenAuthModal?.();
              }}
              className="w-full py-3 rounded-2xl bg-rose-600 hover:bg-rose-500 text-white font-black text-sm shadow-lg shadow-rose-600/30 transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              Sign In to Read
            </button>
            <button
              onClick={onClose}
              className="w-full py-2.5 rounded-2xl bg-elevated hover:bg-elevated text-secondary hover:text-primary font-bold text-xs transition-colors"
            >
              Return to Library
            </button>
          </div>
        </div>
      </div>
    );
  }

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
        <ReaderHeader
          manga={manga}
          currentChapterNum={currentChapterNum}
          selectedScanGroup={selectedScanGroup}
          chapterData={chapterData}
          settings={settings}
          isWebtoon={isWebtoon}
          hasMultipleSources={hasMultipleSources}
          availableScanGroups={availableScanGroups}
          totalChaptersList={totalChaptersList}
          showChapterMenu={showChapterMenu}
          showGroupMenu={showGroupMenu}
          currentChapterNotes={currentChapterNotes}
          showNotesDrawer={showNotesDrawer}
          isOfflineAvailable={isOfflineAvailable}
          isDownloadingOffline={isDownloadingOffline}
          downloadProgress={downloadProgress}
          privateModeEnabled={privateModeEnabled}
          isAmbientActive={soundscapes.getCurrentPreset() !== 'off'}
          onOpenAmbientModal={() => setShowAmbientModal(true)}
          isLoupeActive={isLoupeActive}
          onToggleLoupe={() => {
            setIsLoupeActive((prev) => {
              const next = !prev;
              triggerToast(next ? 'Panel Magnifier: Active' : 'Panel Magnifier: Disabled');
              return next;
            });
          }}
          onOpenMirrorModal={() => setShowMirrorModal(true)}
          zoomScale={zoom.scale}
          onZoomIn={zoom.zoomIn}
          onZoomOut={zoom.zoomOut}
          onResetZoom={zoom.resetZoom}
          onClose={onClose}
          onPrevChapter={() => chapterData?.prevChapterNumber && setCurrentChapterNum(chapterData.prevChapterNumber)}
          onNextChapter={() => chapterData?.nextChapterNumber && setCurrentChapterNum(chapterData.nextChapterNumber)}
          onSelectChapter={(ch) => {
            setCurrentChapterNum(ch);
            setShowChapterMenu(false);
          }}
          onToggleChapterMenu={() => setShowChapterMenu(!showChapterMenu)}
          onToggleGroupMenu={() => setShowGroupMenu(!showGroupMenu)}
          onSelectScanGroup={(name) => {
            setSelectedScanGroup(name);
            setShowGroupMenu(false);
            triggerToast(`Switched scanlation group to ${name}`);
          }}
          onToggleNotesDrawer={() => setShowNotesDrawer(!showNotesDrawer)}
          onDownloadOffline={handleDownloadChapter}
          onToggleViewMode={() => {
            const nextMode: ReaderViewMode = isWebtoon ? 'rtl' : 'webtoon-seamless';
            setSettings({
              ...settings,
              viewMode: nextMode,
              noPanelSpacing: nextMode === 'webtoon-seamless',
              pageGap: nextMode === 'webtoon-seamless' ? 0 : 8,
            });
            triggerToast(nextMode === 'rtl' ? 'Switched to 🇯🇵 Manga (RTL)' : 'Switched to 📱 Webtoon (Seamless 0px)');
          }}
          onToggleFullscreen={() => {
            if (!document.fullscreenElement) {
              document.documentElement.requestFullscreen().catch(() => {});
            } else {
              document.exitFullscreen().catch(() => {});
            }
          }}
        />
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
        <PageGridModal
          chapterData={chapterData}
          currentPageIndex={currentPageIndex}
          bookmarkedPages={bookmarkedPages}
          isWebtoon={isWebtoon}
          onClose={() => setShowPageGridModal(false)}
          onSelectPage={(idx) => {
            setCurrentPageIndex(idx);
            setShowPageGridModal(false);
            if (isWebtoon && scrollContainerRef.current) {
              const totalH = scrollContainerRef.current.scrollHeight;
              scrollContainerRef.current.scrollTop = (totalH / chapterData.pages.length) * idx;
            }
          }}
        />
      )}

      {/* DISPLAY & SPEED SETTINGS MODAL */}
      {showSettings && (
        <ReaderSettingsModal
          manga={manga}
          detectedFormat={detectedFormat}
          settings={settings}
          isWebtoon={isWebtoon}
          isFlagged={isFlagged}
          onClose={() => setShowSettings(false)}
          onSaveSettings={setSettings}
          onTriggerToast={triggerToast}
          onToggleFlagDropdown={() => setShowFlagDropdown(!showFlagDropdown)}
        />
      )}

      {/* KEYBOARD SHORTCUTS CHEAT SHEET MODAL */}
      {showShortcutsModal && (
        <ShortcutsHelpModal onClose={() => setShowShortcutsModal(false)} />
      )}

      {/* DIRECT PAGE JUMP MODAL */}
      {showQuickJumpModal && chapterData && (
        <QuickJumpModal
          totalPages={chapterData.pages.length}
          currentPage={currentPageIndex}
          onClose={() => setShowQuickJumpModal(false)}
          onJump={(targetIdx) => {
            setCurrentPageIndex(targetIdx);
            if (isWebtoon && scrollContainerRef.current) {
              const totalH = scrollContainerRef.current.scrollHeight;
              scrollContainerRef.current.scrollTop = (totalH / chapterData.pages.length) * targetIdx;
            }
          }}
        />
      )}

      {/* MAIN READER SCROLL CANVAS */}
      <main
        ref={scrollContainerRef}
        onScroll={handleScroll}
        onTouchStart={zoom.handleTouchStart}
        onTouchMove={zoom.handleTouchMove}
        onTouchEnd={zoom.handleTouchEnd}
        onMouseDown={zoom.handleMouseDown}
        onMouseMove={zoom.handleMouseMove}
        onMouseUp={zoom.handleMouseUp}
        onWheel={zoom.handleWheel}
        onClick={() => {
          if (!zoom.isZoomed) {
            setShowHud(!showHud);
          }
        }}
        className={`flex-1 overflow-y-auto overflow-x-hidden p-0 relative ${zoom.isZoomed ? 'cursor-grab' : 'cursor-pointer'}`}
      >
        {loading ? (
          <div className="min-h-[70vh] flex flex-col items-center justify-center p-8 space-y-4 text-center">
            <div className="w-12 h-12 border-4 border-accent border-t-transparent rounded-full animate-spin mx-auto" />
            <div className="space-y-1">
              <h3 className="text-lg font-bold text-primary">Fetching Chapter {currentChapterNum}...</h3>
              <p className="text-xs text-secondary">Scanlation Version: {activeSourceName || selectedScanGroup}</p>
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
                className="px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs flex items-center gap-2 shadow-lg"
              >
                <RefreshCw className="w-4 h-4" />
                Retry Chapter
              </button>
              <button
                onClick={() => setShowMirrorModal(true)}
                className="px-4 py-2 rounded-xl bg-accent/20 border border-accent/40 text-accent font-bold text-xs flex items-center gap-2 hover:bg-accent hover:text-accent-fg transition-all"
              >
                <Globe className="w-4 h-4" />
                Switch Mirror / Source
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
        ) : settings.viewMode === 'reflowable-text' || epubChapterHtml ? (
          /* REFLOWABLE TEXT & EPUB NOVEL VIEWER MODE */
          <div className="min-h-[85vh] w-full flex flex-col items-center justify-center p-4 sm:p-8">
            <div
              className="w-full bg-surface/90 border border-edge/60 rounded-3xl p-6 sm:p-12 shadow-2xl space-y-6"
              style={{
                maxWidth: settings.maxWidth || '800px',
                fontFamily: settings.epubFontFamily || 'system-ui, sans-serif',
                fontSize: `${settings.epubFontSize || 18}px`,
                lineHeight: settings.epubLineHeight || 1.7,
                letterSpacing: `${settings.epubLetterSpacing || 0.2}px`,
              }}
            >
              <div className="border-b border-edge pb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-xl sm:text-2xl font-black text-primary">{manga.title}</h2>
                  <p className="text-xs text-accent font-bold mt-0.5">
                    {chapterData?.title || `Chapter ${currentChapterNum}`}
                  </p>
                </div>
                <span className="px-2.5 py-1 rounded-full text-xs font-black bg-accent/15 text-accent border border-accent/20">
                  Reflowable Novel
                </span>
              </div>

              {epubChapterHtml ? (
                <div
                  className="prose prose-invert max-w-none text-primary leading-relaxed space-y-4"
                  dangerouslySetInnerHTML={{ __html: epubChapterHtml }}
                />
              ) : (
                <div className="space-y-4 text-primary leading-relaxed">
                  <p className="indent-6">
                    {manga.description || 'Chapter text is being rendered in clean reflowable typography. You can customize the font family, font size, margins, and line height via Reader Settings.'}
                  </p>
                  <p className="indent-6">
                    Enhanced with full offline caching, real-time cross-device sync, and customizable e-reader color themes.
                  </p>
                </div>
              )}

              <div className="border-t border-edge pt-6 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => {
                    if (currentChapterNum > 1) setCurrentChapterNum(currentChapterNum - 1);
                  }}
                  disabled={currentChapterNum <= 1}
                  className="px-4 py-2 rounded-xl bg-elevated border border-edge text-xs font-bold text-secondary hover:text-primary disabled:opacity-40 flex items-center gap-1.5"
                >
                  <ChevronLeft className="w-4 h-4" /> Previous Chapter
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentChapterNum(currentChapterNum + 1)}
                  className="px-4 py-2 rounded-xl bg-accent text-accent-fg text-xs font-black shadow-md flex items-center gap-1.5"
                >
                  Next Chapter <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ) : settings.viewMode === 'vertical-paged' && chapterData ? (
          /* PAGED VERTICAL MODE — one viewport-height "page" per block, stacked
             vertically. Reads like a vertical strip but each page snaps to a
             full screen, so standard manga pages don't get stretched into a
             long seamless ribbon. Prev/Next navigate one page at a time. */
          <div className="flex flex-col items-center w-full relative select-none">
            {/* Center Tap — Toggle HUD */}
            <div
              className="fixed left-[30%] right-[30%] top-0 bottom-0 z-10 cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                setShowHud(!showHud);
              }}
            />

            {chapterData.pages.map((pageSrc, idx) => {
              const pageState = pageLoadStates.get(idx);
              const displaySrc = pageState?.blobUrl || pageSrc;
              const isLoading = pageState?.status === 'loading';
              const isError = pageState?.status === 'error';

              return (
                <div
                  key={idx}
                  className="relative w-full flex items-center justify-center"
                  style={{ height: '100vh', maxWidth: settings.maxWidth }}
                  data-page-index={idx}
                >
                  {isLoading ? (
                    <div className="w-10 h-10 border-4 border-accent border-t-transparent rounded-full animate-spin" />
                  ) : isError ? (
                    <div className="flex flex-col items-center gap-2 text-secondary">
                      <AlertTriangle className="w-6 h-6 text-rose-400" />
                      <span className="text-xs font-medium">Page {idx + 1} failed to load</span>
                      <button
                        onClick={() => loaderRef.current?.retryPage(idx)}
                        className="px-2.5 py-1 rounded-lg bg-elevated border border-edge text-primary text-xs font-bold"
                      >
                        Retry
                      </button>
                    </div>
                  ) : (
                    <img
                      src={displaySrc}
                      alt={`Page ${idx + 1}`}
                      style={imageFilterStyle}
                      onMouseMove={handleImageMouseMove}
                      onMouseLeave={handleImageMouseLeave}
                      decoding="async"
                      className="max-h-[100vh] max-w-full w-auto object-contain shadow-2xl"
                    />
                  )}
                  {settings.showPageNumberOverlay && (
                    <span className="absolute bottom-3 right-3 px-2 py-0.5 rounded-full bg-black/50 text-white text-[10px] font-bold">
                      {idx + 1} / {chapterData.pages.length}
                    </span>
                  )}
                </div>
              );
            })}

            {/* Previous page tap zone (left 30%) */}
            <div
              onClick={(e) => {
                e.stopPropagation();
                if (scrollContainerRef.current) {
                  scrollContainerRef.current.scrollBy({ top: -window.innerHeight, behavior: 'smooth' });
                }
              }}
              className="fixed left-0 top-0 bottom-0 w-[30%] cursor-pointer hover:bg-accent/5 transition-colors flex items-center justify-start pl-4 z-10"
            >
              <div className="p-3 rounded-full bg-surface/80 text-secondary opacity-0 hover:opacity-100 transition-opacity">
                <ChevronLeft className="w-6 h-6" />
              </div>
            </div>

            {/* Next page tap zone (right 30%) */}
            <div
              onClick={(e) => {
                e.stopPropagation();
                if (!scrollContainerRef.current) return;
                const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
                if (scrollTop + clientHeight >= scrollHeight - 4) {
                  if (chapterData.nextChapterNumber) setCurrentChapterNum(chapterData.nextChapterNumber);
                } else {
                  scrollContainerRef.current.scrollBy({ top: window.innerHeight, behavior: 'smooth' });
                }
              }}
              className="fixed right-0 top-0 bottom-0 w-[30%] cursor-pointer hover:bg-accent/5 transition-colors flex items-center justify-end pr-4 z-10"
            >
              <div className="p-3 rounded-full bg-accent/90 text-accent-fg opacity-0 hover:opacity-100 transition-opacity">
                <ChevronRight className="w-6 h-6 stroke-[3]" />
              </div>
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
                ...zoom.transformStyle,
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
                  <WebtoonPanel
                    key={idx}
                    idx={idx}
                    totalPages={chapterData.pages.length}
                    displaySrc={displaySrc}
                    isLoading={isLoading}
                    isError={isError}
                    isSeamless={isSeamless}
                    imageFilterStyle={imageFilterStyle}
                    isLoupeActive={isLoupeActive}
                    showPageNumberOverlay={Boolean(settings.showPageNumberOverlay)}
                    onMouseMove={handleImageMouseMove}
                    onMouseLeave={handleImageMouseLeave}
                    onRetry={(pageIdx) => loaderRef.current?.retryPage(pageIdx)}
                    onDoubleTap={zoom.handleDoubleTap}
                  />
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
              style={{
                ...zoom.transformStyle,
                maxWidth: settings.viewMode === 'double' ? '1200px' : settings.maxWidth
              }}
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
                    <div
                      onDoubleClick={(e) => zoom.handleDoubleTap(e.clientX, e.clientY)}
                      className="flex items-center justify-center gap-1 w-full max-h-[85vh]"
                    >
                      {leftIndex !== null && chapterData.pages[leftIndex] && (
                        <div className={`flex-1 flex ${rightIndex === null ? 'justify-center' : 'justify-end'}`}>
                          <img
                            src={pageLoadStates.get(leftIndex)?.blobUrl || chapterData.pages[leftIndex]}
                            alt={`Page ${leftIndex + 1}`}
                            style={imageFilterStyle}
                            onMouseMove={handleImageMouseMove}
                            onMouseLeave={handleImageMouseLeave}
                            decoding="async"
                            className={`max-h-[82vh] w-auto object-contain shadow-2xl ${rightIndex === null ? 'rounded-xl' : 'rounded-l-xl border-r border-edge/30'} ${isLoupeActive ? 'cursor-crosshair' : ''}`}
                          />
                        </div>
                      )}
                      {rightIndex !== null && chapterData.pages[rightIndex] && (
                        <div className="flex-1 flex justify-start">
                          <img
                            src={pageLoadStates.get(rightIndex)?.blobUrl || chapterData.pages[rightIndex]}
                            alt={`Page ${rightIndex + 1}`}
                            style={imageFilterStyle}
                            onMouseMove={handleImageMouseMove}
                            onMouseLeave={handleImageMouseLeave}
                            decoding="async"
                            className={`max-h-[82vh] w-auto object-contain rounded-r-xl shadow-2xl ${isLoupeActive ? 'cursor-crosshair' : ''}`}
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
                    <div
                      onDoubleClick={(e) => zoom.handleDoubleTap(e.clientX, e.clientY)}
                      className="relative w-full flex items-center justify-center"
                    >
                      <img
                        src={displaySrc}
                        alt={`Page ${currentPageIndex + 1}`}
                        style={imageFilterStyle}
                        onMouseMove={handleImageMouseMove}
                        onMouseLeave={handleImageMouseLeave}
                        decoding="async"
                        className={`w-full rounded-xl shadow-2xl transition-all ${
                          settings.mangaFitMode === 'fit-height'
                            ? 'max-h-[82vh] w-auto object-contain'
                            : settings.mangaFitMode === 'fit-width'
                            ? 'w-full h-auto'
                            : 'w-auto h-auto'
                        } ${isLoupeActive ? 'cursor-crosshair' : ''}`}
                      />

                      {isLoading && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center skeleton-shimmer text-accent gap-2 rounded-xl">
                          <div className="w-10 h-10 border-4 border-accent border-t-transparent rounded-full animate-spin" />
                          <span className="text-xs font-mono font-bold text-primary bg-app/80 backdrop-blur-sm px-3 py-1.5 rounded-xl border border-edge/60">
                            Loading Page {currentPageIndex + 1}...
                          </span>
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
        <ReaderFooter
          chapterData={chapterData}
          currentPageIndex={currentPageIndex}
          isAutoScrolling={isAutoScrolling}
          settings={settings}
          onSeekPage={(idx) => setCurrentPageIndex(idx)}
          onToggleAutoScroll={() => setIsAutoScrolling(!isAutoScrolling)}
          onSelectAutoScrollSpeed={(spd) => {
            setSettings({ ...settings, autoScrollSpeed: spd });
            triggerToast(`Auto-Scroll Speed: ${spd}x`);
          }}
          onOpenPageGrid={() => setShowPageGridModal(true)}
        />
      )}

      {/* STICKY NOTES DRAWER & MODAL */}
      {(showNotesDrawer || activeNoteModal) && (
        <StickyNotesDrawer
          showDrawer={showNotesDrawer}
          stickyNotes={stickyNotes}
          currentChapterNum={currentChapterNum}
          currentPageIndex={currentPageIndex}
          activeNoteModal={activeNoteModal}
          noteInputText={noteInputText}
          noteInputColor={noteInputColor}
          onCloseDrawer={() => setShowNotesDrawer(false)}
          onOpenAddModal={(pageIdx) => {
            setNoteInputText('');
            setNoteInputColor('yellow');
            setActiveNoteModal({ pageIndex: pageIdx });
          }}
          onOpenEditModal={(note) => {
            setNoteInputText(note.noteText);
            setNoteInputColor(note.color || 'yellow');
            setActiveNoteModal({
              pageIndex: note.pageIndex,
              noteId: note.id,
              initialText: note.noteText,
              color: note.color,
            });
          }}
          onCloseModal={() => setActiveNoteModal(null)}
          onChangeNoteText={setNoteInputText}
          onChangeNoteColor={setNoteInputColor}
          onSaveNote={handleSaveNote}
          onDeleteNote={handleDeleteNote}
          onJumpToNote={(note) => {
            if (Number(note.chapterNumber) !== Number(currentChapterNum)) {
              setCurrentChapterNum(note.chapterNumber);
            }
            setCurrentPageIndex(note.pageIndex);
            setShowNotesDrawer(false);
            if (isWebtoon && scrollContainerRef.current && chapterData?.pages) {
              const totalH = scrollContainerRef.current.scrollHeight;
              scrollContainerRef.current.scrollTop = (totalH / chapterData.pages.length) * note.pageIndex;
            }
          }}
        />
      )}

      {/* AMBIENT SOUNDSCAPE & SFX MODAL */}
      {showAmbientModal && (
        <AmbientSoundModal
          isOpen={showAmbientModal}
          onClose={() => setShowAmbientModal(false)}
          pageTurnSfxEnabled={pageTurnSfxEnabled}
          onTogglePageTurnSfx={setPageTurnSfxEnabled}
        />
      )}

      {/* FLOATING CIRCULAR PANEL MAGNIFIER / LOUPE LENS */}
      {isLoupeActive && loupeData && (
        <div
          className="pointer-events-none fixed z-9999 w-44 h-44 rounded-full border-2 border-indigo-400 shadow-2xl shadow-indigo-500/50 overflow-hidden ring-4 ring-black/40"
          style={{
            left: `${loupeData.x - 88}px`,
            top: `${loupeData.y - 88}px`,
            backgroundImage: `url(${loupeData.imgSrc})`,
            backgroundPosition: `${loupeData.bgX}% ${loupeData.bgY}%`,
            backgroundSize: '280%',
            backgroundRepeat: 'no-repeat',
          }}
        />
      )}

      {/* PANEL OCR & LIVE TRANSLATION POPOVER */}
      {ocrResult && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[100] max-w-lg w-[90%] bg-surface/95 backdrop-blur-md border border-accent/40 rounded-2xl p-4 shadow-2xl space-y-2 animate-in fade-in slide-in-from-bottom-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-black text-accent">
              <Sparkles className="w-4 h-4" />
              <span>Panel OCR Translation ({ocrResult.detectedLang})</span>
            </div>
            <button
              type="button"
              onClick={() => setOcrResult(null)}
              className="p-1 rounded-lg text-secondary hover:text-primary hover:bg-elevated"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="text-xs text-secondary bg-app/80 p-2.5 rounded-xl border border-edge/60">
            <div className="text-[10px] uppercase font-bold text-muted mb-1">Raw Detected Text:</div>
            <p className="font-serif">{ocrResult.rawText}</p>
          </div>
          <div className="text-sm font-bold text-primary bg-accent/10 p-3 rounded-xl border border-accent/20">
            <div className="text-[10px] uppercase font-bold text-accent mb-1">English Translation:</div>
            <p>{ocrResult.translatedText}</p>
          </div>
        </div>
      )}

      {/* IN-READER MIRROR & SOURCE SWITCHER MODAL */}
      {showMirrorModal && (
        <MirrorSourceModal
          manga={manga}
          currentChapterNum={currentChapterNum}
          activeSourceName={activeSourceName}
          activeSourceUrl={activeSourceUrl}
          onClose={() => setShowMirrorModal(false)}
          onSelectSource={handleSelectSource}
        />
      )}
    </div>
  );
};


