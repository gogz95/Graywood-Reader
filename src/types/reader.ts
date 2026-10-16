import type { ReaderViewMode, ReaderBgColor, ReaderImageFilter } from '../types';

export type ReadingMode = 'webtoon' | 'single' | 'double' | 'continuous';
export type ReadingDirection = 'rtl' | 'ltr' | 'vertical';
export type ImageFitMode = 'fit-width' | 'fit-height' | 'fit-both' | 'original';
export type ReaderBackgroundTheme = 'black' | 'dark' | 'sepia' | 'white';

export interface ReaderSettings {
  mode: ReadingMode;
  direction: ReadingDirection;
  fit: ImageFitMode;
  seamless: boolean;
  gapPx: number; // 0 for true seamless
  spreadCoverOffset: boolean; // First page standalone in double mode
  backgroundTheme: ReaderBackgroundTheme;

  // Compatibility with existing app settings & legacy layouts
  viewMode?: ReaderViewMode;
  maxWidth?: string;
  pageGap?: number;
  noPanelSpacing?: boolean;
  bgColor?: ReaderBgColor;
  zoomLevel?: number;
  autoMarkRead?: boolean;
  imageFilter?: ReaderImageFilter;
  autoScrollEnabled?: boolean;
  autoScrollSpeed?: number;
  tapZonesEnabled?: boolean;
  cropWhiteMargins?: boolean;
  showPageNumberOverlay?: boolean;
  showPersistentPageBadge?: boolean;
  autoNextChapter?: boolean;
  mangaFitMode?: 'fit-height' | 'fit-width' | 'original';
  preloadCount?: number;
  autoFormatMode?: boolean;
  rememberPerSeries?: boolean;
  guidedPanelView?: boolean;
  prefetchNextChapter?: boolean;
  splitLandscapeSpreads?: boolean;
  smartWebtoonify?: boolean;
  enableAiInpainting?: boolean;
  inPlaceTranslation?: boolean;
  targetTranslationLang?: string;
  epubFontFamily?: 'serif' | 'sans' | 'dyslexic' | 'mono';
  epubFontSize?: number;
  epubLineHeight?: number;
  epubLetterSpacing?: number;
  epubTextAlign?: 'left' | 'justify' | 'center';
}

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  mode: 'webtoon',
  direction: 'vertical',
  fit: 'fit-width',
  seamless: true,
  gapPx: 0,
  spreadCoverOffset: true,
  backgroundTheme: 'dark',

  viewMode: 'webtoon-seamless',
  maxWidth: '850px',
  pageGap: 0,
  noPanelSpacing: true,
  bgColor: 'slate',
  zoomLevel: 100,
  autoMarkRead: true,
  imageFilter: 'normal',
  autoScrollEnabled: false,
  autoScrollSpeed: 1.0,
  tapZonesEnabled: true,
  cropWhiteMargins: true,
  showPageNumberOverlay: true,
  showPersistentPageBadge: true,
  autoNextChapter: true,
  mangaFitMode: 'fit-width',
  preloadCount: 3,
  autoFormatMode: true,
  rememberPerSeries: true,
  guidedPanelView: false,
  prefetchNextChapter: true,
  splitLandscapeSpreads: true,
  smartWebtoonify: false,
  enableAiInpainting: false,
  inPlaceTranslation: false,
  targetTranslationLang: 'en',
};

/**
 * Normalizes any partial or legacy ReaderSettings object into a complete,
 * synchronized contract fulfilling both modern and legacy properties.
 */
export function normalizeReaderSettings(raw?: Partial<ReaderSettings> | null): ReaderSettings {
  const merged: ReaderSettings = {
    ...DEFAULT_READER_SETTINGS,
    ...(raw || {}),
  };

  // Derive mode, seamless, gapPx, direction if provided through legacy viewMode
  if (!raw?.mode && raw?.viewMode) {
    if (raw.viewMode === 'webtoon-seamless') {
      merged.mode = 'webtoon';
      merged.seamless = true;
      merged.gapPx = 0;
      merged.direction = 'vertical';
    } else if (raw.viewMode === 'webtoon') {
      merged.mode = 'webtoon';
      merged.seamless = false;
      merged.gapPx = raw.pageGap ?? 8;
      merged.direction = 'vertical';
    } else if (raw.viewMode === 'rtl') {
      merged.mode = 'single';
      merged.direction = 'rtl';
      merged.seamless = false;
    } else if (raw.viewMode === 'ltr') {
      merged.mode = 'single';
      merged.direction = 'ltr';
      merged.seamless = false;
    } else if (raw.viewMode === 'double') {
      merged.mode = 'double';
      merged.direction = raw.direction || 'rtl';
      merged.seamless = false;
    } else if (raw.viewMode === 'vertical-paged') {
      merged.mode = 'single';
      merged.direction = 'vertical';
      merged.seamless = false;
    }
  }

  // Derive legacy viewMode & noPanelSpacing from mode
  if (merged.mode === 'webtoon') {
    merged.viewMode = merged.seamless || merged.gapPx === 0 ? 'webtoon-seamless' : 'webtoon';
    merged.noPanelSpacing = merged.seamless || merged.gapPx === 0;
  } else if (merged.mode === 'continuous') {
    merged.viewMode = merged.seamless || merged.gapPx === 0 ? 'webtoon-seamless' : 'webtoon';
    merged.noPanelSpacing = merged.seamless || merged.gapPx === 0;
  } else if (merged.mode === 'double') {
    merged.viewMode = 'double';
    merged.noPanelSpacing = false;
  } else if (merged.mode === 'single') {
    if (merged.direction === 'rtl') {
      merged.viewMode = 'rtl';
    } else if (merged.direction === 'vertical') {
      merged.viewMode = 'vertical-paged';
    } else {
      merged.viewMode = 'single';
    }
    merged.noPanelSpacing = false;
  }

  // Synchronize fit <-> mangaFitMode
  if (raw?.fit) {
    if (raw.fit === 'fit-height') merged.mangaFitMode = 'fit-height';
    else if (raw.fit === 'fit-width') merged.mangaFitMode = 'fit-width';
    else if (raw.fit === 'original') merged.mangaFitMode = 'original';
    else merged.mangaFitMode = 'fit-height';
  } else if (raw?.mangaFitMode) {
    if (raw.mangaFitMode === 'fit-height') merged.fit = 'fit-height';
    else if (raw.mangaFitMode === 'fit-width') merged.fit = 'fit-width';
    else if (raw.mangaFitMode === 'original') merged.fit = 'original';
  }

  // Synchronize backgroundTheme <-> bgColor
  if (raw?.backgroundTheme) {
    if (raw.backgroundTheme === 'black') merged.bgColor = 'black';
    else if (raw.backgroundTheme === 'dark') merged.bgColor = 'slate';
    else if (raw.backgroundTheme === 'sepia') merged.bgColor = 'sepia';
    else if (raw.backgroundTheme === 'white') merged.bgColor = 'white';
  } else if (raw?.bgColor) {
    if (raw.bgColor === 'black') merged.backgroundTheme = 'black';
    else if (raw.bgColor === 'slate' || raw.bgColor === 'charcoal') merged.backgroundTheme = 'dark';
    else if (raw.bgColor === 'sepia') merged.backgroundTheme = 'sepia';
    else if (raw.bgColor === 'white') merged.backgroundTheme = 'white';
  }

  // Ensure gapPx and pageGap remain in sync
  if (merged.seamless) {
    merged.gapPx = 0;
    merged.pageGap = 0;
  } else {
    merged.pageGap = merged.gapPx;
  }

  return merged;
}
