import React, { useState } from 'react';
import { apiFetch } from '../utils/api';
import {
  AppSettings,
  ReaderViewMode,
  ReaderBgColor,
  ReaderImageFilter,
  AppTheme,
  DuplicateCandidate,
  DatabaseSyncConfig,
  MangaItem,
} from '../types';
import { DuplicateFinderView } from './DuplicateFinderView';
import {
  X,
  Sliders,
  Globe,
  Palette,
  Download,
  Trash2,
  Check,
  Shield,
  BookOpen,
  Zap,
  RefreshCw,
  GitMerge,
  Folder,
  Layers,
  HardDrive,
  Cpu,
  Lock,
} from 'lucide-react';
import { AutoUpdateView } from './AutoUpdateView';
import { AutoUpdateLog, UserProfile } from '../types';

interface SettingsModalProps {
  settings: AppSettings;
  onSaveSettings: (newSettings: AppSettings) => Promise<void>;
  onClose: () => void;
  onRefreshData: () => void;
  // Embedded Duplicate Merger Props
  duplicateCandidates: DuplicateCandidate[];
  onScanDuplicates: () => void;
  isScanningDuplicates: boolean;
  onExecuteMerge: (
    primaryId: string,
    secondaryId: string,
    newTitle: string,
    newAltTitles: string[],
    newGenres: string[],
    newDescription: string
  ) => void;
  // Embedded Database Sync Props
  dbConfig: DatabaseSyncConfig;
  mangaCount: number;
  onUpdateSubdomain: (subdomain: string) => void;
  onExportDb: (format: 'json' | 'csv') => void;
  onImportDb: (data: MangaItem[], replaceExisting: boolean) => void;
  onResetDb: () => void;
  // User Profile & Auto-Update Props
  activeProfile?: UserProfile;
  logs?: AutoUpdateLog[];
  mangaList?: MangaItem[];
  onRunAutoUpdate?: () => void;
  isUpdating?: boolean;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  onSaveSettings,
  onClose,
  onRefreshData,
  duplicateCandidates,
  onScanDuplicates,
  isScanningDuplicates,
  onExecuteMerge,
  dbConfig,
  mangaCount,
  onUpdateSubdomain,
  onExportDb,
  onImportDb,
  onResetDb,
  activeProfile,
  logs = [],
  mangaList = [],
  onRunAutoUpdate = () => {},
  isUpdating = false,
}) => {
  const [activeSection, setActiveSection] = useState<
    'reader' | 'appearance' | 'autoupdate' | 'sources' | 'duplicates' | 'subdomain' | 'backup'
  >('reader');
  const isAdmin = activeProfile?.role === 'admin';

  const renderAdminLockNotice = (featureName: string) => (
    <div className="p-8 text-center bg-app border border-accent-2/30 rounded-2xl space-y-4 my-4">
      <div className="w-12 h-12 rounded-2xl bg-accent-2/10 text-accent-2 border border-accent-2/30 flex items-center justify-center mx-auto shadow-md">
        <Lock className="w-6 h-6" />
      </div>
      <div className="space-y-1">
        <h3 className="text-base font-bold text-primary">Administrator Access Required</h3>
        <p className="text-xs text-secondary max-w-md mx-auto">
          {featureName} settings, crawlers, and system options are locked to Host Administrators.
        </p>
      </div>
      <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-accent-2/15 text-accent-2 text-xs font-bold border border-accent-2/30">
        Current Account: {activeProfile?.name || 'User'} ({activeProfile?.role || 'user'})
      </div>
    </div>
  );
  const [subdomainInput, setSubdomainInput] = useState(dbConfig.subdomain);
  const [subdomainSaved, setSubdomainSaved] = useState(false);

  const handleSaveSubdomain = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateSubdomain(subdomainInput);
    setSubdomainSaved(true);
    setTimeout(() => setSubdomainSaved(false), 2500);
  };

  const [isRefreshingAll, setIsRefreshingAll] = useState(false);
  const [bulkRefreshStatus, setBulkRefreshStatus] = useState<string | null>(null);

  const handleRefreshAllMetadata = async () => {
    setIsRefreshingAll(true);
    setBulkRefreshStatus(null);
    try {
      const res = await apiFetch('/api/manga/refresh-all-metadata', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setBulkRefreshStatus(`✓ Refreshed metadata for all ${data.updatedCount} series!`);
        onRefreshData();
        setTimeout(() => setBulkRefreshStatus(null), 5000);
      } else {
        setBulkRefreshStatus('⚠️ Metadata sync completed');
        setTimeout(() => setBulkRefreshStatus(null), 5000);
      }
    } catch (err) {
      setBulkRefreshStatus('❌ Refresh failed');
      setTimeout(() => setBulkRefreshStatus(null), 5000);
    } finally {
      setIsRefreshingAll(false);
    }
  };

  const [formData, setFormData] = useState<AppSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSaveSettings(formData);
      showToast('Settings saved successfully!');
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleClearCache = async () => {
    try {
      const res = await apiFetch('/api/settings/cache/clear', { method: 'POST' });
      if (res.ok) {
        showToast('Image cache & page list buffers cleared!');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleExportBackup = () => {
    window.open('/api/settings/backup/export', '_blank');
    showToast('Library JSON backup downloaded!');
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 bg-app/85 backdrop-blur-xl flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
    >
      <div className="bg-surface border border-edge rounded-t-3xl sm:rounded-3xl max-w-4xl w-full max-h-[92vh] sm:max-h-[88vh] overflow-hidden shadow-2xl flex flex-col my-0 sm:my-auto">
        
        {/* Streamlined Header */}
        <div className="p-5 bg-gradient-to-r from-app via-surface to-app border-b border-edge flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-accent/10 text-accent border border-accent/20 shadow-md">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-primary flex items-center gap-2">
                WebApp Settings & Preferences
                <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-accent/20 text-accent border border-accent/30">
                  Kotatsu Engine v4.8
                </span>
              </h2>
              <p className="text-xs text-secondary">Manage reader defaults, proxy extensions, UI themes, and library backups.</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-elevated/80 text-secondary hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Section Navigation Pills */}
        <div className="flex items-center gap-1.5 p-2.5 bg-app border-b border-edge/80 overflow-x-auto text-xs font-bold scrollbar-none">
          <button
            type="button"
            onClick={() => setActiveSection('reader')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all whitespace-nowrap ${
              activeSection === 'reader'
                ? 'bg-accent text-accent-fg shadow-md font-black'
                : 'text-secondary hover:text-primary hover:bg-elevated/60'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            <span>Reader & Layout</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSection('appearance')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all whitespace-nowrap ${
              activeSection === 'appearance'
                ? 'bg-accent text-accent-fg shadow-md font-black'
                : 'text-secondary hover:text-primary hover:bg-elevated/60'
            }`}
          >
            <Palette className="w-4 h-4 text-accent-2" />
            <span>UI & Theme</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSection('autoupdate')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all whitespace-nowrap ${
              activeSection === 'autoupdate'
                ? 'bg-accent text-accent-fg shadow-md font-black'
                : 'text-secondary hover:text-primary hover:bg-elevated/60'
            }`}
          >
            <Zap className="w-4 h-4 text-accent-2" />
            <span>Auto-Update Feed</span>
            {!isAdmin && (
              <span title="Admin access required" className="inline-flex">
                <Lock className="w-3 h-3 text-muted" />
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveSection('sources')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all whitespace-nowrap ${
              activeSection === 'sources'
                ? 'bg-accent text-accent-fg shadow-md font-black'
                : 'text-secondary hover:text-primary hover:bg-elevated/60'
            }`}
          >
            <Cpu className="w-4 h-4 text-success" />
            <span>Sources & Network</span>
            {!isAdmin && (
              <span title="Admin access required" className="inline-flex">
                <Lock className="w-3 h-3 text-muted" />
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveSection('duplicates')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all whitespace-nowrap relative ${
              activeSection === 'duplicates'
                ? 'bg-accent text-accent-fg shadow-md font-black'
                : 'text-secondary hover:text-primary hover:bg-elevated/60'
            }`}
          >
            <GitMerge className="w-4 h-4 text-accent-2" />
            <span>Duplicate Merger</span>
            {!isAdmin && (
              <span title="Admin access required" className="inline-flex">
                <Lock className="w-3 h-3 text-muted" />
              </span>
            )}
            {duplicateCandidates.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-accent-2 text-white">
                {duplicateCandidates.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveSection('subdomain')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all whitespace-nowrap ${
              activeSection === 'subdomain'
                ? 'bg-accent text-accent-fg shadow-md font-black'
                : 'text-secondary hover:text-primary hover:bg-elevated/60'
            }`}
          >
            <Globe className="w-4 h-4 text-info" />
            <span>Tracker Domain</span>
            {!isAdmin && (
              <span title="Admin access required" className="inline-flex">
                <Lock className="w-3 h-3 text-muted" />
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveSection('backup')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all whitespace-nowrap ${
              activeSection === 'backup'
                ? 'bg-accent text-accent-fg shadow-md font-black'
                : 'text-secondary hover:text-primary hover:bg-elevated/60'
            }`}
          >
            <Download className="w-4 h-4 text-accent" />
            <span>Backups & Storage</span>
            {!isAdmin && (
              <span title="Admin access required" className="inline-flex">
                <Lock className="w-3 h-3 text-muted" />
              </span>
            )}
          </button>
        </div>

        {/* Tab Contents */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-primary">
          {toastMessage && (
            <div className="p-3 bg-success/20 border border-success/40 text-success rounded-xl text-xs font-bold flex items-center gap-2 animate-bounce">
              <Check className="w-4 h-4" />
              <span>{toastMessage}</span>
            </div>
          )}

          {/* 1. READER DEFAULTS & PRACTICAL OPTIONS */}
          {activeSection === 'reader' && (
            <div className="space-y-6 text-xs">
              {/* Reading Performance Card */}
              <div className="p-5 bg-app rounded-2xl border border-edge space-y-4">
                <div className="font-bold text-primary text-sm flex items-center gap-2">
                  <Zap className="w-4 h-4 text-accent" />
                  Performance & Preload Options
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
                    <label className="font-bold text-secondary">Default Reading Mode:</label>
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
                      <option value="single">📄 Single Page View</option>
                      <option value="double">📖 Double Page Book Spread</option>
                    </select>
                  </div>
                  <div className="space-y-1.5 p-3 rounded-xl bg-surface border border-edge col-span-1 sm:col-span-2">
                    <label className="font-bold text-secondary flex items-center gap-1.5">
                      <Globe className="w-4 h-4 text-info" />
                      <span>Preferred Content & Translation Language:</span>
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
                      <div className="text-[11px] text-secondary">Show the small "Page X / Y" counter on each reader page</div>
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
                <div className="font-bold text-primary text-sm">Image Fit & Rendering Filters</div>
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
                    <label className="font-bold text-secondary">Default Color Filter:</label>
                    <select
                      value={formData.readerDefaults.imageFilter}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          readerDefaults: { ...formData.readerDefaults, imageFilter: e.target.value as ReaderImageFilter },
                        })
                      }
                      className="w-full bg-surface border border-edge rounded-xl p-2.5 text-primary text-xs"
                    >
                      <option value="normal">Normal Original Colors</option>
                      <option value="oled">⚡ OLED Pitch Black Contrast</option>
                      <option value="grayscale">Grayscale Black & White</option>
                      <option value="sepia">Warm Sepia Reading Tone</option>
                      <option value="invert">Night High Contrast Inverted</option>
                      <option value="brightness">Enhanced Brightness Boost</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 1.5 AUTO-UPDATE FEED */}
          {activeSection === 'autoupdate' && (
            isAdmin ? (
              <AutoUpdateView
                logs={logs}
                config={dbConfig}
                mangaList={mangaList}
                onRunAutoUpdate={onRunAutoUpdate}
                isUpdating={isUpdating}
              />
            ) : (
              renderAdminLockNotice('Auto-Update Feed & Release Crawler')
            )
          )}

          {/* 2. DUPLICATE FINDER & MERGER */}
          {activeSection === 'duplicates' && (
            isAdmin ? (
              <DuplicateFinderView
                candidates={duplicateCandidates}
                onScanDuplicates={onScanDuplicates}
                isScanning={isScanningDuplicates}
                onExecuteMerge={onExecuteMerge}
              />
            ) : (
              renderAdminLockNotice('Duplicate Series Merger')
            )
          )}

          {/* 3. SUBDOMAIN CONFIGURATION */}
          {activeSection === 'subdomain' && (
            isAdmin ? (
              <div className="space-y-6 text-xs">
                <div className="p-5 bg-app rounded-2xl border border-edge space-y-4">
                  <div>
                    <div className="font-bold text-primary text-sm flex items-center gap-2 mb-1">
                      <Globe className="w-4 h-4 text-info" />
                      Custom Subdomain Configuration
                    </div>
                    <p className="text-secondary text-xs">Set the custom tracker domain for your personal reader deployment.</p>
                  </div>
                  <form onSubmit={handleSaveSubdomain} className="flex gap-3">
                    <input
                      type="text"
                      value={subdomainInput}
                      onChange={(e) => setSubdomainInput(e.target.value)}
                      placeholder="tracker.yoursite.app"
                      className="flex-1 bg-surface border border-edge-strong rounded-xl px-4 py-2.5 text-sm text-primary font-mono focus:outline-none focus:ring-2 focus:ring-info/50 transition-all"
                    />
                    <button
                      type="submit"
                      className="px-5 py-2.5 rounded-xl bg-info hover:bg-info text-white font-bold text-xs flex items-center gap-2 shadow-lg transition-all hover:scale-105"
                    >
                      <Check className="w-4 h-4 stroke-[3]" />
                      Save Domain
                    </button>
                  </form>
                  {subdomainSaved && (
                    <div className="flex items-center gap-2 text-success font-bold text-xs animate-pulse">
                      <Check className="w-3.5 h-3.5" />
                      Subdomain updated successfully!
                    </div>
                  )}
                </div>
              </div>
            ) : (
              renderAdminLockNotice('Tracker Subdomain Routing')
            )
          )}

          {/* 4. UI & APPEARANCE */}
          {activeSection === 'appearance' && (
            <div className="space-y-6 text-xs">
              <div className="space-y-3">
                <label className="font-bold text-primary text-sm flex items-center gap-2">
                  <Palette className="w-4 h-4 text-accent-2" />
                  Primary Application Theme:
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                  {[
                    { id: 'amber', name: 'Cyber Amber', color: 'bg-amber-500' }, // NO-THEME (literal preview swatch)
                    { id: 'emerald', name: 'Kotatsu Emerald', color: 'bg-emerald-500' }, // NO-THEME (literal preview swatch)
                    { id: 'amoled', name: 'AMOLED Dark', color: 'bg-zinc-800' }, // NO-THEME (literal preview swatch)
                    { id: 'violet', name: 'Royal Violet', color: 'bg-purple-500' }, // NO-THEME (literal preview swatch)
                    { id: 'cyberpunk', name: 'Neon Cyber', color: 'bg-cyan-500' }, // NO-THEME (literal preview swatch)
                  ].map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setFormData({ ...formData, appTheme: t.id as AppTheme })}
                      className={`p-3.5 rounded-2xl border text-center font-bold transition-all flex flex-col items-center gap-2 ${
                        formData.appTheme === t.id
                          ? 'border-accent bg-accent/10 text-accent shadow-md'
                          : 'border-edge bg-app text-secondary hover:bg-elevated'
                      }`}
                    >
                      <div className={`w-7 h-7 rounded-full ${t.color} shadow-lg`} />
                      <span className="text-[11px] font-black">{t.name}</span>
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
            </div>
          )}

          {/* 5. SOURCES, CLOUDFLARE & NETWORK */}
          {activeSection === 'sources' && (
            isAdmin ? (
              <div className="space-y-6 text-xs">
                {/* Metadata Sync */}
                <div className="p-5 bg-app rounded-2xl border border-edge space-y-3">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <h4 className="font-extrabold text-primary flex items-center gap-2 text-sm">
                        <RefreshCw className="w-4 h-4 text-info" />
                        Bulk Metadata Refresh Engine
                      </h4>
                      <p className="text-xs text-secondary">Re-fetch latest chapter counts, covers, titles, and ratings across active sources.</p>
                    </div>
                    <button
                      type="button"
                      onClick={handleRefreshAllMetadata}
                      disabled={isRefreshingAll}
                      className="px-4 py-2.5 rounded-xl bg-info hover:bg-info disabled:opacity-50 text-white font-bold text-xs flex items-center gap-2 shadow-lg shadow-info/20 transition-all whitespace-nowrap"
                    >
                      <RefreshCw className={`w-4 h-4 ${isRefreshingAll ? 'animate-spin' : ''}`} />
                      <span>{isRefreshingAll ? 'Refreshing...' : 'Refresh Metadata'}</span>
                    </button>
                  </div>
                  {bulkRefreshStatus && (
                    <div className="p-2.5 bg-info/10 border border-info/30 text-info rounded-lg text-xs font-bold flex items-center gap-2 animate-pulse">
                      <Check className="w-3.5 h-3.5" />
                      <span>{bulkRefreshStatus}</span>
                    </div>
                  )}
                </div>

                {/* Cloudflare Solver */}
                <div className="p-5 bg-app rounded-2xl border border-edge space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="font-bold text-primary text-sm flex items-center gap-2">
                      <Shield className="w-4 h-4 text-success" />
                      Cloudflare Challenge & Anti-DDoS Solver
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-success/20 text-success border border-success/30">
                      Active Bypass
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="flex items-center justify-between p-3.5 rounded-xl bg-surface border border-edge cursor-pointer">
                      <div>
                        <div className="font-bold text-primary">FlareSolverr Bypass</div>
                        <div className="text-[11px] text-secondary">Solve Turnstile challenges</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={formData.enableCloudflareBypass}
                        onChange={(e) => setFormData({ ...formData, enableCloudflareBypass: e.target.checked })}
                        className="w-5 h-5 accent-success"
                      />
                    </label>

                    <div className="space-y-1.5 p-3 rounded-xl bg-surface border border-edge">
                      <label className="font-bold text-secondary">FlareSolverr Proxy Endpoint:</label>
                      <input
                        type="text"
                        value={formData.flareSolverrUrl}
                        onChange={(e) => setFormData({ ...formData, flareSolverrUrl: e.target.value })}
                        placeholder="http://localhost:8191/v1"
                        className="w-full bg-app border border-edge rounded-lg p-2 text-primary text-xs font-mono"
                      />
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              renderAdminLockNotice('Sources & Anti-DDoS Network')
            )
          )}

          {/* 6. BACKUPS & STORAGE */}
          {activeSection === 'backup' && (
            isAdmin ? (
              <div className="space-y-6 text-xs">
                <div className="p-5 bg-app rounded-2xl border border-edge space-y-4">
                  <div className="font-bold text-primary text-sm flex items-center gap-2">
                    <HardDrive className="w-4 h-4 text-accent" />
                    Library Backups & Cache Management
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={handleExportBackup}
                      className="px-4 py-2.5 rounded-xl bg-success hover:bg-success text-accent-fg font-bold flex items-center gap-2 shadow-lg transition-all"
                    >
                      <Download className="w-4 h-4" />
                      <span>Export JSON Backup</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleClearCache}
                      className="px-4 py-2.5 rounded-xl bg-danger/10 hover:bg-danger/20 text-danger font-bold border border-danger/30 flex items-center gap-2 transition-all"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span>Clear Image Cache Buffer</span>
                    </button>
                  </div>
                </div>

                {/* GDPR Cryptographic Encryption & Security Panel */}
                <div className="p-5 bg-app rounded-2xl border border-edge space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-xl bg-accent-2/10 text-accent-2 border border-accent-2/20">
                      <Shield className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="font-extrabold text-primary text-sm">GDPR Cryptographic Data Isolation (Art. 32)</h4>
                      <p className="text-xs text-secondary">All user accounts & private library tracks are encrypted using AES-256-GCM.</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 pt-2 border-t border-edge">
                    <a
                      href={`/api/gdpr/export-data/${encodeURIComponent(activeProfile?.id || 'usr_admin')}`}
                      download
                      className="px-3.5 py-2 rounded-xl bg-accent-2/10 hover:bg-accent-2/20 text-accent-2 border border-accent-2/30 text-xs font-bold flex items-center gap-1.5 transition-all"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download GDPR Data Export (Art. 15)</span>
                    </a>

                    <button
                      type="button"
                      onClick={async () => {
                        const targetId = activeProfile?.id;
                        if (!targetId) return;
                        if (confirm(`Are you sure you want to permanently erase all data for "${activeProfile?.name}" under GDPR Article 17 (Right to be Forgotten)? This cannot be undone.`)) {
                          try {
                            const res = await apiFetch(`/api/gdpr/erase-data/${encodeURIComponent(targetId)}`, { method: 'DELETE' });
                            const data = await res.json().catch(() => ({}));
                            alert(res.ok ? (data.message || 'Erasure complete. All PII records and personal reading entries have been purged.') : `Erasure failed: ${data.message || data.error || res.statusText}`);
                          } catch (e) {
                            alert('Erasure request failed. Check that you are on the host computer.');
                          }
                        }
                      }}
                      className="px-3.5 py-2 rounded-xl bg-danger/10 hover:bg-danger/20 text-danger border border-danger/30 text-xs font-bold flex items-center gap-1.5 transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Right to Erasure / GDPR Wipe (Art. 17)</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              renderAdminLockNotice('Database Backups & Data Isolation')
            )
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-app border-t border-edge flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-elevated hover:bg-elevated text-secondary font-bold text-xs"
          >
            Close
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-accent to-accent-2 hover:from-accent-bright hover:to-accent-2 text-accent-fg font-black text-xs flex items-center gap-2 shadow-lg shadow-accent/20 transition-all hover:scale-105"
          >
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4 stroke-[3]" />}
            <span>Save Settings</span>
          </button>
        </div>
      </div>
    </div>
  );
};
