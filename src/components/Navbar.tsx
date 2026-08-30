import React, { useState, useRef, useEffect } from 'react';
import {
  Home,
  BookOpen,
  RefreshCw,
  Search,
  Plus,
  Globe,
  Calendar,
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
  subdomain: _subdomain,
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
  const [searchExpanded, setSearchExpanded] = useState(false);
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

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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

  const tabs: Array<{
    id: AppNavTab;
    label: string;
    mobileLabel: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number;
  }> = [
    { id: 'welcome', label: 'Home', mobileLabel: 'Home', icon: Home },
    { id: 'library', label: 'Library', mobileLabel: 'Library', icon: BookOpen, badge: unreadCount },
    { id: 'browse', label: 'Browse', mobileLabel: 'Browse', icon: Compass },
    { id: 'categories', label: 'Shelves', mobileLabel: 'Shelves', icon: Layers },
    { id: 'sources', label: 'Sources', mobileLabel: 'Sources', icon: Globe },
  ];

  return (
    <>
      <header className="sticky top-0 z-40 bg-app/80 backdrop-blur-xl border-b border-edge/80 text-primary transition-all">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-2 lg:gap-4 h-16">
            {/* ── Brand Logo ────────────────────────────────────────────── */}
            <button
              onClick={() => setActiveTab('welcome')}
              className="flex items-center gap-2.5 shrink-0 group text-left cursor-pointer active:scale-95 transition-transform"
              aria-label="Graywood Reader Home"
            >
              <div className="w-9 h-9 rounded-xl bg-accent-grad shadow-md shadow-accent/20 text-accent-fg flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                <BookOpen className="w-4.5 h-4.5 stroke-[2.5]" />
              </div>
              <span className="text-base font-black tracking-tight font-display text-primary hidden sm:inline group-hover:text-accent transition-colors">
                Graywood
              </span>
            </button>

            {/* ── Streamlined Main Navigation Tabs (Desktop Inline) ─────── */}
            <nav className="hidden md:flex items-center gap-1 bg-surface/60 border border-edge/60 p-1 rounded-2xl shadow-inner text-xs font-bold" aria-label="Main">
              {tabs.map(({ id, label, icon: Icon, badge }) => {
                const isActive = activeTab === id;
                return (
                  <button
                    key={id}
                    onClick={() => setActiveTab(id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition-all whitespace-nowrap cursor-pointer ${
                      isActive
                        ? 'bg-accent text-accent-fg font-black shadow-sm'
                        : 'text-secondary hover:text-primary hover:bg-elevated/70'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{label}</span>
                    {badge && badge > 0 ? (
                      <span
                        className={`min-w-[1.1rem] h-[1.1rem] px-1 rounded-full text-[9px] font-black flex items-center justify-center leading-none ${
                          isActive ? 'bg-black text-white' : 'bg-accent text-accent-fg'
                        }`}
                      >
                        {badge > 99 ? '99+' : badge}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </nav>

            {/* ── Compact / Expandable Search Bar ────────────────────────── */}
            <div className="flex-1 max-w-xs lg:max-w-sm hidden sm:block">
              <div className="relative group">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted group-focus-within:text-accent transition-colors pointer-events-none" />
                <input
                  ref={searchInputRef}
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onFocus={() => setSearchExpanded(true)}
                  onBlur={() => setSearchExpanded(false)}
                  placeholder="Search series, authors..."
                  className={`w-full pl-8.5 pr-14 py-1.5 text-xs rounded-xl bg-surface/80 border border-edge hover:border-edge-strong focus:border-accent focus:bg-surface text-primary placeholder-muted focus:outline-none focus:ring-1 focus:ring-accent/30 transition-all ${
                    searchExpanded ? 'ring-1 ring-accent/30 border-accent' : ''
                  }`}
                />
                {searchQuery ? (
                  <button
                    onClick={() => setSearchQuery('')}
                    aria-label="Clear search"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-muted hover:text-primary px-1.5 py-0.5 rounded cursor-pointer"
                  >
                    ✕
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onOpenCommandPalette}
                    className="hidden lg:inline-flex items-center gap-1 absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded-lg text-[10px] font-mono font-bold text-muted hover:text-primary bg-app/80 border border-edge hover:border-accent/40 transition-colors cursor-pointer shadow-xs"
                    title="Quick Command Palette"
                  >
                    <span>{typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.userAgent) ? '⌘K' : 'Ctrl K'}</span>
                  </button>
                )}
              </div>
            </div>

            {/* ── Right Action Cluster ──────────────────────────────────── */}
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              {/* Incognito reading mode toggle */}
              <button
                onClick={onToggleIncognito}
                title={isIncognito ? 'Incognito Mode Active' : 'Enable Incognito Reading'}
                className={`p-2 rounded-xl border transition-all cursor-pointer ${
                  isIncognito
                    ? 'bg-accent-2 text-accent-fg border-accent-2 shadow-sm'
                    : 'bg-surface/80 hover:bg-elevated text-secondary hover:text-primary border-edge'
                }`}
              >
                <EyeOff className="w-4 h-4" />
              </button>

              {/* Tools Menu Dropdown */}
              <div className="relative" ref={toolsMenuRef}>
                <button
                  type="button"
                  onClick={() => setToolsDropdownOpen((v) => !v)}
                  title="Tools & Vault"
                  className={`flex items-center gap-1.5 px-2.5 py-2 text-xs font-bold rounded-xl border transition-all cursor-pointer ${
                    toolsDropdownOpen
                      ? 'bg-elevated text-primary border-accent'
                      : 'bg-surface/80 hover:bg-elevated text-secondary hover:text-primary border-edge'
                  }`}
                >
                  <Wrench className="w-3.5 h-3.5 text-accent" />
                  <span className="hidden xl:inline">Tools</span>
                  {activeDownloadsCount > 0 && (
                    <span className="w-2 h-2 rounded-full bg-accent animate-ping" />
                  )}
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${toolsDropdownOpen ? 'rotate-180' : ''}`} />
                </button>

                {toolsDropdownOpen && (
                  <div className="absolute right-0 top-full mt-2 w-60 p-1.5 bg-surface/95 border border-edge rounded-2xl shadow-2xl backdrop-blur-xl z-50 space-y-0.5 animate-in fade-in slide-in-from-top-2 duration-150 text-xs">
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
                        <span>Readlists</span>
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
                      <span>Activity Heatmap</span>
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
                        <span>Achievements</span>
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
                        <span>{isUpdating ? 'Scanning...' : 'Scan Updates'}</span>
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
                        <span>Deduplicate</span>
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
                        <span>Extensions</span>
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
                        <span>Host Admin</span>
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
                        <span>Install App</span>
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
                        <span>Submit Issue</span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* User Sign In / Register or Profile */}
              {isGuest ? (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => onOpenAuthModal('login')}
                    className="px-3 py-1.5 text-xs font-bold rounded-xl text-secondary hover:text-primary hover:bg-elevated transition-colors cursor-pointer"
                  >
                    Sign In
                  </button>
                  <button
                    onClick={() => onOpenAuthModal('register')}
                    className="px-3 py-1.5 text-xs font-black rounded-xl bg-accent text-accent-fg hover:bg-accent-bright shadow-sm transition-all cursor-pointer active:scale-95"
                  >
                    Register
                  </button>
                </div>
              ) : (
                <button
                  onClick={onOpenProfileModal}
                  title={`Profile: ${activeProfile?.name || 'Reader'}`}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold rounded-xl bg-surface/80 hover:bg-elevated border border-edge text-primary transition-all cursor-pointer"
                >
                  <span className="text-sm leading-none">{activeProfile?.avatar || '👤'}</span>
                  <span className="hidden lg:inline truncate max-w-[90px]">{activeProfile?.name || 'Reader'}</span>
                </button>
              )}

              {/* Primary + Add Series Button */}
              <button
                onClick={onOpenAddModal}
                title="Add New Series"
                className="px-3 py-1.5 text-xs font-black rounded-xl bg-accent hover:bg-accent-bright text-accent-fg shadow-sm flex items-center gap-1 cursor-pointer active:scale-95 transition-all"
              >
                <Plus className="w-3.5 h-3.5 stroke-[3]" />
                <span className="hidden sm:inline">Add</span>
              </button>

              {/* Settings Gear */}
              <button
                onClick={onOpenSettingsModal}
                title="Settings & Tools"
                className="p-2 rounded-xl bg-surface/80 hover:bg-elevated text-secondary hover:text-primary border border-edge transition-colors cursor-pointer"
              >
                <Sliders className="w-4 h-4" />
              </button>

              {/* Mobile quick-menu trigger */}
              <button
                onClick={() => setMobileQuickMenuOpen((v) => !v)}
                aria-label="More"
                className="md:hidden p-2 rounded-xl bg-surface border border-edge text-secondary cursor-pointer"
              >
                {mobileQuickMenuOpen ? <X className="w-4 h-4 text-accent" /> : <MoreVertical className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Mobile search bar (only on mobile screens) */}
          <div className="sm:hidden pb-2.5">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted pointer-events-none" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search series..."
                className="w-full pl-8.5 pr-8 py-1.5 text-xs rounded-xl bg-surface border border-edge text-primary placeholder-muted focus:outline-none focus:border-accent"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Mobile quick-action drawer ─────────────────────────────────── */}
        {mobileQuickMenuOpen && (
          <div className="md:hidden p-3 bg-surface border-t border-edge grid grid-cols-2 gap-2 text-xs font-bold animate-in fade-in duration-150">
            {isGuest ? (
              <>
                <button
                  onClick={() => closeQuickMenu(() => onOpenAuthModal('login'))}
                  className="p-2 rounded-xl bg-elevated text-secondary border border-edge flex items-center gap-2 cursor-pointer"
                >
                  <LogIn className="w-4 h-4 text-accent" />
                  <span>Sign In</span>
                </button>
                <button
                  onClick={() => closeQuickMenu(() => onOpenAuthModal('register'))}
                  className="p-2 rounded-xl bg-accent text-accent-fg font-black flex items-center gap-2 cursor-pointer"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>Register</span>
                </button>
              </>
            ) : (
              <button
                onClick={() => closeQuickMenu(onOpenProfileModal)}
                className="p-2 rounded-xl bg-elevated text-primary border border-edge flex items-center gap-2 col-span-2 cursor-pointer"
              >
                <span>{activeProfile?.avatar || '👤'}</span>
                <span>{activeProfile?.name || 'Reader'}</span>
              </button>
            )}

            <button
              onClick={() => closeQuickMenu(onOpenAnalytics)}
              className="p-2 rounded-xl bg-elevated text-secondary border border-edge flex items-center gap-2 cursor-pointer"
            >
              <Calendar className="w-4 h-4 text-info" />
              <span>Activity</span>
            </button>

            {onOpenAchievements && (
              <button
                onClick={() => closeQuickMenu(onOpenAchievements)}
                className="p-2 rounded-xl bg-elevated text-secondary border border-edge flex items-center gap-2 cursor-pointer"
              >
                <Trophy className="w-4 h-4 text-amber-400" />
                <span>Achievements</span>
              </button>
            )}

            {onOpenDownloadManager && (
              <button
                onClick={() => closeQuickMenu(onOpenDownloadManager)}
                className="p-2 rounded-xl bg-elevated text-secondary border border-edge flex items-center gap-2 cursor-pointer"
              >
                <Download className="w-4 h-4 text-accent" />
                <span>Downloads {activeDownloadsCount > 0 ? `(${activeDownloadsCount})` : ''}</span>
              </button>
            )}

            <button
              onClick={() => closeQuickMenu(onRunAutoUpdate)}
              disabled={isUpdating}
              className="p-2 rounded-xl bg-elevated text-secondary border border-edge flex items-center gap-2 cursor-pointer disabled:opacity-60"
            >
              <RefreshCw className={`w-4 h-4 text-accent ${isUpdating ? 'animate-spin' : ''}`} />
              <span>{isUpdating ? 'Scanning...' : 'Scan Updates'}</span>
            </button>

            {pendingChallengesCount > 0 && onOpenChallengesModal && (
              <button
                onClick={() => closeQuickMenu(onOpenChallengesModal)}
                className="p-2 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-2 cursor-pointer col-span-2"
              >
                <ShieldAlert className="w-4 h-4 text-amber-400" />
                <span>Captchas ({pendingChallengesCount})</span>
              </button>
            )}

            {showAdmin && (
              <button
                onClick={() => closeQuickMenu(onOpenAdminPanel)}
                className="p-2 rounded-xl bg-accent-2/15 text-accent-2 border border-accent-2/40 flex items-center gap-2 col-span-2 cursor-pointer"
              >
                <Shield className="w-4 h-4" />
                <span>Host Admin Panel</span>
              </button>
            )}
          </div>
        )}
      </header>

      {/* ── Mobile Floating Bottom Bar (Ergonomic PWA Touch Targets) ────── */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-surface/90 border-t border-edge/80 backdrop-blur-2xl px-3 pt-1.5 pb-safe flex items-center justify-around shadow-2xl shadow-black/60"
        aria-label="Primary mobile"
      >
        {tabs.map(({ id, mobileLabel, icon: Icon, badge }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              aria-current={active ? 'page' : undefined}
              className={`relative flex flex-col items-center justify-center gap-1 flex-1 py-1 px-1 rounded-2xl transition-all duration-200 cursor-pointer active:scale-95 ${
                active ? 'text-accent font-black' : 'text-muted hover:text-secondary'
              }`}
            >
              <span
                className={`relative flex items-center justify-center w-10 h-7 rounded-xl transition-all duration-200 ${
                  active
                    ? 'bg-accent/20 text-accent shadow-xs'
                    : 'bg-transparent text-secondary'
                }`}
              >
                <Icon className={`w-4.5 h-4.5 ${active ? 'stroke-[2.5]' : 'stroke-[1.8]'}`} />
                {badge && badge > 0 ? (
                  <span className="absolute -top-1 -right-1 min-w-[0.95rem] h-3.5 px-1 rounded-full bg-accent text-accent-fg text-[9px] font-black flex items-center justify-center leading-none shadow-xs">
                    {badge > 99 ? '99+' : badge}
                  </span>
                ) : null}
              </span>
              <span className={`text-[10px] tracking-tight ${active ? 'font-black text-accent' : 'font-medium text-muted'}`}>
                {mobileLabel}
              </span>
            </button>
          );
        })}

        <button
          onClick={onOpenSettingsModal}
          className="flex flex-col items-center justify-center gap-1 flex-1 py-1 px-1 rounded-2xl text-muted hover:text-secondary transition-all duration-200 cursor-pointer active:scale-95"
        >
          <span className="relative flex items-center justify-center w-10 h-7 rounded-xl bg-transparent text-secondary">
            <Sliders className="w-4.5 h-4.5 stroke-[1.8]" />
          </span>
          <span className="text-[10px] font-medium text-muted">Settings</span>
        </button>
      </nav>
    </>
  );
});
