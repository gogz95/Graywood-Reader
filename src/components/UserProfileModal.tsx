import React, { useState } from 'react';
import { UserProfile } from '../types';
import { X, User, Plus, Trash2, Key, Check, LogIn, LogOut, Shield, Settings, Mail, Sparkles } from 'lucide-react';
import { apiFetch } from '../utils/api';

interface UserProfileModalProps {
  profiles: UserProfile[];
  activeProfileId: string;
  isHostComputer?: boolean;
  onSelectProfile: (profileId: string) => void;
  onOpenAuthModal: (mode?: 'login' | 'register') => void;
  onUpdateProfile: (updates: { name?: string; avatar?: string; email?: string }) => Promise<boolean>;
  onLogout: () => void;
  onDeleteProfile: (profileId: string) => void;
  onClose: () => void;
}

export const UserProfileModal: React.FC<UserProfileModalProps> = React.memo(({
  profiles,
  activeProfileId,
  isHostComputer = true,
  onSelectProfile,
  onOpenAuthModal,
  onUpdateProfile,
  onLogout,
  onDeleteProfile,
  onClose,
}) => {
  const [tab, setTab] = useState<'profiles' | 'settings'>('profiles');
  const activeProfile = profiles.find((p) => p.id === activeProfileId) || profiles[0];

  // Only show the active user in the switch active reader
  const visibleProfiles = React.useMemo(() => {
    return activeProfile ? [activeProfile] : [];
  }, [activeProfile]);

  // Settings tab form states
  const [editName, setEditName] = useState(activeProfile?.name || '');
  const [editAvatar, setEditAvatar] = useState(activeProfile?.avatar || '🥷');
  const [editEmail, setEditEmail] = useState(activeProfile?.email || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const avatarOptions = ['🥷', '🦸‍♂️', '🧙‍♂️', '🦊', '🐉', '⚡', '👑', '🔥', '⚔️', '🤖', '👤', '🛡️', '🌙', '🌟'];

  const handleSaveProfileDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMsg(null);
    setSavingProfile(true);
    try {
      const ok = await onUpdateProfile({
        name: editName.trim(),
        avatar: editAvatar,
        email: editEmail.trim() || undefined,
      });
      if (ok) {
        setStatusMsg({ type: 'success', text: 'Profile details saved successfully!' });
      } else {
        setStatusMsg({ type: 'error', text: 'Failed to update profile details.' });
      }
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || 'Failed to update profile.' });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMsg(null);
    if (!newPassword || newPassword.length < 8) {
      setStatusMsg({ type: 'error', text: 'New password must be at least 8 characters long.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setStatusMsg({ type: 'error', text: 'New passwords do not match.' });
      return;
    }

    setChangingPassword(true);
    try {
      const res = await apiFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setStatusMsg({ type: 'success', text: 'Password successfully changed!' });
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        setStatusMsg({ type: 'error', text: data.message || data.error || 'Failed to change password.' });
      }
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || 'Error changing password.' });
    } finally {
      setChangingPassword(false);
    }
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
    >
      <div className="bg-surface border border-edge rounded-t-3xl sm:rounded-3xl max-w-xl w-full max-h-[92vh] sm:max-h-[85vh] overflow-y-auto p-4 sm:p-6 space-y-5 shadow-2xl my-0 sm:my-auto relative">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-edge pb-3">
          <div className="flex items-center gap-2 font-black text-primary text-base">
            <User className="w-5 h-5 text-accent" />
            <span>User Profiles & Account</span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full bg-elevated text-secondary hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex rounded-xl bg-app border border-edge p-1 gap-1">
          <button
            type="button"
            onClick={() => { setTab('profiles'); setStatusMsg(null); }}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 ${
              tab === 'profiles' ? 'bg-accent text-accent-fg shadow-sm' : 'text-secondary hover:text-primary'
            }`}
          >
            <User className="w-3.5 h-3.5" />
            <span>Select Profile ({visibleProfiles.length})</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('settings');
              setStatusMsg(null);
              setEditName(activeProfile?.name || '');
              setEditAvatar(activeProfile?.avatar || '🥷');
              setEditEmail(activeProfile?.email || '');
            }}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 ${
              tab === 'settings' ? 'bg-accent text-accent-fg shadow-sm' : 'text-secondary hover:text-primary'
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Account Settings</span>
          </button>
        </div>

        {statusMsg && (
          <div
            className={`p-3 rounded-xl text-xs font-medium border flex items-center gap-2 ${
              statusMsg.type === 'success'
                ? 'bg-success/10 border-success/30 text-success'
                : 'bg-danger/10 border-danger/30 text-danger'
            }`}
          >
            {statusMsg.type === 'success' ? <Check className="w-4 h-4 shrink-0" /> : <X className="w-4 h-4 shrink-0" />}
            <span>{statusMsg.text}</span>
          </div>
        )}

        {/* Tab 1: Profiles List */}
        {tab === 'profiles' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-xs font-extrabold text-primary">
              <span>Switch Active Reader</span>
              <button
                onClick={() => {
                  onClose();
                  onOpenAuthModal('register');
                }}
                className="text-accent hover:text-accent-bright flex items-center gap-1 text-xs font-bold"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Register New Account</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-72 overflow-y-auto pr-1">
              {visibleProfiles.map((profile) => {
                const isActive = profile.id === activeProfileId;
                return (
                  <div
                    key={profile.id}
                    onClick={() => {
                      if (profile.role === 'admin' && !isHostComputer) {
                        alert('Admin profile access is strictly restricted to the host computer.');
                        return;
                      }
                      onSelectProfile(profile.id);
                    }}
                    className={`p-3.5 rounded-2xl border cursor-pointer transition flex flex-col justify-between gap-2.5 ${
                      isActive
                        ? 'bg-accent/10 border-accent shadow-md ring-1 ring-accent/30'
                        : 'bg-app border-edge hover:border-edge-strong'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="text-2xl p-1.5 rounded-xl bg-surface border border-edge shrink-0">
                          {profile.avatar}
                        </span>
                        <div className="min-w-0">
                          <div className="font-bold text-primary text-xs flex items-center gap-1.5 truncate">
                            <span className="truncate">{profile.name}</span>
                            {isActive && (
                              <span className="px-1.5 py-0.2 rounded text-[9px] bg-accent text-accent-fg font-black">
                                ACTIVE
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-secondary font-mono truncate">
                            @{profile.username || profile.id}
                          </div>
                        </div>
                      </div>

                      <span
                        className={`text-[9px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${
                          profile.role === 'admin'
                            ? 'bg-accent-2/15 text-accent-2 border-accent-2/30'
                            : 'bg-elevated text-secondary border-edge'
                        }`}
                      >
                        {profile.role === 'admin' ? '🛡️ Admin' : '👤 User'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between border-t border-edge/60 pt-2 text-[11px]">
                      <span className="text-muted text-[10px] truncate">
                        {profile.email ? profile.email : 'Personal Library'}
                      </span>

                      {visibleProfiles.length > 1 &&
                        profile.id !== 'usr_admin' &&
                        profile.id !== 'usr_guest' &&
                        profile.role !== 'admin' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm(`Remove profile for ${profile.name}?`)) {
                                onDeleteProfile(profile.id);
                              }
                            }}
                            className="text-danger hover:text-danger-bright p-1"
                            title="Delete profile"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Quick Actions Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-edge text-xs">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenAuthModal('login');
                  }}
                  className="px-3 py-2 rounded-xl bg-elevated hover:bg-elevated/80 text-primary font-bold flex items-center gap-1.5 transition"
                >
                  <LogIn className="w-3.5 h-3.5 text-accent" />
                  <span>Sign In with Password</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onLogout();
                    onClose();
                  }}
                  className="px-3 py-2 rounded-xl bg-elevated hover:bg-elevated/80 text-secondary hover:text-danger font-bold flex items-center gap-1.5 transition"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Switch to Guest</span>
                </button>
              </div>

              <button
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold"
              >
                Done
              </button>
            </div>
          </div>
        )}

        {/* Tab 2: Account Settings */}
        {tab === 'settings' && (
          <div className="space-y-5 text-xs">
            {/* Profile Info Form */}
            <form onSubmit={handleSaveProfileDetails} className="space-y-3 bg-app p-4 rounded-2xl border border-edge">
              <div className="font-bold text-primary text-sm flex items-center gap-1.5 pb-1">
                <User className="w-4 h-4 text-accent" />
                <span>Profile Details for {activeProfile.name}</span>
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-secondary">Choose Avatar:</label>
                <div className="flex flex-wrap gap-1.5">
                  {avatarOptions.map((av) => (
                    <button
                      key={av}
                      type="button"
                      onClick={() => setEditAvatar(av)}
                      className={`p-1.5 text-lg rounded-xl border transition ${
                        editAvatar === av ? 'border-accent bg-accent/20 scale-110 shadow-sm' : 'border-edge bg-surface'
                      }`}
                    >
                      {av}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-secondary">Display Name:</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    required
                    className="w-full bg-surface border border-edge rounded-xl p-2 text-primary"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-bold text-secondary">Email Address:</label>
                  <input
                    type="email"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    placeholder="user@example.com"
                    className="w-full bg-surface border border-edge rounded-xl p-2 text-primary"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  disabled={savingProfile}
                  className="px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold shadow transition disabled:opacity-50"
                >
                  {savingProfile ? 'Saving...' : 'Save Profile Details'}
                </button>
              </div>
            </form>

            {/* Change Password Form */}
            <form onSubmit={handleChangePassword} className="space-y-3 bg-app p-4 rounded-2xl border border-edge">
              <div className="font-bold text-primary text-sm flex items-center gap-1.5 pb-1">
                <Key className="w-4 h-4 text-accent-2" />
                <span>Change Password</span>
              </div>

              <div className="space-y-2">
                <div className="space-y-1">
                  <label className="font-bold text-secondary">Current Password:</label>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter current password"
                    className="w-full bg-surface border border-edge rounded-xl p-2 text-primary font-mono text-xs"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="font-bold text-secondary">New Password (min 8):</label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="At least 8 characters"
                      required
                      minLength={8}
                      className="w-full bg-surface border border-edge rounded-xl p-2 text-primary font-mono text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="font-bold text-secondary">Confirm New Password:</label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Repeat new password"
                      required
                      minLength={8}
                      className="w-full bg-surface border border-edge rounded-xl p-2 text-primary font-mono text-xs"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  disabled={changingPassword}
                  className="px-4 py-2 rounded-xl bg-accent-2 text-accent-fg font-bold shadow transition disabled:opacity-50"
                >
                  {changingPassword ? 'Updating Password...' : 'Update Password'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
});
