import React, { useState, useRef, useEffect } from 'react';
import {
  Home,
  BookOpen,
  RefreshCw,
  Search,
  Plus,
  Globe,
  Calendar,
  User,
  Compass,
  Bug,
  MoreVertical,
  X,
  Sliders,
  Shield,
  EyeOff,
  ShieldAlert,
  Trophy,
  Puzzle,
  Download,
  ListOrdered,
  Layers,
  ChevronDown,
  Wrench,
  UserPlus,
  LogIn,
} from 'lucide-react';

import { AppNavTab, UserProfile } from '../types';

interface NavbarProps {
  activeTab: AppNavTab;
  setActiveTab: (tab: AppNavTab) => void;
  subdomain: string;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  unreadCount: number;
  duplicateCount: number;
  pendingChallengesCount?: number;
  activeDownloadsCount?: number;
  onOpenAddModal: () => void;
  onRunAutoUpdate: () => void;
  isUpdating: boolean;
  onOpenSettingsModal: () => void;
  isIncognito: boolean;
  onToggleIncognito: () => void;
  onOpenAnalytics: () => void;
  onOpenAchievements?: () => void;
  onOpenChallengesModal?: () => void;
  onOpenDownloadManager?: () => void;
  onOpenReadlists?: () => void;
  activeProfile: UserProfile;
  isHostComputer?: boolean;
  onOpenProfileModal: () => void;
  onOpenAuthModal: (mode?: 'login' | 'register') => void;
  onOpenAdminPanel: () => void;
  onOpenSubmitBugModal?: () => void;
  onOpenExtensionManager?: () => void;
  onOpenCommandPalette?: () => void;
  onOpenPwaInstall?: () => void;
  canInstallPwa?: boolean;
}

