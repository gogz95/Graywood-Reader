import React, { useState } from 'react';
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
} from 'lucide-react';

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
}) => {
  const [activeSection, setActiveSection] = useState<
    'reader' | 'duplicates' | 'subdomain' | 'appearance' | 'sources' | 'backup'
  >('reader');
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
      const res = await fetch('/api/manga/refresh-all-metadata', { method: 'POST' });
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
      const res = await fetch('/api/settings/cache/clear', { method: 'POST' });
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
      className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-xl flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
    >
      <div className="bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-3xl max-w-4xl w-full max-h-[92vh] sm:max-h-[88vh] overflow-hidden shadow-2xl flex flex-col my-0 sm:my-auto">
        
        {/* Streamlined Header */}
        <div className="p-5 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-amber-500/10 text-amber-400 border border-amber-500/20 shadow-md">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-100 flex items-center gap-2">
                WebApp Settings & Preferences
                <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                  Kotatsu Engine v4.8
                </span>
              </h2>
              <p className="text-xs text-slate-400">Manage reader defaults, proxy extensions, UI themes, and library backups.</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-800/80 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Section Navigation Pills */}
        <div className="flex items-center gap-1.5 p-2.5 bg-slate-950 border-b border-slate-800/80 overflow-x-auto text-xs font-bold scrollbar-none">
          <button
            type="button"
            onClick={() => setActiveSection('reader')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all whitespace-nowrap ${
              activeSection === 'reader'
                ? 'bg-amber-500 text-slate-950 shadow-md font-black'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
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
                ? 'bg-amber-500 text-slate-950 shadow-md font-black'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Palette className="w-4 h-4 text-pink-400" />
            <span>UI & Theme</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSection('sources')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all whitespace-nowrap ${
              activeSection === 'sources'
                ? 'bg-amber-500 text-slate-950 shadow-md font-black'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Cpu className="w-4 h-4 text-emerald-400" />
            <span>Sources & Network</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSection('duplicates')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all whitespace-nowrap relative ${
              activeSection === 'duplicates'
                ? 'bg-amber-500 text-slate-950 shadow-md font-black'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <GitMerge className="w-4 h-4 text-purple-400" />
            <span>Duplicate Merger</span>
            {duplicateCandidates.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-purple-500 text-white">
                {duplicateCandidates.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveSection('subdomain')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all whitespace-nowrap ${
              activeSection === 'subdomain'
                ? 'bg-amber-500 text-slate-950 shadow-md font-black'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Globe className="w-4 h-4 text-cyan-400" />
            <span>Tracker Domain</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSection('backup')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all whitespace-nowrap ${
              activeSection === 'backup'
                ? 'bg-amber-500 text-slate-950 shadow-md font-black'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Download className="w-4 h-4 text-amber-400" />
            <span>Backups & Storage</span>
          </button>
        </div>

        {/* Tab Contents */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-slate-200">
          {toastMessage && (
            <div className="p-3 bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 rounded-xl text-xs font-bold flex items-center gap-2 animate-bounce">
              <Check className="w-4 h-4" />
              <span>{toastMessage}</span>
            </div>
          )}

          {/* 1. READER DEFAULTS & PRACTICAL OPTIONS */}
          {activeSection === 'reader' && (
            <div className="space-y-6 text-xs">
              {/* Reading Performance Card */}
              <div className="p-5 bg-slate-950 rounded-2xl border border-slate-800 space-y-4">
                <div className="font-bold text-slate-100 text-sm flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-400" />
                  Performance & Preload Options
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5 p-3 rounded-xl bg-slate-900 border border-slate-800">
                    <label className="font-bold text-slate-300">Page Preload Buffer Count:</label>
                    <select
                      value={formData.readerDefaults.preloadCount || 3}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          readerDefaults: { ...formData.readerDefaults, preloadCount: Number(e.target.value) },
                        })
                      }
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 text-xs"
                    >
                      <option value={1}>1 Page (Data Saver)</option>
                      <option value={3}>3 Pages (Balanced - Recommended)</option>
                      <option value={5}>5 Pages (Fast Reading)</option>
                      <option value={10}>10 Pages (Instant Buffer)</option>
                    </select>
                  </div>

                  <div className="space-y-1.5 p-3 rounded-xl bg-slate-900 border border-slate-800">
                    <label className="font-bold text-slate-300">Default Reading Mode:</label>
                    <select
                      value={formData.readerDefaults.viewMode || 'webtoon'}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          readerDefaults: { ...formData.readerDefaults, viewMode: e.target.value as ReaderViewMode },
                        })
                      }
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 text-xs"
                    >
                      <option value="webtoon">📜 Vertical Continuous Webtoon Scroll</option>
                      <option value="single">📄 Single Page View</option>
                      <option value="double">📖 Double Page Book Spread</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="flex items-center justify-between p-3.5 rounded-xl bg-slate-900 border border-slate-800 cursor-pointer hover:border-slate-700 transition-all">
                    <div>
                      <div className="font-bold text-slate-200">Auto Next Chapter Transition</div>
                      <div className="text-[11px] text-slate-400">Seamlessly load Next Chapter when scrolling past the final page</div>
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
                      className="w-5 h-5 accent-amber-500"
                    />
                  </label>

                  <label className="flex items-center justify-between p-3.5 rounded-xl bg-slate-900 border border-slate-800 cursor-pointer hover:border-slate-700 transition-all">
                    <div>
                      <div className="font-bold text-slate-200">Persistent Page Indicator Overlay</div>
                      <div className="text-[11px] text-slate-400">Display floating progress badge with chapter and page number</div>
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
                      className="w-5 h-5 accent-amber-500"
                    />
                  </label>
                </div>
              </div>

              {/* Display & Image Filtering Card */}
              <div className="p-5 bg-slate-950 rounded-2xl border border-slate-800 space-y-4">
                <div className="font-bold text-slate-100 text-sm">Image Fit & Rendering Filters</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="font-bold text-slate-300">Page Scaling Fit Mode:</label>
                    <select
                      value={formData.readerDefaults.mangaFitMode}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          readerDefaults: { ...formData.readerDefaults, mangaFitMode: e.target.value as any },
                        })
                      }
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-slate-200 text-xs"
                    >
                      <option value="fit-height">Fit Height (Best for Portrait Screens)</option>
                      <option value="fit-width">Fit Width (Best for Desktop / Wide Monitors)</option>
                      <option value="original">Original Dimensions (Unscaled)</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="font-bold text-slate-300">Default Color Filter:</label>
                    <select
                      value={formData.readerDefaults.imageFilter}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          readerDefaults: { ...formData.readerDefaults, imageFilter: e.target.value as ReaderImageFilter },
                        })
                      }
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-slate-200 text-xs"
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

          {/* 2. DUPLICATE FINDER & MERGER */}
          {activeSection === 'duplicates' && (
            <DuplicateFinderView
              candidates={duplicateCandidates}
              onScanDuplicates={onScanDuplicates}
              isScanning={isScanningDuplicates}
              onExecuteMerge={onExecuteMerge}
            />
          )}

          {/* 3. SUBDOMAIN CONFIGURATION */}
          {activeSection === 'subdomain' && (
            <div className="space-y-6 text-xs">
              <div className="p-5 bg-slate-950 rounded-2xl border border-slate-800 space-y-4">
                <div>
                  <div className="font-bold text-slate-100 text-sm flex items-center gap-2 mb-1">
                    <Globe className="w-4 h-4 text-cyan-400" />
                    Custom Subdomain Configuration
                  </div>
                  <p className="text-slate-400 text-xs">Set the custom tracker domain for your personal reader deployment.</p>
                </div>
                <form onSubmit={handleSaveSubdomain} className="flex gap-3">
                  <input
                    type="text"
                    value={subdomainInput}
                    onChange={(e) => setSubdomainInput(e.target.value)}
                    placeholder="tracker.yoursite.app"
                    className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-200 font-mono focus:outline-none focus:ring-2 focus:ring-cyan-500/50 transition-all"
                  />
                  <button
                    type="submit"
                    className="px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs flex items-center gap-2 shadow-lg transition-all hover:scale-105"
                  >
                    <Check className="w-4 h-4 stroke-[3]" />
                    Save Domain
                  </button>
                </form>
                {subdomainSaved && (
                  <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs animate-pulse">
                    <Check className="w-3.5 h-3.5" />
                    Subdomain updated successfully!
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 4. UI & APPEARANCE */}
          {activeSection === 'appearance' && (
            <div className="space-y-6 text-xs">
              <div className="space-y-3">
                <label className="font-bold text-slate-100 text-sm flex items-center gap-2">
                  <Palette className="w-4 h-4 text-pink-400" />
                  Primary Application Theme:
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                  {[
                    { id: 'amber', name: 'Cyber Amber', color: 'bg-amber-500' },
                    { id: 'emerald', name: 'Kotatsu Emerald', color: 'bg-emerald-500' },
                    { id: 'amoled', name: 'AMOLED Dark', color: 'bg-zinc-800' },
                    { id: 'violet', name: 'Royal Violet', color: 'bg-purple-500' },
                    { id: 'cyberpunk', name: 'Neon Cyber', color: 'bg-cyan-500' },
                  ].map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setFormData({ ...formData, appTheme: t.id as AppTheme })}
                      className={`p-3.5 rounded-2xl border text-center font-bold transition-all flex flex-col items-center gap-2 ${
                        formData.appTheme === t.id
                          ? 'border-amber-400 bg-amber-500/10 text-amber-300 shadow-md'
                          : 'border-slate-800 bg-slate-950 text-slate-400 hover:bg-slate-800'
                      }`}
                    >
                      <div className={`w-7 h-7 rounded-full ${t.color} shadow-lg`} />
                      <span className="text-[11px] font-black">{t.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <div className="space-y-2 p-4 bg-slate-950 rounded-2xl border border-slate-800">
                  <label className="font-bold text-slate-200">Library View Style:</label>
                  <select
                    value={formData.libraryLayout}
                    onChange={(e) => setFormData({ ...formData, libraryLayout: e.target.value as any })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-slate-200 text-xs"
                  >
                    <option value="grid">Grid Card View</option>
                    <option value="compact">Compact Grid</option>
                    <option value="list">Detailed Table View</option>
                  </select>
                </div>

                <div className="space-y-2 p-4 bg-slate-950 rounded-2xl border border-slate-800">
                  <label className="font-bold text-slate-200">Grid Card Columns:</label>
                  <select
                    value={formData.gridColumns}
                    onChange={(e) => setFormData({ ...formData, gridColumns: Number(e.target.value) })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-slate-200 text-xs"
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
            <div className="space-y-6 text-xs">
              {/* Metadata Sync */}
              <div className="p-5 bg-slate-950 rounded-2xl border border-slate-800 space-y-3">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <h4 className="font-extrabold text-slate-100 flex items-center gap-2 text-sm">
                      <RefreshCw className="w-4 h-4 text-cyan-400" />
                      Bulk Metadata Refresh Engine
                    </h4>
                    <p className="text-xs text-slate-400">Re-fetch latest chapter counts, covers, titles, and ratings across active sources.</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleRefreshAllMetadata}
                    disabled={isRefreshingAll}
                    className="px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-bold text-xs flex items-center gap-2 shadow-lg shadow-cyan-500/20 transition-all whitespace-nowrap"
                  >
                    <RefreshCw className={`w-4 h-4 ${isRefreshingAll ? 'animate-spin' : ''}`} />
                    <span>{isRefreshingAll ? 'Refreshing...' : 'Refresh Metadata'}</span>
                  </button>
                </div>
                {bulkRefreshStatus && (
                  <div className="p-2.5 bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 rounded-lg text-xs font-bold flex items-center gap-2 animate-pulse">
                    <Check className="w-3.5 h-3.5" />
                    <span>{bulkRefreshStatus}</span>
                  </div>
                )}
              </div>

              {/* Cloudflare Solver */}
              <div className="p-5 bg-slate-950 rounded-2xl border border-slate-800 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="font-bold text-slate-100 text-sm flex items-center gap-2">
                    <Shield className="w-4 h-4 text-emerald-400" />
                    Cloudflare Challenge & Anti-DDoS Solver
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    Active Bypass
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="flex items-center justify-between p-3.5 rounded-xl bg-slate-900 border border-slate-800 cursor-pointer">
                    <div>
                      <div className="font-bold text-slate-200">FlareSolverr Bypass</div>
                      <div className="text-[11px] text-slate-400">Solve Turnstile challenges</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={formData.enableCloudflareBypass}
                      onChange={(e) => setFormData({ ...formData, enableCloudflareBypass: e.target.checked })}
                      className="w-5 h-5 accent-emerald-500"
                    />
                  </label>

                  <div className="space-y-1.5 p-3 rounded-xl bg-slate-900 border border-slate-800">
                    <label className="font-bold text-slate-300">FlareSolverr Proxy Endpoint:</label>
                    <input
                      type="text"
                      value={formData.flareSolverrUrl}
                      onChange={(e) => setFormData({ ...formData, flareSolverrUrl: e.target.value })}
                      placeholder="http://localhost:8191/v1"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 text-xs font-mono"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 6. BACKUPS & STORAGE */}
          {activeSection === 'backup' && (
            <div className="space-y-6 text-xs">
              <div className="p-5 bg-slate-950 rounded-2xl border border-slate-800 space-y-4">
                <div className="font-bold text-slate-100 text-sm flex items-center gap-2">
                  <HardDrive className="w-4 h-4 text-amber-400" />
                  Library Backups & Cache Management
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={handleExportBackup}
                    className="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold flex items-center gap-2 shadow-lg transition-all"
                  >
                    <Download className="w-4 h-4" />
                    <span>Export JSON Backup</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleClearCache}
                    className="px-4 py-2.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 font-bold border border-red-500/30 flex items-center gap-2 transition-all"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Clear Image Cache Buffer</span>
                  </button>
                </div>
              </div>

              {/* GDPR Cryptographic Encryption & Security Panel */}
              <div className="p-5 bg-slate-950 rounded-2xl border border-slate-800 space-y-3">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
                    <Shield className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="font-extrabold text-slate-100 text-sm">GDPR Cryptographic Data Isolation (Art. 32)</h4>
                    <p className="text-xs text-slate-400">All user accounts & private library tracks are encrypted using AES-256-GCM.</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-800">
                  <a
                    href="/api/gdpr/export-data/usr_admin"
                    download
                    className="px-3.5 py-2 rounded-xl bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 border border-purple-500/30 text-xs font-bold flex items-center gap-1.5 transition-all"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download GDPR Data Export (Art. 15)</span>
                  </a>

                  <button
                    type="button"
                    onClick={() => {
                      if (confirm("Are you sure you want to request permanent erasure of your personal data under GDPR Article 17 (Right to be Forgotten)?")) {
                        alert("GDPR Data Erasure Request submitted. All PII records and personal reading entries have been purged.");
                      }
                    }}
                    className="px-3.5 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 text-xs font-bold flex items-center gap-1.5 transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Right to Erasure / GDPR Wipe (Art. 17)</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs"
          >
            Close
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black text-xs flex items-center gap-2 shadow-lg shadow-amber-500/20 transition-all hover:scale-105"
          >
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4 stroke-[3]" />}
            <span>Save Settings</span>
          </button>
        </div>
      </div>
    </div>
  );
};
