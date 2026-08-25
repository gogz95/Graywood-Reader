import React, { useState } from 'react';
import { apiFetch } from '../../utils/api';
import { AppSettings, UserProfile } from '../../types';
import { hashPin } from '../../utils/pinHash';
import {
  Shield,
  Zap,
  KeyRound,
  Lock,
  RefreshCw,
  Check,
  AlertTriangle,
} from 'lucide-react';

interface SecurityCaptchaTabProps {
  formData: AppSettings;
  setFormData: React.Dispatch<React.SetStateAction<AppSettings>>;
  isAdmin: boolean;
  activeProfile?: UserProfile;
}

export const SecurityCaptchaTab: React.FC<SecurityCaptchaTabProps> = ({
  formData,
  setFormData,
  isAdmin,
}) => {
  const [showCaptchaKey, setShowCaptchaKey] = useState(false);
  const [isTestingFlareSolverr, setIsTestingFlareSolverr] = useState(false);
  const [flareSolverrTestStatus, setFlareSolverrTestStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [isCheckingCaptchaBalance, setIsCheckingCaptchaBalance] = useState(false);
  const [captchaBalanceStatus, setCaptchaBalanceStatus] = useState<{ ok: boolean; message: string; balance?: number } | null>(null);

  // App Lock Pin Setup States
  const [pinInput, setPinInput] = useState('');
  const [pinConfirmInput, setPinConfirmInput] = useState('');
  const [pinMessage, setPinMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const handleTestFlareSolverr = async () => {
    setIsTestingFlareSolverr(true);
    setFlareSolverrTestStatus(null);
    try {
      const res = await apiFetch('/api/solver/test-flaresolverr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: formData.flareSolverrUrl }),
      });
      const data = await res.json();
      if (data.success) {
        setFlareSolverrTestStatus({ ok: true, message: `FlareSolverr Online! (${data.version || 'v3.x'})` });
      } else {
        setFlareSolverrTestStatus({ ok: false, message: data.error || 'Connection failed' });
      }
    } catch (err: any) {
      setFlareSolverrTestStatus({ ok: false, message: err.message || 'Network error reaching FlareSolverr' });
    } finally {
      setIsTestingFlareSolverr(false);
    }
  };

  const handleCheckCaptchaBalance = async () => {
    setIsCheckingCaptchaBalance(true);
    setCaptchaBalanceStatus(null);
    try {
      const res = await apiFetch('/api/solver/check-balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: formData.captchaApiKey }),
      });
      const data = await res.json();
      if (data.success) {
        setCaptchaBalanceStatus({ ok: true, message: `${data.provider} Active: $${Number(data.balance).toFixed(2)} ${data.currency}`, balance: data.balance });
      } else {
        setCaptchaBalanceStatus({ ok: false, message: data.error || 'Invalid API key or balance unavailable' });
      }
    } catch (err: any) {
      setCaptchaBalanceStatus({ ok: false, message: err.message || 'Error checking solver balance' });
    } finally {
      setIsCheckingCaptchaBalance(false);
    }
  };

  const handleSetNewPin = async () => {
    if (!pinInput || pinInput.length < 4) {
      setPinMessage({ ok: false, text: 'PIN must be at least 4 digits.' });
      return;
    }
    if (pinInput !== pinConfirmInput) {
      setPinMessage({ ok: false, text: 'PINs do not match.' });
      return;
    }
    const hashed = await hashPin(pinInput);
    setFormData((prev) => ({
      ...prev,
      appLockPinHash: hashed,
      appLockEnabled: true,
    }));
    setPinMessage({ ok: true, text: 'PIN updated and App Lock enabled!' });
    setPinInput('');
    setPinConfirmInput('');
  };

  return (
    <div className="space-y-6 text-xs sm:text-sm">
      <div className="p-5 bg-app rounded-2xl border border-edge space-y-2">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <KeyRound className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-extrabold text-primary text-sm sm:text-base">
              App Lock & Privacy Protection
            </h3>
            <p className="text-secondary text-xs">
              Lock Graywood Reader with a numeric PIN or password to protect your library and reading history from unauthorized local access.
            </p>
          </div>
        </div>
      </div>

      {/* Master App Lock Toggle */}
      <div className="p-5 bg-app rounded-2xl border border-edge space-y-4">
        <label className="flex items-center justify-between cursor-pointer">
          <div>
            <div className="font-bold text-primary text-sm flex items-center gap-2">
              <Lock className="w-4 h-4 text-amber-400" />
              <span>Enable Application Lock</span>
            </div>
            <div className="text-xs text-secondary mt-0.5">
              Require PIN or password entry when opening the reader or after an idle timeout
            </div>
          </div>
          <input
            type="checkbox"
            checked={formData.appLockEnabled || false}
            onChange={(e) => setFormData({ ...formData, appLockEnabled: e.target.checked })}
            className="w-5 h-5 accent-accent"
          />
        </label>

        {formData.appLockEnabled && (
          <div className="space-y-4 pt-3 border-t border-edge">
            {/* Auto-Lock Timeout */}
            <div className="flex items-center justify-between p-3 rounded-xl bg-surface border border-edge">
              <div>
                <div className="font-bold text-primary">Auto-Lock Inactivity Timeout</div>
                <div className="text-[11px] text-secondary">Automatically lock after inactivity or app blur</div>
              </div>
              <select
                value={formData.appLockTimeoutMinutes ?? 5}
                onChange={(e) => setFormData({ ...formData, appLockTimeoutMinutes: parseInt(e.target.value, 10) })}
                className="px-3 py-1.5 rounded-lg bg-app border border-edge text-primary text-xs font-semibold"
              >
                <option value={0}>Immediate (Every session)</option>
                <option value={1}>1 Minute</option>
                <option value={5}>5 Minutes</option>
                <option value={15}>15 Minutes</option>
                <option value={-1}>On Window Minimize / Tab Blur</option>
              </select>
            </div>

            {/* Change / Set PIN */}
            <div className="p-4 rounded-xl bg-surface border border-edge space-y-3">
              <div className="font-bold text-primary text-xs">Set / Update Security PIN:</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-secondary block mb-1">New 4–6 Digit PIN:</label>
                  <input
                    type="password"
                    maxLength={6}
                    value={pinInput}
                    onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ''))}
                    placeholder="Enter 4-6 digits"
                    className="w-full bg-app border border-edge rounded-lg px-3 py-2 text-primary text-xs font-mono tracking-widest text-center"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-secondary block mb-1">Confirm PIN:</label>
                  <input
                    type="password"
                    maxLength={6}
                    value={pinConfirmInput}
                    onChange={(e) => setPinConfirmInput(e.target.value.replace(/\D/g, ''))}
                    placeholder="Re-enter digits"
                    className="w-full bg-app border border-edge rounded-lg px-3 py-2 text-primary text-xs font-mono tracking-widest text-center"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={handleSetNewPin}
                  disabled={!pinInput || pinInput.length < 4}
                  className="px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs shadow-md transition-all cursor-pointer disabled:opacity-50"
                >
                  Save New PIN
                </button>

                {pinMessage && (
                  <span className={`text-xs font-semibold ${pinMessage.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {pinMessage.text}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Cloudflare & Captcha Solver Card (Host Admin Only) */}
      {isAdmin && (
        <div className="p-5 bg-app rounded-2xl border border-edge space-y-4">
          <div className="flex items-center justify-between">
            <div className="font-bold text-primary text-sm flex items-center gap-2">
              <Shield className="w-4 h-4 text-success" />
              Cloudflare Challenge & Auto Captcha Solver
            </div>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-success/20 text-success border border-success/30">
              Active Defense Bypass
            </span>
          </div>

          {/* FlareSolverr Section */}
          <div className="space-y-3 p-4 bg-surface rounded-xl border border-edge">
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <div className="font-bold text-primary flex items-center gap-2">
                  <span>FlareSolverr Automated Browser Bypass</span>
                </div>
                <div className="text-[11px] text-secondary">Automatically solve Cloudflare Turnstile & DDoS browser checks</div>
              </div>
              <input
                type="checkbox"
                checked={formData.enableCloudflareBypass}
                onChange={(e) => setFormData({ ...formData, enableCloudflareBypass: e.target.checked })}
                className="w-5 h-5 accent-success"
              />
            </label>

            <div className="space-y-1.5 pt-1">
              <label className="font-bold text-secondary text-[11px]">FlareSolverr Service Endpoint URL:</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={formData.flareSolverrUrl}
                  onChange={(e) => setFormData({ ...formData, flareSolverrUrl: e.target.value })}
                  placeholder="http://localhost:8191/v1"
                  className="flex-1 bg-app border border-edge rounded-lg px-3 py-2 text-primary text-xs font-mono"
                />
                <button
                  type="button"
                  onClick={handleTestFlareSolverr}
                  disabled={isTestingFlareSolverr}
                  className="px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-lg bg-elevated hover:bg-elevated text-primary font-bold text-xs sm:text-sm flex items-center gap-1.5 border border-edge whitespace-nowrap transition-all cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${isTestingFlareSolverr ? 'animate-spin' : ''}`} />
                  <span>{isTestingFlareSolverr ? 'Testing...' : 'Test Connection'}</span>
                </button>
              </div>
              {flareSolverrTestStatus && (
                <div className={`p-2 rounded-lg text-xs font-bold flex items-center gap-1.5 ${flareSolverrTestStatus.ok ? 'bg-success/10 text-success border border-success/30' : 'bg-danger/10 text-danger border border-danger/30'}`}>
                  {flareSolverrTestStatus.ok ? <Check className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                  <span>{flareSolverrTestStatus.message}</span>
                </div>
              )}
            </div>
          </div>

          {/* 2Captcha / CapSolver API Section */}
          <div className="space-y-3 p-4 bg-surface rounded-xl border border-edge">
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <div className="font-bold text-primary flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-400" />
                  <span>Automated Cloud Captcha Solver (2Captcha / CapSolver)</span>
                </div>
                <div className="text-[11px] text-secondary">Solve interactive Turnstile, reCAPTCHA, and hCaptcha challenges automatically via API</div>
              </div>
              <input
                type="checkbox"
                checked={formData.captchaSolverEnabled}
                onChange={(e) => setFormData({ ...formData, captchaSolverEnabled: e.target.checked })}
                className="w-5 h-5 accent-amber-400"
              />
            </label>

            <div className="space-y-1.5 pt-1">
              <label className="font-bold text-secondary text-[11px]">Solver API Key (2Captcha or CapSolver):</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type={showCaptchaKey ? 'text' : 'password'}
                    value={formData.captchaApiKey || ''}
                    onChange={(e) => setFormData({ ...formData, captchaApiKey: e.target.value })}
                    placeholder="Paste your 2Captcha or CapSolver API client key"
                    className="w-full bg-app border border-edge rounded-lg px-3 py-2 pr-16 text-primary text-xs font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCaptchaKey(!showCaptchaKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-secondary hover:text-primary font-bold px-1.5 py-0.5 rounded bg-elevated"
                  >
                    {showCaptchaKey ? 'Hide' : 'Show'}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={handleCheckCaptchaBalance}
                  disabled={isCheckingCaptchaBalance || !formData.captchaApiKey}
                  className="px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-lg bg-elevated hover:bg-elevated text-primary font-bold text-xs sm:text-sm flex items-center gap-1.5 border border-edge whitespace-nowrap disabled:opacity-50 transition-all cursor-pointer"
                >
                  <Zap className={`w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-400 ${isCheckingCaptchaBalance ? 'animate-pulse' : ''}`} />
                  <span>{isCheckingCaptchaBalance ? 'Checking...' : 'Check Balance'}</span>
                </button>
              </div>
              {captchaBalanceStatus && (
                <div className={`p-2 rounded-lg text-xs font-bold flex items-center gap-1.5 ${captchaBalanceStatus.ok ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30' : 'bg-danger/10 text-danger border border-danger/30'}`}>
                  {captchaBalanceStatus.ok ? <Check className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                  <span>{captchaBalanceStatus.message}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
