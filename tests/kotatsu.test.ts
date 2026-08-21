import { describe, it, expect } from 'vitest';
import {
  parseKotatsuBackup,
  exportToKotatsuBackup,
  mapKotatsuStatus,
  formatKotatsuSourceName,
} from '../src/utils/kotatsuImporter';
import AdmZip from 'adm-zip';

describe('Kotatsu status mapping', () => {
  it('correctly maps numerical Kotatsu states', () => {
    expect(mapKotatsuStatus(1)).toBe('reading');
    expect(mapKotatsuStatus(2)).toBe('completed');
    expect(mapKotatsuStatus(3)).toBe('dropped');
    expect(mapKotatsuStatus(4)).toBe('on_hold');
    expect(mapKotatsuStatus(5)).toBe('plan_to_read');
    expect(mapKotatsuStatus(undefined)).toBe('reading');
  });

  it('correctly maps string Kotatsu states', () => {
    expect(mapKotatsuStatus('ONGOING')).toBe('reading');
    expect(mapKotatsuStatus('FINISHED')).toBe('completed');
    expect(mapKotatsuStatus('COMPLETED')).toBe('completed');
    expect(mapKotatsuStatus('ABANDONED')).toBe('dropped');
    expect(mapKotatsuStatus('CANCELLED')).toBe('dropped');
    expect(mapKotatsuStatus('PAUSED')).toBe('on_hold');
    expect(mapKotatsuStatus('ON_HIATUS')).toBe('on_hold');
    expect(mapKotatsuStatus('UPCOMING')).toBe('plan_to_read');
    expect(mapKotatsuStatus('PLAN_TO_READ')).toBe('plan_to_read');
  });
});

describe('Kotatsu source name formatting', () => {
  it('formats known source IDs', () => {
    expect(formatKotatsuSourceName('ASURASCANS')).toBe('Asura Scans');
    expect(formatKotatsuSourceName('MANGADEX')).toBe('MangaDex');
    expect(formatKotatsuSourceName('REAPERSCANS')).toBe('Reaper Scans');
    expect(formatKotatsuSourceName('FLAME_COMICS')).toBe('Flame Comics');
    expect(formatKotatsuSourceName('MANGAKAKALOT')).toBe('Mangakakalot');
  });

  it('converts unknown snake_case sources to Title Case', () => {
    expect(formatKotatsuSourceName('MANGA_PARK')).toBe('MangaPark');
    expect(formatKotatsuSourceName('CUSTOM_SOURCE_APP')).toBe('Custom Source App');
    expect(formatKotatsuSourceName('')).toBe('Kotatsu Import');
  });
});

