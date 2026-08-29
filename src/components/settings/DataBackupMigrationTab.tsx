import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../utils/api';
import { MangaItem, UserProfile, AppSettings } from '../../types';
import { parseTachiyomiBackup, exportToTachiyomiBackup } from '../../utils/tachiyomiImporter';
import { parseKotatsuBackup, exportToKotatsuBackup } from '../../utils/kotatsuImporter';
import {
  Upload,
  Download,
  Trash2,
  HardDrive,
  Clock,
  Zap,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Folder,
  BookOpen,
  Sparkles,
  Shield,
  X,
  Database,
} from 'lucide-react';

interface DataBackupMigrationTabProps {
  formData: AppSettings;
  setFormData: React.Dispatch<React.SetStateAction<AppSettings>>;
  isAdmin: boolean;
  activeProfile?: UserProfile;
  mangaList?: MangaItem[];
  showToast: (msg: string) => void;
  onRefreshData: () => void;
  renderAdminLockNotice: (feature: string) => React.ReactNode;
  activeSubTab: 'restore' | 'backup';
  onOpenSetupWizard?: () => void;
}

export const DataBackupMigrationTab: React.FC<DataBackupMigrationTabProps> = ({
  formData,
  setFormData,
  isAdmin,
  activeProfile,
  mangaList = [],
  showToast,
  onRefreshData,
  renderAdminLockNotice,
  activeSubTab,
  onOpenSetupWizard,
}) => {
  // Local Scheduled Backups State
  const [localBackups, setLocalBackups] = useState<Array<{ filename: string; sizeBytes: number; createdAt: string; seriesCount: number }>>([]);
  const [isLoadingBackups, setIsLoadingBackups] = useState(false);
  const [isTriggeringBackup, setIsTriggeringBackup] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [isOptimizingDb, setIsOptimizingDb] = useState(false);
  const [dbOptimizeResult, setDbOptimizeResult] = useState<any | null>(null);

  const handleRunDbVacuum = async () => {
    if (isOptimizingDb) return;
    setIsOptimizingDb(true);
    try {
      const res = await apiFetch('/api/settings/db/vacuum', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vacuum: true, purgeExpiredCache: true, trimLogsDays: 30 }),
      });
      if (res.ok) {
        const json = await res.json();
        setDbOptimizeResult(json.result || json);
        showToast('Database optimization & WAL checkpoint completed successfully!');
        onRefreshData();
      } else {
        showToast('Failed to optimize database.');
      }
    } catch (err: any) {
      showToast(`Database optimization error: ${err.message}`);
    } finally {
      setIsOptimizingDb(false);
    }
  };

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
      } else {
        showToast(`❌ Delete failed: ${data.error}`);
      }
    } catch (err: any) {
      showToast(`❌ Delete failed: ${err.message}`);
    }
  };

  const handleExportMigration = () => {
    window.open('/api/admin/migration/export', '_blank');
    showToast('📦 Server migration package (.zip) download started!');
  };

  const handleRestoreMigrationFile = async (file: File) => {
    if (!window.confirm(`⚠️ RESTORE SERVER FROM MIGRATION PACKAGE:\n\nAre you sure you want to restore "${file.name}"?\nAn emergency safety snapshot will be created automatically before database state is restored.`)) {
      return;
    }

    setIsMigrating(true);
    showToast(`⏳ Restoring server from "${file.name}"...`);

    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      const len = bytes.byteLength;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64Data = window.btoa(binary);

      const res = await apiFetch('/api/admin/migration/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: base64Data }),
      });

      const result = await res.json();
      if (result.success) {
        showToast(`✓ ${result.message}`);
        onRefreshData();
        fetchLocalBackups();
      } else {
        showToast(`❌ Migration failed: ${result.error || result.message}`);
      }
    } catch (err: any) {
      showToast(`❌ Migration error: ${err.message}`);
    } finally {
      setIsMigrating(false);
    }
  };

  const handleUploadBackupFile = async (file: File) => {
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      const len = bytes.byteLength;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64Data = window.btoa(binary);

      const res = await apiFetch('/api/backups/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          data: base64Data,
        }),
      });

      const data = await res.json();
      if (data.success) {
        showToast(`✓ Backup "${file.name}" uploaded to server!`);
        fetchLocalBackups();
      } else {
        showToast(`❌ Upload failed: ${data.error}`);
      }
    } catch (err: any) {
      showToast(`❌ Upload failed: ${err.message}`);
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

  useEffect(() => {
    if (activeSubTab === 'backup') {
      fetchLocalBackups();
    }
  }, [activeSubTab]);

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
        percent: 25,
        statusMessage: `Parsing and validating ${sourceType} backup archive structure...`,
      }));

      const parsedItems = await parseFn((status, percent) => {
        setRestoreProgress((prev) => ({
          ...prev,
          statusMessage: status,
          percent: Math.min(60, Math.max(25, percent)),
        }));
      });

      if (!parsedItems || parsedItems.length === 0) {
        throw new Error(`No readable manga items found in ${sourceType} archive.`);
      }

      setRestoreProgress((prev) => ({
        ...prev,
        stage: 'restoring',
        percent: 65,
        total: parsedItems.length,
        statusMessage: `Writing ${parsedItems.length} series to local database...`,
      }));

      // Chunked bulk import
      const chunkSize = 250;
      for (let i = 0; i < parsedItems.length; i += chunkSize) {
        const chunk = parsedItems.slice(i, i + chunkSize);
        await apiFetch('/api/manga/bulk-import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: chunk }),
        });

        const progressPercent = Math.min(90, Math.round(65 + (i / parsedItems.length) * 25));
        setRestoreProgress((prev) => ({
          ...prev,
          current: Math.min(parsedItems.length, i + chunkSize),
          percent: progressPercent,
          statusMessage: `Imported ${Math.min(parsedItems.length, i + chunkSize)} / ${parsedItems.length} series...`,
        }));
      }

      setRestoreProgress((prev) => ({
        ...prev,
        stage: 'indexing',
        percent: 95,
        statusMessage: 'Rebuilding library categories and indexes...',
      }));

      onRefreshData();
      await fetchLocalBackups();

      setRestoreProgress((prev) => ({
        ...prev,
        stage: 'completed',
        percent: 100,
        current: parsedItems.length,
        statusMessage: `✓ Successfully restored ${parsedItems.length} series!`,
      }));
      showToast(`✓ Successfully restored ${parsedItems.length} series from ${sourceType}!`);
    } catch (err: any) {
      setRestoreProgress((prev) => ({
        ...prev,
        stage: 'error',
        percent: 100,
        statusMessage: `Restoration failed: ${err.message}`,
        errorMessage: err.message || 'Unknown error occurred during archive restoration',
      }));
      showToast(`❌ Restoration failed: ${err.message}`);
    }
  };

  if (activeSubTab === 'backup') {
    if (!isAdmin) {
      return <>{renderAdminLockNotice('System Storage & Database Controls')}</>;
    }

    return (
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
              className="px-4 py-2.5 rounded-xl bg-success hover:bg-success text-accent-fg font-bold flex items-center gap-2 shadow-lg transition-all cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Export Full System Backup</span>
            </button>

            <button
              type="button"
              onClick={handleClearCache}
              className="px-4 py-2.5 rounded-xl bg-danger/10 hover:bg-danger/20 text-danger font-bold border border-danger/30 flex items-center gap-2 transition-all cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
              <span>Clear Image Cache Buffer</span>
            </button>
          </div>
        </div>

        {/* Server Migration & Disaster Recovery Card */}
        <div className="p-5 bg-gradient-to-br from-surface via-app to-surface rounded-2xl border-2 border-accent/30 space-y-4 shadow-xl">
          <div className="flex items-center justify-between">
            <div className="font-extrabold text-primary text-sm flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-accent/20 text-accent">
                <HardDrive className="w-4 h-4" />
              </div>
              <span>Server Migration & Disaster Recovery</span>
            </div>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-accent text-accent-fg uppercase tracking-wider">
              Migration Engine v2
            </span>
          </div>

          <p className="text-secondary text-xs leading-relaxed">
            Migrate this entire Graywood Reader instance to a new server or container with zero data loss. Includes the full SQLite database (<code className="text-accent">manga.db</code>), reading progress/history, user profiles, categories, sticky notes, extensions, and server configurations.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              onClick={handleExportMigration}
              className="px-4 py-2.5 rounded-xl bg-accent text-accent-fg hover:opacity-90 font-black flex items-center gap-2 shadow-lg transition-all active:scale-95 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Export Server Migration Package (.zip)</span>
            </button>

            <label className={`px-4 py-2.5 rounded-xl bg-elevated hover:bg-elevated/80 text-primary font-bold border border-edge flex items-center gap-2 transition-all cursor-pointer shadow-sm ${isMigrating ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''}`}>
              <Download className="w-4 h-4 rotate-180 text-accent" />
              <span>{isMigrating ? 'Restoring Server...' : 'Restore Server from Package (.zip / .json)'}</span>
              <input
                type="file"
                accept=".zip,.json"
                disabled={isMigrating}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleRestoreMigrationFile(file);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
        </div>

        {/* Initial Setup Wizard Re-run Card */}
        {onOpenSetupWizard && (
          <div className="p-5 bg-app rounded-2xl border border-accent/20 space-y-3">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h4 className="font-extrabold text-primary flex items-center gap-2 text-sm">
                    <Sparkles className="w-4 h-4 text-accent" />
                    Initial Setup & Onboarding Wizard
                  </h4>
                  <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-accent/20 text-accent border border-accent/30">
                    Setup Sequence
                  </span>
                </div>
                <p className="text-xs text-secondary">
                  Re-run the initial app creation and setup sequence to reconfigure host credentials, default reading modes, and library seeding.
                </p>
              </div>
              <button
                type="button"
                onClick={onOpenSetupWizard}
                className="px-4 py-2.5 rounded-xl bg-elevated hover:bg-elevated text-accent font-bold text-xs border border-accent/30 flex items-center gap-2 shadow-sm transition-all whitespace-nowrap active:scale-95 cursor-pointer"
              >
                <Sparkles className="w-4 h-4" />
                <span>Rerun Setup Wizard</span>
              </button>
            </div>
          </div>
        )}

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

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-edge">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleTriggerBackup}
                disabled={isTriggeringBackup}
                className="px-3.5 py-2 rounded-xl bg-accent/20 hover:bg-accent/30 text-accent font-bold text-xs border border-accent/30 flex items-center gap-1.5 transition-all shadow-sm cursor-pointer"
              >
                <Zap className={`w-3.5 h-3.5 ${isTriggeringBackup ? 'animate-spin' : ''}`} />
                <span>{isTriggeringBackup ? 'Creating Snapshot...' : 'Create Snapshot Now'}</span>
              </button>

              <label className="px-3.5 py-2 rounded-xl bg-elevated hover:bg-elevated/80 text-secondary hover:text-primary font-bold text-xs border border-edge flex items-center gap-1.5 transition-all cursor-pointer shadow-sm">
                <Download className="w-3.5 h-3.5 rotate-180 text-accent" />
                <span>Upload Backup (.json/.zip)</span>
                <input
                  type="file"
                  accept=".json,.zip"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUploadBackupFile(file);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>

            <button
              type="button"
              onClick={fetchLocalBackups}
              disabled={isLoadingBackups}
              className="p-2 rounded-xl bg-elevated hover:bg-elevated/80 text-secondary hover:text-primary transition-colors text-xs font-bold flex items-center gap-1 cursor-pointer"
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
                      className="px-2 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 text-[11px] font-bold transition-all cursor-pointer"
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
                      className="p-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 transition-colors cursor-pointer"
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
              className="px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-xl bg-danger/10 hover:bg-danger/20 text-danger border border-danger/30 text-xs sm:text-sm font-bold flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Right to Erasure / GDPR Wipe (Art. 17)</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Restore Tab
  return (
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
                  className="p-1.5 rounded-lg bg-elevated hover:bg-elevated text-secondary hover:text-primary transition-colors text-xs font-bold cursor-pointer"
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
            className="px-4 py-2.5 rounded-xl bg-elevated hover:bg-elevated text-primary font-bold border border-edge flex items-center gap-2 transition-all cursor-pointer"
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
            className="px-4 py-2.5 rounded-xl bg-elevated hover:bg-elevated text-primary font-bold border border-edge flex items-center gap-2 transition-all cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>Export Tachiyomi Backup (.json)</span>
          </button>
        </div>
      </div>

      {/* SQLite Database Storage & WAL Optimization Card */}
      <div className="p-5 bg-app rounded-2xl border border-edge space-y-4">
        <div className="flex items-center justify-between">
          <div className="font-bold text-primary text-sm flex items-center gap-2">
            <Database className="w-4 h-4 text-accent" />
            SQLite Database & WAL Storage Optimization
          </div>
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-accent/20 text-accent border border-accent/30">
            better-sqlite3 WAL
          </span>
        </div>

        <p className="text-secondary text-xs">
          Perform a live ACID maintenance cycle: checkpoints the Write-Ahead Log (WAL), trims expired logs older than 30 days, purges stale chapter cache blobs, and executes SQLite <code className="px-1.5 py-0.5 rounded bg-surface border border-edge font-mono text-accent font-bold">PRAGMA optimize</code>.
        </p>

        {dbOptimizeResult && (
          <div className="p-3 bg-surface rounded-xl border border-edge text-xs space-y-1">
            <div className="font-bold text-primary flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>{dbOptimizeResult.message || 'Database Maintenance Complete'}</span>
            </div>
            {dbOptimizeResult.dbSizeBytes !== undefined && (
              <div className="text-muted text-[11px] grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 font-mono">
                <div>DB Size: <span className="text-primary font-bold">{(dbOptimizeResult.dbSizeBytes / (1024 * 1024)).toFixed(2)} MB</span></div>
                <div>WAL Size: <span className="text-primary font-bold">{(dbOptimizeResult.walSizeBytes / 1024).toFixed(1)} KB</span></div>
                <div>Cache Purged: <span className="text-primary font-bold">{dbOptimizeResult.purgedExpiredCache || 0}</span></div>
                <div>Logs Trimmed: <span className="text-primary font-bold">{dbOptimizeResult.trimmedLogsCount || 0}</span></div>
              </div>
            )}
          </div>
        )}

        <div className="pt-1">
          <button
            type="button"
            onClick={handleRunDbVacuum}
            disabled={isOptimizingDb}
            className="px-4 py-2.5 rounded-xl bg-accent hover:bg-accent-bright text-accent-fg font-black text-xs flex items-center gap-2 shadow-md shadow-accent/20 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
          >
            {isOptimizingDb ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Running Database VACUUM & Optimize...</span>
              </>
            ) : (
              <>
                <Zap className="w-4 h-4" />
                <span>Run Database VACUUM & Optimize</span>
              </>
            )}
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
            className="px-4 py-2.5 rounded-xl bg-elevated hover:bg-elevated text-primary font-bold border border-edge flex items-center gap-2 transition-all cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>Export My Library (.json)</span>
          </button>
        </div>
      </div>
    </div>
  );
};
