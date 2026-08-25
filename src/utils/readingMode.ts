import { MangaItem, MangaType, ReaderSettings, ReaderViewMode, AppSettings } from '../types';
import { apiFetch } from './api';

const STORAGE_KEY_LAST_GLOBAL = 'graywood_reader_last_settings';
const STORAGE_KEY_FORMAT_PREFIX = 'graywood_reader_format_';
const STORAGE_KEY_SERIES_PREFIX = 'graywood_reader_series_';

/**
 * Detect the underlying reading format of a series (Japanese Manga vs Korean Manhwa vs Chinese Manhua/Webtoon).
 */
export function detectMangaFormat(manga: Partial<MangaItem>): MangaType {
  if (manga.type === 'manga' || manga.type === 'manhwa' || manga.type === 'manhua') {
    return manga.type;
  }

  // Genre / tag heuristics
  const genres = (manga.genres || []).map((g) => String(g).toLowerCase());
  if (genres.some((g) => g.includes('manhwa') || g.includes('webtoon') || g.includes('long strip'))) {
    return 'manhwa';
  }
  if (genres.some((g) => g.includes('manhua'))) {
    return 'manhua';
  }
  if (genres.some((g) => g.includes('manga'))) {
    return 'manga';
  }

  // Source name heuristics
  const src = `${manga.sourceName || ''} ${manga.sourceUrl || ''}`.toLowerCase();
  if (src.includes('asura') || src.includes('flame') || src.includes('manhwa') || src.includes('reaper')) {
    return 'manhwa';
  }
  if (src.includes('manhua') || src.includes('topmanhua') || src.includes('nightscans')) {
    return 'manhua';
  }

  return 'manga';
}

/**
 * Get the recommended reading mode for a given format (e.g. Manga -> RTL, Manhwa/Manhua -> Webtoon).
 */
export function getRecommendedReadingMode(
  manga: Partial<MangaItem>,
  appSettings?: Partial<AppSettings>
): { viewMode: ReaderViewMode; noPanelSpacing: boolean; pageGap: number } {
  const format = detectMangaFormat(manga);

  if (format === 'manga') {
    const mode = appSettings?.defaultMangaMode || 'rtl';
    return {
      viewMode: mode,
      noPanelSpacing: false,
      pageGap: 0,
    };
  }

  if (format === 'manhwa') {
    const mode = appSettings?.defaultManhwaMode || 'webtoon-seamless';
    const isSeamless = mode === 'webtoon-seamless';
    return {
      viewMode: mode,
      noPanelSpacing: isSeamless,
      pageGap: isSeamless ? 0 : (appSettings?.readerDefaults?.pageGap ?? 8),
    };
  }

  // Manhua / other webtoons
  const mode = appSettings?.defaultManhuaMode || 'webtoon-seamless';
  const isSeamless = mode === 'webtoon-seamless';
  return {
    viewMode: mode,
    noPanelSpacing: isSeamless,
    pageGap: isSeamless ? 0 : (appSettings?.readerDefaults?.pageGap ?? 8),
  };
}

/**
 * Read saved series-specific reading settings from localStorage.
 */
export function getSavedSeriesReadingMode(mangaId: string): Partial<ReaderSettings> | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_SERIES_PREFIX}${mangaId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Persist series-specific reading settings to localStorage.
 */
export function saveSeriesReadingMode(mangaId: string, settings: Partial<ReaderSettings>): void {
  try {
    localStorage.setItem(`${STORAGE_KEY_SERIES_PREFIX}${mangaId}`, JSON.stringify(settings));
  } catch {
    // silent fail for private mode / quota exceeded
  }
}

/**
 * Read saved format-specific reading settings from localStorage (manga / manhwa / manhua).
 */
export function getSavedFormatReadingMode(format: MangaType): Partial<ReaderSettings> | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_FORMAT_PREFIX}${format}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Persist format-specific reading settings to localStorage & server appSettings.
 */