describe('Kotatsu JSON backup import', () => {
  const jsonBackup = {
    version: 1,
    categories: [
      { id: 1, name: 'Default' },
      { id: 2, name: 'Favorites' },
    ],
    favourites: [
      {
        categoryId: 2,
        pinned: true,
        createdAt: 1700000000000,
        manga: {
          id: 101,
          title: 'Tower of God',
          altTitle: 'Sin-ui Tap',
          url: '/manga/tower-of-god',
          publicUrl: 'https://asurascans.com/manga/tower-of-god',
          rating: 0.95,
          coverUrl: 'https://example.com/tog.jpg',
          author: 'SIU',
          state: 'ONGOING',
          source: 'ASURASCANS',
          genres: ['Action', 'Fantasy', 'Manhwa'],
          description: 'Reach the top of the tower.',
          chapters: [
            { id: 1, name: 'Chapter 1', number: 1, url: '/c1' },
            { id: 2, name: 'Chapter 2', number: 2, url: '/c2' },
            { id: 3, name: 'Chapter 3', number: 3, url: '/c3' },
          ],
        },
      },
    ],
    history: [
      {
        mangaId: 101,
        chapter: { id: 2, name: 'Chapter 2', number: 2 },
        page: 5,
        updatedAt: 1705000000000,
      },
    ],
  };

  it('parses JSON format with history and metadata', async () => {
    const items = await parseKotatsuBackup(JSON.stringify(jsonBackup), 'usr_test');
    expect(items).toHaveLength(1);
    const item = items[0];
    expect(item.title).toBe('Tower of God');
    expect(item.altTitles).toEqual(['Sin-ui Tap']);
    expect(item.type).toBe('manhwa');
    expect(item.sourceName).toBe('Asura Scans');
    expect(item.sourceUrl).toBe('https://asurascans.com/manga/tower-of-god');
    expect(item.coverImage).toBe('https://example.com/tog.jpg');
    expect(item.description).toBe('Reach the top of the tower.');
    expect(item.status).toBe('reading');
    expect(item.isFavorite).toBe(true);
    expect(item.currentChapter).toBe(2); // from history
    expect(item.totalChapters).toBe(3); // from chapters list
    expect(item.rating).toBe(9.5);
    expect(item.userId).toBe('usr_test');
  });

  it('parses simple array of manga entries', async () => {
    const simpleList = [
      {
        title: 'Martial Peak',
        genres: ['Action', 'Manhua'],
        state: 'FINISHED',
        source: 'MANGADEX',
        coverUrl: 'https://example.com/mp.jpg',
      },
    ];

    const items = await parseKotatsuBackup(JSON.stringify(simpleList));
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Martial Peak');
    expect(items[0].type).toBe('manhua');
    expect(items[0].status).toBe('completed');
    expect(items[0].sourceName).toBe('MangaDex');
  });

  it('parses JSON from ArrayBuffer / Uint8Array', async () => {
    const rawJson = JSON.stringify(jsonBackup);
    const buffer = Buffer.from(rawJson, 'utf-8');
    const items = await parseKotatsuBackup(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), 'usr_buf');
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Tower of God');
    expect(items[0].userId).toBe('usr_buf');
  });

  it('flags items with Missing source when sourceUrl is absent while retaining isFavorite', async () => {
    const backupWithoutSource = [
      {
        title: 'Unknown Webtoon',
        genres: ['Action'],
        state: 'ONGOING',
      },
    ];

    const items = await parseKotatsuBackup(JSON.stringify(backupWithoutSource), 'usr_test');
    expect(items).toHaveLength(1);
    expect(items[0].isFavorite).toBe(true);
    expect(items[0].isFlagged).toBe(true);
    expect(items[0].flagReason).toBe('Missing source');
  });

  it('throws on invalid JSON or empty backup', async () => {
    await expect(parseKotatsuBackup('invalid json content')).rejects.toThrow();
    await expect(parseKotatsuBackup('{"favourites":[]}')).rejects.toThrow('No manga entries found');
  });
});