export const Navbar: React.FC<NavbarProps> = React.memo(({
  activeTab,
  setActiveTab,
  subdomain,
  searchQuery,
  setSearchQuery,
  unreadCount,
  duplicateCount,
  pendingChallengesCount = 0,
  onOpenAddModal,
  onRunAutoUpdate,
  isUpdating,
  onOpenSettingsModal,
  isIncognito,
  onToggleIncognito,
  onOpenAnalytics,
  onOpenAchievements,
  onOpenChallengesModal,
  onOpenDownloadManager,
  onOpenReadlists,
  activeDownloadsCount = 0,
  activeProfile,
  isHostComputer = true,
  onOpenProfileModal,
  onOpenAuthModal,
  onOpenAdminPanel,
  onOpenSubmitBugModal,
  onOpenExtensionManager,
  onOpenCommandPalette,
  onOpenPwaInstall,
  canInstallPwa,
}) => {
  const [mobileQuickMenuOpen, setMobileQuickMenuOpen] = useState(false);
  const [toolsDropdownOpen, setToolsDropdownOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const toolsMenuRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (toolsMenuRef.current && !toolsMenuRef.current.contains(e.target as Node)) {
        setToolsDropdownOpen(false);
      }
    };
    if (toolsDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [toolsDropdownOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Trigger command palette on Ctrl+K, Cmd+K
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (onOpenCommandPalette) {
          onOpenCommandPalette();
        } else {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        }
      } else if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onOpenCommandPalette]);

  const isGuest = !activeProfile || activeProfile.id === 'usr_guest';
  const showAdmin = activeProfile?.role === 'admin' && isHostComputer;

  const closeQuickMenu = (action?: () => void) => {
    setMobileQuickMenuOpen(false);
    action?.();
  };

  /* Shared primary navigation tabs */
  const tabs: Array<{
    id: AppNavTab;
    label: string;
    mobileLabel: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number;
    title?: string;
  }> = [
    { id: 'welcome', label: 'Home', mobileLabel: 'Home', icon: Home, title: 'Welcome Hub, Trending & Updates' },
    { id: 'library', label: 'My Library', mobileLabel: 'Library', icon: BookOpen, badge: unreadCount, title: 'Your Personal Manga Library' },
    { id: 'browse', label: 'Browse', mobileLabel: 'Browse', icon: Compass, title: 'Browse All Active Multi-Sources' },
    { id: 'categories', label: 'Categories', mobileLabel: 'Shelves', icon: Layers, title: 'Custom Shelves & Categorized Collections' },
    { id: 'sources', label: 'Sources', mobileLabel: 'Sources', icon: Globe, title: 'Manage Scraper Engines & Connectors' },
  ];

  const totalToolAlerts = pendingChallengesCount + (duplicateCount > 0 ? 1 : 0);

  const searchInput = (
    <div className="relative w-full group">
      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted group-focus-within:text-accent transition-colors pointer-events-none" />
      <input
        ref={searchInputRef}
        type="search"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="Search series, author, genre, or source..."
        className="w-full pl-10 pr-20 py-2.5 text-xs rounded-2xl bg-app/60 border border-edge/80 hover:border-edge-strong focus:border-accent focus:bg-app/90 text-primary placeholder-muted focus:outline-none focus:ring-2 focus:ring-accent/25 transition-all shadow-inner"
      />
      {searchQuery ? (
        <button
          onClick={() => setSearchQuery('')}
          aria-label="Clear search"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-secondary hover:text-primary bg-elevated hover:bg-edge-strong rounded-lg px-2 py-0.5 transition-colors cursor-pointer"
        >
          Clear
        </button>
      ) : (
        <button
          type="button"
          onClick={() => onOpenCommandPalette?.()}
          title="Open Quick Command & Search Spotlight (⌘K / Ctrl+K)"
          className="hidden sm:flex items-center gap-1 absolute right-2.5 top-1/2 -translate-y-1/2 px-2 py-0.5 rounded-lg text-[10px] font-mono text-muted bg-elevated/80 border border-edge/60 hover:bg-elevated hover:text-accent transition-colors shadow-xs cursor-pointer"
        >
          <span className="text-[10px] font-bold">⌘K</span>
        </button>
      )}
    </div>
  );

  return (
    <>
      <header className="sticky top-0 z-40 glass-nav text-primary">
        {/* ── Row 1 · Brand · Search · Actions ───────────────────────── */}
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-2 sm:gap-4 h-15 sm:h-16">
            {/* Brand (Links to Home / Welcome) */}
            <button
              onClick={() => setActiveTab('welcome')}
              className="flex items-center gap-3 min-w-0 shrink-0 group text-left cursor-pointer active:scale-[0.98] transition-transform"
              aria-label="Go to Welcome Home"
            >
              <div className="p-2 sm:p-2.5 bg-accent-grad rounded-2xl shadow-lg shadow-accent/25 text-accent-fg flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform duration-300">
                <BookOpen className="w-4 h-4 sm:w-5 sm:h-5 stroke-[2.5]" />
              </div>
              <div className="min-w-0 text-left">
                <div className="flex items-center gap-2">
                  <h1 className="text-base sm:text-lg font-black tracking-tight font-display text-primary truncate group-hover:text-accent transition-colors">
                    Graywood Reader
                  </h1>
                  {isIncognito ? (
                    <span className="hidden xl:inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-bold bg-accent-2/20 text-accent-2 border border-accent-2/30">
                      <EyeOff className="w-3 h-3 mr-1" />
                      Incognito
                    </span>
                  ) : (
                    <span className="hidden xl:inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-bold bg-success/15 text-success border border-success/25 shadow-xs">
                      <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse mr-1.5 shadow-sm" />
                      Live Sync
                    </span>
                  )}
                </div>
                <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-muted font-medium">
                  <Globe className="w-3 h-3 text-accent shrink-0" />
                  <span className="font-mono text-accent/80 truncate">{subdomain}</span>
                </div>
              </div>
            </button>

            {/* Desktop search */}
            <div className="hidden md:block flex-1 max-w-xl mx-2">{searchInput}</div>

            {/* Actions Group */}
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              {/* Incognito Private Reading Toggle */}
              <button
                onClick={onToggleIncognito}
                title="Toggle Incognito Private Reading Mode"
                aria-pressed={isIncognito}
                className={`p-2 sm:p-2.5 rounded-xl border transition-all cursor-pointer ${
                  isIncognito
                    ? 'bg-accent-2 text-accent-fg border-accent-2 shadow-md'
                    : 'bg-elevated/70 hover:bg-elevated text-secondary hover:text-primary border-edge-strong/60'
                }`}
              >
                <EyeOff className="w-4 h-4" />
              </button>

              {/* Challenge Alert (if any pending captchas) */}
              {pendingChallengesCount > 0 && onOpenChallengesModal && (
                <button
                  onClick={onOpenChallengesModal}
                  title={`${pendingChallengesCount} source(s) require manual captcha solving`}
                  className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 text-xs font-black rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 animate-pulse shadow-md transition-all cursor-pointer"
                >
                  <ShieldAlert className="w-4 h-4 text-amber-400" />
                  <span className="hidden sm:inline">Captcha</span>
                  <span className="w-4 h-4 rounded-full bg-amber-500 text-black text-[10px] font-black flex items-center justify-center">
                    {pendingChallengesCount}
                  </span>
                </button>
              )}

              {/* Tools & Activity Dropdown (Combines secondary utilities cleanly) */}
              <div className="relative" ref={toolsMenuRef}>
                <button
                  type="button"
                  onClick={() => setToolsDropdownOpen((v) => !v)}
                  title="Tools, Downloads, Readlists & Analytics"
                  className={`hidden sm:flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-xl border transition-all cursor-pointer ${
                    toolsDropdownOpen
                      ? 'bg-elevated text-primary border-accent'
                      : 'bg-elevated/70 hover:bg-elevated text-secondary hover:text-primary border-edge-strong/60'
                  }`}
                >
                  <Wrench className="w-3.5 h-3.5 text-accent" />
                  <span>Tools</span>
                  {(activeDownloadsCount > 0 || totalToolAlerts > 0) && (
                    <span className="w-2 h-2 rounded-full bg-accent animate-ping" />
                  )}
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${toolsDropdownOpen ? 'rotate-180' : ''}`} />
                </button>

                {toolsDropdownOpen && (
                  <div className="absolute right-0 top-full mt-2 w-64 p-2 bg-surface/95 border border-edge rounded-2xl shadow-2xl backdrop-blur-xl z-50 space-y-1 animate-in fade-in slide-in-from-top-2 duration-150 text-xs">
                    {onOpenDownloadManager && (
                      <button
                        type="button"
                        onClick={() => {
                          setToolsDropdownOpen(false);
                          onOpenDownloadManager();
                        }}
                        className="w-full p-2 rounded-xl flex items-center justify-between hover:bg-elevated text-secondary hover:text-primary transition-colors cursor-pointer"
                      >
                        <span className="flex items-center gap-2">
                          <Download className="w-4 h-4 text-accent" />
                          <span>Downloads Vault</span>
                        </span>
                        {activeDownloadsCount > 0 && (
                          <span className="px-1.5 py-0.5 rounded-full bg-accent text-accent-fg text-[10px] font-black">
                            {activeDownloadsCount}
                          </span>
                        )}
                      </button>
                    )}

                    {onOpenReadlists && (
                      <button
                        type="button"
                        onClick={() => {
                          setToolsDropdownOpen(false);
                          onOpenReadlists();
                        }}
                        className="w-full p-2 rounded-xl flex items-center gap-2 hover:bg-elevated text-secondary hover:text-primary transition-colors cursor-pointer"
                      >
                        <ListOrdered className="w-4 h-4 text-accent-2" />
                        <span>Readlists &amp; Story Arcs</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setToolsDropdownOpen(false);
                        onOpenAnalytics();
                      }}
                      className="w-full p-2 rounded-xl flex items-center gap-2 hover:bg-elevated text-secondary hover:text-primary transition-colors cursor-pointer"
                    >
                      <Calendar className="w-4 h-4 text-info" />
                      <span>Reading Activity Heatmap</span>
                    </button>

                    {onOpenAchievements && (
                      <button
                        type="button"
                        onClick={() => {
                          setToolsDropdownOpen(false);
                          onOpenAchievements();
                        }}
                        className="w-full p-2 rounded-xl flex items-center gap-2 hover:bg-elevated text-secondary hover:text-primary transition-colors cursor-pointer"
                      >
                        <Trophy className="w-4 h-4 text-amber-400" />
                        <span>Achievements &amp; Wrapped</span>
                      </button>
                    )}

                    <div className="border-t border-edge/60 my-1" />

                    <button
                      type="button"
                      onClick={() => {
                        setToolsDropdownOpen(false);
                        onRunAutoUpdate();
                      }}
                      disabled={isUpdating}
                      className="w-full p-2 rounded-xl flex items-center justify-between hover:bg-elevated text-secondary hover:text-primary transition-colors cursor-pointer disabled:opacity-60"
                    >
                      <span className="flex items-center gap-2">
                        <RefreshCw className={`w-4 h-4 text-accent ${isUpdating ? 'animate-spin' : ''}`} />
                        <span>{isUpdating ? 'Scanning Library...' : 'Auto-Update Scanner'}</span>
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setToolsDropdownOpen(false);
                        setActiveTab('duplicates');
                      }}
                      className="w-full p-2 rounded-xl flex items-center justify-between hover:bg-elevated text-secondary hover:text-primary transition-colors cursor-pointer"
                    >
                      <span className="flex items-center gap-2">
                        <Search className="w-4 h-4 text-secondary" />
                        <span>Duplicate Series Finder</span>
                      </span>
                      {duplicateCount > 0 && (
                        <span className="px-1.5 py-0.5 rounded-full bg-danger/25 text-danger text-[10px] font-black">
                          {duplicateCount}
                        </span>
                      )}
                    </button>

                    {onOpenExtensionManager && (
                      <button
                        type="button"
                        onClick={() => {
                          setToolsDropdownOpen(false);
                          onOpenExtensionManager();
                        }}
                        className="w-full p-2 rounded-xl flex items-center gap-2 hover:bg-elevated text-secondary hover:text-primary transition-colors cursor-pointer"
                      >
                        <Puzzle className="w-4 h-4 text-accent" />
                        <span>Community Extensions</span>
                      </button>
                    )}

                    {showAdmin && (
                      <button
                        type="button"
                        onClick={() => {
                          setToolsDropdownOpen(false);
                          onOpenAdminPanel();
                        }}
                        className="w-full p-2 rounded-xl flex items-center gap-2 bg-accent-2/10 hover:bg-accent-2/20 text-accent-2 font-bold transition-colors cursor-pointer"
                      >
                        <Shield className="w-4 h-4" />
                        <span>Host Admin Panel</span>
                      </button>
                    )}

                    {canInstallPwa && onOpenPwaInstall && (
                      <button
                        type="button"
                        onClick={() => {
                          setToolsDropdownOpen(false);
                          onOpenPwaInstall();
                        }}
                        className="w-full p-2 rounded-xl flex items-center gap-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 font-bold transition-colors cursor-pointer"
                      >
                        <Download className="w-4 h-4 text-amber-400" />
                        <span>Install Standalone PWA</span>
                      </button>
                    )}

                    {onOpenSubmitBugModal && (
                      <button
                        type="button"
                        onClick={() => {
                          setToolsDropdownOpen(false);
                          onOpenSubmitBugModal();
                        }}
                        className="w-full p-2 rounded-xl flex items-center gap-2 hover:bg-elevated text-danger transition-colors cursor-pointer"
                      >
                        <Bug className="w-4 h-4" />
                        <span>Submit Issue / Bug</span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* User Authentication / Profile Section */}
              {isGuest ? (
                <div className="flex items-center gap-1 sm:gap-1.5">
                  <button
                    onClick={() => onOpenAuthModal('login')}
                    className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 text-xs font-bold rounded-xl bg-elevated/80 text-secondary hover:text-primary border border-edge hover:border-accent/40 transition-all cursor-pointer"
                  >
                    <LogIn className="w-3.5 h-3.5 text-accent" />
                    <span className="hidden sm:inline">Sign In</span>
                  </button>

                  <button
                    onClick={() => onOpenAuthModal('register')}
                    className="flex items-center gap-1.5 px-2.5 sm:px-3.5 py-2 text-xs font-black rounded-xl bg-accent text-accent-fg hover:bg-accent-bright shadow-md shadow-accent/20 transition-all cursor-pointer active:scale-95"
                  >
                    <UserPlus className="w-3.5 h-3.5 stroke-[2.5]" />
                    <span className="hidden sm:inline">Register</span>
                  </button>
                </div>
              ) : (
                <button
                  onClick={onOpenProfileModal}
                  title={`User Profile: ${activeProfile?.name || 'Reader'}`}
                  className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 text-xs font-bold rounded-xl bg-accent/10 text-accent border border-accent/30 hover:bg-accent/20 transition-all max-w-[38vw] sm:max-w-none cursor-pointer"
                >
                  <span className="text-base leading-none">{activeProfile?.avatar || '👤'}</span>
                  <span className="hidden md:inline truncate">{activeProfile?.name || 'Reader'}</span>
                  {activeProfile?.role === 'admin' && (
                    <span className="hidden md:inline px-1 py-0.5 rounded text-[9px] font-black bg-accent text-accent-fg">
                      ADMIN
                    </span>
                  )}
                </button>
              )}

              {/* Primary action: Add Series */}
              <button
                onClick={onOpenAddModal}
                title="Add New Series to Library"
                className="flex items-center gap-1.5 px-2.5 sm:px-3.5 py-2 sm:py-2.5 text-xs font-black rounded-xl bg-accent hover:bg-accent-bright text-accent-fg shadow-md shadow-accent/25 transition-all active:scale-95 cursor-pointer"
              >
                <Plus className="w-4 h-4 stroke-[3]" />
                <span className="hidden sm:inline">Add Series</span>
              </button>

              {/* Settings Gear Button */}
              <button
                onClick={onOpenSettingsModal}
                title="Global Settings & Database Storage"
                className="p-2 sm:p-2.5 rounded-xl bg-elevated/70 hover:bg-elevated text-secondary hover:text-primary border border-edge-strong/60 transition-all cursor-pointer"
              >
                <Sliders className="w-4 h-4" />
              </button>

              {/* Mobile quick-menu toggle */}
              <button
                onClick={() => setMobileQuickMenuOpen((v) => !v)}
                aria-label="More actions"
                aria-expanded={mobileQuickMenuOpen}
                className="md:hidden p-2 rounded-xl bg-elevated/70 border border-edge-strong/60 text-secondary cursor-pointer"
              >
                {mobileQuickMenuOpen ? <X className="w-4 h-4 text-accent" /> : <MoreVertical className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Mobile search */}
          <div className="md:hidden pb-2.5">{searchInput}</div>
        </div>

        {/* ── Mobile quick-action drawer ─────────────────────────────────── */}
        {mobileQuickMenuOpen && (
          <div className="md:hidden p-3 bg-app border-b border-edge grid grid-cols-2 gap-2 text-xs font-bold">
            <button
              onClick={() => closeQuickMenu(onToggleIncognito)}
              className={`p-2.5 rounded-xl border flex items-center gap-2 cursor-pointer ${
                isIncognito
                  ? 'bg-accent-2/20 text-accent-2 border-accent-2/40'
                  : 'bg-surface text-secondary border-edge'
              }`}
            >
              <EyeOff className="w-4 h-4" />
              <span>{isIncognito ? 'Incognito ON' : 'Incognito OFF'}</span>
            </button>

            {canInstallPwa && onOpenPwaInstall && (
              <button
                onClick={() => closeQuickMenu(onOpenPwaInstall)}
                className="p-2.5 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-2 cursor-pointer"
              >
                <Download className="w-4 h-4 text-amber-400" />
                <span>Install App</span>
              </button>
            )}

            {onOpenDownloadManager && (
              <button
                onClick={() => closeQuickMenu(onOpenDownloadManager)}
                className="p-2.5 rounded-xl bg-surface text-secondary border border-edge flex items-center gap-2 cursor-pointer"
              >
                <Download className="w-4 h-4 text-accent" />
                <span>Downloads {activeDownloadsCount > 0 ? `(${activeDownloadsCount})` : ''}</span>
              </button>
            )}

            {onOpenReadlists && (
              <button
                onClick={() => closeQuickMenu(onOpenReadlists)}
                className="p-2.5 rounded-xl bg-surface text-secondary border border-edge flex items-center gap-2 cursor-pointer"
              >
                <ListOrdered className="w-4 h-4 text-accent-2" />
                <span>Readlists</span>
              </button>
            )}

            <button
              onClick={() => closeQuickMenu(onOpenAnalytics)}
              className="p-2.5 rounded-xl bg-surface text-secondary border border-edge flex items-center gap-2 cursor-pointer"
            >
              <Calendar className="w-4 h-4 text-info" />
              <span>Activity Heatmap</span>
            </button>

            {onOpenAchievements && (
              <button
                onClick={() => closeQuickMenu(onOpenAchievements)}
                className="p-2.5 rounded-xl bg-surface text-secondary border border-edge flex items-center gap-2 cursor-pointer"
              >
                <Trophy className="w-4 h-4 text-amber-400" />
                <span>Achievements &amp; Recap</span>
              </button>
            )}

            <button
              onClick={() => closeQuickMenu(onOpenAddModal)}
              className="p-2.5 rounded-xl bg-surface text-secondary border border-edge flex items-center gap-2 cursor-pointer"
            >
              <Plus className="w-4 h-4 text-accent" />
              <span>Add Series</span>
            </button>

            <button
              onClick={() => closeQuickMenu(onRunAutoUpdate)}
              disabled={isUpdating}
              className="p-2.5 rounded-xl bg-surface text-secondary border border-edge flex items-center gap-2 disabled:opacity-60 cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 text-accent ${isUpdating ? 'animate-spin' : ''}`} />
              <span>{isUpdating ? 'Scanning...' : 'Update Library'}</span>
            </button>

            {pendingChallengesCount > 0 && onOpenChallengesModal && (
              <button
                onClick={() => closeQuickMenu(onOpenChallengesModal)}
                className="p-2.5 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-2 cursor-pointer"
              >
                <ShieldAlert className="w-4 h-4 text-amber-400" />
                <span>Captchas ({pendingChallengesCount})</span>
              </button>
            )}

            {onOpenSubmitBugModal && (
              <button
                onClick={() => closeQuickMenu(onOpenSubmitBugModal)}
                className="p-2.5 rounded-xl bg-danger/10 text-danger border border-danger/30 flex items-center gap-2 cursor-pointer"
              >
                <Bug className="w-4 h-4" />
                <span>Submit Bug</span>
              </button>
            )}

            {isGuest ? (
              <>
                <button
                  onClick={() => closeQuickMenu(() => onOpenAuthModal('login'))}
                  className="p-2.5 rounded-xl bg-elevated text-secondary border border-edge flex items-center gap-2 cursor-pointer"
                >
                  <LogIn className="w-4 h-4 text-accent" />
                  <span>Sign In</span>
                </button>
                <button
                  onClick={() => closeQuickMenu(() => onOpenAuthModal('register'))}
                  className="p-2.5 rounded-xl bg-accent text-accent-fg font-black border border-accent flex items-center gap-2 cursor-pointer"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>Register</span>
                </button>
              </>
            ) : (
              <button
                onClick={() => closeQuickMenu(onOpenProfileModal)}
                className="p-2.5 rounded-xl bg-accent/10 text-accent border border-accent/30 flex items-center gap-2 cursor-pointer"
              >
                <span className="text-base leading-none">{activeProfile?.avatar || '👤'}</span>
                <span className="truncate">{activeProfile?.name || 'Reader'}</span>
              </button>
            )}

            {showAdmin && (
              <button
                onClick={() => closeQuickMenu(onOpenAdminPanel)}
                className="p-2.5 rounded-xl bg-accent-2/15 text-accent-2 border border-accent-2/40 flex items-center gap-2 col-span-2 cursor-pointer"
              >
                <Shield className="w-4 h-4" />
                <span>Host Admin Panel</span>
              </button>
            )}
          </div>
        )}

        {/* ── Row 2 · Desktop tab navigation ───────────────────────── */}
        <div className="hidden md:block border-t border-edge/60 bg-app/30">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <nav className="flex items-center gap-2 overflow-x-auto no-scrollbar py-2 text-xs sm:text-sm font-medium" aria-label="Primary">
              {tabs.map(({ id, label, icon: Icon, badge }) => {
                const isActive = activeTab === id;
                return (
                  <button
                    key={id}
                    onClick={() => setActiveTab(id)}
                    aria-current={isActive ? 'page' : undefined}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all whitespace-nowrap active:scale-95 cursor-pointer ${
                      isActive
                        ? 'bg-accent text-accent-fg font-black shadow-md shadow-accent/20'
                        : 'text-secondary hover:text-primary hover:bg-elevated/70'
                    }`}
                  >
                    <Icon className={`w-4 h-4 ${isActive ? 'stroke-[2.5]' : ''}`} />
                    <span>{label}</span>
                    {badge ? (
                      <span className={`min-w-[1.15rem] h-[1.15rem] px-1 rounded-full text-[10px] font-black flex items-center justify-center leading-none ${
                        isActive ? 'bg-black text-white' : 'bg-accent text-accent-fg'
                      }`}>
                        {badge > 99 ? '99+' : badge}
                      </span>
                    ) : null}
                  </button>
                );
              })}

              <button
                onClick={onOpenSettingsModal}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all whitespace-nowrap active:scale-95 cursor-pointer ${
                  activeTab === 'settings'
                    ? 'bg-accent text-accent-fg font-black shadow-md shadow-accent/20'
                    : 'text-secondary hover:text-primary hover:bg-elevated/70'
                }`}
              >
                <Sliders className="w-4 h-4" />
                <span>Settings &amp; Tools</span>
                {duplicateCount > 0 && (
                  <span className="min-w-[1.15rem] h-[1.15rem] px-1 rounded-full bg-danger/25 text-danger border border-danger/30 text-[10px] font-black flex items-center justify-center leading-none">
                    {duplicateCount}
                  </span>
                )}
              </button>
            </nav>
          </div>
        </div>
      </header>

      {/* ── Mobile floating bottom navigation ─────────────────────────── */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-surface/95 border-t border-edge backdrop-blur-xl px-2 pt-1.5 pb-safe flex items-stretch justify-around shadow-2xl shadow-black/40"
        aria-label="Primary mobile"
      >
        {tabs.map(({ id, mobileLabel, icon: Icon, badge }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              aria-current={active ? 'page' : undefined}
              className={`relative flex flex-col items-center justify-center gap-0.5 flex-1 py-1.5 rounded-xl transition-all cursor-pointer ${
                active ? 'text-accent font-bold' : 'text-muted'
              }`}
            >
              <span
                className={`relative flex items-center justify-center w-10 h-6 rounded-full transition-all ${
                  active ? 'bg-accent/15' : ''
                }`}
              >
                <Icon className="w-5 h-5" />
                {badge ? (
                  <span className="absolute -top-1.5 -right-2 min-w-[1rem] h-4 px-1 rounded-full bg-accent text-accent-fg text-[9px] font-black flex items-center justify-center leading-none">
                    {badge > 99 ? '99+' : badge}
                  </span>
                ) : null}
              </span>
              <span className="text-[10px]">{mobileLabel}</span>
            </button>
          );
        })}

        <button
          onClick={onOpenSettingsModal}
          className="flex flex-col items-center justify-center gap-0.5 flex-1 py-1.5 rounded-xl text-muted transition-all cursor-pointer"
        >
          <span className="relative flex items-center justify-center w-10 h-6">
            <Sliders className="w-5 h-5" />
            {duplicateCount > 0 && (
              <span className="absolute -top-1.5 -right-2 min-w-[1rem] h-4 px-1 rounded-full bg-danger text-white text-[9px] font-black flex items-center justify-center leading-none">
                {duplicateCount}
              </span>
            )}
          </span>
          <span className="text-[10px]">Settings</span>
        </button>
      </nav>
    </>
  );
});
