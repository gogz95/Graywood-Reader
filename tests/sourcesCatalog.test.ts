import { describe, it, expect } from 'vitest';
import {
  ALL_SOURCES_CATALOG,
  KOTATSU_SOURCES,
  getSourceById,
  isSourceAlive,
  isMetadataOnlySource,
  buildFullSourceInventory,
  ensureSourceInRegistry,
  rebuildDeadSourcesSet,
} from '../server/sources/sourcesCatalog';
import { isContentPath, isNavText } from '../server/routes/manga';
import {
  isValidPanelImageUrl,
  parseSrcsetCandidate,
  extractPanelImages,
} from '../server/services/crawlerEngine';

describe('Standalone Sources Catalog', () => {
  it('loads a comprehensive catalog of 1,000+ sources', () => {
    expect(ALL_SOURCES_CATALOG.length).toBeGreaterThan(1000);
  });

  it('filters active sources without dead sources in KOTATSU_SOURCES', () => {
    expect(KOTATSU_SOURCES.length).toBeGreaterThan(50);
    expect(KOTATSU_SOURCES.some((s) => s.id === 'dynasty')).toBe(false);
    expect(KOTATSU_SOURCES.some((s) => s.id === 'reaper')).toBe(false);
    expect(KOTATSU_SOURCES.some((s) => s.id === 'batoto')).toBe(false);
    expect(KOTATSU_SOURCES.some((s) => s.id === 'comick')).toBe(false);
    expect(KOTATSU_SOURCES.some((s) => s.id === 'comickfun')).toBe(false);
    expect(KOTATSU_SOURCES.some((s) => s.id === 'asurascans')).toBe(true);
  });

  it('correctly retrieves sources by ID (case-insensitive)', () => {
    const asura = getSourceById('asurascans');
    expect(asura).toBeDefined();
    expect(asura?.name).toContain('Asura');
    expect(asura?.baseUrl).toMatch(/^https:\/\//);

    const asuraUpper = getSourceById('ASURASCANS');
    expect(asuraUpper).toBeDefined();
    expect(asuraUpper?.id).toBe('asurascans');
  });

  it('correctly identifies metadata-only sources (MangaDex)', () => {
    expect(isMetadataOnlySource('mangadex')).toBe(true);
    expect(isMetadataOnlySource('mangadex', 'https://mangadex.org')).toBe(true);
    expect(isMetadataOnlySource('asurascans')).toBe(false);
  });

  it('correctly validates source aliveness', () => {
    const mockSyncConfig = {
      subdomain: 'test',
      autoUpdateIntervalMinutes: 60,
      enableWebCrawling: true,
      sources: [],
      disabledSources: [],
      removedSources: ['customdeadsource'],
      reactivatedSources: [],
      lastSyncTime: '',
      totalTracked: 0,
    };

    rebuildDeadSourcesSet(mockSyncConfig);

    expect(isSourceAlive('asurascans', mockSyncConfig)).toBe(true);
    expect(isSourceAlive('dynasty', mockSyncConfig)).toBe(false);
    expect(isSourceAlive('batoto', mockSyncConfig)).toBe(false);
    expect(isSourceAlive('comick', mockSyncConfig)).toBe(false);
    expect(isSourceAlive('comickfun', mockSyncConfig)).toBe(false);
    expect(isSourceAlive('customdeadsource', mockSyncConfig)).toBe(false);
  });

  it('allows reactivated sources to override dead status', () => {
    const mockSyncConfig = {
      subdomain: 'test',
      autoUpdateIntervalMinutes: 60,
      enableWebCrawling: true,
      sources: [],
      disabledSources: [],
      removedSources: ['customdeadsource'],
      reactivatedSources: ['customdeadsource'],
      lastSyncTime: '',
      totalTracked: 0,
    };

    expect(isSourceAlive('customdeadsource', mockSyncConfig)).toBe(true);
  });

  it('builds full inventory with accurate states', () => {
    const mockSyncConfig = {
      subdomain: 'test',
      autoUpdateIntervalMinutes: 60,
      enableWebCrawling: true,
      sources: [],
      disabledSources: ['flamecomics'],
      removedSources: [],
      reactivatedSources: [],
      lastSyncTime: '',
      totalTracked: 0,
    };

    const inventory = buildFullSourceInventory(mockSyncConfig);
    expect(inventory.length).toBeGreaterThan(1000);

    const mangadex = inventory.find((s) => s.id === 'mangadex');
    expect(mangadex?.isMetadataOnly).toBe(true);
    expect(mangadex?.status).toBe('metadata');

    const flame = inventory.find((s) => s.id === 'flamecomics');
    expect(flame?.status).toBe('disabled');
  });

  it('ensures dynamic source registration via ensureSourceInRegistry', () => {
    const src = ensureSourceInRegistry('asurascans');
    expect(src).toBeDefined();
    expect(src?.id).toBe('asurascans');
  });
});

describe('Content Path Recognition & Navigation Filtering', () => {
  it('correctly accepts standard and international manga content paths', () => {
    expect(isContentPath('/manga/solo-leveling')).toBe(true);
    expect(isContentPath('https://site.com/series/omniscient-reader/')).toBe(true);
    expect(isContentPath('/title/12345/martial-peak')).toBe(true);
    expect(isContentPath('/manhwa/tower-of-god')).toBe(true);
    expect(isContentPath('/manhua/apotheosis')).toBe(true);
    expect(isContentPath('/comic/batman')).toBe(true);
    expect(isContentPath('/comics/batman')).toBe(true);
    expect(isContentPath('/webtoon/lore-olympus')).toBe(true);
    expect(isContentPath('/read/magic-emperor')).toBe(true);
    expect(isContentPath('/reader/magic-emperor')).toBe(true);
    expect(isContentPath('/view/return-of-the-mount-hua-sect')).toBe(true);
    expect(isContentPath('/book/peerless-dad')).toBe(true);
    expect(isContentPath('/truyen/dau-pha-thuong-khung')).toBe(true);
    expect(isContentPath('/story/legend-of-the-northern-blade')).toBe(true);
    expect(isContentPath('/detail/nano-machine')).toBe(true);
    expect(isContentPath('/project/overgeared')).toBe(true);
    expect(isContentPath('/online/the-beginning-after-the-end')).toBe(true);
    expect(isContentPath('/solo-leveling')).toBe(true);
  });

  it('rejects navigation, system, and non-content paths', () => {
    expect(isContentPath('')).toBe(false);
    expect(isContentPath('#comment')).toBe(false);
    expect(isContentPath('javascript:void(0)')).toBe(false);
    expect(isContentPath('/home')).toBe(false);
    expect(isContentPath('/login')).toBe(false);
    expect(isContentPath('/register')).toBe(false);
    expect(isContentPath('/privacy')).toBe(false);
    expect(isContentPath('/dmca')).toBe(false);
    expect(isContentPath('/terms')).toBe(false);
    expect(isContentPath('/bookmarks')).toBe(false);
    expect(isContentPath('/categories')).toBe(false);
  });

  it('correctly identifies navigation text and ignores valid titles', () => {
    expect(isNavText('Home')).toBe(true);
    expect(isNavText('Login')).toBe(true);
    expect(isNavText('Sign Up')).toBe(true);
    expect(isNavText('Cookie Policy')).toBe(true);
    expect(isNavText('Privacy Policy')).toBe(true);
    expect(isNavText('DMCA Notice')).toBe(true);
    expect(isNavText('Discord Server')).toBe(true);
    expect(isNavText('Donate on Patreon')).toBe(true);

    expect(isNavText('Solo Leveling')).toBe(false);
    expect(isNavText('Tower of God Chapter 500')).toBe(false);
    expect(isNavText('The Beginning After the End')).toBe(false);
  });

  it('parses srcset candidates correctly to select the highest resolution URL', () => {
    const single = 'https://cdn.example.com/ch1/01.jpg';
    expect(parseSrcsetCandidate(single)).toBe(single);

    const srcset = 'https://cdn.example.com/ch1/01_thumb.jpg 300w, https://cdn.example.com/ch1/01_full.jpg 1200w';
    expect(parseSrcsetCandidate(srcset)).toBe('https://cdn.example.com/ch1/01_full.jpg');

    const multi = 'https://cdn.example.com/ch1/01.jpg 1x, https://cdn.example.com/ch1/01@2x.jpg 2x';
    expect(parseSrcsetCandidate(multi)).toBe('https://cdn.example.com/ch1/01@2x.jpg');
  });

  it('validates panel images and filters out logos, avatars, ads, and covers', () => {
    expect(isValidPanelImageUrl('https://cdn.example.com/uploads/ch1/001.webp')).toBe(true);
    expect(isValidPanelImageUrl('https://img.example.com/chapter-5/page-2.jpg')).toBe(true);
    expect(isValidPanelImageUrl('https://i.imgur.com/abcd123.png')).toBe(true);

    expect(isValidPanelImageUrl('https://site.com/static/logo.png')).toBe(false);
    expect(isValidPanelImageUrl('https://site.com/banners/top_ad.jpg')).toBe(false);
    expect(isValidPanelImageUrl('https://site.com/covers/solo-leveling.jpg')).toBe(false);
    expect(isValidPanelImageUrl('https://site.com/avatar/user123.jpg')).toBe(false);
    expect(isValidPanelImageUrl('https://site.com/img/discord.png')).toBe(false);
    expect(isValidPanelImageUrl('https://site.com/tracker/pixel.gif')).toBe(false);
    expect(isValidPanelImageUrl('https://doubleclick.net/ad.png')).toBe(false);
  });

  it('extracts panel images from multi-attribute HTML, srcset, and script JSON blocks', () => {
    const origin = 'https://example.com';
    const htmlWithImg = `
      <div class="reading-content">
        <img class="wp-manga-chapter-img" data-src="https://cdn.example.com/ch1/01.jpg" src="placeholder.jpg" />
        <img class="wp-manga-chapter-img" data-lazy-src="https://cdn.example.com/ch1/02.jpg" />
        <img class="wp-manga-chapter-img" data-original="/uploads/ch1/03.png" />
        <img class="wp-manga-chapter-img" srcset="https://cdn.example.com/ch1/04_thumb.jpg 300w, https://cdn.example.com/ch1/04_hq.webp 1200w" />
        <img class="banner-ad" src="https://example.com/ads/banner.jpg" />
        <img class="logo" src="https://example.com/img/logo.png" />
      </div>
    `;

    const extracted = extractPanelImages(htmlWithImg, origin);
    expect(extracted).toEqual([
      'https://cdn.example.com/ch1/01.jpg',
      'https://cdn.example.com/ch1/02.jpg',
      'https://example.com/uploads/ch1/03.png',
      'https://cdn.example.com/ch1/04_hq.webp',
    ]);
  });

  it('extracts panel images from ts_reader embedded JSON in script', () => {
    const origin = 'https://tsreader.example.com';
    const htmlWithTsReader = `
      <div id="readerarea"></div>
      <script>
        ts_reader.run({
          "prevUrl": "",
          "nextUrl": "",
          "sources": [{
            "source": "Default",
            "images": [
              "https://cdn.example.com/p1.webp",
              "https://cdn.example.com/p2.webp",
              "https://cdn.example.com/p3.webp"
            ]
          }]
        });
      </script>
    `;

    const extracted = extractPanelImages(htmlWithTsReader, origin);
    expect(extracted).toEqual([
      'https://cdn.example.com/p1.webp',
      'https://cdn.example.com/p2.webp',
      'https://cdn.example.com/p3.webp',
    ]);
  });

  it('extracts panel images from window.pages or Next.js JSON scripts', () => {
    const origin = 'https://nextreader.example.com';
    const htmlWithPages = `
      <script id="__NEXT_DATA__" type="application/json">
        {"props":{"pageProps":{"chapter":{"images":["https://cdn.example.com/page01.jpg","https://cdn.example.com/page02.jpg"]}}}}
      </script>
    `;

    const extracted = extractPanelImages(htmlWithPages, origin);
    expect(extracted).toEqual([
      'https://cdn.example.com/page01.jpg',
      'https://cdn.example.com/page02.jpg',
    ]);
  });
});
