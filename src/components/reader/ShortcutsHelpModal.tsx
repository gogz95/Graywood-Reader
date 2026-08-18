import React from 'react';
import { Keyboard, X } from 'lucide-react';

interface ShortcutsHelpModalProps {
  onClose: () => void;
}

const SHORTCUTS = [
  { key: 'Space', desc: 'Toggle Auto-scroll' },
  { key: 'ArrowRight / D', desc: 'Next Page / Chapter' },
  { key: 'ArrowLeft / A', desc: 'Previous Page / Chapter' },
  { key: 'ArrowDown / J', desc: 'Smooth Scroll Down' },
  { key: 'ArrowUp / K', desc: 'Smooth Scroll Up' },
  { key: 'F', desc: 'Toggle Fullscreen Mode' },
  { key: 'G', desc: 'Quick Jump to Page' },
  { key: 'N', desc: 'Add Sticky Note on Current Page' },
  { key: 'B', desc: 'Bookmark / Unbookmark Page' },
  { key: 'S', desc: 'Open Reader Settings' },
  { key: 'H / ?', desc: 'Open Shortcuts Cheat Sheet' },
  { key: 'Esc', desc: 'Close Modal / HUD' },
];

export const ShortcutsHelpModal: React.FC<ShortcutsHelpModalProps> = ({ onClose }) => {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-edge rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-edge pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-accent/20 border border-accent/30 flex items-center justify-center text-accent">
              <Keyboard className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-black text-primary">Keyboard Shortcuts</h3>
              <p className="text-xs text-secondary">Quick hotkeys for seamless reading</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-app hover:bg-elevated text-secondary hover:text-primary transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-2 max-h-[60vh] overflow-y-auto pr-1">
          {SHORTCUTS.map((item) => (
            <div
              key={item.key}
              className="flex items-center justify-between p-2.5 rounded-xl bg-app/60 border border-edge/60 text-xs"
            >
              <span className="text-secondary font-medium">{item.desc}</span>
              <kbd className="px-2.5 py-1 rounded-lg bg-surface border border-edge-strong font-mono font-bold text-accent text-[11px] shadow-sm">
                {item.key}
              </kbd>
            </div>
          ))}
        </div>

        <button
          onClick={onClose}
          className="w-full py-2.5 rounded-2xl bg-accent text-accent-fg font-black text-xs transition-all hover:brightness-110 shadow-lg"
        >
          Got it
        </button>
      </div>
    </div>
  );
};
