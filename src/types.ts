export type ReaderViewMode = 'webtoon' | 'webtoon-seamless' | 'single' | 'double' | 'rtl' | 'ltr' | 'vertical-paged';
export type ReaderBgColor = 'slate' | 'black' | 'charcoal' | 'sepia' | 'white';
export type ReaderImageFilter = 'normal' | 'grayscale' | 'sepia' | 'invert' | 'brightness' | 'oled' | 'e-ink' | 'sharpener' | 'high-contrast';
export type AppTheme = 'amber' | 'emerald' | 'amoled' | 'violet' | 'cyberpunk';
export type MangaType = 'manga' | 'manhwa' | 'manhua';
export type AppNavTab = 'library' | 'browse' | 'sources' | 'settings' | 'autoupdate' | 'duplicates' | 'openapi';


export type SourceEngineType = 'madara' | 'mangathemesia' | 'mangadex' | 'foolslide' | 'wpcomics' | 'custom_html';

export interface SourceDefinition {
  id: string;
  name: string;
  baseUrl: string;
  engineType: SourceEngineType;
  lang: string;
  isNsfw: boolean;
  isEnabled?: boolean;
  isPinned?: boolean;
  // Whether the baseUrl was extracted from a reliable parser declaration
  // (ConfigKey.Domain / base-class constructor). False when derived from the
  // unreliable `<id>.com` fallback and should be reviewed by an operator.
  baseUrlReliable?: boolean;
  selectors?: {
    listContainer?: string;
    itemTitle?: string;
    itemCover?: string;
    chapterList?: string;
    pageImages?: string;
  };
}

export interface UnifiedChapter {
  id: string;
  chapterNumber: number;
  title: string;
  releaseDate: string;
  scanGroup: string;
  url: string;
}



export interface ScanGroupOption {
  id: string;
  name: string;
  quality: string;
  releaseDate: string;
}

export interface ChapterInfo {
  id: string;
  chapterNumber: number;
  title: string;
  releaseDate: string;
  scanGroup: string;
  pageCount: number;
  isRead?: boolean;
  availableGroups?: ScanGroupOption[];
}

export interface ChapterData {
  chapterId: string;
  mangaId: string;
  mangaTitle: string;
  chapterNumber: number;
  title: string;
  scanGroup: string;
  selectedGroup?: string;
  availableGroups?: ScanGroupOption[];
  pages: string[];
  totalChapters: number;
  nextChapterNumber: number | null;
  prevChapterNumber: number | null;
  /** True when the server could not extract live pages */
  isPlaceholder?: boolean;
  /** Human-readable reason when isPlaceholder is true */
  loadError?: string;
  /** True when the chapter has no pages because content is missing/unavailable */
  contentUnavailable?: boolean;
}

export interface ReaderSettings {
  viewMode: ReaderViewMode;
  maxWidth: string; // e.g. '800px', '1000px', '100%'
  pageGap: number; // e.g. 0, 4, 8, 16
  noPanelSpacing?: boolean; // Webtoon seamless mode without spacing between panels
  bgColor: ReaderBgColor;
  zoomLevel: number; // percentage, e.g. 100
  autoMarkRead: boolean;
  imageFilter: ReaderImageFilter;
  autoScrollEnabled: boolean;
  autoScrollSpeed: number; // 0.5 to 3.0
  tapZonesEnabled: boolean;
  cropWhiteMargins: boolean;
  showPageNumberOverlay: boolean;
  showPersistentPageBadge: boolean;
  autoNextChapter: boolean; // Automatic next chapter for webtoons
  mangaFitMode: 'fit-height' | 'fit-width' | 'original';
  preloadCount: number;
  autoFormatMode?: boolean; // Automatically adapt layout based on Manga (RTL) vs Manhwa/Manhua (Webtoon)
  rememberPerSeries?: boolean; // Persist last selected layout per individual series
  guidedPanelView?: boolean; // Snap-to-panel or smooth step advancement for webtoons
  prefetchNextChapter?: boolean; // Seamless background prefetch for chapter N+1
}

export interface PageStickyNote {
  id: string;
  mangaId: string;
  chapterNumber: number;
  pageIndex: number;
  noteText: string;
  createdAt: string;
  updatedAt: string;
  color?: 'yellow' | 'blue' | 'purple' | 'green';
  /** Owner of the note — resolved server-side from the auth token, never trusted from clients. */
  userId?: string;
}

