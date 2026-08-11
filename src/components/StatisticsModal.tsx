import React, { useMemo } from 'react';
import { MangaItem } from '../types';
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
  const totalSeries = mangaList.length;
  const totalChaptersRead = mangaList.reduce((acc, m) => acc + (m.currentChapter || 0), 0);
  const totalEstMinutes = totalChaptersRead * 4.5;
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

        {/* 4. TOP SOURCES BREAKDOWN */}
        <div className="p-4 bg-app rounded-2xl border border-edge space-y-3">
          <div className="text-xs font-bold text-primary flex items-center gap-1.5">
            <TrendingUp className="w-4 h-4 text-success" />
            Top Scanlation Sources Used
          </div>
          <div className="space-y-2">
            {sortedSources.slice(0, 5).map(([source, count], idx) => (
              <div key={idx} className="flex items-center justify-between p-2.5 rounded-xl bg-surface border border-edge text-xs">
                <span className="font-bold text-primary">{source}</span>
                <span className="px-2 py-0.5 rounded-md bg-accent/10 text-accent font-mono font-bold">
                  {count} series
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="pt-2 flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2.5 rounded-xl bg-accent hover:bg-accent-bright text-accent-fg font-black text-xs shadow-lg"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
