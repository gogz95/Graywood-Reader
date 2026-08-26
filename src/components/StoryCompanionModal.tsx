import React, { useState, useEffect } from 'react';
import {
  X,
  User,
  Shield,
  BookOpen,
  Sparkles,
  Search,
  Users,
  Lock,
  ListOrdered,
  RefreshCw,
} from 'lucide-react';
import { MangaItem } from '../types';
import { apiFetch } from '../utils/api';

interface CharacterEntry {
  id: string;
  name: string;
  role: 'protagonist' | 'deuteragonist' | 'antagonist' | 'supporting' | 'ally';
  firstAppearanceChapter: number;
  avatarUrl?: string;
  description: string;
  relationships: Array<{ targetName: string; relation: string }>;
}

interface StoryCompanionData {
  mangaId: string;
  seriesTitle: string;
  gatedChapterNumber: number;
  summary: string;
  characters: CharacterEntry[];
  keyPlotPoints: string[];
}

interface StoryCompanionModalProps {
  manga: MangaItem;
  currentChapterNumber: number;
  isOpen: boolean;
  onClose: () => void;
}

export const StoryCompanionModal: React.FC<StoryCompanionModalProps> = ({
  manga,
  currentChapterNumber,
  isOpen,
  onClose,
}) => {
  const [data, setData] = useState<StoryCompanionData | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (isOpen && manga) {
      setLoading(true);
      apiFetch(`/api/manga/${manga.id}/story-companion?chapter=${currentChapterNumber}`)
        .then((res: any) => setData(res))
        .catch((err) => console.error('[StoryCompanion] Error:', err))
        .finally(() => setLoading(false));
    }
  }, [isOpen, manga, currentChapterNumber]);

  if (!isOpen) return null;

  const filteredCharacters = (data?.characters || []).filter(
    (c) =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-[120] bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 animate-fadeIn">
      <div className="bg-surface border border-edge rounded-2xl max-w-3xl w-full max-h-[88vh] flex flex-col shadow-2xl overflow-hidden my-auto">
        {/* Header */}
        <div className="p-4 bg-app border-b border-edge flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-purple-500/15 text-purple-300 border border-purple-500/30">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-black text-primary">Spoiler-Safe Story Companion</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] bg-purple-500/20 text-purple-300 border border-purple-500/30 font-bold flex items-center gap-1">
                  <Lock className="w-3 h-3" /> Gated up to Ch. {currentChapterNumber}
                </span>
              </div>
              <p className="text-xs text-secondary truncate max-w-md">{manga.title}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full bg-elevated text-secondary hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto flex-1 space-y-6">
          {loading ? (
            <div className="py-12 text-center text-secondary flex flex-col items-center gap-3">
              <RefreshCw className="w-7 h-7 animate-spin text-purple-400" />
              <span className="text-xs font-bold">Building spoiler-safe character graph up to Chapter {currentChapterNumber}...</span>
            </div>
          ) : (
            <>
              {/* Summary Card */}
              <div className="p-4 bg-app/60 border border-edge rounded-xl space-y-2">
                <h4 className="text-xs font-bold text-primary flex items-center gap-1.5">
                  <BookOpen className="w-4 h-4 text-purple-400" />
                  <span>Story Recap (Chapter 1 ➔ {currentChapterNumber})</span>
                </h4>
                <p className="text-xs text-secondary leading-relaxed">{data?.summary}</p>
              </div>

              {/* Who Is This Again? Search */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-primary flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-accent" />
                    <span>Character Roster ("Who is this again?")</span>
                  </h4>
                  <div className="relative w-48 sm:w-64">
                    <Search className="w-3.5 h-3.5 text-muted absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search character name or role..."
                      className="w-full bg-surface border border-edge rounded-lg pl-8 pr-3 py-1.5 text-xs text-primary focus:outline-none focus:ring-1 focus:ring-purple-400"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {filteredCharacters.map((char) => (
                    <div key={char.id} className="p-3.5 bg-app border border-edge rounded-xl space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-purple-500/20 text-purple-300 font-bold flex items-center justify-center text-xs border border-purple-500/30">
                            {char.name.charAt(0)}
                          </div>
                          <div>
                            <h5 className="text-xs font-bold text-primary">{char.name}</h5>
                            <span className="text-[10px] text-muted capitalize">{char.role} • Intro Ch. {char.firstAppearanceChapter}</span>
                          </div>
                        </div>
                      </div>

                      <p className="text-[11px] text-secondary leading-relaxed line-clamp-3">{char.description}</p>

                      {char.relationships && char.relationships.length > 0 && (
                        <div className="pt-1.5 border-t border-edge/50 flex flex-wrap gap-1">
                          {char.relationships.map((rel, rIdx) => (
                            <span key={rIdx} className="px-2 py-0.5 rounded text-[9px] bg-surface text-purple-300 border border-purple-500/30 font-medium">
                              ➔ {rel.targetName}: {rel.relation}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Key Timeline Events */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-primary flex items-center gap-1.5">
                  <ListOrdered className="w-4 h-4 text-purple-400" />
                  <span>Timeline Milestones (Up to Chapter {currentChapterNumber})</span>
                </h4>
                <div className="space-y-1.5">
                  {data?.keyPlotPoints.map((point, pIdx) => (
                    <div key={pIdx} className="p-2.5 rounded-lg bg-app border border-edge text-xs text-secondary font-medium">
                      {point}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 bg-app border-t border-edge flex items-center justify-between text-xs text-secondary">
          <span>Protected from future chapter spoilers</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-elevated hover:bg-elevated/80 text-secondary hover:text-white font-bold"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
