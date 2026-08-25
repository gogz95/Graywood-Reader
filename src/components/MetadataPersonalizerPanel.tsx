import React, { useState, useCallback } from 'react';
import { apiFetch } from '../utils/api';
import { MangaItem } from '../types';
import {
  ChevronDown,
  ChevronUp,
  Image,
  FileText,
  Star,
  Tag,
  BookMarked,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Wand2,
  Lock,
  Unlock,
  Palette,
  Sparkles,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Types & constants
// ─────────────────────────────────────────────────────────────────────────────

const PULLABLE_FIELDS = [
  { key: 'coverImage',  label: 'Cover Image',  icon: Image,      atomic: true  },
  { key: 'title',       label: 'Title',         icon: FileText,   atomic: true  },
  { key: 'description', label: 'Description',   icon: FileText,   atomic: true  },
  { key: 'rating',      label: 'Rating',        icon: Star,       atomic: true  },
  { key: 'genres',      label: 'Genres',        icon: Tag,        atomic: false },
  { key: 'altTitles',   label: 'Alt Titles',    icon: BookMarked, atomic: false },
] as const;

type PullableField = (typeof PULLABLE_FIELDS)[number]['key'];

interface SourceEntry {
  sourceName: string;
  sourceUrl: string;
}

interface PullResult {
  sourceUrl: string;
  appliedFields: string[];
  message: string;
  error?: string;
}

interface MetadataPersonalizerPanelProps {
  manga: MangaItem;
  onUpdateManga: (updated: MangaItem) => void;
  onOpenStudio?: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export const MetadataPersonalizerPanel: React.FC<MetadataPersonalizerPanelProps> = ({
  manga,
  onUpdateManga,
  onOpenStudio,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  // Selected fields per source: sourceUrl → Set<PullableField>
  const [selectedFields, setSelectedFields] = useState<Record<string, Set<PullableField>>>({});
  // Loading state per source URL
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  // Result feedback per source URL
  const [results, setResults] = useState<Record<string, PullResult>>({});

  // Build the list of unique sources from availableSources + the main source
  const sources: SourceEntry[] = React.useMemo(() => {
    const seen = new Set<string>();
    const list: SourceEntry[] = [];

    const push = (sourceName: string, sourceUrl: string) => {
      const key = sourceUrl.toLowerCase();
      if (!sourceUrl || seen.has(key)) return;
      seen.add(key);
      list.push({ sourceName: sourceName || 'Unknown Source', sourceUrl });
    };

    for (const s of manga.availableSources || []) {
      push(s.sourceName || '', s.sourceUrl || '');
    }
    // Always include the primary source
    push(manga.sourceName || 'Primary Source', manga.sourceUrl || '');

    return list;
  }, [manga]);

  const toggleField = (sourceUrl: string, field: PullableField) => {
    setSelectedFields((prev) => {
      const existing = new Set(prev[sourceUrl] || []);
      if (existing.has(field)) {
        existing.delete(field);
      } else {
        existing.add(field);
      }
      return { ...prev, [sourceUrl]: existing };
    });
  };

  const selectAllForSource = (sourceUrl: string) => {
    setSelectedFields((prev) => ({
      ...prev,
      [sourceUrl]: new Set(PULLABLE_FIELDS.map((f) => f.key)),
    }));
  };

  const clearAllForSource = (sourceUrl: string) => {
    setSelectedFields((prev) => ({ ...prev, [sourceUrl]: new Set() }));
  };

  const handlePull = useCallback(
    async (source: SourceEntry) => {
      const fields = Array.from(selectedFields[source.sourceUrl] || []);
      if (fields.length === 0) return;

      setLoading((prev) => ({ ...prev, [source.sourceUrl]: true }));
      setResults((prev) => {
        const next = { ...prev };
        delete next[source.sourceUrl];
        return next;
      });

      try {
        const res = await apiFetch(`/api/manga/${manga.id}/pull-metadata-from-source`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceUrl: source.sourceUrl,
            sourceName: source.sourceName,
            fields,
          }),
        });
        const data = await res.json();

        if (res.ok && data.success && data.manga) {
          onUpdateManga(data.manga);
          setResults((prev) => ({
            ...prev,
            [source.sourceUrl]: {
              sourceUrl: source.sourceUrl,
              appliedFields: data.appliedFields || [],
              message: data.message || 'Done',
            },
          }));
        } else {
          setResults((prev) => ({
            ...prev,
            [source.sourceUrl]: {
              sourceUrl: source.sourceUrl,
              appliedFields: [],
              message: data.message || data.error || 'No changes',
              error: data.error,
            },
          }));
        }
      } catch (err: any) {
        setResults((prev) => ({
          ...prev,
          [source.sourceUrl]: {
            sourceUrl: source.sourceUrl,
            appliedFields: [],
            message: 'Network error',
            error: err.message,
          },
        }));
      } finally {
        setLoading((prev) => ({ ...prev, [source.sourceUrl]: false }));
      }
    },
    [manga.id, selectedFields, onUpdateManga]
  );

  if (sources.length === 0) return null;

  const overrides = new Set(manga.metadataOverrides || []);

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
      {/* Panel header / toggle */}
      <div className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-900 border-b border-slate-800">
        <button
          type="button"
          onClick={() => setIsOpen((o) => !o)}
          className="flex items-center gap-2 flex-1 text-left hover:opacity-80 transition-opacity"
        >
          <Wand2 className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-bold text-white">Metadata & Source Personalizer</span>
          <span className="text-[10px] font-semibold text-slate-300 bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700">
            {sources.length} source{sources.length !== 1 ? 's' : ''}
          </span>
          {isOpen ? (
            <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          )}
        </button>

        {onOpenStudio && (
          <button
            type="button"
            onClick={onOpenStudio}
            className="px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 border border-amber-300 text-black font-bold text-xs flex items-center gap-1.5 transition-all shadow-sm shrink-0 cursor-pointer"
          >
            <Palette className="w-3.5 h-3.5 fill-black" />
            <span>Open Studio</span>
          </button>
        )}
      </div>

      {isOpen && (
        <div className="border-t border-slate-800 divide-y divide-slate-800">
          {/* Legend */}
          <div className="px-4 py-2.5 bg-slate-900/60 flex items-center gap-3 text-[10px] text-slate-400 flex-wrap">
            <span className="flex items-center gap-1">
              <Lock className="w-3 h-3 text-amber-400" /> = currently locked (user-overridden)
            </span>
            <span className="flex items-center gap-1">
              <Unlock className="w-3 h-3 text-slate-300" /> = auto-refreshed by source
            </span>
            <span className="ml-auto text-slate-400 italic">
              Tick fields, then click Apply to pull them from that source.
            </span>
          </div>

          {sources.map((source) => {
            const srcFields = selectedFields[source.sourceUrl] || new Set<PullableField>();
            const isLoading = Boolean(loading[source.sourceUrl]);
            const result = results[source.sourceUrl];
            const hasSelection = srcFields.size > 0;

            return (
              <div key={source.sourceUrl} className="px-4 py-3 space-y-2.5">
                {/* Source name + URL */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-white truncate">{source.sourceName}</p>
                    <a
                      href={source.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-sky-400 hover:underline truncate block max-w-xs"
                    >
                      {source.sourceUrl}
                    </a>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => selectAllForSource(source.sourceUrl)}
                      className="text-[10px] font-semibold text-amber-400 hover:text-amber-300 transition-colors"
                    >
                      All
                    </button>
                    <span className="text-slate-500 text-[10px]">/</span>
                    <button
                      type="button"
                      onClick={() => clearAllForSource(source.sourceUrl)}
                      className="text-[10px] font-semibold text-slate-400 hover:text-white transition-colors"
                    >
                      None
                    </button>
                  </div>
                </div>

                {/* Field checkboxes */}
                <div className="flex flex-wrap gap-2">
                  {PULLABLE_FIELDS.map(({ key, label, icon: Icon, atomic }) => {
                    const isChecked = srcFields.has(key);
                    const isOverridden = overrides.has(key);
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => toggleField(source.sourceUrl, key)}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-all ${
                          isChecked
                            ? 'bg-amber-500/20 text-amber-400 border-amber-500/50 shadow-sm'
                            : 'bg-slate-900 border-slate-700 text-slate-300 hover:text-white hover:border-slate-500'
                        }`}
                        title={
                          atomic
                            ? isOverridden
                              ? `${label} is currently user-overridden — pulling will re-lock it to this source.`
                              : `${label} — atomic field, preferred source wins.`
                            : `${label} — aggregative field, values are merged (unioned) from all sources.`
                        }
                      >
                        <Icon className="w-3 h-3" />
                        <span>{label}</span>
                        {isOverridden && (
                          <Lock className="w-2.5 h-2.5 text-amber-400 ml-0.5" />
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Apply button + result */}
                <div className="flex items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => handlePull(source)}
                    disabled={!hasSelection || isLoading}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all ${
                      hasSelection && !isLoading
                        ? 'bg-amber-500 hover:bg-amber-400 text-black border border-amber-300 shadow-sm hover:scale-[1.02] active:scale-[0.98]'
                        : 'bg-slate-800 text-slate-500 cursor-not-allowed opacity-60'
                    }`}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Fetching…
                      </>
                    ) : (
                      <>
                        <Wand2 className="w-3.5 h-3.5" />
                        Apply {srcFields.size > 0 ? `(${srcFields.size})` : ''} from {source.sourceName}
                      </>
                    )}
                  </button>

                  {result && (
                    <div
                      className={`flex items-center gap-1.5 text-[11px] font-semibold ${
                        result.error ? 'text-danger' : 'text-success'
                      }`}
                    >
                      {result.error ? (
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      ) : (
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      )}
                      <span>{result.message}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
