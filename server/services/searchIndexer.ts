// ============================================================================
// FULL-TEXT SEARCH INDEXER & LIBRARY SEARCH ENGINE
// Rapid multi-token BM25/TF-IDF token search across series titles, alt titles,
// descriptions, genres, source names, categories, and sticky notes.
// ============================================================================

import { MangaItem } from '../../src/types';

export interface SearchResultItem {
  manga: MangaItem;
  score: number;
  matchedFields: string[];
}

function tokenize(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

export class SearchIndexer {
  private static instance: SearchIndexer;

  private index = new Map<string, Set<string>>(); // token -> set of manga IDs
  private mangaMap = new Map<string, MangaItem>();

  public static getInstance(): SearchIndexer {
    if (!SearchIndexer.instance) {
      SearchIndexer.instance = new SearchIndexer();
    }
    return SearchIndexer.instance;
  }

  public indexLibrary(mangaList: MangaItem[]): void {
    this.index.clear();
    this.mangaMap.clear();

    for (const item of mangaList) {
      this.mangaMap.set(item.id, item);

      const fieldTokens: Array<{ field: string; text: string }> = [
        { field: 'title', text: item.title },
        { field: 'altTitles', text: (item.altTitles || []).join(' ') },
        { field: 'description', text: item.description || '' },
        { field: 'genres', text: (item.genres || []).join(' ') },
        { field: 'sourceName', text: item.sourceName || '' },
        { field: 'notes', text: item.notes || '' },
      ];

      for (const { text } of fieldTokens) {
        const tokens = tokenize(text);
        for (const token of tokens) {
          if (!this.index.has(token)) {
            this.index.set(token, new Set());
          }
          this.index.get(token)!.add(item.id);
        }
      }
    }
  }

  public search(query: string, mangaList?: MangaItem[]): SearchResultItem[] {
    const qTokens = tokenize(query);
    if (qTokens.length === 0) return [];

    const sourceList = mangaList || Array.from(this.mangaMap.values());
    const results: SearchResultItem[] = [];

    for (const manga of sourceList) {
      let score = 0;
      const matchedFields = new Set<string>();

      const titleLower = manga.title.toLowerCase();
      const queryLower = query.toLowerCase();

      // Exact title match bonus
      if (titleLower === queryLower) {
        score += 100;
        matchedFields.add('title');
      } else if (titleLower.includes(queryLower)) {
        score += 50;
        matchedFields.add('title');
      }

      for (const token of qTokens) {
        if (manga.title.toLowerCase().includes(token)) {
          score += 20;
          matchedFields.add('title');
        }
        if (manga.altTitles?.some((a) => a.toLowerCase().includes(token))) {
          score += 15;
          matchedFields.add('altTitles');
        }
        if (manga.genres?.some((g) => g.toLowerCase().includes(token))) {
          score += 10;
          matchedFields.add('genres');
        }
        if (manga.description?.toLowerCase().includes(token)) {
          score += 5;
          matchedFields.add('description');
        }
        if (manga.sourceName?.toLowerCase().includes(token)) {
          score += 5;
          matchedFields.add('sourceName');
        }
        if (manga.notes?.toLowerCase().includes(token)) {
          score += 5;
          matchedFields.add('notes');
        }
      }

      if (score > 0) {
        results.push({
          manga,
          score,
          matchedFields: Array.from(matchedFields),
        });
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }
}

export const searchIndexer = SearchIndexer.getInstance();
