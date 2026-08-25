import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  extractPanelImages,
  isValidPanelImageUrl,
  parseSrcsetCandidate,
  parseGenericChapterListFromHtml,
  parseGenericLiveSeriesMetadata,
  parseUniversalCatalogCards,
  isAdTitle,
  isAdUrl,
  isAdSeries,
  stripAdElements,
} from '../server';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function loadFixture(filename: string): string {
  return fs.readFileSync(path.join(FIXTURES_DIR, filename), 'utf-8');
}

describe('Automated Engine Parser Test Harness', () => {
  describe('Madara Engine Parser', () => {
    it('extracts chapter list from Madara series HTML', () => {
      const html = loadFixture('madara-series.html');
      const chapters = parseGenericChapterListFromHtml(html, 'https://madarasource.example');

      expect(chapters.length).toBe(4);
      expect(chapters[0].number).toBe(100);
      expect(chapters[0].url).toBe('https://madarasource.example/manga/solo-leveling/chapter-100/');
      expect(chapters[0].title).toContain('Chapter 100');

      expect(chapters[3].number).toBe(1);
      expect(chapters[3].url).toBe('https://madarasource.example/manga/solo-leveling/chapter-1/');
    });

    it('extracts panel images and filters ads/banners from Madara reader HTML', () => {
      const html = loadFixture('madara-chapter.html');
      const pages = extractPanelImages(html, 'https://madarasource.example');

      expect(pages.length).toBe(3);
      expect(pages[0]).toBe('https://cdn.madarasource.example/manga/solo-leveling/ch100/001.webp');
      expect(pages[1]).toBe('https://cdn.madarasource.example/manga/solo-leveling/ch100/002.webp');
      expect(pages[2]).toBe('https://cdn.madarasource.example/manga/solo-leveling/ch100/003.webp');

      // Ensure ad banner and logo were filtered out
      expect(pages.some((p) => p.includes('banner_discord') || p.includes('logo-header'))).toBe(false);
    });
  });

  describe('MangaThemesia Engine Parser', () => {
    it('extracts chapter list from MangaThemesia series HTML', () => {
      const html = loadFixture('mangathemesia-series.html');
      const chapters = parseGenericChapterListFromHtml(html, 'https://themesiasource.example');

      expect(chapters.length).toBe(3);
      expect(chapters[0].number).toBe(220);
      expect(chapters[0].url).toBe('https://themesiasource.example/omniscient-readers-viewpoint-chapter-220/');
      expect(chapters[1].number).toBe(219);
      expect(chapters[2].number).toBe(218);
    });

    it('extracts panel images from MangaThemesia ts_reader.run inline script', () => {
      const html = loadFixture('mangathemesia-chapter.html');
      const pages = extractPanelImages(html, 'https://themesiasource.example');

      expect(pages.length).toBe(4);
      expect(pages[0]).toBe('https://cdn.themesia.example/orv/ch220/001.webp');
      expect(pages[3]).toBe('https://cdn.themesia.example/orv/ch220/004.webp');
    });
  });

  describe('WpComics Engine Parser', () => {
    it('extracts chapter list from WpComics series HTML', () => {
      const html = loadFixture('wpcomics-series.html');
      const chapters = parseGenericChapterListFromHtml(html, 'https://wpcomics.example');

      expect(chapters.length).toBe(2);
      expect(chapters[0].number).toBe(3500);
      expect(chapters[0].url).toBe('https://wpcomics.example/manga/martial-peak/chapter-3500');
      expect(chapters[1].number).toBe(3499);
    });

    it('extracts panel images with data-original lazy loading from WpComics reader HTML', () => {
      const html = loadFixture('wpcomics-chapter.html');
      const pages = extractPanelImages(html, 'https://wpcomics.example');

      expect(pages.length).toBe(3);
      expect(pages[0]).toBe('https://cdn.wpcomics.example/martial-peak/3500/01.jpg');
      expect(pages[1]).toBe('https://cdn.wpcomics.example/martial-peak/3500/02.jpg');
      expect(pages[2]).toBe('https://cdn.wpcomics.example/martial-peak/3500/03.jpg');
    });
  });

  describe('FoolSlide Engine Parser', () => {
    it('extracts chapter list from FoolSlide directory series HTML', () => {
      const html = loadFixture('foolslide-series.html');
      const chapters = parseGenericChapterListFromHtml(html, 'https://foolslide.example');

      expect(chapters.length).toBe(2);
      expect(chapters[0].number).toBe(90);
      expect(chapters[0].url).toBe('https://foolslide.example/read/grand-blue/en/0/90/');
      expect(chapters[1].number).toBe(89);
    });

    it('extracts panel images from FoolSlide var pages inline script', () => {
      const html = loadFixture('foolslide-chapter.html');
      const pages = extractPanelImages(html, 'https://foolslide.example');

      expect(pages.length).toBe(3);
      expect(pages[0]).toBe('https://foolslide.example/pages/01.jpg');
      expect(pages[1]).toBe('https://foolslide.example/pages/02.jpg');
      expect(pages[2]).toBe('https://foolslide.example/pages/03.jpg');
    });
  });

  describe('Manhwa18 Engine Parser', () => {
    it('extracts chapter list from Manhwa18 series HTML', () => {
      const html = loadFixture('manhwa18-series.html');
      const chapters = parseGenericChapterListFromHtml(html, 'https://manhwa18.example');

      expect(chapters.length).toBe(2);
      expect(chapters[0].number).toBe(210);
      expect(chapters[0].url).toBe('https://manhwa18.example/manga/secret-class/chapter-210');
      expect(chapters[1].number).toBe(209);
    });

    it('extracts panel images from Manhwa18 reader HTML', () => {
      const html = loadFixture('manhwa18-chapter.html');
      const pages = extractPanelImages(html, 'https://manhwa18.example');

      expect(pages.length).toBe(3);
      expect(pages[0]).toBe('https://cdn.manhwa18.example/secret-class/ch210/01.jpg');
      expect(pages[1]).toBe('https://cdn.manhwa18.example/secret-class/ch210/02.jpg');
      expect(pages[2]).toBe('https://cdn.manhwa18.example/secret-class/ch210/03.jpg');
    });
  });

  describe('WPComics Engine Parser', () => {
    it('extracts chapter numbers correctly from various WPComics naming styles', async () => {
      const { extractWPComicsChapterNumber } = await import('../server/services/crawlerEngine');
      expect(extractWPComicsChapterNumber('/manga/martial-peak/chap-3450', 'Chapter 3450', 1)).toBe(3450);
      expect(extractWPComicsChapterNumber('/manga/apotheosis/chapter-120.5', 'Chap 120.5', 1)).toBe(120.5);
      expect(extractWPComicsChapterNumber('/manga/yuan-zun/ch-500', 'Ch 500', 1)).toBe(500);
      expect(extractWPComicsChapterNumber('/manga/tales/chapter-100', '', 1)).toBe(100);
    });

    it('extracts series cards from WPComics catalog markup', () => {
      const wpComicsHtml = `
        <div class="row">
          <div class="item">
            <figure class="clearfix">
              <a title="Martial Peak" href="https://manhuaplus.top/manga/martial-peak">
                <img class="lazy" data-original="https://manhuaplus.top/covers/martial-peak.jpg" alt="Martial Peak">
              </a>
              <figcaption>
                <h3><a href="https://manhuaplus.top/manga/martial-peak">Martial Peak</a></h3>
                <ul>
                  <li class="chapter"><a href="https://manhuaplus.top/manga/martial-peak/chap-3450">Chap 3450</a></li>
                </ul>
              </figcaption>
            </figure>
          </div>
        </div>
      `;

      const sourceDef = {
        id: 'manhuaplus',
        name: 'Manhua Plus',
        baseUrl: 'https://manhuaplus.top',
        engineType: 'wpcomics' as const,
        lang: 'en',
        isNsfw: false,
      };

      const cards = parseUniversalCatalogCards(wpComicsHtml, sourceDef, 'https://manhuaplus.top');
      expect(cards.length).toBe(1);
      expect(cards[0].title).toBe('Martial Peak');
      expect(cards[0].sourceUrl).toBe('https://manhuaplus.top/manga/martial-peak');
      expect(cards[0].coverImage).toBe('https://manhuaplus.top/covers/martial-peak.jpg');
      expect(cards[0].latestChapter).toBe(3450);
    });
  });

  describe('MangaThemesia Engine Parser', () => {
    it('extracts image URLs from inline ts_reader script payloads', async () => {
      const { extractMangaReaderPageUrls } = await import('../server/services/crawlerEngine');
      const html = `
        <html>
        <head><title>Chapter 100</title></head>
        <body>
          <script>
            ts_reader.run({
              "prevUrl": "https://ravenscans.net/ch-99",
              "nextUrl": "https://ravenscans.net/ch-101",
              "sources": [
                {
                  "source": "Default",
                  "images": [
                    "https://cdn.ravenscans.net/ch100/01.webp",
                    "https://cdn.ravenscans.net/ch100/02.webp",
                    "https://cdn.ravenscans.net/ch100/03.webp"
                  ]
                }
              ]
            });
          </script>
        </body>
        </html>
      `;

      const pages = extractMangaReaderPageUrls(html, 'https://ravenscans.net');
      expect(pages.length).toBe(3);
      expect(pages[0]).toBe('https://cdn.ravenscans.net/ch100/01.webp');
      expect(pages[1]).toBe('https://cdn.ravenscans.net/ch100/02.webp');
      expect(pages[2]).toBe('https://cdn.ravenscans.net/ch100/03.webp');
    });

    it('extracts image URLs from base64 encoded ts_reader scripts', async () => {
      const { extractMangaReaderPageUrls } = await import('../server/services/crawlerEngine');
      const payload = JSON.stringify({
        sources: [{ images: ['https://cdn.hentai20.io/p1.jpg', 'https://cdn.hentai20.io/p2.jpg'] }]
      });
      const b64 = Buffer.from(`ts_reader.run(${payload});`).toString('base64');
      const html = `<html><body><script src="data:text/javascript;base64,${b64}"></script></body></html>`;

      const pages = extractMangaReaderPageUrls(html, 'https://hentai20.io');
      expect(pages.length).toBe(2);
      expect(pages[0]).toBe('https://cdn.hentai20.io/p1.jpg');
      expect(pages[1]).toBe('https://cdn.hentai20.io/p2.jpg');
    });
  });

  describe('Live Series Metadata Parser', () => {
    it('extracts metadata from Manhwa18 series page HTML', () => {
      const html = loadFixture('manhwa18-series.html');
      const meta = parseGenericLiveSeriesMetadata(html, 'https://manhwa18.com/manga/secret-class');

      expect(meta).not.toBeNull();
      expect(meta?.title).toBe('Secret Class');
      expect(meta?.latestChapter).toBe(210);
    });

    it('extracts metadata and chapter count from Madara series HTML', () => {
      const html = loadFixture('madara-series.html');
      const meta = parseGenericLiveSeriesMetadata(html, 'https://madarasource.example/manga/solo-leveling');

      expect(meta).not.toBeNull();
      expect(meta?.title).toBe('Solo Leveling');
      expect(meta?.latestChapter).toBe(100);
    });

    it('extracts rich description, cover, and genres when available in HTML', () => {
      const customHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>The Summer at Her House - Manhwa18</title>
          <meta property="og:description" content="A summer vacation at an unexpected house turns exciting.">
          <meta property="og:image" content="https://cdn.manhwa18.example/covers/summer-house.jpg">
        </head>
        <body>
          <div class="post-title"><h1>The Summer at Her House</h1></div>
          <div class="genres-content">
            <a href="/genres/adult">Adult</a>
            <a href="/genres/romance">Romance</a>
          </div>
          <div class="star-rating"><span class="rating-val">8.9</span></div>
          <ul class="row-content-chapter">
            <li class="a-h"><a class="chapter-name" href="https://manhwa18.example/manga/summer/ch-65">Chapter 65</a></li>
            <li class="a-h"><a class="chapter-name" href="https://manhwa18.example/manga/summer/ch-1">Chapter 1</a></li>
          </ul>
        </body>
        </html>
      `;
      const meta = parseGenericLiveSeriesMetadata(customHtml, 'https://manhwa18.com/manga/summer');
      expect(meta).not.toBeNull();
      expect(meta?.title).toBe('The Summer at Her House');
      expect(meta?.description).toBe('A summer vacation at an unexpected house turns exciting.');
      expect(meta?.coverImage).toBe('https://cdn.manhwa18.example/covers/summer-house.jpg');
      expect(meta?.genres).toEqual(['Adult', 'Romance']);
      expect(meta?.latestChapter).toBe(65);
      expect(meta?.rating).toBe(8.9);
    });
  });

  describe('Universal Catalog Card Parser', () => {
    it('extracts series cards from Custom HTML / PHP directory pages (Demonic Scans layout)', () => {
      const customHtml = `
        <!DOCTYPE html>
        <html>
        <body>
          <div class="lastupdates-container">
            <div class="row">
              <div class="col-md-6 item">
                <a href="/manga/Swordmasters-Youngest-Son" title="Swordmaster's Youngest Son">
                  <img src="https://cdn.demonicscans.org/covers/swordmaster.jpg" alt="cover">
                  <h4 class="title">Swordmaster's Youngest Son</h4>
                </a>
                <span class="chapter">Chapter 120</span>
              </div>
              <div class="col-md-6 item">
                <a href="/manga/Magic-Emperor" title="Magic Emperor">
                  <img data-src="/images/magic-emperor.webp" alt="cover">
                  <h4 class="title">Magic Emperor</h4>
                </a>
                <span class="chapter">Chapter 540</span>
              </div>
            </div>
          </div>
        </body>
        </html>
      `;

      const sourceDef = {
        id: 'demonicscans',
        name: 'Demonic Scans',
        baseUrl: 'https://demonicscans.org',
        engineType: 'custom_html' as const,
        lang: 'en',
        isNsfw: false,
      };

      const cards = parseUniversalCatalogCards(customHtml, sourceDef, 'https://demonicscans.org');
      expect(cards.length).toBe(2);
      expect(cards[0].title).toBe("Swordmaster's Youngest Son");
      expect(cards[0].sourceUrl).toBe('https://demonicscans.org/manga/Swordmasters-Youngest-Son');
      expect(cards[0].coverImage).toBe('https://cdn.demonicscans.org/covers/swordmaster.jpg');
      expect(cards[0].latestChapter).toBe(120);

      expect(cards[1].title).toBe('Magic Emperor');
      expect(cards[1].sourceUrl).toBe('https://demonicscans.org/manga/Magic-Emperor');
      expect(cards[1].coverImage).toBe('https://demonicscans.org/images/magic-emperor.webp');
      expect(cards[1].latestChapter).toBe(540);
    });

    it('extracts series cards from MangaThemesia listupd layouts', () => {
      const themesiaHtml = `
        <div class="listupd">
          <div class="bs">
            <div class="bsx">
              <a href="https://themesiasource.example/manga/nano-machine/" title="Nano Machine">
                <div class="limit">
                  <img src="https://cdn.themesia.example/covers/nano.jpg" class="ts-post-image">
                </div>
                <div class="bigor">
                  <div class="tt">Nano Machine</div>
                  <div class="adds"><div class="epx">Ch. 210</div></div>
                </div>
              </a>
            </div>
          </div>
        </div>
      `;

      const sourceDef = {
        id: 'themesiasrc',
        name: 'Themesia Source',
        baseUrl: 'https://themesiasource.example',
        engineType: 'mangathemesia' as const,
        lang: 'en',
        isNsfw: false,
      };

      const cards = parseUniversalCatalogCards(themesiaHtml, sourceDef, 'https://themesiasource.example');
      expect(cards.length).toBe(1);
      expect(cards[0].title).toBe('Nano Machine');
      expect(cards[0].sourceUrl).toBe('https://themesiasource.example/manga/nano-machine');
      expect(cards[0].latestChapter).toBe(210);
    });

    it('extracts series cards from Manhwa18 .thumb-item-flow layouts with lazy-bg covers', () => {
      const manhwa18Html = `
        <div class="card-body">
          <div class="thumb-item-flow col-6 col-md-3">
            <div class="thumb-wrapper">
              <a href="https://manhwa18.com/manga/chamber-of-secrets-uncensored">
                <div class="a6-ratio">
                  <div class="content img-in-ratio lazy-bg" data-bg="https://min.manhwa18.net/chapters/manga/covers/secret.webp"></div>
                </div>
              </a>
              <div class="thumb-detail">
                <div class="thumb_attr chapter-title text-truncate" title="Chapter 5 - Episode 05">
                  <a href="https://manhwa18.com/manga/chamber-of-secrets-uncensored/chapter-5-net-123" title="Chapter 5 - Episode 05">Chapter 5 - Episode 05</a>
                </div>
              </div>
            </div>
            <div class="thumb_attr series-title">
              <a href="https://manhwa18.com/manga/chamber-of-secrets-uncensored" title="Chamber of Secrets (Uncensored)">Chamber of Secrets (Uncensored)</a>
            </div>
          </div>
        </div>
      `;

      const sourceDef = {
        id: 'manhwa18',
        name: 'Manhwa18',
        baseUrl: 'https://manhwa18.com',
        engineType: 'custom_html' as const,
        lang: 'en',
        isNsfw: true,
      };

      const cards = parseUniversalCatalogCards(manhwa18Html, sourceDef, 'https://manhwa18.com');
      expect(cards.length).toBe(1);
      expect(cards[0].title).toBe('Chamber of Secrets (Uncensored)');
      expect(cards[0].sourceUrl).toBe('https://manhwa18.com/manga/chamber-of-secrets-uncensored');
      expect(cards[0].coverImage).toBe('https://min.manhwa18.net/chapters/manga/covers/secret.webp');
      expect(cards[0].latestChapter).toBe(5);
    });

    it('extracts series cards from Manhwa18.cc .manga-item layouts and cleans 18+ prefix', () => {
      const ccHtml = `
        <div class="manga-item">
          <div class="manga-thumb">
            <a href="/webtoon/secret-class-01" title="Secret Class">
              <span class="badge-adult">18+</span>
              <img data-src="https://manhwa18.cc/manga/secret-class.jpg" src="/images/loading.gif" alt="Secret Class">
            </a>
          </div>
          <div class="manga-name">
            <a href="/webtoon/secret-class-01" title="18+ Secret Class">18+ Secret Class</a>
          </div>
        </div>
      `;

      const sourceDef = {
        id: 'manhwa18cc',
        name: 'Manhwa18.cc',
        baseUrl: 'https://manhwa18.cc',
        engineType: 'custom_html' as const,
        lang: 'en',
        isNsfw: true,
      };

      const cards = parseUniversalCatalogCards(ccHtml, sourceDef, 'https://manhwa18.cc');
      expect(cards.length).toBe(1);
      expect(cards[0].title).toBe('Secret Class');
      expect(cards[0].sourceUrl).toBe('https://manhwa18.cc/webtoon/secret-class-01');
      expect(cards[0].coverImage).toBe('https://manhwa18.cc/manga/secret-class.jpg');
    });
  });

  describe('Resilience and Error Handling', () => {
    it('returns empty array on empty or invalid HTML strings', () => {
      expect(parseGenericChapterListFromHtml('', 'https://example.com')).toEqual([]);
      expect(parseGenericChapterListFromHtml('<html><body>No chapters here</body></html>', 'https://example.com')).toEqual([]);
      expect(extractPanelImages('', 'https://example.com')).toEqual([]);
      expect(extractPanelImages('<html><body>No images here</body></html>', 'https://example.com')).toEqual([]);
      expect(parseGenericLiveSeriesMetadata('', 'https://example.com')).toBeNull();
    });

    it('handles relative image paths and constructs valid absolute URLs', () => {
      const html = `<div><img data-src="/images/ch1/01.png"><img src="relative/ch1/02.png"></div>`;
      const pages = extractPanelImages(html, 'https://mysite.com');
      expect(pages).toEqual([
        'https://mysite.com/images/ch1/01.png',
        'https://mysite.com/relative/ch1/02.png',
      ]);
    });
  });

  describe('Ad & Spam Defense / BUG-044 Protection', () => {
    it('detects cam models, adult spam, and affiliate ads via isAdTitle and isAdSeries', () => {
      expect(isAdTitle('ChristinaSiemone Cam Model: Free Live Sex Show & Chat')).toBe(true);
      expect(isAdTitle('Live Sex Chat - Meet Hot Singles Now')).toBe(true);
      expect(isAdTitle('Chaturbate Live Stream')).toBe(true);
      expect(isAdTitle('Slot Gacor Online - Free Coins')).toBe(true);
      expect(isAdTitle('Solo Leveling: Ragnarok')).toBe(false);
      expect(isAdTitle('Omniscient Reader’s Viewpoint')).toBe(false);

      expect(isAdUrl('https://adnetwork.trafficjunky.net/clkg.php?aff_id=123')).toBe(true);
      expect(isAdUrl('https://exoclick.com/adclick?zone_id=99')).toBe(true);
      expect(isAdUrl('https://manhwa18.com/manga/secret-class')).toBe(false);

      expect(isAdSeries('ChristinaSiemone Cam Model: Free Live Sex Show & Chat', 'https://mangahentai.me/cam/model')).toBe(true);
      expect(isAdSeries('Martial Peak', 'https://manhuaplus.top/manga/martial-peak/')).toBe(false);
    });

    it('filters out ad cards from catalog and explore HTML', () => {
      const mixedHtml = `
        <div class="listupd">
          <div class="bsx">
            <a href="https://example.com/manga/nano-machine">
              <div class="tt">Nano Machine</div>
              <img src="https://cdn.example.com/nano.jpg">
            </a>
          </div>
          <div class="bsx sponsored-card">
            <a href="https://trafficjunky.net/clkg.php?id=99">
              <div class="tt">ChristinaSiemone Cam Model: Free Live Sex Show & Chat</div>
              <img src="https://cdn.example.com/cam_banner.jpg">
            </a>
          </div>
          <div class="bsx">
            <a href="https://example.com/manga/lookism">
              <div class="tt">Lookism</div>
              <img src="https://cdn.example.com/lookism.jpg">
            </a>
          </div>
        </div>
      `;

      const sourceDef = {
        id: 'test_src',
        name: 'Test Source',
        baseUrl: 'https://example.com',
        engineType: 'mangathemesia' as const,
        lang: 'en',
        isNsfw: false,
      };

      const items = parseUniversalCatalogCards(mixedHtml, sourceDef, 'https://example.com');
      expect(items.length).toBe(2);
      expect(items.some((i) => i.title.includes('Cam Model'))).toBe(false);
      expect(items[0].title).toBe('Nano Machine');
      expect(items[1].title).toBe('Lookism');
    });

    it('isolates dedicated chapter containers and rejects sidebar recommendation links', () => {
      const htmlWithSidebar = `
        <div class="row-content-chapter">
          <li><a href="https://example.com/manga/solo-leveling/chapter-100">Chapter 100</a></li>
          <li><a href="https://example.com/manga/solo-leveling/chapter-99">Chapter 99</a></li>
        </div>
        <div class="sidebar-popular-widget">
          <h3>Popular Manga</h3>
          <li><a href="https://example.com/manga/another-series/chapter-500">Another Series Chapter 500</a></li>
          <li><a href="https://adnetwork.com/click?aff_id=99">Play Free Adult Game Now</a></li>
        </div>
      `;

      const chapters = parseGenericChapterListFromHtml(htmlWithSidebar, 'https://example.com');
      expect(chapters.length).toBe(2);
      expect(chapters[0].number).toBe(100);
      expect(chapters[1].number).toBe(99);
      expect(chapters.some((c) => c.title.includes('Another Series'))).toBe(false);
      expect(chapters.some((c) => c.title.includes('Adult Game'))).toBe(false);
    });

    it('rejects ad landing pages in parseGenericLiveSeriesMetadata', () => {
      const adPageHtml = `
        <html>
          <head><title>Free Live Sex Show & Chat</title></head>
          <body>
            <div class="post-title"><h1>ChristinaSiemone Cam Model: Free Live Sex Show & Chat</h1></div>
            <div class="summary__content"><p>Watch free live cam show now!</p></div>
          </body>
        </html>
      `;
      const meta = parseGenericLiveSeriesMetadata(adPageHtml, 'https://mangahentai.me/ad-landing');
      expect(meta).toBeNull();
    });
  });
});

