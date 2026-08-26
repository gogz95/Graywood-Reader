import React, { useState, useEffect } from 'react';
import {
  X,
  Globe,
  CheckCircle,
  RefreshCw,
  Search,
  ExternalLink,
  ShieldCheck,
  AlertTriangle,
  Zap,
  ArrowRight,
  Layers,
} from 'lucide-react';
import { MangaItem, MangaSourceLink } from '../../types';
import { apiFetch } from '../../utils/api';

export interface MirrorSourceModalProps {
  manga: MangaItem;
  currentChapterNum: number;
  activeSourceUrl: string;
  activeSourceName: string;
  onClose: () => void;
  onSelectSource: (sourceName: string, sourceUrl: string, persistToDatabase: boolean) => void;
}

export const MirrorSourceModal: React.FC<MirrorSourceModalProps> = ({
  manga,
  currentChapterNum,
  activeSourceUrl,
  activeSourceName,
  onClose,
  onSelectSource,
}) => {
  const [sourcesList, setSourcesList] = useState<MangaSourceLink[]>(() => {
    const list: MangaSourceLink[] = [];
    if (manga.sourceUrl) {
      list.push({
        sourceName: manga.sourceName || 'Primary Source',
        sourceUrl: manga.sourceUrl,
      });
    }
    if (manga.availableSources && manga.availableSources.length > 0) {
      for (const s of manga.availableSources) {
        if (!list.some((item) => item.sourceUrl === s.sourceUrl)) {
          list.push(s);
        }
      }
    }
    return list;
  });

  useEffect(() => {
    let isMounted = true;
    apiFetch(`/api/reader/sources/${encodeURIComponent(manga.id)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!isMounted || !data) return;
        const validList: MangaSourceLink[] = [];
        if (data.primarySource) {
          validList.push({
            sourceName: manga.sourceName || 'Primary Source',
            sourceUrl: data.primarySource,
          });
        }
        if (Array.isArray(data.sources)) {
          for (const s of data.sources) {
            if (s.sourceUrl && !validList.some((item) => item.sourceUrl === s.sourceUrl)) {
              validList.push(s);
            }
          }
        }
        if (validList.length > 0) {
          setSourcesList(validList);
        }
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, [manga.id, manga.sourceName]);

  const [searchQuery, setSearchQuery] = useState<string>(manga.title || '');
  const [searching, setSearching] = useState<boolean>(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [testingUrl, setTestingUrl] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string; pageCount?: number }>>({});
  const [persistChanges, setPersistChanges] = useState<boolean>(true);

  // Perform multi-source discovery search if requested
  const handleSearchMirrors = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await apiFetch(`/api/explore/search?query=${encodeURIComponent(searchQuery.trim())}`);
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data.results || []);
      }
    } catch (err) {
      console.error('Failed to search mirror sources', err);
    } finally {
      setSearching(false);
    }
  };

  const handleTestChapter = async (url: string, name: string) => {
    setTestingUrl(url);
    try {
      const testRes = await apiFetch(
        `/api/reader/chapter-pages?mangaId=${encodeURIComponent(manga.id)}&chapterNumber=${currentChapterNum}&url=${encodeURIComponent(url)}&title=${encodeURIComponent(manga.title)}`
      );
      if (testRes.ok) {
        const data = await testRes.json();
        if (data.pages && data.pages.length > 0 && !data.isPlaceholder) {
          setTestResults((prev) => ({
            ...prev,
            [url]: {
              ok: true,
              message: `Found ${data.pages.length} pages ready`,
              pageCount: data.pages.length,
            },
          }));
        } else {
          setTestResults((prev) => ({
            ...prev,
            [url]: {
              ok: false,
              message: data.loadError || 'Chapter unavailable on this mirror',
            },
          }));
        }
      } else {
        setTestResults((prev) => ({
          ...prev,
          [url]: {
            ok: false,
            message: `HTTP ${testRes.status} Error`,
          },
        }));
      }
    } catch (err: any) {
      setTestResults((prev) => ({
        ...prev,
        [url]: {
          ok: false,
          message: err.message || 'Connection failed',
        },
      }));
    } finally {
      setTestingUrl(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="bg-surface border border-edge/80 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-edge flex items-center justify-between bg-elevated/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-accent/20 text-accent">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-primary flex items-center gap-2">
                Mirror & Source Switcher
                <span className="text-xs px-2 py-0.5 rounded-full bg-accent/15 text-accent font-semibold">
                  Ch. {currentChapterNum}
                </span>
              </h2>
              <p className="text-xs text-secondary">
                Switch scanlation mirror or fallback provider without leaving the reader
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-elevated text-secondary hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto space-y-4 flex-1">
          {/* Active / Known Sources */}
          <div>
            <h3 className="text-xs font-bold text-secondary uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5" />
              Known Series Sources ({sourcesList.length})
            </h3>
            <div className="space-y-2">
              {sourcesList.map((src, idx) => {
                const isActive = src.sourceUrl === activeSourceUrl || src.sourceName === activeSourceName;
                const test = testResults[src.sourceUrl];
                const isTesting = testingUrl === src.sourceUrl;

                return (
                  <div
                    key={idx}
                    className={`p-3 rounded-xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                      isActive
                        ? 'bg-accent/10 border-accent/60 shadow-sm'
                        : 'bg-elevated/40 border-edge hover:border-edge/90'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-primary truncate">{src.sourceName}</span>
                        {isActive && (
                          <span className="text-[10px] bg-accent text-accent-fg font-bold px-2 py-0.5 rounded-full">
                            Active
                          </span>
                        )}
                        {test && (
                          <span
                            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                              test.ok
                                ? 'bg-success/20 text-success border border-success/30'
                                : 'bg-danger/20 text-danger border border-danger/30'
                            }`}
                          >
                            {test.message}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-secondary/70 truncate mt-0.5 font-mono">{src.sourceUrl}</p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleTestChapter(src.sourceUrl, src.sourceName)}
                        disabled={isTesting}
                        className="px-2.5 py-1.5 rounded-lg bg-surface hover:bg-elevated text-xs font-semibold text-secondary hover:text-primary border border-edge transition-all flex items-center gap-1"
                        title="Test if Chapter is available on this mirror"
                      >
                        {isTesting ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin text-accent" />
                        ) : (
                          <Zap className="w-3.5 h-3.5 text-accent" />
                        )}
                        <span>{isTesting ? 'Testing...' : 'Test'}</span>
                      </button>

                      <button
                        onClick={() => onSelectSource(src.sourceName, src.sourceUrl, persistChanges)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                          isActive
                            ? 'bg-accent/30 text-accent cursor-default'
                            : 'bg-accent hover:bg-accent-bright text-accent-fg shadow-md'
                        }`}
                      >
                        {isActive ? <CheckCircle className="w-3.5 h-3.5" /> : <ArrowRight className="w-3.5 h-3.5" />}
                        <span>{isActive ? 'Current' : 'Switch Source'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Live Multi-Source Search */}
          <div className="pt-3 border-t border-edge">
            <h3 className="text-xs font-bold text-secondary uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Search className="w-3.5 h-3.5" />
              Find on Alternative Kotatsu / MangaDex Mirrors
            </h3>
            <div className="flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearchMirrors()}
                placeholder="Search title on other providers..."
                className="flex-1 px-3 py-2 rounded-xl bg-elevated border border-edge text-primary text-xs focus:outline-none focus:border-accent"
              />
              <button
                onClick={handleSearchMirrors}
                disabled={searching || !searchQuery.trim()}
                className="px-4 py-2 rounded-xl bg-elevated hover:bg-elevated/80 text-primary border border-edge text-xs font-bold flex items-center gap-1.5 transition-all disabled:opacity-50"
              >
                {searching ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                <span>Search</span>
              </button>
            </div>

            {/* Search Results */}
            {searchResults.length > 0 && (
              <div className="mt-3 space-y-2 max-h-48 overflow-y-auto pr-1">
                {searchResults.map((item, idx) => (
                  <div
                    key={idx}
                    className="p-2.5 rounded-xl bg-elevated/30 border border-edge hover:border-accent/40 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-bold text-primary truncate">{item.title}</div>
                      <div className="text-secondary/70 flex items-center gap-1.5 text-[11px]">
                        <span className="text-accent font-semibold">{item.sourceName}</span>
                        {item.latestChapter && <span>• Latest Ch. {item.latestChapter}</span>}
                      </div>
                    </div>
                    <button
                      onClick={() => onSelectSource(item.sourceName, item.sourceUrl, persistChanges)}
                      className="px-2.5 py-1.5 rounded-lg bg-accent hover:bg-accent-bright text-accent-fg font-bold text-xs shrink-0 flex items-center gap-1"
                    >
                      <ArrowRight className="w-3.5 h-3.5" />
                      <span>Use This</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-3.5 border-t border-edge bg-elevated/30 flex items-center justify-between">
          <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-secondary hover:text-primary">
            <input
              type="checkbox"
              checked={persistChanges}
              onChange={(e) => setPersistChanges(e.target.checked)}
              className="rounded border-edge text-accent focus:ring-accent w-3.5 h-3.5"
            />
            <span>Set as primary source in library database</span>
          </label>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-elevated hover:bg-elevated/80 text-secondary hover:text-primary text-xs font-bold transition-all"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
