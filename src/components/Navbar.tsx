import React, { useState } from 'react';
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
  Bug,
  MoreVertical,
  X,
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
  isHostComputer?: boolean;
  onOpenProfileModal: () => void;
  onOpenAuthModal: () => void;
  onOpenAdminPanel: () => void;
  onOpenSubmitBugModal?: () => void;
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
  isHostComputer = true,
  onOpenProfileModal,
  onOpenAuthModal,
  onOpenAdminPanel,
  onOpenSubmitBugModal,
}) => {
  const [mobileQuickMenuOpen, setMobileQuickMenuOpen] = useState(false);

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


          {/* Action Buttons (Desktop) */}
          <div className="hidden md:flex items-center gap-2">
            <button
              onClick={onToggleIncognito}
              title="Toggle Incognito Private Reading Mode"
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
              className="p-2 rounded-lg bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-amber-400 border border-slate-700 transition-all"
            >
              <FileArchive className="w-4 h-4 text-amber-400" />
            </button>

            <button
              onClick={onOpenAnalytics}
              title="View Reading Activity Heatmap"
              className="p-2 rounded-lg bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-cyan-400 border border-slate-700 transition-all"
            >
              <Calendar className="w-4 h-4 text-cyan-400" />
            </button>

            {activeProfile.role === 'admin' && isHostComputer && (
              <button
                onClick={onOpenAdminPanel}
                title="Host Admin Panel: Promote, Demote, or Remove User Accounts"
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg bg-purple-500/15 text-purple-300 border border-purple-500/30 hover:bg-purple-500/25 transition-all"
              >
                <Shield className="w-4 h-4 text-purple-400" />
                <span>Admin Panel</span>
              </button>
            )}

            <button
              onClick={onOpenProfileModal}
              title={`User Profile: ${activeProfile.name}`}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg bg-amber-500/10 text-amber-300 border border-amber-500/30 hover:bg-amber-500/20 transition-all"
            >
              <span className="text-base">{activeProfile.avatar}</span>
              <span className="font-bold">{activeProfile.name}</span>
              {activeProfile.role === 'admin' && (
                <span className="px-1 py-0.2 text-[9px] font-black uppercase rounded bg-purple-500 text-slate-950 ml-1">
                  Admin
                </span>
              )}
            </button>

            <button
              onClick={onOpenSettingsModal}
              title="Settings & Tools"
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-slate-800/90 hover:bg-slate-800 text-slate-200 hover:text-amber-400 border border-slate-700 transition-all"
            >
              <Sliders className="w-4 h-4 text-amber-400" />
              <span>Settings</span>
            </button>

            {onOpenSubmitBugModal && (
              <button
                onClick={onOpenSubmitBugModal}
                title="Report a bug"
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 transition-all"
              >
                <Bug className="w-4 h-4 text-red-400" />
                <span>Submit Bug</span>
              </button>
            )}

            <button
              onClick={onOpenAddModal}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 shadow-md transition-all active:scale-95"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              <span>Add Series</span>
            </button>
          </div>

          {/* Action Buttons (Mobile Compact <768px) */}
          <div className="flex md:hidden items-center gap-1.5">
            <button
              onClick={onOpenAddModal}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-black rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 shadow-md active:scale-95"
            >
              <Plus className="w-3.5 h-3.5 stroke-[3]" />
              <span>Add</span>
            </button>

            <button
              onClick={onOpenProfileModal}
              className="flex items-center gap-1 px-2 py-1.5 text-xs font-bold rounded-lg bg-amber-500/15 text-amber-300 border border-amber-500/30"
            >
              <span className="text-sm">{activeProfile.avatar}</span>
              <span className="max-w-[70px] truncate">{activeProfile.name}</span>
            </button>

            <button
              onClick={() => setMobileQuickMenuOpen(!mobileQuickMenuOpen)}
              className="p-2 rounded-lg bg-slate-800 text-slate-200 border border-slate-700 active:scale-95"
              title="Toggle Mobile Menu"
            >
              {mobileQuickMenuOpen ? <X className="w-4 h-4 text-amber-400" /> : <MoreVertical className="w-4 h-4 text-slate-300" />}
            </button>
          </div>
        </div>

        {/* Mobile Quick Action Drawer Overlay */}
        {mobileQuickMenuOpen && (
          <div className="md:hidden p-3 bg-slate-950 border-b border-slate-800 grid grid-cols-2 gap-2 text-xs font-bold animate-in fade-in slide-in-from-top-2">
            <button
              onClick={() => {
                onToggleIncognito();
                setMobileQuickMenuOpen(false);
              }}
              className={`p-2.5 rounded-xl border flex items-center gap-2 ${
                isIncognito ? 'bg-purple-500/20 text-purple-300 border-purple-500/40' : 'bg-slate-900 text-slate-300 border-slate-800'
              }`}
            >
              <EyeOff className="w-4 h-4 text-purple-400" />
              <span>{isIncognito ? 'Incognito ON' : 'Incognito OFF'}</span>
            </button>

            <button
              onClick={() => {
                onOpenLocalReader();
                setMobileQuickMenuOpen(false);
              }}
              className="p-2.5 rounded-xl bg-slate-900 text-slate-300 border border-slate-800 flex items-center gap-2"
            >
              <FileArchive className="w-4 h-4 text-amber-400" />
              <span>Local CBZ Reader</span>
            </button>

            <button
              onClick={() => {
                onOpenAnalytics();
                setMobileQuickMenuOpen(false);
              }}
              className="p-2.5 rounded-xl bg-slate-900 text-slate-300 border border-slate-800 flex items-center gap-2"
            >
              <Calendar className="w-4 h-4 text-cyan-400" />
              <span>Activity Heatmap</span>
            </button>

            {onOpenSubmitBugModal && (
              <button
                onClick={() => {
                  onOpenSubmitBugModal();
                  setMobileQuickMenuOpen(false);
                }}
                className="p-2.5 rounded-xl bg-red-500/10 text-red-400 border border-red-500/30 flex items-center gap-2"
              >
                <Bug className="w-4 h-4 text-red-400" />
                <span>Submit Bug</span>
              </button>
            )}

            {activeProfile.role === 'admin' && isHostComputer && (
              <button
                onClick={() => {
                  onOpenAdminPanel();
                  setMobileQuickMenuOpen(false);
                }}
                className="p-2.5 rounded-xl bg-purple-500/20 text-purple-300 border border-purple-500/40 flex items-center gap-2 col-span-2"
              >
                <Shield className="w-4 h-4 text-purple-400" />
                <span>Host Admin Panel</span>
              </button>
            )}
          </div>
        )}

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

        {/* Navigation Tabs Bar (Desktop) */}
        <div className="hidden md:flex items-center gap-1 sm:gap-2 overflow-x-auto no-scrollbar py-2 border-t border-slate-800/80 text-xs sm:text-sm font-medium">
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

      {/* Mobile Floating Bottom Navigation Bar (Visible <768px) */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-slate-900/95 border-t border-slate-800/90 backdrop-blur-xl px-2 py-1.5 flex items-center justify-around shadow-2xl">
        <button
          onClick={() => setActiveTab('library')}
          className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl transition-all ${
            activeTab === 'library' ? 'text-amber-400 font-bold' : 'text-slate-400'
          }`}
        >
          <BookOpen className="w-5 h-5" />
          <span className="text-[10px]">Library</span>
        </button>

        <button
          onClick={() => setActiveTab('browse')}
          className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl transition-all ${
            activeTab === 'browse' ? 'text-amber-400 font-bold' : 'text-slate-400'
          }`}
        >
          <Compass className="w-5 h-5 text-cyan-400" />
          <span className="text-[10px]">Explore</span>
        </button>

        <button
          onClick={() => setActiveTab('sources')}
          className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl transition-all ${
            activeTab === 'sources' ? 'text-purple-400 font-bold' : 'text-slate-400'
          }`}
        >
          <Globe className="w-5 h-5 text-purple-400" />
          <span className="text-[10px]">Sources</span>
        </button>

        <button
          onClick={() => setActiveTab('autoupdate')}
          className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl transition-all relative ${
            activeTab === 'autoupdate' ? 'text-amber-400 font-bold' : 'text-slate-400'
          }`}
        >
          <Zap className="w-5 h-5 text-orange-400" />
          <span className="text-[10px]">Feed</span>
          {unreadCount > 0 && (
            <span className="absolute top-0 right-1 w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
          )}
        </button>

        <button
          onClick={onOpenSettingsModal}
          className="flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl text-slate-400 hover:text-amber-400 transition-all"
        >
          <Sliders className="w-5 h-5 text-slate-400" />
          <span className="text-[10px]">Settings</span>
        </button>
      </nav>
    </header>
  );
};

