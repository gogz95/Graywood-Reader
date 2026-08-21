// ============================================================================
// WEBHOOK & PUSH NOTIFICATION SERVICE (Discord & Telegram)
// ============================================================================
// Dispatches rich embed webhooks to Discord and instant push notifications to
// Telegram channels/chats when the background auto-updater or catalog scanner
// detects new chapters for library series.
// ============================================================================

import { MangaItem } from "../../src/types";
import { appSettings } from "../appState";
import { logger } from "../logger";

export interface WebhookChapterPayload {
  title: string;
  chapterNumber: number;
  chapterTitle?: string;
  sourceName?: string;
  coverUrl?: string;
  readUrl?: string;
  timestamp?: string;
  releaseGroup?: string;
  status?: string;
  genres?: string[];
  rating?: number;
}

/**
 * Format and dispatch a rich embed payload to a Discord Webhook endpoint.
 */
export async function sendDiscordWebhook(
  webhookUrl: string,
  payload: WebhookChapterPayload
): Promise<{ success: boolean; error?: string }> {
  if (!webhookUrl || !webhookUrl.startsWith("https://discord.com/api/webhooks/")) {
    return { success: false, error: "Invalid Discord webhook URL." };
  }

  try {
    const embedFields: Array<{ name: string; value: string; inline?: boolean }> = [
      { name: "📖 Chapter", value: `**Chapter ${payload.chapterNumber}**${payload.chapterTitle ? ` — ${payload.chapterTitle}` : ''}`, inline: true },
      { name: "🌐 Source", value: payload.sourceName || "Kotatsu Direct", inline: true },
    ];

    if (payload.releaseGroup) {
      embedFields.push({ name: "👥 Scan Group", value: payload.releaseGroup, inline: true });
    }
    if (payload.status) {
      embedFields.push({ name: "📊 Status", value: payload.status.toUpperCase(), inline: true });
    }
    if (payload.genres && payload.genres.length > 0) {
      embedFields.push({ name: "🏷️ Genres", value: payload.genres.slice(0, 4).join(", "), inline: false });
    }

    const discordBody = {
      username: "Graywood Reader",
      avatar_url: "https://raw.githubusercontent.com/gogz95/Remix-ManhuaSync-to-a-reader/main/public/favicon.ico",
      embeds: [
        {
          title: `📢 New Chapter Released: ${payload.title}`,
          description: payload.readUrl
            ? `[👉 Click here to start reading Chapter ${payload.chapterNumber}](${payload.readUrl})`
            : undefined,
          url: payload.readUrl,
          color: 0x6366f1, // Indigo #6366f1
          fields: embedFields,
          thumbnail: payload.coverUrl ? { url: payload.coverUrl } : undefined,
          footer: {
            text: "Graywood Reader Auto-Tracker",
            icon_url: "https://raw.githubusercontent.com/gogz95/Remix-ManhuaSync-to-a-reader/main/public/favicon.ico",
          },
          timestamp: payload.timestamp || new Date().toISOString(),
        },
      ],
    };

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(discordBody),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return { success: false, error: `Discord HTTP ${res.status}: ${errText}` };
    }

    return { success: true };
  } catch (err: any) {
    logger.error("Webhook", "[Webhook Notifier] Discord dispatch failed", { error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Format and dispatch an HTML push message to a Telegram Bot API endpoint.
 */
export async function sendTelegramWebhook(
  botToken: string,
  chatId: string,
  payload: WebhookChapterPayload
): Promise<{ success: boolean; error?: string }> {
  if (!botToken || !chatId) {
    return { success: false, error: "Missing Telegram Bot Token or Chat ID." };
  }

  try {
    const cleanToken = botToken.trim().replace(/^bot/, '');
    const apiUrl = `https://api.telegram.org/bot${cleanToken}/sendMessage`;

    const lines = [
      `📚 <b>New Chapter Alert</b>: <b>${escapeHtml(payload.title)}</b>`,
      `📖 <b>Chapter</b>: ${payload.chapterNumber}${payload.chapterTitle ? ` — ${escapeHtml(payload.chapterTitle)}` : ''}`,
      `🌐 <b>Source</b>: ${escapeHtml(payload.sourceName || 'Kotatsu')}`,
    ];

    if (payload.releaseGroup) {
      lines.push(`👥 <b>Group</b>: ${escapeHtml(payload.releaseGroup)}`);
    }

    if (payload.readUrl) {
      lines.push(`\n🔗 <a href="${payload.readUrl}">Read Chapter ${payload.chapterNumber} Now</a>`);
    }

    const tgBody = {
      chat_id: chatId.trim(),
      text: lines.join("\n"),
      parse_mode: "HTML",
      disable_web_page_preview: false,
    };

    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tgBody),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !(data as any).ok) {
      return { success: false, error: (data as any).description || `Telegram HTTP ${res.status}` };
    }

    return { success: true };
  } catch (err: any) {
    logger.error("Webhook", "[Webhook Notifier] Telegram dispatch failed", { error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Primary dispatch entrypoint called by the background update worker.
 * Respects user preferences (e.g. notifyOnlyReadingStatus, disabled toggles).
 */
export async function dispatchNewChapterWebhooks(
  manga: MangaItem,
  newChapterNumber: number,
  options?: { chapterTitle?: string; readUrl?: string; scanGroup?: string; baseUrl?: string }
): Promise<{ discordSent: boolean; telegramSent: boolean; errors: string[] }> {
  const errors: string[] = [];
  let discordSent = false;
  let telegramSent = false;

  // Filter out series not currently in 'reading' status if setting is active
  if (appSettings.notifyOnlyReadingStatus && manga.status !== 'reading') {
    return { discordSent: false, telegramSent: false, errors: [] };
  }

  const readUrl = options?.readUrl || (options?.baseUrl ? `${options.baseUrl}/read/${manga.id}/${newChapterNumber}` : undefined);

  const payload: WebhookChapterPayload = {
    title: manga.title,
    chapterNumber: newChapterNumber,
    chapterTitle: options?.chapterTitle,
    sourceName: manga.sourceName,
    coverUrl: manga.coverImage,
    readUrl,
    releaseGroup: options?.scanGroup,
    status: manga.status,
    genres: manga.genres,
    rating: manga.rating,
    timestamp: new Date().toISOString(),
  };

  // 1. Dispatch Discord Webhook if enabled
  if (appSettings.discordWebhookEnabled && appSettings.discordWebhookUrl) {
    const res = await sendDiscordWebhook(appSettings.discordWebhookUrl, payload);
    if (res.success) {
      discordSent = true;
      logger.info("Webhook", `[Webhook Notifier] Sent Discord push for "${manga.title}" Ch. ${newChapterNumber}`);
    } else if (res.error) {
      errors.push(`Discord error: ${res.error}`);
    }
  }

  // 2. Dispatch Telegram Message if enabled
  if (appSettings.telegramWebhookEnabled && appSettings.telegramBotToken && appSettings.telegramChatId) {
    const res = await sendTelegramWebhook(appSettings.telegramBotToken, appSettings.telegramChatId, payload);
    if (res.success) {
      telegramSent = true;
      logger.info("Webhook", `[Webhook Notifier] Sent Telegram push for "${manga.title}" Ch. ${newChapterNumber}`);
    } else if (res.error) {
      errors.push(`Telegram error: ${res.error}`);
    }
  }

  return { discordSent, telegramSent, errors };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
