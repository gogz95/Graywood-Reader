import { db } from './connection';
import { MangaItem, UserProfile } from '../src/types';

// Precompiled Statements for Profiles, User Favorites, and User Library State
const stmtGetAllProfiles = db.prepare('SELECT * FROM profiles ORDER BY createdAt ASC');
const stmtGetProfileById = db.prepare('SELECT * FROM profiles WHERE id = ?');
const stmtDeleteAllProfiles = db.prepare('DELETE FROM profiles');
const stmtDeleteProfile = db.prepare('DELETE FROM profiles WHERE id = ?');
const stmtUpsertProfile = db.prepare(`
  INSERT INTO profiles (id, name, username, email, avatar, role, password, storageFolderPath, createdAt)
  VALUES (@id, @name, @username, @email, @avatar, @role, @password, @storageFolderPath, @createdAt)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    username = excluded.username,
    email = excluded.email,
    avatar = excluded.avatar,
    role = excluded.role,
    password = excluded.password,
    storageFolderPath = excluded.storageFolderPath,
    createdAt = excluded.createdAt
`);

const stmtUpsertUserFavorite = db.prepare(`
  INSERT INTO user_favorites (user_id, manga_id, is_favorite, updated_at)
  VALUES (@user_id, @manga_id, @is_favorite, @updated_at)
  ON CONFLICT(user_id, manga_id) DO UPDATE SET
    is_favorite = excluded.is_favorite,
    updated_at = excluded.updated_at
`);
const stmtGetUserFavorites = db.prepare(`
  SELECT manga_id, is_favorite FROM user_favorites WHERE user_id = ? AND is_favorite = 1
`);
const stmtGetUserFavorite = db.prepare(`
  SELECT is_favorite FROM user_favorites WHERE user_id = ? AND manga_id = ?
`);
const stmtDeleteUserFavoritesByUser = db.prepare(`DELETE FROM user_favorites WHERE user_id = ?`);

const stmtUpsertUserLibraryState = db.prepare(`
  INSERT INTO user_library_state (user_id, manga_id, current_chapter, last_read_at, status, rating, notes)
  VALUES (@user_id, @manga_id, @current_chapter, @last_read_at, @status, @rating, @notes)
  ON CONFLICT(user_id, manga_id) DO UPDATE SET
    current_chapter = CASE
      WHEN excluded.current_chapter IS NOT NULL AND excluded.current_chapter > COALESCE(user_library_state.current_chapter, 0) THEN excluded.current_chapter
      WHEN excluded.current_chapter IS NOT NULL THEN excluded.current_chapter
      ELSE user_library_state.current_chapter
    END,
    last_read_at = COALESCE(excluded.last_read_at, user_library_state.last_read_at),
    status = COALESCE(excluded.status, user_library_state.status),
    rating = COALESCE(excluded.rating, user_library_state.rating),
    notes = COALESCE(excluded.notes, user_library_state.notes)
`);
const stmtGetUserLibraryState = db.prepare(`
  SELECT * FROM user_library_state WHERE user_id = ?
`);
const stmtGetUserLibraryStateOne = db.prepare(`
  SELECT * FROM user_library_state WHERE user_id = ? AND manga_id = ?
`);
const stmtDeleteUserLibraryStateByUser = db.prepare(`DELETE FROM user_library_state WHERE user_id = ?`);
const stmtGetMangaCategories = db.prepare('SELECT category_id FROM manga_categories WHERE manga_id = ? AND user_id = ?');
const stmtGetMangaCategoriesAllForUser = db.prepare('SELECT manga_id, category_id FROM manga_categories WHERE user_id = ?');

const stmtDeleteReadingProgressByUserId = db.prepare(`DELETE FROM reading_progress WHERE user_id = ?`);
const stmtDeleteReadingActivityByUserId = db.prepare(`DELETE FROM reading_activity WHERE user_id = ?`);
const stmtDeleteMangaByUserId = db.prepare(`DELETE FROM manga WHERE userId = ?`);

