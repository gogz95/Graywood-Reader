import React, { useState } from 'react';
import { UserProfile } from '../types';
import { X, User, Plus, Check, Folder, Sparkles, Trash2, Edit2, Shield } from 'lucide-react';

interface UserProfileModalProps {
  profiles: UserProfile[];
  activeProfileId: string;
  onSelectProfile: (profileId: string) => void;
  onCreateProfile: (name: string, avatar: string, storageFolderPath: string) => void;
  onUpdateProfileFolder: (profileId: string, folderPath: string) => void;
  onDeleteProfile: (profileId: string) => void;
  onClose: () => void;
}

export const UserProfileModal: React.FC<UserProfileModalProps> = ({
  profiles,
  activeProfileId,
  onSelectProfile,
  onCreateProfile,
  onUpdateProfileFolder,
  onDeleteProfile,
  onClose,
}) => {
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAvatar, setNewAvatar] = useState('🥷');
  const [newFolderPath, setNewFolderPath] = useState('C:\\Users\\Default\\MangaStorage');

  const avatarOptions = ['🥷', '🦸‍♂️', '🧙‍♂️', '🦊', '🐉', '⚡', '👑', '🔥', '⚔️', '🤖'];

  // Native HTML5 File System Access API directory picker
  const handleBrowseFolder = async (forProfileId?: string) => {
    try {
      if ('showDirectoryPicker' in window) {
        const dirHandle = await (window as any).showDirectoryPicker();
        const selectedPath = `C:\\Users\\LocalMangaStorage\\${dirHandle.name}`;
        if (forProfileId) {
          onUpdateProfileFolder(forProfileId, selectedPath);
        } else {
          setNewFolderPath(selectedPath);
        }
      } else {
        const customPath = prompt('Enter or paste local storage folder path:', forProfileId ? profiles.find(p=>p.id===forProfileId)?.storageFolderPath : newFolderPath);
        if (customPath) {
          if (forProfileId) {
            onUpdateProfileFolder(forProfileId, customPath);
          } else {
            setNewFolderPath(customPath);
          }
        }
      }
    } catch (err) {
      console.log('Folder selection cancelled or unsupported:', err);
    }
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    onCreateProfile(newName, newAvatar, newFolderPath);
    setNewName('');
    setIsCreating(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full p-6 space-y-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="font-black text-slate-100 text-base flex items-center gap-2">
            <User className="w-5 h-5 text-amber-400" />
            Individual User Profiles & Per-User Folder Storage
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* User Profiles Grid */}
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs font-extrabold text-slate-200">
            <span>Select Active User Profile</span>
            <button
              onClick={() => setIsCreating(!isCreating)}
              className="text-amber-400 hover:text-amber-300 flex items-center gap-1 text-xs"
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
                  onClick={() => onSelectProfile(profile.id)}
                  className={`p-4 rounded-2xl border cursor-pointer transition-all flex flex-col justify-between gap-3 ${
                    isActive
                      ? 'bg-amber-500/10 border-amber-500/50 shadow-lg ring-1 ring-amber-500/30'
                      : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl p-2 rounded-xl bg-slate-900 border border-slate-800 shadow-md">
                        {profile.avatar}
                      </span>
                      <div>
                        <div className="font-bold text-slate-100 text-sm flex items-center gap-1.5">
                          {profile.name}
                          {isActive && (
                            <span className="px-1.5 py-0.2 rounded text-[10px] bg-amber-500 text-slate-950 font-black">
                              Active
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400 flex items-center gap-1 pt-0.5">
                          <Folder className="w-3 h-3 text-amber-400" />
                          <span className="truncate max-w-[140px] font-mono">{profile.storageFolderPath}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between border-t border-slate-800/80 pt-2 text-xs">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleBrowseFolder(profile.id);
                      }}
                      className="text-[11px] font-bold text-amber-400 hover:text-amber-300 flex items-center gap-1"
                    >
                      <Folder className="w-3 h-3" />
                      <span>Change Folder</span>
                    </button>

                    {profiles.length > 1 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteProfile(profile.id);
                        }}
                        className="text-[11px] text-red-400 hover:text-red-300 p-1"
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
          <form onSubmit={handleCreate} className="p-4 bg-slate-950 rounded-2xl border border-amber-500/30 space-y-4 text-xs">
            <div className="font-bold text-slate-100 text-sm flex items-center gap-2">
              <Plus className="w-4 h-4 text-amber-400" />
              Create New Individual User Profile
            </div>

            <div className="space-y-2">
              <label className="font-bold text-slate-300">Choose Avatar Icon:</label>
              <div className="flex flex-wrap gap-2">
                {avatarOptions.map((av) => (
                  <button
                    key={av}
                    type="button"
                    onClick={() => setNewAvatar(av)}
                    className={`p-2 text-xl rounded-xl border transition-all ${
                      newAvatar === av
                        ? 'border-amber-500 bg-amber-500/20 shadow-md'
                        : 'border-slate-800 bg-slate-900 hover:bg-slate-800'
                    }`}
                  >
                    {av}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="font-bold text-slate-300">User Profile Name:</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Alex, Jordan, Guest..."
                required
                className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-slate-200"
              />
            </div>

            <div className="space-y-1.5">
              <label className="font-bold text-slate-300">Self-Selected Local Storage Directory:</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newFolderPath}
                  onChange={(e) => setNewFolderPath(e.target.value)}
                  className="flex-1 bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-slate-200 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() => handleBrowseFolder()}
                  className="px-3 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs flex items-center gap-1.5"
                >
                  <Folder className="w-4 h-4 text-amber-400" />
                  <span>Browse...</span>
                </button>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsCreating(false)}
                className="px-3 py-1.5 rounded-xl bg-slate-800 text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold shadow-md"
              >
                Save Profile
              </button>
            </div>
          </form>
        )}

        {/* Footer Actions */}
        <div className="flex items-center justify-end border-t border-slate-800 pt-4">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
