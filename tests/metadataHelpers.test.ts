import { describe, it, expect } from 'vitest';
import {
  calculateStringSimilarity,
  sanitizeTitleForSearch,
  cleanHtml,
  decodeHtmlEntities,
  parseGenericLiveSeriesMetadata,
} from '../server/services/metadataService';
import {
  scoreMangaItem,
  pickBestRepresentative,
  resolveAtomicField,
  resolveAggregativeField,
  snapshotMetadataOverrides,
  restoreMetadataOverrides,
  applyOverrides,
  ensureCoreFields,
  DEFAULT_UNKNOWN_RATING,
  preferEnglishTitle,
  ATOMIC_METADATA_FIELDS,
  AGGREGATIVE_METADATA_FIELDS,
  OVERRIDEABLE_METADATA_FIELDS,
} from '../src/utils/metadataHelpers';
import { MangaItem } from '../src/types';
import { mergeMangaItems, dedupeCatalog, normalizeTitleKey } from '../src/utils/catalog';

// ── Test fixtures ─────────────────────────────────────────────────────────────

function makeManga(overrides: Partial<MangaItem> = {}): MangaItem {
  return {
    id: 'test_1',
    title: 'Test Title',
    altTitles: [],
    type: 'manga',
    coverImage: 'https://example.com/cover.jpg',
    description: 'A test description.',
    genres: ['Action'],
    status: 'reading',
    currentChapter: 1,
    totalChapters: 10,
        latestChapter: 0,
    lastUpdated: new Date().toISOString(),
    rating: 7.5,
    sourceUrl: '',
    sourceName: 'Test Source',
    autoUpdateEnabled: true,
    notes: '',
    addedAt: new Date().toISOString(),
    lastReadAt: new Date().toISOString(),
    ...overrides,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
describe('calculateStringSimilarity', () => {
  it('returns 100 for exact match', () => {
    expect(calculateStringSimilarity('Solo Leveling', 'Solo Leveling')).toBe(100);
  });

  it('returns 100 for case-insensitive exact match', () => {
    expect(calculateStringSimilarity('Solo Leveling', 'SOLO LEVELING')).toBe(100);
  });

  it('returns 0 for empty strings', () => {
    expect(calculateStringSimilarity('', '')).toBe(0);
    expect(calculateStringSimilarity('', 'something')).toBe(0);
    expect(calculateStringSimilarity('something', '')).toBe(0);
  });

  it('returns 85 when one title is a substring of the other', () => {
    expect(calculateStringSimilarity('Solo', 'Solo Leveling')).toBe(85);
    expect(calculateStringSimilarity('Solo Leveling', 'Solo')).toBe(85);
  });

  it('normalizes Unicode diacritics before comparing', () => {
    expect(calculateStringSimilarity('Côco', 'Coco')).toBe(100);
    expect(calculateStringSimilarity('Nausicaä', 'Nausicaa')).toBe(100);
    expect(calculateStringSimilarity('Café', 'Cafe')).toBe(100);
  });

  it('returns a low score for completely different titles', () => {
    const score = calculateStringSimilarity('Solo Leveling', 'Attack on Titan');
    expect(score).toBeLessThan(60);
  });

    it('handles accented characters in the middle of longer titles', () => {
    const score = calculateStringSimilarity('Boku dake Level Up na Ken', 'Boku dake Level Up na Ken');
    expect(score).toBe(100);
    const score2 = calculateStringSimilarity('Côco Pockets', 'Coco Pockets');
    expect(score2).toBe(100);
  });
});

describe('sanitizeTitleForSearch', () => {
  it('decodes HTML entities', () => {
    expect(sanitizeTitleForSearch('Solo &amp; Leveling')).toBe('Solo & Leveling');
  });

  it('strips bracketed source/release tags', () => {
    expect(sanitizeTitleForSearch('Solo Leveling [Official]')).toBe('Solo Leveling');
    expect(sanitizeTitleForSearch('Solo Leveling [Raw]')).toBe('Solo Leveling');
    expect(sanitizeTitleForSearch('Test [Uncensored]')).toBe('Test');
  });

  it('strips parenthetical source/release tags', () => {
    expect(sanitizeTitleForSearch('Solo Leveling (Official)')).toBe('Solo Leveling');
    expect(sanitizeTitleForSearch('Solo Leveling (Raw HD)')).toBe('Solo Leveling');
  });

  it('strips source-name suffixes', () => {
    expect(sanitizeTitleForSearch('Solo Leveling - Asura Scans')).toBe('Solo Leveling');
    expect(sanitizeTitleForSearch('Solo Leveling | MangaDex')).toBe('Solo Leveling');
    expect(sanitizeTitleForSearch('Solo Leveling: Asura Scans')).toBe('Solo Leveling');
    expect(sanitizeTitleForSearch('Onii-chan: Weeb Central')).toBe('Onii-chan');
  });

  it('strips chapter/episode suffixes', () => {
    expect(sanitizeTitleForSearch('Solo Leveling Chapter 5')).toBe('Solo Leveling');
    expect(sanitizeTitleForSearch('Solo Leveling - Ch. 3')).toBe('Solo Leveling');
    expect(sanitizeTitleForSearch('Solo Leveling Episode 12')).toBe('Solo Leveling');
    expect(sanitizeTitleForSearch('My Manga S1')).toBe('My Manga');
  });

  it('normalizes Unicode diacritics', () => {
    expect(sanitizeTitleForSearch('Côco Poko')).toBe('Coco Poko');
    expect(sanitizeTitleForSearch('Café noir')).toBe('Cafe noir');
  });

  it('returns empty string for falsy input', () => {
    expect(sanitizeTitleForSearch('')).toBe('');
    expect(sanitizeTitleForSearch(undefined as any)).toBe('');
    expect(sanitizeTitleForSearch(null as any)).toBe('');
  });

    it('collapses whitespace and trims', () => {
    expect(sanitizeTitleForSearch('  Solo   Leveling  ')).toBe('Solo Leveling');
  });
});

describe('cleanHtml', () => {
  it('strips HTML tags', () => {
    expect(cleanHtml('<p>Hello <b>world</b></p>')).toBe('Hello world');
  });

  it('decodes HTML entities', () => {
    expect(cleanHtml('Tom &amp; Jerry &lt;3')).toBe('Tom & Jerry <3');
  });

  it('converts tags to spaces (not concatenation)', () => {
    expect(cleanHtml('Hello<br>World')).toBe('Hello World');
    expect(cleanHtml('<p>One</p><p>Two</p>')).toBe('One Two');
  });

  it('collapses whitespace', () => {
    expect(cleanHtml('  a   b  ')).toBe('a b');
  });

  it('returns empty string for falsy input', () => {
    expect(cleanHtml('')).toBe('');
    expect(cleanHtml(null as any)).toBe('');
  });
});

describe('decodeHtmlEntities', () => {
  it('decodes common named entities', () => {
    expect(decodeHtmlEntities('&amp;')).toBe('&');
    expect(decodeHtmlEntities('&quot;')).toBe('"');
    expect(decodeHtmlEntities('&#039;')).toBe("'");
    expect(decodeHtmlEntities('&lt;')).toBe('<');
    expect(decodeHtmlEntities('&gt;')).toBe('>');
    expect(decodeHtmlEntities('&mdash;')).toBe('—');
    expect(decodeHtmlEntities('&hellip;')).toBe('…');
  });

  it('decodes numeric entities', () => {
    expect(decodeHtmlEntities('&#65;')).toBe('A');
    expect(decodeHtmlEntities('&#x41;')).toBe('A');
  });

  it('returns empty string for falsy input', () => {
    expect(decodeHtmlEntities('')).toBe('');
  });
});

describe('preferEnglishTitle', () => {
  it('returns the "en" title when present', () => {
    expect(preferEnglishTitle({ en: 'Solo Leveling', ja: 'ソロレベリング' })).toBe('Solo Leveling');
  });

  it('falls back to the first available value', () => {
    expect(preferEnglishTitle({ ja: 'ソロレベリング' })).toBe('ソロレベリング');
  });

    it('returns null for empty or null input', () => {
    expect(preferEnglishTitle(null)).toBeNull();
    expect(preferEnglishTitle(undefined)).toBeNull();
    expect(preferEnglishTitle({})).toBeNull();
  });
});

describe('scoreMangaItem', () => {
  it('gives a base score of ~0 for a bare item', () => {
    const bare = makeManga({ availableSources: [], rating: undefined, latestChapter: 0, sourceUrl: '', apiId: null });
    expect(scoreMangaItem(bare)).toBe(0);
  });

  it('adds 10000 for favorite', () => {
    expect(scoreMangaItem(makeManga({ isFavorite: true, rating: undefined }))).toBeGreaterThanOrEqual(10000);
    expect(scoreMangaItem(makeManga({ isFavorite: false, rating: undefined }))).toBe(0);
  });

  it('adds 1000 per linked source', () => {
    const with2 = makeManga({
      rating: undefined,
      availableSources: [{ sourceName: 'A', sourceUrl: 'https://a.com' }, { sourceName: 'B', sourceUrl: 'https://b.com' }],
    });
    expect(scoreMangaItem(with2)).toBe(2000);
  });

  it('adds 500 for having an apiId or sourceUrl', () => {
    expect(scoreMangaItem(makeManga({ apiId: '123', rating: undefined }))).toBe(500);
    expect(scoreMangaItem(makeManga({ sourceUrl: 'https://example.com/test', rating: undefined }))).toBe(500);
  });

  it('adds latestChapter points', () => {
    const a = makeManga({ latestChapter: 50, rating: undefined });
    const b = makeManga({ latestChapter: 100, rating: undefined });
    expect(scoreMangaItem(b)).toBeGreaterThan(scoreMangaItem(a));
  });

  it('adds rating * 10 points', () => {
    expect(scoreMangaItem(makeManga({ rating: 9 }))).toBe(90);
  });
});

describe('pickBestRepresentative', () => {
  it('returns the higher-scoring item', () => {
    const a = makeManga({ id: 'a', isFavorite: true });
    const b = makeManga({ id: 'b', isFavorite: false });
    expect(pickBestRepresentative(a, b)).toBe(a);
    expect(pickBestRepresentative(b, a)).toBe(a);
  });

  it('returns `a` on a tie', () => {
    const a = makeManga({ id: 'a', rating: 7 });
    const b = makeManga({ id: 'b', rating: 7 });
    expect(pickBestRepresentative(a, b)).toBe(a);
  });
});

describe('resolveAtomicField', () => {
  it('prefers the preferred value when non-empty', () => {
    const preferred = makeManga({ title: 'Preferred Title' });
    const other = makeManga({ title: 'Other Title' });
    expect(resolveAtomicField(preferred, other, 'title')).toBe('Preferred Title');
  });

  it('falls back to the other value when preferred is empty', () => {
    const preferred = makeManga({ title: '  ' });
    const other = makeManga({ title: 'Other Title' });
    expect(resolveAtomicField(preferred, other, 'title')).toBe('Other Title');
  });

  it('falls back to the other value when preferred cover is empty', () => {
    const preferred = makeManga({ coverImage: '' });
    const other = makeManga({ coverImage: 'https://other/cover.jpg' });
    expect(resolveAtomicField(preferred, other, 'coverImage')).toBe('https://other/cover.jpg');
  });

  it('treats number 0 as absent for rating', () => {
    const preferred = makeManga({ rating: 0 });
    const other = makeManga({ rating: 8 });
    expect(resolveAtomicField(preferred, other, 'rating')).toBe(8);
  });

  it('uses the non-zero rating from preferred', () => {
    const preferred = makeManga({ rating: 8 });
    const other = makeManga({ rating: 5 });
    expect(resolveAtomicField(preferred, other, 'rating')).toBe(8);
  });

  it('treats empty title as absent and falls back to other', () => {
    const preferred = makeManga({ title: '' });
    const other = makeManga({ title: 'Other Title' });
    expect(resolveAtomicField(preferred, other, 'title')).toBe('Other Title');
  });
});

describe('resolveAggregativeField', () => {
  it('unions and de-duplicates', () => {
    const a = makeManga({ genres: ['Action', 'Fantasy'] });
    const b = makeManga({ genres: ['Fantasy', 'Adventure'] });
    expect(resolveAggregativeField(a, b, 'genres')).toEqual(['Action', 'Fantasy', 'Adventure']);
  });

  it('filters out falsy values', () => {
    const a = makeManga({ altTitles: ['Title A', '', undefined as any, 'Title B'] });
    const b = makeManga({ altTitles: [] });
    expect(resolveAggregativeField(a, b, 'altTitles')).toEqual(['Title A', 'Title B']);
  });

    it('returns empty array when both are empty', () => {
    const a = makeManga({ genres: [] });
    const b = makeManga({ genres: [] });
    expect(resolveAggregativeField(a, b, 'genres')).toEqual([]);
  });
});

describe('snapshotMetadataOverrides / restoreMetadataOverrides', () => {
  it('only snapshots fields listed in metadataOverrides', () => {
    const manga = makeManga({
      title: 'Original',
      description: 'Original desc',
      rating: 8,
      genres: ['Action'],
      metadataOverrides: ['title', 'rating', 'isNsfw'] as string[],
      isNsfw: true,
    });
    const snap = snapshotMetadataOverrides(manga);
    expect(snap.title).toBe('Original');
    expect(snap.rating).toBe(8);
    expect(snap.isNsfw).toBe(true);
    expect(snap).not.toHaveProperty('description');
    expect(snap).not.toHaveProperty('genres');
  });

  it('snapshots empty object when no overrides', () => {
    const manga = makeManga({ metadataOverrides: [] });
    expect(snapshotMetadataOverrides(manga)).toEqual({});
  });

  it('defensively copies arrays so mutations do not leak', () => {
    const manga = makeManga({
      genres: ['Action'],
      metadataOverrides: ['genres'],
    });
    const snap = snapshotMetadataOverrides(manga);
    (snap.genres as string[]).push('Hacked');
    expect(manga.genres).toEqual(['Action']);
  });

  it('restores overridden values after a remote refresh clobbers them', () => {
    const manga = makeManga({
      title: 'User Title',
      description: 'User description',
      metadataOverrides: ['title', 'description'],
    });
    const snap = snapshotMetadataOverrides(manga);

    manga.title = 'Remote Title';
    manga.description = 'Remote description';

    restoreMetadataOverrides(manga, snap);
    expect(manga.title).toBe('User Title');
    expect(manga.description).toBe('User description');
  });

  it('leaves non-overridden fields at their post-refresh values', () => {
    const manga = makeManga({
      title: 'User Title',
      description: 'User desc',
      rating: 8,
      metadataOverrides: ['title'],
    });
    const snap = snapshotMetadataOverrides(manga);
    manga.title = 'Remote';
    manga.rating = 5;
    restoreMetadataOverrides(manga, snap);
    expect(manga.title).toBe('User Title');
    expect(manga.rating).toBe(5); // not overridden, stays at remote value
  });
});

describe('applyOverrides', () => {
  it('returns the same object reference when snap is empty', () => {
    const item = makeManga();
    expect(applyOverrides(item, {})).toBe(item);
  });

  it('overrides specified fields', () => {
    const item = makeManga({ title: 'Original' });
    const result = applyOverrides(item, { title: 'Overridden' });
    expect(result.title).toBe('Overridden');
  });
});

describe('ensureCoreFields', () => {
  it('applies DEFAULT_UNKNOWN_RATING when rating is undefined', () => {
    const result = ensureCoreFields({ id: 'x', title: 'X', altTitles: [], type: 'manga', description: '', genres: [] });
    expect(result.rating).toBe(DEFAULT_UNKNOWN_RATING);
  });

  it('preserves a real rating', () => {
    const result = ensureCoreFields({ id: 'x', title: 'X', altTitles: [], type: 'manga', description: '', genres: [], rating: 8.5 });
    expect(result.rating).toBe(8.5);
  });

  it('falls back to Untitled when title is empty', () => {
    const result = ensureCoreFields({ id: 'x', title: '', altTitles: [], type: 'manga', description: '', genres: [] });
    expect(result.title).toBe('Untitled x');
  });

  it('falls back to ["Action","Fantasy"] when genres are empty', () => {
    const result = ensureCoreFields({ id: 'x', title: 'X', altTitles: [], type: 'manga', description: '', genres: [] });
    expect(result.genres).toEqual(['Action', 'Fantasy']);
  });

  it('preserves existing genres', () => {
    const result = ensureCoreFields({ id: 'x', title: 'X', altTitles: [], type: 'manga', description: '', genres: ['Comedy'] });
    expect(result.genres).toEqual(['Comedy']);
  });

  it('fills a description placeholder when empty', () => {
    const result = ensureCoreFields({ id: 'x', title: 'My Series', altTitles: [], type: 'manga', description: '', genres: ['Action'] });
    expect(result.description).toContain('My Series');
  });

  it('fills a default cover when empty', () => {
    const result = ensureCoreFields({ id: 'x', title: 'X', altTitles: [], type: 'manga', description: '', genres: [] });
    expect(result.coverImage).toBeTruthy();
  });
});

describe('Field category constants', () => {
  it('OVERRIDEABLE includes atomic genres and altTitles', () => {
    expect(OVERRIDEABLE_METADATA_FIELDS).toContain('title');
    expect(OVERRIDEABLE_METADATA_FIELDS).toContain('genres');
    expect(OVERRIDEABLE_METADATA_FIELDS).toContain('altTitles');
    expect(OVERRIDEABLE_METADATA_FIELDS).toContain('rating');
    expect(OVERRIDEABLE_METADATA_FIELDS).toContain('isNsfw');
  });

  it('AGGREGATIVE includes altTitles, genres, metadataOverrides', () => {
    expect(AGGREGATIVE_METADATA_FIELDS).toEqual(['altTitles', 'genres', 'metadataOverrides']);
  });

    it('ATOMIC includes the core descriptive fields plus isNsfw', () => {
    expect(ATOMIC_METADATA_FIELDS).toEqual(['title', 'description', 'coverImage', 'rating', 'isNsfw']);
  });
});

describe('normalizeTitleKey', () => {
  it('is accent-insensitive and alphanumeric only', () => {
    expect(normalizeTitleKey('Côco Poko')).toBe('cocopoko');
    expect(normalizeTitleKey('Coco Poko')).toBe('cocopoko');
  });

  it('returns empty string for falsy input', () => {
    expect(normalizeTitleKey('')).toBe('');
    expect(normalizeTitleKey(null as any)).toBe('');
  });
});

describe('mergeMangaItems', () => {
  it('prefers source with a working reader for atomic fields', () => {
    const live = makeManga({
      id: 'live',
      title: 'Live Title',
      description: 'Live description',
      sourceUrl: 'https://asurascans.com/manga/test',
      sourceName: 'Asura Scans',
    });
    const md = makeManga({
      id: 'md',
      title: 'MD Title',
      description: 'MD description',
      sourceUrl: 'https://mangadex.org/title/abc',
      sourceName: 'MangaDex',
    });
    const merged = mergeMangaItems(live, md);
    expect(merged.title).toBe('Live Title');
    expect(merged.description).toBe('Live description');
  });

  it('unions aggregative fields (altTitles, genres)', () => {
    const a = makeManga({ id: 'a', title: 'A', altTitles: ['Alt A'], genres: ['Action'] });
    const b = makeManga({ id: 'b', title: 'B', altTitles: ['Alt B'], genres: ['Fantasy'] });
    const merged = mergeMangaItems(a, b);
    expect(merged.altTitles).toEqual(expect.arrayContaining(['Alt A', 'Alt B']));
    expect(merged.genres).toEqual(expect.arrayContaining(['Action', 'Fantasy']));
  });

  it('preserves local overrides over merged remote data', () => {
    const a = makeManga({
      id: 'a',
      title: 'User Title',
      description: 'User description',
      sourceUrl: 'https://asurascans.com/manga/test',
      sourceName: 'Asura Scans',
      metadataOverrides: ['title', 'description'],
    });
    const b = makeManga({ id: 'b', title: 'Remote Title', description: 'Remote desc', sourceUrl: '' });
    const merged = mergeMangaItems(a, b);
    expect(merged.title).toBe('User Title');
    expect(merged.description).toBe('User description');
  });

  it('guarantees non-empty core fields via ensureCoreFields', () => {
    const a = makeManga({ id: 'a', title: '', description: '', genres: [], rating: 0, sourceUrl: '' });
    const b = makeManga({ id: 'b', title: '', description: '', genres: [], rating: 0, sourceUrl: '' });
    const merged = mergeMangaItems(a, b);
    expect(merged.title).not.toBe('');
    expect(merged.description).not.toBe('');
    expect(merged.genres.length).toBeGreaterThan(0);
  });

    it('unions availableSources from both items', () => {
    const a = makeManga({ id: 'a', title: 'A', sourceUrl: 'https://a.com', sourceName: 'A', availableSources: [{ sourceName: 'A', sourceUrl: 'https://a.com' }] });
    const b = makeManga({ id: 'b', title: 'B', sourceUrl: 'https://b.com', sourceName: 'B', availableSources: [{ sourceName: 'B', sourceUrl: 'https://b.com' }] });
    const merged = mergeMangaItems(a, b);
    expect(merged.availableSources?.length).toBe(2);
  });
});

describe('dedupeCatalog', () => {
  it('merges items with the same normalized title', () => {
    const items = [
      makeManga({ id: 'a', title: 'Solo Leveling', sourceUrl: 'https://a.com', sourceName: 'Source A', genres: ['Action'], availableSources: [{ sourceName: 'Source A', sourceUrl: 'https://a.com' }] }),
      makeManga({ id: 'b', title: 'Solo Leveling', sourceUrl: 'https://b.com', sourceName: 'Source B', genres: ['Fantasy'], availableSources: [{ sourceName: 'Source B', sourceUrl: 'https://b.com' }] }),
    ];
    const result = dedupeCatalog(items);
    expect(result.length).toBe(1);
    expect(result[0].genres).toEqual(expect.arrayContaining(['Action', 'Fantasy']));
    expect(result[0].availableSources?.length).toBe(2);
  });

  it('does NOT merge items with different non-empty apiIds', () => {
    const items = [
      makeManga({ id: 'a', title: 'Solo Leveling', apiId: 'md-1' }),
      makeManga({ id: 'b', title: 'Solo Leveling', apiId: 'mu-2' }),
    ];
    const result = dedupeCatalog(items);
    expect(result.length).toBe(2);
  });

  it('preserves untitled items', () => {
    const items = [
      makeManga({ id: 'a', title: '', sourceUrl: 'https://a.com' }),
    ];
    const result = dedupeCatalog(items);
    expect(result.length).toBe(1);
    expect(result[0].title).toContain('Untitled');
  });
});

describe('parseGenericLiveSeriesMetadata', () => {
  it('extracts metadata from JSON-LD structured data', () => {
    const html = `
      <html><head>
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Book",
          "name": "Solo Leveling",
          "description": "A hunter story.",
          "image": { "url": "https://example.com/cover.jpg" },
          "genre": ["Action", "Fantasy"]
        }
        </script>
      </head><body></body></html>
    `;
    const result = parseGenericLiveSeriesMetadata(html, 'https://example.com/series/solo-leveling');
    expect(result).not.toBeNull();
    expect(result!.title).toBe('Solo Leveling');
    expect(result!.description).toBe('A hunter story.');
    expect(result!.coverImage).toBe('https://example.com/cover.jpg');
    expect(result!.genres).toEqual(['Action', 'Fantasy']);
  });

  it('extracts metadata from JSON-LD with @graph', () => {
    const html = `
      <html><head>
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@graph": [
            { "@type": "Book", "name": "Graph Title", "description": "Graph desc." }
          ]
        }
        </script>
      </head><body></body></html>
    `;
    const result = parseGenericLiveSeriesMetadata(html, 'https://example.com/series/graph');
    expect(result).not.toBeNull();
    expect(result!.title).toBe('Graph Title');
  });

  it('falls back to CSS selector for title', () => {
    const html = `
      <html><body>
        <div class="post-title"><h1>Cascading Title</h1></div>
      </body></html>
    `;
    const result = parseGenericLiveSeriesMetadata(html, 'https://example.com/series/css');
    expect(result).not.toBeNull();
    expect(result!.title).toBe('Cascading Title');
  });

  it('resolves relative cover URLs against the page origin', () => {
    const html = `
      <html><body>
        <div class="summary_image"><img src="/covers/123.jpg" /></div>
      </body></html>
    `;
    const result = parseGenericLiveSeriesMetadata(html, 'https://example.com/series/test');
    expect(result).not.toBeNull();
    expect(result!.coverImage).toBe('https://example.com/covers/123.jpg');
  });

  it('upgrades protocol-relative cover URLs', () => {
    const html = `
      <html><body>
        <div class="summary_image"><img src="//cdn.example.com/cover.jpg" /></div>
      </body></html>
    `;
    const result = parseGenericLiveSeriesMetadata(html, 'https://example.com/series/test');
    expect(result).not.toBeNull();
    expect(result!.coverImage).toBe('https://cdn.example.com/cover.jpg');
  });

  it('returns null for empty HTML', () => {
    expect(parseGenericLiveSeriesMetadata('', 'https://example.com')).toBeNull();
    expect(parseGenericLiveSeriesMetadata(null as any, 'https://example.com')).toBeNull();
  });

  it('returns null for ad series', () => {
    const html = `
      <html><head><title>ChristinaSiemone Cam Model: Free Live Sex Show & Chat</title></head><body></body></html>
    `;
    expect(parseGenericLiveSeriesMetadata(html, 'https://mangahentai.me/ad-landing')).toBeNull();
  });

  it('extracts latest chapter from parsed chapter list', () => {
    const html = `
      <html><body>
        <ul class="chapter-list">
          <li><a href="/series/chapter-50">Chapter 50</a></li>
          <li><a href="/series/chapter-51">Chapter 51</a></li>
        </ul>
      </body></html>
    `;
    const result = parseGenericLiveSeriesMetadata(html, 'https://example.com/series/test');
    expect(result).not.toBeNull();
    expect(result!.latestChapter).toBe(51);
  });
});