// ── Profiles Management ───────────────────────────────────────────────────────
export function getAllProfiles(): UserProfile[] {
  return stmtGetAllProfiles.all() as UserProfile[];
}

export function getProfileById(id: string): UserProfile | null {
  return (stmtGetProfileById.get(id) as UserProfile) || null;
}

export function upsertProfile(profile: any) {
  stmtUpsertProfile.run({
    id: profile.id,
    name: profile.name || '',
    username: profile.username || '',
    email: profile.email || '',
    avatar: profile.avatar || '',
    role: profile.role || 'user',
    password: profile.password || '',
    storageFolderPath: profile.storageFolderPath || '',
    createdAt: profile.createdAt || new Date().toISOString(),
  });
}

export function deleteProfile(id: string) {
  stmtDeleteProfile.run(id);
}

export function replaceAllProfiles(profiles: any[]) {
  const transaction = db.transaction((list: any[]) => {
    const keepIds = new Set(list.map((p) => p.id));
    for (const p of list) {
      stmtUpsertProfile.run({
        id: p.id,
        name: p.name || '',
        username: p.username || '',
        email: p.email || '',
        avatar: p.avatar || '',
        role: p.role || 'user',
        password: p.password || '',
        storageFolderPath: p.storageFolderPath || '',
        createdAt: p.createdAt || new Date().toISOString(),
      });
    }
    const existing = db.prepare('SELECT id FROM users').all() as { id: string }[];
    for (const row of existing) {
      if (!keepIds.has(row.id)) {
        stmtDeleteProfile.run(row.id);
      }
    }
  });
  transaction(profiles);
}

// ── Per-User Favorites ────────────────────────────────────────────────────────
export function setUserFavorite(userId: string, mangaId: string, isFavorite: boolean) {
  stmtUpsertUserFavorite.run({
    user_id: userId,
    manga_id: mangaId,
    is_favorite: isFavorite ? 1 : 0,
    updated_at: new Date().toISOString(),
  });
}

export function getUserFavoriteIds(userId: string): Set<string> {
  const rows = stmtGetUserFavorites.all(userId) as { manga_id: string }[];
  return new Set(rows.map((r) => r.manga_id));
}

export function isUserFavorite(userId: string, mangaId: string): boolean {
  const row = stmtGetUserFavorite.get(userId, mangaId) as { is_favorite: number } | undefined;
  return Boolean(row?.is_favorite);
}

// ── Per-User Library Chapter State ───────────────────────────────────────────
export function setUserLibraryChapter(
  userId: string,
  mangaId: string,
  currentChapter?: number | null,
  opts?: { status?: string; rating?: number; notes?: string; lastReadAt?: string }
) {
  const existing = stmtGetUserLibraryStateOne.get(userId, mangaId) as
    | { current_chapter?: number; status?: string; rating?: number; notes?: string; last_read_at?: string }
    | undefined;
  const nextCh = currentChapter !== undefined && currentChapter !== null
    ? Number(currentChapter)
    : (existing?.current_chapter !== undefined ? Number(existing.current_chapter) : 0);
  stmtUpsertUserLibraryState.run({
    user_id: userId,
    manga_id: mangaId,
    current_chapter: nextCh,
    last_read_at: opts?.lastReadAt || new Date().toISOString(),
    status: opts?.status !== undefined ? opts.status : (existing?.status || null),
    rating: opts?.rating !== undefined ? opts.rating : (existing?.rating !== undefined ? existing.rating : null),
    notes: opts?.notes !== undefined ? opts.notes : (existing?.notes || null),
  });
}

