import React from 'react';
import { AutoUpdateLog, DatabaseSyncConfig, MangaItem } from '../types';
import {
  Zap,
  RefreshCw,
  Clock,
  ExternalLink,
  CheckCircle,
  AlertCircle,
  Globe,
  Rss,
  Play,
  ShieldCheck,
} from 'lucide-react';

interface AutoUpdateViewProps {
  logs: AutoUpdateLog[];
  config?: DatabaseSyncConfig;
  mangaList: MangaItem[];
  onRunAutoUpdate?: () => void;
  onRunUpdate?: () => void;
  isUpdating: boolean;
  isAdmin?: boolean;
  onOpenReader?: (manga: MangaItem, chapterNumber?: number) => void;
}

export const AutoUpdateView: React.FC<AutoUpdateViewProps> = ({
  logs,
  config = { autoUpdateIntervalMinutes: 60 } as DatabaseSyncConfig,
  mangaList,
  onRunAutoUpdate,
  onRunUpdate,
  isUpdating,
  isAdmin = false,
  onOpenReader,
}) => {
  const autoTrackedCount = mangaList.filter((m) => m.autoUpdateEnabled).length;
  const handleTriggerUpdate = onRunAutoUpdate || onRunUpdate || (() => {});

  // Filter logs: ONLY show updates for series the client has read or favorited (present in user's mangaList)
  const userMangaIds = new Set(mangaList.map((m) => m.id));
  const userMangaTitles = new Set(mangaList.map((m) => m.title.toLowerCase().trim()));
  const filteredLogs = logs.filter(
    (log) => userMangaIds.has(log.mangaId) || userMangaTitles.has(log.mangaTitle.toLowerCase().trim())
  );

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-surface via-surface to-accent/15 border border-edge rounded-2xl p-6 shadow-xl relative overflow-hidden">
        <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-accent/10 via-transparent to-transparent pointer-events-none" />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div className="space-y-2 max-w-xl">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-accent-2/10 text-accent-2 border border-accent-2/20 text-xs font-bold">
              <Zap className="w-3.5 h-3.5" />
              Automated Release Monitor & Web Crawler
            </div>
            <h2 className="text-2xl font-black text-primary tracking-tight">
              Auto-Updating Chapter Scanner
            </h2>
            <p className="text-sm text-secondary leading-relaxed">
              Monitors active Manhwa and Manhua releases across connected OpenAPI sources and scanlation aggregators. Automatically updates latest chapter numbers and notifies you immediately.
            </p>
          </div>

          {isAdmin && (
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <button
                onClick={handleTriggerUpdate}
                disabled={isUpdating}
                className={`px-5 py-3 rounded-xl font-bold text-sm shadow-lg flex items-center justify-center gap-2.5 transition-all ${isUpdating
                    ? 'bg-elevated text-accent border border-accent/30'
                    : 'bg-gradient-to-r from-accent-2 to-accent hover:from-accent-2 hover:to-accent-bright text-accent-fg hover:scale-[1.02] active:scale-[0.98]'
                  }`}
              >
                <RefreshCw className={`w-5 h-5 ${isUpdating ? 'animate-spin' : ''}`} />
                <span>{isUpdating ? 'Scanning Release Feeds...' : 'Run Auto-Crawler Now'}</span>
              </button>
            </div>
          )}
        </div>

        {/* Status Pills */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-6 border-t border-edge/80 text-xs font-medium text-secondary">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-accent" />
            <span>Frequency: Every {config.autoUpdateIntervalMinutes}m</span>
          </div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-success" />
            <span>Monitored Series: {autoTrackedCount} / {mangaList.length}</span>
          </div>
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-info" />
            <span>2.5s DDoS Request Spacing</span>
          </div>
          <div className="flex items-center gap-2">
            <Rss className="w-4 h-4 text-accent-2" />
            <span>Last Sync: {config.lastSyncTime ? new Date(config.lastSyncTime).toLocaleTimeString() : 'Just now'}</span>
          </div>
        </div>
      </div>

      {/* Main Grid: Release Logs & Monitored Sources */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Recent Chapter Update Logs (2 cols) */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-primary flex items-center gap-2">
              <Zap className="w-4 h-4 text-accent-2" />
              Latest Chapter Release Logs (Your Read & Favorited Series)
            </h3>
            <span className="text-xs text-secondary font-mono">{filteredLogs.length} Logged Updates</span>
          </div>

          {filteredLogs.length === 0 ? (
            <div className="bg-surface border border-edge rounded-xl p-8 text-center text-secondary space-y-2">
              <CheckCircle className="w-8 h-8 text-muted mx-auto" />
              <p>No chapter updates detected for your read or favorited series yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredLogs.map((log) => (
                <div
                  key={log.id}
                  className="bg-surface border border-edge/80 hover:border-edge-strong rounded-xl p-4 flex items-center justify-between gap-4 transition-all"
                >
                  <div className="flex items-center gap-3.5">
                    <div className="p-2.5 rounded-lg bg-accent-2/10 text-accent-2 border border-accent-2/20 font-bold text-sm">
                      +{log.newChapter - log.previousChapter}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-bold text-primary">{log.mangaTitle}</h4>
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-bold uppercase bg-elevated text-secondary">
                          {log.type === 'manga' ? '🇯🇵 Manga' : log.type === 'manhwa' ? '🇰🇷 Manhwa' : log.type === 'novel' ? '📖 Novel' : '🇨🇳 Manhua'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-secondary mt-0.5">
                        <span className="text-accent font-semibold">
                          Ch. {log.previousChapter} → Ch. {log.newChapter}
                        </span>
                        <span>•</span>
                        <span>Source: {log.source}</span>
                      </div>
                    </div>
                  </div>

                  <div className="text-right text-xs text-muted font-mono">
                    {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Column: Active Web Crawlers & Series Toggle List */}
        <div className="space-y-6">
          {/* Active OpenAPI / Scraper Feeds */}
          <div className="bg-surface border border-edge rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-bold text-primary flex items-center gap-2">
              <Globe className="w-4 h-4 text-accent" />
              Connected OpenAPI & Web Feeds
            </h3>
            <div className="space-y-2 text-xs">
              {config.sources.map((src, idx) => (
                <div
                  key={idx}
                  className="p-2.5 rounded-lg bg-app border border-edge/80 flex items-center justify-between"
                >
                  <div className="flex items-center gap-2 font-medium text-secondary">
                    <span className="w-2 h-2 rounded-full bg-success" />
                    <span>{src}</span>
                  </div>
                  <span className="text-[10px] text-success font-mono font-bold bg-success/10 px-2 py-0.5 rounded border border-success/20">
                    Active
                  </span>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};
