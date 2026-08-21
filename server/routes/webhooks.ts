// ============================================================================
// WEBHOOKS API ROUTER
// ============================================================================
// Provides test dispatch endpoints for verifying Discord & Telegram push webhook
// connections from the settings interface.
// ============================================================================

import { Router } from "express";
import { appSettings } from "../appState";
import { sendDiscordWebhook, sendTelegramWebhook } from "../services/webhookNotifier";

export const webhooksRouter = Router();

// POST /api/webhooks/test-discord
webhooksRouter.post("/api/webhooks/test-discord", async (req, res) => {
  try {
    const webhookUrl = req.body?.webhookUrl || appSettings.discordWebhookUrl;
    if (!webhookUrl) {
      return res.status(400).json({ success: false, error: "No Discord webhook URL provided." });
    }

    const testPayload = {
      title: "Solo Leveling: Ragnarok (Test Notification)",
      chapterNumber: 42,
      chapterTitle: "The Monarch Returns",
      sourceName: "Asura Scans",
      coverUrl: "https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=600&auto=format&fit=crop&q=80",
      releaseGroup: "Asura Team",
      status: "reading",
      genres: ["Action", "Fantasy", "Supernatural"],
      rating: 9.8,
      timestamp: new Date().toISOString(),
    };

    const result = await sendDiscordWebhook(webhookUrl, testPayload);
    if (result.success) {
      res.json({ success: true, message: "Discord test notification sent successfully!" });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/webhooks/test-telegram
webhooksRouter.post("/api/webhooks/test-telegram", async (req, res) => {
  try {
    const botToken = req.body?.botToken || appSettings.telegramBotToken;
    const chatId = req.body?.chatId || appSettings.telegramChatId;
    if (!botToken || !chatId) {
      return res.status(400).json({ success: false, error: "Missing Telegram Bot Token or Chat ID." });
    }

    const testPayload = {
      title: "Omniscient Reader's Viewpoint (Test Notification)",
      chapterNumber: 215,
      chapterTitle: "Ep. 42 - Asmodeus",
      sourceName: "Flame Comics",
      coverUrl: "https://images.unsplash.com/photo-1578632767115-351597cf2477?w=600&auto=format&fit=crop&q=80",
      releaseGroup: "Flame Scans",
      status: "reading",
      timestamp: new Date().toISOString(),
    };

    const result = await sendTelegramWebhook(botToken, chatId, testPayload);
    if (result.success) {
      res.json({ success: true, message: "Telegram test notification sent successfully!" });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
