import { describe, it, expect } from 'vitest';
import { updateDiscordPresence, getActiveDiscordPresence } from '../server/services/discordRpcService';

describe('Discord Rich Presence (RPC) Integration', () => {
  it('starts and updates active Discord reading presence payload', () => {
    const res = updateDiscordPresence({
      mangaTitle: 'Solo Leveling',
      chapterNumber: 150,
      totalChapters: 200,
      coverImage: 'https://example.com/cover.jpg',
      isReading: true,
    });

    expect(res.success).toBe(true);
    expect(res.session.details).toBe('Reading Solo Leveling');
    expect(res.session.state).toBe('Chapter 150 of 200');

    const active = getActiveDiscordPresence();
    expect(active?.mangaTitle).toBe('Solo Leveling');
    expect(active?.chapterNumber).toBe(150);
  });

  it('clears session when isReading is false', () => {
    updateDiscordPresence({
      mangaTitle: 'Solo Leveling',
      chapterNumber: 150,
      isReading: false,
    });

    const active = getActiveDiscordPresence();
    expect(active).toBeNull();
  });
});
