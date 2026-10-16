import React from 'react';
import {
  X,
  Sliders,
  Sparkles,
  BookOpen,
  Eye,
  AlertTriangle,
  Play,
} from 'lucide-react';
import {
  MangaItem,
  ReaderSettings,
  ReaderImageFilter,
  MangaType,
  ReadingMode,
  ReadingDirection,
  ImageFitMode,
  ReaderBackgroundTheme,
  normalizeReaderSettings,
} from '../../types';
import { getRecommendedReadingMode } from '../../utils/readingMode';

export interface ReaderSettingsModalProps {
  manga: MangaItem;
  detectedFormat: MangaType;
  settings: ReaderSettings;
  isWebtoon: boolean;
  isFlagged: boolean;
  onClose: () => void;
  onSaveSettings: (settings: ReaderSettings) => void;
  onTriggerToast: (msg: string) => void;
  onToggleFlagDropdown: () => void;
}

export const ReaderSettingsModal: React.FC<ReaderSettingsModalProps> = React.memo(({
  manga,
  detectedFormat,
  settings,
  isWebtoon,
  isFlagged,
  onClose,
  onSaveSettings,
  onTriggerToast,
  onToggleFlagDropdown,
}) => {
  const currentMode: ReadingMode = settings.mode || (settings.viewMode === 'double' ? 'double' : settings.viewMode === 'webtoon' || settings.viewMode === 'webtoon-seamless' ? 'webtoon' : 'single');
  const currentDirection: ReadingDirection = settings.direction || (settings.viewMode === 'rtl' ? 'rtl' : settings.viewMode === 'vertical-paged' ? 'vertical' : 'ltr');
  const currentFit: ImageFitMode = settings.fit || (settings.mangaFitMode === 'fit-width' ? 'fit-width' : settings.mangaFitMode === 'original' ? 'original' : 'fit-height');
  const currentGap = settings.seamless ? 0 : (settings.gapPx ?? settings.pageGap ?? 0);

  const saveNormalized = (updates: Partial<ReaderSettings>, toastMsg?: string) => {
    const next = normalizeReaderSettings({ ...settings, ...updates });
    onSaveSettings(next);
    if (toastMsg) onTriggerToast(toastMsg);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-surface border border-edge rounded-2xl max-w-xl w-full p-6 space-y-5 max-h-[90vh] overflow-y-auto shadow-2xl text-primary text-xs sm:text-sm">
        <div className="flex items-center justify-between border-b border-edge pb-3">
          <div className="font-extrabold text-primary text-base flex items-center gap-2">
            <Sliders className="w-5 h-5 text-accent" />
            Reader Layout, Display & Speed Settings
          </div>
          <button
            onClick={onClose}
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
                  {detectedFormat === 'manga'
                    ? '🇯🇵 Japanese Manga'
                    : detectedFormat === 'manhwa'
                    ? '🇰🇷 Korean Manhwa'
                    : '🇨🇳 Chinese Manhua'}
                </span>
              </div>
              <div className="text-[10px] text-secondary">
                {settings.autoFormatMode !== false
                  ? 'Auto-detection active (adapts to Manga vs Webtoon)'
                  : 'Manual layout override active'}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              const next = settings.autoFormatMode === false;
              if (next) {
                const rec = getRecommendedReadingMode(manga);
                saveNormalized({
                  autoFormatMode: true,
                  mode: rec.mode,
                  direction: rec.direction,
                  seamless: rec.seamless,
                  gapPx: rec.gapPx,
                  viewMode: rec.viewMode,
                  noPanelSpacing: rec.noPanelSpacing,
                  pageGap: rec.pageGap,
                }, `Auto-Format Active: ${rec.mode.toUpperCase()}`);
              } else {
                saveNormalized({ autoFormatMode: false }, 'Auto-Format Disabled');
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

        {/* 1. READING MODE (WEBTOON / SINGLE / DOUBLE / CONTINUOUS) */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-secondary flex items-center gap-1.5">
            <BookOpen className="w-3.5 h-3.5 text-accent" />
            Reading Mode
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            {[
              { id: 'webtoon' as ReadingMode, label: '📱 Webtoon', desc: 'Seamless strip' },
              { id: 'continuous' as ReadingMode, label: '📜 Continuous', desc: 'Vertical strip' },
              { id: 'single' as ReadingMode, label: '📄 Single Page', desc: '1 page view' },
              { id: 'double' as ReadingMode, label: '📖 Double Spread', desc: '2 pages side-by-side' },
            ].map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  const isWeb = m.id === 'webtoon';
                  saveNormalized({
                    mode: m.id,
                    seamless: isWeb,
                    gapPx: isWeb ? 0 : settings.gapPx,
                    viewMode: isWeb ? 'webtoon-seamless' : m.id === 'double' ? 'double' : currentDirection === 'rtl' ? 'rtl' : 'single',
                  }, `Reading Mode: ${m.label}`);
                }}
                className={`p-2.5 rounded-xl border text-left flex flex-col gap-0.5 transition-all ${
                  currentMode === m.id
                    ? 'border-accent bg-accent/15 text-accent font-bold ring-1 ring-accent'
                    : 'border-edge bg-app text-secondary hover:bg-elevated'
                }`}
              >
                <span className="text-xs font-bold text-primary">{m.label}</span>
                <span className="text-[10px] opacity-70">{m.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 2. READING DIRECTION (RTL, LTR, VERTICAL) */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-secondary flex items-center justify-between">
            <span>Reading Direction:</span>
            <span className="text-accent font-mono font-bold uppercase text-[11px]">{currentDirection}</span>
          </label>
          <div className="grid grid-cols-3 gap-2 text-xs">
            {[
              { id: 'rtl' as ReadingDirection, label: '🇯🇵 Right to Left (RTL)', desc: 'Manga standard' },
              { id: 'ltr' as ReadingDirection, label: '🇺🇸 Left to Right (LTR)', desc: 'Western & Manhua' },
              { id: 'vertical' as ReadingDirection, label: '📑 Vertical Paged', desc: 'Top to bottom' },
            ].map((dir) => (
              <button
                key={dir.id}
                type="button"
                onClick={() => {
                  saveNormalized({
                    direction: dir.id,
                    viewMode: currentMode === 'single' ? (dir.id === 'rtl' ? 'rtl' : dir.id === 'vertical' ? 'vertical-paged' : 'ltr') : settings.viewMode,
                  }, `Direction: ${dir.label}`);
                }}
                className={`py-2 px-2.5 rounded-xl border text-left flex flex-col gap-0.5 transition-all ${
                  currentDirection === dir.id
                    ? 'border-accent bg-accent/15 text-accent font-bold ring-1 ring-accent'
                    : 'border-edge bg-app text-secondary hover:bg-elevated'
                }`}
              >
                <span className="text-xs font-bold text-primary">{dir.label}</span>
                <span className="text-[10px] opacity-70">{dir.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 3. IMAGE FIT MODE (FIT-WIDTH, FIT-HEIGHT, FIT-BOTH, ORIGINAL) */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-secondary flex items-center justify-between">
            <span>Image Fit Adjustment:</span>
            <span className="text-accent font-mono font-bold uppercase text-[11px]">{currentFit}</span>
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            {[
              { id: 'fit-width' as ImageFitMode, label: '↔️ Fit Width', desc: 'Fill width' },
              { id: 'fit-height' as ImageFitMode, label: '↕️ Fit Height', desc: 'Fit viewport' },
              { id: 'fit-both' as ImageFitMode, label: '🔲 Fit Both', desc: 'Best fit screen' },
              { id: 'original' as ImageFitMode, label: '🔍 Original', desc: '1:1 Native size' },
            ].map((fitOption) => (
              <button
                key={fitOption.id}
                type="button"
                onClick={() => {
                  saveNormalized({
                    fit: fitOption.id,
                    mangaFitMode: fitOption.id === 'fit-width' ? 'fit-width' : fitOption.id === 'original' ? 'original' : 'fit-height',
                  }, `Image Fit: ${fitOption.label}`);
                }}
                className={`py-2 px-2.5 rounded-xl border text-left flex flex-col gap-0.5 transition-all ${
                  currentFit === fitOption.id
                    ? 'border-accent bg-accent/15 text-accent font-bold ring-1 ring-accent'
                    : 'border-edge bg-app text-secondary hover:bg-elevated'
                }`}
              >
                <span className="text-xs font-bold text-primary">{fitOption.label}</span>
                <span className="text-[10px] opacity-70">{fitOption.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 4. PAGE GAP & SEAMLESS ADJUSTMENT */}
        <div className="space-y-2 p-3 bg-app/80 rounded-xl border border-edge">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-secondary">
              Page Gap & Seamless Rendering:
            </label>
            <div className="flex items-center gap-2">
              <span className="text-accent font-mono font-bold text-xs">
                {currentGap === 0 ? '0px (Seamless 0-Seam)' : `${currentGap}px`}
              </span>
              <button
                type="button"
                onClick={() => {
                  const nextSeamless = !settings.seamless;
                  saveNormalized({
                    seamless: nextSeamless,
                    gapPx: nextSeamless ? 0 : 8,
                    noPanelSpacing: nextSeamless,
                    pageGap: nextSeamless ? 0 : 8,
                  }, nextSeamless ? 'Seamless Mode ON (0px)' : 'Standard Gap ON (8px)');
                }}
                className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-all ${
                  settings.seamless || currentGap === 0
                    ? 'bg-accent text-accent-fg border-accent'
                    : 'bg-elevated text-secondary border-edge hover:text-primary'
                }`}
              >
                {settings.seamless || currentGap === 0 ? '✓ Seamless' : 'Seamed'}
              </button>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min="0"
              max="32"
              step="2"
              value={currentGap}
              onChange={(e) => {
                const val = Number(e.target.value);
                saveNormalized({
                  gapPx: val,
                  pageGap: val,
                  seamless: val === 0,
                  noPanelSpacing: val === 0,
                });
              }}
              className="flex-1 accent-accent cursor-pointer"
            />
          </div>
          <div className="flex items-center gap-1.5 pt-1">
            {[0, 4, 8, 16, 24].map((px) => (
              <button
                key={px}
                type="button"
                onClick={() => {
                  saveNormalized({
                    gapPx: px,
                    pageGap: px,
                    seamless: px === 0,
                    noPanelSpacing: px === 0,
                  });
                }}
                className={`flex-1 py-1 rounded text-[10px] font-bold border transition-all ${
                  currentGap === px
                    ? 'border-accent bg-accent/20 text-accent font-black'
                    : 'border-edge bg-surface text-secondary hover:text-primary'
                }`}
              >
                {px === 0 ? '0px' : `${px}px`}
              </button>
            ))}
          </div>
        </div>

        {/* 5. DOUBLE SPREAD COVER OFFSET TOGGLE */}
        <label className="p-3 bg-app rounded-xl border border-edge flex items-center justify-between cursor-pointer">
          <div>
            <div className="text-xs font-bold text-primary">Spread Cover Offset</div>
            <div className="text-[10px] text-secondary">Display Page 1 as standalone cover before starting 2-page spreads</div>
          </div>
          <input
            type="checkbox"
            checked={settings.spreadCoverOffset !== false}
            onChange={(e) => saveNormalized({ spreadCoverOffset: e.target.checked }, e.target.checked ? 'Cover Offset Enabled' : 'Cover Offset Disabled')}
            className="w-4 h-4 accent-accent"
          />
        </label>

        {/* 3. MAX CONTAINER WIDTH */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-secondary flex items-center justify-between">
            <span>Reader Content Maximum Width:</span>
            <span className="text-accent font-mono font-bold">{settings.maxWidth}</span>
          </label>
          <div className="grid grid-cols-4 gap-2 text-xs">
            {['700px', '850px', '1000px', '100%'].map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => onSaveSettings({ ...settings, maxWidth: w })}
                className={`py-2 sm:py-2.5 rounded-lg font-bold border transition-all text-xs sm:text-sm ${
                  settings.maxWidth === w
                    ? 'border-accent bg-accent/15 text-accent shadow-sm'
                    : 'border-edge bg-app text-secondary hover:bg-elevated'
                }`}
              >
                {w}
              </button>
            ))}
          </div>
        </div>

        {/* 4. VISUAL FILTERS (SHARPENER, E-INK, OLED) */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-secondary flex items-center gap-1.5">
            <Eye className="w-3.5 h-3.5 text-accent" />
            Image Shader & Color Filters:
          </label>
          <div className="grid grid-cols-3 gap-2 text-xs">
            {[
              { id: 'normal', name: 'Normal Original' },
              { id: 'warm-amber', name: '🕯️ Warm Amber (Night)' },
              { id: 'sharpener', name: '✨ Line-Art Sharpener' },
              { id: 'oled', name: '🌑 OLED Ultra-Dark' },
              { id: 'sepia', name: '📜 Parchment Sepia' },
              { id: 'e-ink', name: '📖 E-Ink E-Paper' },
              { id: 'dithered-1bit', name: '🔳 1-Bit Dithered' },
              { id: 'high-contrast', name: '⚡ High Contrast' },
              { id: 'grayscale', name: '🔘 Monochrome B&W' },
              { id: 'invert', name: '🔄 Invert Colors' },
              { id: 'brightness', name: '☀️ Bright Boost' },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  onSaveSettings({ ...settings, imageFilter: f.id as ReaderImageFilter });
                  onTriggerToast(`Filter: ${f.name}`);
                }}
                className={`py-2 px-2.5 rounded-xl font-bold border text-left text-xs sm:text-sm transition-all ${
                  settings.imageFilter === f.id
                    ? 'border-accent bg-accent/15 text-accent shadow-sm'
                    : 'border-edge bg-app text-secondary hover:bg-elevated hover:text-primary'
                }`}
              >
                {f.name}
              </button>
            ))}
          </div>
        </div>

        {/* 5. ADVANCED READING ASSISTS (SPREAD SPLIT, GUIDED PANEL, PRELOAD) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="p-3 bg-app rounded-xl border border-edge flex items-center justify-between cursor-pointer">
            <div>
              <div className="text-xs font-bold text-primary">Split Double-Page Spreads</div>
              <div className="text-[10px] text-secondary">Auto-cut landscape pages into portrait (Mihon-style)</div>
            </div>
            <input
              type="checkbox"
              checked={settings.splitLandscapeSpreads !== false}
              onChange={(e) => onSaveSettings({ ...settings, splitLandscapeSpreads: e.target.checked })}
              className="w-4 h-4 accent-accent"
            />
          </label>

          <label className="p-3 bg-app rounded-xl border border-edge flex items-center justify-between cursor-pointer">
            <div>
              <div className="text-xs font-bold text-primary">Guided Panel View</div>
              <div className="text-[10px] text-secondary">Snap-to-panel scrolling for Webtoons</div>
            </div>
            <input
              type="checkbox"
              checked={settings.guidedPanelView || false}
              onChange={(e) => onSaveSettings({ ...settings, guidedPanelView: e.target.checked })}
              className="w-4 h-4 accent-accent"
            />
          </label>

          <label className="p-3 bg-app rounded-xl border border-edge flex items-center justify-between cursor-pointer">
            <div>
              <div className="text-xs font-bold text-primary">Preload Next Chapter</div>
              <div className="text-[10px] text-secondary">0ms instant chapter transitions</div>
            </div>
            <input
              type="checkbox"
              checked={settings.prefetchNextChapter !== false}
              onChange={(e) => onSaveSettings({ ...settings, prefetchNextChapter: e.target.checked })}
              className="w-4 h-4 accent-accent"
            />
          </label>

          {/* AI & Vision Enhancements (Strictly Optional & Disabled by Default) */}
          <div className="p-3.5 bg-app/90 rounded-xl border border-edge space-y-3">
            <div className="flex items-center justify-between border-b border-edge/60 pb-2">
              <div className="text-xs font-black text-primary flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-accent" />
                <span>AI Vision &amp; Translation Tools</span>
              </div>
              <span className="px-2 py-0.5 rounded text-[9px] font-extrabold uppercase bg-accent/15 text-accent border border-accent/20">
                100% Optional
              </span>
            </div>

            {/* Smart Webtoonify */}
            <label className="flex items-center justify-between cursor-pointer">
              <div className="pr-2">
                <div className="text-xs font-bold text-primary">Smart Webtoonify (Vision Slicing)</div>
                <div className="text-[10px] text-secondary">
                  Auto-segment multi-panel classic manga into vertical scroll (Off by default)
                </div>
              </div>
              <input
                type="checkbox"
                checked={settings.smartWebtoonify || false}
                onChange={(e) => onSaveSettings({ ...settings, smartWebtoonify: e.target.checked })}
                className="w-4 h-4 accent-accent"
              />
            </label>

            {/* Inpainting & In-Place Dialogue Translation */}
            <label className="flex items-center justify-between cursor-pointer border-t border-edge/40 pt-2.5">
              <div className="pr-2">
                <div className="text-xs font-bold text-primary">In-Place Dialogue Translation &amp; Inpainting</div>
                <div className="text-[10px] text-secondary">
                  Replace speech bubble text on demand. Native reader pipeline remains 100% untouched when off.
                </div>
              </div>
              <input
                type="checkbox"
                checked={settings.enableAiInpainting || false}
                onChange={(e) => onSaveSettings({ ...settings, enableAiInpainting: e.target.checked, inPlaceTranslation: e.target.checked })}
                className="w-4 h-4 accent-accent"
              />
            </label>

            {/* Language Selector when In-Place Translation is enabled */}
            {settings.enableAiInpainting && (
              <div className="flex items-center justify-between pt-1 pl-2 border-l-2 border-accent">
                <span className="text-[11px] font-bold text-primary">Target Language:</span>
                <select
                  value={settings.targetTranslationLang || 'en'}
                  onChange={(e) => onSaveSettings({ ...settings, targetTranslationLang: e.target.value })}
                  className="px-2 py-1 rounded-lg bg-surface border border-edge text-xs font-bold text-primary cursor-pointer"
                >
                  <option value="en">English (en)</option>
                  <option value="es">Spanish (es)</option>
                  <option value="fr">French (fr)</option>
                  <option value="de">German (de)</option>
                  <option value="pt">Portuguese (pt)</option>
                  <option value="id">Indonesian (id)</option>
                  <option value="ja">Japanese (ja)</option>
                </select>
              </div>
            )}
          </div>

          <label className="p-3 bg-app rounded-xl border border-edge flex items-center justify-between cursor-pointer">
            <div>
              <div className="text-xs font-bold text-primary">E-Ink High Contrast Mode</div>
              <div className="text-[10px] text-secondary">Zero animations & 1-bit dithering for e-readers</div>
            </div>
            <input
              type="checkbox"
              checked={settings.imageFilter === 'e-ink'}
              onChange={(e) => onSaveSettings({ ...settings, imageFilter: e.target.checked ? 'e-ink' : 'normal' })}
              className="w-4 h-4 accent-accent"
            />
          </label>
        </div>

        {/* 6. CANVAS BACKGROUND THEME */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-secondary">Background Canvas Theme:</label>
          <div className="grid grid-cols-4 gap-2 text-xs">
            {[
              { id: 'dark' as ReaderBackgroundTheme, legacyBg: 'slate', name: 'Dark Slate', bg: 'bg-surface text-primary' },
              { id: 'black' as ReaderBackgroundTheme, legacyBg: 'black', name: 'AMOLED Black', bg: 'bg-black text-primary' },
              { id: 'sepia' as ReaderBackgroundTheme, legacyBg: 'sepia', name: 'Soft Sepia', bg: 'bg-[#f4ecd8] text-[#5b4636]' },
              { id: 'white' as ReaderBackgroundTheme, legacyBg: 'white', name: 'Paper White', bg: 'bg-white text-accent-fg' },
            ].map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => saveNormalized({ backgroundTheme: b.id, bgColor: b.legacyBg as any }, `Background: ${b.name}`)}
                className={`py-2 sm:py-2.5 rounded-lg font-bold border text-center transition-all ${b.bg} ${
                  (settings.backgroundTheme === b.id || (!settings.backgroundTheme && settings.bgColor === b.legacyBg))
                    ? 'ring-2 ring-accent border-accent'
                    : 'border-edge-strong'
                }`}
              >
                {b.name}
              </button>
            ))}
          </div>
        </div>

        {/* 7. AUTO-SCROLL SPEED */}
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
                onClick={() => onSaveSettings({ ...settings, autoScrollSpeed: speed })}
                className={`flex-1 py-1 sm:py-1.5 rounded text-xs sm:text-sm font-bold border transition-all ${
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

        {/* 8. FLAGGING SYSTEM BUTTON */}
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
            onClick={onToggleFlagDropdown}
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
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-accent hover:bg-accent-bright text-accent-fg font-extrabold text-xs"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
});
