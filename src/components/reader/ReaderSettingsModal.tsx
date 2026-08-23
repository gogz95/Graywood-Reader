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
import { MangaItem, ReaderSettings, ReaderImageFilter, MangaType } from '../../types';
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
                  ? 'Auto-detection active (remembering your layout)'
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
                onSaveSettings({
                  ...settings,
                  autoFormatMode: true,
                  viewMode: rec.viewMode,
                  noPanelSpacing: rec.noPanelSpacing,
                  pageGap: rec.pageGap,
                });
                onTriggerToast(`Auto-Format Active: ${rec.viewMode.toUpperCase()}`);
              } else {
                onSaveSettings({ ...settings, autoFormatMode: false });
                onTriggerToast('Auto-Format Disabled');
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
              { id: 'double', label: '📖 Double Spread', desc: 'Two pages side-by-side' },
            ].map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() => {
                  onSaveSettings({
                    ...settings,
                    viewMode: mode.id as any,
                    noPanelSpacing: mode.id === 'webtoon-seamless',
                    pageGap: mode.id === 'webtoon-seamless' ? 0 : settings.pageGap || 8,
                  });
                  onTriggerToast(`Reader Mode: ${mode.label}`);
                }}
                className={`p-2.5 sm:p-3 rounded-xl border text-left flex flex-col gap-1 transition-all ${
                  settings.viewMode === mode.id || (mode.id === 'webtoon-seamless' && settings.noPanelSpacing && isWebtoon)
                    ? 'border-accent bg-accent/10 text-accent font-bold'
                    : 'border-edge bg-app text-secondary hover:bg-elevated'
                }`}
              >
                <span className="text-xs sm:text-sm font-bold text-primary">{mode.label}</span>
                <span className="text-[10px] sm:text-[11px] opacity-70 line-clamp-1">{mode.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 2. WEBTOON PANEL SPACING / GAP */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-secondary flex items-center justify-between">
            <span>Webtoon Vertical Panel Spacing (Gap):</span>
            <span className="text-accent font-mono font-bold">
              {settings.noPanelSpacing ? '0px (Seamless Webtoon)' : `${settings.pageGap}px`}
            </span>
          </label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min="0"
              max="32"
              step="4"
              value={settings.noPanelSpacing ? 0 : settings.pageGap}
              onChange={(e) => {
                const val = Number(e.target.value);
                onSaveSettings({
                  ...settings,
                  pageGap: val,
                  noPanelSpacing: val === 0,
                });
              }}
              className="flex-1 accent-accent cursor-pointer"
            />
          </div>
        </div>

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
              { id: 'slate', name: 'Dark Slate', bg: 'bg-surface text-primary' },
              { id: 'black', name: 'AMOLED Black', bg: 'bg-black text-primary' },
              { id: 'sepia', name: 'Soft Sepia', bg: 'bg-[#f4ecd8] text-[#5b4636]' },
              { id: 'white', name: 'Paper White', bg: 'bg-white text-accent-fg' },
            ].map((bg) => (
              <button
                key={bg.id}
                type="button"
                onClick={() => onSaveSettings({ ...settings, bgColor: bg.id as any })}
                className={`py-2 sm:py-2.5 rounded-lg font-bold border text-center transition-all ${bg.bg} ${
                  settings.bgColor === bg.id ? 'ring-2 ring-accent border-accent' : 'border-edge-strong'
                }`}
              >
                {bg.name}
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
