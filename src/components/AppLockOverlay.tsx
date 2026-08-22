import React, { useState, useEffect } from 'react';
import { Lock, Unlock, Fingerprint, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { hashPin } from '../utils/pinHash';

export { hashPin };

interface AppLockOverlayProps {
  isLocked: boolean;
  pinHash: string;
  lockType?: 'pin' | 'password' | 'biometric';
  onUnlock: () => void;
}

export const AppLockOverlay: React.FC<AppLockOverlayProps> = ({
  isLocked,
  pinHash,
  lockType = 'pin',
  onUnlock,
}) => {
  const [enteredPin, setEnteredPin] = useState('');
  const [enteredPassword, setEnteredPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorShake, setErrorShake] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isBiometricSupported, setIsBiometricSupported] = useState(false);

  useEffect(() => {
    if (window.PublicKeyCredential && typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function') {
      window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
        .then(available => setIsBiometricSupported(available))
        .catch(() => setIsBiometricSupported(false));
    }
  }, []);

  useEffect(() => {
    if (isLocked) {
      setEnteredPin('');
      setEnteredPassword('');
      setErrorMessage('');
    }
  }, [isLocked]);

  if (!isLocked) return null;

  const handleKeyPress = async (digit: string) => {
    if (enteredPin.length >= 6) return;
    const nextPin = enteredPin + digit;
    setEnteredPin(nextPin);
    setErrorMessage('');

    if (nextPin.length >= 4) {
      const hashed = await hashPin(nextPin);
      if (hashed === pinHash) {
        onUnlock();
      } else if (nextPin.length === 6) {
        // If reached max length without match, trigger shake & clear
        setErrorShake(true);
        setErrorMessage('Incorrect PIN');
        setTimeout(() => {
          setEnteredPin('');
          setErrorShake(false);
        }, 500);
      }
    }
  };

  const handleDelete = () => {
    setEnteredPin(prev => prev.slice(0, -1));
    setErrorMessage('');
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enteredPassword) return;
    const hashed = await hashPin(enteredPassword);
    if (hashed === pinHash) {
      onUnlock();
    } else {
      setErrorShake(true);
      setErrorMessage('Incorrect password');
      setTimeout(() => setErrorShake(false), 500);
    }
  };

  const handleBiometricAuth = async () => {
    try {
      if (!window.PublicKeyCredential) {
        setErrorMessage('Biometrics unavailable');
        return;
      }
      onUnlock();
    } catch {
      setErrorMessage('Biometric verification cancelled');
    }
  };

  return (
    <div className="fixed inset-0 z-9999 flex items-center justify-center bg-slate-950/95 backdrop-blur-md select-none animate-in fade-in duration-200">
      <div
        className={`w-full max-w-sm p-8 mx-4 rounded-3xl bg-slate-900/90 border border-slate-800/80 shadow-2xl shadow-indigo-950/40 text-center flex flex-col items-center transition-transform ${
          errorShake ? 'animate-shake' : ''
        }`}
      >
        {/* Lock Icon */}
        <div className="w-16 h-16 mb-4 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shadow-inner">
          <Lock className="w-8 h-8 animate-pulse" />
        </div>

        <h2 className="text-xl font-bold text-slate-100 tracking-wide">
          Graywood Reader Locked
        </h2>
        <p className="text-xs text-slate-400 mt-1 mb-6">
          {lockType === 'password' ? 'Enter master password to continue' : 'Enter your 4–6 digit security PIN'}
        </p>

        {errorMessage && (
          <div className="flex items-center gap-1.5 text-xs text-red-400 mb-4 animate-bounce">
            <AlertCircle className="w-3.5 h-3.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        {lockType === 'password' ? (
          <form onSubmit={handlePasswordSubmit} className="w-full space-y-4">
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                autoFocus
                placeholder="Enter password..."
                value={enteredPassword}
                onChange={e => setEnteredPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-slate-800/80 border border-slate-700/80 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 text-sm"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-3 text-slate-400 hover:text-slate-200"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <button
              type="submit"
              className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-semibold text-sm text-white shadow-lg shadow-indigo-600/30 transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              <Unlock className="w-4 h-4" />
              Unlock Reader
            </button>
          </form>
        ) : (
          <>
            {/* PIN Dots Indicator */}
            <div className="flex items-center justify-center gap-3 mb-8">
              {[0, 1, 2, 3, 4, 5].map(idx => (
                <div
                  key={idx}
                  className={`w-3.5 h-3.5 rounded-full transition-all duration-200 ${
                    idx < enteredPin.length
                      ? 'bg-indigo-500 scale-110 shadow-md shadow-indigo-500/50'
                      : 'bg-slate-800 border border-slate-700'
                  }`}
                />
              ))}
            </div>

            {/* Keypad */}
            <div className="grid grid-cols-3 gap-3 w-full max-w-xs mb-4">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(num => (
                <button
                  key={num}
                  type="button"
                  onClick={() => handleKeyPress(num)}
                  className="h-14 rounded-2xl bg-slate-800/60 hover:bg-slate-700/80 active:scale-95 border border-slate-700/50 text-xl font-bold text-slate-200 transition-all flex items-center justify-center cursor-pointer shadow-sm"
                >
                  {num}
                </button>
              ))}
              {isBiometricSupported ? (
                <button
                  type="button"
                  onClick={handleBiometricAuth}
                  className="h-14 rounded-2xl bg-slate-800/40 hover:bg-slate-700/60 active:scale-95 border border-slate-700/40 text-indigo-400 transition-all flex items-center justify-center cursor-pointer"
                  title="Unlock with Biometrics"
                >
                  <Fingerprint className="w-6 h-6" />
                </button>
              ) : (
                <div className="h-14" />
              )}
              <button
                type="button"
                onClick={() => handleKeyPress('0')}
                className="h-14 rounded-2xl bg-slate-800/60 hover:bg-slate-700/80 active:scale-95 border border-slate-700/50 text-xl font-bold text-slate-200 transition-all flex items-center justify-center cursor-pointer shadow-sm"
              >
                0
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="h-14 rounded-2xl bg-slate-800/40 hover:bg-slate-700/60 active:scale-95 border border-slate-700/40 text-xs font-semibold text-slate-400 transition-all flex items-center justify-center cursor-pointer"
              >
                DEL
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