export function saveFormatReadingMode(format: MangaType, settings: Partial<ReaderSettings>): void {
  try {
    localStorage.setItem(`${STORAGE_KEY_FORMAT_PREFIX}${format}`, JSON.stringify(settings));
  } catch {
    // silent fail
  }
  if (settings.viewMode) {
    const key = format === 'manga' ? 'defaultMangaMode' : format === 'manhwa' ? 'defaultManhwaMode' : 'defaultManhuaMode';
    apiFetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: settings.viewMode }),
    }).catch(() => {});
  }
}

/**
 * Read the last used global reading settings from localStorage.
 */
export function getLastUsedReadingMode(): Partial<ReaderSettings> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_LAST_GLOBAL);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Persist the last used global reading settings to localStorage & server appSettings.
 */
export function saveLastUsedReadingMode(settings: Partial<ReaderSettings>): void {
  try {
    localStorage.setItem(STORAGE_KEY_LAST_GLOBAL, JSON.stringify(settings));
  } catch {
    // silent fail
  }
  if (settings.viewMode) {
    apiFetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ readerDefaults: { viewMode: settings.viewMode } }),
    }).catch(() => {});
  }
}

/**
 * Resolves the optimal initial ReaderSettings for a series:
 * 1. Series-specific preference (if saved)
 * 2. Format-specific preference (if saved)
 * 3. Intelligent auto-selection based on format (Manga = RTL, Manhwa/Manhua = Webtoon)
 * 4. Global reader defaults
 */
export function resolveInitialReaderSettings(
  manga: MangaItem,
  defaultSettings?: ReaderSettings,
  appSettings?: AppSettings
): ReaderSettings {
  const base: ReaderSettings = {
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
    mangaFitMode: 'fit-height',
    preloadCount: 3,
    autoFormatMode: true,
    rememberPerSeries: true,
    ...(defaultSettings || {}),
  };

  const format = detectMangaFormat(manga);

  // 1. Series-specific saved preference
  const seriesPref = getSavedSeriesReadingMode(manga.id);
  if (seriesPref && Object.keys(seriesPref).length > 0) {
    return { ...base, ...seriesPref };
  }

  // 2. Format-specific saved preference
  const formatPref = getSavedFormatReadingMode(format);
  if (formatPref && Object.keys(formatPref).length > 0) {
    return { ...base, ...formatPref };
  }

  // 3. Auto-format selection (enabled by default)
  const isAutoFormatEnabled = appSettings?.autoFormatReadingMode !== false && base.autoFormatMode !== false;
  if (isAutoFormatEnabled) {
    const recommended = getRecommendedReadingMode(manga, appSettings);
    return {
      ...base,
      viewMode: recommended.viewMode,
      noPanelSpacing: recommended.noPanelSpacing,
      pageGap: recommended.pageGap,
    };
  }

  // 4. Global last used preference fallback
  const lastUsed = getLastUsedReadingMode();
  if (lastUsed && Object.keys(lastUsed).length > 0) {
    return { ...base, ...lastUsed };
  }

  return base;
}

// ---------------------------------------------------------------------------
// Server-side per-series reader setting sync (roams across PWA / Electron /
// other browsers exactly like reading progress does). The local (localStorage)
// snapshot stays the fast first paint; the server is the durable source of
// truth. All calls are best-effort and never throw.
// ---------------------------------------------------------------------------

/**
 * Fetch the server-persisted reader settings for a series.
 * Resolves to `null` when none were saved yet (client keeps local snapshot).
 */
export async function fetchSeriesReadingModeFromServer(mangaId: string): Promise<Partial<ReaderSettings> | null> {
  try {
    const res = await apiFetch(`/api/reader/settings/${encodeURIComponent(mangaId)}`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const data = await res.json();
    const saved = data?.settings;
    return saved && typeof saved === 'object' ? (saved as Partial<ReaderSettings>) : null;
  } catch {
    return null;
  }
}

/**
 * Push the current reader settings for a series to the server (best-effort).
 * Fire-and-forget from the caller — failures are silent and non-blocking.
 */
export async function pushSeriesReadingModeToServer(mangaId: string, settings: Partial<ReaderSettings>): Promise<void> {
  try {
    await apiFetch(`/api/reader/settings/${encodeURIComponent(mangaId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings }),
      signal: AbortSignal.timeout(6000),
    });
  } catch {
    /* offline / server unavailable — local copy remains authoritative until next sync */
  }
}
