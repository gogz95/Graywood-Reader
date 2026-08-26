import React, { useState } from 'react';
import {
  AppSettings,
  DuplicateCandidate,
  DatabaseSyncConfig,
  MangaItem,
  AutoUpdateLog,
  UserProfile,
} from '../types';
import {
  X,
  Sliders,
  Globe,
  Palette,
  BookOpen,
  Zap,
  GitMerge,
  HardDrive,
  Lock,
  Upload,
  Check,
  RefreshCw,
  Bell,
  KeyRound,
  Scale,
} from 'lucide-react';
import { BulkScrapeModal } from './BulkScrapeModal';
import { ReaderAppearanceTab } from './settings/ReaderAppearanceTab';
import { SourcesTrackersTab } from './settings/SourcesTrackersTab';
import { AutoUpdateWebhooksTab } from './settings/AutoUpdateWebhooksTab';
import { SecurityCaptchaTab } from './settings/SecurityCaptchaTab';
import { DataBackupMigrationTab } from './settings/DataBackupMigrationTab';
import { DuplicatesSubdomainTab } from './settings/DuplicatesSubdomainTab';
import { AboutLegalTab } from './settings/AboutLegalTab';

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
  onOpenSetupWizard?: () => void;
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
  onUpdateSubdomain,
  activeProfile,
  logs = [],
  mangaList = [],
  onRunAutoUpdate = () => {},
  isUpdating = false,
  onOpenSetupWizard,
}) => {
  const [activeSection, setActiveSection] = useState<
    'reader' | 'appearance' | 'autoupdate' | 'sources' | 'webhooks' | 'security' | 'duplicates' | 'subdomain' | 'restore' | 'backup' | 'about'
  >('reader');
  const [bulkScrapeModalOpen, setBulkScrapeModalOpen] = useState(false);
  const isAdmin = activeProfile?.role === 'admin';

  const [formData, setFormData] = useState<AppSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSaveSettings(formData);
      showToast('Settings saved successfully!');
    } catch (err) {
      console.error('Failed to save settings:', err);
    } finally {
      setSaving(false);
    }
  };

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
                WebApp Settings &amp; Preferences
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
            className="p-2 rounded-xl bg-elevated/80 text-secondary hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Section Navigation Pills */}
        <div className="flex flex-wrap items-center gap-1.5 p-2.5 bg-app border-b border-edge/80 text-xs sm:text-sm font-bold overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveSection('reader')}
            className={`flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl transition-all whitespace-nowrap cursor-pointer ${
              activeSection === 'reader'
                ? 'bg-accent text-accent-fg shadow-md font-black'
                : 'text-secondary hover:text-primary hover:bg-elevated/60'
            }`}
          >
            <BookOpen className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
            <span>Reader &amp; Layout</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSection('appearance')}
            className={`flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl transition-all whitespace-nowrap cursor-pointer ${
              activeSection === 'appearance'
                ? 'bg-accent text-accent-fg shadow-md font-black'
                : 'text-secondary hover:text-primary hover:bg-elevated/60'
            }`}
          >
            <Palette className="w-4 h-4 sm:w-4.5 sm:h-4.5 text-accent-2" />
            <span>UI &amp; Theme</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSection('autoupdate')}
            className={`flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl transition-all whitespace-nowrap cursor-pointer ${
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
            className={`flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl transition-all whitespace-nowrap cursor-pointer ${
              activeSection === 'sources'
                ? 'bg-accent text-accent-fg shadow-md font-black'
                : 'text-secondary hover:text-primary hover:bg-elevated/60'
            }`}
          >
            <Globe className="w-4 h-4 sm:w-4.5 sm:h-4.5 text-info" />
            <span>Discovery &amp; Trackers</span>
            {!isAdmin && (
              <span title="Admin access required" className="inline-flex">
                <Lock className="w-3 h-3 text-muted" />
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveSection('webhooks')}
            className={`flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl transition-all whitespace-nowrap cursor-pointer ${
              activeSection === 'webhooks'
                ? 'bg-accent text-accent-fg shadow-md font-black'
                : 'text-secondary hover:text-primary hover:bg-elevated/60'
            }`}
          >
            <Bell className="w-4 h-4 sm:w-4.5 sm:h-4.5 text-indigo-400" />
            <span>Push Notifications</span>
            {!isAdmin && (
              <span title="Admin access required" className="inline-flex">
                <Lock className="w-3 h-3 text-muted" />
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveSection('security')}
            className={`flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl transition-all whitespace-nowrap cursor-pointer ${
              activeSection === 'security'
                ? 'bg-accent text-accent-fg shadow-md font-black'
                : 'text-secondary hover:text-primary hover:bg-elevated/60'
            }`}
          >
            <KeyRound className="w-4 h-4 sm:w-4.5 sm:h-4.5 text-amber-400" />
            <span>App Lock &amp; Security</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSection('duplicates')}
            className={`flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl transition-all whitespace-nowrap cursor-pointer ${
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
            className={`flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl transition-all whitespace-nowrap cursor-pointer ${
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
            className={`flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl transition-all whitespace-nowrap cursor-pointer ${
              activeSection === 'restore'
                ? 'bg-accent text-accent-fg shadow-md font-black'
                : 'text-secondary hover:text-primary hover:bg-elevated/60'
            }`}
          >
            <Upload className="w-4 h-4 sm:w-4.5 sm:h-4.5 text-accent-2" />
            <span>Backup &amp; Restore</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSection('backup')}
            className={`flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl transition-all whitespace-nowrap cursor-pointer ${
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

          <button
            type="button"
            onClick={() => setActiveSection('about')}
            className={`flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl transition-all whitespace-nowrap cursor-pointer ${
              activeSection === 'about'
                ? 'bg-accent text-accent-fg shadow-md font-black'
                : 'text-secondary hover:text-primary hover:bg-elevated/60'
            }`}
          >
            <Scale className="w-4 h-4 sm:w-4.5 sm:h-4.5 text-accent-2" />
            <span>About &amp; Legal</span>
          </button>
        </div>

        {/* Tab Contents */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-primary">
          {(activeSection === 'reader' || activeSection === 'appearance') && (
            <ReaderAppearanceTab
              formData={formData}
              setFormData={setFormData}
              activeSubTab={activeSection}
            />
          )}

          {activeSection === 'sources' && (
            <SourcesTrackersTab
              formData={formData}
              setFormData={setFormData}
              isAdmin={isAdmin}
              activeProfile={activeProfile}
              renderAdminLockNotice={renderAdminLockNotice}
              onOpenBulkScrapeModal={() => setBulkScrapeModalOpen(true)}
              onRefreshData={onRefreshData}
            />
          )}

          {(activeSection === 'autoupdate' || activeSection === 'webhooks') && (
            <AutoUpdateWebhooksTab
              formData={formData}
              setFormData={setFormData}
              isAdmin={isAdmin}
              renderAdminLockNotice={renderAdminLockNotice}
              activeSubTab={activeSection}
              logs={logs}
              dbConfig={dbConfig}
              mangaList={mangaList}
              onRunAutoUpdate={onRunAutoUpdate}
              isUpdating={isUpdating}
            />
          )}

          {activeSection === 'security' && (
            <SecurityCaptchaTab
              formData={formData}
              setFormData={setFormData}
              isAdmin={isAdmin}
              activeProfile={activeProfile}
            />
          )}

          {(activeSection === 'duplicates' || activeSection === 'subdomain') && (
            <DuplicatesSubdomainTab
              isAdmin={isAdmin}
              activeSubTab={activeSection}
              renderAdminLockNotice={renderAdminLockNotice}
              duplicateCandidates={duplicateCandidates}
              onScanDuplicates={onScanDuplicates}
              isScanningDuplicates={isScanningDuplicates}
              onExecuteMerge={onExecuteMerge}
              dbConfig={dbConfig}
              onUpdateSubdomain={onUpdateSubdomain}
            />
          )}

          {(activeSection === 'restore' || activeSection === 'backup') && (
            <DataBackupMigrationTab
              formData={formData}
              setFormData={setFormData}
              isAdmin={isAdmin}
              activeProfile={activeProfile}
              mangaList={mangaList}
              showToast={showToast}
              onRefreshData={onRefreshData}
              renderAdminLockNotice={renderAdminLockNotice}
              activeSubTab={activeSection}
              onOpenSetupWizard={onOpenSetupWizard}
            />
          )}

          {activeSection === 'about' && <AboutLegalTab />}
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-app border-t border-edge flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 sm:px-5 py-2 sm:py-2.5 rounded-xl bg-elevated hover:bg-elevated text-secondary font-bold text-xs sm:text-sm cursor-pointer"
          >
            Close
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-6 sm:px-7 py-2.5 sm:py-3 rounded-xl bg-gradient-to-r from-accent to-accent-2 hover:from-accent-bright hover:to-accent-2 text-accent-fg font-black text-xs sm:text-sm flex items-center gap-2 shadow-lg shadow-accent/20 transition-all hover:scale-105 cursor-pointer disabled:opacity-50"
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
              className="p-1 text-secondary hover:text-primary transition-colors rounded-lg hover:bg-surface cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Bulk Scrape Harvester Modal */}
        {bulkScrapeModalOpen && (
          <BulkScrapeModal
            isOpen={bulkScrapeModalOpen}
            onClose={() => {
              setBulkScrapeModalOpen(false);
              onRefreshData();
            }}
          />
        )}
      </div>
    </div>
  );
});
