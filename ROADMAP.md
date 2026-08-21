# 🗺️ Graywood Reader Feature Roadmap

This document outlines the implemented milestones, architectural enhancements, and future backlog for **Graywood Reader**.

---

## 🚀 Implemented Milestones (Completed)

- ✅ **Scheduled Automated Local Backups (`/data/backups/`)** (Aug 2026)
  - Configurable background backup worker with rolling retention limit.
  - Full UI controls in Settings to create, download, delete, and 1-click restore backup snapshots.
- ✅ **Frontend Source Health Dashboard UI** (Aug 2026)
  - Real-time diagnostic monitors across 1,180+ Kotatsu, Madara, and MangaThemesia sources.
  - Live latency probes, Cloudflare challenge alerts, and circuit breaker reset controls.
- ✅ **Reading Achievements & "Manga Wrapped" Recap Engine** (Aug 2026)
  - Milestone trophies (🥋 Martial God, 🗡️ Solo Leveler, 📚 Grand Archivist, 🔥 Streak Master, etc.).
  - Spotify-Wrapped-style recap cards with top genre breakdown, format distribution, and clipboard sharing.
- ✅ **Reader Ambient Atmosphere & White Noise Audio Engine** (Aug 2026)
  - 100% offline procedural Web Audio synthesizer (Rain on Glass, Campfire Crackle, Ocean Waves, Cozy Cafe, and tactile Page-turn SFX).
  - Reader HUD ambient controls with volume slider, sleep timer, and soundscape switcher.
- ✅ **MangaDex Direct Reading Fallback** (Aug 2026)
  - Direct `@home` CDN chapter page streaming and feed fallback for scanlation titles.
- ✅ **Weeb Central Dedicated Scraper & Universal Challenge Bypass Engine** (Aug 2026)
  - Native AJAX browsing, searching, and long-strip high-res panel streaming.
- ✅ **Node.js 24 Upgrade & Hardened Alpine Containerization** (Aug 2026)
- ✅ **New Chapter Push Notifications (Discord & Telegram Webhooks)** (Aug 2026)
- ✅ **App Lock (Password / PIN / Biometric)** (Aug 2026)
- ✅ **Local Library Scanner (CBZ / ZIP / CBR / RAR / PDF metadata)** (Aug 2026)
- ✅ **Double-Page Book Spread Mode** (Aug 2026)
- ✅ **IndexedDB Client Offline Chapter Caching** (Aug 2026)
- ✅ **Multi-Select Bulk Operations & Floating Toolbar** (Aug 2026)
- ✅ **Tachiyomi v2 / Mihon / Kotatsu Backup Migration** (Aug 2026)
- ✅ **OPDS 1.2 Catalog Feed Server for E-Readers** (Aug 2026)
- ✅ **AniList, MyAnimeList & Kitsu Live Scrobblers** (Aug 2026)
- ✅ **Automated Cloudflare Turnstile & 2Captcha Bypass Engine** (Aug 2026)
- ✅ **Smart Guided Panel View & Snap-to-Panel** (Aug 2026)

---

## 🔮 Future Backlog

### 🎮 Discord Rich Presence (RPC)
- Broadcast active reading session to Discord ("Reading Solo Leveling — Ch 142" with cover art + elapsed time) for desktop/Electron wrapper.

### 🈳 Interactive Panel OCR & Live Translation Popover
- Client-side OCR for untranslated dialogue bubbles with hover translation popover.

### 🖊️ S Pen / Stylus & Hardware Page Turners
- Pressure-sensitive annotations and Bluetooth page turner keybindings for tablet users.
