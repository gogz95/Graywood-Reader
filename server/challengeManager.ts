import { URL } from 'url';

export type ChallengeType =
  | 'cloudflare_turnstile'
  | 'cloudflare_ddos'
  | 'recaptcha'
  | 'hcaptcha'
  | 'bot_block'
  | 'unknown';

export interface ChallengeNotification {
  id: string;
  sourceId: string;
  sourceName: string;
  sourceUrl: string;
  sampleUrl?: string;
  challengeType: ChallengeType;
  httpStatus: number;
  detectedAt: string;
  resolved: boolean;
  resolvedAt?: string;
  siteKey?: string;
  message: string;
  suggestedAction: string;
}

export interface ChallengeNotificationConfig {
  inAppAlerts: boolean;
  soundAlerts: boolean;
  discordWebhookUrl?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
}

// In-memory active challenges with persistence support
const activeChallenges = new Map<string, ChallengeNotification>();
let notificationConfig: ChallengeNotificationConfig = {
  inAppAlerts: true,
  soundAlerts: true,
};

/**
 * Dispatch webhook notifications for new challenges (Discord / Telegram)
 */
async function dispatchWebhookNotification(challenge: ChallengeNotification) {
  // 1. Discord Webhook
  if (notificationConfig.discordWebhookUrl && notificationConfig.discordWebhookUrl.startsWith('http')) {
    try {
      await fetch(notificationConfig.discordWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'Graywood Reader Security',
          avatar_url: 'https://raw.githubusercontent.com/gogz95/Remix-ManhuaSync-to-a-reader/main/public/icon-512.png',
          embeds: [
            {
              title: `⚠️ Manual Captcha Required: ${challenge.sourceName}`,
              description: `A bot challenge was detected that requires manual verification.\n\n**Type:** \`${challenge.challengeType}\`\n**Status:** HTTP ${challenge.httpStatus}\n**Action:** [Open Source Page](${challenge.sourceUrl}) to solve challenge.`,
              color: 0xf59e0b, // Amber
              timestamp: new Date().toISOString(),
              footer: { text: 'Graywood Reader Challenge Watchdog' },
            },
          ],
        }),
      });
    } catch (err) {
      console.warn('[Challenge Watchdog] Failed to dispatch Discord webhook:', err);
    }
  }

  // 2. Telegram Webhook
  if (notificationConfig.telegramBotToken && notificationConfig.telegramChatId) {
    try {
      const text = `⚠️ *Manual Captcha Required*\n\n*Source:* ${challenge.sourceName}\n*Type:* \`${challenge.challengeType}\`\n*Status:* HTTP ${challenge.httpStatus}\n\n[Open Source to Solve](${challenge.sourceUrl})`;
      const tgUrl = `https://api.telegram.org/bot${notificationConfig.telegramBotToken}/sendMessage`;
      await fetch(tgUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: notificationConfig.telegramChatId,
          text,
          parse_mode: 'Markdown',
          disable_web_page_preview: false,
        }),
      });
    } catch (err) {
      console.warn('[Challenge Watchdog] Failed to dispatch Telegram notification:', err);
    }
  }
}

export const challengeManager = {
  /**
   * Register or update a challenge detected on a reading source.
   */
  recordChallenge(params: {
    sourceId: string;
    sourceName?: string;
    sourceUrl: string;
    sampleUrl?: string;
    challengeType: ChallengeType;
    httpStatus: number;
    siteKey?: string;
  }): ChallengeNotification {
    const { sourceId, sourceUrl, sampleUrl, challengeType, httpStatus, siteKey } = params;
    const sourceName = params.sourceName || sourceId;
    const id = `chn_${sourceId.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;

    const existing = activeChallenges.get(id);
    const isNew = !existing || existing.resolved;

    let message = `Cloudflare protection or captcha detected on ${sourceName}.`;
    let suggestedAction = `Open ${sourceUrl} in your browser to complete verification or configure FlareSolverr.`;

    if (challengeType === 'cloudflare_turnstile') {
      message = `Cloudflare Turnstile challenge active on ${sourceName}.`;
      suggestedAction = `Complete the Cloudflare check in your browser or solve with FlareSolverr / 2Captcha.`;
    } else if (challengeType === 'recaptcha' || challengeType === 'hcaptcha') {
      message = `Interactive ${challengeType.toUpperCase()} challenge active on ${sourceName}.`;
      suggestedAction = `Complete the puzzle verification directly in your browser.`;
    }

    const notification: ChallengeNotification = {
      id,
      sourceId,
      sourceName,
      sourceUrl,
      sampleUrl,
      challengeType,
      httpStatus,
      detectedAt: new Date().toISOString(),
      resolved: false,
      siteKey,
      message,
      suggestedAction,
    };

    activeChallenges.set(id, notification);

    if (isNew) {
      console.warn(`[Challenge Watchdog] Registered challenge alert for "${sourceName}" (${challengeType})`);
      dispatchWebhookNotification(notification).catch(() => {});
    }

    return notification;
  },

  /**
   * Mark a challenge as resolved when a source succeeds or manual clearance is verified.
   */
  resolveChallenge(sourceId: string): boolean {
    const id = `chn_${sourceId.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
    const existing = activeChallenges.get(id);
    if (existing && !existing.resolved) {
      existing.resolved = true;
      existing.resolvedAt = new Date().toISOString();
      activeChallenges.delete(id);
      console.log(`[Challenge Watchdog] Resolved challenge alert for "${existing.sourceName}"`);
      return true;
    }
    return false;
  },

  /**
   * Dismiss a challenge notification.
   */
  dismissChallenge(id: string): boolean {
    return activeChallenges.delete(id);
  },

  /**
   * Get all active, unresolved challenges.
   */
  getActiveChallenges(): ChallengeNotification[] {
    return Array.from(activeChallenges.values()).filter((c) => !c.resolved);
  },

  /**
   * Get notification configuration.
   */
  getConfig(): ChallengeNotificationConfig {
    return { ...notificationConfig };
  },

  /**
   * Update notification configuration.
   */
  updateConfig(updates: Partial<ChallengeNotificationConfig>): ChallengeNotificationConfig {
    notificationConfig = { ...notificationConfig, ...updates };
    return { ...notificationConfig };
  },

  /**
   * Clear all challenges (e.g. on test / reset).
   */
  clear(): void {
    activeChallenges.clear();
  },
};
