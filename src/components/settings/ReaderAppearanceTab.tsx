import React from 'react';
import {
  AppSettings,
  ReaderViewMode,
  ReaderBgColor,
  ReaderImageFilter,
  AppTheme,
} from '../../types';
import {
  Eye,
  Zap,
  Sparkles,
  Globe,
  Palette,
  Volume2,
} from 'lucide-react';

interface ReaderAppearanceTabProps {
  formData: AppSettings;
  setFormData: React.Dispatch<React.SetStateAction<AppSettings>>;
  activeSubTab?: 'reader' | 'appearance';
}

export const ReaderAppearanceTab: React.FC<ReaderAppearanceTabProps> = ({
  formData,
  setFormData,
  activeSubTab = 'reader',
}) => {
  if (activeSubTab === 'appearance') {
    return (
      <div className="space-y-6 text-xs sm:text-sm">
        {/* UI Theme Selection */}
        <div className="space-y-3">
          <label className="font-bold text-primary text-sm flex items-center gap-2">
            <Palette className="w-4 h-4 text-accent-2" />
            Primary Application Theme:
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2.5">
            {[
              { id: 'amber', name: 'Cyber Amber', color: 'bg-amber-500', desc: 'Warm slate' },
              { id: 'emerald', name: 'Kotatsu Emerald', color: 'bg-emerald-500', desc: 'Forest jade' },
              { id: 'violet', name: 'Royal Violet', color: 'bg-purple-500', desc: 'Cosmic void' },
              { id: 'cyberpunk', name: 'Neon Cyber', color: 'bg-cyan-500', desc: 'Ocean cyan' },
              { id: 'crimson', name: 'Crimson Velvet', color: 'bg-rose-500', desc: 'Wine & rose' },
              { id: 'nord', name: 'Nord Frost', color: 'bg-sky-400', desc: 'Arctic ice' },
              { id: 'amoled', name: 'AMOLED Dark', color: 'bg-zinc-800', desc: 'Pure black' },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setFormData({ ...formData, appTheme: t.id as AppTheme })}
                className={`p-3 rounded-2xl border text-center font-bold transition-all flex flex-col items-center gap-1.5 active:scale-95 cursor-pointer ${
                  formData.appTheme === t.id
                    ? 'border-accent bg-accent/15 text-accent shadow-md ring-1 ring-accent/40'
                    : 'border-edge bg-app/80 text-secondary hover:bg-elevated hover:text-primary'
                }`}
              >
                <div className={`w-7 h-7 rounded-full ${t.color} shadow-md`} />
                <span className="text-[11px] font-black">{t.name}</span>
                <span className="text-[9px] text-muted font-medium">{t.desc}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
          <div className="space-y-2 p-4 bg-app rounded-2xl border border-edge">
            <label className="font-bold text-primary">Library View Style:</label>
            <select
              value={formData.libraryLayout}
              onChange={(e) => setFormData({ ...formData, libraryLayout: e.target.value as any })}
              className="w-full bg-surface border border-edge rounded-xl p-2.5 text-primary text-xs"
            >
              <option value="grid">Grid Card View</option>
              <option value="compact">Compact Grid</option>
              <option value="list">Detailed Table View</option>
            </select>
          </div>

          <div className="space-y-2 p-4 bg-app rounded-2xl border border-edge">
            <label className="font-bold text-primary">Grid Card Columns:</label>
            <select
              value={formData.gridColumns}
              onChange={(e) => setFormData({ ...formData, gridColumns: Number(e.target.value) })}
              className="w-full bg-surface border border-edge rounded-xl p-2.5 text-primary text-xs"
            >
              <option value={2}>2 Columns</option>
              <option value={3}>3 Columns</option>
              <option value={4}>4 Columns (Default)</option>
              <option value={5}>5 Columns</option>
              <option value={6}>6 Columns (Dense)</option>
            </select>
          </div>
        </div>

        {/* Ambient Soundscape Audio Defaults */}
        <div className="p-5 bg-app rounded-2xl border border-edge space-y-4">
          <div className="font-bold text-primary text-sm flex items-center gap-2">
            <Volume2 className="w-4 h-4 text-accent" />
            Ambient Soundscape Audio Defaults
          </div>

          <div className="space-y-4 p-4 bg-surface rounded-xl border border-edge">
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <div className="font-bold text-primary">Tactile Page-Turn Sound Effects</div>
                <div className="text-[11px] text-secondary">
                  Play realistic paper page turn SFX on chapter advances and page flips
                </div>
              </div>
              <input
                type="checkbox"
                checked={formData.pageTurnSfxEnabled !== false}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    pageTurnSfxEnabled: e.target.checked,
                  })
                }
                className="w-5 h-5 accent-accent"
              />
            </label>

            <div className="space-y-1.5 pt-2 border-t border-edge">
              <div className="flex items-center justify-between text-xs font-bold">
                <span className="text-secondary">Default Ambient Atmosphere Volume:</span>
                <span className="text-accent font-mono">
                  {Math.round((formData.ambientSoundVolume ?? 0.35) * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={formData.ambientSoundVolume ?? 0.35}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    ambientSoundVolume: parseFloat(e.target.value),
                  })
                }
                className="w-full accent-accent cursor-pointer"
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Reader Defaults Tab
  return (
    <div className="space-y-6 text-xs sm:text-sm">
      {/* Private / Incognito Reading Mode */}
      <div className="p-5 bg-app rounded-2xl border border-edge space-y-4">
        <div className="flex items-center justify-between">
          <div className="font-bold text-primary text-sm flex items-center gap-2">
            <Eye className="w-4 h-4 text-accent" />
            Private Reading Mode
          </div>
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-accent/20 text-accent border border-accent/30">
            Privacy
          </span>
        </div>

        <div className="space-y-3 p-4 bg-surface rounded-xl border border-edge">
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <div className="font-bold text-primary flex items-center gap-2">
                <span>Enable Incognito Mode</span>
              </div>
              <div className="text-[11px] text-secondary">
                Disables history, tracker scrobbling (AniList/MAL/Kitsu), and analytics while reading.
              </div>
            </div>
            <input
              type="checkbox"
              checked={formData.privateModeEnabled || false}
              onChange={(e) => setFormData({ ...formData, privateModeEnabled: e.target.checked })}
              className="w-5 h-5 accent-accent"
            />
          </label>
        </div>
      </div>

      {/* Reading Performance Card */}
      <div className="p-5 bg-app rounded-2xl border border-edge space-y-4">
        <div className="font-bold text-primary text-sm flex items-center gap-2">
          <Zap className="w-4 h-4 text-accent" />
          Performance &amp; Preload Options
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5 p-3 rounded-xl bg-surface border border-edge">
            <label className="font-bold text-secondary">Page Preload Buffer Count:</label>
            <select
              value={formData.readerDefaults.preloadCount || 3}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  readerDefaults: { ...formData.readerDefaults, preloadCount: Number(e.target.value) },
                })
              }
              className="w-full bg-app border border-edge rounded-xl p-2.5 text-primary text-xs"
            >
              <option value={1}>1 Page (Data Saver)</option>
              <option value={3}>3 Pages (Balanced - Recommended)</option>
              <option value={5}>5 Pages (Fast Reading)</option>
              <option value={10}>10 Pages (Instant Buffer)</option>
            </select>
          </div>

          <div className="space-y-1.5 p-3 rounded-xl bg-surface border border-edge">
            <label className="font-bold text-secondary">Default Global Reading Mode:</label>
            <select
              value={formData.readerDefaults.viewMode || 'webtoon'}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  readerDefaults: { ...formData.readerDefaults, viewMode: e.target.value as ReaderViewMode },
                })
              }
              className="w-full bg-app border border-edge rounded-xl p-2.5 text-primary text-xs"
            >
              <option value="webtoon">📜 Vertical Continuous Webtoon Scroll</option>
              <option value="webtoon-seamless">📱 Webtoon Seamless (0px Gap)</option>
              <option value="rtl">🇯🇵 Manga (Right-to-Left Turn)</option>
              <option value="ltr">🇺🇸 Western / Manhua (Left-to-Right)</option>
              <option value="single">📄 Single Page View</option>
              <option value="double">📖 Double Page Spread</option>
              <option value="vertical-paged">📑 Paged Vertical</option>
            </select>
          </div>

          <div className="space-y-1.5 p-3 rounded-xl bg-surface border border-edge">
            <label className="font-bold text-secondary">🇯🇵 Default Japanese Manga Mode:</label>
            <select
              value={formData.defaultMangaMode || 'rtl'}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  defaultMangaMode: e.target.value as ReaderViewMode,
                })
              }
              className="w-full bg-app border border-edge rounded-xl p-2.5 text-primary text-xs"
            >
              <option value="rtl">🇯🇵 Right-to-Left (RTL - Traditional Manga)</option>
              <option value="single">📄 Single Page LTR</option>
              <option value="double">📖 Double Page Spread</option>
              <option value="webtoon">📜 Continuous Vertical Scroll</option>
            </select>
          </div>

          <div className="space-y-1.5 p-3 rounded-xl bg-surface border border-edge">
            <label className="font-bold text-secondary">🇰🇷 Default Korean Manhwa Mode:</label>
            <select
              value={formData.defaultManhwaMode || 'webtoon'}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  defaultManhwaMode: e.target.value as ReaderViewMode,
                })
              }
              className="w-full bg-app border border-edge rounded-xl p-2.5 text-primary text-xs"
            >
              <option value="webtoon">📜 Continuous Vertical Webtoon (Standard)</option>
              <option value="webtoon-seamless">📱 Webtoon Seamless (0px Gap)</option>
              <option value="single">📄 Single Page View</option>
            </select>
          </div>

          <div className="space-y-1.5 p-3 rounded-xl bg-surface border border-edge">
            <label className="font-bold text-secondary">🇨🇳 Default Chinese Manhua Mode:</label>
            <select
              value={formData.defaultManhuaMode || 'webtoon'}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  defaultManhuaMode: e.target.value as ReaderViewMode,
                })
              }
              className="w-full bg-app border border-edge rounded-xl p-2.5 text-primary text-xs"
            >
              <option value="webtoon">📜 Continuous Vertical Webtoon</option>
              <option value="webtoon-seamless">📱 Webtoon Seamless (0px Gap)</option>
              <option value="ltr">🇺🇸 Left-to-Right (LTR)</option>
              <option value="single">📄 Single Page View</option>
            </select>
          </div>

          <div className="space-y-1.5 p-3 rounded-xl bg-surface border border-edge col-span-1 sm:col-span-2">
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <div className="font-bold text-primary flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-accent" />
                  <span>Smart Format Auto-Selection &amp; Layout Memory</span>
                </div>
                <div className="text-[11px] text-secondary">
                  Automatically select Manga (RTL) vs Manhwa/Manhua (Webtoon) when opening a series and remember your last chosen mode
                </div>
              </div>
              <input
                type="checkbox"
                checked={formData.autoFormatReadingMode !== false}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    autoFormatReadingMode: e.target.checked,
                  })
                }
                className="w-5 h-5 accent-accent"
              />
            </label>
          </div>

          <div className="space-y-1.5 p-3 rounded-xl bg-surface border border-edge col-span-1 sm:col-span-2">
            <label className="font-bold text-secondary flex items-center gap-1.5">
              <Globe className="w-4 h-4 text-info" />
              <span>Preferred Content &amp; Translation Language:</span>
            </label>
            <select
              value={formData.preferredLanguage || 'en'}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  preferredLanguage: e.target.value,
                })
              }
              className="w-full bg-app border border-edge rounded-xl p-2.5 text-primary text-xs font-bold"
            >
              <option value="en">🇬🇧 English (en) - Preferred Default</option>
              <option value="ko">🇰🇷 Korean Original (ko)</option>
              <option value="zh">🇨🇳 Chinese Original (zh)</option>
              <option value="ja">🇯🇵 Japanese Original (ja)</option>
              <option value="es">🇪🇸 Spanish (es)</option>
              <option value="all">🌐 All Languages (all)</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex items-center justify-between p-3.5 rounded-xl bg-surface border border-edge cursor-pointer hover:border-edge-strong transition-all">
            <div>
              <div className="font-bold text-primary">Auto Next Chapter Transition</div>
              <div className="text-[11px] text-secondary">Seamlessly load Next Chapter when scrolling past the final page</div>
            </div>
            <input
              type="checkbox"
              checked={formData.readerDefaults.autoNextChapter}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  readerDefaults: { ...formData.readerDefaults, autoNextChapter: e.target.checked },
                })
              }
              className="w-5 h-5 accent-accent"
            />
          </label>

          <label className="flex items-center justify-between p-3.5 rounded-xl bg-surface border border-edge cursor-pointer hover:border-edge-strong transition-all">
            <div>
              <div className="font-bold text-primary">Persistent Page Indicator Overlay</div>
              <div className="text-[11px] text-secondary">Display floating progress badge with chapter and page number</div>
            </div>
            <input
              type="checkbox"
              checked={formData.readerDefaults.showPersistentPageBadge}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  readerDefaults: { ...formData.readerDefaults, showPersistentPageBadge: e.target.checked },
                })
              }
              className="w-5 h-5 accent-accent"
            />
          </label>

          <label className="flex items-center justify-between p-3.5 rounded-xl bg-surface border border-edge cursor-pointer hover:border-edge-strong transition-all">
            <div>
              <div className="font-bold text-primary">Per-Page Number Counter</div>
              <div className="text-[11px] text-secondary">Show the small &quot;Page X / Y&quot; counter on each reader page</div>
            </div>
            <input
              type="checkbox"
              checked={formData.readerDefaults.showPageNumberOverlay}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  readerDefaults: { ...formData.readerDefaults, showPageNumberOverlay: e.target.checked },
                })
              }
              className="w-5 h-5 accent-accent"
            />
          </label>
        </div>
      </div>

      {/* Display & Image Filtering Card */}
      <div className="p-5 bg-app rounded-2xl border border-edge space-y-4">
        <div className="font-bold text-primary text-sm">Image Fit &amp; Rendering Filters</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="font-bold text-secondary">Page Scaling Fit Mode:</label>
            <select
              value={formData.readerDefaults.mangaFitMode}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  readerDefaults: { ...formData.readerDefaults, mangaFitMode: e.target.value as any },
                })
              }
              className="w-full bg-surface border border-edge rounded-xl p-2.5 text-primary text-xs"
            >
              <option value="fit-height">Fit Height (Best for Portrait Screens)</option>
              <option value="fit-width">Fit Width (Best for Desktop / Wide Monitors)</option>
              <option value="original">Original Dimensions (Unscaled)</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="font-bold text-secondary">Default Visual Shader Filter:</label>
            <select
              value={formData.readerDefaults.imageFilter}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  readerDefaults: {
                    ...formData.readerDefaults,
                    imageFilter: e.target.value as ReaderImageFilter,
                  },
                })
              }
              className="w-full bg-surface border border-edge rounded-xl p-2.5 text-primary text-xs font-bold"
            >
              <option value="none">Normal (True Original Color)</option>
              <option value="sharpen">🎨 Line-Art Sharpener (Crisper Scans)</option>
              <option value="e-ink">📰 E-Ink High-Contrast Dithering</option>
              <option value="oled">🖤 OLED Ultra-Dark (Pure Black Backgrounds)</option>
              <option value="warm-sepia">☕ Warm Sepia Paper Tone</option>
              <option value="grayscale">🔘 Grayscale Monochrome</option>
              <option value="high-contrast">⚡ High-Contrast Black &amp; White</option>
              <option value="night">🌙 Night Invert / Negative</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="font-bold text-secondary">Reader Backdrop Color:</label>
            <select
              value={formData.readerDefaults.bgColor}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  readerDefaults: { ...formData.readerDefaults, bgColor: e.target.value as ReaderBgColor },
                })
              }
              className="w-full bg-surface border border-edge rounded-xl p-2.5 text-primary text-xs"
            >
              <option value="black">Pure Black (#000000)</option>
              <option value="dark">Charcoal Slate (#121212)</option>
              <option value="gray">Muted Neutral Gray (#1e1e24)</option>
              <option value="white">Crisp Paper White (#ffffff)</option>
              <option value="sepia">Warm Vintage Sepia (#fbf0d9)</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="font-bold text-secondary">Auto-Scroll Speed (Pixels / Frame):</label>
            <select
              value={formData.readerDefaults.autoScrollSpeed}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  readerDefaults: { ...formData.readerDefaults, autoScrollSpeed: Number(e.target.value) },
                })
              }
              className="w-full bg-surface border border-edge rounded-xl p-2.5 text-primary text-xs"
            >
              <option value={1}>1px (Gentle Reading)</option>
              <option value={2}>2px (Standard Pace)</option>
              <option value={3}>3px (Fast Skimming)</option>
              <option value={5}>5px (Rapid Catch-Up)</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
};
