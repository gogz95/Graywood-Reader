import { create } from 'zustand';
import { UserProfile, UserRole } from '../types';
import { apiFetch, clearAuthToken, getAuthToken, logout } from '../utils/api';
import { migrateClientSessionHistoryToUser } from '../hooks/useReaderSession';

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

  /** Computed: the currently active user profile object */
  activeProfile: UserProfile;
  /** Computed: true when the active user is the guest (unauthenticated) */
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

function resolveActiveProfile(profiles: UserProfile[], activeProfileId: string): UserProfile {
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

export const useAuthStore = create<AuthState>((set, get) => ({
  profiles: DEFAULT_PROFILES,
  activeProfileId: getInitialProfileId(),
  isHostComputer: true,

  get activeProfile() {
    return resolveActiveProfile(get().profiles, get().activeProfileId);
  },
  get isGuestClient() {
    return get().activeProfileId === 'usr_guest';
  },

  setProfiles: (profiles) => set({ profiles }),
  setActiveProfileId: (id) => {
    set({ activeProfileId: id });
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
          set({ profiles: data.map((p: UserProfile) => ({ ...p, password: undefined })) });
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
          get().setActiveProfileId(data.user.id);
          set((state) => {
            const exists = state.profiles.some((p) => p.id === data.user.id);
            return {
              profiles: exists
                ? state.profiles.map((p) =>
                    p.id === data.user.id ? { ...p, ...data.user, password: undefined } : p
                  )
                : [...state.profiles, { ...data.user, password: undefined }],
            };
          });
        } else {
          clearAuthToken();
        }
      }
    } catch (err) {
      console.error('Fetch auth me error:', err);
    }
  },

  handleRegisterUser: (newUser) => {
    set((state) => {
      const exists = state.profiles.some((p) => p.id === newUser.id);
      return {
        profiles: exists
          ? state.profiles.map((p) => (p.id === newUser.id ? { ...p, ...newUser, password: undefined } : p))
          : [...state.profiles, { ...newUser, password: undefined }],
      };
    });
    get().setActiveProfileId(newUser.id);
    migrateClientSessionHistoryToUser(newUser.id);
  },

  handleLoginUser: (user) => {
    set((state) => {
      const exists = state.profiles.some((p) => p.id === user.id);
      return {
        profiles: exists
          ? state.profiles.map((p) => (p.id === user.id ? { ...p, ...user, password: undefined } : p))
          : [...state.profiles, { ...user, password: undefined }],
      };
    });
    get().setActiveProfileId(user.id);
    migrateClientSessionHistoryToUser(user.id);
  },

  handleLogoutUser: async () => {
    await logout();
    clearAuthToken();
    const fallbackId = get().isHostComputer ? 'usr_admin' : 'usr_guest';
    get().setActiveProfileId(fallbackId);
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
        set((state) => ({
          profiles: state.profiles.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)),
        }));
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
        set((state) => ({
          profiles: state.profiles.map((p) =>
            p.id === userId ? { ...p, ...updated, password: undefined } : p
          ),
        }));
      }
    } catch (err) {
      console.error('Promote user error:', err);
    }
  },

  handleDeleteProfile: (profileId) => {
    const { profiles, activeProfileId, setActiveProfileId } = get();
    if (profiles.length <= 1) return;
    const remaining = profiles.filter((p) => p.id !== profileId);
    set({ profiles: remaining });
    if (activeProfileId === profileId) {
      setActiveProfileId(remaining[0]?.id || 'usr_guest');
      clearAuthToken();
    }
  },
}));
