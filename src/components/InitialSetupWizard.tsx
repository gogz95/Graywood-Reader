import React, { useState } from 'react';
import {
  Sparkles,
  Shield,
  BookOpen,
  Database,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  Zap,
  Globe,
  Settings,
  Server,
  Upload,
  Layers,
  Lock,
  Eye,
  EyeOff,
  RefreshCw,
  Check,
  Compass,
} from 'lucide-react';
import { apiFetch } from '../utils/api';
import { AppSettings, UserProfile, ReaderViewMode } from '../types';

interface InitialSetupWizardProps {
  isOpen: boolean;
  onComplete: () => void;
  onClose?: () => void;
  isHostComputer?: boolean;
  activeProfile?: UserProfile;
  appSettings?: AppSettings;
  onSaveSettings?: (newSettings: Partial<AppSettings>) => void;
  onOpenBulkScrapeModal?: () => void;
}

const STEPS = [
  { id: 'welcome', title: 'Welcome', subtitle: 'System & Architecture' },
  { id: 'admin', title: 'Admin & Access', subtitle: 'Host Security' },
  { id: 'sources', title: 'Sources & Content', subtitle: 'Catalogs & Maturity' },
  { id: 'reader', title: 'Reader & Sync', subtitle: 'Defaults & Crawlers' },
  { id: 'library', title: 'Library Seeding', subtitle: 'Import or Harvester' },
  { id: 'complete', title: 'Ready', subtitle: 'Final Summary' },
] as const;

