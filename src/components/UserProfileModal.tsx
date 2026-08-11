import React, { useState } from 'react';
import { UserProfile } from '../types';
import { X, User, Plus, Trash2 } from 'lucide-react';

interface UserProfileModalProps {
  profiles: UserProfile[];
  activeProfileId: string;
  isHostComputer?: boolean;
  onSelectProfile: (profileId: string) => void;
  onCreateProfile: (name: string, avatar: string) => void;
  onDeleteProfile: (profileId: string) => void;
  onClose: () => void;
}

export const UserProfileModal: React.FC<UserProfileModalProps> = ({
  profiles,
  activeProfileId,
  isHostComputer = true,
  onSelectProfile,
  onCreateProfile,
  onDeleteProfile,
  onClose,
}) => {
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAvatar, setNewAvatar] = useState('🥷');

  const avatarOptions = ['🥷', '🦸‍♂️', '🧙‍♂️', '🦊', '🐉', '⚡', '👑', '🔥', '⚔️', '🤖'];

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    onCreateProfile(newName, newAvatar);
    setNewName('');
    setIsCreating(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-app/85 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto">
      <div className="bg-surface border border-edge rounded-t-3xl sm:rounded-2xl max-w-xl w-full max-h-[92vh] sm:max-h-[85vh] overflow-y-auto p-4 sm:p-6 space-y-6 shadow-2xl my-0 sm:my-auto">
        <div className="flex items-center justify-between border-b border-edge pb-3">
          <div className="font-black text-primary text-base flex items-center gap-2">
            <User className="w-5 h-5 text-accent" />
            Individual User Profiles
          </div>
          <button onClick={onClose} className="text-secondary hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* User Profiles Grid */}
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs font-extrabold text-primary">
            <span>Select Active User Profile</span>
            <button
              onClick={() => setIsCreating(!isCreating)}
              className="text-accent hover:text-accent flex items-center gap-1 text-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add New User</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {profiles.map((profile) => {
              const isActive = profile.id === activeProfileId;
              return (
                <div
                  key={profile.id}
                  onClick={() => {
                    if (profile.role === 'admin' && !isHostComputer) {
                      alert('Admin profile functionality is strictly restricted to the Host Computer.');
                      return;
                    }
                    onSelectProfile(profile.id);
                  }}
                  className={`p-4 rounded-2xl border cursor-pointer transition-all flex flex-col justify-between gap-3 ${
                    isActive
                      ? 'bg-accent/10 border-accent/50 shadow-lg ring-1 ring-accent/30'
                      : 'bg-app border-edge hover:border-edge-strong'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl p-2 rounded-xl bg-surface border border-edge shadow-md">
                        {profile.avatar}
                      </span>
                      <div>
                        <div className="font-bold text-primary text-sm flex items-center gap-1.5">
                          {profile.name}
                          {isActive && (
                            <span className="px-1.5 py-0.2 rounded text-[10px] bg-accent text-accent-fg font-black">
                              Active
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-end border-t border-edge/80 pt-2 text-xs">
                    {profiles.length > 1 && profile.id !== 'usr_admin' && profile.id !== 'usr_guest' && profile.role !== 'admin' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteProfile(profile.id);
                        }}
                        className="text-[11px] text-danger hover:text-danger p-1"
                        title="Delete user profile"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Create User Form */}
        {isCreating && (
          <form onSubmit={handleCreate} className="p-4 bg-app rounded-2xl border border-accent/30 space-y-4 text-xs">
            <div className="font-bold text-primary text-sm flex items-center gap-2">
              <Plus className="w-4 h-4 text-accent" />
              Create New Individual User Profile
            </div>

            <div className="space-y-2">
              <label className="font-bold text-secondary">Choose Avatar Icon:</label>
              <div className="flex flex-wrap gap-2">
                {avatarOptions.map((av) => (
                  <button
                    key={av}
                    type="button"
                    onClick={() => setNewAvatar(av)}
                    className={`p-2 text-xl rounded-xl border transition-all ${
                      newAvatar === av
                        ? 'border-accent bg-accent/20 shadow-md'
                        : 'border-edge bg-surface hover:bg-elevated'
                    }`}
                  >
                    {av}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="font-bold text-secondary">User Profile Name:</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Alex, Jordan, Guest..."
                required
                className="w-full bg-surface border border-edge rounded-xl p-2.5 text-primary"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsCreating(false)}
                className="px-3 py-1.5 rounded-xl bg-elevated text-secondary hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 rounded-xl bg-accent hover:bg-accent-bright text-accent-fg font-bold shadow-md"
              >
                Save Profile
              </button>
            </div>
          </form>
        )}

        {/* Footer Actions */}
        <div className="flex items-center justify-end border-t border-edge pt-4">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-elevated hover:bg-elevated text-primary font-bold text-xs"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
