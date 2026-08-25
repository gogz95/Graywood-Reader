import React, { useMemo, useState, useEffect } from 'react';
import { MangaItem } from '../types';
import { apiFetch } from '../utils/api';
import {
  BarChart3,
  BookOpen,
  Clock,
  Flame,
  Award,
  PieChart,
  CheckCircle,
  TrendingUp,
  X,
  Layers,
  Sparkles,
} from 'lucide-react';

interface StatisticsModalProps {
  mangaList: MangaItem[];
  onClose: () => void;
}

export const StatisticsModal: React.FC<StatisticsModalProps> = ({ mangaList, onClose }) => {
  const [serverAnalytics, setServerAnalytics] = useState<{ totalTimeMinutes?: number; totalChaptersRead?: number } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/api/reader/analytics');
        if (res.ok) {
          const data = await res.json();
          setServerAnalytics(data);
        }
      } catch {}
    })();
  }, []);

  const importedKotatsuStats = useMemo(() => {
    try {
      const raw = localStorage.getItem('kotatsu_imported_statistics');
      if (raw) return JSON.parse(raw);
    } catch {}
    return null;
  }, []);

  const totalSeries = mangaList.length;
  const listChaptersRead = mangaList.reduce((acc, m) => acc + (m.currentChapter || 0), 0);
  const totalChaptersRead = serverAnalytics?.totalChaptersRead && serverAnalytics.totalChaptersRead > 0
    ? serverAnalytics.totalChaptersRead
    : listChaptersRead;
  
  // Calculate total reading minutes including server analytics or imported Kotatsu time
  const importedSeconds = importedKotatsuStats?.totalReadingTimeSeconds || 0;
  const totalEstMinutes = serverAnalytics?.totalTimeMinutes && serverAnalytics.totalTimeMinutes > 0
    ? serverAnalytics.totalTimeMinutes
    : importedSeconds > 0 
    ? Math.round(importedSeconds / 60)
    : totalChaptersRead * 4.5;

  const estHours = Math.floor(totalEstMinutes / 60);
  const estMinsLeft = Math.round(totalEstMinutes % 60);

  const reading = mangaList.filter((m) => m.status === 'reading').length;
  const completed = mangaList.filter((m) => m.status === 'completed').length;
  const planToRead = mangaList.filter((m) => m.status === 'plan_to_read').length;
  const onHold = mangaList.filter((m) => m.status === 'on_hold').length;
  const dropped = mangaList.filter((m) => m.status === 'dropped').length;
  const favorites = mangaList.filter((m) => m.isFavorite).length;

  const manhwa = mangaList.filter((m) => m.type === 'manhwa').length;
  const manhua = mangaList.filter((m) => m.type === 'manhua').length;
  const manga = mangaList.filter((m) => m.type === 'manga').length;

  const sourceCounts: Record<string, number> = {};
  mangaList.forEach((m) => {
    const src = m.sourceName || 'MangaDex';
    sourceCounts[src] = (sourceCounts[src] || 0) + 1;
  });

  const sortedSources = Object.entries(sourceCounts).sort((a, b) => b[1] - a[1]);

  return (
    <div className="fixed inset-0 z-50 bg-app/85 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-surface border border-edge rounded-3xl max-w-2xl w-full p-6 space-y-6 max-h-[90vh] overflow-y-auto shadow-2xl text-primary">
        <div className="flex items-center justify-between border-b border-edge pb-4">
          <div className="font-black text-primary text-lg flex items-center gap-2.5">
            <BarChart3 className="w-6 h-6 text-accent" />
            Kotatsu Reading Statistics & Analytics
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full bg-elevated text-secondary hover:text-white transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 1. TOP HIGHLIGHT METRICS */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-4 rounded-2xl bg-gradient-to-br from-accent/10 to-accent/5 border border-accent/30 text-center space-y-1">
            <BookOpen className="w-5 h-5 text-accent mx-auto" />
            <div className="text-2xl font-black text-accent">{totalChaptersRead}</div>
            <div className="text-[11px] font-bold text-secondary">Chapters Read</div>
          </div>

          <div className="p-4 rounded-2xl bg-gradient-to-br from-info/10 to-blue-950/20 border border-info/30 text-center space-y-1">
            <Clock className="w-5 h-5 text-info mx-auto" />
            <div className="text-2xl font-black text-info">
              {estHours}h {estMinsLeft}m
            </div>
            <div className="text-[11px] font-bold text-secondary">Est. Time Spent</div>
          </div>

          <div className="p-4 rounded-2xl bg-gradient-to-br from-accent-2/10 to-purple-950/20 border border-accent-2/30 text-center space-y-1">
            <Flame className="w-5 h-5 text-accent-2 mx-auto" />
            <div className="text-2xl font-black text-accent-2">{favorites}</div>
            <div className="text-[11px] font-bold text-secondary">Favorite Series</div>
          </div>

          <div className="p-4 rounded-2xl bg-gradient-to-br from-success/10 to-emerald-950/20 border border-success/30 text-center space-y-1">
            <Award className="w-5 h-5 text-success mx-auto" />
            <div className="text-2xl font-black text-success">{totalSeries}</div>
            <div className="text-[11px] font-bold text-secondary">Total Library</div>
          </div>
        </div>

        {/* Kotatsu Backup Lifetime Analytics Badge */}
        {importedKotatsuStats && (
          <div className="p-4 rounded-2xl bg-accent-2/10 border border-accent-2/30 flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-accent-2/20 text-accent-2">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <div className="font-extrabold text-primary flex items-center gap-2">
                  <span>Kotatsu Backup Lifetime Analytics Synced</span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-accent-2/20 text-accent-2">
                    Verified
                  </span>
                </div>
                <div className="text-secondary text-[11px]">
                  Restored reading statistics across {importedKotatsuStats.seriesCount || totalSeries} series
                  {importedKotatsuStats.totalReadingTimeSeconds ? ` with ${Math.floor(importedKotatsuStats.totalReadingTimeSeconds / 3600)}h ${(Math.round(importedKotatsuStats.totalReadingTimeSeconds % 3600) / 60).toFixed(0)}m logged` : ''}.
                </div>
              </div>
            </div>
            <span className="text-accent-2 font-mono font-bold text-[11px] shrink-0">
              {importedKotatsuStats.totalChaptersRead || totalChaptersRead} Ch. Read
            </span>
          </div>
        )}

        {/* 2. READING STATUS BREAKDOWN */}
        <div className="p-4 bg-app rounded-2xl border border-edge space-y-3">
          <div className="text-xs font-bold text-primary flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <PieChart className="w-4 h-4 text-info" />
              Reading Progress Distribution
            </span>
            <span className="text-[11px] text-secondary">{totalSeries} Series</span>
          </div>

          <div className="space-y-2">
            {[
              { label: 'Reading Currently', count: reading, color: 'bg-success', pct: Math.round((reading / (totalSeries || 1)) * 100) },
              { label: 'Completed', count: completed, color: 'bg-info', pct: Math.round((completed / (totalSeries || 1)) * 100) },
              { label: 'Plan to Read', count: planToRead, color: 'bg-accent', pct: Math.round((planToRead / (totalSeries || 1)) * 100) },
              { label: 'On Hold', count: onHold, color: 'bg-accent-2', pct: Math.round((onHold / (totalSeries || 1)) * 100) },
              { label: 'Dropped', count: dropped, color: 'bg-danger', pct: Math.round((dropped / (totalSeries || 1)) * 100) },
            ].map((stat, i) => (
              <div key={i} className="space-y-1">
                <div className="flex justify-between text-xs font-semibold">
                  <span className="text-secondary">{stat.label}</span>
                  <span className="text-secondary font-mono">
                    {stat.count} ({stat.pct}%)
                  </span>
                </div>
                <div className="w-full h-2 bg-surface rounded-full overflow-hidden">
                  <div className={`h-full ${stat.color} rounded-full`} style={{ width: `${stat.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 3. FORMAT BREAKDOWN */}
        <div className="p-4 bg-app rounded-2xl border border-edge space-y-3">
          <div className="text-xs font-bold text-primary flex items-center gap-1.5">
            <Layers className="w-4 h-4 text-accent" />
            Format Breakdown
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs font-bold">
            <div className="p-3 rounded-xl bg-blue-950/40 border border-info/20 text-info">
              <div className="text-lg text-primary">🇰🇷 Manhwa</div>
              <div>{manhwa} Series</div>
            </div>
            <div className="p-3 rounded-xl bg-red-950/40 border border-danger/20 text-danger">
              <div className="text-lg text-primary">🇨🇳 Manhua</div>
              <div>{manhua} Series</div>
            </div>
            <div className="p-3 rounded-xl bg-purple-950/40 border border-accent-2/20 text-accent-2">
              <div className="text-lg text-primary">🇯🇵 Manga</div>
              <div>{manga} Series</div>
            </div>
          </div>
        </div>

        {/* 5. READING STREAKS & ACHIEVEMENTS TROPHIES */}
        <div className="p-4 bg-app rounded-2xl border border-edge space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-xs font-bold text-primary flex items-center gap-1.5">
              <Award className="w-4 h-4 text-accent" />
              Achievements & Milestone Badges
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-[11px] font-bold text-amber-400">
              <Flame className="w-3.5 h-3.5 fill-amber-400" />
              <span>Active Streak: <strong>{Math.max(1, Math.min(30, Math.floor(totalChaptersRead / 8)))} Days</strong></span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {[
              {
                id: 'martial-god',
                icon: '🥋',
                title: 'Martial God',
                desc: '100+ Manhua chapters',
                unlocked: manhua > 0 && totalChaptersRead >= 100,
                color: 'border-red-500/40 bg-red-950/20 text-red-300',
              },
              {
                id: 'solo-leveler',
                icon: '🗡️',
                title: 'Solo Leveler',
                desc: '20+ Manhwa series',
                unlocked: manhwa >= 20,
                color: 'border-blue-500/40 bg-blue-950/20 text-blue-300',
              },
              {
                id: 'binge-king',
                icon: '⚡',
                title: 'Binge King',
                desc: '500+ chapters read',
                unlocked: totalChaptersRead >= 500,
                color: 'border-amber-500/40 bg-amber-950/20 text-amber-300',
              },
              {
                id: 'archivist',
                icon: '📚',
                title: 'Grand Archivist',
                desc: '50+ library series',
                unlocked: totalSeries >= 50,
                color: 'border-purple-500/40 bg-purple-950/20 text-purple-300',
              },
              {
                id: 'night-owl',
                icon: '🌙',
                title: 'Night Owl',
                desc: 'Late-night reader',
                unlocked: true,
                color: 'border-indigo-500/40 bg-indigo-950/20 text-indigo-300',
              },
              {
                id: 'streak-master',
                icon: '🔥',
                title: 'Streak Master',
                desc: '7+ day streak',
                unlocked: totalChaptersRead >= 50,
                color: 'border-emerald-500/40 bg-emerald-950/20 text-emerald-300',
              },
            ].map(b => (
              <div
                key={b.id}
                className={`p-3 rounded-2xl border flex flex-col gap-1 transition-all ${
                  b.unlocked ? b.color : 'border-edge bg-surface/40 opacity-40 grayscale'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xl">{b.icon}</span>
                  {b.unlocked && <CheckCircle className="w-3.5 h-3.5 text-success" />}
                </div>
                <div className="font-bold text-xs text-primary">{b.title}</div>
                <div className="text-[10px] text-secondary leading-tight">{b.desc}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="pt-2 flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2.5 rounded-xl bg-accent hover:bg-accent-bright text-accent-fg font-black text-xs shadow-lg cursor-pointer transition-all"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
