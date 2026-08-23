import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Search,
  BookOpen,
  Compass,
  Globe,
  RefreshCw,
  EyeOff,
  Calendar,
  Trophy,
  Puzzle,
  Sliders,
  Bug,
  Plus,
  ArrowRight,
  Sparkles,
  X,
} from 'lucide-react';
import { MangaItem, AppNavTab } from '../types';

export interface CommandPaletteAction {
  id: string;
  title: string;
  subtitle?: string;
  category: 'navigation' | 'action' | 'series';
  icon: React.ComponentType<{ className?: string }>;
  shortcut?: string;
  badge?: string;
  manga?: MangaItem;
  run: () => void;
}

export interface CommandPaletteModalProps {
  isOpen: boolean;
  onClose: () => void;
  mangaList: MangaItem[];
  activeTab: AppNavTab;
  setActiveTab: (tab: AppNavTab) => void;
  isIncognito: boolean;
  onToggleIncognito: () => void;
  onOpenAddModal: () => void;
  onRunAutoUpdate: () => void;
  onOpenSettingsModal: () => void;
  onOpenAnalytics: () => void;
  onOpenAchievements?: () => void;
  onOpenExtensionManager?: () => void;
  onOpenSubmitBugModal?: () => void;
  onSelectManga: (manga: MangaItem) => void;
  onOpenReader?: (manga: MangaItem, chapterNum: number) => void;
}