export interface AppSettings {
  appTheme: AppTheme;
  libraryLayout: 'grid' | 'list' | 'compact';
  gridColumns: number;
  autoMarkReadPercent: number;
  enableDownloadOffline: boolean;
  sourceTimeoutSeconds: number;
  anilistConnected: boolean;
  anilistToken?: string;
  anilistAutoSync?: boolean;
  malConnected?: boolean;
  malToken?: string;
  malAutoSync?: boolean;
  kitsuConnected?: boolean;
  kitsuToken?: string;
  kitsuAutoSync?: boolean;
  mangadexConnected: boolean;
  privateModeEnabled?: boolean;
  customUserAgent: string;
  // Automated Cloudflare & Captcha Solver Properties
  enableCloudflareBypass: boolean;
  flareSolverrUrl: string;
  captchaSolverEnabled: boolean;
  captchaApiKey: string;
  stealthMode: boolean;
  preferredLanguage?: string;
  autoFormatReadingMode?: boolean;
  defaultMangaMode?: ReaderViewMode;
  defaultManhwaMode?: ReaderViewMode;
  defaultManhuaMode?: ReaderViewMode;
  // Webhook & Push Notification Properties
  discordWebhookUrl?: string;
  discordWebhookEnabled?: boolean;
  telegramBotToken?: string;
  telegramChatId?: string;
  telegramWebhookEnabled?: boolean;
  notifyOnlyReadingStatus?: boolean;
  // App Lock & Security Properties
  appLockEnabled?: boolean;
  appLockPinHash?: string;
  appLockType?: 'pin' | 'password' | 'biometric';
  appLockTimeoutMinutes?: number;
  // Scheduled Auto-Backups
  autoBackupEnabled?: boolean;
  autoBackupSchedule?: 'hourly' | 'daily' | 'weekly';
  autoBackupMaxCount?: number;
  autoBackupLastRun?: string;
  // Ambient Soundscape & Reader Immersion Properties
  ambientSoundEnabled?: boolean;
  ambientSoundPreset?: 'rain' | 'campfire' | 'waves' | 'cafe' | 'off';
  ambientSoundVolume?: number;
  pageTurnSfxEnabled?: boolean;
  magnifierEnabled?: boolean;
  readerDefaults: ReaderSettings;
}


export type ReadingStatus = 'reading' | 'completed' | 'plan_to_read' | 'on_hold' | 'dropped';

export interface MangaSourceLink {
  sourceName: string;
  sourceUrl: string;
  engineType?: string;
  isReadAvailable?: boolean;
}

export interface MangaItem {
  id: string;
  title: string;
  altTitles: string[];
  type: MangaType;
  coverImage: string;
  description: string;
  genres: string[];
  status: ReadingStatus;
  currentChapter: number;
  totalChapters: number | null; // null if ongoing
  latestChapter: number;
  lastUpdated: string;
  rating: number; // 0-10
  sourceUrl: string;
  sourceName: string;
  availableSources?: MangaSourceLink[];
  autoUpdateEnabled: boolean;
  notes: string;
  addedAt: string;
  lastReadAt: string;
  syncedFromApi?: string | null;
  apiId?: string | null;
  isFavorite?: boolean;
  isFlagged?: boolean;
  flagReason?: string;
  flaggedAt?: string;
  userId?: string; // Owner User ID for privacy isolation
  chapters?: any[];
  /**
   * Names of metadata fields the user manually customized (e.g. 'title',
   * 'description', 'coverImage', 'rating', 'genres', 'altTitles', 'isNsfw').
   * Live metadata refreshes preserve these values so manual edits don't
   * get overwritten. Chapter counters (latestChapter) are always refreshed.
   */
  metadataOverrides?: string[];
  customTags?: string[];
  categories?: string[];
  isNsfw?: boolean;
}

export interface UserCategory {
  id: string;
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  sortOrder: number;
  userId?: string;
  createdAt?: string;
  seriesCount?: number;
  unreadCount?: number;
}

export interface DuplicateCandidate {
  id: string;
  primaryItem: MangaItem;
  secondaryItem: MangaItem;
  similarityScore: number; // 0 - 100
  reason: string;
  suggestedTitle: string;
  mergedAltTitles: string[];
  suggestedGenres: string[];
  suggestedDescription: string;
}

