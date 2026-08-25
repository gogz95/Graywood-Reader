import React, { useState } from 'react';
import { apiFetch } from '../../utils/api';
import { AppSettings, UserProfile } from '../../types';
import {
  Database,
  RefreshCw,
  Sparkles,
  BookOpen,
  ExternalLink,
  Check,
} from 'lucide-react';

interface SourcesTrackersTabProps {
  formData: AppSettings;
  setFormData: React.Dispatch<React.SetStateAction<AppSettings>>;
  isAdmin: boolean;
  activeProfile?: UserProfile;
  renderAdminLockNotice: (feature: string) => React.ReactNode;
  onOpenBulkScrapeModal: () => void;
  onRefreshData: () => void;
}

export const SourcesTrackersTab: React.FC<SourcesTrackersTabProps> = ({
  formData,
  setFormData,
  isAdmin,
  renderAdminLockNotice,
  onOpenBulkScrapeModal,
}) => {
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);
  const [bulkRefreshStatus, setBulkRefreshStatus] = useState<string | null>(null);

  const handleRefreshAllMetadata = async () => {
    setIsRefreshingAll(true);
    setBulkRefreshStatus(null);
    try {
      const res = await apiFetch('/api/manga/refresh-all-metadata', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setBulkRefreshStatus(`✓ Metadata refresh queued: ${data.message || 'Processing series in background'}`);
      } else {
        setBulkRefreshStatus(`❌ Refresh failed: ${data.error}`);
      }
    } catch (err: any) {
      setBulkRefreshStatus(`❌ Refresh error: ${err.message}`);
    } finally {
      setIsRefreshingAll(false);
    }
  };

  if (!isAdmin) {
    return <>{renderAdminLockNotice('Sources & Anti-DDoS Network')}</>;
  }

  return (
    <div className="space-y-6 text-xs sm:text-sm">
      {/* Multi-Source Bulk Library Harvester */}
      <div className="p-5 bg-app rounded-2xl border border-accent-2/30 space-y-3 shadow-sm">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h4 className="font-extrabold text-primary flex items-center gap-2 text-sm sm:text-base">
                <Database className="w-4 h-4 text-accent-2" />
                Multi-Source Bulk Library Harvester
              </h4>
              <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-accent-2/15 text-accent-2 border border-accent-2/30">
                Admin Harvester
              </span>
            </div>
            <p className="text-xs text-secondary">
              Crawl, scrape, and populate your library in bulk across all enabled Kotatsu sources with automated metadata enrichment and duplicate merging.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenBulkScrapeModal}
            className="px-4 sm:px-5 py-2.5 sm:py-3 rounded-xl bg-gradient-to-r from-accent to-accent-2 hover:opacity-95 text-accent-fg font-black text-xs sm:text-sm flex items-center gap-2 shadow-lg shadow-accent/20 transition-all whitespace-nowrap active:scale-95 cursor-pointer"
          >
            <Database className="w-4 h-4" />
            <span>Build Library from Sources</span>
          </button>
        </div>
      </div>

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
            className="px-4 py-2.5 rounded-xl bg-info hover:bg-info disabled:opacity-50 text-white font-bold text-xs flex items-center gap-2 shadow-lg shadow-info/20 transition-all whitespace-nowrap cursor-pointer"
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
  );
};
