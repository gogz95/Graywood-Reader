import { ResolvedChapter, EngineSourceConfig } from '../types';

export interface SourceParserStrategy {
  name: string;
  matches(domainId: string, url: string, engineConfig?: EngineSourceConfig): boolean;
  fetchChapterList(url: string, domainId: string, engineConfig?: EngineSourceConfig): Promise<ResolvedChapter[]>;
  fetchChapterPages(url: string, domainId: string, chapterNumber: number, engineConfig?: EngineSourceConfig): Promise<string[] | null>;
}