export const CommandPaletteModal: React.FC<CommandPaletteModalProps> = ({
  isOpen,
  onClose,
  mangaList,
  setActiveTab,
  isIncognito,
  onToggleIncognito,
  onOpenAddModal,
  onRunAutoUpdate,
  onOpenSettingsModal,
  onOpenAnalytics,
  onOpenAchievements,
  onOpenExtensionManager,
  onOpenSubmitBugModal,
  onSelectManga,
  onOpenReader,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-focus input on open and reset state
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  // Static built-in commands
  const defaultActions: CommandPaletteAction[] = useMemo(() => [
    {
      id: 'nav-library',
      title: 'Go to My Library',
      subtitle: 'View your favorited series and reading collection',
      category: 'navigation',
      icon: BookOpen,
      shortcut: 'Tab 1',
      run: () => {
        setActiveTab('library');
        onClose();
      },
    },
    {
      id: 'nav-browse',
      title: 'Browse Catalog',
      subtitle: 'Explore trending and newly added series across sources',
      category: 'navigation',
      icon: Compass,
      shortcut: 'Tab 2',
      run: () => {
        setActiveTab('browse');
        onClose();
      },
    },
    {
      id: 'nav-sources',
      title: 'Manage Scraper Engines & Connectors',
      subtitle: 'Configure 1,180+ Kotatsu, Madara & MangaThemesia sources',
      category: 'navigation',
      icon: Globe,
      shortcut: 'Tab 3',
      run: () => {
        setActiveTab('sources');
        onClose();
      },
    },
    {
      id: 'action-add',
      title: 'Add New Series',
      subtitle: 'Add a new manga, manhwa, or manhua by URL or title',
      category: 'action',
      icon: Plus,
      run: () => {
        onClose();
        onOpenAddModal();
      },
    },
    {
      id: 'action-update',
      title: 'Run Automatic Chapter Update Scan',
      subtitle: 'Check active sources for newly released chapters',
      category: 'action',
      icon: RefreshCw,
      run: () => {
        onClose();
        onRunAutoUpdate();
      },
    },
    {
      id: 'action-incognito',
      title: isIncognito ? 'Disable Incognito Mode' : 'Enable Incognito Private Mode',
      subtitle: isIncognito ? 'Resume recording reading progress and history' : 'Read privately without saving progress or history',
      category: 'action',
      icon: EyeOff,
      badge: isIncognito ? 'ON' : 'OFF',
      run: () => {
        onToggleIncognito();
        onClose();
      },
    },
    {
      id: 'action-analytics',
      title: 'Reading Activity Heatmap & Analytics',
      subtitle: 'View chapters read, favorite genres, and streaks',
      category: 'action',
      icon: Calendar,
      run: () => {
        onClose();
        onOpenAnalytics();
      },
    },
    ...(onOpenAchievements ? [{
      id: 'action-achievements',
      title: 'Reading Achievements & Manga Wrapped',
      subtitle: 'Inspect earned trophies and annual recap stats',
      category: 'action' as const,
      icon: Trophy,
      run: () => {
        onClose();
        onOpenAchievements();
      },
    }] : []),
    ...(onOpenExtensionManager ? [{
      id: 'action-extensions',
      title: 'Community Extension Store & Scraper Studio',
      subtitle: 'Install custom source definitions and test CSS selectors',
      category: 'action' as const,
      icon: Puzzle,
      run: () => {
        onClose();
        onOpenExtensionManager();
      },
    }] : []),
    {
      id: 'action-settings',
      title: 'Settings & Storage Management',
      subtitle: 'Configure automated backups, theme tokens, and scrobblers',
      category: 'action',
      icon: Sliders,
      run: () => {
        onClose();
        onOpenSettingsModal();
      },
    },
    ...(onOpenSubmitBugModal ? [{
      id: 'action-bug',
      title: 'Report Bug / Flag Source Issue',
      subtitle: 'Submit an issue report or request a parser repair',
      category: 'action' as const,
      icon: Bug,
      run: () => {
        onClose();
        onOpenSubmitBugModal();
      },
    }] : []),
  ], [
    setActiveTab,
    onClose,
    onOpenAddModal,
    onRunAutoUpdate,
    isIncognito,
    onToggleIncognito,
    onOpenAnalytics,
    onOpenAchievements,
    onOpenExtensionManager,
    onOpenSettingsModal,
    onOpenSubmitBugModal,
  ]);

  // Series actions derived from mangaList
  const filteredSeriesActions: CommandPaletteAction[] = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase().trim();
    return mangaList
      .filter((m) => {
        const titleMatch = m.title.toLowerCase().includes(q);
        const altMatch = m.altTitles?.some((t) => t.toLowerCase().includes(q));
        const genreMatch = m.genres?.some((g) => g.toLowerCase().includes(q));
        const sourceMatch = m.sourceName?.toLowerCase().includes(q);
        const descMatch = m.description?.toLowerCase().includes(q);
        return titleMatch || altMatch || genreMatch || sourceMatch || descMatch;
      })
      .slice(0, 12)
      .map((m) => ({
        id: `series-${m.id}`,
        title: m.title,
        subtitle: `${m.sourceName || 'Unknown Source'} · Ch. ${m.currentChapter || 0}/${m.latestChapter || 0}${m.genres?.length ? ` · ${m.genres.slice(0, 2).join(', ')}` : ''}`,
        category: 'series' as const,
        icon: BookOpen,
        badge: m.isFavorite ? 'In Library' : undefined,
        manga: m,
        run: () => {
          onClose();
          onSelectManga(m);
        },
      }));
  }, [mangaList, query, onClose, onSelectManga]);

  // Filtered built-in commands
  const filteredDefaultActions = useMemo(() => {
    if (!query.trim()) return defaultActions;
    const q = query.toLowerCase().trim();
    return defaultActions.filter((a) =>
      a.title.toLowerCase().includes(q) || (a.subtitle && a.subtitle.toLowerCase().includes(q))
    );
  }, [defaultActions, query]);

  // Combined results list
  const allResults = useMemo(() => {
    return [...filteredSeriesActions, ...filteredDefaultActions];
  }, [filteredSeriesActions, filteredDefaultActions]);

  // Ensure selectedIndex is within range
  useEffect(() => {
    if (selectedIndex >= allResults.length) {
      setSelectedIndex(Math.max(0, allResults.length - 1));
    }
  }, [allResults, selectedIndex]);

  // Keyboard navigation inside modal
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < allResults.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : allResults.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (allResults[selectedIndex]) {
        allResults[selectedIndex].run();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  // Scroll active item into view
  useEffect(() => {
    const listEl = listRef.current;
    if (!listEl) return;
    const activeItem = listEl.querySelector(`[data-index="${selectedIndex}"]`) as HTMLElement;
    if (activeItem) {
      activeItem.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-start justify-center p-3 sm:p-6 pt-[10vh] sm:pt-[12vh]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-surface/95 border border-edge-strong/70 rounded-2xl shadow-2xl overflow-hidden flex flex-col glass-modal transition-all animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Header */}
        <div className="relative border-b border-edge/80 px-4 py-3.5 flex items-center gap-3 bg-app/60">
          <Search className="w-5 h-5 text-accent shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Type a title, author, source, or command..."
            className="w-full bg-transparent border-0 text-sm sm:text-base text-primary placeholder-muted focus:outline-none focus:ring-0"
          />
          {query && (
            <button
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
              className="p-1 rounded-lg text-secondary hover:text-primary hover:bg-elevated/70"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <kbd className="hidden sm:flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono text-muted bg-elevated/80 border border-edge/60">
            ESC
          </kbd>
        </div>

        {/* Results Container */}
        <div ref={listRef} className="max-h-[60vh] overflow-y-auto p-2 space-y-1">
          {allResults.length === 0 ? (
            <div className="py-12 text-center text-muted text-xs sm:text-sm">
              <p>No commands or series match <span className="text-primary font-semibold">"{query}"</span></p>
            </div>
          ) : (
            <>
              {/* Series Group */}
              {filteredSeriesActions.length > 0 && (
                <div className="pb-1">
                  <div className="px-3 py-1.5 text-[11px] font-bold text-muted uppercase tracking-wider flex items-center justify-between">
                    <span>Manga Series ({filteredSeriesActions.length})</span>
                    <span className="text-[10px] font-normal text-muted/80">Press Enter to view</span>
                  </div>
                  {filteredSeriesActions.map((action, idx) => {
                    const isSelected = selectedIndex === idx;
                    const Icon = action.icon;
                    return (
                      <button
                        key={action.id}
                        data-index={idx}
                        onClick={action.run}
                        onMouseEnter={() => setSelectedIndex(idx)}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-left transition-all ${
                          isSelected
                            ? 'bg-accent text-accent-fg shadow-md font-semibold'
                            : 'text-primary hover:bg-elevated/60'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {action.manga?.coverImage ? (
                            <img
                              src={action.manga.coverImage}
                              alt={action.title}
                              className="w-8 h-11 object-cover rounded-md shadow-sm shrink-0"
                              loading="lazy"
                            />
                          ) : (
                            <div className={`p-2 rounded-lg shrink-0 ${isSelected ? 'bg-accent-fg/20' : 'bg-elevated'}`}>
                              <Icon className="w-4 h-4" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="text-xs sm:text-sm font-bold truncate">
                              {action.title}
                            </div>
                            {action.subtitle && (
                              <div className={`text-[11px] truncate ${isSelected ? 'text-accent-fg/80' : 'text-secondary'}`}>
                                {action.subtitle}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 ml-2">
                          {action.badge && (
                            <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                              isSelected ? 'bg-accent-fg/20 text-accent-fg' : 'bg-accent/15 text-accent'
                            }`}>
                              {action.badge}
                            </span>
                          )}
                          {action.manga && onOpenReader && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onClose();
                                onOpenReader(action.manga!, action.manga!.currentChapter || 1);
                              }}
                              title="Directly launch reader"
                              className={`p-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition-all ${
                                isSelected
                                  ? 'bg-accent-fg/25 hover:bg-accent-fg/35 text-accent-fg'
                                  : 'bg-elevated hover:bg-edge-strong text-accent'
                              }`}
                            >
                              <span>Read</span>
                              <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Actions & Navigation Group */}
              {filteredDefaultActions.length > 0 && (
                <div className="pt-1">
                  <div className="px-3 py-1.5 text-[11px] font-bold text-muted uppercase tracking-wider">
                    <span>Actions &amp; Navigation</span>
                  </div>
                  {filteredDefaultActions.map((action, offsetIdx) => {
                    const idx = filteredSeriesActions.length + offsetIdx;
                    const isSelected = selectedIndex === idx;
                    const Icon = action.icon;
                    return (
                      <button
                        key={action.id}
                        data-index={idx}
                        onClick={action.run}
                        onMouseEnter={() => setSelectedIndex(idx)}
                        className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition-all ${
                          isSelected
                            ? 'bg-accent text-accent-fg shadow-md font-semibold'
                            : 'text-primary hover:bg-elevated/60'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`p-2 rounded-lg shrink-0 ${isSelected ? 'bg-accent-fg/20' : 'bg-elevated text-secondary'}`}>
                            <Icon className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs sm:text-sm font-bold truncate">
                              {action.title}
                            </div>
                            {action.subtitle && (
                              <div className={`text-[11px] truncate ${isSelected ? 'text-accent-fg/80' : 'text-secondary'}`}>
                                {action.subtitle}
                              </div>
                            )}
                          </div>
                        </div>
                        {action.shortcut && (
                          <kbd className={`px-2 py-0.5 rounded text-[10px] font-mono shrink-0 ${
                            isSelected ? 'bg-accent-fg/20 text-accent-fg' : 'bg-elevated/80 border border-edge/60 text-muted'
                          }`}>
                            {action.shortcut}
                          </kbd>
                        )}
                        {action.badge && (
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold shrink-0 ${
                            isSelected ? 'bg-accent-fg/20 text-accent-fg' : 'bg-accent/15 text-accent'
                          }`}>
                            {action.badge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* Modal Footer Controls Bar */}
        <div className="border-t border-edge/80 px-4 py-2.5 bg-app/70 flex items-center justify-between text-[11px] text-muted">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-elevated border border-edge text-[10px] font-mono">↑↓</kbd> Navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-elevated border border-edge text-[10px] font-mono">↵</kbd> Select
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-elevated border border-edge text-[10px] font-mono">ESC</kbd> Close
            </span>
          </div>
          <div className="flex items-center gap-1 text-accent font-medium">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Graywood Spotlight</span>
          </div>
        </div>
      </div>
    </div>
  );
};
