import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  extractPanelImages,
  isValidPanelImageUrl,
  parseSrcsetCandidate,
  parseGenericChapterListFromHtml,
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

  describe('Resilience and Error Handling', () => {
    it('returns empty array on empty or invalid HTML strings', () => {
      expect(parseGenericChapterListFromHtml('', 'https://example.com')).toEqual([]);
      expect(parseGenericChapterListFromHtml('<html><body>No chapters here</body></html>', 'https://example.com')).toEqual([]);
      expect(extractPanelImages('', 'https://example.com')).toEqual([]);
      expect(extractPanelImages('<html><body>No images here</body></html>', 'https://example.com')).toEqual([]);
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
