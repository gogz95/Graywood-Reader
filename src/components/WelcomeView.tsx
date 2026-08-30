import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Sparkles,
  Flame,
  UserPlus,
  LogIn,
  BookOpen,
  Compass,
  ArrowRight,
  RefreshCw,
  Star,
  CheckCircle2,
  Clock,
  Download,
  Users,
  ShieldCheck,
  ChevronRight,
  Bookmark,
} from 'lucide-react';
import { MangaItem, UserProfile } from '../types';
import { apiFetch } from '../utils/api';

interface WelcomeStats {
  totalSeries: number;
  totalChapters: number;
  totalSources: number;
}

interface WelcomeViewProps {
  currentUser?: UserProfile;
  isGuest?: boolean;
  onOpenAuthModal: (mode: 'login' | 'register') => void;
  onSelectManga: (manga: MangaItem) => void;
  onOpenReader: (manga: MangaItem, chapterNumber?: number) => void;
  libraryManga?: MangaItem[];
}

const FALLBACK_COVER =
  '/api/mangadex/image-proxy?url=https%3A%2F%2Fuploads.mangadex.org%2Fcovers%2F32d76d19-8a05-4db0-9fc2-e0b0648fe9d0%2Ffbc962f9-3d12-4c6e-8212-32a2cb874a7b.jpg';

