import React, { useState } from 'react';
import { MangaItem, ReadingStatus, hasWorkingReaderSource } from '../types';

import {
  X,
  Star,
  ExternalLink,
  Plus,
  Minus,
  Sparkles,
  Edit,
  Trash2,
  BookOpen,
  CheckCircle,
  Clock,
  Zap,
  Globe,
  MessageSquare,
  Flame,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';

interface MangaDetailModalProps {
  manga: MangaItem;
  onClose: () => void;
  onUpdateManga: (updated: MangaItem) => void;
  onDeleteManga: (id: string) => void;
  onEditManga: (manga: MangaItem) => void;
  onOpenReader: (manga: MangaItem, chapterNumber?: number) => void;
  onOpenChapters: (manga: MangaItem) => void;
}

export const MangaDetailModal: React.FC<MangaDetailModalProps> = ({
  manga,
  onClose,
  onUpdateManga,
  onDeleteManga,
  onEditManga,
  onOpenReader,
  onOpenChapters,
}) => {
  const [currentChapter, setCurrentChapter] = useState(manga.currentChapter);
  const [status, setStatus] = useState<ReadingStatus>(manga.status);
  const [rating, setRating] = useState(manga.rating);
  const [notes, setNotes] = useState(manga.notes);
  const [isFavorite, setIsFavorite] = useState(Boolean(manga.isFavorite));
  const [isFlagged, setIsFlagged] = useState(Boolean(manga.isFlagged));
  const [flagReason, setFlagReason] = useState(manga.flagReason || '');
  const [isRefreshingMetadata, setIsRefreshingMetadata] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);

    const handleToggleFlag = useCallback(async () => {
    const newFlagState = !isFlagged;
    let reason = flagReason;
    if (newFlagState && !reason) {
      const inputReason = prompt('Enter reason for flagging this series (e.g. Images loading failed / Missing chapters):', 'Failed to load chapter pages');
      if (inputReason === null) return;
      reason = inputReason || 'Reported loading error';
    }

    setIsFlagged(newFlagState);
    setFlagReason(reason);
    try {
      const res = await fetch('/api/manga/toggle-flag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: manga.id, isFlagged: newFlagState, flagReason: reason })
      });
      const data = await res.json();
      if (data.success && data.manga) {
        onUpdateManga(data.manga);
      }
    } catch (e) {}
  }, [manga.id]);

  const handleRefreshMetadata = useCallback(async () => {
    setIsRefreshingMetadata(true);
    setRefreshMsg(null);
    try {
      const res = await fetch(`/api/manga/${manga.id}/refresh-metadata`, { method: 'POST' });
      const data = await res.json();
      if (data.success && data.manga) {
        onUpdateManga(data.manga);
        setRefreshMsg('✓ Metadata updated!');
        setTimeout(() => setRefreshMsg(null), 3000);
      } else {
        setRefreshMsg('⚠️ Refresh complete');
        setTimeout(() => setRefreshMsg(null), 3000);
      }
    } catch (err) {
      setRefreshMsg('❌ Refresh failed');
      setTimeout(() => setRefreshMsg(null), 3000);
    } finally {
      setIsRefreshingMetadata(false);
    }
  }, [manga.id]);

  const [similarSeries, setSimilarSeries] = useState<{ title: string; type: string; reason: string }[]>([]);
  const [loadingSimilar, setLoadingSimilar] = useState(false);

  const handleSaveQuickChanges = () => {
    onUpdateManga({
      ...manga,
      currentChapter,
      status,
      rating,
      notes,
      isFavorite,
      lastReadAt: new Date().toISOString(),
    });
    onClose();
  };

  const handleFetchSimilar = async () => {
    setLoadingSimilar(true);
    try {
      const res = await fetch('/api/ai/find-similar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: manga.title, genres: manga.genres }),
      });
      if (res.ok) {
        const data = await res.json();
        setSimilarSeries(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingSimilar(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-2xl max-w-3xl w-full max-h-[92vh] sm:max-h-[85vh] overflow-y-auto shadow-2xl my-0 sm:my-8">
        {/* Header / Hero Cover Bar */}
        <div className="relative p-6 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 border-b border-slate-800/80">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 rounded-full bg-slate-800/80 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex flex-col sm:flex-row gap-5 items-start">
            <img
              src={manga.coverImage}
              alt={manga.title}
              className="w-28 h-40 sm:w-36 sm:h-48 rounded-xl object-cover bg-slate-950 shadow-xl border border-slate-800"
            />

            <div className="space-y-2 flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`px-2.5 py-0.5 rounded text-xs font-bold uppercase ${
                    manga.type === 'manhwa'
                      ? 'bg-blue-950 text-blue-300 border border-blue-500/30'
                      : 'bg-red-950 text-red-300 border border-red-500/30'
                  }`}
                >
                  {manga.type === 'manhwa' ? '🇰🇷 Manhwa' : '🇨🇳 Manhua'}
                </span>

                <button
                  onClick={() => setIsFavorite(!isFavorite)}
                  className={`px-2.5 py-0.5 rounded text-xs font-bold flex items-center gap-1 transition-all ${
                    isFavorite
                      ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  <Star className={`w-3.5 h-3.5 ${isFavorite ? 'fill-amber-400 text-amber-400' : ''}`} />
                  <span>{isFavorite ? 'Favorite' : 'Add Favorite'}</span>
                </button>

                <button
                  onClick={handleToggleFlag}
                  className={`px-2.5 py-0.5 rounded text-xs font-bold flex items-center gap-1 transition-all ${
                    isFlagged
                      ? 'bg-red-500/20 text-red-400 border border-red-500/40 shadow-sm'
                      : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                  title="Flag series for loading errors or broken content"
                >
                  <AlertTriangle className={`w-3.5 h-3.5 ${isFlagged ? 'text-red-400 fill-red-400/20' : 'text-slate-400'}`} />
                  <span>{isFlagged ? `Flagged: ${flagReason || 'Error'}` : 'Flag Issue'}</span>
                </button>
              </div>

              <h2 className="text-xl sm:text-2xl font-black text-slate-100">{manga.title}</h2>

              {manga.altTitles.length > 0 && (
                <p className="text-xs text-slate-400 font-mono">
                  Alt Names: {manga.altTitles.join(' • ')}
                </p>
              )}

              {/* Genre Tags */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {manga.genres.map((g, idx) => (
                  <span key={idx} className="px-2 py-0.5 rounded text-[11px] bg-slate-800 text-slate-300">
                    {g}
                  </span>
                ))}
              </div>

              {/* Built-in Reader Action Buttons */}
              <div className="flex flex-wrap items-center gap-2 pt-2">
                {hasWorkingReaderSource(manga) && (
                  <button
                    onClick={() => {
                      onClose();
                      onOpenReader(manga, manga.currentChapter + 1);
                    }}
                    className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black text-xs flex items-center gap-1.5 shadow-lg shadow-amber-500/20 transition-all hover:scale-105"
                  >
                    <BookOpen className="w-4 h-4 fill-slate-950" />
                    <span>Read Chapter {manga.currentChapter + 1} Now</span>
                  </button>
                )}

                <button
                  onClick={() => {
                    onClose();
                    onOpenChapters(manga);
                  }}
                  className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs flex items-center gap-1.5 transition-all"
                >
                  <Globe className="w-3.5 h-3.5 text-amber-400" />
                  <span>Browse All Chapters</span>
                </button>

                {manga.sourceUrl && (
                  <a
                    href={manga.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold text-slate-400 hover:text-slate-200"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>External Site</span>
                  </a>
                )}

                <button
                  onClick={handleRefreshMetadata}
                  disabled={isRefreshingMetadata}
                  className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 font-bold text-xs flex items-center gap-1.5 transition-all"
                  title="Fetch latest metadata, chapter counts, covers, and rating from live sources"
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${isRefreshingMetadata ? 'animate-spin' : ''}`} />
                  <span>{isRefreshingMetadata ? 'Refreshing...' : 'Refresh Metadata'}</span>
                </button>

                {refreshMsg && (
                  <span className="text-xs font-bold text-emerald-400 animate-pulse">{refreshMsg}</span>
                )}
                {/* Available Sources List */}
                <div className="space-y-1.5 pt-2">
                  <div className="text-xs font-bold text-slate-400 flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Found Across Sources ({manga.availableSources?.length || (manga.sourceName ? 1 : 0)}):</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {manga.availableSources && manga.availableSources.length > 0 ? (
                      manga.availableSources.map((src, idx) => (
                        <a
                          key={idx}
                          href={src.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 hover:border-cyan-500/50 text-cyan-300 text-xs font-semibold flex items-center gap-1 transition-all"
                        >
                          <span>{src.sourceName}</span>
                          <ExternalLink className="w-3 h-3 text-slate-500" />
                        </a>
                      ))
                    ) : (
                      <span className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 text-xs font-semibold">
                        {manga.sourceName || 'Kotatsu Source'}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-6 text-xs sm:text-sm">
          {/* Synopsis */}
          <div className="space-y-1.5">
            <h4 className="font-bold text-slate-200">Synopsis</h4>
            <p className="text-slate-300 leading-relaxed bg-slate-950 p-3.5 rounded-xl border border-slate-800">
              {manga.description || 'No synopsis provided.'}
            </p>
          </div>

          {/* Quick Chapter Progress Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-950/60 p-4 rounded-xl border border-slate-800">
            <div>
              <label className="block font-bold text-slate-300 mb-2">
                Reading Chapter Progress:
              </label>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setCurrentChapter(Math.max(0, currentChapter - 1))}
                  className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200"
                >
                  <Minus className="w-4 h-4" />
                </button>

                <div className="text-center min-w-[100px]">
                  <span className="text-xl font-black text-amber-400">Ch. {currentChapter}</span>
                  <span className="text-xs text-slate-500 block">of {manga.latestChapter}</span>
                </div>

                <button
                  onClick={() => setCurrentChapter(currentChapter + 1)}
                  className="p-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div>
              <label className="block font-bold text-slate-300 mb-2">
                Reading Status:
              </label>
              <select
                value={status}
                onChange={(e: any) => setStatus(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-slate-100 font-semibold focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              >
                <option value="reading">Reading</option>
                <option value="plan_to_read">Plan to Read</option>
                <option value="completed">Completed</option>
                <option value="on_hold">On Hold</option>
                <option value="dropped">Dropped</option>
              </select>
            </div>
          </div>

          {/* Personal Notes */}
          <div className="space-y-1.5">
            <label className="block font-bold text-slate-300">Reading Notes & Arc Thoughts:</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add personal reading notes..."
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
            />
          </div>

          {/* Gemini AI Recommendations */}
          <div className="pt-2 border-t border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-slate-200 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400" />
                Gemini AI Similar Series Recommendations
              </h4>
              <button
                onClick={handleFetchSimilar}
                disabled={loadingSimilar}
                className="px-3 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 text-xs font-bold transition-all"
              >
                {loadingSimilar ? 'Analyzing...' : 'Generate Recommendations'}
              </button>
            </div>

            {similarSeries.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                {similarSeries.map((s, idx) => (
                  <div key={idx} className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-100">{s.title}</span>
                      <span className="text-[10px] uppercase font-bold text-amber-400">{s.type}</span>
                    </div>
                    <p className="text-[11px] text-slate-400">{s.reason}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between gap-3">
          <button
            onClick={() => onDeleteManga(manga.id)}
            className="px-3.5 py-2 rounded-xl bg-red-950/80 hover:bg-red-900 text-red-300 font-bold text-xs flex items-center gap-1.5 transition-all"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                onClose();
                onEditManga(manga);
              }}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs flex items-center gap-1.5"
            >
              <Edit className="w-4 h-4" />
              Edit Details
            </button>

            <button
              onClick={handleSaveQuickChanges}
              className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-lg transition-all"
            >
              Save Progress
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
