import { useState, useRef, useCallback } from 'react';
import { UserProfile, UserRole } from '../types';
import { apiFetch, clearAuthToken, getAuthToken } from '../utils/api';
import { migrateClientSessionHistoryToUser } from './useReaderSession';

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

export function useAuth() {
  const [profiles, setProfiles] = useState<UserProfile[]>(DEFAULT_PROFILES);
  const profilesRef = useRef(profiles);
  profilesRef.current = profiles;

  const [activeProfileId, setActiveProfileId] = useState<string>('usr_admin');
  const [isHostComputer, setIsHostComputer] = useState<boolean>(true);

  // Modal visibility states
  const [userProfileModalOpen, setUserProfileModalOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [adminPanelOpen, setAdminPanelOpen] = useState(false);

  const activeProfile = profiles.find((p) => p.id === activeProfileId) || profiles[0] || GUEST_PROFILE;

  const fetchClientContext = useCallback(async () => {
    try {
      const res = await apiFetch('/api/auth/client-context');
      if (res.ok) {
        const data = await res.json();
        setIsHostComputer(data.isHost);
        if (!data.isHost && !getAuthToken()) {
          setActiveProfileId('usr_guest');
        } else if (data.isHost) {
          const cachedProfileId = localStorage.getItem(`graywood_${getDeviceId()}_active_profile`);
          if (cachedProfileId && profilesRef.current.some((p) => p.id === cachedProfileId)) {
            setActiveProfileId(cachedProfileId);
          }
        }
      }
    } catch (err) {
      console.error('Fetch client context error:', err);
    }
  }, []);

  const fetchProfiles = useCallback(async () => {
    try {
      const res = await apiFetch('/api/profiles');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          setProfiles(data.map((p: UserProfile) => ({ ...p, password: undefined })));
        }
      }
    } catch (err) {
      console.error('Fetch profiles error:', err);
    }
  }, []);

  const fetchAuthMe = useCallback(async () => {
    if (!getAuthToken()) return;
    try {
      const res = await apiFetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        if (data.authenticated && data.user?.id) {
          setActiveProfileId(data.user.id);
          setProfiles((prev) => {
            if (prev.some((p) => p.id === data.user.id)) {
              return prev.map((p) =>
                p.id === data.user.id ? { ...p, ...data.user, password: undefined } : p
              );
            }
            return [...prev, { ...data.user, password: undefined }];
          });
        }
      }
    } catch (err) {
      console.error('Fetch auth me error:', err);
    }
  }, []);

  const handleCreateProfile = (name: string, avatar: string) => {
    const newProf: UserProfile = {
      id: 'usr_' + Date.now(),
      name,
      username: name.toLowerCase().replace(/\s+/g, '_'),
      email: `${name.toLowerCase().replace(/\s+/g, '_')}@manga.dev`,
      avatar,
      role: 'user',
      createdAt: new Date().toISOString(),
    };
    setProfiles((prev) => [...prev, newProf]);
    setActiveProfileId(newProf.id);
  };

  const handleRegisterUser = (newUser: UserProfile) => {
    setProfiles((prev) => {
      if (prev.some((p) => p.id === newUser.id)) {
        return prev.map((p) => (p.id === newUser.id ? { ...p, ...newUser, password: undefined } : p));
      }
      return [...prev, { ...newUser, password: undefined }];
    });
    setActiveProfileId(newUser.id);
    migrateClientSessionHistoryToUser(newUser.id);
  };

  const handlePromoteUser = async (userId: string, newRole: UserRole) => {
    try {
      const res = await apiFetch('/api/admin/users/promote', {
        method: 'POST',
        body: JSON.stringify({ userId, role: newRole }),
      });
      if (res.ok) {
        const data = await res.json();
        const updated = data.user as UserProfile;
        setProfiles((prev) => prev.map((p) => (p.id === userId ? { ...p, ...updated, password: undefined } : p)));
      }
    } catch (err) {
      console.error('Promote user error:', err);
    }
  };

  const handleDeleteProfile = (profileId: string) => {
    if (profiles.length <= 1) return;
    const remaining = profiles.filter((p) => p.id !== profileId);
    setProfiles(remaining);
    if (activeProfileId === profileId) {
      setActiveProfileId(remaining[0]?.id || 'usr_guest');
      clearAuthToken();
    }
  };

  const handleLoginUser = (user: UserProfile) => {
    setProfiles((prev) => {
      if (prev.some((p) => p.id === user.id)) {
        return prev.map((p) => (p.id === user.id ? { ...p, ...user, password: undefined } : p));
      }
      return [...prev, { ...user, password: undefined }];
    });
    setActiveProfileId(user.id);
    migrateClientSessionHistoryToUser(user.id);
    setAuthModalOpen(false);
  };

  return {
    profiles,
    setProfiles,
    profilesRef,
    activeProfileId,
    setActiveProfileId,
    activeProfile,
    isHostComputer,
    userProfileModalOpen,
    setUserProfileModalOpen,
    authModalOpen,
    setAuthModalOpen,
    adminPanelOpen,
    setAdminPanelOpen,
    fetchClientContext,
    fetchProfiles,
    fetchAuthMe,
    handleCreateProfile,
    handleRegisterUser,
    handleLoginUser,
    handlePromoteUser,
    handleDeleteProfile,
  };
}
