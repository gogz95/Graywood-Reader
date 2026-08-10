import React, { useState } from 'react';
import { Bug, X, Send, AlertTriangle, CheckCircle, FileText, Code2, AlertCircle } from 'lucide-react';
import { UserProfile } from '../types';

interface SubmitBugModalProps {
  currentUser?: UserProfile;
  onClose: () => void;
  onBugSubmitted?: (bugId: string) => void;
}

export const SubmitBugModal: React.FC<SubmitBugModalProps> = ({
  currentUser,
  onClose,
  onBugSubmitted,
}) => {
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'critical'>('medium');
  const [file, setFile] = useState('server.ts');
  const [description, setDescription] = useState('');
  const [stepsToReproduce, setStepsToReproduce] = useState('');
  const [expected, setExpected] = useState('');
  const [actual, setActual] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submittedBugId, setSubmittedBugId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) {
      setErrorMsg('Title and description are required.');
      return;
    }

    setSubmitting(true);
    setErrorMsg('');

    try {
      const res = await fetch('/api/bugs/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          priority,
          file,
          description,
          stepsToReproduce,
          expected,
          actual,
          user: currentUser ? currentUser.name : 'Anonymous Reader',
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setSubmittedBugId(data.bugId);
        if (onBugSubmitted) onBugSubmitted(data.bugId);
      } else {
        setErrorMsg(data.error || 'Failed to submit bug report.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Network error submitting bug report.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-3xl max-w-xl w-full max-h-[92vh] sm:max-h-[85vh] overflow-y-auto p-4 sm:p-6 space-y-6 shadow-2xl my-0 sm:my-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-red-500/10 text-red-400 border border-red-500/20">
              <Bug className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-100 flex items-center gap-2">
                Submit Bug Report
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-red-500/20 text-red-300 border border-red-500/30">
                  BUGS.md Tracker
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Log a bug directly into <code className="text-amber-300">BUGS.md</code> for automated AI fixing.
              </p>
            </div>
          </div>

          <button onClick={onClose} className="p-2 rounded-full bg-slate-800 text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {submittedBugId ? (
          <div className="py-8 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto">
              <CheckCircle className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-xl font-black text-slate-100">Bug Reported Successfully!</h3>
              <p className="text-sm text-slate-400 pt-1">
                Registered as <strong className="text-amber-400 font-mono">[{submittedBugId}]</strong> in <code className="text-amber-300 font-mono">BUGS.md</code>.
              </p>
            </div>
            <button
              onClick={onClose}
              className="px-6 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs transition"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            {errorMsg && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Short Title */}
            <div className="space-y-1">
              <label className="font-bold text-slate-200 block">Short Description / Bug Title *</label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Sources list fails to load after toggling filter"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500"
              />
            </div>

            {/* Priority & File */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="font-bold text-slate-200 block">Priority Level</label>
                <select
                  value={priority}
                  onChange={(e: any) => setPriority(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-amber-500"
                >
                  <option value="low">Low (Minor visual tweak)</option>
                  <option value="medium">Medium (Standard issue)</option>
                  <option value="high">High (Feature broken)</option>
                  <option value="critical">Critical (Crash / Data loss)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-200 block">Relevant File / Component</label>
                <input
                  type="text"
                  value={file}
                  onChange={(e) => setFile(e.target.value)}
                  placeholder="e.g. server.ts, KotatsuSourcesView.tsx"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            {/* Full Description */}
            <div className="space-y-1">
              <label className="font-bold text-slate-200 block">Detailed Description *</label>
              <textarea
                rows={3}
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what went wrong in detail..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500"
              />
            </div>

            {/* Steps to Reproduce */}
            <div className="space-y-1">
              <label className="font-bold text-slate-200 block">Steps to Reproduce (Optional)</label>
              <input
                type="text"
                value={stepsToReproduce}
                onChange={(e) => setStepsToReproduce(e.target.value)}
                placeholder="1. Navigate to Settings -> 2. Click Clear Cache"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500"
              />
            </div>

            {/* Expected vs Actual */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="font-bold text-slate-200 block">Expected Behavior</label>
                <input
                  type="text"
                  value={expected}
                  onChange={(e) => setExpected(e.target.value)}
                  placeholder="What should happen"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-200 block">Actual Behavior</label>
                <input
                  type="text"
                  value={actual}
                  onChange={(e) => setActual(e.target.value)}
                  placeholder="What actually happens"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold"
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2 rounded-xl bg-red-500 hover:bg-red-400 text-slate-950 font-black flex items-center gap-2 transition disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
                {submitting ? 'Saving to BUGS.md...' : 'Submit Bug to BUGS.md'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
