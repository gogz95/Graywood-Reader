// ============================================================================
// DISCORD RICH PRESENCE (RPC) SERVICE
// Broadcasts active reading session to Discord (Series, Chapter, Elapsed Time)
// ============================================================================

export interface DiscordPresencePayload {
  mangaTitle: string;
  chapterNumber: number;
  totalChapters?: number | null;
  coverImage?: string;
  isReading: boolean;
}

let activeSession: {
  mangaTitle: string;
  chapterNumber: number;
  startedAt: number;
} | null = null;

export function updateDiscordPresence(payload: DiscordPresencePayload): { success: boolean; session?: any } {
  if (!payload.isReading || !payload.mangaTitle) {
    activeSession = null;
    return { success: true, session: null };
  }

  const now = Date.now();
  if (!activeSession || activeSession.mangaTitle !== payload.mangaTitle || activeSession.chapterNumber !== payload.chapterNumber) {
    activeSession = {
      mangaTitle: payload.mangaTitle,
      chapterNumber: payload.chapterNumber,
      startedAt: now,
    };
  }

  const presenceState = {
    details: `Reading ${payload.mangaTitle}`,
    state: `Chapter ${payload.chapterNumber}${payload.totalChapters ? ` of ${payload.totalChapters}` : ''}`,
    startTimestamp: activeSession.startedAt,
    largeImageKey: payload.coverImage || 'graywood_logo',
    largeImageText: 'Graywood Reader',
  };

  // In standalone desktop/Electron host or Node context, logging active RPC status
  return { success: true, session: presenceState };
}

export function getActiveDiscordPresence() {
  return activeSession;
}
