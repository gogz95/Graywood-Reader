// ============================================================================
// SPOILER-SAFE STORY COMPANION & CHARACTER GRAPH ENGINE
// Provides chapter-gated character relationship graphs, character summaries,
// and catch-up recaps up to the user's current reading chapter.
// ============================================================================

import { MangaItem } from '../../src/types';
import { getGeminiClient } from '../appState';
import { logger } from '../logger';

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
  generatedBy?: 'gemini' | 'heuristic';
}

export function generateHeuristicCompanion(manga: MangaItem, chapterNumber: number): StoryCompanionData {
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

  const milestone = Math.min(chapterNumber, 10);
  const keyPlotPoints = [
    `Chapter 1: Story initiation and main quest set in motion.`,
    `Chapter ${milestone}: Core powers unlocked and initial training arc concluded.`,
    `Chapter ${chapterNumber}: Current standing point in the reader timeline.`,
  ];

  return {
    mangaId: manga.id,
    seriesTitle: manga.title,
    gatedChapterNumber: chapterNumber,
    summary: `Spoiler-safe story companion for ${manga.title} up to Chapter ${chapterNumber}. Information beyond Chapter ${chapterNumber} is strictly hidden to prevent spoilers.`,
    characters,
    keyPlotPoints,
    generatedBy: 'heuristic',
  };
}

export async function generateStoryCompanion(manga: MangaItem, chapterNumber: number): Promise<StoryCompanionData> {
  const gemini = getGeminiClient();
  if (!gemini) {
    return generateHeuristicCompanion(manga, chapterNumber);
  }

  try {
    const milestoneChapter = Math.min(chapterNumber, 10);
    const prompt = `You are a spoiler-safe story companion for the manga/manhwa "${manga.title}".
Description: ${manga.description || 'N/A'}
Genres: ${(manga.genres || []).join(', ')}
The user is currently reading Chapter ${chapterNumber}.
CRITICAL REQUIREMENT: STRICTLY FORBIDDEN from including any plot twists, character introductions, or spoilers that happen AFTER Chapter ${chapterNumber}. Only describe events, character relationships, and lore up to Chapter ${chapterNumber}.

Return a JSON object adhering to this structure:
{
  "summary": "Concise 2-3 sentence story recap from Chapter 1 up to Chapter ${chapterNumber}.",
  "characters": [
    {
      "id": "char_1",
      "name": "Character Name",
      "role": "protagonist",
      "firstAppearanceChapter": 1,
      "description": "Brief description up to Chapter ${chapterNumber}.",
      "relationships": [
        { "targetName": "Other Character", "relation": "relationship description" }
      ]
    }
  ],
  "keyPlotPoints": [
    "Chapter 1: ...",
    "Chapter ${milestoneChapter}: ..."
  ]
}`;

    const response = await gemini.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const text = response.text?.trim();
    if (text) {
      const parsed = JSON.parse(text);
      if (parsed && Array.isArray(parsed.characters) && Array.isArray(parsed.keyPlotPoints)) {
        return {
          mangaId: manga.id,
          seriesTitle: manga.title,
          gatedChapterNumber: chapterNumber,
          summary: parsed.summary || `Recap of ${manga.title} up to Chapter ${chapterNumber}.`,
          characters: parsed.characters,
          keyPlotPoints: parsed.keyPlotPoints,
          generatedBy: 'gemini',
        };
      }
    }
  } catch (err: any) {
    logger.warn('StoryCompanion', 'Gemini generation failed, falling back to heuristic', { error: err?.message });
  }

  return generateHeuristicCompanion(manga, chapterNumber);
}

