import AdmZip from 'adm-zip';
import { MangaItem, MangaType } from '../../src/types';

export interface ComicInfoMetadata {
  title?: string;
  series?: string;
  number?: string | number;
  volume?: string | number;
  summary?: string;
  notes?: string;
  year?: number;
  month?: number;
  day?: number;
  writer?: string;
  penciller?: string;
  genre?: string;
  tags?: string;
  web?: string;
  pageCount?: number;
  manga?: 'YesAndRightToLeft' | 'Yes' | 'No' | 'Unknown';
  ageRating?: string;
  communityRating?: number;
  scanInformation?: string;
  format?: string;
  languageISO?: string;
}

/**
 * Escapes special XML characters to prevent malformed XML structures.
 */
function escapeXml(unsafe = ''): string {
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Strips XML tags or extracts simple tag content using regex.
 */
function extractTagContent(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(xml);
  if (!match) return null;
  return match[1]
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

export class ComicInfoService {
  /**
   * Generates a fully compliant ComicInfo.xml document string for a series and chapter.
   */
  public generateXml(
    manga: Partial<MangaItem>,
    chapterInfo?: {
      chapterNumber?: number;
      title?: string;
      pageCount?: number;
      scanGroup?: string;
    }
  ): string {
    const seriesTitle = manga.title || 'Untitled';
    const chNum = chapterInfo?.chapterNumber !== undefined ? String(chapterInfo.chapterNumber) : '1';
    const chTitle = chapterInfo?.title || (chapterInfo?.chapterNumber !== undefined ? `Chapter ${chapterInfo.chapterNumber}` : seriesTitle);
    const summary = manga.description || '';
    const genres = (manga.genres || []).join(', ');
    const tags = (manga.customTags || []).join(', ');
    const web = manga.sourceUrl || '';
    const scanGroup = chapterInfo?.scanGroup || manga.sourceName || '';
    const pageCount = chapterInfo?.pageCount || 0;
    const rating = manga.rating ? Number(manga.rating) : undefined;
    const isAdult = Boolean(manga.isNsfw);

    // Map reading format to ComicInfo Manga tag:
    // - Manga (Japanese RTL): YesAndRightToLeft
    // - Manhwa / Manhua (Vertical / LTR): Yes
    // - Other: No
    let mangaDirection: ComicInfoMetadata['manga'] = 'Yes';
    if (manga.type === 'manga') {
      mangaDirection = 'YesAndRightToLeft';
    } else if (manga.type === 'manhwa' || manga.type === 'manhua') {
      mangaDirection = 'Yes';
    }

    const lines: string[] = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<ComicInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">',
      `  <Title>${escapeXml(chTitle)}</Title>`,
      `  <Series>${escapeXml(seriesTitle)}</Series>`,
      `  <Number>${escapeXml(chNum)}</Number>`,
      summary ? `  <Summary>${escapeXml(summary)}</Summary>` : '',
      `  <Notes>Packaged by Graywood Reader</Notes>`,
      genres ? `  <Genre>${escapeXml(genres)}</Genre>` : '',
      tags ? `  <Tags>${escapeXml(tags)}</Tags>` : '',
      web ? `  <Web>${escapeXml(web)}</Web>` : '',
      pageCount > 0 ? `  <PageCount>${pageCount}</PageCount>` : '',
      mangaDirection ? `  <Manga>${mangaDirection}</Manga>` : '',
      isAdult ? `  <AgeRating>Adult 18+</AgeRating>` : `  <AgeRating>Teen</AgeRating>`,
      rating !== undefined ? `  <CommunityRating>${rating}</CommunityRating>` : '',
      scanGroup ? `  <ScanInformation>${escapeXml(scanGroup)}</ScanInformation>` : '',
      `  <Format>Web Comic</Format>`,
      `  <LanguageISO>en</LanguageISO>`,
      '</ComicInfo>',
    ];

    return lines.filter(Boolean).join('\n');
  }

  /**
   * Parses a ComicInfo.xml string into structured MangaItem and Chapter metadata.
   */
  public parseXml(xmlContent: string): ComicInfoMetadata {
    if (!xmlContent || typeof xmlContent !== 'string') {
      return {};
    }

    const title = extractTagContent(xmlContent, 'Title') || undefined;
    const series = extractTagContent(xmlContent, 'Series') || undefined;
    const number = extractTagContent(xmlContent, 'Number') || undefined;
    const volume = extractTagContent(xmlContent, 'Volume') || undefined;
    const summary = extractTagContent(xmlContent, 'Summary') || undefined;
    const writer = extractTagContent(xmlContent, 'Writer') || undefined;
    const penciller = extractTagContent(xmlContent, 'Penciller') || undefined;
    const genre = extractTagContent(xmlContent, 'Genre') || undefined;
    const tags = extractTagContent(xmlContent, 'Tags') || undefined;
    const web = extractTagContent(xmlContent, 'Web') || undefined;
    const scanInfo = extractTagContent(xmlContent, 'ScanInformation') || undefined;
    const mangaTag = extractTagContent(xmlContent, 'Manga') as ComicInfoMetadata['manga'] | undefined;
    const ageRating = extractTagContent(xmlContent, 'AgeRating') || undefined;

    const rawPageCount = extractTagContent(xmlContent, 'PageCount');
    const pageCount = rawPageCount ? parseInt(rawPageCount, 10) : undefined;

    const rawRating = extractTagContent(xmlContent, 'CommunityRating');
    const communityRating = rawRating ? parseFloat(rawRating) : undefined;

    return {
      title,
      series,
      number,
      volume,
      summary,
      writer,
      penciller,
      genre,
      tags,
      web,
      pageCount,
      manga: mangaTag,
      ageRating,
      communityRating,
      scanInformation: scanInfo,
    };
  }

  /**
   * Reads ComicInfo.xml directly from inside an AdmZip archive.
   */
  public readFromZip(zip: AdmZip): ComicInfoMetadata | null {
    try {
      const entry = zip.getEntry('ComicInfo.xml') || zip.getEntry('comicinfo.xml');
      if (!entry) return null;
      const xmlStr = entry.getData().toString('utf-8');
      return this.parseXml(xmlStr);
    } catch {
      return null;
    }
  }

  /**
   * Embeds / injects a ComicInfo.xml document into an AdmZip archive instance.
   */
  public injectIntoZip(
    zip: AdmZip,
    manga: Partial<MangaItem>,
    chapterInfo?: {
      chapterNumber?: number;
      title?: string;
      pageCount?: number;
      scanGroup?: string;
    }
  ): void {
    const xml = this.generateXml(manga, chapterInfo);
    // Remove previous ComicInfo.xml if exists to avoid duplicate entries
    const existing = zip.getEntry('ComicInfo.xml') || zip.getEntry('comicinfo.xml');
    if (existing) {
      zip.deleteFile(existing.entryName);
    }
    zip.addFile('ComicInfo.xml', Buffer.from(xml, 'utf-8'));
  }
}

export const comicInfoService = new ComicInfoService();
