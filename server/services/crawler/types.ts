// ============================================================================
// Crawler Types & Mirror Constants
// ============================================================================

export interface ResolvedChapter {
  number: number;
  id: string;
  slug: string;
  title: string;
  url: string;
  pageCount: number;
}

export type SourceEngine =
  | 'madara'
  | 'manhwa18'
  | 'manhwa18cc'
  | 'mangareader'
  | 'mangathemesia'
  | 'wpcomics'
  | 'hotcomics'
  | 'custom'
  | 'foolslide';

export interface EngineSourceConfig {
  id: string;
  name: string;
  domain: string;
  engine: SourceEngine;
  lang: string;
  isNsfw: boolean;
  madaraDatePattern?: string;
  madaraPageSize?: number;
  madaraWithoutAjax?: boolean;
  madaraSelectTestAsync?: string;
  madaraSelectChapter?: string;
  madaraSelectBodyPage?: string;
  madaraPostReq?: boolean;
  chapterListSelector?: string;
  chapterPageSelector?: string;
  catalogPath?: string;
}

export const DOMAIN_MIRRORS: Record<string, string> = {
  'asuracomic.net': 'asurascans.com',
  'asurascans.org': 'asurascans.com',
  'asura.gg': 'asurascans.com',
  'flamescans.org': 'flamecomics.xyz',
  'flamecomics.com': 'flamecomics.xyz',
  'manhwa18.net': 'manhwa18.com',
  'manhwa18.org': 'manhwa18.com',
  'manhwa18.cc': 'manhwa18.cc',
  'hentai20.com': 'hentai20.io',
  'hentai20.net': 'hentai20.io',
  'harimanga.me': 'harimanga.com',
  'harimanga.org': 'harimanga.com',
  'beehentai.com': 'toontop.io',
  'mangatx.to': 'mangatx.com',
  'mangatx.unblockit.ch': 'mangatx.com',
  'manhuaplus.org': 'manhuaplus.top',
  'manhuaplus.com': 'manhuaplus.top',
  'aryascans.com': 'brainrotcomics.com',
  'comizy.io': 'mangabuddy.com',
};

export const UA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
};
