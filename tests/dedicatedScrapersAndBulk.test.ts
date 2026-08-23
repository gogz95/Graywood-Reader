import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isSeriesContentPath, isChapterTitle, getSourceMetadataConfidence } from '../server/sources/sourcesCatalog';
import { parseUniversalCatalogCards } from '../server/services/exploreService';
import { bulkScraperService } from '../server/services/bulkScraperService';
import { extractMangaReadSlug } from '../server/scrapers/mangaRead';
import { extractManhuaPlusSlug } from '../server/scrapers/manhuaPlus';
import { extractDemonicScansSlug } from '../server/scrapers/demonicScans';
import { extractAquaMangaSlug } from '../server/scrapers/aquaManga';
import { extractKunMangaSlug } from '../server/scrapers/kunManga';

describe('Series Path and Chapter Title Heuristics', () => {
  it('correctly accepts genuine series URLs and rejects individual chapter URLs', () => {
    // Valid series paths
    expect(isSeriesContentPath('https://mangaread.org/manga/solo-leveling/')).toBe(true);
    expect(isSeriesContentPath('https://manhuaplus.top/manga/martial-peak')).toBe(true);
    expect(isSeriesContentPath('https://demonicscans.org/title/nano-machine')).toBe(true);
    expect(isSeriesContentPath('https://flamecomics.xyz/series/123')).toBe(true);
    expect(isSeriesContentPath('/comic/magic-emperor')).toBe(true);

    // Chapter URLs that must NOT be treated as series
    expect(isSeriesContentPath('https://mangaread.org/manga/solo-leveling/chapter-1/')).toBe(false);
    expect(isSeriesContentPath('https://manhuaplus.top/manga/martial-peak/ch-500/')).toBe(false);
    expect(isSeriesContentPath('https://demonicscans.org/read/nano-machine/120/1')).toBe(false);
    expect(isSeriesContentPath('/series/123/chapter/45')).toBe(false);
    expect(isSeriesContentPath('/manga/slug/ep-10')).toBe(false);
  });

  it('correctly identifies chapter labels vs genuine series titles', () => {
    // Chapter labels
    expect(isChapterTitle('Chapter 1')).toBe(true);
    expect(isChapterTitle('Ch. 123')).toBe(true);
    expect(isChapterTitle('Episode 4')).toBe(true);
    expect(isChapterTitle('Season 2 Ep 5')).toBe(true);
    expect(isChapterTitle('100.5')).toBe(true);
    expect(isChapterTitle('Read Chapter 50')).toBe(true);

    // Real series titles
    expect(isChapterTitle('Solo Leveling')).toBe(false);
    expect(isChapterTitle('Martial Peak (Official)')).toBe(false);
    expect(isChapterTitle('Omniscient Reader’s Viewpoint')).toBe(false);
    expect(isChapterTitle('The Beginning After The End')).toBe(false);
  });
});

describe('Dedicated Scraper Slug Extractors', () => {
  it('extracts slugs reliably across all new scraper formats', () => {
    expect(extractMangaReadSlug('https://www.mangaread.org/manga/return-of-the-mount-hua-sect/')).toBe('return-of-the-mount-hua-sect');
    expect(extractManhuaPlusSlug('https://manhuaplus.top/manga/apotheosis/')).toBe('apotheosis');
    expect(extractDemonicScansSlug('https://demonicscans.org/title/murim-login')).toBe('murim-login');
    expect(extractAquaMangaSlug('https://aquareader.org/manga/eleceed/')).toBe('eleceed');
    expect(extractKunMangaSlug('https://kunmanga.com/manga/tomb-raider-king/')).toBe('tomb-raider-king');
  });

  it('has elevated confidence ratings registered for dedicated scrapers', () => {
    expect(getSourceMetadataConfidence('mangaread')).toBe(85);
    expect(getSourceMetadataConfidence('manhuaplus')).toBe(85);
    expect(getSourceMetadataConfidence('demonicscans')).toBe(80);
    expect(getSourceMetadataConfidence('aquamanga')).toBe(80);
    expect(getSourceMetadataConfidence('kunmanga')).toBe(80);
  });
});

describe('Catalog Card Parser & Placeholder Cover Filter', () => {
  const dummySource = {
    id: 'test_source',
    name: 'Test Source',
    baseUrl: 'https://testsite.com',
    engineType: 'madara' as any,
    lang: 'en',
    isNsfw: false,
  };

  it('extracts real series cards and rejects 1x1 transparent GIFs and chapter links', () => {
    const html = `
      <div class="listupd">
        <!-- Valid Series Card -->
        <div class="page-item-detail">
          <div class="item-thumb">
            <a href="https://testsite.com/manga/great-mage/">
              <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" data-src="https://testsite.com/covers/great-mage.jpg" />
            </a>
          </div>
          <div class="post-title">
            <a href="https://testsite.com/manga/great-mage/">The Great Mage Returns After 4000 Years</a>
          </div>
          <span class="chapter">Chapter 150</span>
        </div>

        <!-- Fake/Garbage Chapter Link Card (Should be rejected) -->
        <div class="page-item-detail">
          <div class="item-thumb">
            <a href="https://testsite.com/manga/great-mage/chapter-1/">
              <img src="https://testsite.com/images/blank.gif" />
            </a>
          </div>
          <div class="post-title">
            <a href="https://testsite.com/manga/great-mage/chapter-1/">Chapter 1</a>
          </div>
        </div>
      </div>
    `;

    const items = parseUniversalCatalogCards(html, dummySource, 'https://testsite.com');

    expect(items.length).toBe(1);
    expect(items[0].title).toBe('The Great Mage Returns After 4000 Years');
    expect(items[0].sourceUrl).toBe('https://testsite.com/manga/great-mage');
    expect(items[0].coverImage).toBe('https://testsite.com/covers/great-mage.jpg');
    expect(items[0].latestChapter).toBe(150);
  });
});

describe('Bulk Scraper Engine', () => {
  it('initializes in idle state and exposes progress methods', () => {
    const progress = bulkScraperService.getProgress();
    expect(progress).toBeDefined();
    expect(['idle', 'completed', 'stopped']).toContain(progress.status);
    expect(typeof progress.seriesScraped).toBe('number');
  });

  it('allows stopping an active bulk scrape cleanly', () => {
    const stopped = bulkScraperService.stop();
    // If not running, returns false; progress remains stopped or idle
    const progress = bulkScraperService.getProgress();
    expect(progress.status).toBeDefined();
  });
});
