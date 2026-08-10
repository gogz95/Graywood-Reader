import React from 'react';
import { MangaItem } from '../types';
import { Shield, Sparkles, CheckCircle, BarChart3, TrendingUp, Layers, RefreshCw } from 'lucide-react';

interface TrackerViewProps {
  mangaList: MangaItem[];
}

export const TrackerView: React.FC<TrackerViewProps> = ({ mangaList }) => {
  const totalChaptersRead = mangaList.reduce((acc, m) => acc + m.currentChapter, 0);
  const manhwaCount = mangaList.filter((m) => m.type === 'manhwa').length;
  const manhuaCount = mangaList.filter((m) => m.type === 'manhua').length;
  const mangaCount = mangaList.filter((m) => m.type === 'manga').length;

  const completedCount = mangaList.filter((m) => m.status === 'completed').length;
  const readingCount = mangaList.filter((m) => m.status === 'reading').length;
  const planCount = mangaList.filter((m) => m.status === 'plan_to_read').length;

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-emerald-500/10 via-cyan-500/10 to-blue-500/10 border border-emerald-500/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-emerald-500 text-slate-950">
              TRACKER & SYNC
            </span>
            <span className="text-xs text-slate-400 font-mono">Live AniList & MangaDex Metrics</span>
          </div>
          <h2 className="text-xl font-black text-slate-100">Reading Metrics & Account Sync</h2>
          <p className="text-xs text-slate-400">
            Track reading statistics, categories distribution, and external account sync states.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-3 py-1.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-bold flex items-center gap-1.5">
            <CheckCircle className="w-4 h-4" />
            <span>AniList Synced</span>
          </span>
          <span className="px-3 py-1.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 text-xs font-bold flex items-center gap-1.5">
            <CheckCircle className="w-4 h-4" />
            <span>MangaDex Connected</span>
          </span>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl space-y-1">
          <div className="text-xs text-slate-400 font-semibold">Total Chapters Read</div>
          <div className="text-2xl font-black text-amber-400 font-mono">{totalChaptersRead}</div>
          <div className="text-[11px] text-slate-500">Across all tracked series</div>
        </div>

        <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl space-y-1">
          <div className="text-xs text-slate-400 font-semibold">Currently Reading</div>
          <div className="text-2xl font-black text-cyan-400 font-mono">{readingCount}</div>
          <div className="text-[11px] text-slate-500">Active progress</div>
        </div>

        <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl space-y-1">
          <div className="text-xs text-slate-400 font-semibold">Completed Series</div>
          <div className="text-2xl font-black text-emerald-400 font-mono">{completedCount}</div>
          <div className="text-[11px] text-slate-500">Finished completely</div>
        </div>

        <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl space-y-1">
          <div className="text-xs text-slate-400 font-semibold">Plan to Read</div>
          <div className="text-2xl font-black text-purple-400 font-mono">{planCount}</div>
          <div className="text-[11px] text-slate-500">In your backlog</div>
        </div>
      </div>

      {/* Category Breakdown: Manhwa vs Manhua vs Japanese Manga */}
      <div className="p-6 bg-slate-900 border border-slate-800 rounded-2xl space-y-4">
        <h3 className="text-sm font-extrabold text-slate-200 flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-cyan-400" />
          Series Distribution by Origin Category
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-4 bg-slate-950 border border-slate-800/80 rounded-xl space-y-2">
            <div className="flex justify-between items-center text-xs font-bold text-slate-300">
              <span>🇰🇷 Korean Manhwa</span>
              <span className="text-amber-400 font-mono">{manhwaCount} Series</span>
            </div>
            <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
              <div
                className="bg-amber-500 h-full rounded-full"
                style={{ width: `${Math.min(100, (manhwaCount / mangaList.length) * 100)}%` }}
              />
            </div>
          </div>

          <div className="p-4 bg-slate-950 border border-slate-800/80 rounded-xl space-y-2">
            <div className="flex justify-between items-center text-xs font-bold text-slate-300">
              <span>🇨🇳 Chinese Manhua</span>
              <span className="text-red-400 font-mono">{manhuaCount} Series</span>
            </div>
            <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
              <div
                className="bg-red-500 h-full rounded-full"
                style={{ width: `${Math.min(100, (manhuaCount / mangaList.length) * 100)}%` }}
              />
            </div>
          </div>

          <div className="p-4 bg-slate-950 border border-slate-800/80 rounded-xl space-y-2">
            <div className="flex justify-between items-center text-xs font-bold text-slate-300">
              <span>🇯🇵 Japanese Manga</span>
              <span className="text-cyan-400 font-mono">{mangaCount} Series</span>
            </div>
            <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
              <div
                className="bg-cyan-500 h-full rounded-full"
                style={{ width: `${Math.min(100, (mangaCount / mangaList.length) * 100)}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