export function getUserLibraryStateMap(userId: string): Map<string, { currentChapter: number; lastReadAt?: string; status?: string; rating?: number; notes?: string }> {
  const rows = stmtGetUserLibraryState.all(userId) as any[];
  const map = new Map<string, { currentChapter: number; lastReadAt?: string; status?: string; rating?: number; notes?: string }>();
  for (const r of rows) {
    map.set(r.manga_id, {
      currentChapter: Number(r.current_chapter) || 0,
      lastReadAt: r.last_read_at || undefined,
      status: r.status || undefined,
      rating: r.rating !== null && r.rating !== undefined ? Number(r.rating) : undefined,
      notes: r.notes || undefined,
    });
  }
  return map;
}

export function getAllUserLibraryStates(userId: string): any[] {
  return stmtGetUserLibraryState.all(userId) as any[];
}

// ── User Overlay Application ─────────────────────────────────────────────────
export function applyUserOverlayOne(manga: MangaItem, userId: string | null | undefined): MangaItem {
  if (!userId) return manga;
  const isFav = isUserFavorite(userId, manga.id);
  const stateRow = stmtGetUserLibraryStateOne.get(userId, manga.id) as {
    current_chapter?: number;
    last_read_at?: string;
    status?: string;
    rating?: number;
    notes?: string;
  } | undefined;
  const catRows = stmtGetMangaCategories.all(manga.id, userId) as { category_id: string }[];
  const categories = catRows.map((r) => r.category_id);

  const effectiveChapter = Math.max(Number(stateRow?.current_chapter) || 0, Number(manga.currentChapter) || 0);

  return {
    ...manga,
    isFavorite: isFav,
    currentChapter: effectiveChapter,
    lastReadAt: stateRow?.last_read_at || manga.lastReadAt,
    status: (stateRow?.status as MangaItem['status']) || manga.status,
    rating: stateRow?.rating !== undefined && stateRow?.rating !== null ? Number(stateRow.rating) : manga.rating,
    notes: stateRow?.notes !== undefined && stateRow?.notes !== null ? stateRow.notes : manga.notes,
    categories,
  };
}

export function applyUserOverlay(items: MangaItem[], userId: string | null | undefined): MangaItem[] {
  if (!userId || items.length === 0) return items;
  if (items.length === 1) {
    return [applyUserOverlayOne(items[0], userId)];
  }

  const favs = getUserFavoriteIds(userId);
  const userStateMap = getUserLibraryStateMap(userId);
  const catRows = stmtGetMangaCategoriesAllForUser.all(userId) as { manga_id: string; category_id: string }[];
  const catMap = new Map<string, string[]>();
  for (const r of catRows) {
    const arr = catMap.get(r.manga_id) || [];
    arr.push(r.category_id);
    catMap.set(r.manga_id, arr);
  }

  return items.map((m) => {
    const state = userStateMap.get(m.id);
    const userCats = catMap.get(m.id);
    const effectiveChapter = Math.max(Number(state?.currentChapter) || 0, Number(m.currentChapter) || 0);
    return {
      ...m,
      isFavorite: favs.has(m.id),
      currentChapter: effectiveChapter,
      lastReadAt: state?.lastReadAt || m.lastReadAt,
      status: (state?.status as MangaItem['status']) || m.status,
      rating: state?.rating !== undefined && state?.rating !== null ? Number(state.rating) : m.rating,
      notes: state?.notes !== undefined && state?.notes !== null ? state.notes : m.notes,
      categories: userCats || [],
    };
  });
}

/** Permanently remove a user's profile, owned manga rows, and reading data. */
export function purgeUserData(userId: string): { mangaDeleted: number } {
  const run = db.transaction((uid: string) => {
    stmtDeleteReadingProgressByUserId.run(uid);
    stmtDeleteReadingActivityByUserId.run(uid);
    stmtDeleteUserFavoritesByUser.run(uid);
    stmtDeleteUserLibraryStateByUser.run(uid);
    const mangaInfo = stmtDeleteMangaByUserId.run(uid);
    stmtDeleteProfile.run(uid);
    return { mangaDeleted: Number(mangaInfo.changes) || 0 };
  });
  return run(userId);
}
