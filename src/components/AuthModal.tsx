import React, { useState } from 'react';
import { UserProfile } from '../types';
import { User, Lock, Mail, UserPlus, LogIn, X, Eye, EyeOff, UserCheck } from 'lucide-react';
import { apiFetch, setAuthToken, clearAuthToken, logout } from '../utils/api';

interface AuthModalProps {
  onLogin: (user: UserProfile) => void;
  onRegister: (newUser: UserProfile) => void;
  existingUsers: UserProfile[];
  onClose: () => void;
  guestProfile?: UserProfile;
}

export const AuthModal: React.FC<AuthModalProps> = React.memo(({
  onLogin,
  onRegister,
  existingUsers,
  onClose,
  guestProfile,
}) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [busy, setBusy] = useState(false);
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [regName, setRegName] = useState('');
  const [regUsername, setRegUsername] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [regAvatar, setRegAvatar] = useState('\uD83E\uDD77');
  const [regError, setRegError] = useState<string | null>(null);
  const avatarOptions = ['\uD83E\uDD77', '\uD83E\uDD8A', '\uD83E\uDDB8\u200D\u2642\uFE0F', '\uD83E\uDDD9\u200D\u2642\uFE0F', '\uD83D\uDC09', '\u26A1', '\uD83D\uDC51', '\uD83D\uDD25', '\u2694\uFE0F', '\uD83E\uDD16'];

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setBusy(true);
    try {
      const res = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: loginIdentifier.trim(), password: loginPassword }),
      });
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) {
        setLoginError(String(data.message || data.error || 'Invalid credentials.'));
        return;
      }
      if (typeof data.token === 'string') setAuthToken(data.token);
      onLogin(data.user as UserProfile);
      onClose();
    } catch (err: unknown) {
      setLoginError(err instanceof Error ? err.message : 'Login failed. Is the server running?');
    } finally {
      setBusy(false);
    }
  };

  const handleGuestQuickSignIn = () => {
    // Revoke any previous session token server-side before dropping to guest.
    void logout();
    clearAuthToken();
    const guest: UserProfile =
      guestProfile ||
      existingUsers.find((u) => u.id === 'usr_guest') || {
        id: 'usr_guest',
        name: 'Guest Reader',
        username: 'guest',
        email: 'guest@graywood.app',
        avatar: '\uD83D\uDC64',
        role: 'user',
        createdAt: new Date().toISOString(),
      };
    onLogin(guest);
    onClose();
  };

  const handleRegisterDirectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegError(null);
    if (!regName.trim() || !regUsername.trim() || !regEmail.trim() || !regPassword) return;
    if (regPassword.length < 8) {
      setRegError('Password must be at least 8 characters.');
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: regName.trim(),
          username: regUsername.trim(),
          email: regEmail.trim(),
          password: regPassword,
          avatar: regAvatar,
        }),
      });
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) {
        setRegError(String(data.message || data.error || 'Registration failed.'));
        return;
      }
      if (typeof data.token === 'string') setAuthToken(data.token);
      const user = data.user as UserProfile;
      onRegister(user);
      onLogin(user);
      onClose();
    } catch (err: unknown) {
      setRegError(err instanceof Error ? err.message : 'Registration failed. Is the server running?');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
    >
      <div className="bg-surface border border-edge rounded-t-3xl sm:rounded-3xl max-w-md w-full max-h-[92vh] sm:max-h-[85vh] overflow-y-auto shadow-2xl flex flex-col my-0 sm:my-auto relative">
        <button type="button" onClick={onClose} title="Close Auth Portal" className="absolute top-4 right-4 p-2 rounded-full bg-elevated text-secondary hover:text-primary z-10">
          <X className="w-4 h-4" />
        </button>
        <div className="p-6 sm:p-8 space-y-6">
          <div className="space-y-1 pr-8">
            <h2 className="text-xl font-black text-primary">{mode === 'login' ? 'Sign In' : 'Create Account'}</h2>
            <p className="text-xs text-secondary">
              {mode === 'login'
                ? 'Verify with your password. Tokens are stored only on this device.'
                : 'Passwords are hashed on the server (scrypt). Never stored in plain text.'}
            </p>
          </div>
          <div className="flex rounded-xl bg-app border border-edge p-1 gap-1">
            <button type="button" onClick={() => setMode('login')} className={`flex-1 py-2 sm:py-2.5 rounded-lg text-xs sm:text-sm font-bold transition-all ${mode === 'login' ? 'bg-accent text-accent-fg' : 'text-secondary hover:text-primary'}`}>
              <span className="inline-flex items-center gap-1.5 justify-center"><LogIn className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> Sign In</span>
            </button>
            <button type="button" onClick={() => setMode('register')} className={`flex-1 py-2 sm:py-2.5 rounded-lg text-xs sm:text-sm font-bold transition-all ${mode === 'register' ? 'bg-accent text-accent-fg' : 'text-secondary hover:text-primary'}`}>
              <span className="inline-flex items-center gap-1.5 justify-center"><UserPlus className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> Register</span>
            </button>
          </div>
          {mode === 'login' ? (
            <form onSubmit={handleLoginSubmit} className="space-y-4 text-xs">
              {loginError && <div className="px-3 py-2 rounded-xl bg-danger/10 border border-danger/30 text-danger text-[11px] font-medium">{loginError}</div>}
              <div className="space-y-1">
                <label className="font-bold text-secondary flex items-center gap-1.5"><User className="w-3.5 h-3.5" /> Username or Email</label>
                <input type="text" value={loginIdentifier} onChange={(e) => setLoginIdentifier(e.target.value)} autoComplete="username" required className="w-full bg-app border border-edge rounded-xl p-2.5 text-primary text-xs" placeholder="alex_reader" />
              </div>
              <div className="space-y-1">
                <label className="font-bold text-secondary flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" /> Password</label>
                <div className="relative">
                  <input type={showLoginPassword ? 'text' : 'password'} value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} autoComplete="current-password" required className="w-full bg-app border border-edge rounded-xl p-2.5 pr-10 text-primary text-xs" placeholder="********" />
                  <button type="button" onClick={() => setShowLoginPassword(!showLoginPassword)} className="absolute right-3 top-2.5 text-muted hover:text-secondary">{showLoginPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
                </div>
              </div>
              <button type="submit" disabled={busy} className="w-full py-3 sm:py-3.5 rounded-xl bg-gradient-to-r from-accent to-accent-bright text-accent-fg font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg disabled:opacity-60">
                <LogIn className="w-4 h-4 sm:w-5 sm:h-5" />{busy ? 'Signing in...' : 'Sign In'}
              </button>
              <button type="button" onClick={handleGuestQuickSignIn} className="w-full py-2.5 sm:py-3 rounded-xl bg-elevated border border-edge text-secondary hover:text-primary font-bold text-xs sm:text-sm flex items-center justify-center gap-2">
                <UserCheck className="w-4 h-4 sm:w-5 sm:h-5" />Continue as Guest
              </button>
            </form>
          ) : (
            <form onSubmit={handleRegisterDirectSubmit} className="space-y-4 text-xs">
              {regError && <div className="px-3 py-2 rounded-xl bg-danger/10 border border-danger/30 text-danger text-[11px] font-medium">{regError}</div>}
              <div className="space-y-1">
                <label className="font-bold text-secondary">Avatar</label>
                <div className="flex flex-wrap gap-2">
                  {avatarOptions.map((av) => (
                    <button key={av} type="button" onClick={() => setRegAvatar(av)} className={`w-9 h-9 rounded-xl text-lg border transition-all ${regAvatar === av ? 'border-accent bg-accent/15 scale-110' : 'border-edge bg-app hover:bg-elevated'}`}>{av}</button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="font-bold text-secondary">Full Name</label>
                  <input type="text" value={regName} onChange={(e) => setRegName(e.target.value)} placeholder="Alex Reader" required className="w-full bg-app border border-edge rounded-xl p-2.5 text-primary text-xs" />
                </div>
                <div className="space-y-1">
                  <label className="font-bold text-secondary">Username</label>
                  <input type="text" value={regUsername} onChange={(e) => setRegUsername(e.target.value)} placeholder="alex_reader" required autoComplete="username" className="w-full bg-app border border-edge rounded-xl p-2.5 text-primary text-xs" />
                </div>
              </div>
              <div className="space-y-1">
                <label className="font-bold text-secondary flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" /> Email</label>
                <input type="email" value={regEmail} onChange={(e) => setRegEmail(e.target.value)} placeholder="alex@manga.dev" required autoComplete="email" className="w-full bg-app border border-edge rounded-xl p-2.5 text-primary text-xs" />
              </div>
              <div className="space-y-1">
                <label className="font-bold text-secondary">Password (min 8)</label>
                <div className="relative">
                  <input type={showRegPassword ? 'text' : 'password'} value={regPassword} onChange={(e) => setRegPassword(e.target.value)} placeholder="********" required minLength={8} autoComplete="new-password" className="w-full bg-app border border-edge rounded-xl p-2.5 pr-10 text-primary text-xs" />
                  <button type="button" onClick={() => setShowRegPassword(!showRegPassword)} className="absolute right-3 top-2.5 text-muted hover:text-secondary">{showRegPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
                </div>
              </div>
              <button type="submit" disabled={busy} className="w-full py-3 sm:py-3.5 rounded-xl bg-gradient-to-r from-success to-success text-accent-fg font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg shadow-success/20 disabled:opacity-60">
                <UserPlus className="w-4 h-4 sm:w-5 sm:h-5" />{busy ? 'Creating...' : 'Create Account & Sign In'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
});