import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router';
import {
  Bookmark,
  Layers,
  Plus,
  Sliders,
  BookOpen,
  Sparkles,
  ChevronRight,
  FolderPlus,
  Flame,
  CheckCircle2,
  Clock,
  Archive,
  Star,
  Compass,
} from 'lucide-react';
import { MangaItem, UserCategory } from '../types';
import { apiFetch } from '../utils/api';
import { ManageCategoriesModal, renderCategoryIcon } from './ManageCategoriesModal';
import { SafeCoverImage } from './common/SafeCoverImage';

interface CategoriesViewProps {
  mangaList: MangaItem[];
  onSelectManga: (manga: MangaItem) => void;
  onOpenReader: (manga: MangaItem, chapterNumber?: number) => void;
  isGuest?: boolean;
  onOpenAuthModal?: () => void;
}

type CategoryTab = 'custom' | 'status' | 'genres' | 'types';

export const CategoriesView: React.FC<CategoriesViewProps> = ({
  mangaList,
  onSelectManga,
  onOpenReader,
  isGuest,
  onOpenAuthModal,
}) => {
  const navigate = useNavigate();
  const [categories, setCategories] = useState<UserCategory[]>([]);
  const [activeTab, setActiveTab] = useState<CategoryTab>('custom');
  const [manageModalOpen, setManageModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchCategories = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiFetch('/api/categories');
      if (res.ok) {
        const data = await res.json();
        setCategories(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Failed to fetch categories:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchCategories();
    const handleRefresh = () => void fetchCategories();
    window.addEventListener('refresh-categories', handleRefresh);
    return () => window.removeEventListener('refresh-categories', handleRefresh);
  }, [fetchCategories]);

  // Map series to categories
  const categorySeriesMap = useMemo(() => {
    const map = new Map<string, MangaItem[]>();
    for (const cat of categories) {
      map.set(cat.id, []);
    }

    for (const m of mangaList) {
      for (const cat of categories) {
        let matches = false;

        // Static assignment
        if (Array.isArray(m.categories) && m.categories.includes(cat.id)) {
          matches = true;
        }

        // Dynamic rule evaluation
        if (cat.isDynamic && cat.ruleType) {
          const rType = cat.ruleType;
          const rVal = String(cat.ruleValue || '');
          if (rType === 'unread') {
            const minUnread = Number(rVal) || 1;
            if (m.latestChapter - m.currentChapter >= minUnread) matches = true;
          } else if (rType === 'in_progress') {
            if (m.status === 'reading' && m.currentChapter > 0) matches = true;
          } else if (rType === 'completed') {
            if (m.status === 'completed') matches = true;
          } else if (rType === 'favorites') {
            if (m.isFavorite) matches = true;
          } else if (rType === 'rating' || rType === 'min_rating') {
            const min = Number(rVal) || 9.0;
            if (m.rating >= min) matches = true;
          } else if (rType === 'completed_gems') {
            const min = Number(rVal) || 8.5;
            if (m.status === 'completed' && m.rating >= min) matches = true;
          } else if (rType === 'updated_recently') {
            const daysDiff = (Date.now() - new Date(m.lastUpdated || 0).getTime()) / (1000 * 3600 * 24);
            if (daysDiff <= (Number(rVal) || 7)) matches = true;
          } else if (rType === 'genre') {
            if (Array.isArray(m.genres) && m.genres.some((g) => g.toLowerCase() === rVal.toLowerCase())) {
              matches = true;
            }
          }
        }

        if (matches) {
          map.get(cat.id)?.push(m);
        }
      }
    }
    return map;
  }, [categories, mangaList]);

  // Group by Reading Status
  const statusGroups = useMemo(() => {
    return [
      { id: 'reading', label: 'Currently Reading', icon: BookOpen, color: '#f59e0b', items: mangaList.filter((m) => m.status === 'reading') },
      { id: 'completed', label: 'Completed', icon: CheckCircle2, color: '#10b981', items: mangaList.filter((m) => m.status === 'completed') },
      { id: 'plan_to_read', label: 'Plan to Read', icon: Clock, color: '#38bdf8', items: mangaList.filter((m) => m.status === 'plan_to_read') },
      { id: 'on_hold', label: 'On Hold', icon: Archive, color: '#a855f7', items: mangaList.filter((m) => m.status === 'on_hold') },
      { id: 'dropped', label: 'Dropped', icon: Sliders, color: '#f43f5e', items: mangaList.filter((m) => m.status === 'dropped') },
    ];
  }, [mangaList]);

  // Group by Genres
  const genreGroups = useMemo(() => {
    const map = new Map<string, MangaItem[]>();
    for (const m of mangaList) {
      for (const g of m.genres || []) {
        if (typeof g === 'string' && g.trim()) {
          const norm = g.trim();
          if (!map.has(norm)) map.set(norm, []);
          map.get(norm)?.push(m);
        }
      }
    }
    return [...map.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([name, items]) => ({ name, items }));
  }, [mangaList]);

  // Group by Type (Manhwa, Manga, Manhua)
  const typeGroups = useMemo(() => {
    return [
      { id: 'manhwa', label: 'Korean Manhwa (Webtoons)', items: mangaList.filter((m) => m.type === 'manhwa') },
      { id: 'manga', label: 'Japanese Manga', items: mangaList.filter((m) => m.type === 'manga') },
      { id: 'manhua', label: 'Chinese Manhua', items: mangaList.filter((m) => m.type === 'manhua') },
    ];
  }, [mangaList]);

  return (
    <div className="space-y-6 pb-16">
      {/* ── Streamlined Header ─────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-edge/60 pb-4">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-xl bg-accent-grad text-accent-fg shadow-xs">
              <Layers className="w-4 h-4 stroke-[2.5]" />
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-primary font-display">
              Categories &amp; Shelves
            </h1>
          </div>
          <p className="text-xs text-secondary">
            Organize series into custom shelves, smart dynamic rules, and genre collections.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isGuest ? (
            <button
              onClick={onOpenAuthModal}
              className="px-3.5 py-1.5 rounded-xl bg-accent text-accent-fg text-xs font-black shadow-xs hover:bg-accent-bright transition-all cursor-pointer"
            >
              <span>Sign in to Create Shelves</span>
            </button>
          ) : (
            <button
              onClick={() => setManageModalOpen(true)}
              className="px-3.5 py-1.5 rounded-xl bg-accent text-accent-fg text-xs font-black flex items-center gap-1.5 shadow-xs hover:bg-accent-bright transition-all cursor-pointer active:scale-95"
            >
              <Plus className="w-3.5 h-3.5 stroke-[3]" />
              <span>Manage Shelves</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Streamlined Sub-tabs ───────────────────────────────────────────────── */}
      <div className="inline-flex items-center gap-1 p-1 bg-surface/80 border border-edge rounded-xl text-xs font-bold">
        <button
          onClick={() => setActiveTab('custom')}
          className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
            activeTab === 'custom'
              ? 'bg-accent text-accent-fg shadow-xs font-black'
              : 'text-secondary hover:text-primary'
          }`}
        >
          <Bookmark className="w-3.5 h-3.5" />
          <span>Custom ({categories.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('status')}
          className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
            activeTab === 'status'
              ? 'bg-accent text-accent-fg shadow-xs font-black'
              : 'text-secondary hover:text-primary'
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          <span>Status</span>
        </button>

        <button
          onClick={() => setActiveTab('genres')}
          className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
            activeTab === 'genres'
              ? 'bg-accent text-accent-fg shadow-xs font-black'
              : 'text-secondary hover:text-primary'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>Genres ({genreGroups.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('types')}
          className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
            activeTab === 'types'
              ? 'bg-accent text-accent-fg shadow-xs font-black'
              : 'text-secondary hover:text-primary'
          }`}
        >
          <Compass className="w-3.5 h-3.5" />
          <span>Origin</span>
        </button>
      </div>

      {/* ── TAB 1: CUSTOM SHELVES ────────────────────────────────────────────── */}
      {activeTab === 'custom' && (
        <div className="space-y-6">
          {categories.length === 0 ? (
            <div className="text-center py-16 px-4 bg-surface/40 border border-dashed border-edge rounded-3xl space-y-4">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-accent/10 text-accent flex items-center justify-center">
                <FolderPlus className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-primary">No Custom Shelves Yet</h3>
                <p className="text-xs text-muted max-w-md mx-auto">
                  Create tailored shelves like &ldquo;Weekly Favorites&rdquo;, &ldquo;Currently Bingeing&rdquo;, or dynamic folders based on unread chapters and genres.
                </p>
              </div>
              {!isGuest && (
                <button
                  onClick={() => setManageModalOpen(true)}
                  className="px-4 py-2 rounded-xl bg-accent text-accent-fg font-black text-xs inline-flex items-center gap-2 shadow-md hover:bg-accent-bright transition-all cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Create Your First Shelf</span>
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {categories.map((cat) => {
                const seriesInCat = categorySeriesMap.get(cat.id) || [];
                const unreadInCat = seriesInCat.filter((m) => m.latestChapter > m.currentChapter).length;

                return (
                  <div
                    key={cat.id}
                    className="bg-surface/80 border border-edge/80 rounded-2xl p-5 space-y-4 shadow-lg hover:border-accent/40 transition-colors"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-md shrink-0"
                          style={{ backgroundColor: cat.color || '#f59e0b' }}
                        >
                          {renderCategoryIcon(cat.icon, 'w-5 h-5')}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h2 className="text-base font-black text-primary">{cat.name}</h2>
                            {cat.isDynamic && (
                              <span className="px-2 py-0.5 rounded-md bg-accent/15 text-accent text-[10px] font-black uppercase tracking-wider border border-accent/25">
                                Smart Shelf
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted">
                            {cat.description || `${seriesInCat.length} series in this shelf`}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-secondary">
                          {seriesInCat.length} series
                        </span>
                        {unreadInCat > 0 && (
                          <span className="px-2 py-0.5 rounded-full bg-accent text-accent-fg text-[10px] font-black">
                            {unreadInCat} new
                          </span>
                        )}
                        <button
                          onClick={() => navigate(`/library?category=${cat.id}`)}
                          className="px-3 py-1.5 rounded-xl bg-elevated hover:bg-elevated/90 text-primary border border-edge text-xs font-bold flex items-center gap-1 cursor-pointer transition-colors"
                        >
                          <span>Open in Library</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Horizontal scroll of series covers */}
                    {seriesInCat.length === 0 ? (
                      <p className="text-xs text-muted italic py-3">No series assigned to this shelf yet.</p>
                    ) : (
                      <div className="flex gap-3 overflow-x-auto no-scrollbar py-1">
                        {seriesInCat.slice(0, 10).map((manga) => (
                          <div
                            key={manga.id}
                            onClick={() => onSelectManga(manga)}
                            className="group w-28 shrink-0 cursor-pointer space-y-1.5"
                          >
                            <div className="aspect-[3/4] w-full rounded-xl overflow-hidden bg-app border border-edge group-hover:border-accent/60 transition-all relative">
                              <SafeCoverImage
                                src={manga.coverImage}
                                alt={manga.title}
                                fallbackMessage="Missing"
                                compact
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                              />
                              {manga.latestChapter > manga.currentChapter && (
                                <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-accent animate-pulse" />
                              )}
                            </div>
                            <h4 className="text-[11px] font-bold text-primary truncate group-hover:text-accent transition-colors">
                              {manga.title}
                            </h4>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── TAB 2: READING STATUS ────────────────────────────────────────────── */}
      {activeTab === 'status' && (
        <div className="space-y-6">
          {statusGroups.map((grp) => {
            const Icon = grp.icon;
            return (
              <div
                key={grp.id}
                className="bg-surface/80 border border-edge/80 rounded-2xl p-5 space-y-4 shadow-lg hover:border-accent/40 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-md shrink-0"
                      style={{ backgroundColor: grp.color }}
                    >
                      <Icon className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="text-base font-black text-primary">{grp.label}</h2>
                      <p className="text-xs text-muted">{grp.items.length} series</p>
                    </div>
                  </div>

                  <button
                    onClick={() => navigate(`/library?status=${grp.id}`)}
                    className="px-3 py-1.5 rounded-xl bg-elevated hover:bg-elevated/90 text-primary border border-edge text-xs font-bold flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <span>View in Library</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                {grp.items.length === 0 ? (
                  <p className="text-xs text-muted italic py-3">No series currently in this status.</p>
                ) : (
                  <div className="flex gap-3 overflow-x-auto no-scrollbar py-1">
                    {grp.items.slice(0, 10).map((manga) => (
                      <div
                        key={manga.id}
                        onClick={() => onSelectManga(manga)}
                        className="group w-28 shrink-0 cursor-pointer space-y-1.5"
                      >
                        <div className="aspect-[3/4] w-full rounded-xl overflow-hidden bg-app border border-edge group-hover:border-accent/60 transition-all relative">
                          <SafeCoverImage
                            src={manga.coverImage}
                            alt={manga.title}
                            fallbackMessage="Missing"
                            compact
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                          />
                        </div>
                        <h4 className="text-[11px] font-bold text-primary truncate group-hover:text-accent transition-colors">
                          {manga.title}
                        </h4>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── TAB 3: GENRES ────────────────────────────────────────────────────── */}
      {activeTab === 'genres' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {genreGroups.map((g) => (
            <div
              key={g.name}
              onClick={() => navigate(`/browse?genre=${encodeURIComponent(g.name)}`)}
              className="bg-surface/80 border border-edge/80 rounded-2xl p-4 hover:border-accent/60 hover:shadow-xl transition-all cursor-pointer space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-accent" />
                  <h3 className="text-sm font-black text-primary">{g.name}</h3>
                </div>
                <span className="px-2 py-0.5 rounded-full bg-app border border-edge text-[10px] font-bold text-secondary">
                  {g.items.length} series
                </span>
              </div>

              {/* Mini cover previews */}
              <div className="flex gap-2 overflow-hidden h-16">
                {g.items.slice(0, 4).map((m) => (
                  <div key={m.id} className="w-12 h-16 shrink-0 rounded-lg overflow-hidden border border-edge bg-app">
                    <SafeCoverImage
                      src={m.coverImage}
                      alt={m.title}
                      fallbackMessage="Missing"
                      compact
                      className="w-full h-full object-cover"
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── TAB 4: TYPES ─────────────────────────────────────────────────────── */}
      {activeTab === 'types' && (
        <div className="space-y-6">
          {typeGroups.map((grp) => (
            <div
              key={grp.id}
              className="bg-surface/80 border border-edge/80 rounded-2xl p-5 space-y-4 shadow-lg hover:border-accent/40 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-black text-primary">{grp.label}</h2>
                  <p className="text-xs text-muted">{grp.items.length} series</p>
                </div>
                <button
                  onClick={() => navigate(`/browse?type=${grp.id}`)}
                  className="px-3 py-1.5 rounded-xl bg-elevated hover:bg-elevated/90 text-primary border border-edge text-xs font-bold flex items-center gap-1 cursor-pointer transition-colors"
                >
                  <span>Browse {grp.id.toUpperCase()}</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {grp.items.length === 0 ? (
                <p className="text-xs text-muted italic py-3">No series of this format yet.</p>
              ) : (
                <div className="flex gap-3 overflow-x-auto no-scrollbar py-1">
                  {grp.items.slice(0, 10).map((manga) => (
                    <div
                      key={manga.id}
                      onClick={() => onSelectManga(manga)}
                      className="group w-28 shrink-0 cursor-pointer space-y-1.5"
                    >
                      <div className="aspect-[3/4] w-full rounded-xl overflow-hidden bg-app border border-edge group-hover:border-accent/60 transition-all relative">
                        <SafeCoverImage
                          src={manga.coverImage}
                          alt={manga.title}
                          fallbackMessage="Missing"
                          compact
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                        />
                      </div>
                      <h4 className="text-[11px] font-bold text-primary truncate group-hover:text-accent transition-colors">
                        {manga.title}
                      </h4>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Manage Categories Modal ──────────────────────────────────────────── */}
      {manageModalOpen && (
        <ManageCategoriesModal
          categories={categories}
          isOpen={manageModalOpen}
          onClose={() => setManageModalOpen(false)}
          onCategoriesChanged={(updated) => setCategories(updated)}
        />
      )}
    </div>
  );
};
