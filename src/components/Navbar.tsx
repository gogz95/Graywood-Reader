import React, { useState } from 'react';
import {
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
  onOpenAddModal: () => void;
  onRunAutoUpdate: () => void;
  isUpdating: boolean;
  onOpenSettingsModal: () => void;
  isIncognito: boolean;
  onToggleIncognito: () => void;
  onOpenAnalytics: () => void;
  onOpenAchievements?: () => void;
  onOpenChallengesModal?: () => void;
  activeProfile: UserProfile;
  isHostComputer?: boolean;
  onOpenProfileModal: () => void;
  onOpenAuthModal: () => void;
  onOpenAdminPanel: () => void;
  onOpenSubmitBugModal?: () => void;
}

/** Small count pill used on tabs / nav items */
const Badge: React.FC<{ count: number }> = ({ count }) =>
  count > 0 ? (
    <span className="min-w-[1.15rem] h-[1.15rem] px-1 rounded-full bg-accent text-accent-fg text-[10px] font-black flex items-center justify-center leading-none">
      {count > 99 ? '99+' : count}
    </span>
  ) : null;

export const Navbar: React.FC<NavbarProps> = ({
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
  activeProfile,
  isHostComputer = true,
  onOpenProfileModal,
  onOpenAuthModal,
  onOpenAdminPanel,
  onOpenSubmitBugModal,
}) => {
  const [mobileQuickMenuOpen, setMobileQuickMenuOpen] = useState(false);

  const isGuest = activeProfile.id === 'usr_guest';
  const showAdmin = activeProfile.role === 'admin' && isHostComputer;

  const closeQuickMenu = (action?: () => void) => {
    setMobileQuickMenuOpen(false);
    action?.();
  };

  /* Shared tab definitions (desktop pills + mobile bottom nav) */
  const tabs: Array<{
    id: AppNavTab;
    label: string;
    mobileLabel: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number;
    title?: string;
  }> = [
    { id: 'library', label: 'My Library', mobileLabel: 'Library', icon: BookOpen, badge: unreadCount, title: 'Your Manga Library' },
    { id: 'browse', label: 'Browse', mobileLabel: 'Browse', icon: Compass, title: 'Browse All Active Sources' },
    { id: 'sources', label: 'Sources', mobileLabel: 'Sources', icon: Globe, title: 'Manage Scraper Engines & Connectors' },
    { id: 'autoupdate', label: 'Scan Logs', mobileLabel: 'Updates', icon: RefreshCw, title: 'Automatic Update History & Release Logs' },
    { id: 'duplicates', label: 'Deduplicate', mobileLabel: 'Duplicates', icon: Search, badge: duplicateCount, title: 'Merge Duplicate Series' },
  ];

  const searchInput = (
    <div className="relative w-full">
      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
      <input
        type="search"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="Search series, author, or genre..."
        className="w-full pl-9.5 pr-16 py-2 text-xs rounded-xl bg-surface/80 border border-edge hover:border-edge-strong focus:border-accent text-primary placeholder-muted focus:outline-none focus:ring-1 focus:ring-accent/40 transition-all"
      />
      {searchQuery && (
        <button
          onClick={() => setSearchQuery('')}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-secondary hover:text-primary bg-elevated hover:bg-edge-strong rounded-md px-1.5 py-0.5 transition-colors"
        >
          Clear
        </button>
      )}
    </div>
  );

  return (
    <>
      <header className="sticky top-0 z-40 bg-surface/85 backdrop-blur-xl border-b border-edge text-primary shadow-lg shadow-black/20">
        {/* â”€â”€ Row 1 Â· Brand Â· Search Â· Actions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-2 sm:gap-4 h-14 sm:h-16">
            {/* Brand */}
            <button
              onClick={() => setActiveTab('library')}
              className="flex items-center gap-2.5 min-w-0 shrink-0"
              aria-label="Go to library"
            >
              <div className="p-2 sm:p-2.5 bg-accent-grad rounded-xl shadow-md shadow-accent/25 text-accent-fg flex items-center justify-center shrink-0">
                <BookOpen className="w-4 h-4 sm:w-5 sm:h-5 stroke-[2.5]" />
              </div>
              <div className="min-w-0 text-left">
                <div className="flex items-center gap-2">
                  <h1 className="text-sm sm:text-lg font-bold tracking-tight text-primary truncate">
                    Graywood Reader
                  </h1>
                  {isIncognito ? (
                    <span className="hidden xl:inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-accent-2/20 text-accent-2 border border-accent-2/30">
                      <EyeOff className="w-3 h-3 mr-1" />
                      Incognito
                    </span>
                  ) : (
                    <span className="hidden xl:inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-success/10 text-success border border-success/20">
                      <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse mr-1.5" />
                      Live
                    </span>
                  )}
                </div>
                <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-muted">
                  <Globe className="w-3 h-3 text-accent shrink-0" />
                  <span className="font-mono text-accent/90 truncate">{subdomain}</span>
                </div>
              </div>
            </button>

            {/* Desktop search */}
            <div className="hidden md:block flex-1 max-w-xl mx-2">{searchInput}</div>

            {/* Actions */}
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              <button
                onClick={onToggleIncognito}
                title="Toggle Incognito Private Reading Mode"
                aria-pressed={isIncognito}
                className={`p-2 sm:p-2.5 rounded-xl border transition-all ${
                  isIncognito
                    ? 'bg-accent-2 text-accent-fg border-accent-2 shadow-md'
                    : 'bg-elevated/70 hover:bg-elevated text-secondary hover:text-primary border-edge-strong/60'
                }`}
              >
                <EyeOff className="w-4 h-4" />
              </button>

              <button
                onClick={onOpenAnalytics}
                title="View Reading Activity Heatmap"
                className="hidden sm:block p-2.5 rounded-xl bg-elevated/70 hover:bg-elevated text-secondary hover:text-info border border-edge-strong/60 transition-all"
              >
                <Calendar className="w-4 h-4 text-info" />
              </button>

              {onOpenAchievements && (
                <button
                  onClick={onOpenAchievements}
                  title="View Reading Achievements & Manga Wrapped"
                  className="hidden sm:block p-2.5 rounded-xl bg-elevated/70 hover:bg-elevated text-secondary hover:text-amber-400 border border-edge-strong/60 transition-all"
                >
                  <Trophy className="w-4 h-4 text-amber-400" />
                </button>
              )}

              {/* Challenge / Captcha Alert Button */}
              {pendingChallengesCount > 0 && onOpenChallengesModal && (
                <button
                  onClick={onOpenChallengesModal}
                  title={`${pendingChallengesCount} source(s) require manual captcha solving or challenge verification`}
                  className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 text-xs font-black rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 animate-pulse shadow-md transition-all"
                >
                  <ShieldAlert className="w-4 h-4 text-amber-400" />
                  <span className="hidden sm:inline">Captcha Alert</span>
                  <span className="w-4 h-4 rounded-full bg-amber-500 text-black text-[10px] font-black flex items-center justify-center">
                    {pendingChallengesCount}
                  </span>
                </button>
              )}

              {showAdmin && (
                <button
                  onClick={onOpenAdminPanel}
                  title="Host Admin Panel: Promote, Demote, or Remove User Accounts"
                  className="hidden lg:flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-xl bg-accent-2/15 text-accent-2 border border-accent-2/30 hover:bg-accent-2/25 transition-all"
                >
                  <Shield className="w-4 h-4" />
                  <span>Admin</span>
                </button>
              )}

              <button
                onClick={onRunAutoUpdate}
                disabled={isUpdating}
                title="Run Automatic Chapter Update Scan"
                className="hidden sm:block p-2.5 rounded-xl bg-elevated/70 hover:bg-elevated text-secondary hover:text-accent border border-edge-strong/60 transition-all disabled:opacity-60"
              >
                <RefreshCw className={`w-4 h-4 text-accent ${isUpdating ? 'animate-spin' : ''}`} />
              </button>

              {/* Profile / Sign-in */}
              {isGuest ? (
                <button
                  onClick={onOpenAuthModal}
                  className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 text-xs font-bold rounded-xl bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25 transition-all"
                >
                  <User className="w-4 h-4" />
                  <span className="hidden sm:inline">Sign In</span>
                </button>
              ) : (
                <button
                  onClick={onOpenProfileModal}
                  title={`User Profile: ${activeProfile.name}`}
                  className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 text-xs font-bold rounded-xl bg-accent/10 text-accent border border-accent/30 hover:bg-accent/20 transition-all max-w-[38vw] sm:max-w-none"
                >
                  <span className="text-base leading-none">{activeProfile.avatar}</span>
                  <span className="hidden md:inline truncate">{activeProfile.name}</span>
                  {activeProfile.role === 'admin' && (
                    <span className="hidden md:inline px-1 py-0.5 rounded text-[9px] font-black bg-accent text-accent-fg">
                      ADMIN
                    </span>
                  )}
                </button>
              )}

              {/* Primary action: Add Series */}
              <button
                onClick={onOpenAddModal}
                title="Add New Series"
                className="flex items-center gap-1.5 px-2.5 sm:px-3.5 py-2 sm:py-2.5 text-xs font-black rounded-xl bg-accent hover:bg-accent-bright text-accent-fg shadow-md shadow-accent/25 transition-all active:scale-95"
              >
                <Plus className="w-4 h-4 stroke-[3]" />
                <span className="hidden sm:inline">Add Series</span>
              </button>

              {/* Mobile quick-menu toggle */}
              <button
                onClick={() => setMobileQuickMenuOpen((v) => !v)}
                aria-label="More actions"
                aria-expanded={mobileQuickMenuOpen}
                className="md:hidden p-2 rounded-xl bg-elevated/70 border border-edge-strong/60 text-secondary"
              >
                {mobileQuickMenuOpen ? <X className="w-4 h-4 text-accent" /> : <MoreVertical className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Mobile search */}
          <div className="md:hidden pb-2.5">{searchInput}</div>
        </div>

        {/* â”€â”€ Mobile quick-action drawer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        {mobileQuickMenuOpen && (
          <div className="md:hidden p-3 bg-app border-b border-edge grid grid-cols-2 gap-2 text-xs font-bold">
            <button
              onClick={() => closeQuickMenu(onToggleIncognito)}
              className={`p-2.5 rounded-xl border flex items-center gap-2 ${
                isIncognito
                  ? 'bg-accent-2/20 text-accent-2 border-accent-2/40'
                  : 'bg-surface text-secondary border-edge'
              }`}
            >
              <EyeOff className="w-4 h-4" />
              <span>{isIncognito ? 'Incognito ON' : 'Incognito OFF'}</span>
            </button>

            <button
              onClick={() => closeQuickMenu(onOpenAnalytics)}
              className="p-2.5 rounded-xl bg-surface text-secondary border border-edge flex items-center gap-2"
            >
              <Calendar className="w-4 h-4 text-info" />
              <span>Activity Heatmap</span>
            </button>

            {onOpenAchievements && (
              <button
                onClick={() => closeQuickMenu(onOpenAchievements)}
                className="p-2.5 rounded-xl bg-surface text-secondary border border-edge flex items-center gap-2"
              >
                <Trophy className="w-4 h-4 text-amber-400" />
                <span>Achievements & Recap</span>
              </button>
            )}

            <button
              onClick={() => closeQuickMenu(onOpenAddModal)}
              className="p-2.5 rounded-xl bg-surface text-secondary border border-edge flex items-center gap-2"
            >
              <Plus className="w-4 h-4 text-accent" />
              <span>Add Series</span>
            </button>

            <button
              onClick={() => closeQuickMenu(onRunAutoUpdate)}
              disabled={isUpdating}
              className="p-2.5 rounded-xl bg-surface text-secondary border border-edge flex items-center gap-2 disabled:opacity-60"
            >
              <RefreshCw className={`w-4 h-4 text-accent ${isUpdating ? 'animate-spin' : ''}`} />
              <span>{isUpdating ? 'Scanning...' : 'Update Library'}</span>
            </button>

            {pendingChallengesCount > 0 && onOpenChallengesModal && (
              <button
                onClick={() => closeQuickMenu(onOpenChallengesModal)}
                className="p-2.5 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-2"
              >
                <ShieldAlert className="w-4 h-4 text-amber-400" />
                <span>Captchas ({pendingChallengesCount})</span>
              </button>
            )}

            {onOpenSubmitBugModal && (
              <button
                onClick={() => closeQuickMenu(onOpenSubmitBugModal)}
                className="p-2.5 rounded-xl bg-danger/10 text-danger border border-danger/30 flex items-center gap-2"
              >
                <Bug className="w-4 h-4" />
                <span>Submit Bug</span>
              </button>
            )}

            {isGuest ? (
              <button
                onClick={() => closeQuickMenu(onOpenAuthModal)}
                className="p-2.5 rounded-xl bg-accent/10 text-accent border border-accent/30 flex items-center gap-2"
              >
                <User className="w-4 h-4" />
                <span>Sign In</span>
              </button>
            ) : (
              <button
                onClick={() => closeQuickMenu(onOpenProfileModal)}
                className="p-2.5 rounded-xl bg-accent/10 text-accent border border-accent/30 flex items-center gap-2"
              >
                <span className="text-base leading-none">{activeProfile.avatar}</span>
                <span className="truncate">{activeProfile.name}</span>
              </button>
            )}

            {showAdmin && (
              <button
                onClick={() => closeQuickMenu(onOpenAdminPanel)}
                className="p-2.5 rounded-xl bg-accent-2/15 text-accent-2 border border-accent-2/40 flex items-center gap-2 col-span-2"
              >
                <Shield className="w-4 h-4" />
                <span>Host Admin Panel</span>
              </button>
            )}
          </div>
        )}

        {/* â”€â”€ Row 2 Â· Desktop tab navigation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <div className="hidden md:block border-t border-edge/70">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <nav className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-2 text-xs sm:text-sm font-medium" aria-label="Primary">
              {tabs.map(({ id, label, icon: Icon, badge }) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  aria-current={activeTab === id ? 'page' : undefined}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-xl border transition-all whitespace-nowrap ${
                    activeTab === id
                      ? 'bg-accent/15 text-accent border-accent/30 font-semibold shadow-sm'
                      : 'text-secondary hover:text-primary hover:bg-elevated/60 border-transparent'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{label}</span>
                  {badge ? <Badge count={badge} /> : null}
                </button>
              ))}

              <button
                onClick={onOpenSettingsModal}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl border transition-all whitespace-nowrap ${
                  activeTab === 'settings'
                    ? 'bg-accent/15 text-accent border-accent/30 font-semibold shadow-sm'
                    : 'text-secondary hover:text-primary hover:bg-elevated/60 border-transparent'
                }`}
              >
                <Sliders className="w-4 h-4" />
                <span>Settings &amp; Tools</span>
                {duplicateCount > 0 && (
                  <span className="min-w-[1.15rem] h-[1.15rem] px-1 rounded-full bg-danger/20 text-danger border border-danger/30 text-[10px] font-black flex items-center justify-center leading-none">
                    {duplicateCount}
                  </span>
                )}
              </button>

              {onOpenSubmitBugModal && (
                <button
                  onClick={onOpenSubmitBugModal}
                  title="Submit a bug report"
                  className="ml-auto flex items-center gap-2 px-3.5 py-2 rounded-xl text-secondary hover:text-danger hover:bg-danger/10 transition-all whitespace-nowrap"
                >
                  <Bug className="w-4 h-4" />
                  <span>Report Bug</span>
                </button>
              )}
            </nav>
          </div>
        </div>
      </header>

      {/* â”€â”€ Mobile floating bottom navigation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
           Rendered as a sibling of <header>: the header uses backdrop-blur,
           which would otherwise become the containing block for this
           position:fixed element and pin it to the wrong edge. */}
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
              className={`relative flex flex-col items-center justify-center gap-0.5 flex-1 py-1.5 rounded-xl transition-all ${
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
          className="flex flex-col items-center justify-center gap-0.5 flex-1 py-1.5 rounded-xl text-muted transition-all"
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
};
