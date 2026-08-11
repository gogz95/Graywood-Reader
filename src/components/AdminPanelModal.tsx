import React, { useState } from 'react';
import { UserProfile, UserRole, MangaItem } from '../types';
import { Shield, User, Folder, Key, Trash2, Check, Sparkles, Database, Settings, BarChart3, X, AlertTriangle } from 'lucide-react';

interface AdminPanelModalProps {
  currentUser: UserProfile;
  allUsers: UserProfile[];
  mangaList: MangaItem[];
  onPromoteUser: (userId: string, newRole: UserRole) => void;
  onDeleteUser: (userId: string) => void;
  onSwitchUserView: (user: UserProfile) => void;
  onClose: () => void;
}

export const AdminPanelModal: React.FC<AdminPanelModalProps> = ({
  currentUser,
  allUsers,
  mangaList,
  onPromoteUser,
  onDeleteUser,
  onSwitchUserView,
  onClose,
}) => {
  const [userToDelete, setUserToDelete] = useState<UserProfile | null>(null);
  const [confirmInput, setConfirmInput] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const handleConfirmDelete = async () => {
    if (!userToDelete) return;
    setIsDeleting(true);
    try {
      // Call API endpoint with mandatory confirmation payload
      const res = await fetch(`/api/admin/users/${userToDelete.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true, confirmationText: confirmInput }),
      });

      if (res.ok) {
        onDeleteUser(userToDelete.id);
        setUserToDelete(null);
        setConfirmInput('');
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to delete user account.');
      }
    } catch (err: any) {
      alert(err.message || 'Error deleting user account.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-3xl max-w-3xl w-full max-h-[92vh] sm:max-h-[85vh] overflow-y-auto p-4 sm:p-6 space-y-6 shadow-2xl relative my-0 sm:my-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Shield className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-100 flex items-center gap-2">
                Host & Administrator Command Panel
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-500 text-slate-950">
                  FULL ACCESS
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Logged in as <strong>{currentUser.name}</strong> ({currentUser.email}). Manage user accounts, permissions, and system storage.
              </p>
            </div>
          </div>

          <button onClick={onClose} className="p-2 rounded-full bg-slate-800 text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Global Admin Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="p-3.5 bg-slate-950 rounded-2xl border border-slate-800 space-y-1">
            <div className="text-slate-400 font-bold">Total Registered Users</div>
            <div className="text-xl font-black text-amber-400 font-mono">{allUsers.length} Users</div>
          </div>

          <div className="p-3.5 bg-slate-950 rounded-2xl border border-slate-800 space-y-1">
            <div className="text-slate-400 font-bold">Administrator Count</div>
            <div className="text-xl font-black text-purple-400 font-mono">
              {allUsers.filter((u) => u.role === 'admin').length} Admins
            </div>
          </div>

          <div className="p-3.5 bg-slate-950 rounded-2xl border border-slate-800 space-y-1">
            <div className="text-slate-400 font-bold">Global Database Series</div>
            <div className="text-xl font-black text-emerald-400 font-mono">{mangaList.length} Series</div>
          </div>

          <div className="p-3.5 bg-slate-950 rounded-2xl border border-slate-800 space-y-1">
            <div className="text-slate-400 font-bold">Privacy Enforcement</div>
            <div className="text-xl font-black text-cyan-400 font-mono">Active RBAC</div>
          </div>
        </div>

        {/* User Account Management Table */}
        <div className="space-y-3">
          <div className="text-sm font-extrabold text-slate-200 flex items-center justify-between">
            <span>User Accounts & Per-User Isolation</span>
            <span className="text-xs text-slate-400 font-normal">Standard users only see their own private data</span>
          </div>

          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {allUsers.map((u) => (
              <div
                key={u.id}
                className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-3 text-xs"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-2xl p-2 rounded-xl bg-slate-900 border border-slate-800">{u.avatar}</span>
                  <div className="min-w-0">
                    <div className="font-bold text-slate-100 flex items-center gap-2 truncate">
                      <span>{u.name}</span>
                      <span className="text-slate-400 font-mono text-[11px]">(@{u.username})</span>
                      <span
                        className={`px-2 py-0.2 rounded text-[10px] font-bold ${
                          u.role === 'admin'
                            ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {u.role === 'admin' ? '🛡️ Administrator' : '👤 Private User'}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono truncate pt-0.5">
                      {u.email}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onSwitchUserView(u)}
                    className="px-3 py-1.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold text-xs"
                    title="Impersonate or inspect user view as Admin"
                  >
                    Inspect View
                  </button>

                  {u.id !== currentUser.id && u.id !== 'usr_admin' && u.id !== 'usr_guest' && u.role !== 'admin' && (
                    <>
                      <button
                        onClick={() => onPromoteUser(u.id, 'admin')}
                        className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
                      >
                        Make Admin
                      </button>

                      <button
                        onClick={() => {
                          setUserToDelete(u);
                          setConfirmInput('');
                        }}
                        className="p-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30"
                        title="Delete User Account (Requires Confirmation)"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* DOUBLE CONFIRMATION MODAL OVERLAY */}
        {userToDelete && (
          <div className="fixed inset-0 z-60 bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-red-500/40 rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
              <div className="flex items-center gap-3 text-red-400 border-b border-slate-800 pb-3">
                <div className="p-2.5 rounded-2xl bg-red-500/10 border border-red-500/20">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-100">Confirm Permanent User Deletion</h3>
                  <p className="text-xs text-red-400 font-semibold">This action cannot be undone!</p>
                </div>
              </div>

              <div className="p-3 bg-slate-950 rounded-2xl border border-slate-800 space-y-1 text-xs">
                <div className="flex items-center gap-2 font-bold text-slate-100">
                  <span className="text-xl">{userToDelete.avatar}</span>
                  <span>{userToDelete.name} (@{userToDelete.username})</span>
                </div>
                <div className="text-slate-400 font-mono text-[11px]">{userToDelete.email}</div>
              </div>

              <p className="text-xs text-slate-300">
                Are you sure you want to permanently purge user account <strong>{userToDelete.name}</strong> and all associated library data?
              </p>

              <div className="space-y-1 text-xs">
                <label className="font-bold text-slate-300 block">
                  To confirm, type <span className="font-mono text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded border border-red-500/20">{userToDelete.username}</span> below:
                </label>
                <input
                  type="text"
                  value={confirmInput}
                  onChange={(e) => setConfirmInput(e.target.value)}
                  placeholder={`Type '${userToDelete.username}' to enable delete`}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-red-500 font-mono"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800 text-xs">
                <button
                  onClick={() => setUserToDelete(null)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold"
                >
                  Cancel
                </button>

                <button
                  onClick={handleConfirmDelete}
                  disabled={confirmInput.trim() !== userToDelete.username || isDeleting}
                  className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-black flex items-center gap-2 transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Trash2 className="w-4 h-4" />
                  {isDeleting ? 'Purging Account...' : 'Permanently Delete User'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-slate-800 pt-4">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs"
          >
            Close Admin Panel
          </button>
        </div>
      </div>
    </div>
  );
};

