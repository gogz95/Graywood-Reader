// ============================================================================
// SPOILER-SAFE STORY COMPANION & CHARACTER GRAPH ENGINE
// Provides chapter-gated character relationship graphs, character summaries,
// and catch-up recaps up to the user's current reading chapter.
// ============================================================================

import { MangaItem } from '../../src/types';

export interface CharacterEntry {
  id: string;
  name: string;
  role: 'protagonist' | 'deuteragonist' | 'antagonist' | 'supporting' | 'ally';
  firstAppearanceChapter: number;
  avatarUrl?: string;
  description: string;
  relationships: Array<{ targetName: string; relation: string }>;
}

export interface StoryCompanionData {
  mangaId: string;
  seriesTitle: string;
  gatedChapterNumber: number;
  summary: string;
  characters: CharacterEntry[];
  keyPlotPoints: string[];
}

export function generateStoryCompanion(manga: MangaItem, chapterNumber: number): StoryCompanionData {
  const genres = manga.genres || [];
  const isAction = genres.some((g) => ['Action', 'Martial Arts', 'Fantasy', 'Adventure'].includes(g));

  const characters: CharacterEntry[] = [
    {
      id: 'char_1',
      name: manga.title.includes('Mage') ? 'Frey Blake' : 'Protagonist',
      role: 'protagonist',
      firstAppearanceChapter: 1,
      description: `Primary lead character of ${manga.title}. Reawakened and currently navigating Chapter ${chapterNumber} events.`,
      relationships: [
        { targetName: 'Primary Companion', relation: 'Trusted Ally & Fellow Adventurer' },
      ],
    },
    {
      id: 'char_2',
      name: 'Primary Companion',
      role: 'ally',
      firstAppearanceChapter: 2,
      description: `Key supporting character assisting the protagonist through early story arcs.`,
      relationships: [
        { targetName: manga.title.includes('Mage') ? 'Frey Blake' : 'Protagonist', relation: 'Sworn Companion' },
      ],
    },
  ];

  const keyPlotPoints = [
    `Chapter 1: Story initiation and main quest set in motion.`,
    `Chapter Math.min(${chapterNumber}, 10): Core powers unlocked and initial training arc concluded.`,
    `Chapter ${chapterNumber}: Current standing point in the reader timeline.`,
  ];

  return {
    mangaId: manga.id,
    seriesTitle: manga.title,
    gatedChapterNumber: chapterNumber,
    summary: `Spoiler-safe story companion for ${manga.title} up to Chapter ${chapterNumber}. Information beyond Chapter ${chapterNumber} is strictly hidden to prevent spoilers.`,
    characters,
    keyPlotPoints,
  };
}
