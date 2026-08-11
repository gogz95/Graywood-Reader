import React from 'react';
import { MangaItem } from '../types';
import { X, Flame, Calendar, Clock, BookOpen, Award, TrendingUp, Sparkles } from 'lucide-react';

interface AnalyticsModalProps {
  mangaList: MangaItem[];
  onClose: () => void;
}

export const AnalyticsModal: React.FC<AnalyticsModalProps> = ({ mangaList, onClose }) => {
  const totalRead = mangaList.reduce((acc, m) => acc + m.currentChapter, 0);

  // Generate 52 weeks (364 days) mock GitHub-style activity heat map
  const daysList = Array.from({ length: 112 }, (_, i) => {
    const daysAgo = 111 - i;
    const date = new Date(Date.now() - daysAgo * 86400 * 1000).toISOString().substring(0, 10);
    // Pseudorandom activity level based on index
    const level = (i % 7 === 0 || i % 5 === 0) ? (i % 4) + 1 : (i % 3 === 0) ? 1 : 0;
    return { date, level };
  });

  return (
    <div className="fixed inset-0 z-50 bg-app/85 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-surface border border-edge rounded-2xl max-w-3xl w-full p-6 space-y-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-edge pb-3">
          <div className="font-black text-primary text-base flex items-center gap-2">
            <Calendar className="w-5 h-5 text-accent" />
            Reading Analytics & GitHub-Style Activity Heatmap
          </div>
          <button onClick={onClose} className="text-secondary hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Streak Metrics Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="p-4 bg-app rounded-xl border border-edge space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-secondary">
              <Flame className="w-4 h-4 text-accent-2 fill-accent-2/30" />
              Current Streak
            </div>
            <div className="text-2xl font-black text-accent font-mono">14 Days 🔥</div>
            <div className="text-[10px] text-muted">Active daily reader</div>
          </div>

          <div className="p-4 bg-app rounded-xl border border-edge space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-secondary">
              <Award className="w-4 h-4 text-info" />
              Longest Streak
            </div>
            <div className="text-2xl font-black text-info font-mono">28 Days</div>
            <div className="text-[10px] text-muted">Personal best record</div>
          </div>

          <div className="p-4 bg-app rounded-xl border border-edge space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-secondary">
              <BookOpen className="w-4 h-4 text-success" />
              Chapters Read
            </div>
            <div className="text-2xl font-black text-success font-mono">{totalRead}</div>
            <div className="text-[10px] text-muted">Across all series</div>
          </div>

          <div className="p-4 bg-app rounded-xl border border-edge space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-secondary">
              <Clock className="w-4 h-4 text-accent-2" />
              Time Spent
            </div>
            <div className="text-2xl font-black text-accent-2 font-mono">42.5 hrs</div>
            <div className="text-[10px] text-muted">Estimated reading time</div>
          </div>
        </div>

        {/* GitHub-Style Contribution Heatmap Calendar */}
        <div className="p-4 bg-app rounded-xl border border-edge/80 space-y-3">
          <div className="flex items-center justify-between text-xs font-bold text-primary">
            <span>Reading Activity Heatmap (Last 16 Weeks)</span>
            <span className="text-[10px] text-accent font-mono">148 Chapters in 2026</span>
          </div>

          {/* Grid Grid */}
          <div
            className="gap-1.5 p-2 bg-surface rounded-lg overflow-x-auto grid"
            style={{ gridTemplateColumns: 'repeat(16, minmax(0, 1fr))' }}
          >
            {daysList.map((d, idx) => (

              <div
                key={idx}
                title={`${d.date}: Level ${d.level} activity`}
                className={`w-3.5 h-3.5 rounded-sm transition-all hover:scale-125 ${
                  d.level === 0
                    ? 'bg-elevated'
                    : d.level === 1
                    ? 'bg-accent/25'
                    : d.level === 2
                    ? 'bg-accent-deep'
                    : d.level === 3
                    ? 'bg-accent'
                    : 'bg-accent-bright shadow-md shadow-accent/50'
                }`}
              />
            ))}
          </div>

          <div className="flex items-center justify-end gap-2 text-[10px] text-secondary font-semibold pt-1">
            <span>Less</span>
            <div className="w-3 h-3 bg-elevated rounded-sm" />
            <div className="w-3 h-3 bg-accent/25 rounded-sm" />
            <div className="w-3 h-3 bg-accent-deep rounded-sm" />
            <div className="w-3 h-3 bg-accent rounded-sm" />
            <div className="w-3 h-3 bg-accent-bright rounded-sm" />
            <span>More</span>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-edge pt-4">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-elevated hover:bg-elevated text-primary font-bold text-xs"
          >
            Close Analytics
          </button>
        </div>
      </div>
    </div>
  );
};
