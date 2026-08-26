import { create } from 'zustand';
import { UserProfile, UserRole } from '../types';
import { apiFetch, clearAuthToken, getAuthToken, logout } from '../utils/api';
import { migrateClientSessionHistoryToUser } from '../hooks/useReaderSession';
import { useLibraryStore } from './useLibraryStore';

// ============================================================================
// useAuthStore — Global authentication & profile state (Zustand)
// Replaces the useAuth() hook from hooks/useAuth.ts.
// Now any component can access auth state directly without prop drilling.
// ============================================================================

export const GUEST_PROFILE: UserProfile = {
  id: 'usr_guest',
  name: 'Guest Reader',
  username: 'guest',
  email: 'guest@graywood.app',
  avatar: '👤',
  role: 'user',
  createdAt: new Date().toISOString(),
};

const DEFAULT_PROFILES: UserProfile[] = [
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
];

export function getDeviceId(): string {
  try {
    let devId = localStorage.getItem('graywood_device_id');
    if (!devId) {
      devId = 'dev_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
      localStorage.setItem('graywood_device_id', devId);
    }
    return devId;
  } catch (_) {
    return 'dev_default';
  }
}

interface AuthState {
  profiles: UserProfile[];
  activeProfileId: string;
  isHostComputer: boolean;

  /** Active user profile object */
  activeProfile: UserProfile;
  /** True when the active user is the guest (unauthenticated) */
  isGuestClient: boolean;

  // Actions
  setProfiles: (profiles: UserProfile[]) => void;
  setActiveProfileId: (id: string) => void;
  setIsHostComputer: (isHost: boolean) => void;

  fetchClientContext: () => Promise<void>;
  fetchProfiles: () => Promise<void>;
  fetchAuthMe: () => Promise<void>;

  handleRegisterUser: (newUser: UserProfile) => void;
  handleLoginUser: (user: UserProfile) => void;
  handleLogoutUser: () => Promise<void>;
  handleUpdateProfile: (updates: {
    name?: string;
    avatar?: string;
    email?: string;
    theme?: UserProfile['theme'];
  }) => Promise<boolean>;
  handlePromoteUser: (userId: string, newRole: UserRole) => Promise<void>;
  handleDeleteProfile: (profileId: string) => void;
}

export function resolveActiveProfile(profiles: UserProfile[], activeProfileId: string): UserProfile {
  return profiles.find((p) => p.id === activeProfileId) || profiles[0] || GUEST_PROFILE;
}

function getInitialProfileId(): string {
  try {
    const cached = localStorage.getItem(`graywood_${getDeviceId()}_active_profile`);
    return cached || 'usr_admin';
  } catch {
    return 'usr_admin';
  }
}

const initialProfiles = DEFAULT_PROFILES;
const initialProfileId = getInitialProfileId();
const initialActiveProfile = resolveActiveProfile(initialProfiles, initialProfileId);
const initialIsGuest = initialProfileId === 'usr_guest';

