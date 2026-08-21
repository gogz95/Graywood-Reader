import React, { useEffect, useMemo, useState } from 'react';
import { MangaItem, ReadingAnalytics, DailyReadingActivity } from '../types';
import { apiFetch } from '../utils/api';
import { X, Flame, Calendar, Clock, BookOpen, Award, Loader2 } from 'lucide-react';

interface AnalyticsModalProps {
  mangaList: MangaItem[];
  onClose: () => void;
}

function emptyAnalytics(fallbackChapters: number): ReadingAnalytics {
  return {
    currentStreakDays: 0,
    longestStreakDays: 0,
    totalChaptersRead: fallbackChapters,
    totalTimeMinutes: 0,
    favoriteGenre: '',
    activities: [],
  };
}

function buildHeatmapDays(activities: DailyReadingActivity[], days = 112) {
  const byDate = new Map(activities.map((a) => [a.date, a]));
  return Array.from({ length: days }, (_, i) => {
    const daysAgo = days - 1 - i;
    const date = new Date(Date.now() - daysAgo * 86400 * 1000).toISOString().substring(0, 10);
    const row = byDate.get(date);
    const chaptersRead = row?.chaptersRead || 0;
    const level = row?.level ?? (chaptersRead <= 0 ? 0 : Math.min(4, chaptersRead));
    return { date, level, chaptersRead };
  });
}

export const AnalyticsModal: React.FC<AnalyticsModalProps> = React.memo(({ mangaList, onClose }) => {
  const libraryChapters = useMemo(
    () => mangaList.reduce((acc, m) => acc + (Number(m.currentChapter) || 0), 0),
    [mangaList]
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<ReadingAnalytics>(() => emptyAnalytics(libraryChapters));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch('/api/reader/analytics');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = (await res.json()) as ReadingAnalytics;
        if (!cancelled) {
          setAnalytics({
            currentStreakDays: Number(data.currentStreakDays) || 0,
            longestStreakDays: Number(data.longestStreakDays) || 0,
            totalChaptersRead: Number(data.totalChaptersRead) || 0,
            totalTimeMinutes: Number(data.totalTimeMinutes) || 0,
            favoriteGenre: data.favoriteGenre || '',
            activities: Array.isArray(data.activities) ? data.activities : [],
          });
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || 'Failed to load analytics');
          setAnalytics(emptyAnalytics(libraryChapters));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [libraryChapters]);

  const daysList = useMemo(() => buildHeatmapDays(analytics.activities, 112), [analytics.activities]);
  const yearTotal = useMemo(
    () => analytics.activities.reduce((sum, a) => sum + (Number(a.chaptersRead) || 0), 0),
    [analytics.activities]
  );
  const hoursLabel = useMemo(() => {
    const mins = analytics.totalTimeMinutes || 0;
    if (mins <= 0) return '0 hrs';
    const hrs = mins / 60;
    return hrs >= 10 ? Math.round(hrs) + ' hrs' : hrs.toFixed(1) + ' hrs';
  }, [analytics.totalTimeMinutes]);
  const chaptersDisplay = analytics.totalChaptersRead > 0 ? analytics.totalChaptersRead : libraryChapters;

  const levelClass = (level: number) =>
    level === 0 ? 'bg-elevated' :
    level === 1 ? 'bg-accent/25' :
    level === 2 ? 'bg-accent-deep' :
    level === 3 ? 'bg-accent' :
    'bg-accent-bright shadow-md shadow-accent/50';

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-surface border border-edge rounded-2xl max-w-3xl w-full p-6 space-y-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-edge pb-3">
          <div className="font-black text-primary text-base flex items-center gap-2">
            <Calendar className="w-5 h-5 text-accent" />
            Reading Analytics & Activity Heatmap
          </div>
          <button onClick={onClose} className="text-secondary hover:text-white" aria-label="Close analytics">
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading ? (
          <div className="py-16 flex flex-col items-center gap-3 text-secondary">
            <Loader2 className="w-8 h-8 animate-spin text-accent" />
            <p className="text-xs font-bold">Loading your reading activity...</p>
          </div>
        ) : (
          <>
            {error && (
              <div className="px-3 py-2 rounded-xl bg-danger/10 border border-danger/30 text-xs text-danger font-semibold">
                Could not load live analytics ({error}). Showing library totals only.
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-4 bg-app rounded-xl border border-edge space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-secondary">
                  <Flame className="w-4 h-4 text-accent-2 fill-accent-2/30" /> Current Streak
                </div>
                <div className="text-2xl font-black text-accent font-mono">
                  {analytics.currentStreakDays} Day{analytics.currentStreakDays === 1 ? '' : 's'}
                  {analytics.currentStreakDays > 0 ? ' !' : ''}
                </div>
                <div className="text-[10px] text-muted">
                  {analytics.currentStreakDays > 0 ? 'Active daily reader' : 'Read a chapter to start a streak'}
                </div>
              </div>
              <div className="p-4 bg-app rounded-xl border border-edge space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-secondary">
                  <Award className="w-4 h-4 text-info" /> Longest Streak
                </div>
                <div className="text-2xl font-black text-info font-mono">
                  {analytics.longestStreakDays} Day{analytics.longestStreakDays === 1 ? '' : 's'}
                </div>
                <div className="text-[10px] text-muted">Personal best record</div>
              </div>
              <div className="p-4 bg-app rounded-xl border border-edge space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-secondary">
                  <BookOpen className="w-4 h-4 text-success" /> Chapters Read
                </div>
                <div className="text-2xl font-black text-success font-mono">{chaptersDisplay}</div>
                <div className="text-[10px] text-muted">
                  {analytics.totalChaptersRead > 0 ? 'From reading activity log' : 'From library progress'}
                </div>
              </div>
              <div className="p-4 bg-app rounded-xl border border-edge space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-secondary">
                  <Clock className="w-4 h-4 text-accent-2" /> Time Spent
                </div>
                <div className="text-2xl font-black text-accent-2 font-mono">{hoursLabel}</div>
                <div className="text-[10px] text-muted">Tracked reading time</div>
              </div>
            </div>

            <div className="p-4 bg-app rounded-xl border border-edge/80 space-y-3">
              <div className="flex items-center justify-between text-xs font-bold text-primary">
                <span>Reading Activity Heatmap (Last 16 Weeks)</span>
                <span className="text-[10px] text-accent font-mono">{yearTotal} Chapters logged</span>
              </div>
              <div
                className="gap-1.5 p-2 bg-surface rounded-lg overflow-x-auto grid"
                style={{ gridTemplateColumns: 'repeat(16, minmax(0, 1fr))' }}
              >
                {daysList.map((d, idx) => (
                  <div
                    key={idx}
                    title={d.date + ': ' + d.chaptersRead + ' chapter(s)'}
                    className={'w-3.5 h-3.5 rounded-sm transition-all hover:scale-125 ' + levelClass(d.level)}
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
          </>
        )}

        <div className="flex items-center justify-end border-t border-edge pt-4">
          <button onClick={onClose} className="px-5 py-2 rounded-xl bg-elevated text-primary font-bold text-xs">
            Close Analytics
          </button>
        </div>
      </div>
    </div>
  );
});