describe('Kotatsu ZIP archive backup import', () => {
  it('unpacks ZIP archive containing favourites.json and history.json', async () => {
    const zip = new AdmZip();

    const favouritesJson = JSON.stringify([
      {
        categoryId: 10,
        pinned: false,
        manga: {
          id: 555,
          title: 'Solo Bug Player',
          source: 'REAPERSCANS',
          coverUrl: 'https://example.com/sbp.jpg',
          state: 2, // FINISHED
          genres: ['Action', 'Manhwa'],
          chapters: [
            { id: 1, name: 'Chapter 1', number: 1 },
            { id: 2, name: 'Chapter 2', number: 2 },
          ],
        },
      },
    ]);

    const historyJson = JSON.stringify([
      {
        mangaId: 555,
        chapter: { id: 2, name: 'Chapter 2', number: 2 },
        page: 1,
      },
    ]);

    const categoriesJson = JSON.stringify([
      { id: 10, name: 'Favorites' },
    ]);

    zip.addFile('favourites.json', Buffer.from(favouritesJson, 'utf-8'));
    zip.addFile('history.json', Buffer.from(historyJson, 'utf-8'));
    zip.addFile('categories.json', Buffer.from(categoriesJson, 'utf-8'));

    const zipBuffer = zip.toBuffer();
    const items = await parseKotatsuBackup(zipBuffer, 'usr_zip_user');

    expect(items).toHaveLength(1);
    const item = items[0];
    expect(item.title).toBe('Solo Bug Player');
    expect(item.sourceName).toBe('Reaper Scans');
    expect(item.status).toBe('completed');
    expect(item.type).toBe('manhwa');
    expect(item.currentChapter).toBe(2);
    expect(item.totalChapters).toBe(2);
    expect(item.isFavorite).toBe(true); // mapped through category id 10 ("Favorites")
    expect(item.userId).toBe('usr_zip_user');
  });

  it('unpacks realistic Kotatsu backup with extensionless files and ignores sources', async () => {
    const zip = new AdmZip();

    const favouritesData = JSON.stringify([
      {
        categoryId: 1,
        pinned: true,
        manga: {
          id: 999,
          title: 'Murim Login',
          source: 'ASURASCANS',
          coverUrl: 'https://example.com/murim.jpg',
          state: 'ONGOING',
          genres: ['Action', 'Martial Arts', 'Manhwa'],
          chapters: [
            { id: 10, name: 'Chapter 10', number: 10 },
            { id: 11, name: 'Chapter 11', number: 11 },
          ],
        },
      },
    ]);

    const historyData = JSON.stringify([
      {
        mangaId: 999,
        chapter: { id: 11, name: 'Chapter 11', number: 11 },
        page: 12,
      },
    ]);

    const categoriesData = JSON.stringify([
      { id: 1, name: 'Favorites' },
    ]);

    const sourcesData = JSON.stringify([
      { id: 'asurascans', name: 'Asura Scans', enabled: true },
    ]);

    const settingsData = JSON.stringify({ theme: 'dark' });
    const statisticsData = JSON.stringify([
      {
        mangaId: 999,
        timeSpent: 7200, // 2h 0m
        chaptersRead: 11,
        lastRead: 1700000000000,
      },
    ]);

    // Add exact extensionless files as seen in Kotatsu backups
    zip.addFile('favourites', Buffer.from(favouritesData, 'utf-8'));
    zip.addFile('history', Buffer.from(historyData, 'utf-8'));
    zip.addFile('categories', Buffer.from(categoriesData, 'utf-8'));
    zip.addFile('sources', Buffer.from(sourcesData, 'utf-8'));
    zip.addFile('settings', Buffer.from(settingsData, 'utf-8'));
    zip.addFile('statistics', Buffer.from(statisticsData, 'utf-8'));

    const zipBuffer = zip.toBuffer();
    const items = await parseKotatsuBackup(zipBuffer, 'usr_kotatsu');

    expect(items).toHaveLength(1);
    const item = items[0];
    expect(item.title).toBe('Murim Login');
    expect(item.sourceName).toBe('Asura Scans');
    expect(item.status).toBe('reading');
    expect(item.type).toBe('manhwa');
    expect(item.currentChapter).toBe(11);
    expect(item.isFavorite).toBe(true);
    expect(item.userId).toBe('usr_kotatsu');
    expect(item.notes).toContain('2h 0m reading time');
  });

  it('resolves real category names from categories.json and favourites_categories.json in ZIP archive', async () => {
    const zip = new AdmZip();
    zip.addFile('categories.json', Buffer.from(JSON.stringify([
      { id: 10, name: 'Favorite Webtoons' },
      { id: 20, name: 'Must Read' }
    ])));
    zip.addFile('favourites_categories.json', Buffer.from(JSON.stringify([
      { favourite_id: 501, category_id: 10 },
      { favourite_id: 501, category_id: 20 }
    ])));
    zip.addFile('favourites.json', Buffer.from(JSON.stringify([
      {
        id: 501,
        manga: {
          id: 501,
          title: 'The Greatest Estate Developer',
          source: 'ASURASCANS',
          publicUrl: 'https://asurascans.com/comics/estate-dev',
          genres: ['Comedy', 'Fantasy', 'Manhwa']
        }
      }
    ])));

    const items = await parseKotatsuBackup(zip.toBuffer(), 'usr_kotatsu');
    expect(items).toHaveLength(1);
    expect(items[0].categories).toContain('Favorite Webtoons');
    expect(items[0].categories).toContain('Must Read');
  });

  it('correctly resolves categories from object-map categories.json and tuple junction entries', async () => {
    const zip = new AdmZip();
    zip.addFile('categories.json', Buffer.from(JSON.stringify({
      '1': 'Solo Leveling Tier',
      '2': 'Top Action'
    })));
    zip.addFile('favourites_categories.json', Buffer.from(JSON.stringify([
      [100, 1],
      [100, 2]
    ])));
    zip.addFile('favourites.json', Buffer.from(JSON.stringify([
      {
        id: 100,
        manga: {
          id: 999,
          title: 'Solo Leveling',
          source: 'ASURASCANS',
          publicUrl: 'https://asurascans.com/comics/solo-leveling',
          genres: ['Action', 'Manhwa']
        }
      }
    ])));

    const items = await parseKotatsuBackup(zip.toBuffer(), 'usr_test');
    expect(items).toHaveLength(1);
    expect(items[0].categories).toContain('Solo Leveling Tier');
    expect(items[0].categories).toContain('Top Action');
  });

  it('correctly resolves direct category strings and category_name fields', async () => {
    const backup = {
      favourites: [
        {
          category: 'Super Secret Shelf',
          category_name: 'Secondary Shelf',
          manga: {
            title: 'Nanomachine',
            source: 'ASURASCANS',
            publicUrl: 'https://asurascans.com/comics/nanomachine',
            genres: ['Action', 'Manhwa']
          }
        }
      ]
    };

    const items = await parseKotatsuBackup(JSON.stringify(backup), 'usr_test');
    expect(items).toHaveLength(1);
    expect(items[0].categories).toContain('Super Secret Shelf');
    expect(items[0].categories).toContain('Secondary Shelf');
  });

  it('restores reading progress from separate chapters.json and history.json referencing chapter_id', async () => {
    const zip = new AdmZip();
    
    const mangaData = JSON.stringify([
      {
        id: 701,
        title: 'Solo Leveling',
        source: 'ASURASCANS',
        public_url: 'https://asurascans.com/manga/solo-leveling',
        genres: ['Action', 'Fantasy', 'Manhwa'],
        state: 'COMPLETED'
      }
    ]);

    const favouritesData = JSON.stringify([
      {
        manga_id: 701,
        category_id: 1,
        created_at: 1700000000000
      }
    ]);

    const chaptersData = JSON.stringify([
      { id: 7001, manga_id: 701, name: 'Chapter 1', number: 1.0, read: true, last_page_read: 20 },
      { id: 7002, manga_id: 701, name: 'Chapter 2', number: 2.0, read: true, last_page_read: 25 },
      { id: 7003, manga_id: 701, name: 'Chapter 3: The Awakening', number: 3.0, read: true, last_page_read: 30 },
      { id: 7004, manga_id: 701, name: 'Chapter 4', number: 4.0, read: false, last_page_read: 0 },
      { id: 7005, manga_id: 701, name: 'Chapter 5', number: 5.0, read: false, last_page_read: 0 }
    ]);

    const historyData = JSON.stringify([
      {
        manga_id: 701,
        chapter_id: 7003,
        page: 30,
        percent: 1.0,
        updated_at: 1705000000000
      }
    ]);

    const categoriesData = JSON.stringify([
      { id: 1, name: 'Top Tier' }
    ]);

    zip.addFile('manga.json', Buffer.from(mangaData, 'utf-8'));
    zip.addFile('favourites.json', Buffer.from(favouritesData, 'utf-8'));
    zip.addFile('chapters.json', Buffer.from(chaptersData, 'utf-8'));
    zip.addFile('history.json', Buffer.from(historyData, 'utf-8'));
    zip.addFile('categories.json', Buffer.from(categoriesData, 'utf-8'));

    const items = await parseKotatsuBackup(zip.toBuffer(), 'usr_kotatsu');
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Solo Leveling');
    expect(items[0].currentChapter).toBe(3);
    expect(items[0].totalChapters).toBe(5);
    expect(items[0].categories).toContain('Top Tier');
    expect(items[0].isFavorite).toBe(true);
  });

  it('restores reading progress from chapter read flags when history is not present', async () => {
    const zip = new AdmZip();
    
    const mangaData = JSON.stringify([
      {
        id: 801,
        title: 'Return of the Mount Hua Sect',
        source: 'ASURASCANS',
        public_url: 'https://asurascans.com/manga/mount-hua',
        genres: ['Action', 'Martial Arts', 'Manhwa']
      }
    ]);

    const chaptersData = JSON.stringify([
      { id: 8001, manga_id: 801, name: 'Chapter 1', number: 1, read: true },
      { id: 8002, manga_id: 801, name: 'Chapter 2', number: 2, read: true },
      { id: 8003, manga_id: 801, name: 'Chapter 3', number: 3, read: true },
      { id: 8004, manga_id: 801, name: 'Chapter 4', number: 4, read: true, last_page_read: 15 },
      { id: 8005, manga_id: 801, name: 'Chapter 5', number: 5, read: false }
    ]);

    zip.addFile('manga.json', Buffer.from(mangaData, 'utf-8'));
    zip.addFile('chapters.json', Buffer.from(chaptersData, 'utf-8'));

    const items = await parseKotatsuBackup(zip.toBuffer(), 'usr_kotatsu');
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Return of the Mount Hua Sect');
    expect(items[0].currentChapter).toBe(4);
    expect(items[0].totalChapters).toBe(5);
  });

  it('restores reading progress from tracker sync entries in tracks.json', async () => {
    const zip = new AdmZip();
    
    const mangaData = JSON.stringify([
      {
        id: 901,
        title: 'Beginning After the End',
        source: 'FLAME_COMICS',
        public_url: 'https://flamecomics.com/series/tbate',
        genres: ['Action', 'Fantasy', 'Manhwa']
      }
    ]);

    const tracksData = JSON.stringify([
      {
        manga_id: 901,
        tracker_id: 1, // AniList
        last_chapter_read: 175,
        total_chapters: 200,
        score: 9.5
      }
    ]);

    zip.addFile('manga.json', Buffer.from(mangaData, 'utf-8'));
    zip.addFile('tracks.json', Buffer.from(tracksData, 'utf-8'));

    const items = await parseKotatsuBackup(zip.toBuffer(), 'usr_kotatsu');
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Beginning After the End');
    expect(items[0].currentChapter).toBe(175);
    expect(items[0].totalChapters).toBe(200);
  });

  it('correctly parses chapter numbers from complex titles and decimal strings', async () => {
    const zip = new AdmZip();
    
    const mangaData = JSON.stringify([
      {
        id: 950,
        title: 'Chainsaw Man',
        source: 'MANGADEX',
        genres: ['Action', 'Supernatural']
      }
    ]);

    const chaptersData = JSON.stringify([
      { id: 1, manga_id: 950, name: 'Vol. 1 Ch. 1 - Dog & Chainsaw', read: true },
      { id: 2, manga_id: 950, name: 'Vol. 5 Ch. 45.5 - Bonus Chapter', read: true },
      { id: 3, manga_id: 950, name: 'Ch. 99 - Second Part', read: false }
    ]);

    zip.addFile('manga.json', Buffer.from(mangaData, 'utf-8'));
    zip.addFile('chapters.json', Buffer.from(chaptersData, 'utf-8'));

    const items = await parseKotatsuBackup(zip.toBuffer(), 'usr_kotatsu');
    expect(items).toHaveLength(1);
    expect(items[0].currentChapter).toBe(45.5);
    expect(items[0].totalChapters).toBe(99);
  });
});