export const InitialSetupWizard: React.FC<InitialSetupWizardProps> = ({
  isOpen,
  onComplete,
  onClose,
  isHostComputer = true,
  activeProfile,
  appSettings,
  onSaveSettings,
  onOpenBulkScrapeModal,
}) => {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  // Step 2: Admin config
  const [adminName, setAdminName] = useState(activeProfile?.name || 'Host Administrator');
  const [adminUsername, setAdminUsername] = useState(activeProfile?.username || 'admin');
  const [adminPassword, setAdminPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [allowGuestAccess, setAllowGuestAccess] = useState(true);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Step 3: Source Catalog & Content
  const [selectedLanguage, setSelectedLanguage] = useState<'en' | 'all' | 'raw'>('en');
  const [nsfwPolicy, setNsfwPolicy] = useState<'safe' | 'unrestricted' | 'isolated'>('safe');
  const [enableMangaDex, setEnableMangaDex] = useState(true);
  const [enableAggregateScrapers, setEnableAggregateScrapers] = useState(true);

  // Step 4: Reader defaults
  const [defaultReaderMode, setDefaultReaderMode] = useState<ReaderViewMode>(
    appSettings?.readerDefaults?.viewMode || 'webtoon-seamless'
  );
  const [flareSolverrUrl, setFlareSolverrUrl] = useState(appSettings?.flareSolverrUrl || 'http://localhost:8191/v1');
  const [autoUpdateInterval, setAutoUpdateInterval] = useState<number>(60);

  // Step 5: Library seed choice
  const [seedOption, setSeedOption] = useState<'clean' | 'harvester' | 'import'>('clean');

  // Saving state
  const [isSaving, setIsSaving] = useState(false);

  if (!isOpen) return null;

  const currentStep = STEPS[currentStepIndex];

  const handleNext = async () => {
    if (currentStep.id === 'admin') {
      if (adminPassword && adminPassword !== confirmPassword) {
        setPasswordError('Passwords do not match.');
        return;
      }
      if (adminPassword && adminPassword.length < 6) {
        setPasswordError('Password must be at least 6 characters.');
        return;
      }
      setPasswordError(null);
    }

    if (currentStepIndex < STEPS.length - 1) {
      setCurrentStepIndex((prev) => prev + 1);
    } else {
      await handleFinish();
    }
  };

  const handleBack = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex((prev) => prev - 1);
    }
  };

  const handleFinish = async () => {
    setIsSaving(true);
    try {
      // 1. Post complete initial setup configuration to server SQLite database
      const setupPayload = {
        adminName,
        adminUsername,
        adminPassword: adminPassword || undefined,
        allowGuestAccess,
        selectedLanguage,
        nsfwPolicy,
        defaultReaderMode,
        flareSolverrUrl,
        autoUpdateInterval,
        enableCloudflareBypass: !!flareSolverrUrl,
      };

      try {
        const res = await apiFetch('/api/settings/initial-setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(setupPayload),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.settings && onSaveSettings) {
            onSaveSettings(data.settings);
          }
        }
      } catch (e) {
        console.warn('[Setup Wizard] Failed to post initial-setup to server, falling back to onSaveSettings:', e);
        if (onSaveSettings) {
          onSaveSettings({
            readerDefaults: {
              ...(appSettings?.readerDefaults || {}),
              viewMode: defaultReaderMode,
            } as any,
            flareSolverrUrl,
            enableCloudflareBypass: !!flareSolverrUrl,
            privateModeEnabled: nsfwPolicy === 'safe',
            initialSetupCompleted: true,
            initialSetupTimestamp: new Date().toISOString(),
          });
        }
      }

      // 2. Mark setup completed in localStorage as fast client-side cache
      localStorage.setItem('graywood_setup_completed', 'true');
      localStorage.setItem('graywood_setup_timestamp', new Date().toISOString());

      // 3. If user selected Harvester, trigger it
      if (seedOption === 'harvester' && onOpenBulkScrapeModal) {
        setTimeout(() => {
          onOpenBulkScrapeModal();
        }, 300);
      }

      onComplete();
    } catch (err) {
      console.error('Failed to complete setup sequence:', err);
      onComplete();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-xl animate-fade-in overflow-y-auto">
      <div className="relative w-full max-w-4xl bg-surface/95 border border-edge-strong/80 rounded-3xl shadow-2xl overflow-hidden flex flex-col my-auto max-h-[92vh]">
        {/* Top Header / Progress Indicator */}
        <div className="p-6 sm:p-8 bg-gradient-to-r from-accent/15 via-app/40 to-accent-2/15 border-b border-edge flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-accent to-accent-2 flex items-center justify-center text-white shadow-lg shadow-accent/20">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-lg sm:text-xl font-black text-primary tracking-tight">
                  Graywood Reader Setup Wizard
                </h1>
                <p className="text-xs text-secondary">
                  Step {currentStepIndex + 1} of {STEPS.length}: <span className="text-accent font-bold">{currentStep.title}</span> — {currentStep.subtitle}
                </p>
              </div>
            </div>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="text-xs text-muted hover:text-primary px-3 py-1.5 rounded-xl bg-app border border-edge transition-colors"
              >
                Skip Setup
              </button>
            )}
          </div>

          {/* Stepper Dots / Bars */}
          <div className="grid grid-cols-6 gap-2 pt-2">
            {STEPS.map((step, idx) => (
              <div key={step.id} className="space-y-1">
                <div
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    idx < currentStepIndex
                      ? 'bg-accent'
                      : idx === currentStepIndex
                      ? 'bg-gradient-to-r from-accent to-accent-2 shadow-sm'
                      : 'bg-edge'
                  }`}
                />
                <span
                  className={`hidden sm:block text-[10px] truncate font-bold ${
                    idx === currentStepIndex ? 'text-accent' : idx < currentStepIndex ? 'text-primary' : 'text-muted'
                  }`}
                >
                  {step.title}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Wizard Body Content */}
        <div className="p-6 sm:p-8 overflow-y-auto flex-1 space-y-6">
          {/* STEP 1: WELCOME */}
          {currentStep.id === 'welcome' && (
            <div className="space-y-6">
              <div className="p-6 rounded-2xl bg-app border border-accent/20 space-y-4">
                <div className="flex items-center gap-3 text-accent font-black text-base">
                  <BookOpen className="w-6 h-6 text-accent-2" />
                  <span>Welcome to Graywood Reader</span>
                </div>
                <p className="text-xs sm:text-sm text-secondary leading-relaxed">
                  Graywood Reader is a high-performance, private, self-hosted Manga, Manhwa, and Manhua reader powered by the Kotatsu Engine v4.8. It gives you unrestricted multi-source crawling, seamless continuous reading, automated release tracking, and rich metadata integration.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                  <div className="p-3.5 rounded-xl bg-surface border border-edge space-y-1">
                    <div className="flex items-center gap-2 text-xs font-black text-primary">
                      <Server className="w-4 h-4 text-accent" />
                      <span>Host Environment</span>
                    </div>
                    <p className="text-[11px] text-muted">{isHostComputer ? 'Host Machine Verified' : 'Remote Client Connection'}</p>
                  </div>
                  <div className="p-3.5 rounded-xl bg-surface border border-edge space-y-1">
                    <div className="flex items-center gap-2 text-xs font-black text-primary">
                      <Database className="w-4 h-4 text-success" />
                      <span>Database Engine</span>
                    </div>
                    <p className="text-[11px] text-muted">SQLite High-Speed Storage</p>
                  </div>
                  <div className="p-3.5 rounded-xl bg-surface border border-edge space-y-1">
                    <div className="flex items-center gap-2 text-xs font-black text-primary">
                      <Zap className="w-4 h-4 text-accent-2" />
                      <span>Engine Core</span>
                    </div>
                    <p className="text-[11px] text-muted">Kotatsu v4.8 + Anti-DDoS</p>
                  </div>
                </div>
              </div>

              <div className="p-5 rounded-2xl bg-app border border-edge space-y-2">
                <h3 className="text-xs font-black uppercase tracking-wider text-secondary">What we will configure</h3>
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-primary pt-1">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-accent flex-shrink-0" />
                    <span>Host administrator account & profile</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-accent flex-shrink-0" />
                    <span>Active source catalogs and maturity filters</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-accent flex-shrink-0" />
                    <span>Reader viewports and auto-scroll speeds</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-accent flex-shrink-0" />
                    <span>Initial library seeding and crawler tools</span>
                  </li>
                </ul>
              </div>
            </div>
          )}

          {/* STEP 2: ADMIN & SECURITY */}
          {currentStep.id === 'admin' && (
            <div className="space-y-6">
              <div className="p-5 rounded-2xl bg-app border border-edge space-y-4">
                <div className="flex items-center gap-2 text-primary font-bold text-sm">
                  <Shield className="w-5 h-5 text-accent-2" />
                  <span>Host Administrator Account</span>
                </div>
                <p className="text-xs text-secondary">
                  Configure the primary administrative credentials. Administrators have full control over source extensions, bulk crawlers, database exports, and user profiles.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-secondary">Administrator Name</label>
                    <input
                      type="text"
                      value={adminName}
                      onChange={(e) => setAdminName(e.target.value)}
                      className="w-full bg-surface border border-edge-strong rounded-xl px-4 py-2.5 text-xs text-primary font-bold focus:outline-none focus:ring-2 focus:ring-accent/50"
                      placeholder="e.g. Host Administrator"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-secondary">Username</label>
                    <input
                      type="text"
                      value={adminUsername}
                      onChange={(e) => setAdminUsername(e.target.value)}
                      className="w-full bg-surface border border-edge-strong rounded-xl px-4 py-2.5 text-xs text-primary font-bold focus:outline-none focus:ring-2 focus:ring-accent/50"
                      placeholder="admin"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-secondary">Admin Password (Optional)</label>
                    <input
                      type="password"
                      value={adminPassword}
                      onChange={(e) => setAdminPassword(e.target.value)}
                      className="w-full bg-surface border border-edge-strong rounded-xl px-4 py-2.5 text-xs text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent/50"
                      placeholder="Leave blank for host auto-login"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-secondary">Confirm Password</label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full bg-surface border border-edge-strong rounded-xl px-4 py-2.5 text-xs text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent/50"
                      placeholder="Re-enter password"
                    />
                  </div>
                </div>

                {passwordError && (
                  <div className="p-3 bg-danger/10 border border-danger/30 rounded-xl text-xs font-bold text-danger">
                    {passwordError}
                  </div>
                )}
              </div>

              {/* Guest / Public Mode Policy */}
              <div className="p-5 rounded-2xl bg-app border border-edge space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs sm:text-sm font-bold text-primary">Allow Guest Browsing</h4>
                    <p className="text-xs text-secondary">Permit anonymous visitors on local network to browse SFW catalog without logging in.</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={allowGuestAccess}
                    onChange={(e) => setAllowGuestAccess(e.target.checked)}
                    className="w-5 h-5 rounded accent-accent cursor-pointer"
                  />
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: SOURCES & CONTENT */}
          {currentStep.id === 'sources' && (
            <div className="space-y-6">
              <div className="p-5 rounded-2xl bg-app border border-edge space-y-4">
                <div className="flex items-center gap-2 text-primary font-bold text-sm">
                  <Globe className="w-5 h-5 text-accent" />
                  <span>Language & Catalog Coverage</span>
                </div>
                <p className="text-xs text-secondary">
                  Choose your preferred catalog focus. Graywood Reader aggregates over 50+ Kotatsu & direct scrape extensions.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { id: 'en', label: 'English First', desc: 'MangaDex, WeebCentral, Asura, FlameComics' },
                    { id: 'raw', label: 'RAW & Asian', desc: 'Korean Manhwa, Chinese Manhua, Japanese RAWs' },
                    { id: 'all', label: 'Global Unified', desc: 'All languages & community extensions' },
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedLanguage(item.id as any)}
                      className={`p-4 rounded-xl border text-left transition-all ${
                        selectedLanguage === item.id
                          ? 'bg-accent/15 border-accent text-primary shadow-md'
                          : 'bg-surface border-edge text-secondary hover:text-primary hover:border-edge-strong'
                      }`}
                    >
                      <div className="font-black text-xs text-primary mb-1">{item.label}</div>
                      <div className="text-[11px] text-muted">{item.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Content Maturity / NSFW Policy */}
              <div className="p-5 rounded-2xl bg-app border border-edge space-y-4">
                <div className="flex items-center gap-2 text-primary font-bold text-sm">
                  <Lock className="w-5 h-5 text-accent-2" />
                  <span>Content Maturity & NSFW Filter</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { id: 'safe', label: 'Family Safe', desc: 'Strictly filter out 18+ and adult content' },
                    { id: 'isolated', label: 'Account Protected', desc: 'Hide 18+ for guests; require user login' },
                    { id: 'unrestricted', label: 'Unrestricted', desc: 'Show all catalog series without restrictions' },
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setNsfwPolicy(item.id as any)}
                      className={`p-4 rounded-xl border text-left transition-all ${
                        nsfwPolicy === item.id
                          ? 'bg-accent-2/15 border-accent-2 text-primary shadow-md'
                          : 'bg-surface border-edge text-secondary hover:text-primary hover:border-edge-strong'
                      }`}
                    >
                      <div className="font-black text-xs text-primary mb-1">{item.label}</div>
                      <div className="text-[11px] text-muted">{item.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: READER & SYNC */}
          {currentStep.id === 'reader' && (
            <div className="space-y-6">
              <div className="p-5 rounded-2xl bg-app border border-edge space-y-4">
                <div className="flex items-center gap-2 text-primary font-bold text-sm">
                  <BookOpen className="w-5 h-5 text-accent" />
                  <span>Default Reader Presentation</span>
                </div>
                <p className="text-xs text-secondary">
                  Choose the default viewport mode for new series. You can still adjust this dynamically inside the reader toolbar.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { id: 'webtoon-seamless', label: 'Vertical Webtoon', desc: 'Seamless continuous vertical strip (Ideal for Manhwa)' },
                    { id: 'rtl', label: 'Manga (RTL)', desc: 'Right-to-Left paging with spread splitting' },
                    { id: 'double-page', label: 'Double Page', desc: 'Side-by-side spread view for widescreen tablets/PCs' },
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setDefaultReaderMode(item.id as any)}
                      className={`p-4 rounded-xl border text-left transition-all ${
                        defaultReaderMode === item.id
                          ? 'bg-accent/15 border-accent text-primary shadow-md'
                          : 'bg-surface border-edge text-secondary hover:text-primary hover:border-edge-strong'
                      }`}
                    >
                      <div className="font-black text-xs text-primary mb-1">{item.label}</div>
                      <div className="text-[11px] text-muted">{item.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Cloudflare & Auto-update */}
              <div className="p-5 rounded-2xl bg-app border border-edge space-y-4">
                <div className="flex items-center gap-2 text-primary font-bold text-sm">
                  <Zap className="w-5 h-5 text-success" />
                  <span>Cloudflare Bypass & Auto-Update Engine</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-secondary">FlareSolverr Service URL</label>
                    <input
                      type="text"
                      value={flareSolverrUrl}
                      onChange={(e) => setFlareSolverrUrl(e.target.value)}
                      className="w-full bg-surface border border-edge-strong rounded-xl px-4 py-2.5 text-xs text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent/50"
                      placeholder="http://localhost:8191/v1"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-secondary">Auto-Update Release Crawler</label>
                    <select
                      value={autoUpdateInterval}
                      onChange={(e) => setAutoUpdateInterval(Number(e.target.value))}
                      className="w-full bg-surface border border-edge-strong rounded-xl px-4 py-2.5 text-xs text-primary font-bold focus:outline-none focus:ring-2 focus:ring-accent/50"
                    >
                      <option value={30}>Every 30 Minutes</option>
                      <option value={60}>Every 1 Hour (Recommended)</option>
                      <option value={120}>Every 2 Hours</option>
                      <option value={360}>Every 6 Hours</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 5: LIBRARY SEEDING */}
          {currentStep.id === 'library' && (
            <div className="space-y-6">
              <div className="p-5 rounded-2xl bg-app border border-edge space-y-4">
                <div className="flex items-center gap-2 text-primary font-bold text-sm">
                  <Database className="w-5 h-5 text-accent-2" />
                  <span>How would you like to seed your library?</span>
                </div>
                <p className="text-xs text-secondary">
                  Populate your local reader with titles now or start fresh and browse manually.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <button
                    type="button"
                    onClick={() => setSeedOption('harvester')}
                    className={`p-4 rounded-2xl border text-left transition-all space-y-2 ${
                      seedOption === 'harvester'
                        ? 'bg-accent/15 border-accent text-primary shadow-md'
                        : 'bg-surface border-edge text-secondary hover:text-primary hover:border-edge-strong'
                    }`}
                  >
                    <div className="p-2 w-fit rounded-xl bg-accent/20 text-accent">
                      <Zap className="w-5 h-5" />
                    </div>
                    <div className="font-black text-xs text-primary">Run Bulk Harvester</div>
                    <p className="text-[11px] text-muted">
                      Automatically crawl top popular series across all active sources into your library.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSeedOption('import')}
                    className={`p-4 rounded-2xl border text-left transition-all space-y-2 ${
                      seedOption === 'import'
                        ? 'bg-accent-2/15 border-accent-2 text-primary shadow-md'
                        : 'bg-surface border-edge text-secondary hover:text-primary hover:border-edge-strong'
                    }`}
                  >
                    <div className="p-2 w-fit rounded-xl bg-accent-2/20 text-accent-2">
                      <Upload className="w-5 h-5" />
                    </div>
                    <div className="font-black text-xs text-primary">Import Backup</div>
                    <p className="text-[11px] text-muted">
                      Restore an existing Tachiyomi, Mihon, or Kotatsu backup file (.proto.gz / .json / .zip).
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSeedOption('clean')}
                    className={`p-4 rounded-2xl border text-left transition-all space-y-2 ${
                      seedOption === 'clean'
                        ? 'bg-emerald-500/15 border-emerald-500 text-primary shadow-md'
                        : 'bg-surface border-edge text-secondary hover:text-primary hover:border-edge-strong'
                    }`}
                  >
                    <div className="p-2 w-fit rounded-xl bg-emerald-500/20 text-emerald-400">
                      <Compass className="w-5 h-5" />
                    </div>
                    <div className="font-black text-xs text-primary">Start Clean</div>
                    <p className="text-[11px] text-muted">
                      Start with a clean library and explore/search series through the live Browse feed.
                    </p>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 6: COMPLETION & READY */}
          {currentStep.id === 'complete' && (
            <div className="space-y-6 text-center py-4">
              <div className="w-16 h-16 rounded-3xl bg-gradient-to-tr from-accent to-accent-2 text-white flex items-center justify-center mx-auto shadow-xl shadow-accent/25 animate-bounce">
                <Check className="w-8 h-8 stroke-[3]" />
              </div>
              <div className="space-y-2 max-w-md mx-auto">
                <h2 className="text-xl sm:text-2xl font-black text-primary">You're All Set!</h2>
                <p className="text-xs sm:text-sm text-secondary">
                  Graywood Reader is configured and ready. You can always fine-tune crawler schedules, sources, and UI themes in the Settings menu under Admin.
                </p>
              </div>

              <div className="max-w-lg mx-auto p-4 rounded-2xl bg-app border border-edge text-left space-y-2 text-xs">
                <div className="font-bold text-primary flex items-center gap-2 pb-1 border-b border-edge">
                  <CheckCircle2 className="w-4 h-4 text-success" />
                  Configuration Checklist
                </div>
                <div className="grid grid-cols-2 gap-2 text-secondary text-[11px]">
                  <div>• Admin: <span className="text-primary font-bold">{adminName}</span></div>
                  <div>• Reader Layout: <span className="text-primary font-bold">{defaultReaderMode}</span></div>
                  <div>• Content Policy: <span className="text-primary font-bold">{nsfwPolicy}</span></div>
                  <div>• Library Startup: <span className="text-primary font-bold">{seedOption}</span></div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Bottom Navigation Toolbar */}
        <div className="p-4 sm:p-6 bg-app border-t border-edge flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleBack}
            disabled={currentStepIndex === 0 || isSaving}
            className="px-4 sm:px-5 py-2.5 rounded-xl bg-surface border border-edge text-secondary hover:text-primary font-bold text-xs sm:text-sm flex items-center gap-2 transition-all disabled:opacity-40"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>

          <button
            type="button"
            onClick={handleNext}
            disabled={isSaving}
            className="px-6 sm:px-8 py-2.5 sm:py-3 rounded-xl bg-gradient-to-r from-accent to-accent-2 text-accent-fg font-black text-xs sm:text-sm flex items-center gap-2 shadow-lg shadow-accent/25 hover:opacity-95 active:scale-98 transition-all"
          >
            <span>{currentStepIndex === STEPS.length - 1 ? (isSaving ? 'Finishing...' : 'Launch Graywood Reader') : 'Continue'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
