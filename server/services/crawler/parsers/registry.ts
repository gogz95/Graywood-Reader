import { SourceParserStrategy } from './types';
import { ResolvedChapter, EngineSourceConfig } from '../types';

const strategies: SourceParserStrategy[] = [];

export function registerSourceParserStrategy(strategy: SourceParserStrategy): void {
  strategies.push(strategy);
}

export function findMatchingParserStrategy(domainId: string, url: string, engineConfig?: EngineSourceConfig): SourceParserStrategy | undefined {
  return strategies.find((s) => s.matches(domainId, url, engineConfig));
}
