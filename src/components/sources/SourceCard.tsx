import React from 'react';
import { Pin, Power } from 'lucide-react';
import { SourceDefinition, SourceEngineType } from '../../types';

export const ENGINE_META: Record<SourceEngineType, { label: string; color: string; icon: string }> = {
  mangadex:      { label: 'MangaDex API',  color: 'bg-orange-500/20 text-orange-300 border-orange-500/30',   icon: '🔶' },
  madara:        { label: 'Madara (WP)',    color: 'bg-blue-500/20 text-blue-300 border-blue-500/30',         icon: '🔵' },
  mangathemesia: { label: 'MangaThemesia', color: 'bg-purple-500/20 text-purple-300 border-purple-500/30',   icon: '🔮' },
  foolslide:     { label: 'FoolSlide',     color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30', icon: '🟢' },
  wpcomics:      { label: 'WP Comics',     color: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',          icon: '🔷' },
  custom_html:   { label: 'Custom HTML',   color: 'bg-amber-500/20 text-amber-300 border-amber-500/30',       icon: '🟡' },
};

export interface SourceCardProps {
  source: SourceDefinition;
  isSelected: boolean;
  isPinned: boolean;
  isDisabled: boolean;
  onSelect: (s: SourceDefinition) => void;
  onToggleEnabled: (id: string, name: string, e: React.MouseEvent) => void;
  onTogglePin: (id: string, e: React.MouseEvent) => void;
}

export const SourceCard = React.memo<SourceCardProps>(({
  source: s,
  isSelected,
  isPinned,
  isDisabled,
  onSelect,
  onToggleEnabled,
  onTogglePin,
}) => {
  const meta = ENGINE_META[s.engineType] || { label: s.engineType, color: 'bg-elevated text-secondary', icon: '🌐' };

  return (
    <div
      onClick={() => onSelect(s)}
      className={`w-full text-left p-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-2 group ${
        isDisabled
          ? 'bg-app/30 border-edge opacity-60 grayscale'
          : isSelected
          ? 'bg-accent/15 border-accent shadow-md shadow-accent/10'
          : 'bg-app/60 border-edge/80 hover:bg-surface hover:border-edge-strong'
      }`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="text-base">{meta.icon}</span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={`font-bold text-xs truncate ${isDisabled ? 'text-muted line-through' : isSelected ? 'text-accent' : 'text-primary'}`}>
              {s.name}
            </span>
            {isPinned && <Pin className="w-3 h-3 text-accent fill-accent shrink-0" />}
          </div>
          <span className="text-[10px] text-muted truncate block">{s.baseUrl}</span>
        </div>
      </div>

      <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition">
        <button
          onClick={(e) => onTogglePin(s.id, e)}
          title={isPinned ? 'Unpin source' : 'Pin source'}
          className={`p-1.5 rounded-lg border transition ${
            isPinned
              ? 'bg-accent/20 border-accent/40 text-accent'
              : 'bg-elevated/50 border-edge text-muted hover:text-primary hover:bg-surface'
          }`}
        >
          <Pin className={`w-3 h-3 ${isPinned ? 'fill-accent' : ''}`} />
        </button>

        <button
          onClick={(e) => onToggleEnabled(s.id, s.name, e)}
          title={isDisabled ? 'Enable source' : 'Disable source'}
          className={`p-1.5 rounded-lg border transition ${
            isDisabled
              ? 'bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20'
              : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
          }`}
        >
          <Power className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
});
