import React, { useState } from 'react';
import { UserProfile, UserRole } from '../types';
import { Shield, User, Lock, Mail, Folder, Check, UserPlus, LogIn, ArrowRight, X, Eye, EyeOff, UserCheck } from 'lucide-react';

interface AuthModalProps {
  onLogin: (user: UserProfile) => void;
  onRegister: (newUser: UserProfile) => void;
  existingUsers: UserProfile[];
  onClose: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  onLogin,
  onRegister,
  existingUsers,
  onClose,
}) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');

  // Login Form
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Register Form
  const [regName, setRegName] = useState('');
  const [regUsername, setRegUsername] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [regAvatar, setRegAvatar] = useState('🥷');
  const [regFolderPath, setRegFolderPath] = useState('C:\\Users\\LocalMangaStorage');
  const [regRole, setRegRole] = useState<UserRole>(existingUsers.length === 0 ? 'admin' : 'user');

  const avatarOptions = ['🥷', '🦊', '🦸‍♂️', '🧙‍♂️', '🐉', '⚡', '👑', '🔥', '⚔️', '🤖'];

  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);

    const found = existingUsers.find(
      (u) =>
        u.username.toLowerCase() === loginIdentifier.trim().toLowerCase() ||
        u.email.toLowerCase() === loginIdentifier.trim().toLowerCase() ||
        u.name.toLowerCase() === loginIdentifier.trim().toLowerCase()
    );

    if (found) {
      onLogin(found);
      onClose();
    } else {
      setLoginError('No matching account found. Please check your username/email or register a new profile.');
    }
  };

  // Demo / Guest Instant Access
  const handleGuestQuickSignIn = () => {
    const defaultUser: UserProfile = existingUsers[0] || {
      id: 'usr_guest_' + Date.now(),
      name: 'Guest Reader',
      username: 'guest',
      email: 'guest@omnimanga.app',
      password: '',
      avatar: '🥷',
      role: 'user',
      storageFolderPath: 'C:\\Users\\GuestStorage',
      createdAt: new Date().toISOString(),
    };
    onLogin(defaultUser);
    onClose();
  };

  // Confirmation Code Verification State
  const [verificationStep, setVerificationStep] = useState<boolean>(false);
  const [generatedCode, setGeneratedCode] = useState<string>('');
  const [userEnteredCode, setUserEnteredCode] = useState<string>('');
  const [codeError, setCodeError] = useState<string | null>(null);

  const handleSendConfirmationCode = (e: React.FormEvent) => {
    e.preventDefault();
    if (!regName.trim() || !regUsername.trim() || !regEmail.trim()) return;

    const exists = existingUsers.some(
      (u) => u.username.toLowerCase() === regUsername.trim().toLowerCase() || u.email.toLowerCase() === regEmail.trim().toLowerCase()
    );

    if (exists) {
      setCodeError('Username or email is already registered to another account.');
      return;
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    setGeneratedCode(code);
    setVerificationStep(true);
    setCodeError(null);
  };

  const handleVerifyCodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (userEnteredCode.trim() !== generatedCode) {
      setCodeError('Invalid confirmation code. Please enter the 6-digit code shown below.');
      return;
    }

    const newUser: UserProfile = {
      id: 'usr_' + Date.now(),
      name: regName.trim(),
      username: regUsername.trim(),
      email: regEmail.trim(),
      password: regPassword,
      avatar: regAvatar,
      role: regRole,
      storageFolderPath: regFolderPath,
      createdAt: new Date().toISOString(),
    };

    onRegister(newUser);
    onLogin(newUser);
    onClose();
  };

  const handleBrowseFolder = async () => {
    try {
      if ('showDirectoryPicker' in window) {
        const dirHandle = await (window as any).showDirectoryPicker();
        setRegFolderPath(`C:\\Users\\LocalMangaStorage\\${dirHandle.name}`);
      } else {
        const customPath = prompt('Enter or paste local storage folder path:', regFolderPath);
        if (customPath) setRegFolderPath(customPath);
      }
    } catch (err) {
      console.log('Folder selection cancelled:', err);
    }
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-xl flex items-center justify-center p-4 overflow-y-auto"
    >
      <div className="bg-slate-900/95 border border-slate-800 rounded-3xl max-w-md w-full overflow-hidden shadow-2xl flex flex-col my-auto relative backdrop-blur-md">
        
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-xl bg-slate-950/80 hover:bg-slate-800 text-slate-400 hover:text-slate-100 border border-slate-800 transition-all z-10"
          title="Close Auth Portal"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Modernized Header */}
        <div className="p-6 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-900 border-b border-slate-800/80 text-center space-y-3 relative">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-amber-500/20 to-orange-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center mx-auto shadow-lg shadow-amber-500/10">
            <Shield className="w-7 h-7" />
          </div>
          <div>
            <h2 className="text-xl font-black text-slate-100 tracking-tight">OmniManga Reader Account</h2>
            <p className="text-xs text-slate-400 mt-1">
              {mode === 'login' ? 'Sign in to access your library & sync reading progress' : 'Create an account with private storage isolation'}
            </p>
          </div>

          {/* Segmented Mode Switcher */}
          <div className="flex items-center gap-1 p-1 bg-slate-950/90 rounded-2xl border border-slate-800 text-xs font-bold pt-1">
            <button
              type="button"
              onClick={() => setMode('login')}
              className={`flex-1 py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 ${
                mode === 'login' ? 'bg-amber-500 text-slate-950 shadow-md font-black' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>Sign In</span>
            </button>

            <button
              type="button"
              onClick={() => setMode('register')}
              className={`flex-1 py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 ${
                mode === 'register' ? 'bg-amber-500 text-slate-950 shadow-md font-black' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Create Account</span>
            </button>
          </div>
        </div>

        {/* Form Body */}
        <div className="p-6 space-y-4 text-xs">
          {loginError && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-300 font-semibold text-xs animate-fadeIn">
              {loginError}
            </div>
          )}

          {/* SIGN IN FORM */}
          {mode === 'login' && (
            <form onSubmit={handleLoginSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="font-bold text-slate-300 flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-amber-400" />
                  Username or Email Address
                </label>
                <input
                  type="text"
                  value={loginIdentifier}
                  onChange={(e) => setLoginIdentifier(e.target.value)}
                  placeholder="e.g. admin or reader@manga.dev"
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500/50 transition-all text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-slate-300 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-amber-400" />
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showLoginPassword ? 'text' : 'password'}
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 pr-10 text-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500/50 transition-all text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => setShowLoginPassword(!showLoginPassword)}
                    className="absolute right-3 top-3 text-slate-500 hover:text-slate-300"
                  >
                    {showLoginPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Quick Preset Selectors for Existing Profiles */}
              {existingUsers.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-slate-800/80">
                  <div className="flex items-center justify-between text-[11px] font-bold text-slate-400">
                    <span>Saved Accounts ({existingUsers.length})</span>
                    <span className="text-[10px] text-amber-400">Click to quick switch</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-36 overflow-y-auto pr-1">
                    {existingUsers.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => {
                          onLogin(u);
                          onClose();
                        }}
                        className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 hover:border-amber-500/50 flex items-center gap-2 text-left transition-all group"
                      >
                        <span className="text-xl">{u.avatar}</span>
                        <div className="min-w-0">
                          <div className="font-bold text-slate-200 group-hover:text-amber-400 text-xs truncate">
                            {u.name}
                          </div>
                          <div className="text-[10px] text-slate-500 uppercase font-semibold">
                            {u.role === 'admin' ? '🛡️ Host Admin' : '👤 Private User'}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  className="flex-1 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black text-xs flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 transition-all hover:scale-[1.02]"
                >
                  <span>Sign In to Account</span>
                  <ArrowRight className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={handleGuestQuickSignIn}
                  className="px-3.5 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs flex items-center gap-1.5 border border-slate-700/80 transition-all"
                  title="Instant Guest Reader Sign In"
                >
                  <UserCheck className="w-4 h-4 text-emerald-400" />
                  <span>Guest</span>
                </button>
              </div>
            </form>
          )}

          {/* SIGN UP / REGISTER FORM */}
          {mode === 'register' && (
            <div>
              {codeError && (
                <div className="p-3 mb-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-bold">
                  {codeError}
                </div>
              )}

              {!verificationStep ? (
                <form onSubmit={handleSendConfirmationCode} className="space-y-3.5">
                  <div className="space-y-1">
                    <label className="font-bold text-slate-300">Choose Profile Icon:</label>
                    <div className="flex flex-wrap gap-1.5">
                      {avatarOptions.map((av) => (
                        <button
                          key={av}
                          type="button"
                          onClick={() => setRegAvatar(av)}
                          className={`p-2 text-lg rounded-xl border transition-all ${
                            regAvatar === av
                              ? 'border-amber-500 bg-amber-500/20 shadow-md scale-105'
                              : 'border-slate-800 bg-slate-950 hover:bg-slate-800'
                          }`}
                        >
                          {av}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="font-bold text-slate-300">Full Name</label>
                      <input
                        type="text"
                        value={regName}
                        onChange={(e) => setRegName(e.target.value)}
                        placeholder="Alex Reader"
                        required
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 text-xs"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="font-bold text-slate-300">Username</label>
                      <input
                        type="text"
                        value={regUsername}
                        onChange={(e) => setRegUsername(e.target.value)}
                        placeholder="alex_reader"
                        required
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 text-xs"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="font-bold text-slate-300">Email Address</label>
                    <input
                      type="email"
                      value={regEmail}
                      onChange={(e) => setRegEmail(e.target.value)}
                      placeholder="alex@manga.dev"
                      required
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 text-xs"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="font-bold text-slate-300">Password</label>
                    <div className="relative">
                      <input
                        type={showRegPassword ? 'text' : 'password'}
                        value={regPassword}
                        onChange={(e) => setRegPassword(e.target.value)}
                        placeholder="••••••••"
                        required
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 pr-10 text-slate-200 text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => setShowRegPassword(!showRegPassword)}
                        className="absolute right-3 top-2.5 text-slate-500 hover:text-slate-300"
                      >
                        {showRegPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {/* Access Role */}
                  <div className="space-y-1">
                    <label className="font-bold text-slate-300">Account Access Role</label>
                    <select
                      value={regRole}
                      onChange={(e) => setRegRole(e.target.value as UserRole)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 text-xs"
                    >
                      <option value="user">👤 Individual User (Private Isolated Storage)</option>
                      <option value="admin">🛡️ Host Admin (Full Access to Everything)</option>
                    </select>
                  </div>

                  {/* Storage Folder Path Selection */}
                  <div className="space-y-1">
                    <label className="font-bold text-slate-300">Private Local Storage Directory</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={regFolderPath}
                        onChange={(e) => setRegFolderPath(e.target.value)}
                        className="flex-1 bg-slate-950 border border-slate-800 rounded-xl p-2 text-slate-200 font-mono text-[11px]"
                      />
                      <button
                        type="button"
                        onClick={handleBrowseFolder}
                        className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-400 font-bold text-xs flex items-center gap-1"
                      >
                        <Folder className="w-3.5 h-3.5" />
                        <span>Browse</span>
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-black text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 transition-all hover:scale-[1.02]"
                  >
                    <Mail className="w-4 h-4" />
                    <span>Send Verification Code</span>
                  </button>
                </form>
              ) : (
                <form onSubmit={handleVerifyCodeSubmit} className="space-y-4">
                  <div className="p-3 rounded-xl bg-blue-950/60 border border-blue-500/30 text-blue-300 text-xs space-y-1">
                    <div className="font-bold flex items-center gap-1.5">
                      <Mail className="w-4 h-4 text-blue-400" />
                      Email Confirmation Security Code
                    </div>
                    <p className="text-[11px] text-slate-300">
                      We sent a 6-digit security code to <strong className="text-amber-300">{regEmail}</strong>.
                    </p>
                    <p className="text-[11px] text-amber-400 font-mono bg-blue-950 p-2 rounded border border-blue-500/20 mt-1 flex items-center justify-between">
                      <span>Verification Code:</span>
                      <strong className="text-base tracking-widest">{generatedCode}</strong>
                    </p>
                  </div>

                  <div className="space-y-1">
                    <label className="font-bold text-slate-300">Enter 6-Digit Confirmation Code:</label>
                    <input
                      type="text"
                      maxLength={6}
                      value={userEnteredCode}
                      onChange={(e) => setUserEnteredCode(e.target.value)}
                      placeholder="e.g. 849201"
                      required
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-center text-xl font-mono font-black text-amber-400 tracking-widest focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                    />
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setVerificationStep(false)}
                      className="px-4 py-2.5 rounded-xl bg-slate-800 text-slate-300 font-bold text-xs hover:bg-slate-700"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs flex items-center justify-center gap-2 shadow-lg"
                    >
                      <Check className="w-4 h-4" />
                      <span>Verify & Create Account</span>
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
