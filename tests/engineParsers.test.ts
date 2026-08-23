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
});
