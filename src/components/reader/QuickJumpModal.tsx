import React, { useState } from 'react';
import { Compass, X, ArrowRight } from 'lucide-react';

interface QuickJumpModalProps {
  totalPages: number;
  currentPage: number;
  onJump: (pageIndex: number) => void;
  onClose: () => void;
}

export const QuickJumpModal: React.FC<QuickJumpModalProps> = ({
  totalPages,
  currentPage,
  onJump,
  onClose,
}) => {
  const [targetPage, setTargetPage] = useState<number>(currentPage + 1);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clamped = Math.max(1, Math.min(totalPages, Number(targetPage) || 1));
    onJump(clamped - 1);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-edge rounded-3xl p-6 max-w-sm w-full shadow-2xl space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-edge pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-accent-2/20 border border-accent-2/30 flex items-center justify-center text-accent-2">
              <Compass className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-black text-primary">Jump to Page</h3>
              <p className="text-xs text-secondary">Total {totalPages} pages in chapter</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-app hover:bg-elevated text-secondary hover:text-primary transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-secondary font-semibold">
              <span>Page 1</span>
              <span className="text-accent font-bold font-mono">Selected: {targetPage} / {totalPages}</span>
              <span>Page {totalPages}</span>
            </div>
            <input
              type="range"
              min={1}
              max={totalPages}
              value={targetPage}
              onChange={(e) => setTargetPage(Number(e.target.value))}
              className="w-full accent-accent cursor-pointer"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={totalPages}
              value={targetPage}
              onChange={(e) => setTargetPage(Number(e.target.value))}
              autoFocus
              className="flex-1 bg-app border border-edge rounded-2xl px-4 py-2.5 text-center font-mono font-bold text-lg text-primary focus:outline-none focus:ring-2 focus:ring-accent-2"
            />
            <button
              type="submit"
              className="px-5 py-3 rounded-2xl bg-accent hover:brightness-110 text-accent-fg font-black text-xs flex items-center gap-1.5 transition-all shadow-lg"
            >
              <span>Go</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
