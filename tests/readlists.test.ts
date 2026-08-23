import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteDb } from '../sqlite-db';

describe('Cross-Series Readlists & Playlists Database Engine', () => {
  const testUserId = 'usr_readlist_test';

  beforeEach(() => {
    // Clear test readlists
    const existing = SqliteDb.getReadlists(testUserId);
    for (const rl of existing) {
      SqliteDb.deleteReadlist(rl.id, testUserId);
    }
  });

  it('creates and retrieves a new custom readlist', () => {
    const created = SqliteDb.createReadlist({
      id: 'rl_ptj_universe',
      userId: testUserId,
      name: 'PTJ Universe Master Order',
      description: 'Chronological reading order for Lookism, Viral Hit, and Manager Kim',
      coverImage: 'https://example.com/ptj.jpg',
    });

    expect(created.id).toBe('rl_ptj_universe');
    expect(created.name).toBe('PTJ Universe Master Order');

    const list = SqliteDb.getReadlists(testUserId);
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.find((r) => r.id === 'rl_ptj_universe')).toBeDefined();
  });

  it('adds chapter items and preserves sequential sorting', () => {
    SqliteDb.createReadlist({
      id: 'rl_solo_arc',
      userId: testUserId,
      name: 'Solo Leveling Complete Arc',
    });

    // Add item from Series A (Lookism)
    SqliteDb.addReadlistItem({
      id: 'rli_1',
      readlistId: 'rl_solo_arc',
      mangaId: 'manga_lookism',
      chapterNumber: 1,
      chapterTitle: 'Lookism Ch. 1',
      sortOrder: 0,
      notes: 'Prologue',
    });

    // Add item from Series B (Manager Kim)
    SqliteDb.addReadlistItem({
      id: 'rli_2',
      readlistId: 'rl_solo_arc',
      mangaId: 'manga_manager_kim',
      chapterNumber: 1,
      chapterTitle: 'Manager Kim Ch. 1',
      sortOrder: 1,
      notes: 'Prequel Arc',
    });

    const detailed = SqliteDb.getReadlistById('rl_solo_arc', testUserId);
    expect(detailed).not.toBeNull();
    expect(detailed.itemsCount).toBe(2);
    expect(detailed.items.length).toBe(2);
    expect(detailed.items[0].mangaId).toBe('manga_lookism');
    expect(detailed.items[1].mangaId).toBe('manga_manager_kim');
  });

  it('reorders readlist items cleanly', () => {
    SqliteDb.createReadlist({
      id: 'rl_reorder_test',
      userId: testUserId,
      name: 'Reorder Test Arc',
    });

    SqliteDb.addReadlistItem({
      id: 'rli_a',
      readlistId: 'rl_reorder_test',
      mangaId: 'manga_a',
      chapterNumber: 10,
      sortOrder: 0,
    });

    SqliteDb.addReadlistItem({
      id: 'rli_b',
      readlistId: 'rl_reorder_test',
      mangaId: 'manga_b',
      chapterNumber: 20,
      sortOrder: 1,
    });

    // Swap order
    SqliteDb.setReadlistItems('rl_reorder_test', [
      { id: 'rli_b', mangaId: 'manga_b', chapterNumber: 20, sortOrder: 0 },
      { id: 'rli_a', mangaId: 'manga_a', chapterNumber: 10, sortOrder: 1 },
    ]);

    const detailed = SqliteDb.getReadlistById('rl_reorder_test', testUserId);
    expect(detailed.items[0].mangaId).toBe('manga_b');
    expect(detailed.items[1].mangaId).toBe('manga_a');
  });

  it('deletes readlist and cascades item deletion', () => {
    SqliteDb.createReadlist({
      id: 'rl_to_delete',
      userId: testUserId,
      name: 'Temporary List',
    });

    SqliteDb.addReadlistItem({
      id: 'rli_temp',
      readlistId: 'rl_to_delete',
      mangaId: 'manga_temp',
      chapterNumber: 1,
      sortOrder: 0,
    });

    const deleted = SqliteDb.deleteReadlist('rl_to_delete', testUserId);
    expect(deleted).toBe(true);

    const fetched = SqliteDb.getReadlistById('rl_to_delete', testUserId);
    expect(fetched).toBeNull();
  });
});