export const useAuthStore = create<AuthState>((set, get) => ({
  profiles: initialProfiles,
  activeProfileId: initialProfileId,
  isHostComputer: true,
  activeProfile: initialActiveProfile,
  isGuestClient: initialIsGuest,

  setProfiles: (profiles) => {
    const { activeProfileId } = get();
    const activeProfile = resolveActiveProfile(profiles, activeProfileId);
    set({ profiles, activeProfile });
  },

  setActiveProfileId: (id) => {
    const { profiles } = get();
    const activeProfile = resolveActiveProfile(profiles, id);
    set({
      activeProfileId: id,
      activeProfile,
      isGuestClient: id === 'usr_guest',
    });
    try {
      localStorage.setItem(`graywood_${getDeviceId()}_active_profile`, id);
    } catch {}
  },

  setIsHostComputer: (isHost) => set({ isHostComputer: isHost }),

  fetchClientContext: async () => {
    try {
      const res = await apiFetch('/api/auth/client-context');
      if (res.ok) {
        const data = await res.json();
        set({ isHostComputer: data.isHost });
        if (!data.isHost && !getAuthToken()) {
          get().setActiveProfileId('usr_guest');
        } else if (data.isHost) {
          const cachedProfileId = localStorage.getItem(`graywood_${getDeviceId()}_active_profile`);
          if (cachedProfileId && get().profiles.some((p) => p.id === cachedProfileId)) {
            get().setActiveProfileId(cachedProfileId);
          }
        }
      }
    } catch (err) {
      console.error('Fetch client context error:', err);
    }
  },

  fetchProfiles: async () => {
    try {
      const res = await apiFetch('/api/profiles');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          const sanitizedProfiles: UserProfile[] = data.map((p: UserProfile) => ({ ...p, password: undefined }));
          const { activeProfileId } = get();
          const activeProfile = resolveActiveProfile(sanitizedProfiles, activeProfileId);
          set({
            profiles: sanitizedProfiles,
            activeProfile,
          });
        }
      }
    } catch (err) {
      console.error('Fetch profiles error:', err);
    }
  },

  fetchAuthMe: async () => {
    if (!getAuthToken()) return;
    try {
      const res = await apiFetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        if (data.authenticated && data.user?.id) {
          const u = data.user;
          const { profiles } = get();
          const exists = profiles.some((p) => p.id === u.id);
          const newProfiles = exists
            ? profiles.map((p) => (p.id === u.id ? { ...p, ...u, password: undefined } : p))
            : [...profiles, { ...u, password: undefined }];
          const activeProfile = resolveActiveProfile(newProfiles, u.id);
          set({
            profiles: newProfiles,
            activeProfileId: u.id,
            activeProfile,
            isGuestClient: u.id === 'usr_guest',
          });
          try {
            localStorage.setItem(`graywood_${getDeviceId()}_active_profile`, u.id);
          } catch {}
          migrateClientSessionHistoryToUser(u.id);
          useLibraryStore.getState().fetchMangaList();
        } else {
          clearAuthToken();
        }
      }
    } catch (err) {
      console.error('Fetch auth me error:', err);
    }
  },

  handleRegisterUser: (newUser) => {
    const { profiles } = get();
    const exists = profiles.some((p) => p.id === newUser.id);
    const newProfiles = exists
      ? profiles.map((p) => (p.id === newUser.id ? { ...p, ...newUser, password: undefined } : p))
      : [...profiles, { ...newUser, password: undefined }];
    const activeProfile = resolveActiveProfile(newProfiles, newUser.id);
    set({
      profiles: newProfiles,
      activeProfileId: newUser.id,
      activeProfile,
      isGuestClient: newUser.id === 'usr_guest',
    });
    try {
      localStorage.setItem(`graywood_${getDeviceId()}_active_profile`, newUser.id);
    } catch {}
    migrateClientSessionHistoryToUser(newUser.id);
    useLibraryStore.getState().fetchMangaList();
  },

  handleLoginUser: (user) => {
    const { profiles } = get();
    const exists = profiles.some((p) => p.id === user.id);
    const newProfiles = exists
      ? profiles.map((p) => (p.id === user.id ? { ...p, ...user, password: undefined } : p))
      : [...profiles, { ...user, password: undefined }];
    const activeProfile = resolveActiveProfile(newProfiles, user.id);
    set({
      profiles: newProfiles,
      activeProfileId: user.id,
      activeProfile,
      isGuestClient: user.id === 'usr_guest',
    });
    try {
      localStorage.setItem(`graywood_${getDeviceId()}_active_profile`, user.id);
    } catch {}
    migrateClientSessionHistoryToUser(user.id);
    useLibraryStore.getState().fetchMangaList();
  },

  handleLogoutUser: async () => {
    await logout();
    clearAuthToken();
    const fallbackId = get().isHostComputer ? 'usr_admin' : 'usr_guest';
    get().setActiveProfileId(fallbackId);
    useLibraryStore.getState().fetchMangaList();
  },

  handleUpdateProfile: async (updates) => {
    try {
      const res = await apiFetch('/api/auth/profile', {
        method: 'PUT',
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const data = await res.json();
        const updated = data.user as UserProfile;
        const { profiles, activeProfileId } = get();
        const newProfiles = profiles.map((p) => (p.id === updated.id ? { ...p, ...updated } : p));
        const activeProfile = resolveActiveProfile(newProfiles, activeProfileId);
        set({
          profiles: newProfiles,
          activeProfile,
        });
        return true;
      }
      return false;
    } catch (err) {
      console.error('Update profile error:', err);
      return false;
    }
  },

  handlePromoteUser: async (userId, newRole) => {
    try {
      const res = await apiFetch('/api/admin/users/promote', {
        method: 'POST',
        body: JSON.stringify({ userId, role: newRole }),
      });
      if (res.ok) {
        const data = await res.json();
        const updated = data.user as UserProfile;
        const { profiles, activeProfileId } = get();
        const newProfiles = profiles.map((p) =>
          p.id === userId ? { ...p, ...updated, password: undefined } : p
        );
        const activeProfile = resolveActiveProfile(newProfiles, activeProfileId);
        set({
          profiles: newProfiles,
          activeProfile,
        });
      }
    } catch (err) {
      console.error('Promote user error:', err);
    }
  },

  handleDeleteProfile: (profileId) => {
    const { profiles, activeProfileId, setActiveProfileId } = get();
    if (profiles.length <= 1) return;
    const remaining = profiles.filter((p) => p.id !== profileId);
    const fallbackId = activeProfileId === profileId ? (remaining[0]?.id || 'usr_guest') : activeProfileId;
    const activeProfile = resolveActiveProfile(remaining, fallbackId);
    set({
      profiles: remaining,
      activeProfileId: fallbackId,
      activeProfile,
      isGuestClient: fallbackId === 'usr_guest',
    });
    if (activeProfileId === profileId) {
      clearAuthToken();
      useLibraryStore.getState().fetchMangaList();
    }
  },
}));

export const useActiveProfile = () => useAuthStore((s) => s.activeProfile);
export const useIsGuest = () => useAuthStore((s) => s.isGuestClient);
