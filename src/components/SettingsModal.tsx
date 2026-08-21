import React, { useState, useEffect } from 'react';
import { apiFetch } from '../utils/api';
import {
  AppSettings,
  ReaderViewMode,
  ReaderBgColor,
  ReaderImageFilter,
  AppTheme,
  DuplicateCandidate,
  DatabaseSyncConfig,
  MangaItem
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
  Sparkles,
  AlertTriangle,
  ExternalLink,
  Eye,
  Upload,
  Loader2,
  CheckCircle2,
  XCircle,
  FileText,
  Bell,
  Send,
  KeyRound,
  Fingerprint,
  Volume2,
  Clock,
} from 'lucide-react';
import { parseTachiyomiBackup, exportToTachiyomiBackup } from '../utils/tachiyomiImporter';
import { parseKotatsuBackup, exportToKotatsuBackup } from '../utils/kotatsuImporter';
import { AutoUpdateView } from './AutoUpdateView';
import { AutoUpdateLog, UserProfile } from '../types';
import { hashPin } from './AppLockOverlay';

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

export const SettingsModal: React.FC<SettingsModalProps> = React.memo(({
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
    'reader' | 'appearance' | 'autoupdate' | 'sources' | 'webhooks' | 'security' | 'duplicates' | 'subdomain' | 'restore' | 'backup'
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

  // FlareSolverr & Captcha Solver Test States
  const [isTestingFlareSolverr, setIsTestingFlareSolverr] = useState(false);
  const [flareSolverrTestStatus, setFlareSolverrTestStatus] = useState<{ ok: boolean; message: string; latency?: number } | null>(null);

  const [isCheckingCaptchaBalance, setIsCheckingCaptchaBalance] = useState(false);
  const [captchaBalanceStatus, setCaptchaBalanceStatus] = useState<{ ok: boolean; message: string; balance?: number } | null>(null);
  const [showCaptchaKey, setShowCaptchaKey] = useState(false);

  const handleTestFlareSolverr = async () => {
    setIsTestingFlareSolverr(true);
    setFlareSolverrTestStatus(null);
    try {
      const res = await apiFetch('/api/solver/test-flaresolverr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: formData.flareSolverrUrl }),
      });
      const data = await res.json();
      if (data.success) {
        setFlareSolverrTestStatus({ ok: true, message: `Connected! Latency: ${data.latencyMs}ms`, latency: data.latencyMs });
      } else {
        setFlareSolverrTestStatus({ ok: false, message: data.message || data.error || 'Connection failed' });
      }
    } catch (err: any) {
      setFlareSolverrTestStatus({ ok: false, message: err.message || 'Network error connecting to FlareSolverr' });
    } finally {
      setIsTestingFlareSolverr(false);
    }
  };

  const handleCheckCaptchaBalance = async () => {
    setIsCheckingCaptchaBalance(true);
    setCaptchaBalanceStatus(null);
    try {
      const res = await apiFetch('/api/solver/check-balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: formData.captchaApiKey }),
      });
      const data = await res.json();
      if (data.success) {
        setCaptchaBalanceStatus({ ok: true, message: `${data.provider} Active: $${Number(data.balance).toFixed(2)} ${data.currency}`, balance: data.balance });
      } else {
        setCaptchaBalanceStatus({ ok: false, message: data.error || 'Invalid API key or balance unavailable' });
      }
    } catch (err: any) {
      setCaptchaBalanceStatus({ ok: false, message: err.message || 'Error checking solver balance' });
    } finally {
      setIsCheckingCaptchaBalance(false);
    }
  };

  // Webhook Testing States
  const [isTestingDiscord, setIsTestingDiscord] = useState(false);
  const [discordTestStatus, setDiscordTestStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [isTestingTelegram, setIsTestingTelegram] = useState(false);
  const [telegramTestStatus, setTelegramTestStatus] = useState<{ ok: boolean; message: string } | null>(null);

  // App Lock Pin Setup States
  const [pinInput, setPinInput] = useState('');
  const [pinConfirmInput, setPinConfirmInput] = useState('');
  const [pinMessage, setPinMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const handleTestDiscord = async () => {
    setIsTestingDiscord(true);
    setDiscordTestStatus(null);
    try {
      const res = await apiFetch('/api/webhooks/test-discord', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhookUrl: formData.discordWebhookUrl }),
      });
      const data = await res.json();
      if (data.success) {
        setDiscordTestStatus({ ok: true, message: data.message || 'Discord notification sent!' });
      } else {
        setDiscordTestStatus({ ok: false, message: data.error || 'Failed to send Discord notification' });
      }
    } catch (err: any) {
      setDiscordTestStatus({ ok: false, message: err.message || 'Network error' });
    } finally {
      setIsTestingDiscord(false);
    }
  };

  const handleTestTelegram = async () => {
    setIsTestingTelegram(true);
    setTelegramTestStatus(null);
    try {
      const res = await apiFetch('/api/webhooks/test-telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botToken: formData.telegramBotToken,
          chatId: formData.telegramChatId,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setTelegramTestStatus({ ok: true, message: data.message || 'Telegram notification sent!' });
      } else {
        setTelegramTestStatus({ ok: false, message: data.error || 'Failed to send Telegram notification' });
      }
    } catch (err: any) {
      setTelegramTestStatus({ ok: false, message: err.message || 'Network error' });
    } finally {
      setIsTestingTelegram(false);
    }
  };

  const handleSetNewPin = async () => {
    if (!pinInput || pinInput.length < 4) {
      setPinMessage({ ok: false, text: 'PIN must be at least 4 digits.' });
      return;
    }
    if (pinInput !== pinConfirmInput) {
      setPinMessage({ ok: false, text: 'PINs do not match.' });
      return;
    }
    const hashed = await hashPin(pinInput);
    setFormData((prev) => ({
      ...prev,
      appLockPinHash: hashed,
      appLockEnabled: true,
    }));
    setPinMessage({ ok: true, text: 'PIN updated and App Lock enabled!' });
    setPinInput('');
    setPinConfirmInput('');
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4500);
  };

  // Local Scheduled Backups State
  const [localBackups, setLocalBackups] = useState<Array<{ filename: string; sizeBytes: number; createdAt: string; seriesCount: number }>>([]);
  const [isLoadingBackups, setIsLoadingBackups] = useState(false);
  const [isTriggeringBackup, setIsTriggeringBackup] = useState(false);

  const fetchLocalBackups = async () => {
    setIsLoadingBackups(true);
    try {
      const res = await apiFetch('/api/backups');
      if (res.ok) {
        const data = await res.json();
        setLocalBackups(data.backups || []);
      }
    } catch {} finally {
      setIsLoadingBackups(false);
    }
  };

  const handleTriggerBackup = async () => {
    setIsTriggeringBackup(true);
    try {
      const res = await apiFetch('/api/backups/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'manual' }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(`✓ Backup ${data.filename} created!`);
        fetchLocalBackups();
      } else {
        showToast(`❌ Backup failed: ${data.error}`);
      }
    } catch (err: any) {
      showToast(`❌ Backup failed: ${err.message}`);
    } finally {
      setIsTriggeringBackup(false);
    }
  };

  const handleRestoreLocalBackup = async (filename: string) => {
    if (!window.confirm(`Are you sure you want to restore from ${filename}? Existing library state will be merged.`)) return;
    try {
      const res = await apiFetch(`/api/backups/${encodeURIComponent(filename)}/restore`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast(`✓ ${data.message}`);
        onRefreshData();
      } else {
        showToast(`❌ Restore failed: ${data.error}`);
      }
    } catch (err: any) {
      showToast(`❌ Restore failed: ${err.message}`);
    }
  };

  const handleDeleteLocalBackup = async (filename: string) => {
    if (!window.confirm(`Delete backup ${filename}?`)) return;
    try {
      const res = await apiFetch(`/api/backups/${encodeURIComponent(filename)}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        showToast(`✓ Backup deleted.`);
        fetchLocalBackups();
      }
    } catch (err: any) {
      showToast(`❌ Delete failed: ${err.message}`);
    }
  };

  useEffect(() => {
    if (activeSection === 'backup') {
      fetchLocalBackups();
    }
  }, [activeSection]);

  // Restoration Progress Tracker State
  const [restoreProgress, setRestoreProgress] = useState<{
    isActive: boolean;
    stage: 'reading_file' | 'parsing' | 'restoring' | 'indexing' | 'completed' | 'error';
    sourceType: 'Kotatsu' | 'Tachiyomi' | 'Graywood Snapshot' | 'Backup';
    fileName?: string;
    current: number;
    total: number;
    percent: number;
    currentSeriesTitle?: string;
    statusMessage: string;
    errorMessage?: string;
  }>({
    isActive: false,
    stage: 'reading_file',
    sourceType: 'Backup',
    current: 0,
    total: 0,
    percent: 0,
    statusMessage: '',
  });

  const executeRestorationPipeline = async (
    sourceType: 'Kotatsu' | 'Tachiyomi' | 'Graywood Snapshot',
    file: File,
    parseFn: (onProgress: (status: string, percent: number) => void) => Promise<MangaItem[]> | MangaItem[]
  ) => {
    setRestoreProgress({
      isActive: true,
      stage: 'reading_file',
      sourceType,
      fileName: file.name,
      current: 0,
      total: 0,
      percent: 5,
      statusMessage: `Reading "${file.name}"...`,
    });

    try {
      await new Promise((r) => setTimeout(r, 60));

      setRestoreProgress((prev) => ({
        ...prev,
        stage: 'parsing',
        percent: 12,
        statusMessage: `Decompressing and analyzing ${sourceType} backup data...`,
      }));

      const imported = await parseFn((status, pct) => {
        setRestoreProgress((prev) => ({
          ...prev,
          stage: 'parsing',
          percent: pct,
          statusMessage: status,
        }));
      });

      if (!imported || imported.length === 0) {
        throw new Error(`No manga series found in this ${sourceType} backup file.`);
      }

      const total = imported.length;
      setRestoreProgress((prev) => ({
        ...prev,
        stage: 'restoring',
        total,
        percent: 25,
        statusMessage: `Discovered ${total} series. Starting atomic database restoration...`,
      }));

      const batchSize = 250;
      for (let i = 0; i < total; i += batchSize) {
        const chunk = imported.slice(i, i + batchSize);
        const currentCount = Math.min(total, i + chunk.length);
        const currentPercent = Math.round(25 + ((currentCount / total) * 65));
        const lastTitle = chunk[chunk.length - 1]?.title;

        setRestoreProgress((prev) => ({
          ...prev,
          current: currentCount,
          percent: currentPercent,
          currentSeriesTitle: lastTitle,
          statusMessage: `Restoring series batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(total / batchSize)} (${currentCount} of ${total})...`,
        }));

        const bulkRes = await apiFetch('/api/manga/bulk-import', {
          method: 'POST',
          body: JSON.stringify(chunk),
        });

        if (!bulkRes.ok) {
          const data = await bulkRes.json().catch(() => ({}));
          throw new Error(data.message || data.error || `Failed to restore ${sourceType} backup`);
        }
      }

      setRestoreProgress((prev) => ({
        ...prev,
        stage: 'indexing',
        current: total,
        percent: 96,
        statusMessage: 'Finalizing category shelves, reading positions, and refreshing library...',
      }));

      await onRefreshData();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('refresh-categories'));
      }

      setRestoreProgress((prev) => ({
        ...prev,
        stage: 'completed',
        percent: 100,
        statusMessage: `✓ Successfully restored all ${total} series and categories into your library!`,
      }));

      showToast(`✓ Successfully restored ${total} series from ${sourceType} backup!`);
    } catch (err: any) {
      setRestoreProgress((prev) => ({
        ...prev,
        stage: 'error',
        errorMessage: err.message || 'Restoration failed',
        statusMessage: `Restoration failed: ${err.message}`,
      }));
    }
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
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
    >
      <div className="relative bg-surface border border-edge rounded-t-3xl sm:rounded-3xl max-w-4xl w-full max-h-[92vh] sm:max-h-[88vh] overflow-hidden shadow-2xl flex flex-col my-0 sm:my-auto">
        
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
        <div className="flex flex-wrap items-center gap-1.5 p-2.5 bg-app border-b border-edge/80 text-xs sm:text-sm font-bold">
          <button
            type="button"
            onClick={() => setActiveSection('reader')}
            className={`flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl transition-all whitespace-nowrap ${
              activeSection === 'reader'
                ? 'bg-accent text-accent-fg shadow-md font-black'
                : 'text-secondary hover:text-primary hover:bg-elevated/60'
            }`}
          >
            <BookOpen className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
            <span>Reader & Layout</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSection('appearance')}
            className={`flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl transition-all whitespace-nowrap ${
              activeSection === 'appearance'
                ? 'bg-accent text-accent-fg shadow-md font-black'
                : 'text-secondary hover:text-primary hover:bg-elevated/60'
            }`}
          >
            <Palette className="w-4 h-4 sm:w-4.5 sm:h-4.5 text-accent-2" />
            <span>UI & Theme</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSection('autoupdate')}
            className={`flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl transition-all whitespace-nowrap ${
              activeSection === 'autoupdate'
                ? 'bg-accent text-accent-fg shadow-md font-black'
                : 'text-secondary hover:text-primary hover:bg-elevated/60'
            }`}
          >
            <Zap className="w-4 h-4 sm:w-4.5 sm:h-4.5 text-accent-2" />
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
            className={`flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl transition-all whitespace-nowrap ${
              activeSection === 'sources'
                ? 'bg-accent text-accent-fg shadow-md font-black'
                : 'text-secondary hover:text-primary hover:bg-elevated/60'
            }`}
          >
            <Cpu className="w-4 h-4 sm:w-4.5 sm:h-4.5 text-success" />
            <span>Sources & Network</span>
            {!isAdmin && (
              <span title="Admin access required" className="inline-flex">
                <Lock className="w-3 h-3 text-muted" />
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveSection('webhooks')}
            className={`flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl transition-all whitespace-nowrap ${
              activeSection === 'webhooks'
                ? 'bg-accent text-accent-fg shadow-md font-black'
                : 'text-secondary hover:text-primary hover:bg-elevated/60'
            }`}
          >
            <Bell className="w-4 h-4 sm:w-4.5 sm:h-4.5 text-indigo-400" />
            <span>Webhooks & Push</span>
            {!isAdmin && (
              <span title="Admin access required" className="inline-flex">
                <Lock className="w-3 h-3 text-muted" />
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveSection('security')}
            className={`flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl transition-all whitespace-nowrap ${
              activeSection === 'security'
                ? 'bg-accent text-accent-fg shadow-md font-black'
                : 'text-secondary hover:text-primary hover:bg-elevated/60'
            }`}
          >
            <KeyRound className="w-4 h-4 sm:w-4.5 sm:h-4.5 text-amber-400" />
            <span>App Lock & Security</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSection('duplicates')}
            className={`flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl transition-all whitespace-nowrap relative ${
              activeSection === 'duplicates'
                ? 'bg-accent text-accent-fg shadow-md font-black'
                : 'text-secondary hover:text-primary hover:bg-elevated/60'
            }`}
          >
            <GitMerge className="w-4 h-4 sm:w-4.5 sm:h-4.5 text-accent-2" />
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
            className={`flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl transition-all whitespace-nowrap ${
              activeSection === 'subdomain'
                ? 'bg-accent text-accent-fg shadow-md font-black'
                : 'text-secondary hover:text-primary hover:bg-elevated/60'
            }`}
          >
            <Globe className="w-4 h-4 sm:w-4.5 sm:h-4.5 text-info" />
            <span>Tracker Domain</span>
            {!isAdmin && (
              <span title="Admin access required" className="inline-flex">
                <Lock className="w-3 h-3 text-muted" />
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveSection('restore')}
            className={`flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl transition-all whitespace-nowrap ${
              activeSection === 'restore'
                ? 'bg-accent text-accent-fg shadow-md font-black'
                : 'text-secondary hover:text-primary hover:bg-elevated/60'
            }`}
          >
            {restoreProgress.isActive && restoreProgress.stage !== 'completed' && restoreProgress.stage !== 'error' ? (
              <Loader2 className="w-4 h-4 sm:w-4.5 sm:h-4.5 text-accent-2 animate-spin" />
            ) : (
              <Upload className="w-4 h-4 sm:w-4.5 sm:h-4.5 text-accent-2" />
            )}
            <span>Backup & Restore</span>
            {restoreProgress.isActive && (
              <span className={`px-1.5 py-0.2 rounded text-[10px] font-black ${
                restoreProgress.stage === 'completed'
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : restoreProgress.stage === 'error'
                  ? 'bg-rose-500/20 text-rose-300'
                  : 'bg-accent-2/20 text-accent-2 border border-accent-2/30 animate-pulse'
              }`}>
                {restoreProgress.percent}%
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveSection('backup')}
            className={`flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl transition-all whitespace-nowrap ${
              activeSection === 'backup'
                ? 'bg-accent text-accent-fg shadow-md font-black'
                : 'text-secondary hover:text-primary hover:bg-elevated/60'
            }`}
          >
            <HardDrive className="w-4 h-4 sm:w-4.5 sm:h-4.5 text-accent" />
            <span>System Storage</span>
            {!isAdmin && (
              <span title="Admin access required" className="inline-flex">
                <Lock className="w-3 h-3 text-muted" />
              </span>
            )}
          </button>
        </div>

        {/* Tab Contents */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-primary">

          {/* 1. READER DEFAULTS & PRACTICAL OPTIONS */}
          {activeSection === 'reader' && (
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
                          <span>Smart Format Auto-Selection & Layout Memory</span>
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
              <div className="space-y-6 text-xs sm:text-sm">
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
                      className="px-5 sm:px-6 py-2.5 sm:py-3 rounded-xl bg-info hover:bg-info text-white font-bold text-xs sm:text-sm flex items-center gap-2 shadow-lg transition-all hover:scale-105"
                    >
                      <Check className="w-4 h-4 sm:w-5 sm:h-5 stroke-[3]" />
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
            <div className="space-y-6 text-xs sm:text-sm">
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
              <div className="space-y-6 text-xs sm:text-sm">
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

                {/* Cloudflare & Captcha Solver Card */}
                <div className="p-5 bg-app rounded-2xl border border-edge space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="font-bold text-primary text-sm flex items-center gap-2">
                      <Shield className="w-4 h-4 text-success" />
                      Cloudflare Challenge & Auto Captcha Solver
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-success/20 text-success border border-success/30">
                      Active Defense Bypass
                    </span>
                  </div>

                  {/* FlareSolverr Section */}
                  <div className="space-y-3 p-4 bg-surface rounded-xl border border-edge">
                    <label className="flex items-center justify-between cursor-pointer">
                      <div>
                        <div className="font-bold text-primary flex items-center gap-2">
                          <span>FlareSolverr Automated Browser Bypass</span>
                        </div>
                        <div className="text-[11px] text-secondary">Automatically solve Cloudflare Turnstile & DDoS browser checks</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={formData.enableCloudflareBypass}
                        onChange={(e) => setFormData({ ...formData, enableCloudflareBypass: e.target.checked })}
                        className="w-5 h-5 accent-success"
                      />
                    </label>

                    <div className="space-y-1.5 pt-1">
                      <label className="font-bold text-secondary text-[11px]">FlareSolverr Service Endpoint URL:</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={formData.flareSolverrUrl}
                          onChange={(e) => setFormData({ ...formData, flareSolverrUrl: e.target.value })}
                          placeholder="http://localhost:8191/v1"
                          className="flex-1 bg-app border border-edge rounded-lg px-3 py-2 text-primary text-xs font-mono"
                        />
                        <button
                          type="button"
                          onClick={handleTestFlareSolverr}
                          disabled={isTestingFlareSolverr}
                          className="px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-lg bg-elevated hover:bg-elevated text-primary font-bold text-xs sm:text-sm flex items-center gap-1.5 border border-edge whitespace-nowrap transition-all"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${isTestingFlareSolverr ? 'animate-spin' : ''}`} />
                          <span>{isTestingFlareSolverr ? 'Testing...' : 'Test Connection'}</span>
                        </button>
                      </div>
                      {flareSolverrTestStatus && (
                        <div className={`p-2 rounded-lg text-xs font-bold flex items-center gap-1.5 ${flareSolverrTestStatus.ok ? 'bg-success/10 text-success border border-success/30' : 'bg-danger/10 text-danger border border-danger/30'}`}>
                          {flareSolverrTestStatus.ok ? <Check className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                          <span>{flareSolverrTestStatus.message}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 2Captcha / CapSolver API Section */}
                  <div className="space-y-3 p-4 bg-surface rounded-xl border border-edge">
                    <label className="flex items-center justify-between cursor-pointer">
                      <div>
                        <div className="font-bold text-primary flex items-center gap-2">
                          <Zap className="w-4 h-4 text-amber-400" />
                          <span>Automated Cloud Captcha Solver (2Captcha / CapSolver)</span>
                        </div>
                        <div className="text-[11px] text-secondary">Solve interactive Turnstile, reCAPTCHA, and hCaptcha challenges automatically via API</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={formData.captchaSolverEnabled}
                        onChange={(e) => setFormData({ ...formData, captchaSolverEnabled: e.target.checked })}
                        className="w-5 h-5 accent-amber-400"
                      />
                    </label>

                    <div className="space-y-1.5 pt-1">
                      <label className="font-bold text-secondary text-[11px]">Solver API Key (2Captcha or CapSolver):</label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <input
                            type={showCaptchaKey ? 'text' : 'password'}
                            value={formData.captchaApiKey || ''}
                            onChange={(e) => setFormData({ ...formData, captchaApiKey: e.target.value })}
                            placeholder="Paste your 2Captcha or CapSolver API client key"
                            className="w-full bg-app border border-edge rounded-lg px-3 py-2 pr-16 text-primary text-xs font-mono"
                          />
                          <button
                            type="button"
                            onClick={() => setShowCaptchaKey(!showCaptchaKey)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-secondary hover:text-primary font-bold px-1.5 py-0.5 rounded bg-elevated"
                          >
                            {showCaptchaKey ? 'Hide' : 'Show'}
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={handleCheckCaptchaBalance}
                          disabled={isCheckingCaptchaBalance || !formData.captchaApiKey}
                          className="px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-lg bg-elevated hover:bg-elevated text-primary font-bold text-xs sm:text-sm flex items-center gap-1.5 border border-edge whitespace-nowrap disabled:opacity-50 transition-all"
                        >
                          <Zap className={`w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-400 ${isCheckingCaptchaBalance ? 'animate-pulse' : ''}`} />
                          <span>{isCheckingCaptchaBalance ? 'Checking...' : 'Check Balance'}</span>
                        </button>
                      </div>
                      {captchaBalanceStatus && (
                        <div className={`p-2 rounded-lg text-xs font-bold flex items-center gap-1.5 ${captchaBalanceStatus.ok ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30' : 'bg-danger/10 text-danger border border-danger/30'}`}>
                          {captchaBalanceStatus.ok ? <Check className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                          <span>{captchaBalanceStatus.message}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* AniList Live Scrobbler Card */}
                <div className="p-5 bg-app rounded-2xl border border-edge space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="font-bold text-primary text-sm flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-accent" />
                      AniList Live Scrobbler & Cloud Sync
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-accent/20 text-accent border border-accent/30">
                      OAuth GraphQL
                    </span>
                  </div>

                  <div className="space-y-3 p-4 bg-surface rounded-xl border border-edge">
                    <label className="flex items-center justify-between cursor-pointer">
                      <div>
                        <div className="font-bold text-primary flex items-center gap-2">
                          <span>Automatic Reading Progress Scrobbling</span>
                        </div>
                        <div className="text-[11px] text-secondary">
                          Automatically update your AniList manga list as you finish chapters in Graywood Reader
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={formData.anilistAutoSync || false}
                        onChange={(e) => setFormData({ ...formData, anilistAutoSync: e.target.checked })}
                        className="w-5 h-5 accent-accent"
                      />
                    </label>

                    <div className="space-y-1.5 pt-1">
                      <div className="flex items-center justify-between">
                        <label className="font-bold text-secondary text-[11px]">AniList Personal Access Token:</label>
                        <a
                          href="https://anilist.co/api/v2/oauth/authorize?client_id=14170&response_type=token"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-accent hover:underline flex items-center gap-1 font-bold"
                        >
                          <span>Get Token</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                      <input
                        type="password"
                        value={formData.anilistToken || ''}
                        onChange={(e) => setFormData({ ...formData, anilistToken: e.target.value })}
                        placeholder="Paste your AniList OAuth access token"
                        className="w-full bg-app border border-edge rounded-lg px-3 py-2 text-primary text-xs font-mono"
                      />
                    </div>
                  </div>
                </div>

              {/* MyAnimeList (MAL) Live Scrobbler Card */}
              <div className="p-5 bg-app rounded-2xl border border-edge space-y-4">
                <div className="flex items-center justify-between">
                  <div className="font-bold text-primary text-sm flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-info" />
                    MyAnimeList Live Scrobbler
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-info/20 text-info border border-info/30">
                    OAuth
                  </span>
                </div>

                <div className="space-y-3 p-4 bg-surface rounded-xl border border-edge">
                  <label className="flex items-center justify-between cursor-pointer">
                    <div>
                      <div className="font-bold text-primary flex items-center gap-2">
                        <span>Automatic MAL Scrobbling</span>
                      </div>
                      <div className="text-[11px] text-secondary">
                        Update your MyAnimeList manga list as you finish chapters in Graywood Reader
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={formData.malAutoSync || false}
                      onChange={(e) => setFormData({ ...formData, malAutoSync: e.target.checked })}
                      className="w-5 h-5 accent-accent"
                    />
                  </label>

                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center justify-between">
                      <label className="font-bold text-secondary text-[11px]">MAL Access Token:</label>
                      <a
                        href="https://myanimelist.net/apiconfig"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] text-info hover:underline flex items-center gap-1 font-bold"
                      >
                        <span>Get Token</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                    <input
                      type="password"
                      value={formData.malToken || ''}
                      onChange={(e) => setFormData({ ...formData, malToken: e.target.value })}
                      placeholder="Paste your MAL OAuth access token"
                      className="w-full bg-app border border-edge rounded-lg px-3 py-2 text-primary text-xs font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* Kitsu Live Scrobbler Card */}
              <div className="p-5 bg-app rounded-2xl border border-edge space-y-4">
                <div className="flex items-center justify-between">
                  <div className="font-bold text-primary text-sm flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-info" />
                    Kitsu Live Scrobbler
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-info/20 text-info border border-info/30">
                    OAuth
                  </span>
                </div>

                <div className="space-y-3 p-4 bg-surface rounded-xl border border-edge">
                  <label className="flex items-center justify-between cursor-pointer">
                    <div>
                      <div className="font-bold text-primary flex items-center gap-2">
                        <span>Automatic Kitsu Scrobbling</span>
                      </div>
                      <div className="text-[11px] text-secondary">
                        Update your Kitsu library as you finish chapters in Graywood Reader
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={formData.kitsuAutoSync || false}
                      onChange={(e) => setFormData({ ...formData, kitsuAutoSync: e.target.checked })}
                      className="w-5 h-5 accent-accent"
                    />
                  </label>

                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center justify-between">
                      <label className="font-bold text-secondary text-[11px]">Kitsu Access Token:</label>
                      <a
                        href="https://kitsu.io/settings"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] text-info hover:underline flex items-center gap-1 font-bold"
                      >
                        <span>Get Token</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                    <input
                      type="password"
                      value={formData.kitsuToken || ''}
                      onChange={(e) => setFormData({ ...formData, kitsuToken: e.target.value })}
                      placeholder="Paste your Kitsu OAuth access token"
                      className="w-full bg-app border border-edge rounded-lg px-3 py-2 text-primary text-xs font-mono"
                    />
                  </div>
                </div>
              </div>
              </div>
            ) : (
              renderAdminLockNotice('Sources & Anti-DDoS Network')
            )
          )}

          {/* WEBHOOKS & PUSH NOTIFICATIONS */}
          {activeSection === 'webhooks' && (
            isAdmin ? (
              <div className="space-y-6 text-xs sm:text-sm">
                <div className="p-5 bg-app rounded-2xl border border-edge space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                      <Bell className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-extrabold text-primary text-sm sm:text-base">
                        Discord & Telegram Chapter Webhooks
                      </h3>
                      <p className="text-secondary text-xs">
                        Dispatch rich notification embeds to Discord channels or Telegram chats whenever background crawlers discover new chapter releases.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Filter Rule Card */}
                <div className="p-4 bg-app rounded-2xl border border-edge">
                  <label className="flex items-center justify-between cursor-pointer">
                    <div>
                      <div className="font-bold text-primary flex items-center gap-2">
                        <span>Reading List Filter Only</span>
                      </div>
                      <div className="text-[11px] text-secondary">
                        Only dispatch notifications for series marked as "Reading" (skips Completed, Dropped, or Plan to Read)
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={formData.notifyOnlyReadingStatus !== false}
                      onChange={(e) => setFormData({ ...formData, notifyOnlyReadingStatus: e.target.checked })}
                      className="w-5 h-5 accent-accent"
                    />
                  </label>
                </div>

                {/* Discord Webhook Card */}
                <div className="p-5 bg-app rounded-2xl border border-edge space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="font-bold text-primary text-sm flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-indigo-500" />
                      <span>Discord Rich Embed Webhook</span>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                      Discord API
                    </span>
                  </div>

                  <div className="space-y-3 p-4 bg-surface rounded-xl border border-edge">
                    <label className="flex items-center justify-between cursor-pointer">
                      <div>
                        <div className="font-bold text-primary">Enable Discord Notifications</div>
                        <div className="text-[11px] text-secondary">Send embedded alerts with cover art and 1-click read buttons</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={formData.discordWebhookEnabled || false}
                        onChange={(e) => setFormData({ ...formData, discordWebhookEnabled: e.target.checked })}
                        className="w-5 h-5 accent-accent"
                      />
                    </label>

                    <div className="space-y-1.5 pt-1">
                      <label className="font-bold text-secondary text-[11px]">Discord Webhook URL:</label>
                      <input
                        type="password"
                        value={formData.discordWebhookUrl || ''}
                        onChange={(e) => setFormData({ ...formData, discordWebhookUrl: e.target.value })}
                        placeholder="https://discord.com/api/webhooks/..."
                        className="w-full bg-app border border-edge rounded-lg px-3 py-2 text-primary text-xs font-mono"
                      />
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-edge/60">
                      <button
                        type="button"
                        onClick={handleTestDiscord}
                        disabled={isTestingDiscord || !formData.discordWebhookUrl}
                        className="px-4 py-2 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 font-bold text-xs flex items-center gap-2 cursor-pointer transition-all disabled:opacity-50"
                      >
                        {isTestingDiscord ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                        <span>Send Test Discord Notification</span>
                      </button>

                      {discordTestStatus && (
                        <span className={`text-xs font-semibold ${discordTestStatus.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {discordTestStatus.message}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Telegram Push Card */}
                <div className="p-5 bg-app rounded-2xl border border-edge space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="font-bold text-primary text-sm flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-sky-500" />
                      <span>Telegram Bot Push Notifications</span>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-sky-500/20 text-sky-300 border border-sky-500/30">
                      Telegram Bot API
                    </span>
                  </div>

                  <div className="space-y-3 p-4 bg-surface rounded-xl border border-edge">
                    <label className="flex items-center justify-between cursor-pointer">
                      <div>
                        <div className="font-bold text-primary">Enable Telegram Alerts</div>
                        <div className="text-[11px] text-secondary">Instant messages to your private Telegram chat or channel</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={formData.telegramWebhookEnabled || false}
                        onChange={(e) => setFormData({ ...formData, telegramWebhookEnabled: e.target.checked })}
                        className="w-5 h-5 accent-accent"
                      />
                    </label>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                      <div className="space-y-1.5">
                        <label className="font-bold text-secondary text-[11px]">Telegram Bot Token:</label>
                        <input
                          type="password"
                          value={formData.telegramBotToken || ''}
                          onChange={(e) => setFormData({ ...formData, telegramBotToken: e.target.value })}
                          placeholder="123456789:ABCdefGhIJKlmNoPQRstuVWXyz"
                          className="w-full bg-app border border-edge rounded-lg px-3 py-2 text-primary text-xs font-mono"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="font-bold text-secondary text-[11px]">Chat / Channel ID:</label>
                        <input
                          type="text"
                          value={formData.telegramChatId || ''}
                          onChange={(e) => setFormData({ ...formData, telegramChatId: e.target.value })}
                          placeholder="@my_manga_channel or -100123456789"
                          className="w-full bg-app border border-edge rounded-lg px-3 py-2 text-primary text-xs font-mono"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-edge/60">
                      <button
                        type="button"
                        onClick={handleTestTelegram}
                        disabled={isTestingTelegram || !formData.telegramBotToken || !formData.telegramChatId}
                        className="px-4 py-2 rounded-xl bg-sky-600/20 hover:bg-sky-600/30 text-sky-300 border border-sky-500/30 font-bold text-xs flex items-center gap-2 cursor-pointer transition-all disabled:opacity-50"
                      >
                        {isTestingTelegram ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                        <span>Send Test Telegram Message</span>
                      </button>

                      {telegramTestStatus && (
                        <span className={`text-xs font-semibold ${telegramTestStatus.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {telegramTestStatus.message}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              renderAdminLockNotice('Push Notifications & Webhooks')
            )
          )}

          {/* APP LOCK & SECURITY */}
          {activeSection === 'security' && (
            <div className="space-y-6 text-xs sm:text-sm">
              <div className="p-5 bg-app rounded-2xl border border-edge space-y-2">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    <KeyRound className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-primary text-sm sm:text-base">
                      App Lock & Privacy Protection
                    </h3>
                    <p className="text-secondary text-xs">
                      Lock Graywood Reader with a numeric PIN or password to protect your library and reading history from unauthorized local access.
                    </p>
                  </div>
                </div>
              </div>

              {/* Master App Lock Toggle */}
              <div className="p-5 bg-app rounded-2xl border border-edge space-y-4">
                <label className="flex items-center justify-between cursor-pointer">
                  <div>
                    <div className="font-bold text-primary text-sm flex items-center gap-2">
                      <Lock className="w-4 h-4 text-amber-400" />
                      <span>Enable Application Lock</span>
                    </div>
                    <div className="text-xs text-secondary mt-0.5">
                      Require PIN or password entry when opening the reader or after an idle timeout
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={formData.appLockEnabled || false}
                    onChange={(e) => setFormData({ ...formData, appLockEnabled: e.target.checked })}
                    className="w-5 h-5 accent-accent"
                  />
                </label>

                {formData.appLockEnabled && (
                  <div className="space-y-4 pt-3 border-t border-edge">
                    {/* Auto-Lock Timeout */}
                    <div className="flex items-center justify-between p-3 rounded-xl bg-surface border border-edge">
                      <div>
                        <div className="font-bold text-primary">Auto-Lock Inactivity Timeout</div>
                        <div className="text-[11px] text-secondary">Automatically lock after inactivity or app blur</div>
                      </div>
                      <select
                        value={formData.appLockTimeoutMinutes ?? 5}
                        onChange={(e) => setFormData({ ...formData, appLockTimeoutMinutes: parseInt(e.target.value, 10) })}
                        className="px-3 py-1.5 rounded-lg bg-app border border-edge text-primary text-xs font-semibold"
                      >
                        <option value={0}>Immediate (Every session)</option>
                        <option value={1}>1 Minute</option>
                        <option value={5}>5 Minutes</option>
                        <option value={15}>15 Minutes</option>
                        <option value={-1}>On Window Minimize / Tab Blur</option>
                      </select>
                    </div>

                    {/* Change / Set PIN */}
                    <div className="p-4 rounded-xl bg-surface border border-edge space-y-3">
                      <div className="font-bold text-primary text-xs">Set / Update Security PIN:</div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="text-[11px] text-secondary block mb-1">New 4–6 Digit PIN:</label>
                          <input
                            type="password"
                            maxLength={6}
                            value={pinInput}
                            onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ''))}
                            placeholder="Enter 4-6 digits"
                            className="w-full bg-app border border-edge rounded-lg px-3 py-2 text-primary text-xs font-mono tracking-widest text-center"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-secondary block mb-1">Confirm PIN:</label>
                          <input
                            type="password"
                            maxLength={6}
                            value={pinConfirmInput}
                            onChange={(e) => setPinConfirmInput(e.target.value.replace(/\D/g, ''))}
                            placeholder="Re-enter digits"
                            className="w-full bg-app border border-edge rounded-lg px-3 py-2 text-primary text-xs font-mono tracking-widest text-center"
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-2">
                        <button
                          type="button"
                          onClick={handleSetNewPin}
                          disabled={!pinInput || pinInput.length < 4}
                          className="px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs shadow-md transition-all cursor-pointer disabled:opacity-50"
                        >
                          Save New PIN
                        </button>

                        {pinMessage && (
                          <span className={`text-xs font-semibold ${pinMessage.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {pinMessage.text}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 6. BACKUP RESTORATION & LIBRARY MIGRATION (Available to all logged-in users) */}
          {activeSection === 'restore' && (
            <div className="space-y-6 text-xs sm:text-sm">
              <div className="p-5 bg-app rounded-2xl border border-edge space-y-2">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-accent-2/10 text-accent-2 border border-accent-2/20">
                    <Upload className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-primary text-sm sm:text-base">
                      Library Backup & Cross-Platform Migration
                    </h3>
                    <p className="text-secondary text-xs">
                      Restore and sync your tracked manga, chapters, and reading progress from external reader apps or backup files directly into your personal account.
                    </p>
                  </div>
                </div>
                {(!activeProfile || activeProfile.id === 'usr_guest') && (
                  <div className="p-3 bg-warning/10 border border-warning/30 rounded-xl text-warning text-xs font-semibold flex items-center gap-2 mt-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>You are browsing as a guest. Restoring backups will add series to the local catalog. Log in to permanently isolate your private library.</span>
                  </div>
                )}
              </div>

              {/* Dynamic Live Restoration Loading Bar Card */}
              {restoreProgress.isActive && (
                <div className={`p-5 rounded-2xl border transition-all duration-300 shadow-xl space-y-3.5 ${
                  restoreProgress.stage === 'completed'
                    ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-100'
                    : restoreProgress.stage === 'error'
                    ? 'bg-rose-950/40 border-rose-500/50 text-rose-100'
                    : 'bg-surface/95 border-accent/40 shadow-accent/5'
                }`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`p-2.5 rounded-xl border flex items-center justify-center shrink-0 ${
                        restoreProgress.stage === 'completed'
                          ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                          : restoreProgress.stage === 'error'
                          ? 'bg-rose-500/20 text-rose-400 border-rose-500/30'
                          : 'bg-accent/20 text-accent border-accent/30'
                      }`}>
                        {restoreProgress.stage === 'completed' ? (
                          <CheckCircle2 className="w-5 h-5" />
                        ) : restoreProgress.stage === 'error' ? (
                          <AlertTriangle className="w-5 h-5" />
                        ) : (
                          <Loader2 className="w-5 h-5 animate-spin" />
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="font-extrabold text-primary text-sm sm:text-base truncate">
                            {restoreProgress.stage === 'completed'
                              ? 'Restoration Completed'
                              : restoreProgress.stage === 'error'
                              ? 'Restoration Failed'
                              : `Restoring ${restoreProgress.sourceType} Backup`}
                          </h4>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${
                            restoreProgress.stage === 'completed'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              : restoreProgress.stage === 'error'
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                              : 'bg-accent/20 text-accent border border-accent/40 animate-pulse'
                          }`}>
                            {restoreProgress.stage.replace('_', ' ')}
                          </span>
                        </div>
                        <p className="text-xs text-secondary truncate">
                          {restoreProgress.fileName ? `File: ${restoreProgress.fileName}` : 'Processing backup archive'}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-mono font-black text-sm sm:text-base text-primary">
                        {restoreProgress.percent}%
                      </span>
                      {(restoreProgress.stage === 'completed' || restoreProgress.stage === 'error') && (
                        <button
                          type="button"
                          onClick={() => setRestoreProgress((prev) => ({ ...prev, isActive: false }))}
                          className="p-1.5 rounded-lg bg-elevated hover:bg-elevated text-secondary hover:text-primary transition-colors text-xs font-bold"
                          title="Dismiss progress notification"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Progress Loading Bar */}
                  <div className="w-full bg-app/90 border border-edge rounded-full h-3.5 overflow-hidden p-0.5 shadow-inner relative">
                    <div
                      className={`h-full rounded-full transition-all duration-300 relative overflow-hidden ${
                        restoreProgress.stage === 'completed'
                          ? 'bg-emerald-400'
                          : restoreProgress.stage === 'error'
                          ? 'bg-rose-500'
                          : 'bg-gradient-to-r from-accent via-accent-2 to-emerald-400'
                      }`}
                      style={{ width: `${Math.min(100, Math.max(3, restoreProgress.percent))}%` }}
                    >
                      {restoreProgress.stage !== 'completed' && restoreProgress.stage !== 'error' && (
                        <div className="absolute inset-0 bg-white/20 animate-pulse" />
                      )}
                    </div>
                  </div>

                  {/* Status Message & Statistics Subtitle */}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="text-secondary font-medium truncate max-w-md">
                      {restoreProgress.statusMessage}
                    </span>
                    {restoreProgress.total > 0 && (
                      <span className="font-mono text-muted text-[11px] shrink-0">
                        {restoreProgress.current} / {restoreProgress.total} series
                      </span>
                    )}
                  </div>

                  {restoreProgress.stage === 'error' && restoreProgress.errorMessage && (
                    <div className="p-3 bg-rose-950/60 border border-rose-500/40 rounded-xl text-rose-200 text-xs font-medium space-y-1">
                      <div className="font-bold">Error Details:</div>
                      <div>{restoreProgress.errorMessage}</div>
                    </div>
                  )}
                </div>
              )}

              {/* Kotatsu Backup Migration Card */}
              <div className="p-5 bg-app rounded-2xl border border-edge space-y-4">
                <div className="flex items-center justify-between">
                  <div className="font-bold text-primary text-sm flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-accent-2" />
                    Kotatsu Ecosystem Backup Migration
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-accent-2/20 text-accent-2 border border-accent-2/30">
                    ZIP & JSON Standard
                  </span>
                </div>

                <p className="text-secondary text-xs">
                  Restore your complete library, categories, and reading history from Kotatsu app backups (supports <code className="text-primary font-mono text-[11px]">.bk.zip</code>, <code className="text-primary font-mono text-[11px]">.zip</code>, or <code className="text-primary font-mono text-[11px]">.json</code>).
                </p>

                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <label className="px-4 py-2.5 rounded-xl bg-accent-2/20 hover:bg-accent-2/30 text-accent-2 border border-accent-2/40 font-bold flex items-center gap-2 shadow-md cursor-pointer transition-all">
                    <Download className="w-4 h-4 rotate-180" />
                    <span>Import Kotatsu Backup (.zip / .json)</span>
                    <input
                      type="file"
                      accept=".zip,.json,.bk.zip,application/zip,application/json"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        executeRestorationPipeline('Kotatsu', file, async (onProgress) => {
                          const arrayBuffer = await file.arrayBuffer();
                          return parseKotatsuBackup(arrayBuffer, activeProfile?.id || 'usr_admin', onProgress);
                        });
                        e.target.value = '';
                      }}
                    />
                  </label>

                  <button
                    type="button"
                    onClick={() => {
                      const jsonStr = exportToKotatsuBackup(mangaList);
                      const blob = new Blob([jsonStr], { type: 'application/json' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `kotatsu_backup_${new Date().toISOString().split('T')[0]}.json`;
                      a.click();
                      URL.revokeObjectURL(url);
                      showToast('Kotatsu backup exported!');
                    }}
                    className="px-4 py-2.5 rounded-xl bg-elevated hover:bg-elevated text-primary font-bold border border-edge flex items-center gap-2 transition-all"
                  >
                    <Download className="w-4 h-4" />
                    <span>Export Kotatsu Backup (.json)</span>
                  </button>
                </div>
              </div>

              {/* Tachiyomi / Mihon Backup Migration Card */}
              <div className="p-5 bg-app rounded-2xl border border-edge space-y-4">
                <div className="flex items-center justify-between">
                  <div className="font-bold text-primary text-sm flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-info" />
                    Tachiyomi & Mihon Ecosystem Backup Migration
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-info/20 text-info border border-info/30">
                    v2 Backup Standard
                  </span>
                </div>

                <p className="text-secondary text-xs">
                  Migrate all your tracked manga, reading progress, and categories directly between Tachiyomi / Mihon and Graywood Reader.
                </p>

                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <label className="px-4 py-2.5 rounded-xl bg-info/20 hover:bg-info/30 text-info border border-info/40 font-bold flex items-center gap-2 shadow-md cursor-pointer transition-all">
                    <Download className="w-4 h-4 rotate-180" />
                    <span>Import Tachiyomi Backup (.json)</span>
                    <input
                      type="file"
                      accept=".json"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        executeRestorationPipeline('Tachiyomi', file, async () => {
                          const text = await file.text();
                          return parseTachiyomiBackup(text, activeProfile?.id || 'usr_admin');
                        });
                        e.target.value = '';
                      }}
                    />
                  </label>

                  <button
                    type="button"
                    onClick={() => {
                      const jsonStr = exportToTachiyomiBackup(mangaList);
                      const blob = new Blob([jsonStr], { type: 'application/json' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `tachiyomi_backup_${new Date().toISOString().split('T')[0]}.json`;
                      a.click();
                      URL.revokeObjectURL(url);
                      showToast('Tachiyomi backup exported!');
                    }}
                    className="px-4 py-2.5 rounded-xl bg-elevated hover:bg-elevated text-primary font-bold border border-edge flex items-center gap-2 transition-all"
                  >
                    <Download className="w-4 h-4" />
                    <span>Export Tachiyomi Backup (.json)</span>
                  </button>
                </div>
              </div>

              {/* Personal Library JSON Snapshot Card */}
              <div className="p-5 bg-app rounded-2xl border border-edge space-y-4">
                <div className="flex items-center justify-between">
                  <div className="font-bold text-primary text-sm flex items-center gap-2">
                    <Folder className="w-4 h-4 text-accent" />
                    Personal Library JSON Snapshot
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-accent/20 text-accent border border-accent/30">
                    Native JSON
                  </span>
                </div>

                <p className="text-secondary text-xs">
                  Export an immediate JSON file containing all manga series in your active library, or import previous library JSON saves.
                </p>

                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <label className="px-4 py-2.5 rounded-xl bg-accent/20 hover:bg-accent/30 text-accent border border-accent/40 font-bold flex items-center gap-2 shadow-md cursor-pointer transition-all">
                    <Download className="w-4 h-4 rotate-180" />
                    <span>Import Library JSON (.json)</span>
                    <input
                      type="file"
                      accept=".json"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        executeRestorationPipeline('Graywood Snapshot', file, async () => {
                          const text = await file.text();
                          const parsed = JSON.parse(text);
                          const items: MangaItem[] = Array.isArray(parsed)
                            ? parsed
                            : parsed.mangaDatabase || parsed.mangas || parsed.items || [];
                          return items;
                        });
                        e.target.value = '';
                      }}
                    />
                  </label>

                  <button
                    type="button"
                    onClick={() => {
                      const payload = {
                        exportedAt: new Date().toISOString(),
                        user: activeProfile?.name || 'User',
                        count: mangaList.length,
                        items: mangaList,
                      };
                      const jsonStr = JSON.stringify(payload, null, 2);
                      const blob = new Blob([jsonStr], { type: 'application/json' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `graywood_library_${activeProfile?.username || 'user'}_${new Date().toISOString().split('T')[0]}.json`;
                      a.click();
                      URL.revokeObjectURL(url);
                      showToast('Library JSON backup downloaded!');
                    }}
                    className="px-4 py-2.5 rounded-xl bg-elevated hover:bg-elevated text-primary font-bold border border-edge flex items-center gap-2 transition-all"
                  >
                    <Download className="w-4 h-4" />
                    <span>Export My Library (.json)</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 7. SYSTEM STORAGE & DATABASE (Host / Admin Only) */}
          {activeSection === 'backup' && (
            isAdmin ? (
              <div className="space-y-6 text-xs sm:text-sm">
                <div className="p-5 bg-app rounded-2xl border border-edge space-y-4">
                  <div className="font-bold text-primary text-sm flex items-center gap-2">
                    <HardDrive className="w-4 h-4 text-accent" />
                    System Database Snapshots & Cache Buffer
                  </div>
                  <p className="text-secondary text-xs">
                    Host administrative controls for global server configuration, SQLite database backups, and disk cache cleanup.
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={handleExportBackup}
                      className="px-4 py-2.5 rounded-xl bg-success hover:bg-success text-accent-fg font-bold flex items-center gap-2 shadow-lg transition-all"
                    >
                      <Download className="w-4 h-4" />
                      <span>Export Full System Backup</span>
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

                {/* Automated Scheduled Backups Card */}
                <div className="p-5 bg-app rounded-2xl border border-edge space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-bold text-primary text-sm">
                      <Clock className="w-4 h-4 text-accent" />
                      <span>Automated Local Backups (/data/backups/)</span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.autoBackupEnabled || false}
                        onChange={(e) => setFormData({ ...formData, autoBackupEnabled: e.target.checked })}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-elevated peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-accent" />
                    </label>
                  </div>

                  <p className="text-secondary text-xs">
                    Automatically writes rolling JSON database snapshots to local storage on a schedule. Older snapshots beyond your retention limit are safely rotated.
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-secondary">Backup Schedule</label>
                      <select
                        value={formData.autoBackupSchedule || 'daily'}
                        onChange={(e: any) => setFormData({ ...formData, autoBackupSchedule: e.target.value })}
                        disabled={!formData.autoBackupEnabled}
                        className="w-full bg-surface border border-edge rounded-xl px-3 py-2 text-xs font-bold text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 disabled:opacity-50"
                      >
                        <option value="hourly">Every Hour</option>
                        <option value="daily">Daily (Every 24 Hours)</option>
                        <option value="weekly">Weekly (Every 7 Days)</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-secondary">Retention Limit (Snapshots)</label>
                      <input
                        type="number"
                        min="1"
                        max="50"
                        value={formData.autoBackupMaxCount ?? 10}
                        onChange={(e) => setFormData({ ...formData, autoBackupMaxCount: parseInt(e.target.value, 10) || 10 })}
                        disabled={!formData.autoBackupEnabled}
                        className="w-full bg-surface border border-edge rounded-xl px-3 py-2 text-xs font-bold text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 disabled:opacity-50"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-edge">
                    <button
                      type="button"
                      onClick={handleTriggerBackup}
                      disabled={isTriggeringBackup}
                      className="px-3.5 py-2 rounded-xl bg-accent/20 hover:bg-accent/30 text-accent font-bold text-xs border border-accent/30 flex items-center gap-1.5 transition-all shadow-sm"
                    >
                      <Zap className={`w-3.5 h-3.5 ${isTriggeringBackup ? 'animate-spin' : ''}`} />
                      <span>{isTriggeringBackup ? 'Creating Snapshot...' : 'Create Snapshot Now'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={fetchLocalBackups}
                      disabled={isLoadingBackups}
                      className="p-2 rounded-xl bg-elevated hover:bg-elevated/80 text-secondary hover:text-primary transition-colors text-xs font-bold flex items-center gap-1"
                      title="Refresh backup list"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isLoadingBackups ? 'animate-spin' : ''}`} />
                    </button>
                  </div>

                  {/* Local Backups List */}
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {localBackups.length === 0 ? (
                      <div className="p-4 text-center text-xs text-secondary bg-surface/40 rounded-xl border border-edge">
                        No automated backup snapshots found on disk.
                      </div>
                    ) : (
                      localBackups.map((b) => (
                        <div
                          key={b.filename}
                          className="p-2.5 bg-surface hover:bg-surface/80 rounded-xl border border-edge flex items-center justify-between gap-2 transition-colors"
                        >
                          <div className="min-w-0">
                            <div className="font-mono text-xs font-bold text-primary truncate">
                              {b.filename}
                            </div>
                            <div className="text-[11px] text-secondary flex items-center gap-2">
                              <span>{new Date(b.createdAt).toLocaleString()}</span>
                              <span>•</span>
                              <span>{b.seriesCount} series</span>
                              <span>•</span>
                              <span>{(b.sizeBytes / 1024).toFixed(1)} KB</span>
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleRestoreLocalBackup(b.filename)}
                              className="px-2 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 text-[11px] font-bold transition-all"
                              title="Restore library state from this snapshot"
                            >
                              Restore
                            </button>
                            <a
                              href={`/api/backups/${encodeURIComponent(b.filename)}/download`}
                              download={b.filename}
                              className="p-1 rounded-lg bg-elevated hover:bg-elevated/80 text-secondary hover:text-primary transition-colors"
                              title="Download backup file"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </a>
                            <button
                              type="button"
                              onClick={() => handleDeleteLocalBackup(b.filename)}
                              className="p-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 transition-colors"
                              title="Delete backup"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
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
                      className="px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-xl bg-accent-2/10 hover:bg-accent-2/20 text-accent-2 border border-accent-2/30 text-xs sm:text-sm font-bold flex items-center gap-1.5 transition-all"
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
                      className="px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-xl bg-danger/10 hover:bg-danger/20 text-danger border border-danger/30 text-xs sm:text-sm font-bold flex items-center gap-1.5 transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Right to Erasure / GDPR Wipe (Art. 17)</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              renderAdminLockNotice('System Storage & Database Controls')
            )
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-app border-t border-edge flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 sm:px-5 py-2 sm:py-2.5 rounded-xl bg-elevated hover:bg-elevated text-secondary font-bold text-xs sm:text-sm"
          >
            Close
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-6 sm:px-7 py-2.5 sm:py-3 rounded-xl bg-gradient-to-r from-accent to-accent-2 hover:from-accent-bright hover:to-accent-2 text-accent-fg font-black text-xs sm:text-sm flex items-center gap-2 shadow-lg shadow-accent/20 transition-all hover:scale-105"
          >
            {saving ? <RefreshCw className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" /> : <Check className="w-4 h-4 sm:w-5 sm:h-5 stroke-[3]" />}
            <span>Save Settings</span>
          </button>
        </div>
        {/* Floating Toast Notification */}
        {toastMessage && (
          <div className="absolute bottom-20 sm:bottom-6 right-4 sm:right-6 z-50 max-w-sm sm:max-w-md bg-elevated/95 backdrop-blur-md border border-success/50 text-primary px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-3 animate-bounce">
            <div className="w-8 h-8 rounded-xl bg-success/20 border border-success/40 flex items-center justify-center shrink-0 text-success">
              <Check className="w-4 h-4" />
            </div>
            <div className="flex-1 text-xs font-bold text-primary pr-1">
              {toastMessage}
            </div>
            <button
              type="button"
              onClick={() => setToastMessage(null)}
              className="p-1 text-secondary hover:text-primary transition-colors rounded-lg hover:bg-surface"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
});
