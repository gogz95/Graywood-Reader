import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAuthStore, GUEST_PROFILE } from '../src/stores/useAuthStore';
import { useLibraryStore, getDisplayMangaList } from '../src/stores/useLibraryStore';
import { MangaItem, UserProfile } from '../src/types';

const memoryStore: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (k: string) => memoryStore[k] || null,
  setItem: (k: string, v: string) => { memoryStore[k] = v; },
  removeItem: (k: string) => { delete memoryStore[k]; },
  clear: () => { Object.keys(memoryStore).forEach((k) => delete memoryStore[k]); },
};

(globalThis as any).localStorage = mockLocalStorage;
(globalThis as any).fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => [],
});

describe('Auth Store & Library Display Reactivity', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    useAuthStore.setState({
      profiles: [
        {
          id: 'usr_admin',
          name: 'Host Administrator',
          username: 'admin',
          email: 'admin@manga.dev',
          avatar: '🛡️',
          role: 'admin',
          createdAt: new Date().toISOString(),
        },
        GUEST_PROFILE,
      ],
      activeProfileId: 'usr_admin',
      isHostComputer: true,
      activeProfile: {
        id: 'usr_admin',
        name: 'Host Administrator',
        username: 'admin',
        email: 'admin@manga.dev',
        avatar: '🛡️',
        role: 'admin',
        createdAt: new Date().toISOString(),
      },
      isGuestClient: false,
    });

    useLibraryStore.setState({
      mangaList: [
        {
          id: 'manga_1',
          title: 'Solo Leveling',
          altTitles: [],
          type: 'manhwa',
          coverImage: 'https://example.com/cover1.jpg',
          description: 'Hunter story',
          genres: ['Action', 'Fantasy'],
          status: 'reading',
          currentChapter: 10,
          latestChapter: 100,
          lastUpdated: new Date().toISOString(),
          rating: 9.5,
          sourceUrl: 'https://example.com/sl',
          sourceName: 'MangaDex',
          autoUpdateEnabled: true,
          notes: '',
          userId: 'usr_admin',
          isFavorite: true,
          isNsfw: false,
        },
        {
          id: 'manga_2',
          title: 'Explicit 18+ Romance',
          altTitles: [],
          type: 'manhwa',
          coverImage: 'https://example.com/cover2.jpg',
          description: 'Adult Romance',
          genres: ['Romance', 'Adult'],
          status: 'reading',
          currentChapter: 5,
          latestChapter: 50,
          lastUpdated: new Date().toISOString(),
          rating: 8.0,
          sourceUrl: 'https://example.com/er',
          sourceName: 'MangaDex',
          autoUpdateEnabled: true,
          notes: '',
          userId: 'usr_admin',
          isFavorite: false,
          isNsfw: true,
        },
      ],
    });
  });

  it('updates activeProfile and isGuestClient reactively on login and logout', () => {
    const customUser: UserProfile = {
      id: 'usr_reader123',
      name: 'Reader 123',
      username: 'reader123',
      email: 'reader@example.com',
      avatar: '🦊',
      role: 'user',
      createdAt: new Date().toISOString(),
    };

    // 1. Initial host admin
    expect(useAuthStore.getState().activeProfile.id).toBe('usr_admin');
    expect(useAuthStore.getState().isGuestClient).toBe(false);

    // 2. Login as custom user
    useAuthStore.getState().handleLoginUser(customUser);
    expect(useAuthStore.getState().activeProfileId).toBe('usr_reader123');
    expect(useAuthStore.getState().activeProfile.name).toBe('Reader 123');
    expect(useAuthStore.getState().activeProfile.role).toBe('user');
    expect(useAuthStore.getState().isGuestClient).toBe(false);

    // 3. Switch to guest
    useAuthStore.getState().setActiveProfileId('usr_guest');
    expect(useAuthStore.getState().activeProfileId).toBe('usr_guest');
    expect(useAuthStore.getState().activeProfile.name).toBe('Guest Reader');
    expect(useAuthStore.getState().isGuestClient).toBe(true);

    // 4. Switch back to custom user
    useAuthStore.getState().setActiveProfileId('usr_reader123');
    expect(useAuthStore.getState().activeProfileId).toBe('usr_reader123');
    expect(useAuthStore.getState().activeProfile.name).toBe('Reader 123');
    expect(useAuthStore.getState().isGuestClient).toBe(false);
  });

  it('correctly filters manga in getDisplayMangaList for regular users and guests', () => {
    const regularUser: UserProfile = {
      id: 'usr_regular',
      name: 'Regular Reader',
      username: 'regular',
      email: 'regular@example.com',
      avatar: '🥷',
      role: 'user',
      allowNsfw: true,
      createdAt: new Date().toISOString(),
    };

    const mangaList = useLibraryStore.getState().mangaList;

    // 1. Regular user sees both SFW and NSFW manga from shared catalog
    useAuthStore.getState().handleLoginUser(regularUser);
    const regularList = getDisplayMangaList(mangaList, useAuthStore.getState().activeProfile, useAuthStore.getState().isGuestClient);
    expect(regularList.length).toBe(2);
    expect(regularList.map((m) => m.id)).toContain('manga_1');
    expect(regularList.map((m) => m.id)).toContain('manga_2');

    // 2. Guest user is blocked from NSFW manga
    useAuthStore.getState().setActiveProfileId('usr_guest');
    const guestList = getDisplayMangaList(mangaList, useAuthStore.getState().activeProfile, useAuthStore.getState().isGuestClient);
    expect(guestList.length).toBe(1);
    expect(guestList[0].id).toBe('manga_1');

    // 3. User with allowNsfw: false is blocked from NSFW manga
    const restrictedUser: UserProfile = {
      ...regularUser,
      id: 'usr_restricted',
      allowNsfw: false,
    };
    useAuthStore.getState().handleLoginUser(restrictedUser);
    const restrictedList = getDisplayMangaList(mangaList, useAuthStore.getState().activeProfile, useAuthStore.getState().isGuestClient);
    expect(restrictedList.length).toBe(1);
    expect(restrictedList[0].id).toBe('manga_1');
  });
});

