import React, { useState, useEffect } from 'react';
import { apiFetch } from '../utils/api';
import {
  ShieldAlert,
  ExternalLink,
  CheckCircle,
  RefreshCw,
  X,
  Bell,
  Send,
  MessageSquare,
  Key,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Loader2,
  Check,
  Globe,
  Sliders,
  Ban,
  AlertOctagon,
} from 'lucide-react';

export interface ChallengeItem {
  id: string;
  sourceId: string;
  sourceName: string;
  sourceUrl: string;
  sampleUrl?: string;
  challengeType: string;
  httpStatus: number;
  detectedAt: string;
  resolved: boolean;
  message: string;
  suggestedAction: string;
}

export interface ChallengeConfig {
  inAppAlerts: boolean;
  soundAlerts: boolean;
  discordWebhookUrl?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
}

interface ChallengeNotificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onChallengesCountChange?: (count: number) => void;
}

export const ChallengeNotificationModal: React.FC<ChallengeNotificationModalProps> = ({
  isOpen,
  onClose,
  onChallengesCountChange,
}) => {
  const [activeTab, setActiveTab] = useState<'challenges' | 'setup'>('challenges');
  const [challenges, setChallenges] = useState<ChallengeItem[]>([]);
  const [config, setConfig] = useState<ChallengeConfig>({
    inAppAlerts: true,
    soundAlerts: true,
    discordWebhookUrl: '',
    telegramBotToken: '',
    telegramChatId: '',
  });

  const [loading, setLoading] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Manual Cookie Injection State per Challenge
  const [expandedCookieId, setExpandedCookieId] = useState<string | null>(null);
  const [manualCookies, setManualCookies] = useState<Record<string, string>>({});
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  };

  const fetchChallenges = async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/challenges');
      if (res.ok) {
        const data = await res.json();
        setChallenges(data.challenges || []);
        if (data.config) setConfig(data.config);
        if (onChallengesCountChange) onChallengesCountChange(data.count || 0);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchChallenges();
    }
  }, [isOpen]);

  const handleDismiss = async (id: string) => {
    try {
      await apiFetch(`/api/challenges/${id}/dismiss`, { method: 'POST' });
      const next = challenges.filter((c) => c.id !== id);
      setChallenges(next);
      if (onChallengesCountChange) onChallengesCountChange(next.length);
      showToast('Challenge alert dismissed');
    } catch (err: any) {
      alert(`Failed to dismiss: ${err.message}`);
    }
  };

  const handleManualResolve = async (challenge: ChallengeItem) => {
    setVerifyingId(challenge.id);
    const cookies = manualCookies[challenge.id] || '';

    try {
      const res = await apiFetch(`/api/challenges/${challenge.id}/solve-manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId: challenge.sourceId,
          cookies: cookies.trim() || undefined,
        }),
      });

      if (res.ok) {
        showToast(`✓ Challenge resolved for ${challenge.sourceName}!`);
        const next = challenges.filter((c) => c.id !== challenge.id);
        setChallenges(next);
        if (onChallengesCountChange) onChallengesCountChange(next.length);
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Failed to verify clearance');
      }
    } catch (err: any) {
      alert(`Verification error: ${err.message}`);
    } finally {
      setVerifyingId(null);
    }
  };

  const handleFlagBroken = async (challenge: ChallengeItem) => {
    if (!window.confirm(`Are you sure you want to flag "${challenge.sourceName}" as broken and disable it? This will trip its circuit breaker and stop future challenge alerts.`)) {
      return;
    }
    setFlaggingId(challenge.id);
    try {
      const res = await apiFetch(`/api/challenges/${challenge.id}/flag-broken`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId: challenge.sourceId,
          reason: `Flagged broken by user during ${challenge.challengeType} challenge`,
        }),
      });
      if (res.ok) {
        showToast(`✓ "${challenge.sourceName}" flagged as broken & disabled.`);
        const next = challenges.filter((c) => c.id !== challenge.id);
        setChallenges(next);
        if (onChallengesCountChange) onChallengesCountChange(next.length);
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Failed to flag source as broken');
      }
    } catch (err: any) {
      alert(`Error flagging source: ${err.message}`);
    } finally {
      setFlaggingId(null);
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingConfig(true);
    try {
      const res = await apiFetch('/api/challenges/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (res.ok) {
        showToast('✓ Notification settings saved!');
      }
    } catch (err: any) {
      alert(`Failed to save configuration: ${err.message}`);
    } finally {
      setSavingConfig(false);
    }
  };

  const handleTestAlert = async () => {
    setTestingWebhook(true);
    try {
      const res = await apiFetch('/api/challenges/test', { method: 'POST' });
      if (res.ok) {
        showToast('✓ Test challenge alert dispatched!');
        fetchChallenges();
      }
    } catch (err: any) {
      alert(`Test alert error: ${err.message}`);
    } finally {
      setTestingWebhook(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto animate-in fade-in duration-200"
    >
      <div className="relative bg-surface border border-edge rounded-t-3xl sm:rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-hidden shadow-2xl flex flex-col my-0 sm:my-auto">
        
        {/* Header */}
        <div className="p-5 bg-gradient-to-r from-app via-surface to-app border-b border-edge flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-amber-500/15 text-amber-400 border border-amber-500/30 shadow-md">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-black text-primary">
                  Source Captcha & Challenge Setup
                </h3>
                {challenges.length > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-500/20 text-amber-300 border border-amber-500/40">
                    {challenges.length} Required
                  </span>
                )}
              </div>
              <p className="text-xs text-secondary">
                Notifications and manual bypass for Cloudflare, Turnstile & reCAPTCHA challenges
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-elevated/80 text-secondary hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-2 px-5 pt-3 border-b border-edge bg-app/50 text-xs font-bold">
          <button
            type="button"
            onClick={() => setActiveTab('challenges')}
            className={`pb-3 px-3 border-b-2 flex items-center gap-1.5 transition-all ${
              activeTab === 'challenges'
                ? 'border-accent text-accent'
                : 'border-transparent text-secondary hover:text-primary'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Active Challenges ({challenges.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('setup')}
            className={`pb-3 px-3 border-b-2 flex items-center gap-1.5 transition-all ${
              activeTab === 'setup'
                ? 'border-accent text-accent'
                : 'border-transparent text-secondary hover:text-primary'
            }`}
          >
            <Bell className="w-3.5 h-3.5" />
            <span>Notification Setup (Discord / Telegram)</span>
          </button>
        </div>

        {/* Toast */}
        {toastMsg && (
          <div className="mx-5 mt-3 p-3 bg-accent/15 border border-accent/30 rounded-xl text-xs font-bold text-accent animate-in fade-in">
            {toastMsg}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {activeTab === 'challenges' ? (
            <div className="space-y-3">
              {loading ? (
                <div className="py-12 text-center text-secondary flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-accent" />
                  <span>Checking active source challenges...</span>
                </div>
              ) : challenges.length === 0 ? (
                <div className="py-12 text-center bg-app/40 rounded-2xl border border-edge p-6 space-y-2">
                  <CheckCircle className="w-10 h-10 text-success mx-auto" />
                  <h4 className="text-sm font-bold text-primary">All Reading Sources Clear!</h4>
                  <p className="text-xs text-secondary max-w-md mx-auto">
                    No reading sources are currently blocked by bot protection or captchas. If a source triggers Cloudflare or a challenge, it will appear here with 1-click bypass controls.
                  </p>
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={handleTestAlert}
                      disabled={testingWebhook}
                      className="px-4 py-2 rounded-xl bg-surface hover:bg-elevated text-secondary hover:text-primary text-xs font-bold border border-edge inline-flex items-center gap-1.5 transition-all"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Trigger Test Challenge Alert</span>
                    </button>
                  </div>
                </div>
              ) : (
                challenges.map((c) => (
                  <div
                    key={c.id}
                    className="p-4 bg-app border border-amber-500/30 rounded-2xl space-y-3 shadow-md"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-primary text-sm">{c.sourceName}</span>
                          <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/30">
                            {c.challengeType.replace(/_/g, ' ')}
                          </span>
                          <span className="text-[10px] text-muted font-mono">HTTP {c.httpStatus}</span>
                        </div>
                        <p className="text-xs text-secondary">{c.message}</p>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleDismiss(c.id)}
                        className="text-xs text-muted hover:text-secondary p-1"
                        title="Dismiss alert"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Action Toolbar */}
                    <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-edge/60">
                      <a
                        href={c.sampleUrl || c.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3.5 py-1.5 rounded-xl bg-accent text-accent-fg font-black text-xs flex items-center gap-1.5 shadow-md hover:bg-accent-bright transition-all hover:scale-105"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>Open Source to Solve</span>
                      </a>

                      <button
                        type="button"
                        onClick={() => handleManualResolve(c)}
                        disabled={verifyingId === c.id || flaggingId === c.id}
                        className="px-3.5 py-1.5 rounded-xl bg-surface hover:bg-elevated border border-edge text-primary font-bold text-xs flex items-center gap-1.5 transition-all"
                      >
                        {verifyingId === c.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Check className="w-3.5 h-3.5 text-success" />
                        )}
                        <span>I Solved It / Recheck</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleFlagBroken(c)}
                        disabled={flaggingId === c.id || verifyingId === c.id}
                        className="px-3.5 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 font-bold text-xs flex items-center gap-1.5 transition-all active:scale-95"
                        title="Flag this source as broken and disable it from scans"
                      >
                        {flaggingId === c.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Ban className="w-3.5 h-3.5 text-rose-400" />
                        )}
                        <span>Flag as Broken</span>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          setExpandedCookieId(expandedCookieId === c.id ? null : c.id)
                        }
                        className="px-3 py-1.5 rounded-xl text-secondary hover:text-primary text-xs font-bold flex items-center gap-1 transition-all ml-auto"
                      >
                        <Key className="w-3.5 h-3.5" />
                        <span>Paste cf_clearance</span>
                        {expandedCookieId === c.id ? (
                          <ChevronUp className="w-3 h-3" />
                        ) : (
                          <ChevronDown className="w-3 h-3" />
                        )}
                      </button>
                    </div>

                    {/* Advanced Cookie Paste Accordion */}
                    {expandedCookieId === c.id && (
                      <div className="p-3 bg-surface/90 border border-edge rounded-xl space-y-2 mt-2">
                        <label className="block text-[11px] font-bold text-secondary">
                          Paste Browser Cookies (e.g. cf_clearance=...; __cf_bm=...)
                        </label>
                        <textarea
                          rows={2}
                          value={manualCookies[c.id] || ''}
                          onChange={(e) =>
                            setManualCookies({ ...manualCookies, [c.id]: e.target.value })
                          }
                          placeholder="cf_clearance=abc123xyz...; path=/; domain=..."
                          className="w-full bg-app border border-edge rounded-lg p-2 text-xs text-primary font-mono placeholder-muted focus:outline-none focus:border-accent"
                        />
                        <button
                          type="button"
                          onClick={() => handleManualResolve(c)}
                          className="px-3 py-1 rounded-lg bg-accent/20 hover:bg-accent/30 text-accent font-bold text-xs"
                        >
                          Apply Clearance Cookies
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          ) : (
            /* Setup Tab */
            <form onSubmit={handleSaveConfig} className="space-y-5">
              {/* In-App Alerts */}
              <div className="p-4 bg-app border border-edge rounded-2xl space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                  <Bell className="w-4 h-4 text-accent" />
                  <span>In-App Challenge Notifications</span>
                </h4>

                <div className="space-y-2 text-xs">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.inAppAlerts}
                      onChange={(e) => setConfig({ ...config, inAppAlerts: e.target.checked })}
                      className="rounded accent-accent"
                    />
                    <span className="font-semibold text-primary">Show Alert Banner in Top Navigation when captchas are detected</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.soundAlerts}
                      onChange={(e) => setConfig({ ...config, soundAlerts: e.target.checked })}
                      className="rounded accent-accent"
                    />
                    <span className="font-semibold text-primary">Play subtle notification sound on new challenge</span>
                  </label>
                </div>
              </div>

              {/* Discord Webhook */}
              <div className="p-4 bg-app border border-edge rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-indigo-400" />
                    <span>Discord Push Webhook</span>
                  </h4>
                  <span className="text-[10px] text-muted">Optional</span>
                </div>
                <p className="text-[11px] text-secondary">
                  Receive instant Discord alerts with 1-click links when a source requires manual captcha verification.
                </p>
                <input
                  type="url"
                  value={config.discordWebhookUrl || ''}
                  onChange={(e) => setConfig({ ...config, discordWebhookUrl: e.target.value })}
                  placeholder="https://discord.com/api/webhooks/..."
                  className="w-full bg-surface border border-edge rounded-xl px-3.5 py-2 text-xs text-primary font-mono placeholder-muted focus:outline-none focus:border-accent"
                />
              </div>

              {/* Telegram Bot */}
              <div className="p-4 bg-app border border-edge rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                    <Send className="w-4 h-4 text-sky-400" />
                    <span>Telegram Bot Alerts</span>
                  </h4>
                  <span className="text-[10px] text-muted">Optional</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-secondary mb-1">
                      Telegram Bot Token
                    </label>
                    <input
                      type="text"
                      value={config.telegramBotToken || ''}
                      onChange={(e) => setConfig({ ...config, telegramBotToken: e.target.value })}
                      placeholder="123456:ABC-DEF1234..."
                      className="w-full bg-surface border border-edge rounded-xl px-3 py-2 text-xs text-primary font-mono placeholder-muted focus:outline-none focus:border-accent"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-secondary mb-1">
                      Chat ID
                    </label>
                    <input
                      type="text"
                      value={config.telegramChatId || ''}
                      onChange={(e) => setConfig({ ...config, telegramChatId: e.target.value })}
                      placeholder="e.g. 987654321 or @channel"
                      className="w-full bg-surface border border-edge rounded-xl px-3 py-2 text-xs text-primary font-mono placeholder-muted focus:outline-none focus:border-accent"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-edge">
                <button
                  type="button"
                  onClick={handleTestAlert}
                  disabled={testingWebhook}
                  className="px-3.5 py-2 rounded-xl bg-surface hover:bg-elevated border border-edge text-secondary hover:text-primary font-bold text-xs flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Send Test Alert</span>
                </button>

                <button
                  type="submit"
                  disabled={savingConfig}
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-accent to-accent-2 hover:from-accent-bright hover:to-accent-2 text-accent-fg font-black text-xs flex items-center gap-1.5 shadow-md disabled:opacity-50"
                >
                  {savingConfig ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  <span>Save Notification Setup</span>
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-app border-t border-edge flex items-center justify-between text-xs text-secondary">
          <div className="flex items-center gap-1">
            <Globe className="w-3.5 h-3.5 text-accent" />
            <span>Graywood Challenge Watchdog</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-surface hover:bg-elevated text-primary font-bold text-xs border border-edge"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
};
