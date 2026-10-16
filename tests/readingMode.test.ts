import { describe, it, expect, beforeEach } from 'vitest';
import { detectMangaFormat, getRecommendedReadingMode } from '../src/utils/readingMode';

const memoryStore: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (k: string) => memoryStore[k] || null,
  setItem: (k: string, v: string) => { memoryStore[k] = String(v); },
  removeItem: (k: string) => { delete memoryStore[k]; },
  clear: () => { Object.keys(memoryStore).forEach((k) => delete memoryStore[k]); },
};

if (typeof (globalThis as any).localStorage === 'undefined' || !(globalThis as any).localStorage?.setItem) {
  (globalThis as any).localStorage = mockLocalStorage;
}

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

  it('exposes modern ReadingMode and ReadingDirection on recommended format', () => {
    const mangaRec = getRecommendedReadingMode({ type: 'manga' });
    expect(mangaRec.mode).toBe('single');
    expect(mangaRec.direction).toBe('rtl');
    expect(mangaRec.seamless).toBe(false);

    const manhwaRec = getRecommendedReadingMode({ type: 'manhwa' });
    expect(manhwaRec.mode).toBe('webtoon');
    expect(manhwaRec.direction).toBe('vertical');
    expect(manhwaRec.seamless).toBe(true);
    expect(manhwaRec.gapPx).toBe(0);
  });
});

describe('ReaderSettings Configuration Contract & Normalization', () => {
  it('normalizes partial settings into complete ReaderSettings contract', async () => {
    const { normalizeReaderSettings, DEFAULT_READER_SETTINGS } = await import('../src/types/reader');

    const empty = normalizeReaderSettings({});
    expect(empty.mode).toBe('webtoon');
    expect(empty.direction).toBe('vertical');
    expect(empty.fit).toBe('fit-width');
    expect(empty.seamless).toBe(true);
    expect(empty.gapPx).toBe(0);
    expect(empty.spreadCoverOffset).toBe(true);
    expect(empty.backgroundTheme).toBe('dark');

    // Legacy viewMode: 'rtl' mapping
    const rtlLegacy = normalizeReaderSettings({ viewMode: 'rtl' });
    expect(rtlLegacy.mode).toBe('single');
    expect(rtlLegacy.direction).toBe('rtl');
    expect(rtlLegacy.viewMode).toBe('rtl');

    // Legacy viewMode: 'double' mapping
    const doubleLegacy = normalizeReaderSettings({ viewMode: 'double', spreadCoverOffset: false });
    expect(doubleLegacy.mode).toBe('double');
    expect(doubleLegacy.spreadCoverOffset).toBe(false);

    // Custom gapPx synchronization
    const gapped = normalizeReaderSettings({ gapPx: 12, seamless: false });
    expect(gapped.gapPx).toBe(12);
    expect(gapped.pageGap).toBe(12);
    expect(gapped.seamless).toBe(false);

    // Seamless forces gapPx to 0
    const seamlessZero = normalizeReaderSettings({ gapPx: 16, seamless: true });
    expect(seamlessZero.gapPx).toBe(0);
    expect(seamlessZero.pageGap).toBe(0);
    expect(seamlessZero.seamless).toBe(true);
  });

  it('persists and resolves per-series reader layout overrides', async () => {
    const { saveSeriesReadingMode, getSavedSeriesReadingMode, resolveInitialReaderSettings } = await import('../src/utils/readingMode');
    const testManga: any = {
      id: 'manga_layout_test_series',
      title: 'Layout Test Series',
      type: 'manga',
    };

    saveSeriesReadingMode(testManga.id, {
      mode: 'double',
      direction: 'rtl',
      fit: 'fit-height',
      spreadCoverOffset: true,
      backgroundTheme: 'black',
    });

    const saved = getSavedSeriesReadingMode(testManga.id);
    expect(saved).not.toBeNull();
    expect(saved?.mode).toBe('double');
    expect(saved?.direction).toBe('rtl');
    expect(saved?.fit).toBe('fit-height');
    expect(saved?.backgroundTheme).toBe('black');

    const resolved = resolveInitialReaderSettings(testManga);
    expect(resolved.mode).toBe('double');
    expect(resolved.direction).toBe('rtl');
    expect(resolved.fit).toBe('fit-height');
    expect(resolved.backgroundTheme).toBe('black');
  });
});
