import React, { useState, useCallback } from 'react';
import { apiFetch } from '../utils/api';
import { MangaItem, ReadingStatus, hasWorkingReaderSource, UserCategory, isNsfwManga } from '../types';
import { renderCategoryIcon } from './ManageCategoriesModal';

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
  Folder,
  Palette,
} from 'lucide-react';
import { FLAG_CATEGORIES, FlagCategory } from './FlagIssueModal';

const SourceFinderModal = React.lazy(() => import('./SourceFinderModal').then(m => ({ default: m.SourceFinderModal })));
const MetadataStudioModal = React.lazy(() => import('./MetadataStudioModal').then(m => ({ default: m.MetadataStudioModal })));
const MetadataPersonalizerPanel = React.lazy(() => import('./MetadataPersonalizerPanel').then(m => ({ default: m.MetadataPersonalizerPanel })));
const CoverArtPickerModal = React.lazy(() => import('./CoverArtPickerModal').then(m => ({ default: m.CoverArtPickerModal })));

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
  isGuest?: boolean;
  onOpenAuthModal?: () => void;
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
  isGuest = false,
  onOpenAuthModal,
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
  const [isSourceFinderOpen, setIsSourceFinderOpen] = useState(false);
  const [isMetadataStudioOpen, setIsMetadataStudioOpen] = useState(false);
  const [isCoverPickerOpen, setIsCoverPickerOpen] = useState(false);
  const [categories, setCategories] = useState<UserCategory[]>([]);
  const [activeCategoryIds, setActiveCategoryIds] = useState<string[]>(manga.categories || []);

  const handleSelectCoverArt = async (newCoverUrl: string, sourceName?: string) => {
    const nextOverrides = Array.from(new Set([...(manga.metadataOverrides || []), 'coverImage']));
    try {
      const res = await apiFetch(`/api/manga/${manga.id}/custom-metadata-update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coverImage: newCoverUrl,
          metadataOverrides: nextOverrides,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.manga) {
          onUpdateManga(data.manga);
        }
      }
    } catch (err) {
      console.error('Failed to update cover:', err);
    }
  };

  React.useEffect(() => {
    setActiveCategoryIds(manga.categories || []);
  }, [manga.id, manga.categories]);

  React.useEffect(() => {
    apiFetch('/api/categories')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setCategories(data || []))
      .catch(() => {});
  }, []);

  const handleToggleCategory = async (catId: string) => {
    const next = activeCategoryIds.includes(catId)
      ? activeCategoryIds.filter((id) => id !== catId)
      : [...activeCategoryIds, catId];
    setActiveCategoryIds(next);

    try {
      await apiFetch('/api/categories/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mangaId: manga.id, categoryIds: next }),
      });
      onUpdateManga({ ...manga, categories: next });
    } catch {}
  };

  const handleRefreshMetadata = useCallback(async () => {
    setIsRefreshingMetadata(true);
    setRefreshMsg(null);
    try {
      const res = await apiFetch(`/api/manga/${manga.id}/refresh-metadata`, { method: 'POST' });
      const data = await res.json();
      if (data.success && data.manga) {
        const updatedItem: MangaItem = {
          ...data.manga,
          categories:
            Array.isArray(data.manga.categories) && data.manga.categories.length > 0
              ? data.manga.categories
              : (manga.categories || []),
        };
        onUpdateManga(updatedItem);
        if (updatedItem.categories) {
          setActiveCategoryIds(updatedItem.categories);
        }
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
  }, [manga.id, manga.categories, onUpdateManga]);

  const [similarSeries, setSimilarSeries] = useState<{ title: string; type: string; reason: string }[]>([]);
  const [loadingSimilar, setLoadingSimilar] = useState(false);

  const handleSaveQuickChanges = () => {
    // Only update personal reading tracking state without touching series metadata overrides
    onUpdateManga({
      ...manga,
      currentChapter,
      status,
      notes,
      isFavorite,
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
    <div className="fixed inset-0 z-50 bg-black/85 flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700 rounded-t-3xl sm:rounded-2xl max-w-3xl w-full max-h-[92vh] sm:max-h-[85vh] overflow-y-auto shadow-2xl my-0 sm:my-8">
        {/* Header / Hero Cover Bar */}
        <div className="relative p-6 bg-slate-900 border-b border-slate-700 overflow-hidden">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 z-20 p-2.5 rounded-full bg-slate-800 hover:bg-slate-700 border border-slate-600 text-white shadow-lg transition-all hover:scale-105 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="relative z-10 flex flex-col sm:flex-row gap-5 items-start">
            <div
              className="relative group cursor-pointer shrink-0"
              onClick={() => setIsCoverPickerOpen(true)}
              title="Click to preview and select covers from all sources"
            >
              <img
                src={manga.coverImage}
                alt={manga.title}
                className="w-28 h-40 sm:w-36 sm:h-48 rounded-xl object-cover bg-slate-900 shadow-xl border border-slate-700 group-hover:opacity-90 group-hover:scale-[1.02] transition-all"
              />
              <div className="absolute inset-0 bg-slate-950/80 opacity-0 group-hover:opacity-100 rounded-xl flex flex-col items-center justify-center gap-2 transition-opacity p-2 text-center text-white">
                <Palette className="w-6 h-6 text-amber-400" />
                <span className="text-xs font-black tracking-wide">Change Cover</span>
                <span className="text-[10px] text-slate-400">Preview all sources</span>
              </div>
            </div>

            <div className="space-y-3 flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <span
                  className={`px-3 py-1 rounded-lg text-xs font-black uppercase tracking-wider shadow-sm ${
                    manga.type === 'manhwa'
                      ? 'bg-sky-900 text-sky-100 border border-sky-400'
                      : manga.type === 'manhua'
                      ? 'bg-rose-900 text-rose-100 border border-rose-400'
                      : manga.type === 'novel'
                      ? 'bg-amber-900 text-amber-100 border border-amber-400'
                      : 'bg-indigo-900 text-indigo-100 border border-indigo-400'
                  }`}
                >
                  {manga.type === 'manga' ? '🇯🇵 Manga' : manga.type === 'manhwa' ? '🇰🇷 Manhwa' : manga.type === 'novel' ? '📖 Novel' : '🇨🇳 Manhua'}
                </span>

                <button
                  onClick={() => setIsFavorite(!isFavorite)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm cursor-pointer ${
                    isFavorite
                      ? 'bg-amber-500 hover:bg-amber-400 text-black border border-amber-300'
                      : 'bg-slate-800 hover:bg-slate-700 border border-slate-600 text-white'
                  }`}
                >
                  <Star className={`w-3.5 h-3.5 ${isFavorite ? 'fill-black text-black' : 'text-slate-300'}`} />
                  <span>{isFavorite ? 'Favorite' : 'Add Favorite'}</span>
                </button>

                {/* Flag Issue Dropdown */}
                <div className="relative">
                  <button
                    onClick={() => setShowFlagDropdown(!showFlagDropdown)}
                    className={`px-3 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm cursor-pointer ${
                      isFlagged
                        ? 'bg-rose-900 hover:bg-rose-800 border border-rose-400 text-white'
                        : 'bg-slate-800 hover:bg-slate-700 border border-slate-600 text-white'
                    }`}
                    title="Flag series for loading errors or broken content"
                  >
                    <AlertTriangle className={`w-3.5 h-3.5 ${isFlagged ? 'text-rose-300 fill-rose-300' : 'text-slate-300'}`} />
                    <span>{isFlagged ? `Flagged: ${flagReason || 'Error'}` : 'Flag Issue'}</span>
                  </button>
                  {showFlagDropdown && (
                    <div className="absolute left-0 top-full mt-1.5 z-[999] w-64 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden">
                      <div className="p-2.5 border-b border-slate-800 bg-slate-950">
                        <p className="text-[11px] font-bold text-white">What went wrong?</p>
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
                          className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-medium text-slate-200 hover:bg-rose-950 hover:text-white transition-colors text-left border-b border-slate-800 last:border-0 cursor-pointer"
                        >
                          <span className="p-1 rounded bg-rose-900 text-rose-200">{cat.icon}</span>
                          <span>
                            <span className="block font-bold">{cat.label}</span>
                            <span className="block text-[10px] text-slate-400">{cat.description}</span>
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
                          className="w-full px-3 py-2.5 text-xs font-bold text-slate-300 hover:text-white hover:bg-rose-950 transition-colors text-center border-t border-slate-800 flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <Check className="w-3.5 h-3.5" /> Remove Flag
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">{manga.title}</h2>

              {manga.altTitles.length > 0 && (
                <p className="text-xs text-slate-300 font-semibold">
                  Alt Names: <span className="text-white font-medium">{manga.altTitles.join(' • ')}</span>
                </p>
              )}

              {/* Genre Tags */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {manga.genres.map((g, idx) => (
                  <span
                    key={idx}
                    className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-800 border border-slate-700 text-slate-200 shadow-sm hover:border-slate-500 hover:text-white transition-colors"
                  >
                    {g}
                  </span>
                ))}
              </div>

              {/* 18+ / NSFW Guest Access Notice */}
              {isGuest && isNsfwManga(manga) && (
                <div className="p-3.5 bg-rose-950 border border-rose-500 rounded-2xl text-xs text-rose-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg">
                  <div className="flex items-center gap-2.5">
                    <span className="text-xl">🔞</span>
                    <div>
                      <span className="font-bold block text-white">18+ Adult Explicit Title</span>
                      <span className="text-[11px] text-rose-300">You must be logged in to an account to read adult content.</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenAuthModal?.()}
                    className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-black text-xs flex items-center gap-1.5 shadow-md shrink-0 transition-all hover:scale-105 active:scale-95 cursor-pointer"
                  >
                    <span>Sign In</span>
                  </button>
                </div>
              )}

              {/* Missing Source Notice */}
              {!hasWorkingReaderSource(manga) && (
                <div className="p-3.5 bg-amber-950 border border-amber-500 rounded-2xl text-xs text-amber-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-md">
                  <div className="flex items-center gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                    <div>
                      <span className="font-bold block text-amber-300">Missing Reading Source</span>
                      <span className="text-[11px] text-slate-300">This series is in your library but has no linked chapter source.</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsSourceFinderOpen(true)}
                    className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-black text-xs flex items-center gap-1.5 shadow-md shrink-0 transition-all hover:scale-105 active:scale-95 cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Find Alternative Sources</span>
                  </button>
                </div>
              )}

              {/* Built-in Reader Action Buttons */}
              <div className="space-y-3 pt-2">
                {/* Primary Action Buttons */}
                <div className="flex flex-wrap items-center gap-2.5">
                  {hasWorkingReaderSource(manga) && (
                    <button
                      onClick={() => {
                        if (isGuest && isNsfwManga(manga)) {
                          onOpenAuthModal?.();
                          return;
                        }
                        onClose();
                        onOpenReader(manga, manga.currentChapter + 1);
                      }}
                      className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black border border-amber-300 font-extrabold text-xs sm:text-sm flex items-center gap-2 shadow-lg shadow-amber-500/25 transition-all hover:scale-[1.03] active:scale-95 cursor-pointer"
                    >
                      <BookOpen className="w-4 h-4 fill-black text-black" />
                      <span>Read Chapter {manga.currentChapter + 1} Now</span>
                    </button>
                  )}

                  <button
                    onClick={() => {
                      if (isGuest && isNsfwManga(manga)) {
                        onOpenAuthModal?.();
                        return;
                      }
                      onClose();
                      onOpenChapters(manga);
                    }}
                    className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-white font-bold text-xs sm:text-sm flex items-center gap-2 shadow-md transition-all hover:scale-[1.02] cursor-pointer"
                  >
                    <Globe className="w-4 h-4 text-sky-400" />
                    <span>Browse All Chapters</span>
                  </button>

                  {manga.sourceUrl && (
                    <a
                      href={manga.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 hover:text-white font-semibold text-xs sm:text-sm flex items-center gap-1.5 transition-all cursor-pointer"
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-slate-300" />
                      <span>External Site</span>
                    </a>
                  )}
                </div>

                {/* Secondary Utility / Studio Buttons */}
                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => setIsSourceFinderOpen(true)}
                    className="px-4 py-2.5 rounded-xl bg-sky-900 hover:bg-sky-800 border border-sky-400 text-sky-100 hover:text-white font-bold text-xs sm:text-sm flex items-center gap-2 shadow-sm transition-all hover:scale-[1.02] cursor-pointer"
                    title="Search active online sources for this series"
                  >
                    <Sparkles className="w-4 h-4 text-sky-300" />
                    <span>Find Alternative Sources</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsMetadataStudioOpen(true)}
                    className="px-4 py-2.5 rounded-xl bg-purple-900 hover:bg-purple-800 border border-purple-400 text-purple-100 hover:text-white font-bold text-xs sm:text-sm flex items-center gap-2 shadow-sm transition-all hover:scale-[1.02] cursor-pointer"
                    title="Personalize artwork, choose covers from available sources & lock fields (Jellyfin/Plex style)"
                  >
                    <Palette className="w-4 h-4 text-purple-300" />
                    <span>Poster & Metadata Studio</span>
                  </button>

                  <button
                    onClick={handleRefreshMetadata}
                    disabled={isRefreshingMetadata}
                    className="px-4 py-2.5 rounded-xl bg-emerald-900 hover:bg-emerald-800 border border-emerald-400 disabled:opacity-50 text-emerald-100 hover:text-white font-bold text-xs sm:text-sm flex items-center gap-2 shadow-sm transition-all hover:scale-[1.02] cursor-pointer"
                    title="Fetch latest metadata, chapter counts, covers, and rating from live sources"
                  >
                    <RefreshCw className={`w-4 h-4 text-emerald-300 ${isRefreshingMetadata ? 'animate-spin' : ''}`} />
                    <span>{isRefreshingMetadata ? 'Refreshing...' : 'Refresh Metadata'}</span>
                  </button>

                  {refreshMsg && (
                    <span className="text-xs font-bold text-emerald-300 animate-pulse bg-emerald-950 border border-emerald-500 px-2.5 py-1 rounded-lg">
                      {refreshMsg}
                    </span>
                  )}
                </div>

                {/* Available Sources List */}
                <div className="space-y-1.5 pt-1">
                  <div className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5 text-sky-400" />
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
                          className="px-3.5 py-1.5 rounded-lg bg-slate-800 border border-slate-600 hover:border-sky-400 text-sky-300 hover:text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
                        >
                          <span>{src.sourceName}</span>
                          <ExternalLink className="w-3 h-3 text-slate-400" />
                        </a>
                      ))
                    ) : (
                      <span className="px-3.5 py-1.5 rounded-lg bg-slate-800 border border-slate-600 text-slate-300 text-xs font-semibold shadow-sm">
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
        <div className="p-6 space-y-6 text-xs sm:text-sm bg-slate-900">
          {/* Custom Shelves & Categories */}
          {categories.length > 0 && (
            <div className="space-y-2 bg-slate-950 p-4 rounded-xl border border-slate-800">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Folder className="w-3.5 h-3.5 text-amber-400" />
                  <span>Custom Shelves & Categories:</span>
                </span>
                <span className="text-[11px] text-slate-400">Click to assign or remove</span>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                {categories.map((cat) => {
                  const isAssigned = activeCategoryIds.includes(cat.id);
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => handleToggleCategory(cat.id)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 border transition-all ${
                        isAssigned
                          ? 'border-accent shadow-sm'
                          : 'bg-slate-800 border-slate-700 text-slate-200 hover:text-white hover:bg-slate-700'
                      }`}
                      style={
                        isAssigned
                          ? { backgroundColor: `${cat.color || '#f59e0b'}25`, color: cat.color || '#f59e0b', borderColor: cat.color || '#f59e0b' }
                          : undefined
                      }
                    >
                      {isAssigned ? <Check className="w-3.5 h-3.5" /> : renderCategoryIcon(cat.icon, 'w-3.5 h-3.5')}
                      <span>{cat.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Metadata Personalizer & Source Options */}
          <React.Suspense fallback={null}>
            <MetadataPersonalizerPanel
              manga={manga}
              onUpdateManga={onUpdateManga}
              onOpenStudio={() => setIsMetadataStudioOpen(true)}
            />
          </React.Suspense>

          {/* Synopsis */}
          <div className="space-y-1.5">
            <h4 className="font-bold text-white text-sm">Synopsis</h4>
            <p className="text-slate-200 leading-relaxed bg-slate-950 p-4 rounded-xl border border-slate-800">
              {manga.description || 'No synopsis provided.'}
            </p>
          </div>

          {/* Quick Chapter Progress Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-950 p-4 rounded-xl border border-slate-800">
            <div>
              <label className="block font-bold text-slate-200 mb-2">
                Reading Chapter Progress:
              </label>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setCurrentChapter(Math.max(0, currentChapter - 1))}
                  className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-white border border-slate-700"
                >
                  <Minus className="w-4 h-4" />
                </button>

                <div className="text-center min-w-[100px]">
                  <span className="text-xl font-black text-amber-400">Ch. {currentChapter}</span>
                  <span className="text-xs text-slate-400 block">of {manga.latestChapter}</span>
                </div>

                <button
                  onClick={() => setCurrentChapter(currentChapter + 1)}
                  className="p-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-bold border border-amber-300"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div>
              <label className="block font-bold text-slate-200 mb-2">
                Reading Status:
              </label>
              <select
                value={status}
                onChange={(e: any) => setStatus(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-white font-semibold focus:outline-none focus:ring-2 focus:ring-amber-500/50"
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
            <label className="block font-bold text-slate-200">Reading Notes & Arc Thoughts:</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add personal reading notes..."
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
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
                className="px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black border border-amber-300 text-xs font-bold transition-all shadow-sm cursor-pointer"
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
        <div className="p-4 bg-slate-900 border-t border-slate-700 flex items-center justify-between gap-3">
          <button
            onClick={() => onDeleteManga(manga.id)}
            className="px-4 py-2.5 rounded-xl bg-rose-900 hover:bg-rose-800 border border-rose-400 text-white font-bold text-xs sm:text-sm flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </button>

          <div className="flex items-center gap-2.5">
            <button
              onClick={() => {
                onClose();
                onEditManga(manga);
              }}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-white font-bold text-xs sm:text-sm flex items-center gap-1.5 transition-all shadow-sm cursor-pointer"
            >
              <Palette className="w-4 h-4 text-amber-400" />
              Edit Metadata
            </button>

            <button
              onClick={handleSaveQuickChanges}
              className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black border border-amber-300 font-black text-xs sm:text-sm shadow-lg shadow-amber-500/25 transition-all flex items-center gap-1.5 cursor-pointer hover:scale-[1.02] active:scale-95"
            >
              <Check className="w-4 h-4" />
              Save Progress
            </button>
          </div>
        </div>
      </div>

      {/* Alternative Sources Finder Modal */}
      {isSourceFinderOpen && (
        <React.Suspense fallback={null}>
          <SourceFinderModal
            manga={manga}
            isOpen={isSourceFinderOpen}
            onClose={() => setIsSourceFinderOpen(false)}
            onSourceAttached={(updated) => {
              setIsFlagged(Boolean(updated.isFlagged));
              setFlagReason(updated.flagReason || '');
              onUpdateManga(updated);
            }}
          />
        </React.Suspense>
      )}

      {/* Jellyfin & Plex Style Poster & Metadata Studio Modal */}
      {isMetadataStudioOpen && (
        <React.Suspense fallback={null}>
          <MetadataStudioModal
            manga={manga}
            isOpen={isMetadataStudioOpen}
            onClose={() => setIsMetadataStudioOpen(false)}
            onUpdateManga={onUpdateManga}
          />
        </React.Suspense>
      )}

      {/* Interactive Multi-Source Cover Art Picker */}
      {isCoverPickerOpen && (
        <React.Suspense fallback={null}>
          <CoverArtPickerModal
            isOpen={isCoverPickerOpen}
            onClose={() => setIsCoverPickerOpen(false)}
            currentCoverUrl={manga.coverImage}
            mangaId={manga.id}
            mangaTitle={manga.title}
            availableSources={manga.availableSources}
            onSelectCover={handleSelectCoverArt}
          />
        </React.Suspense>
      )}
    </div>
  );
});
