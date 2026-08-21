import React, { useState } from 'react';
import { UserProfile, UserRole, MangaItem } from '../types';
import { Shield, User, Key, Trash2, Check, Plus, X, AlertTriangle } from 'lucide-react';
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

export const AdminPanelModal: React.FC<AdminPanelModalProps> = React.memo(({
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

  // Reset password states
  const [userToResetPassword, setUserToResetPassword] = useState<UserProfile | null>(null);
  const [resetPasswordInput, setResetPasswordInput] = useState('');
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [adminNotice, setAdminNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Provision user states
  const [showProvisionModal, setShowProvisionModal] = useState(false);
  const [provName, setProvName] = useState('');
  const [provUsername, setProvUsername] = useState('');
  const [provEmail, setProvEmail] = useState('');
  const [provPassword, setProvPassword] = useState('');
  const [provRole, setProvRole] = useState<'user' | 'admin'>('user');
  const [isProvisioning, setIsProvisioning] = useState(false);

  const handleConfirmDelete = async () => {
    if (!userToDelete) return;
    setIsDeleting(true);
    try {
      const res = await apiFetch(`/api/admin/users/${userToDelete.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ confirm: true, confirmationText: confirmInput }),
      });

      if (res.ok) {
        onDeleteUser(userToDelete.id);
        setUserToDelete(null);
        setConfirmInput('');
        setAdminNotice({ type: 'success', text: `User ${userToDelete.name} was successfully deleted.` });
      } else {
        const data = await res.json();
        setAdminNotice({ type: 'error', text: data.error || 'Failed to delete user account.' });
      }
    } catch (err: any) {
      setAdminNotice({ type: 'error', text: err.message || 'Error deleting user account.' });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userToResetPassword || !resetPasswordInput || resetPasswordInput.length < 8) return;
    setIsResettingPassword(true);
    setAdminNotice(null);
    try {
      const res = await apiFetch(`/api/admin/users/${userToResetPassword.id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ newPassword: resetPasswordInput }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setAdminNotice({ type: 'success', text: data.message || `Password reset for ${userToResetPassword.name}.` });
        setUserToResetPassword(null);
        setResetPasswordInput('');
      } else {
        setAdminNotice({ type: 'error', text: data.message || data.error || 'Failed to reset password.' });
      }
    } catch (err: any) {
      setAdminNotice({ type: 'error', text: err?.message || 'Error resetting password.' });
    } finally {
      setIsResettingPassword(false);
    }
  };

  const handleProvisionUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!provName || !provUsername || !provEmail || !provPassword) return;
    setIsProvisioning(true);
    setAdminNotice(null);
    try {
      const res = await apiFetch('/api/admin/users/create', {
        method: 'POST',
        body: JSON.stringify({
          name: provName.trim(),
          username: provUsername.trim(),
          email: provEmail.trim(),
          password: provPassword,
          role: provRole,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setAdminNotice({ type: 'success', text: `Provisioned user account for ${provName} (@${provUsername}).` });
        setShowProvisionModal(false);
        setProvName('');
        setProvUsername('');
        setProvEmail('');
        setProvPassword('');
      } else {
        setAdminNotice({ type: 'error', text: data.message || data.error || 'Failed to provision user.' });
      }
    } catch (err: any) {
      setAdminNotice({ type: 'error', text: err?.message || 'Error creating user account.' });
    } finally {
      setIsProvisioning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto">
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

        {adminNotice && (
          <div
            className={`p-3 rounded-xl text-xs font-medium border flex items-center gap-2 ${
              adminNotice.type === 'success'
                ? 'bg-success/10 border-success/30 text-success'
                : 'bg-danger/10 border-danger/30 text-danger'
            }`}
          >
            {adminNotice.type === 'success' ? <Check className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
            <span>{adminNotice.text}</span>
          </div>
        )}

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
            <button
              onClick={() => setShowProvisionModal(true)}
              className="text-xs font-bold text-accent hover:text-accent-bright flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Provision User</span>
            </button>
          </div>

          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {allUsers.map((u) => (
              <div
                key={u.id}
                className="p-3.5 rounded-2xl bg-app border border-edge flex items-center justify-between gap-3 text-xs"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-2xl p-2 rounded-xl bg-surface border border-edge shrink-0">{u.avatar}</span>
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

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => onSwitchUserView(u)}
                    className="px-2.5 py-1.5 rounded-xl bg-accent/10 hover:bg-accent/20 text-accent border border-accent/30 font-bold text-xs"
                    title="Impersonate or inspect user view as Admin"
                  >
                    Inspect
                  </button>

                  <button
                    onClick={() => {
                      setUserToResetPassword(u);
                      setResetPasswordInput('');
                    }}
                    className="p-1.5 rounded-xl bg-elevated hover:bg-elevated text-secondary hover:text-primary border border-edge"
                    title="Reset Password"
                  >
                    <Key className="w-4 h-4" />
                  </button>

                  {u.id !== currentUser.id && u.id !== 'usr_admin' && u.id !== 'usr_guest' && u.role !== 'admin' && (
                    <>
                      <button
                        onClick={() => onPromoteUser(u.id, 'admin')}
                        className="px-2 py-1.5 rounded-xl bg-elevated hover:bg-elevated text-secondary text-xs font-semibold"
                      >
                        Make Admin
                      </button>

                      <button
                        onClick={() => {
                          setUserToDelete(u);
                          setConfirmInput('');
                        }}
                        className="p-1.5 rounded-xl bg-danger/10 hover:bg-danger/20 text-danger border border-danger/30"
                        title="Delete User Account"
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

        {/* RESET PASSWORD OVERLAY */}
        {userToResetPassword && (
          <div className="fixed inset-0 z-60 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <form onSubmit={handleResetPasswordSubmit} className="bg-surface border border-edge rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
              <div className="flex items-center justify-between border-b border-edge pb-3">
                <div className="flex items-center gap-2 font-black text-primary text-base">
                  <Key className="w-5 h-5 text-accent-2" />
                  <span>Reset Password</span>
                </div>
                <button type="button" onClick={() => setUserToResetPassword(null)} className="text-secondary hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <p className="text-xs text-secondary">
                Set a new password for <strong>{userToResetPassword.name}</strong> (@{userToResetPassword.username}):
              </p>

              <div className="space-y-1">
                <label className="text-xs font-bold text-secondary">New Password (min 8 chars):</label>
                <input
                  type="password"
                  value={resetPasswordInput}
                  onChange={(e) => setResetPasswordInput(e.target.value)}
                  placeholder="Enter new strong password"
                  required
                  minLength={8}
                  className="w-full p-2.5 rounded-xl bg-app border border-edge text-primary font-mono text-xs"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-edge">
                <button
                  type="button"
                  onClick={() => setUserToResetPassword(null)}
                  className="px-4 py-2 rounded-xl bg-elevated text-secondary font-bold text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isResettingPassword || resetPasswordInput.length < 8}
                  className="px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs disabled:opacity-50"
                >
                  {isResettingPassword ? 'Saving...' : 'Set Password'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* PROVISION USER OVERLAY */}
        {showProvisionModal && (
          <div className="fixed inset-0 z-60 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <form onSubmit={handleProvisionUserSubmit} className="bg-surface border border-edge rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
              <div className="flex items-center justify-between border-b border-edge pb-3">
                <div className="flex items-center gap-2 font-black text-primary text-base">
                  <User className="w-5 h-5 text-accent" />
                  <span>Provision New User</span>
                </div>
                <button type="button" onClick={() => setShowProvisionModal(false)} className="text-secondary hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="font-bold text-secondary">Display Name</label>
                    <input
                      type="text"
                      value={provName}
                      onChange={(e) => setProvName(e.target.value)}
                      placeholder="Alex Reader"
                      required
                      className="w-full p-2.5 rounded-xl bg-app border border-edge text-primary"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="font-bold text-secondary">Username</label>
                    <input
                      type="text"
                      value={provUsername}
                      onChange={(e) => setProvUsername(e.target.value)}
                      placeholder="alex_reader"
                      required
                      className="w-full p-2.5 rounded-xl bg-app border border-edge text-primary"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-secondary">Email Address</label>
                  <input
                    type="email"
                    value={provEmail}
                    onChange={(e) => setProvEmail(e.target.value)}
                    placeholder="alex@manga.dev"
                    required
                    className="w-full p-2.5 rounded-xl bg-app border border-edge text-primary"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-secondary">Password (min 8 chars)</label>
                  <input
                    type="password"
                    value={provPassword}
                    onChange={(e) => setProvPassword(e.target.value)}
                    placeholder="********"
                    required
                    minLength={8}
                    className="w-full p-2.5 rounded-xl bg-app border border-edge text-primary font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-secondary">Role</label>
                  <select
                    value={provRole}
                    onChange={(e) => setProvRole(e.target.value as any)}
                    className="w-full p-2.5 rounded-xl bg-app border border-edge text-primary font-bold"
                  >
                    <option value="user">Private User</option>
                    <option value="admin">Administrator</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-edge">
                <button
                  type="button"
                  onClick={() => setShowProvisionModal(false)}
                  className="px-4 py-2 rounded-xl bg-elevated text-secondary font-bold text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isProvisioning}
                  className="px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs disabled:opacity-50"
                >
                  {isProvisioning ? 'Creating...' : 'Create Account'}
                </button>
              </div>
            </form>
          </div>
        )}

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
});
