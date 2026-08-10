import React from 'react';
import {
  BookOpen,
  RefreshCw,
  Search,
  Plus,
  GitMerge,
  Database,
  Globe,
  Bell,
  Sparkles,
  Zap,
  Sliders,
  Play,
  BarChart3,
  Shield,
  EyeOff,
  Eye,
  FileArchive,
  Calendar,
  User,
  Compass,
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
  onOpenAddModal: () => void;
  onRunAutoUpdate: () => void;
  isUpdating: boolean;
  onOpenSettingsModal: () => void;
  isIncognito: boolean;
  onToggleIncognito: () => void;
  onOpenLocalReader: () => void;
  onOpenAnalytics: () => void;
  activeProfile: UserProfile;
  onOpenProfileModal: () => void;
  onOpenAuthModal: () => void;
  onOpenAdminPanel: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  subdomain,
  searchQuery,
  setSearchQuery,
  unreadCount,
  duplicateCount,
  onOpenAddModal,
  onRunAutoUpdate,
  isUpdating,
  onOpenSettingsModal,
  isIncognito,
  onToggleIncognito,
  onOpenLocalReader,
  onOpenAnalytics,
  activeProfile,
  onOpenProfileModal,
  onOpenAuthModal,
  onOpenAdminPanel,
}) => {


  return (
    <header className="sticky top-0 z-40 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 text-slate-100 shadow-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Top Header Row */}
        <div className="flex items-center justify-between h-16 gap-4">
          {/* Logo & Subdomain Badge */}
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-gradient-to-tr from-amber-500 via-orange-500 to-red-500 rounded-xl shadow-lg shadow-orange-500/20 text-slate-950 font-bold flex items-center justify-center">
              <BookOpen className="w-5 h-5 text-slate-950 stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold tracking-tight bg-gradient-to-r from-slate-100 via-slate-200 to-slate-400 bg-clip-text text-transparent">
                  OmniManga Sync
                </h1>
                {isIncognito ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                    <EyeOff className="w-3 h-3 mr-1" />
                    Incognito Active
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse mr-1.5" />
                    Live Reader
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <Globe className="w-3 h-3 text-amber-400" />
                <span className="font-mono text-amber-300/90 font-medium">{subdomain}</span>
              </div>
            </div>
          </div>

          {/* Expanding Search Bar (Expands smoothly to the right on focus) */}
          <div className="hidden md:flex relative flex-initial w-64 focus-within:w-full focus-within:max-w-lg transition-all duration-300 ease-out mx-2 sm:mx-4">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-amber-400 transition-colors" />
            <input
              type="text"
              placeholder="Search manhwa, manhua, manga, tags..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950/80 border border-slate-800 rounded-xl pl-9 pr-8 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/60 focus:bg-slate-950 shadow-md transition-all duration-300"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 hover:text-slate-100 bg-slate-800 hover:bg-slate-700 rounded-md px-1.5 py-0.5 transition-colors"
              >
                Clear
              </button>
            )}
          </div>


          {/* Action Buttons */}
          <div className="flex items-center gap-2.5">
            <button
              onClick={onToggleIncognito}
              title="Toggle Incognito Private Reading Mode (Zero history tracking)"
              className={`p-2 rounded-lg border transition-all ${
                isIncognito
                  ? 'bg-purple-500 text-slate-950 font-bold border-purple-400 shadow-md'
                  : 'bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-white border-slate-700'
              }`}
            >
              <EyeOff className="w-4 h-4" />
            </button>

            <button
              onClick={onOpenLocalReader}
              title="Open local CBZ, ZIP, or Image Folder Manga"
              className="p-2 rounded-lg bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-amber-400 border border-slate-700 transition-all hidden sm:block"
            >
              <FileArchive className="w-4 h-4 text-amber-400" />
            </button>

            <button
              onClick={onOpenAnalytics}
              title="View GitHub-style Reading Activity Heatmap & Analytics"
              className="p-2 rounded-lg bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-cyan-400 border border-slate-700 transition-all hidden sm:block"
            >
              <Calendar className="w-4 h-4 text-cyan-400" />
            </button>

            {activeProfile.role === 'admin' && (
              <button
                onClick={onOpenAdminPanel}
                title="Host & Administrator Command Panel (Manage users, privacy, and system DB)"
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-black rounded-lg bg-purple-500/20 text-purple-300 border border-purple-500/40 hover:bg-purple-500/30 transition-all shadow-md"
              >
                <Shield className="w-4 h-4 text-purple-400" />
                <span className="hidden sm:inline">Admin Panel</span>
              </button>
            )}

            <button
              onClick={onOpenAuthModal}
              title="Sign In or Register a new user account"
              className="px-3 py-2 text-xs font-bold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all hidden sm:block"
            >
              Sign In / Register
            </button>

            <button
              onClick={onOpenProfileModal}
              title={`User Profile: ${activeProfile.name} (${activeProfile.role === 'admin' ? 'Host/Admin' : 'Private User'})`}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg bg-amber-500/10 text-amber-300 border border-amber-500/30 hover:bg-amber-500/20 transition-all"
            >
              <span className="text-base">{activeProfile.avatar}</span>
              <span className="hidden sm:inline font-bold">{activeProfile.name}</span>
              {activeProfile.role === 'admin' && (
                <span className="px-1 py-0.2 text-[9px] font-black uppercase rounded bg-purple-500 text-slate-950 ml-1">
                  Admin
                </span>
              )}
            </button>

            <button
              onClick={onOpenSettingsModal}
              title="Settings, Duplicate Finder, DB Subdomain Sync, UI Themes"
              className="flex items-center gap-1.5 px-3 py-2 text-xs sm:text-sm font-semibold rounded-lg bg-slate-800/90 hover:bg-slate-800 text-slate-200 hover:text-amber-400 border border-slate-700 transition-all"
            >
              <Sliders className="w-4 h-4 text-amber-400" />
              <span className="hidden sm:inline">Settings</span>
            </button>



            <button
              onClick={onOpenAddModal}
              className="flex items-center gap-2 px-3.5 py-2 text-xs sm:text-sm font-semibold rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 shadow-md shadow-amber-500/10 transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              <span>Add Series</span>
            </button>
          </div>
        </div>


        {/* Mobile Search Bar */}
        <div className="md:hidden pb-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search titles, tags, alt names..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950/70 border border-slate-800 rounded-lg pl-9 pr-4 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
            />
          </div>
        </div>

        {/* Navigation Tabs Bar */}
        <div className="flex items-center gap-1 sm:gap-2 overflow-x-auto no-scrollbar py-2 border-t border-slate-800/80 text-xs sm:text-sm font-medium">
          <button
            onClick={() => setActiveTab('library')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg transition-all whitespace-nowrap ${
              activeTab === 'library'
                ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30 font-semibold shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            <span>My Library</span>
          </button>

          <button
            onClick={() => setActiveTab('browse')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg transition-all whitespace-nowrap ${
              activeTab === 'browse'
                ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30 font-semibold shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Compass className="w-4 h-4 text-cyan-400" />
            <span>Explore & Browse</span>
          </button>


          <button
            onClick={() => setActiveTab('reader')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg transition-all whitespace-nowrap ${
              activeTab === 'reader'
                ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30 font-semibold shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Play className="w-4 h-4 text-emerald-400 fill-emerald-400/20" />
            <span>Reading & Offline</span>
          </button>

          <button
            onClick={() => setActiveTab('tracker')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg transition-all whitespace-nowrap ${
              activeTab === 'tracker'
                ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30 font-semibold shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <BarChart3 className="w-4 h-4 text-cyan-400" />
            <span>Tracker & Sync</span>
          </button>

          <button
            onClick={() => setActiveTab('sources')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg transition-all whitespace-nowrap ${
              activeTab === 'sources'
                ? 'bg-purple-500/15 text-purple-400 border border-purple-500/30 font-semibold shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Globe className="w-4 h-4 text-purple-400" />
            <span>Sources</span>
          </button>

          <button
            onClick={() => setActiveTab('autoupdate')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg transition-all whitespace-nowrap relative ${
              activeTab === 'autoupdate'
                ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30 font-semibold shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Zap className="w-4 h-4 text-orange-400" />
            <span>Auto-Update Feed</span>
            {unreadCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-orange-500 text-slate-950 animate-pulse">
                +{unreadCount}
              </span>
            )}
          </button>

          <button
            onClick={onOpenSettingsModal}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-all whitespace-nowrap"
          >
            <Sliders className="w-4 h-4 text-purple-400" />
            <span>Settings & Tools</span>
          </button>
        </div>
      </div>
    </header>
  );
};