export interface AutoUpdateLog {
  id: string;
  mangaId: string;
  mangaTitle: string;
  previousChapter: number;
  newChapter: number;
  source: string;
  timestamp: string;
  type: MangaType;
}



export interface DatabaseSyncConfig {
  subdomain: string;
  autoUpdateIntervalMinutes: number;
  enableWebCrawling: boolean;
  sources: string[];
  disabledSources?: string[];
  removedSources?: string[];
  reactivatedSources?: string[]; // sources user manually revived from removed/dead lists
  lastSyncTime: string | null;
  totalTracked: number;
}


export interface OpenApiManga {
  id: string;
  title: string;
  altTitles: string[];
  type: MangaType;
  coverImage: string;
  description: string;
  genres: string[];
  latestChapter: number;
  rating?: number;
  source?: string;
}


export type UserRole = 'admin' | 'user';


export interface UserProfile {
  id: string;
  username: string;
  email: string;
  password?: string;
  name: string;
  avatar: string; // Emoji or avatar icon
  role: UserRole; // 'admin' (Host/Administrator) or 'user' (Individual User)
  storageFolderPath?: string; // Encrypted at rest (AES-256-GCM PII)
  createdAt: string;
}


export interface RecommendationItem {

  id: string;
  title: string;
  type: MangaType;
  coverImage: string;
  description: string;
  genres: string[];
  matchScore: number; // percentage match e.g. 95%
  reason: string;
  latestChapter: number;
}

export interface DailyReadingActivity {
  date: string; // YYYY-MM-DD
  chaptersRead: number;
  minutesSpent: number;
  level: number; // 0 to 4 intensity for heat map
}

export interface ReadingAnalytics {
  currentStreakDays: number;
  longestStreakDays: number;
  totalChaptersRead: number;
  totalTimeMinutes: number;
  favoriteGenre: string;
  activities: DailyReadingActivity[];
}

// True when a source link points at MangaDex. MangaDex is metadata-only (search,
// enrichment, chapter-lists, covers) and must NOT be used to enable reading.
export function isMangaDexSourceLink(name?: string, url?: string): boolean {
  const lc = `${name || ''} ${url || ''}`.toLowerCase();
  return lc.includes('mangadex') || (url || '').toLowerCase().includes('mangadex.org');
}

export function hasWorkingReaderSource(manga: {
  sourceName?: string;
  syncedFromApi?: string;
  sourceUrl?: string;
  apiId?: string;
  availableSources?: MangaSourceLink[];
}): boolean {
  if (!manga) return false;
  // A series is only readable if it has a direct live source URL from a NON-MangaDex source.
  if (manga.sourceUrl && !isMangaDexSourceLink(manga.sourceName, manga.sourceUrl)) return true;
  if (
    manga.availableSources &&
    manga.availableSources.some(
      (s) => s && s.sourceUrl && !isMangaDexSourceLink(s.sourceName, s.sourceUrl)
    )
  )
    return true;
  return false;
}

export function isNsfwManga(manga?: {
  genres?: string[];
  title?: string;
  altTitles?: string[];
  notes?: string;
  description?: string;
  isNsfw?: boolean;
}): boolean {
  if (!manga) return false;
  if (manga.isNsfw === true) return true;
  const genres = Array.isArray(manga.genres) ? manga.genres : [];
  for (const g of genres) {
    const glc = g.toLowerCase().trim();
    if (
      glc === '18+' ||
      glc === 'adult' ||
      glc === 'mature' ||
      glc === 'smut' ||
      glc === 'ecchi' ||
      glc === 'hentai' ||
      glc === 'erotica' ||
      glc === 'nsfw' ||
      glc === 'r18' ||
      glc === 'porn' ||
      glc === 'uncensored' ||
      glc.includes('18+') ||
      glc.includes('adult') ||
      glc.includes('hentai') ||
      glc.includes('erotica')
    ) {
      return true;
    }
  }

  const textToCheck = `${manga.title || ''} ${(manga.altTitles || []).join(' ')} ${manga.notes || ''}`.toLowerCase();
  if (
    textToCheck.includes('[18+]') ||
    textToCheck.includes('(18+)') ||
    textToCheck.includes(' 18+ ') ||
    textToCheck.includes('[uncensored]') ||
    textToCheck.includes('[nsfw]') ||
    textToCheck.includes('(nsfw)')
  ) {
    return true;
  }

  return false;
}


