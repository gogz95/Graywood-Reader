import React, { useState } from 'react';
import { UserProfile, UserRole, MangaItem } from '../types';
import { Shield, User, Folder, Key, Trash2, Check, Sparkles, Database, Settings, BarChart3, X, AlertTriangle } from 'lucide-react';
import { apiFetch } from '../utils/api';

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
      const res = await apiFetch(`/api/admin/users/${userToDelete.id}`, {
        method: 'DELETE',
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
    <div className="fixed inset-0 z-50 bg-app/85 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto">
      <div className="bg-surface border border-edge rounded-t-3xl sm:rounded-3xl max-w-3xl w-full max-h-[92vh] sm:max-h-[85vh] overflow-y-auto p-4 sm:p-6 space-y-6 shadow-2xl relative my-0 sm:my-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-edge pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-accent/10 text-accent border border-accent/20">
              <Shield className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-black text-primary flex items-center gap-2">
                Host & Administrator Command Panel
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-accent text-accent-fg">
                  FULL ACCESS
                </span>
              </h2>
              <p className="text-xs text-secondary">
                Logged in as <strong>{currentUser.name}</strong> ({currentUser.email}). Manage user accounts, permissions, and system storage.
              </p>
            </div>
          </div>

          <button onClick={onClose} className="p-2 rounded-full bg-elevated text-secondary hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Global Admin Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="p-3.5 bg-app rounded-2xl border border-edge space-y-1">
            <div className="text-secondary font-bold">Total Registered Users</div>
            <div className="text-xl font-black text-accent font-mono">{allUsers.length} Users</div>
          </div>

          <div className="p-3.5 bg-app rounded-2xl border border-edge space-y-1">
            <div className="text-secondary font-bold">Administrator Count</div>
            <div className="text-xl font-black text-accent-2 font-mono">
              {allUsers.filter((u) => u.role === 'admin').length} Admins
            </div>
          </div>

          <div className="p-3.5 bg-app rounded-2xl border border-edge space-y-1">
            <div className="text-secondary font-bold">Global Database Series</div>
            <div className="text-xl font-black text-success font-mono">{mangaList.length} Series</div>
          </div>

          <div className="p-3.5 bg-app rounded-2xl border border-edge space-y-1">
            <div className="text-secondary font-bold">Privacy Enforcement</div>
            <div className="text-xl font-black text-info font-mono">Active RBAC</div>
          </div>
        </div>

        {/* User Account Management Table */}
        <div className="space-y-3">
          <div className="text-sm font-extrabold text-primary flex items-center justify-between">
            <span>User Accounts & Per-User Isolation</span>
            <span className="text-xs text-secondary font-normal">Standard users only see their own private data</span>
          </div>

          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {allUsers.map((u) => (
              <div
                key={u.id}
                className="p-3.5 rounded-2xl bg-app border border-edge flex items-center justify-between gap-3 text-xs"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-2xl p-2 rounded-xl bg-surface border border-edge">{u.avatar}</span>
                  <div className="min-w-0">
                    <div className="font-bold text-primary flex items-center gap-2 truncate">
                      <span>{u.name}</span>
                      <span className="text-secondary font-mono text-[11px]">(@{u.username})</span>
                      <span
                        className={`px-2 py-0.2 rounded text-[10px] font-bold ${
                          u.role === 'admin'
                            ? 'bg-accent-2/20 text-accent-2 border border-accent-2/30'
                            : 'bg-elevated text-secondary'
                        }`}
                      >
                        {u.role === 'admin' ? '🛡️ Administrator' : '👤 Private User'}
                      </span>
                    </div>
                    <div className="text-[11px] text-secondary font-mono truncate pt-0.5">
                      {u.email}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onSwitchUserView(u)}
                    className="px-3 py-1.5 rounded-xl bg-accent/10 hover:bg-accent/20 text-accent border border-accent/30 font-bold text-xs"
                    title="Impersonate or inspect user view as Admin"
                  >
                    Inspect View
                  </button>

                  {u.id !== currentUser.id && u.id !== 'usr_admin' && u.id !== 'usr_guest' && u.role !== 'admin' && (
                    <>
                      <button
                        onClick={() => onPromoteUser(u.id, 'admin')}
                        className="px-2.5 py-1.5 rounded-xl bg-elevated hover:bg-elevated text-secondary text-xs font-semibold"
                      >
                        Make Admin
                      </button>

                      <button
                        onClick={() => {
                          setUserToDelete(u);
                          setConfirmInput('');
                        }}
                        className="p-2 rounded-xl bg-danger/10 hover:bg-danger/20 text-danger border border-danger/30"
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
          <div className="fixed inset-0 z-60 bg-app/90 backdrop-blur-md flex items-center justify-center p-4">
            <div className="bg-surface border border-danger/40 rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
              <div className="flex items-center gap-3 text-danger border-b border-edge pb-3">
                <div className="p-2.5 rounded-2xl bg-danger/10 border border-danger/20">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-black text-primary">Confirm Permanent User Deletion</h3>
                  <p className="text-xs text-danger font-semibold">This action cannot be undone!</p>
                </div>
              </div>

              <div className="p-3 bg-app rounded-2xl border border-edge space-y-1 text-xs">
                <div className="flex items-center gap-2 font-bold text-primary">
                  <span className="text-xl">{userToDelete.avatar}</span>
                  <span>{userToDelete.name} (@{userToDelete.username})</span>
                </div>
                <div className="text-secondary font-mono text-[11px]">{userToDelete.email}</div>
              </div>

              <p className="text-xs text-secondary">
                Are you sure you want to permanently purge user account <strong>{userToDelete.name}</strong> and all associated library data?
              </p>

              <div className="space-y-1 text-xs">
                <label className="font-bold text-secondary block">
                  To confirm, type <span className="font-mono text-danger bg-danger/10 px-1.5 py-0.5 rounded border border-danger/20">{userToDelete.username}</span> below:
                </label>
                <input
                  type="text"
                  value={confirmInput}
                  onChange={(e) => setConfirmInput(e.target.value)}
                  placeholder={`Type '${userToDelete.username}' to enable delete`}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-app border border-edge text-primary placeholder-muted focus:outline-none focus:border-danger font-mono"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-edge text-xs">
                <button
                  onClick={() => setUserToDelete(null)}
                  className="px-4 py-2 rounded-xl bg-elevated hover:bg-elevated text-secondary font-bold"
                >
                  Cancel
                </button>

                <button
                  onClick={handleConfirmDelete}
                  disabled={confirmInput.trim() !== userToDelete.username || isDeleting}
                  className="px-4 py-2 rounded-xl bg-danger hover:bg-danger text-white font-black flex items-center gap-2 transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Trash2 className="w-4 h-4" />
                  {isDeleting ? 'Purging Account...' : 'Permanently Delete User'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-edge pt-4">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-elevated hover:bg-elevated text-primary font-bold text-xs"
          >
            Close Admin Panel
          </button>
        </div>
      </div>
    </div>
  );
};

