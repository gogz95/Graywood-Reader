import { describe, it, expect } from 'vitest';
import AdmZip from 'adm-zip';
import { comicInfoService } from '../server/services/comicInfoService';
import { MangaItem } from '../src/types';

describe('ComicInfoService', () => {
  const dummyManga: Partial<MangaItem> = {
    id: 'm_test_1',
    title: 'Return of the Mount Hua Sect',
    description: 'Chung Myung the 13th Disciple of the Great Mount Hua Sect awakens 100 years in the future.',
    genres: ['Action', 'Martial Arts', 'Comedy'],
    customTags: ['Top Tier', 'Cultivation'],
    sourceUrl: 'https://asurascans.com/manga/mount-hua-sect',
    sourceName: 'AsuraScans',
    rating: 9.8,
    type: 'manhwa',
    isNsfw: false,
  };

  it('generates compliant ComicInfo.xml with all relevant tags', () => {
    const xml = comicInfoService.generateXml(dummyManga, {
      chapterNumber: 105,
      title: 'Chapter 105 - Mount Hua Blossoms',
      pageCount: 32,
      scanGroup: 'AsuraScans',
    });

    expect(xml).toContain('<Series>Return of the Mount Hua Sect</Series>');
    expect(xml).toContain('<Title>Chapter 105 - Mount Hua Blossoms</Title>');
    expect(xml).toContain('<Number>105</Number>');
    expect(xml).toContain('<PageCount>32</PageCount>');
    expect(xml).toContain('<Genre>Action, Martial Arts, Comedy</Genre>');
    expect(xml).toContain('<Tags>Top Tier, Cultivation</Tags>');
    expect(xml).toContain('<Manga>Yes</Manga>');
    expect(xml).toContain('<CommunityRating>9.8</CommunityRating>');
    expect(xml).toContain('<ScanInformation>AsuraScans</ScanInformation>');
  });

  it('parses ComicInfo.xml string accurately back into metadata object', () => {
    const rawXml = `<?xml version="1.0" encoding="utf-8"?>
<ComicInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <Title>Chapter 1</Title>
  <Series>Solo Leveling</Series>
  <Number>1</Number>
  <Summary>E-Rank hunter Sung Jinwoo becomes the Shadow Monarch.</Summary>
  <Writer>Chugong</Writer>
  <Genre>Action, Fantasy</Genre>
  <PageCount>45</PageCount>
  <Manga>Yes</Manga>
  <CommunityRating>9.5</CommunityRating>
</ComicInfo>`;

    const parsed = comicInfoService.parseXml(rawXml);
    expect(parsed.series).toBe('Solo Leveling');
    expect(parsed.title).toBe('Chapter 1');
    expect(parsed.number).toBe('1');
    expect(parsed.writer).toBe('Chugong');
    expect(parsed.genre).toBe('Action, Fantasy');
    expect(parsed.pageCount).toBe(45);
    expect(parsed.communityRating).toBe(9.5);
  });

  it('injects and reads ComicInfo.xml inside an in-memory CBZ zip file', () => {
    const zip = new AdmZip();
    zip.addFile('page_001.jpg', Buffer.from('fake-image-data'));

    comicInfoService.injectIntoZip(zip, dummyManga, {
      chapterNumber: 1,
      pageCount: 1,
    });

    const readInfo = comicInfoService.readFromZip(zip);
    expect(readInfo).not.toBeNull();
    expect(readInfo?.series).toBe('Return of the Mount Hua Sect');
    expect(readInfo?.number).toBe('1');
    expect(readInfo?.manga).toBe('Yes');
  });
});
