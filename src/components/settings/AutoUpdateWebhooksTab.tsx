import React, { useState } from 'react';
import { apiFetch } from '../../utils/api';
import { AppSettings, AutoUpdateLog, DatabaseSyncConfig, MangaItem } from '../../types';
import { AutoUpdateView } from '../AutoUpdateView';
import {
  Bell,
  Send,
  Loader2,
} from 'lucide-react';

interface AutoUpdateWebhooksTabProps {
  formData: AppSettings;
  setFormData: React.Dispatch<React.SetStateAction<AppSettings>>;
  isAdmin: boolean;
  renderAdminLockNotice: (feature: string) => React.ReactNode;
  activeSubTab: 'autoupdate' | 'webhooks';
  // AutoUpdateView props
  logs?: AutoUpdateLog[];
  dbConfig: DatabaseSyncConfig;
  mangaList?: MangaItem[];
  onRunAutoUpdate?: () => void;
  isUpdating?: boolean;
}

export const AutoUpdateWebhooksTab: React.FC<AutoUpdateWebhooksTabProps> = ({
  formData,
  setFormData,
  isAdmin,
  renderAdminLockNotice,
  activeSubTab,
  logs = [],
  dbConfig,
  mangaList = [],
  onRunAutoUpdate = () => {},
  isUpdating = false,
}) => {
  const [isTestingDiscord, setIsTestingDiscord] = useState(false);
  const [discordTestStatus, setDiscordTestStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [isTestingTelegram, setIsTestingTelegram] = useState(false);
  const [telegramTestStatus, setTelegramTestStatus] = useState<{ ok: boolean; message: string } | null>(null);

  const handleTestDiscord = async () => {
    setIsTestingDiscord(true);
    setDiscordTestStatus(null);
    try {
      const res = await apiFetch('/api/webhooks/test-discord', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhookUrl: formData.discordWebhookUrl }),
      });
      const data = await res.json();
      if (data.success) {
        setDiscordTestStatus({ ok: true, message: data.message || 'Discord notification sent!' });
      } else {
        setDiscordTestStatus({ ok: false, message: data.error || 'Failed to send Discord notification' });
      }
    } catch (err: any) {
      setDiscordTestStatus({ ok: false, message: err.message || 'Network error' });
    } finally {
      setIsTestingDiscord(false);
    }
  };

  const handleTestTelegram = async () => {
    setIsTestingTelegram(true);
    setTelegramTestStatus(null);
    try {
      const res = await apiFetch('/api/webhooks/test-telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botToken: formData.telegramBotToken,
          chatId: formData.telegramChatId,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setTelegramTestStatus({ ok: true, message: data.message || 'Telegram notification sent!' });
      } else {
        setTelegramTestStatus({ ok: false, message: data.error || 'Failed to send Telegram notification' });
      }
    } catch (err: any) {
      setTelegramTestStatus({ ok: false, message: err.message || 'Network error' });
    } finally {
      setIsTestingTelegram(false);
    }
  };

  if (!isAdmin) {
    return <>{renderAdminLockNotice(activeSubTab === 'autoupdate' ? 'Auto-Update Feed & Release Crawler' : 'Push Notifications & Webhooks')}</>;
  }

  if (activeSubTab === 'autoupdate') {
    return (
      <AutoUpdateView
        logs={logs}
        config={dbConfig}
        mangaList={mangaList}
        onRunAutoUpdate={onRunAutoUpdate}
        isUpdating={isUpdating}
      />
    );
  }

  // Webhooks Tab
  return (
    <div className="space-y-6 text-xs sm:text-sm">
      <div className="p-5 bg-app rounded-2xl border border-edge space-y-2">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            <Bell className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-extrabold text-primary text-sm sm:text-base">
              Discord & Telegram Chapter Webhooks
            </h3>
            <p className="text-secondary text-xs">
              Dispatch rich notification embeds to Discord channels or Telegram chats whenever background crawlers discover new chapter releases.
            </p>
          </div>
        </div>
      </div>

      {/* Filter Rule Card */}
      <div className="p-4 bg-app rounded-2xl border border-edge">
        <label className="flex items-center justify-between cursor-pointer">
          <div>
            <div className="font-bold text-primary flex items-center gap-2">
              <span>Reading List Filter Only</span>
            </div>
            <div className="text-[11px] text-secondary">
              Only dispatch notifications for series marked as &quot;Reading&quot; (skips Completed, Dropped, or Plan to Read)
            </div>
          </div>
          <input
            type="checkbox"
            checked={formData.notifyOnlyReadingStatus !== false}
            onChange={(e) => setFormData({ ...formData, notifyOnlyReadingStatus: e.target.checked })}
            className="w-5 h-5 accent-accent"
          />
        </label>
      </div>

      {/* Discord Webhook Card */}
      <div className="p-5 bg-app rounded-2xl border border-edge space-y-4">
        <div className="flex items-center justify-between">
          <div className="font-bold text-primary text-sm flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-indigo-500" />
            <span>Discord Rich Embed Webhook</span>
          </div>
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
            Discord API
          </span>
        </div>

        <div className="space-y-3 p-4 bg-surface rounded-xl border border-edge">
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <div className="font-bold text-primary">Enable Discord Notifications</div>
              <div className="text-[11px] text-secondary">Send embedded alerts with cover art and 1-click read buttons</div>
            </div>
            <input
              type="checkbox"
              checked={formData.discordWebhookEnabled || false}
              onChange={(e) => setFormData({ ...formData, discordWebhookEnabled: e.target.checked })}
              className="w-5 h-5 accent-accent"
            />
          </label>

          <div className="space-y-1.5 pt-1">
            <label className="font-bold text-secondary text-[11px]">Discord Webhook URL:</label>
            <input
              type="password"
              value={formData.discordWebhookUrl || ''}
              onChange={(e) => setFormData({ ...formData, discordWebhookUrl: e.target.value })}
              placeholder="https://discord.com/api/webhooks/..."
              className="w-full bg-app border border-edge rounded-lg px-3 py-2 text-primary text-xs font-mono"
            />
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-edge/60">
            <button
              type="button"
              onClick={handleTestDiscord}
              disabled={isTestingDiscord || !formData.discordWebhookUrl}
              className="px-4 py-2 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 font-bold text-xs flex items-center gap-2 cursor-pointer transition-all disabled:opacity-50"
            >
              {isTestingDiscord ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              <span>Send Test Discord Notification</span>
            </button>

            {discordTestStatus && (
              <span className={`text-xs font-semibold ${discordTestStatus.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
                {discordTestStatus.message}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Telegram Push Card */}
      <div className="p-5 bg-app rounded-2xl border border-edge space-y-4">
        <div className="flex items-center justify-between">
          <div className="font-bold text-primary text-sm flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-sky-500" />
            <span>Telegram Bot Push Notifications</span>
          </div>
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-sky-500/20 text-sky-300 border border-sky-500/30">
            Telegram Bot API
          </span>
        </div>

        <div className="space-y-3 p-4 bg-surface rounded-xl border border-edge">
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <div className="font-bold text-primary">Enable Telegram Alerts</div>
              <div className="text-[11px] text-secondary">Instant messages to your private Telegram chat or channel</div>
            </div>
            <input
              type="checkbox"
              checked={formData.telegramWebhookEnabled || false}
              onChange={(e) => setFormData({ ...formData, telegramWebhookEnabled: e.target.checked })}
              className="w-5 h-5 accent-accent"
            />
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div className="space-y-1.5">
              <label className="font-bold text-secondary text-[11px]">Telegram Bot Token:</label>
              <input
                type="password"
                value={formData.telegramBotToken || ''}
                onChange={(e) => setFormData({ ...formData, telegramBotToken: e.target.value })}
                placeholder="123456789:ABCdefGhIJKlmNoPQRstuVWXyz"
                className="w-full bg-app border border-edge rounded-lg px-3 py-2 text-primary text-xs font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <label className="font-bold text-secondary text-[11px]">Chat / Channel ID:</label>
              <input
                type="text"
                value={formData.telegramChatId || ''}
                onChange={(e) => setFormData({ ...formData, telegramChatId: e.target.value })}
                placeholder="@my_manga_channel or -100123456789"
                className="w-full bg-app border border-edge rounded-lg px-3 py-2 text-primary text-xs font-mono"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-edge/60">
            <button
              type="button"
              onClick={handleTestTelegram}
              disabled={isTestingTelegram || !formData.telegramBotToken || !formData.telegramChatId}
              className="px-4 py-2 rounded-xl bg-sky-600/20 hover:bg-sky-600/30 text-sky-300 border border-sky-500/30 font-bold text-xs flex items-center gap-2 cursor-pointer transition-all disabled:opacity-50"
            >
              {isTestingTelegram ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              <span>Send Test Telegram Message</span>
            </button>

            {telegramTestStatus && (
              <span className={`text-xs font-semibold ${telegramTestStatus.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
                {telegramTestStatus.message}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
