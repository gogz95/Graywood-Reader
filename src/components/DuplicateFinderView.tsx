import React, { useState } from 'react';
import { DuplicateCandidate } from '../types';
import {
  GitMerge,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  ArrowRight,
  Sparkles,
  ShieldAlert,
  Layers,
  BookOpen,
} from 'lucide-react';

interface DuplicateFinderViewProps {
  candidates: DuplicateCandidate[];
  onScanDuplicates: () => void;
  isScanning: boolean;
  onExecuteMerge: (
    primaryId: string,
    secondaryId: string,
    newTitle: string,
    newAltTitles: string[],
    newGenres: string[],
    newDescription: string
  ) => void;
  onDismissDuplicate?: (candidateId: string, primaryId: string, secondaryId: string) => void;
}

export const DuplicateFinderView: React.FC<DuplicateFinderViewProps> = ({
  candidates,
  onScanDuplicates,
  isScanning,
  onExecuteMerge,
  onDismissDuplicate,
}) => {
  const [selectedCandidate, setSelectedCandidate] = useState<DuplicateCandidate | null>(null);
  const [chosenTitle, setChosenTitle] = useState('');
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const handleOpenMergeModal = (candidate: DuplicateCandidate) => {
    setSelectedCandidate(candidate);
    setChosenTitle(candidate.suggestedTitle);
  };

  const handleDismiss = (cand: DuplicateCandidate) => {
    setDismissedIds((prev) => new Set([...Array.from(prev), cand.id]));
    if (onDismissDuplicate) {
      onDismissDuplicate(cand.id, cand.primaryItem.id, cand.secondaryItem.id);
    }
  };

  const visibleCandidates = candidates.filter((c) => !dismissedIds.has(c.id));

  const handleConfirmMerge = () => {
    if (!selectedCandidate) return;
    onExecuteMerge(
      selectedCandidate.primaryItem.id,
      selectedCandidate.secondaryItem.id,
      chosenTitle || selectedCandidate.suggestedTitle,
      selectedCandidate.mergedAltTitles,
      selectedCandidate.suggestedGenres,
      selectedCandidate.suggestedDescription
    );
    setSelectedCandidate(null);
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-purple-950/40 border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20 text-xs font-bold">
              <Sparkles className="w-3.5 h-3.5 text-purple-400" />
              AI-Powered Duplicate Resolution Engine
            </div>
            <h2 className="text-2xl font-black text-slate-100 tracking-tight">
              Duplicate Detection & 1-Click Merger
            </h2>
            <p className="text-sm text-slate-300 leading-relaxed">
              Finds alternative names, romanized titles vs translated English names (e.g. "Solo Leveling" vs "Na Honjaman Level Up"), and duplicate series across sources. Merges reading histories and tags cleanly with zero data loss.
            </p>
          </div>

          <button
            onClick={onScanDuplicates}
            disabled={isScanning}
            className={`px-5 py-3 rounded-xl font-bold text-sm shadow-lg flex items-center justify-center gap-2.5 transition-all whitespace-nowrap ${
              isScanning
                ? 'bg-slate-800 text-purple-400 border border-purple-500/30'
                : 'bg-purple-600 hover:bg-purple-500 text-white hover:scale-[1.02] active:scale-[0.98]'
            }`}
          >
            <RefreshCw className={`w-5 h-5 ${isScanning ? 'animate-spin' : ''}`} />
            <span>{isScanning ? 'Analyzing Database...' : 'Scan For Duplicates'}</span>
          </button>
        </div>
      </div>

      {/* Candidate List */}
      {isScanning ? (
        <div className="p-16 text-center space-y-3 bg-slate-900 border border-slate-800 rounded-2xl">
          <RefreshCw className="w-8 h-8 text-purple-400 animate-spin mx-auto" />
          <p className="text-sm font-semibold text-slate-200">
            Scanning title variants, alt names, and running Gemini AI semantic matching...
          </p>
        </div>
      ) : candidates.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center space-y-3">
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center mx-auto">
            <CheckCircle className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-slate-100">Database is Clean & Unified!</h3>
          <p className="text-sm text-slate-400 max-w-md mx-auto">
            No duplicate series or alternate title overlaps detected in your database. Click "Scan For Duplicates" anytime after adding new series!
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-sm text-slate-400">
            <span className="font-semibold text-slate-200">Found {candidates.length} Candidate Duplicate Pairs</span>
            <span>Select a pair to preview and merge</span>
          </div>

          {candidates.map((cand) => (
            <div
              key={cand.id}
              className="bg-slate-900 border border-slate-800 hover:border-purple-500/40 rounded-2xl p-5 shadow-lg space-y-4 transition-all"
            >
              {/* Header Match Score */}
              <div className="flex items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-1 rounded-full text-xs font-black bg-purple-500/20 text-purple-300 border border-purple-500/30">
                    {cand.similarityScore}% Match
                  </span>
                  <p className="text-xs text-slate-300 font-medium">{cand.reason}</p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleDismiss(cand)}
                    className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-bold text-xs transition-all flex items-center gap-1.5"
                    title="Mark pair as false positive duplicate"
                  >
                    <span>Not Duplicate</span>
                  </button>

                  <button
                    onClick={() => handleOpenMergeModal(cand)}
                    className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs shadow-md transition-all flex items-center gap-1.5"
                  >
                    <GitMerge className="w-4 h-4" />
                    <span>Merge Candidate</span>
                  </button>
                </div>
              </div>

              {/* Side by Side Comparison Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Entry A */}
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800/80 space-y-3 flex gap-3.5">
                  <img
                    src={cand.primaryItem.coverImage}
                    alt={cand.primaryItem.title}
                    className="w-16 h-22 rounded-lg object-cover bg-slate-900"
                  />
                  <div className="space-y-1 min-w-0 flex-1">
                    <span className="text-[10px] uppercase font-bold text-slate-500">Entry A (Primary)</span>
                    <h4 className="text-sm font-bold text-slate-100 truncate">{cand.primaryItem.title}</h4>
                    <p className="text-xs text-slate-400 truncate">
                      {cand.primaryItem.altTitles.join(', ') || 'No alt titles'}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-slate-300 pt-1 font-mono">
                      <span>Ch. {cand.primaryItem.currentChapter} read</span>
                      <span>•</span>
                      <span>Status: {cand.primaryItem.status}</span>
                    </div>
                  </div>
                </div>

                {/* Entry B */}
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800/80 space-y-3 flex gap-3.5">
                  <img
                    src={cand.secondaryItem.coverImage}
                    alt={cand.secondaryItem.title}
                    className="w-16 h-22 rounded-lg object-cover bg-slate-900"
                  />
                  <div className="space-y-1 min-w-0 flex-1">
                    <span className="text-[10px] uppercase font-bold text-slate-500">Entry B (Duplicate)</span>
                    <h4 className="text-sm font-bold text-slate-100 truncate">{cand.secondaryItem.title}</h4>
                    <p className="text-xs text-slate-400 truncate">
                      {cand.secondaryItem.altTitles.join(', ') || 'No alt titles'}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-slate-300 pt-1 font-mono">
                      <span>Ch. {cand.secondaryItem.currentChapter} read</span>
                      <span>•</span>
                      <span>Status: {cand.secondaryItem.status}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* MERGE MODAL */}
      {selectedCandidate && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-xl w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                <GitMerge className="w-5 h-5 text-purple-400" />
                Confirm Duplicate Merge
              </h3>
              <button
                onClick={() => setSelectedCandidate(null)}
                className="text-slate-400 hover:text-slate-200 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Choose Canonical Title:
                </label>
                <input
                  type="text"
                  value={chosenTitle}
                  onChange={(e) => setChosenTitle(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-sm text-slate-100 font-bold focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                />
              </div>

              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-2">
                <p className="font-semibold text-slate-300">Merged Alternate Titles Tag List:</p>
                <div className="flex flex-wrap gap-1">
                  {selectedCandidate.mergedAltTitles.map((alt, idx) => (
                    <span key={idx} className="px-2 py-0.5 rounded bg-purple-950/80 text-purple-300 border border-purple-500/30 text-[11px]">
                      {alt}
                    </span>
                  ))}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
                <p className="font-semibold text-slate-300">Merged Reading Progress:</p>
                <p className="text-amber-400 font-bold">
                  Highest Chapter Read Saved: Ch.{' '}
                  {Math.max(
                    selectedCandidate.primaryItem.currentChapter,
                    selectedCandidate.secondaryItem.currentChapter
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-slate-800 pt-4">
              <button
                onClick={() => setSelectedCandidate(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white font-semibold text-xs"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmMerge}
                className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs shadow-lg transition-all"
              >
                Execute Merge
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
