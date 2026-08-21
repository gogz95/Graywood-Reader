import React, { useState, useCallback } from 'react';
import { apiFetch } from '../utils/api';
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
  Check,
  Clock,
  Zap,
  Globe,
  MessageSquare,
  Flame,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import { FLAG_CATEGORIES, FlagCategory } from './FlagIssueModal';

interface MangaDetailModalProps {
  manga: MangaItem;
  onClose: () => void;
  onUpdateManga: (updated: MangaItem) => void;
  onDeleteManga: (id: string) => void;
  onEditManga: (manga: MangaItem) => void;
  onOpenReader: (manga: MangaItem, chapterNumber?: number) => void;
  onOpenChapters: (manga: MangaItem) => void;
  /** Opens the bug-reporting tool pre-filled for the flagged series. */
  onReport: (category: FlagCategory, manga: MangaItem) => void;
}

export const MangaDetailModal: React.FC<MangaDetailModalProps> = React.memo(({
  manga,
  onClose,
  onUpdateManga,
  onDeleteManga,
  onEditManga,
  onOpenReader,
  onOpenChapters,
  onReport,
}) => {
  const [currentChapter, setCurrentChapter] = useState(manga.currentChapter);
  const [status, setStatus] = useState<ReadingStatus>(manga.status);
  const [rating, setRating] = useState(manga.rating);
  const [notes, setNotes] = useState(manga.notes);
  const [isFavorite, setIsFavorite] = useState(Boolean(manga.isFavorite));
  const [isFlagged, setIsFlagged] = useState(Boolean(manga.isFlagged));
  const [flagReason, setFlagReason] = useState(manga.flagReason || '');
  const [showFlagDropdown, setShowFlagDropdown] = useState(false);
  const [isRefreshingMetadata, setIsRefreshingMetadata] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);

  const handleRefreshMetadata = useCallback(async () => {
    setIsRefreshingMetadata(true);
    setRefreshMsg(null);
    try {
      const res = await apiFetch(`/api/manga/${manga.id}/refresh-metadata`, { method: 'POST' });
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
    // Real metadata field the user can change here is the rating (star control).
    // Record it as an override so a later metadata refresh preserves their rating.
    const metadataOverrides = Array.from(
      new Set<string>([
        ...(manga.metadataOverrides || []),
        ...(Number(rating) !== Number(manga.rating) ? ['rating'] : []),
      ])
    );

    onUpdateManga({
      ...manga,
      currentChapter,
      status,
      rating,
      notes,
      isFavorite,
      metadataOverrides,
      lastReadAt: new Date().toISOString(),
    });
    onClose();
  };

  const handleFetchSimilar = async () => {
    setLoadingSimilar(true);
    try {
      const res = await apiFetch('/api/ai/find-similar', {
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
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto">
      <div className="bg-surface border border-edge rounded-t-3xl sm:rounded-2xl max-w-3xl w-full max-h-[92vh] sm:max-h-[85vh] overflow-y-auto shadow-2xl my-0 sm:my-8">
        {/* Header / Hero Cover Bar */}
        <div className="relative p-6 bg-gradient-to-r from-app via-surface to-app border-b border-edge/80">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 rounded-full bg-elevated/80 text-secondary hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex flex-col sm:flex-row gap-5 items-start">
            <img
              src={manga.coverImage}
              alt={manga.title}
              className="w-28 h-40 sm:w-36 sm:h-48 rounded-xl object-cover bg-app shadow-xl border border-edge"
            />

            <div className="space-y-2 flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`px-2.5 py-0.5 rounded text-xs font-bold uppercase ${
                    manga.type === 'manhwa'
                      ? 'bg-blue-950 text-info border border-info/30'
                      : 'bg-red-950 text-danger border border-danger/30'
                  }`}
                >
                  {manga.type === 'manhwa' ? '🇰🇷 Manhwa' : '🇨🇳 Manhua'}
                </span>

                <button
                  onClick={() => setIsFavorite(!isFavorite)}
                  className={`px-2.5 sm:px-3 py-0.5 sm:py-1 rounded text-xs sm:text-sm font-bold flex items-center gap-1 transition-all ${
                    isFavorite
                      ? 'bg-accent/20 text-accent border border-accent/30'
                      : 'bg-elevated text-secondary'
                  }`}
                >
                  <Star className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${isFavorite ? 'fill-accent text-accent' : ''}`} />
                  <span>{isFavorite ? 'Favorite' : 'Add Favorite'}</span>
                </button>

                {/* Flag Issue Dropdown */}
                <div className="relative">
                  <button
                    onClick={() => setShowFlagDropdown(!showFlagDropdown)}
                    className={`px-2.5 sm:px-3 py-0.5 sm:py-1 rounded text-xs sm:text-sm font-bold flex items-center gap-1 transition-all ${
                      isFlagged
                        ? 'bg-danger/20 text-danger border border-danger/40 shadow-sm'
                        : 'bg-elevated text-secondary hover:text-primary'
                    }`}
                    title="Flag series for loading errors or broken content"
                  >
                    <AlertTriangle className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${isFlagged ? 'text-danger fill-danger/20' : 'text-secondary'}`} />
                    <span>{isFlagged ? `Flagged: ${flagReason || 'Error'}` : 'Flag Issue'}</span>
                  </button>
                  {showFlagDropdown && (
                    <div className="absolute left-0 top-full mt-1 z-[999] w-60 bg-surface border border-edge rounded-xl shadow-2xl overflow-hidden">
                      <div className="p-2 border-b border-edge">
                        <p className="text-[11px] font-bold text-primary">What went wrong?</p>
                      </div>
                      {FLAG_CATEGORIES.map((cat) => (
                        <button
                          key={cat.id}
                          onClick={async (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setShowFlagDropdown(false);
                            try {
                              await apiFetch('/api/manga/toggle-flag', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ id: manga.id, isFlagged: true, flagReason: cat.flagReason }),
                              });
                            } catch (_) {}
                            setIsFlagged(true);
                            setFlagReason(cat.flagReason);
                            onUpdateManga({ ...manga, isFlagged: true, flagReason: cat.flagReason, flaggedAt: new Date().toISOString() });
                            onReport(cat, manga);
                          }}
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-medium text-primary hover:bg-danger/10 hover:text-danger transition-colors text-left border-b border-edge/50 last:border-0"
                        >
                          <span className="p-1 rounded bg-danger/10 text-danger">{cat.icon}</span>
                          <span>
                            <span className="block font-bold">{cat.label}</span>
                            <span className="block text-[10px] text-secondary">{cat.description}</span>
                          </span>
                        </button>
                      ))}
                      {isFlagged && (
                        <button
                          onClick={async (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setShowFlagDropdown(false);
                            try {
                              await apiFetch('/api/manga/toggle-flag', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: manga.id, isFlagged: false }) });
                            } catch (_) {}
                            setIsFlagged(false);
                            setFlagReason('');
                            onUpdateManga({ ...manga, isFlagged: false, flagReason: undefined, flaggedAt: undefined });
                          }}
                          className="w-full px-3 py-2 text-xs font-bold text-secondary hover:text-danger hover:bg-danger/10 transition-colors text-center border-t border-edge flex items-center justify-center gap-1.5"
                        >
                          <Check className="w-3 h-3" /> Remove Flag
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <h2 className="text-xl sm:text-2xl font-black text-primary">{manga.title}</h2>

              {manga.altTitles.length > 0 && (
                <p className="text-xs text-secondary font-mono">
                  Alt Names: {manga.altTitles.join(' • ')}
                </p>
              )}

              {/* Genre Tags */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {manga.genres.map((g, idx) => (
                  <span key={idx} className="px-2 py-0.5 rounded text-[11px] bg-elevated text-secondary">
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
                    className="px-4 py-2 rounded-xl bg-gradient-to-r from-accent to-accent-2 hover:from-accent-bright hover:to-accent-2 text-accent-fg font-black text-xs flex items-center gap-1.5 shadow-lg shadow-accent/20 transition-all hover:scale-105"
                  >
                    <BookOpen className="w-4 h-4 fill-accent-fg" />
                    <span>Read Chapter {manga.currentChapter + 1} Now</span>
                  </button>
                )}

                <button
                  onClick={() => {
                    onClose();
                    onOpenChapters(manga);
                  }}
                  className="px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-xl bg-elevated hover:bg-elevated text-primary font-bold text-xs sm:text-sm flex items-center gap-1.5 transition-all"
                >
                  <Globe className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-accent" />
                  <span>Browse All Chapters</span>
                </button>

                {manga.sourceUrl && (
                  <a
                    href={manga.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold text-secondary hover:text-primary"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>External Site</span>
                  </a>
                )}

                <button
                  onClick={handleRefreshMetadata}
                  disabled={isRefreshingMetadata}
                  className="px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-xl bg-elevated hover:bg-elevated disabled:opacity-50 text-primary font-bold text-xs sm:text-sm flex items-center gap-1.5 transition-all"
                  title="Fetch latest metadata, chapter counts, covers, and rating from live sources"
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-info ${isRefreshingMetadata ? 'animate-spin' : ''}`} />
                  <span>{isRefreshingMetadata ? 'Refreshing...' : 'Refresh Metadata'}</span>
                </button>

                {refreshMsg && (
                  <span className="text-xs font-bold text-success animate-pulse">{refreshMsg}</span>
                )}
                {/* Available Sources List */}
                <div className="space-y-1.5 pt-2">
                  <div className="text-xs font-bold text-secondary flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5 text-info" />
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
                          className="px-2.5 py-1 rounded-lg bg-app border border-edge hover:border-info/50 text-info text-xs font-semibold flex items-center gap-1 transition-all"
                        >
                          <span>{src.sourceName}</span>
                          <ExternalLink className="w-3 h-3 text-muted" />
                        </a>
                      ))
                    ) : (
                      <span className="px-2.5 py-1 rounded-lg bg-app border border-edge text-secondary text-xs font-semibold">
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
            <h4 className="font-bold text-primary">Synopsis</h4>
            <p className="text-secondary leading-relaxed bg-app p-3.5 rounded-xl border border-edge">
              {manga.description || 'No synopsis provided.'}
            </p>
          </div>

          {/* Quick Chapter Progress Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-app/60 p-4 rounded-xl border border-edge">
            <div>
              <label className="block font-bold text-secondary mb-2">
                Reading Chapter Progress:
              </label>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setCurrentChapter(Math.max(0, currentChapter - 1))}
                  className="p-2 rounded-lg bg-elevated hover:bg-elevated text-primary"
                >
                  <Minus className="w-4 h-4" />
                </button>

                <div className="text-center min-w-[100px]">
                  <span className="text-xl font-black text-accent">Ch. {currentChapter}</span>
                  <span className="text-xs text-muted block">of {manga.latestChapter}</span>
                </div>

                <button
                  onClick={() => setCurrentChapter(currentChapter + 1)}
                  className="p-2 rounded-lg bg-accent hover:bg-accent-bright text-accent-fg font-bold"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div>
              <label className="block font-bold text-secondary mb-2">
                Reading Status:
              </label>
              <select
                value={status}
                onChange={(e: any) => setStatus(e.target.value)}
                className="w-full bg-surface border border-edge-strong rounded-lg p-2.5 text-primary font-semibold focus:outline-none focus:ring-2 focus:ring-accent/50"
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
            <label className="block font-bold text-secondary">Reading Notes & Arc Thoughts:</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add personal reading notes..."
              className="w-full bg-app border border-edge rounded-xl p-3 text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
            />
          </div>

          {/* Gemini AI Recommendations */}
          <div className="pt-2 border-t border-edge space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-primary flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-accent" />
                Gemini AI Similar Series Recommendations
              </h4>
              <button
                onClick={handleFetchSimilar}
                disabled={loadingSimilar}
                className="px-3 py-1 rounded-lg bg-accent/10 hover:bg-accent/20 text-accent border border-accent/30 text-xs font-bold transition-all"
              >
                {loadingSimilar ? 'Analyzing...' : 'Generate Recommendations'}
              </button>
            </div>

            {similarSeries.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                {similarSeries.map((s, idx) => (
                  <div key={idx} className="p-3 rounded-lg bg-app border border-edge space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-primary">{s.title}</span>
                      <span className="text-[10px] uppercase font-bold text-accent">{s.type}</span>
                    </div>
                    <p className="text-[11px] text-secondary">{s.reason}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-app border-t border-edge flex items-center justify-between gap-3">
          <button
            onClick={() => onDeleteManga(manga.id)}
            className="px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-xl bg-red-950/80 hover:bg-red-900 text-danger font-bold text-xs sm:text-sm flex items-center gap-1.5 transition-all"
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
              className="px-4 py-2 rounded-xl bg-elevated hover:bg-elevated text-primary font-bold text-xs flex items-center gap-1.5"
            >
              <Edit className="w-4 h-4" />
              Edit Details
            </button>

            <button
              onClick={handleSaveQuickChanges}
              className="px-5 py-2 rounded-xl bg-accent hover:bg-accent-bright text-accent-fg font-bold text-xs shadow-lg transition-all"
            >
              Save Progress
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
