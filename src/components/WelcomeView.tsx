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
  Layers,
  Download,
  Users,
  ShieldCheck,
  ChevronRight,
  TrendingUp,
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
                totalChapters: libraryManga.reduce((acc, m) => acc + (Number(m.latestChapter) || 0), 0),
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
              totalChapters: libraryManga.reduce((acc, m) => acc + (m.latestChapter || 0), 0),
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

  return (
    <div className="space-y-12 pb-16">
      {/* ── HERO BANNER ──────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-b from-surface/90 via-surface/60 to-app border border-edge/80 p-6 sm:p-10 lg:p-12 shadow-2xl">
        {/* Glow ambient background accents */}
        <div className="absolute top-0 right-1/4 -translate-y-1/2 w-96 h-96 bg-accent/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-10 translate-y-1/3 w-80 h-80 bg-accent-2/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 max-w-4xl space-y-6">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-accent/10 border border-accent/25 text-accent text-xs font-black tracking-wide uppercase shadow-inner">
            <Sparkles className="w-3.5 h-3.5 text-accent-bright animate-pulse" />
            <span>Self-Hosted Manga &amp; Webtoon Hub</span>
          </div>

          {/* Headline */}
          <div className="space-y-3">
            <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black font-display tracking-tight text-primary leading-[1.1]">
              Read, Track, and Discover <br />
              <span className="text-accent-grad">Without Interruptions.</span>
            </h1>
            <p className="text-sm sm:text-base lg:text-lg text-secondary max-w-2xl font-normal leading-relaxed">
              Auto-aggregate releases across multiple top sources, read seamless webtoons on any device, download for offline travels, and keep your reading history synchronized.
            </p>
          </div>

          {/* Call to Action Buttons */}
          <div className="pt-2 flex flex-wrap items-center gap-3 sm:gap-4">
            {isGuest ? (
              <>
                <button
                  type="button"
                  onClick={() => onOpenAuthModal('register')}
                  className="px-6 py-3.5 rounded-2xl bg-gradient-to-r from-accent via-accent-bright to-accent text-accent-fg font-black text-sm sm:text-base flex items-center gap-2.5 shadow-xl shadow-accent/25 hover:shadow-accent/40 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer group"
                >
                  <UserPlus className="w-4 h-4 sm:w-5 sm:h-5 stroke-[2.5]" />
                  <span>Register Now</span>
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                </button>

                <button
                  type="button"
                  onClick={() => onOpenAuthModal('login')}
                  className="px-6 py-3.5 rounded-2xl bg-elevated/80 hover:bg-elevated text-primary border border-edge-strong hover:border-accent/40 font-bold text-sm sm:text-base flex items-center gap-2.5 shadow-lg active:scale-[0.98] transition-all cursor-pointer"
                >
                  <LogIn className="w-4 h-4 sm:w-5 sm:h-5 text-accent" />
                  <span>Sign In</span>
                </button>

                <button
                  type="button"
                  onClick={() => navigate('/browse')}
                  className="px-4 py-3.5 rounded-2xl text-secondary hover:text-primary font-bold text-xs sm:text-sm flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Compass className="w-4 h-4 text-secondary" />
                  <span>Explore as Guest</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => navigate('/library')}
                  className="px-6 py-3.5 rounded-2xl bg-gradient-to-r from-accent to-accent-bright text-accent-fg font-black text-sm sm:text-base flex items-center gap-2.5 shadow-xl shadow-accent/25 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer group"
                >
                  <BookOpen className="w-4 h-4 sm:w-5 sm:h-5 stroke-[2.5]" />
                  <span>Go to My Library</span>
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                </button>

                <button
                  type="button"
                  onClick={() => navigate('/browse')}
                  className="px-6 py-3.5 rounded-2xl bg-elevated/80 hover:bg-elevated text-primary border border-edge-strong hover:border-accent/40 font-bold text-sm sm:text-base flex items-center gap-2.5 shadow-lg active:scale-[0.98] transition-all cursor-pointer"
                >
                  <Compass className="w-4 h-4 sm:w-5 sm:h-5 text-accent" />
                  <span>Discover New Series</span>
                </button>

                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-app/50 border border-edge text-xs text-secondary font-medium">
                  <span>Welcome back,</span>
                  <span className="font-bold text-primary">{currentUser?.name || 'Reader'}</span>
                  <span>{currentUser?.avatar || '👤'}</span>
                </div>
              </>
            )}
          </div>

          {/* Quick System Stats Counters */}
          <div className="pt-6 border-t border-edge/60 grid grid-cols-2 sm:grid-cols-3 gap-4 sm:gap-6">
            <div className="space-y-1">
              <div className="text-2xl sm:text-3xl font-black font-display text-primary">
                {stats.totalSeries > 0 ? stats.totalSeries.toLocaleString() : '150+'}
              </div>
              <div className="text-xs text-muted font-medium flex items-center gap-1.5">
                <BookOpen className="w-3 h-3 text-accent" />
                <span>Tracked Series</span>
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-2xl sm:text-3xl font-black font-display text-primary">
                {stats.totalSources > 0 ? stats.totalSources : '14'}
              </div>
              <div className="text-xs text-muted font-medium flex items-center gap-1.5">
                <Compass className="w-3 h-3 text-accent" />
                <span>Scraper Sources</span>
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-2xl sm:text-3xl font-black font-display text-success flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-success animate-ping" />
                <span>Live</span>
              </div>
              <div className="text-xs text-muted font-medium flex items-center gap-1.5">
                <CheckCircle2 className="w-3 h-3 text-success" />
                <span>Auto-Scanner Active</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── CONTINUE READING (if logged in and has in-progress items) ───────── */}
      {!isGuest && continueReadingSeries.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-accent" />
              <h2 className="text-xl sm:text-2xl font-black text-primary font-display">
                Continue Reading
              </h2>
            </div>
            <button
              onClick={() => navigate('/library')}
              className="text-xs font-bold text-accent hover:underline flex items-center gap-1 cursor-pointer"
            >
              <span>View All</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {continueReadingSeries.map((manga) => (
              <div
                key={manga.id}
                onClick={() => onOpenReader(manga, manga.currentChapter + 1)}
                className="group relative bg-surface border border-edge hover:border-accent/60 rounded-2xl overflow-hidden p-3 flex gap-3 cursor-pointer shadow-lg hover:shadow-2xl transition-all duration-300 active:scale-[0.98]"
              >
                <div className="w-16 h-22 rounded-xl overflow-hidden bg-app shrink-0 relative">
                  <img
                    src={manga.coverImage || FALLBACK_COVER}
                    alt={manga.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = FALLBACK_COVER;
                    }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                </div>
                <div className="min-w-0 flex-1 flex flex-col justify-between py-0.5">
                  <div>
                    <h3 className="text-xs font-bold text-primary truncate group-hover:text-accent transition-colors">
                      {manga.title}
                    </h3>
                    <p className="text-[11px] text-muted truncate mt-0.5">
                      {manga.sourceName || 'Kotatsu Source'}
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-accent font-bold">Ch. {manga.currentChapter}</span>
                      <span className="text-muted">of {manga.latestChapter}</span>
                    </div>
                    <div className="w-full h-1.5 bg-app rounded-full overflow-hidden border border-edge/60">
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
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── NEWLY UPDATED SERIES ──────────────────────────────────────────── */}
      <section className="space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-accent/15 text-accent">
                <RefreshCw className="w-4 h-4 stroke-[2.5]" />
              </div>
              <h2 className="text-xl sm:text-2xl font-black text-primary font-display">
                Newly Updated Series
              </h2>
            </div>
            <p className="text-xs sm:text-sm text-muted">
              Fresh chapters published across tracked scanlators and official sources
            </p>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            <button
              onClick={() => navigate('/browse')}
              className="px-3.5 py-1.5 rounded-xl bg-elevated/70 hover:bg-elevated text-secondary hover:text-primary border border-edge text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <span>Explore All Catalog</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {loading && newlyUpdated.length === 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-2xl bg-surface/60 border border-edge h-64 animate-pulse p-3 space-y-3">
                <div className="w-full h-44 bg-app rounded-xl" />
                <div className="h-3 bg-app rounded-full w-3/4" />
                <div className="h-2.5 bg-app rounded-full w-1/2" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4">
            {newlyUpdated.slice(0, 12).map((item) => (
              <div
                key={item.id}
                onClick={() => onSelectManga(item)}
                className="group bg-surface/90 border border-edge/80 rounded-2xl overflow-hidden hover:border-accent/60 hover:shadow-xl transition-all duration-300 flex flex-col cursor-pointer card-interactive relative"
              >
                {/* Cover art */}
                <div className="relative aspect-[3/4] w-full bg-app overflow-hidden">
                  <img
                    src={item.coverImage || FALLBACK_COVER}
                    alt={item.title}
                    loading="lazy"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = FALLBACK_COVER;
                    }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

                  {/* Chapter badge */}
                  <span className="absolute top-2 right-2 px-2 py-0.5 rounded-lg bg-accent text-accent-fg text-[10px] font-black shadow-md">
                    Ch. {item.latestChapter || 1}
                  </span>

                  {/* Type badge */}
                  {item.type && (
                    <span className="absolute top-2 left-2 px-2 py-0.5 rounded-lg bg-black/60 backdrop-blur-xs text-white/90 text-[10px] font-bold uppercase tracking-wider border border-white/10">
                      {item.type}
                    </span>
                  )}

                  {/* Quick read button hover overlay */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenReader(item, item.latestChapter || 1);
                    }}
                    className="absolute inset-x-3 bottom-3 py-2 rounded-xl bg-accent hover:bg-accent-bright text-accent-fg font-black text-xs opacity-0 group-hover:opacity-100 transition-all duration-200 flex items-center justify-center gap-1.5 shadow-lg cursor-pointer transform translate-y-2 group-hover:translate-y-0"
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    <span>Read Latest</span>
                  </button>
                </div>

                {/* Series metadata */}
                <div className="p-3 flex-1 flex flex-col justify-between space-y-1.5">
                  <div>
                    <h3 className="text-xs sm:text-sm font-bold text-primary line-clamp-1 group-hover:text-accent transition-colors">
                      {item.title}
                    </h3>
                    <p className="text-[11px] text-muted truncate">
                      {item.sourceName || 'Kotatsu Source'}
                    </p>
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-muted pt-1 border-t border-edge/40">
                    <span className="flex items-center gap-1 text-accent font-bold">
                      <Sparkles className="w-3 h-3 text-accent" />
                      <span>Updated</span>
                    </span>
                    <span className="truncate">
                      {item.lastUpdated
                        ? new Date(item.lastUpdated).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                        : 'Recent'}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── POPULAR & TRENDING SERIES ─────────────────────────────────────── */}
      <section className="space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-rose-500/15 text-rose-400">
                <Flame className="w-4 h-4 stroke-[2.5]" />
              </div>
              <h2 className="text-xl sm:text-2xl font-black text-primary font-display">
                Popular &amp; Trending
              </h2>
            </div>
            <p className="text-xs sm:text-sm text-muted">
              Top-rated community favorites, massive hit manhwas, and must-read series
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('/browse')}
              className="px-3.5 py-1.5 rounded-xl bg-elevated/70 hover:bg-elevated text-secondary hover:text-primary border border-edge text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <TrendingUp className="w-3.5 h-3.5 text-accent" />
              <span>Full Popularity Rank</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4">
          {popularSeries.slice(0, 12).map((item, idx) => (
            <div
              key={item.id}
              onClick={() => onSelectManga(item)}
              className="group bg-surface/90 border border-edge/80 rounded-2xl overflow-hidden hover:border-accent/60 hover:shadow-xl transition-all duration-300 flex flex-col cursor-pointer card-interactive relative"
            >
              {/* Rank pill */}
              <div className="relative aspect-[3/4] w-full bg-app overflow-hidden">
                <img
                  src={item.coverImage || FALLBACK_COVER}
                  alt={item.title}
                  loading="lazy"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = FALLBACK_COVER;
                  }}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />

                {/* Rating badge */}
                <span className="absolute top-2 right-2 px-2 py-0.5 rounded-lg bg-black/70 backdrop-blur-xs text-amber-300 text-[10px] font-black flex items-center gap-1 border border-amber-500/30">
                  <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                  <span>{item.rating ? item.rating.toFixed(1) : '9.0'}</span>
                </span>

                {/* Popularity rank badge */}
                <span className="absolute top-2 left-2 w-6 h-6 rounded-lg bg-accent-2/90 text-white text-[11px] font-black flex items-center justify-center shadow-md">
                  #{idx + 1}
                </span>

                {/* Quick read button hover overlay */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenReader(item, 1);
                  }}
                  className="absolute inset-x-3 bottom-3 py-2 rounded-xl bg-accent hover:bg-accent-bright text-accent-fg font-black text-xs opacity-0 group-hover:opacity-100 transition-all duration-200 flex items-center justify-center gap-1.5 shadow-lg cursor-pointer transform translate-y-2 group-hover:translate-y-0"
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  <span>Read Ch. 1</span>
                </button>
              </div>

              {/* Info */}
              <div className="p-3 flex-1 flex flex-col justify-between space-y-1.5">
                <div>
                  <h3 className="text-xs sm:text-sm font-bold text-primary line-clamp-1 group-hover:text-accent transition-colors">
                    {item.title}
                  </h3>
                  <div className="flex items-center gap-1.5 text-[11px] text-muted mt-0.5 truncate">
                    <span>{item.type || 'manhwa'}</span>
                    <span>•</span>
                    <span className="text-accent font-semibold">{item.latestChapter || 0} Ch.</span>
                  </div>
                </div>

                {item.genres && item.genres.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {item.genres.slice(0, 2).map((g) => (
                      <span
                        key={g}
                        className="px-1.5 py-0.5 rounded-md bg-app border border-edge text-[9px] text-secondary font-medium"
                      >
                        {g}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── BROWSE BY CATEGORY & GENRE ─────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-accent-2/15 text-accent-2">
              <Bookmark className="w-4 h-4 stroke-[2.5]" />
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-primary font-display">
              Browse by Categories &amp; Genres
            </h2>
          </div>
          <button
            onClick={() => navigate('/categories')}
            className="text-xs font-bold text-accent hover:underline flex items-center gap-1 cursor-pointer"
          >
            <span>All Categories &amp; Shelves</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex flex-wrap gap-2.5">
          {topCategories.map((cat) => (
            <button
              key={cat.name}
              onClick={() => navigate(`/browse?genre=${encodeURIComponent(cat.name)}`)}
              className="px-4 py-2 rounded-xl bg-surface hover:bg-elevated border border-edge hover:border-accent/40 text-xs font-bold text-secondary hover:text-primary transition-all flex items-center gap-2 cursor-pointer shadow-xs active:scale-95"
            >
              <span>{cat.name}</span>
              <span className="px-1.5 py-0.2 rounded-full bg-app text-[10px] text-muted border border-edge/60">
                {cat.count}
              </span>
            </button>
          ))}

          <button
            onClick={() => navigate('/categories')}
            className="px-4 py-2 rounded-xl bg-accent/15 hover:bg-accent/25 border border-accent/30 text-xs font-black text-accent transition-all flex items-center gap-1.5 cursor-pointer shadow-xs"
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Manage Shelves &amp; Categories</span>
          </button>
        </div>
      </section>

      {/* ── FEATURE CAPABILITIES SPOTLIGHT ─────────────────────────────────── */}
      <section className="pt-4 border-t border-edge/60">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-5 rounded-2xl bg-surface/60 border border-edge space-y-2 hover:border-accent/40 transition-colors">
            <div className="w-10 h-10 rounded-xl bg-accent/10 text-accent flex items-center justify-center">
              <RefreshCw className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-black text-primary">Multi-Source Sync</h3>
            <p className="text-xs text-muted leading-relaxed">
              Real-time chapter scanner tracks releases across AsuraScans, FlameComics, MangaDex, and Kotatsu engines.
            </p>
          </div>

          <div className="p-5 rounded-2xl bg-surface/60 border border-edge space-y-2 hover:border-accent/40 transition-colors">
            <div className="w-10 h-10 rounded-xl bg-info/10 text-info flex items-center justify-center">
              <Download className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-black text-primary">Offline CBZ Downloads</h3>
            <p className="text-xs text-muted leading-relaxed">
              Store complete series or chapters locally in your private offline vault for flights and commutes.
            </p>
          </div>

          <div className="p-5 rounded-2xl bg-surface/60 border border-edge space-y-2 hover:border-accent/40 transition-colors">
            <div className="w-10 h-10 rounded-xl bg-rose-500/10 text-rose-400 flex items-center justify-center">
              <Users className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-black text-primary">Manga Together</h3>
            <p className="text-xs text-muted leading-relaxed">
              Synchronize reading sessions with friends in co-reading rooms with live page sync and room chat.
            </p>
          </div>

          <div className="p-5 rounded-2xl bg-surface/60 border border-edge space-y-2 hover:border-accent/40 transition-colors">
            <div className="w-10 h-10 rounded-xl bg-success/10 text-success flex items-center justify-center">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-black text-primary">Incognito &amp; PIN Lock</h3>
            <p className="text-xs text-muted leading-relaxed">
              Private browsing sessions, discreet cover art filters, and password-protected application lock.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};