describe('Kotatsu export', () => {
  it('exports library to valid Kotatsu JSON backup structure', () => {
    const exported = exportToKotatsuBackup([
      {
        id: 'manga_1',
        title: 'Omniscient Reader',
        altTitles: ['ORV'],
        genres: ['Action', 'Fantasy'],
        status: 'reading',
        currentChapter: 150,
        totalChapters: 200,
        latestChapter: 200,
        rating: 9.8,
        sourceUrl: 'https://asurascans.com/series/orv',
        sourceName: 'Asura Scans',
        coverImage: 'https://example.com/orv.jpg',
        description: 'Only I know the end.',
        isFavorite: true,
        addedAt: '2026-01-01T00:00:00.000Z',
        lastReadAt: '2026-02-01T00:00:00.000Z',
        lastUpdated: '2026-02-01T00:00:00.000Z',
        userId: 'usr_admin',
        type: 'manhwa',
        autoUpdateEnabled: true,
        isFlagged: false,
        notes: '',
      },
    ]);

    const parsed = JSON.parse(exported);
    expect(parsed.version).toBe(1);
    expect(parsed.favourites).toHaveLength(1);
    expect(parsed.favourites[0].manga.title).toBe('Omniscient Reader');
    expect(parsed.favourites[0].manga.state).toBe('ONGOING');
    expect(parsed.favourites[0].manga.chapters).toHaveLength(200);
    expect(parsed.favourites[0].pinned).toBe(true);
    expect(parsed.history).toHaveLength(1);
    expect(parsed.history[0].chapter.number).toBe(150);
  });
});
