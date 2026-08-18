import { describe, it, expect } from 'vitest';
import { detectMangaFormat, getRecommendedReadingMode } from '../src/utils/readingMode';

describe('Reading Mode & Format Auto-Detection', () => {
  it('detects explicit manga format', () => {
    expect(detectMangaFormat({ type: 'manga' })).toBe('manga');
    expect(detectMangaFormat({ type: 'manhwa' })).toBe('manhwa');
    expect(detectMangaFormat({ type: 'manhua' })).toBe('manhua');
  });

  it('detects format based on genre heuristics', () => {
    expect(detectMangaFormat({ genres: ['Action', 'Webtoon'] })).toBe('manhwa');
    expect(detectMangaFormat({ genres: ['Cultivation', 'Manhua'] })).toBe('manhua');
    expect(detectMangaFormat({ genres: ['Shounen', 'Manga'] })).toBe('manga');
  });

  it('detects format based on source heuristics', () => {
    expect(detectMangaFormat({ sourceName: 'AsuraScans' })).toBe('manhwa');
    expect(detectMangaFormat({ sourceName: 'ManhuaPlus' })).toBe('manhua');
  });

  it('recommends RTL for Japanese manga', () => {
    const rec = getRecommendedReadingMode({ type: 'manga' });
    expect(rec.viewMode).toBe('rtl');
    expect(rec.noPanelSpacing).toBe(false);
  });

  it('recommends webtoon-seamless (0px) for Manhwa/Manhua', () => {
    const manhwaRec = getRecommendedReadingMode({ type: 'manhwa' });
    expect(manhwaRec.viewMode).toBe('webtoon-seamless');
    expect(manhwaRec.noPanelSpacing).toBe(true);
    expect(manhwaRec.pageGap).toBe(0);

    const manhuaRec = getRecommendedReadingMode({ type: 'manhua' });
    expect(manhuaRec.viewMode).toBe('webtoon-seamless');
    expect(manhuaRec.noPanelSpacing).toBe(true);
  });
});
