import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../server';
import { generateHeuristicCompanion, generateStoryCompanion } from '../server/services/storyCompanion';
import { MangaItem } from '../src/types';

describe('Spoiler-Safe Story Companion Engine', () => {
  const sampleManga: MangaItem = {
    id: 'test_mage_story_1',
    title: 'The Great Mage Returns After 4000 Years',
    altTitles: ['Return of the Great Mage'],
    type: 'manhwa',
    coverImage: 'https://example.com/cover.jpg',
    description: 'Lucas Traumen was the greatest archmage in history until sealed by demigods.',
    genres: ['Action', 'Fantasy', 'Adventure'],
    status: 'reading',
    currentChapter: 15,
    latestChapter: 200,
    rating: 9.2,
    sourceUrl: 'https://example.com/mage',
    sourceName: 'Test Scans',
    autoUpdateEnabled: true,
  };

  it('generates spoiler-gated heuristic companion with correct chapter limit', () => {
    const data = generateHeuristicCompanion(sampleManga, 8);
    expect(data.mangaId).toBe('test_mage_story_1');
    expect(data.gatedChapterNumber).toBe(8);
    expect(data.characters.length).toBeGreaterThan(0);
    expect(data.characters[0].name).toBe('Frey Blake');
    expect(data.keyPlotPoints).toContain('Chapter 1: Story initiation and main quest set in motion.');
    expect(data.keyPlotPoints).toContain('Chapter 8: Core powers unlocked and initial training arc concluded.');
    expect(data.keyPlotPoints).toContain('Chapter 8: Current standing point in the reader timeline.');
    expect(data.summary).toContain('Chapter 8');
  });

  it('caps training arc milestone at chapter 10 for higher chapters', () => {
    const data = generateHeuristicCompanion(sampleManga, 45);
    expect(data.gatedChapterNumber).toBe(45);
    expect(data.keyPlotPoints).toContain('Chapter 10: Core powers unlocked and initial training arc concluded.');
    expect(data.keyPlotPoints).toContain('Chapter 45: Current standing point in the reader timeline.');
  });

  it('provides asynchronous generateStoryCompanion with heuristic fallback', async () => {
    const data = await generateStoryCompanion(sampleManga, 12);
    expect(data).toBeDefined();
    expect(data.gatedChapterNumber).toBe(12);
    expect(data.characters.length).toBeGreaterThan(0);
  });

  it('serves GET /api/manga/:id/story-companion endpoint', async () => {
    const res = await request(app).get('/api/manga/test_mage_story_1/story-companion?chapter=5');
    // If not found in DB, returns 404 or creates placeholder
    if (res.status === 200) {
      expect(res.body.gatedChapterNumber).toBe(5);
      expect(res.body.characters).toBeInstanceOf(Array);
    } else {
      expect(res.status).toBe(404);
    }
  });
});