export const WelcomeView: React.FC<WelcomeViewProps> = ({
  currentUser,
  isGuest = true,
  onOpenAuthModal,
  onSelectManga,
  onOpenReader,
  libraryManga = [],
}) => {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [newlyUpdated, setNewlyUpdated] = useState<MangaItem[]>([]);
  const [popularSeries, setPopularSeries] = useState<MangaItem[]>([]);
  const [feedTab, setFeedTab] = useState<'updated' | 'popular'>('updated');
  const [stats, setStats] = useState<WelcomeStats>({
    totalSeries: 0,
    totalChapters: 0,
    totalSources: 12,
  });
  const [topCategories, setTopCategories] = useState<{ name: string; count: number }[]>([]);

  useEffect(() => {
    let mounted = true;

    async function loadWelcomeData() {
      try {
        setLoading(true);
        const res = await apiFetch('/api/explore/welcome');
        if (res.ok) {
          const data = await res.json();
          if (mounted) {
            if (Array.isArray(data.newlyUpdated) && data.newlyUpdated.length > 0) {
              setNewlyUpdated(data.newlyUpdated);
            } else if (libraryManga.length > 0) {
              const sorted = [...libraryManga]
                .sort((a, b) => new Date(b.lastUpdated || 0).getTime() - new Date(a.lastUpdated || 0).getTime())
                .slice(0, 18);
              setNewlyUpdated(sorted);
            }

            if (Array.isArray(data.popular) && data.popular.length > 0) {
              setPopularSeries(data.popular);
            } else if (libraryManga.length > 0) {
              const sorted = [...libraryManga]
                .sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0))
                .slice(0, 18);
              setPopularSeries(sorted);
            }

            if (data.stats) {
              setStats(data.stats);
            } else {
              setStats({
                totalSeries: libraryManga.length,
                totalChapters: 0,
                totalSources: 14,
              });
            }

            if (Array.isArray(data.topCategories) && data.topCategories.length > 0) {
              setTopCategories(data.topCategories);
            } else {
              setTopCategories([
                { name: 'Action', count: 42 },
                { name: 'Fantasy', count: 38 },
                { name: 'Martial Arts', count: 29 },
                { name: 'Romance', count: 24 },
                { name: 'Supernatural', count: 21 },
                { name: 'Comedy', count: 18 },
                { name: 'Sci-Fi', count: 15 },
                { name: 'Adventure', count: 12 },
              ]);
            }
          }
        } else {
          if (mounted && libraryManga.length > 0) {
            setNewlyUpdated(libraryManga.slice(0, 12));
            setPopularSeries(
              [...libraryManga].sort((a, b) => (b.rating || 0) - (a.rating || 0)).slice(0, 12)
            );
            setStats({
              totalSeries: libraryManga.length,
              totalChapters: 0,
              totalSources: 12,
            });
          }
        }
      } catch (err) {
        console.error('Failed to load welcome data:', err);
        if (mounted && libraryManga.length > 0) {
          setNewlyUpdated(libraryManga.slice(0, 12));
          setPopularSeries(libraryManga.slice(0, 12));
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void loadWelcomeData();
    return () => {
      mounted = false;
    };
  }, [libraryManga]);

  const continueReadingSeries = libraryManga
    .filter((m) => m.currentChapter > 0 && m.currentChapter < m.latestChapter)
    .slice(0, 4);

  const displayFeed = feedTab === 'updated' ? newlyUpdated : popularSeries;

  return (
    <div className="space-y-10 pb-16">
      {/* ── HERO BANNER ──────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-b from-surface/80 via-surface/40 to-app/60 border border-edge/80 p-6 sm:p-10 shadow-xl">
        <div className="absolute top-0 right-1/4 -translate-y-1/2 w-80 h-80 bg-accent/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-10 translate-y-1/3 w-64 h-64 bg-accent-2/10 rounded-full blur-3xl pointer-events-none" />

        {/* Ambient cover artwork glow from top trending series */}
        {popularSeries[0]?.coverImage && (
          <div className="absolute -right-10 -top-10 bottom-0 w-2/5 opacity-20 overflow-hidden pointer-events-none hidden lg:block">
            <img
              src={popularSeries[0].coverImage}
              alt=""
              className="w-full h-full object-cover blur-3xl scale-125"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-surface/90 via-surface/40 to-transparent" />
          </div>
        )}

        <div className="relative z-10 max-w-3xl space-y-5">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/10 border border-accent/20 text-accent text-xs font-bold tracking-wide">
            <Sparkles className="w-3.5 h-3.5 text-accent-bright animate-pulse" />
            <span>Self-Hosted Manga &amp; Webtoon Hub</span>
          </div>

          <div className="space-y-2">
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black font-display tracking-tight text-primary leading-tight">
              Track, Read, and Discover <br />
              <span className="text-accent-grad">Without Interruptions.</span>
            </h1>
            <p className="text-xs sm:text-sm lg:text-base text-secondary max-w-xl font-normal leading-relaxed">
              Auto-aggregate chapter releases across top sources, read seamless webtoons, download for offline travels, and keep reading progress synchronized.
            </p>
          </div>

          {/* Action Pills */}
          <div className="pt-1 flex flex-wrap items-center gap-3">
            {isGuest ? (
              <>
                <button
                  type="button"
                  onClick={() => onOpenAuthModal('register')}
                  className="px-5 py-2.5 rounded-xl bg-accent hover:bg-accent-bright text-accent-fg font-black text-xs sm:text-sm flex items-center gap-2 shadow-md shadow-accent/20 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer group"
                >
                  <UserPlus className="w-4 h-4 stroke-[2.5]" />
                  <span>Register Now</span>
                  <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
                </button>

                <button
                  type="button"
                  onClick={() => onOpenAuthModal('login')}
                  className="px-5 py-2.5 rounded-xl bg-elevated/80 hover:bg-elevated text-primary border border-edge hover:border-accent/40 font-bold text-xs sm:text-sm flex items-center gap-2 transition-all cursor-pointer"
                >
                  <LogIn className="w-4 h-4 text-accent" />
                  <span>Sign In</span>
                </button>

                <button
                  type="button"
                  onClick={() => navigate('/browse')}
                  className="px-3.5 py-2 text-xs font-semibold text-secondary hover:text-primary transition-colors cursor-pointer flex items-center gap-1"
                >
                  <Compass className="w-3.5 h-3.5 text-secondary" />
                  <span>Explore as Guest</span>
                  <ChevronRight className="w-3 h-3" />
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => navigate('/library')}
                  className="px-5 py-2.5 rounded-xl bg-accent hover:bg-accent-bright text-accent-fg font-black text-xs sm:text-sm flex items-center gap-2 shadow-md shadow-accent/20 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer group"
                >
                  <BookOpen className="w-4 h-4 stroke-[2.5]" />
                  <span>Go to My Library</span>
                  <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
                </button>

                <button
                  type="button"
                  onClick={() => navigate('/browse')}
                  className="px-4 py-2.5 rounded-xl bg-elevated/80 hover:bg-elevated text-primary border border-edge font-bold text-xs sm:text-sm flex items-center gap-2 transition-all cursor-pointer"
                >
                  <Compass className="w-4 h-4 text-accent" />
                  <span>Discover Series</span>
                </button>

                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface border border-edge text-xs text-secondary font-medium">
                  <span>Welcome back,</span>
                  <span className="font-bold text-primary">{currentUser?.name || 'Reader'}</span>
                  <span>{currentUser?.avatar || '👤'}</span>
                </div>
              </>
            )}
          </div>

          {/* Integrated Minimalist Stats Strip */}
          <div className="pt-4 border-t border-edge/50 flex flex-wrap items-center gap-6 sm:gap-10 text-xs">
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-accent" />
              <span className="font-black text-primary text-sm">
                {stats.totalSeries > 0 ? stats.totalSeries.toLocaleString() : '150+'}
              </span>
              <span className="text-muted">Tracked Series</span>
            </div>

            <div className="flex items-center gap-2">
              <Compass className="w-4 h-4 text-accent" />
              <span className="font-black text-primary text-sm">
                {stats.totalSources > 0 ? stats.totalSources : '14'}
              </span>
              <span className="text-muted">Sources Connected</span>
            </div>

            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
              <span className="font-black text-success text-sm">Live</span>
              <span className="text-muted">Scanner Active</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── CONTINUE READING (if logged in and has in-progress items) ───────── */}
      {!isGuest && continueReadingSeries.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-accent" />
              <h2 className="text-lg font-black text-primary font-display">
                Continue Reading
              </h2>
            </div>
            <button
              onClick={() => navigate('/library')}
              className="text-xs font-bold text-accent hover:underline flex items-center gap-0.5 cursor-pointer"
            >
              <span>View All</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {continueReadingSeries.map((manga) => (
              <div
                key={manga.id}
                onClick={() => onOpenReader(manga, manga.currentChapter + 1)}
                className="group bg-surface/80 border border-edge hover:border-accent/50 rounded-2xl p-2.5 flex gap-3 cursor-pointer shadow-sm hover:shadow-md transition-all active:scale-[0.98]"
              >
                <div className="w-14 h-18 rounded-xl overflow-hidden bg-app shrink-0 relative">
                  <img
                    src={manga.coverImage || FALLBACK_COVER}
                    alt={manga.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = FALLBACK_COVER;
                    }}
                  />
                </div>
                <div className="min-w-0 flex-1 flex flex-col justify-between py-0.5">
                  <div>
                    <h3 className="text-xs font-bold text-primary truncate group-hover:text-accent transition-colors">
                      {manga.title}
                    </h3>
                    <p className="text-[10px] text-muted truncate mt-0.5">
                      Ch. {manga.currentChapter} / {manga.latestChapter}
                    </p>
                  </div>
                  <div className="w-full h-1 bg-app rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent rounded-full"
                      style={{
                        width: `${Math.min(
                          100,
                          Math.round(((manga.currentChapter || 0) / (manga.latestChapter || 1)) * 100)
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── SERIES FEED WITH STREAMLINED TAB TOGGLE ───────────────────────── */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-edge/60 pb-3">
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-xl bg-surface border border-edge p-1 gap-1 text-xs font-bold">
              <button
                type="button"
                onClick={() => setFeedTab('updated')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  feedTab === 'updated'
                    ? 'bg-accent text-accent-fg font-black shadow-xs'
                    : 'text-secondary hover:text-primary'
                }`}
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Newly Updated</span>
              </button>

              <button
                type="button"
                onClick={() => setFeedTab('popular')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  feedTab === 'popular'
                    ? 'bg-accent text-accent-fg font-black shadow-xs'
                    : 'text-secondary hover:text-primary'
                }`}
              >
                <Flame className="w-3.5 h-3.5" />
                <span>Popular &amp; Trending</span>
              </button>
            </div>
          </div>

          <button
            onClick={() => navigate('/browse')}
            className="text-xs font-bold text-secondary hover:text-accent transition-colors flex items-center gap-1 self-start sm:self-auto cursor-pointer"
          >
            <span>Explore All Catalog</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Series Grid */}
        {loading && displayFeed.length === 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-2xl bg-surface/60 border border-edge h-60 animate-pulse p-2.5 space-y-2.5">
                <div className="w-full h-40 bg-app rounded-xl" />
                <div className="h-3 bg-app rounded-full w-3/4" />
                <div className="h-2 bg-app rounded-full w-1/2" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4">
            {displayFeed.slice(0, 12).map((item, idx) => (
              <div
                key={item.id}
                onClick={() => onSelectManga(item)}
                className="group bg-surface/80 border border-edge/80 rounded-2xl overflow-hidden hover:border-accent/60 hover:shadow-lg transition-all duration-200 flex flex-col cursor-pointer card-interactive relative"
              >
                {/* Cover art */}
                <div className="relative aspect-[3/4] w-full bg-app overflow-hidden">
                  <img
                    src={item.coverImage || FALLBACK_COVER}
                    alt={item.title}
                    loading="lazy"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = FALLBACK_COVER;
                    }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent" />

                  {/* Chapter badge */}
                  <span className="absolute top-2 right-2 px-2 py-0.5 rounded-lg bg-black/70 backdrop-blur-xs text-accent-bright border border-accent/30 text-[10px] font-black shadow-xs">
                    Ch. {item.latestChapter || 1}
                  </span>

                  {/* Rank badge (popular tab) */}
                  {feedTab === 'popular' && (
                    <span className="absolute top-2 left-2 w-5 h-5 rounded-md bg-accent-2 text-white text-[10px] font-black flex items-center justify-center shadow-xs">
                      #{idx + 1}
                    </span>
                  )}

                  {/* Quick read button hover overlay */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenReader(item, item.latestChapter || 1);
                    }}
                    className="absolute inset-x-2.5 bottom-2.5 py-1.5 rounded-xl bg-accent hover:bg-accent-bright text-accent-fg font-black text-xs opacity-0 group-hover:opacity-100 transition-all duration-150 flex items-center justify-center gap-1 shadow-md cursor-pointer"
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    <span>Read Now</span>
                  </button>
                </div>

                {/* Series metadata */}
                <div className="p-2.5 flex-1 flex flex-col justify-between space-y-1">
                  <div>
                    <h3 className="text-xs font-bold text-primary line-clamp-1 group-hover:text-accent transition-colors">
                      {item.title}
                    </h3>
                    <p className="text-[10px] text-muted truncate">
                      {item.sourceName || 'Kotatsu'}
                    </p>
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-muted pt-1 border-t border-edge/40">
                    <span className="flex items-center gap-1 text-amber-400 font-bold">
                      <Star className="w-2.5 h-2.5 fill-current" />
                      <span>{item.rating ? item.rating.toFixed(1) : '9.0'}</span>
                    </span>
                    <span className="capitalize">{item.type || 'manhwa'}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── BROWSE BY GENRE & SHELVES (Streamlined Chips) ─────────────────── */}
      <section className="space-y-3 pt-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bookmark className="w-4 h-4 text-accent" />
            <h2 className="text-base font-black text-primary font-display">
              Popular Categories
            </h2>
          </div>
          <button
            onClick={() => navigate('/categories')}
            className="text-xs font-bold text-accent hover:underline flex items-center gap-0.5 cursor-pointer"
          >
            <span>All Shelves</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {topCategories.slice(0, 10).map((cat) => (
            <button
              key={cat.name}
              onClick={() => navigate(`/browse?genre=${encodeURIComponent(cat.name)}`)}
              className="px-3 py-1.5 rounded-xl bg-surface hover:bg-elevated border border-edge hover:border-accent/40 text-xs font-semibold text-secondary hover:text-primary transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <span>{cat.name}</span>
              <span className="text-[10px] text-muted">{cat.count}</span>
            </button>
          ))}
        </div>
      </section>

      {/* ── STREAMLINED FEATURE STRIP ──────────────────────────────────────── */}
      <section className="pt-4 border-t border-edge/50">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="p-3.5 rounded-2xl bg-surface/50 border border-edge flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-accent/10 text-accent flex items-center justify-center shrink-0">
              <RefreshCw className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h4 className="text-xs font-bold text-primary">Multi-Source Sync</h4>
              <p className="text-[11px] text-muted truncate">Real-time chapter updates</p>
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-surface/50 border border-edge flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-info/10 text-info flex items-center justify-center shrink-0">
              <Download className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h4 className="text-xs font-bold text-primary">Offline Vault</h4>
              <p className="text-[11px] text-muted truncate">CBZ offline downloads</p>
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-surface/50 border border-edge flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-rose-500/10 text-rose-400 flex items-center justify-center shrink-0">
              <Users className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h4 className="text-xs font-bold text-primary">Manga Together</h4>
              <p className="text-[11px] text-muted truncate">Live co-reading rooms</p>
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-surface/50 border border-edge flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-success/10 text-success flex items-center justify-center shrink-0">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h4 className="text-xs font-bold text-primary">Incognito &amp; Lock</h4>
              <p className="text-[11px] text-muted truncate">PIN protection &amp; privacy</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
