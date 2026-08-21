import React, { useState } from 'react';
import { apiFetch } from '../utils/api';
import { createPortal } from 'react-dom';
import { X, AlertTriangle, FileWarning, BookX, Layers, HelpCircle, Check, Loader2 } from 'lucide-react';
import { MangaItem } from '../types';

export interface FlagCategory {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  flagReason: string;
}

export const FLAG_CATEGORIES: FlagCategory[] = [
  {
    id: 'no_pages',
    label: 'Does not load pages',
    description: 'Reader opens but shows broken/blank/placeholder images.',
    icon: <FileWarning className="w-5 h-5" />,
    flagReason: 'Does not load pages',
  },
  {
    id: 'wrong_chapter',
    label: 'Loads wrong chapter',
    description: 'The wrong chapter content is displayed when reading.',
    icon: <BookX className="w-5 h-5" />,
    flagReason: 'Loads wrong chapter',
  },
  {
    id: 'wrong_series',
    label: 'Loads wrong series',
    description: 'A different series with a similar title is loaded.',
    icon: <Layers className="w-5 h-5" />,
    flagReason: 'Loads wrong series',
  },
  {
    id: 'missing_source',
    label: 'Missing source',
    description: 'No working reading source or chapter parser is linked.',
    icon: <AlertTriangle className="w-5 h-5" />,
    flagReason: 'Missing source',
  },
  {
    id: 'other',
    label: 'Other Fault',
    description: 'Any other problem with this series or its content.',
    icon: <HelpCircle className="w-5 h-5" />,
    flagReason: 'Other Fault',
  },
];

interface FlagIssueModalProps {
  manga: MangaItem;
  onClose: () => void;
  /** Called after a category is chosen: toggle the flag AND open the bug-report tool. */
  onReport: (category: FlagCategory, manga: MangaItem) => void;
  /** Notify parent to reflect the new flagged state + reason. */
  onFlagged?: (isFlagged: boolean, reason: string) => void;
}

export const FlagIssueModal: React.FC<FlagIssueModalProps> = React.memo(({
  manga,
  onClose,
  onReport,
  onFlagged,
}) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleSelect = async (cat: FlagCategory) => {
    if (busy) return;
    setBusy(true);
    setError('');

    try {
      // 1. Persist the flag against this series via the existing toggle endpoint.
      const res = await apiFetch('/api/manga/toggle-flag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: manga.id, isFlagged: true, flagReason: cat.flagReason }),
      });
      await res.json();

      // 2. Update local/reader UI state (even if the server call is best-effort).
      onFlagged?.(true, cat.flagReason);

      // 3. Hand off to the bug-reporting tool pre-filled with this category.
      onClose();
      onReport(cat, manga);
    } catch (e: any) {
      setError(e.message || 'Failed to flag this series. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveFlag = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await apiFetch('/api/manga/toggle-flag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: manga.id, isFlagged: false }),
      });
      await res.json();
      onFlagged?.(false, '');
      onClose();
    } catch (e: any) {
      setError(e.message || 'Failed to remove flag. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-edge rounded-t-3xl sm:rounded-3xl max-w-md w-full overflow-y-auto p-4 sm:p-6 space-y-4 shadow-2xl my-0 sm:my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-edge pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-danger/10 text-danger border border-danger/20">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-black text-primary">Flag Series Issue</h2>
              <p className="text-xs text-secondary max-w-[260px] truncate">{manga.title}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-full bg-elevated text-secondary hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-xs text-secondary leading-relaxed">
          What went wrong with this series? Pick the closest match to report it — this also opens the bug-reporting
          tool pre-filled with your choice so the issue gets logged for fixing.
        </p>

        {error && (
          <div className="p-3 rounded-xl bg-danger/10 border border-danger/30 text-danger text-xs">{error}</div>
        )}

        {/* Category options */}
        <div className="space-y-2 pt-1">
          {FLAG_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              disabled={busy}
              onClick={() => handleSelect(cat)}
              className="w-full flex items-center gap-3 p-3 rounded-xl bg-app border border-edge hover:border-danger/40 hover:bg-danger/5 transition-all text-left disabled:opacity-50"
            >
              <span className="p-2 rounded-lg bg-danger/10 text-danger border border-danger/20 shrink-0">
                {cat.icon}
              </span>
              <span className="min-w-0">
                <span className="block font-bold text-sm text-primary">{cat.label}</span>
                <span className="block text-[11px] text-secondary">{cat.description}</span>
              </span>
            </button>
          ))}
        </div>
        {/* Already-flagged actions */}
        {manga.isFlagged && (
          <div className="flex items-center gap-3 pt-2 border-t border-edge">
            <span className="text-[11px] text-danger font-bold flex items-center gap-1">
              <Check className="w-3.5 h-3.5" /> Currently flagged
            </span>
            <button
              onClick={handleRemoveFlag}
              disabled={busy}
              className="ml-auto px-3 py-1.5 rounded-lg bg-elevated hover:bg-elevated text-secondary hover:text-danger text-xs font-bold transition disabled:opacity-50 flex items-center gap-1.5"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Remove Flag
            </button>
          </div>
        )}

        <button
          onClick={onClose}
          disabled={busy}
          className="w-full py-2 rounded-xl bg-elevated text-secondary hover:text-white text-xs font-bold transition disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>,
    document.body
  );
});

