# 🗺️ Graywood Reader Feature Roadmap

This document outlines the planned future features, community requests, and architectural roadmap for **Graywood Reader**.

---

## 🔴 Critical Gaps (High Priority — Feature-Complete Parity)

> Based on competitive analysis vs. Mihon, Kotatsu-Redo, Suwayomi, Komga, and Paperback (Aug 2026). #1–5 are the blockers preventing feature-completeness.

### 🔄 1. New Chapter Push Notifications (Discord & Telegram Webhooks)
- Dispatch rich webhooks when scanner detects new chapters for "Reading" list series. Discord: embedded message with cover art, chapter number, release group, 1-click read link. Telegram: instant push notification to private chat/channel.

### 🗂️ 4. User-Defined Categories / Custom Shelves
- Visual shelf organization beyond flat tags (e.g. "Currently Reading", "Weekend Binge", "Dropped but Maybe"). Drag-and-drop, shelf-specific unread counters. Mirrors Kotatsu-Redo / Mihon.

### 🔒 5. App Lock (Password / PIN / Biometric)
- Require PIN, password, or biometric to open the app. Essential for self-hosted PWA + Electron. Mirrors Kotatsu-Redo.

---

## 🟡 Important Additions (Medium Priority)

### 📁 6. Full CBR / RAR / PDF Reader Integration
- Mount `/data/local_manga` with `.cbz`, `.cbr`, `.zip`, `.pdf`. Parse archive metadata, extract covers, index for offline reading. **Current: CBZ/ZIP only; CBR/RAR/PDF detected but no preview.** Mirrors Komga.

### 📡 7. Per-Series Source Pinning & Migration
- Pick source per-series. One-tap migration to alternate source when chapters are missing. Mirrors Mihon/Kotatsu-Redo.

### 🎮 8. Discord Rich Presence (RPC)
- Broadcast active reading session to Discord ("Reading Solo Leveling — Ch 142" with cover art + elapsed time).

### 🔄 9. Cross-Device Sync (Self-Hosted)
- Sync tokens for PWA ↔ Electron: reading progress, library, notes stay in sync. Mirrors Kotatsu-Redo.

### 💾 10. Scheduled Auto-Backups
- Auto Tachiyomi-format backups on schedule (daily/weekly). Currently manual-only. Mirrors Mihon.

---

## 🟢 Differentiators & Polish (Lower Priority)

### 🎨 11. Material You / System-Color-Adaptive Theming
- Dynamic theming that adapts to OS accent color. Especially impactful on Android PWA. Mirrors Mihon/Kotatsu-Redo.

### 📊 12. "Manga Wrapped" Recap + Reading Streaks & Trophies
- Spotify-Wrapped-style yearly/monthly recap: chapters read, pages turned, top genres, peak hours, heatmap. One-click shareable PNG export cards.

### 🏆 13. Reading Achievements & Milestone Badges
- 🥋 Martial God (500+ manhua ch), 🗡️ Solo Leveler (50+ manhwa), 🌙 Night Owl (10+ ch 1-4AM), ⚡ Binge King (100+ ch/24h), 📚 Grand Archivist (100+ series), 🔥 Streak Master (30-day streak). Profile showcase.

### 🎧 14. Reader Ambient Atmosphere & Soundtrack Engine
- 🌧️ Rain on Windowpane, ☕ Cozy Lo-Fi Coffee Shop, 🌲 Fantasy Forest & Campfire, 📖 Page Turn SFX. Volume slider, track switcher, auto-sleep timer in reader HUD.

### 🔍 15. Magnifier / Loupe Tool in Reader
- Long-press to zoom a panel without leaving the page. Mirrors Paperback.

### 🔌 16. Extension / Plugin System
- Community-maintained source plugins instead of vendored parsers. Big lift, huge ecosystem payoff. Mirrors Mihon.

### 🈳 17. Interactive Panel OCR & Live Translation Popover
- Select/hover untranslated dialogue bubbles → client-side OCR → floating English translation popover.

### 🎯 18. MangaDex as First-Class Reading Source
- Currently MangaDex is explicitly excluded from live reading (metadata-only per BUG-004). Re-enable as reliable fallback source.

### 📑 19. Dedicated "Discover" Tab with AI Recommendations
- Surface Gemini AI recommendations in a dedicated Discovery tab, not buried in Library. Mimic Kotatsu-Redo recommendation slider.

### 🖊️ 20. S Pen / Stylus Support
- Pressure-sensitive page turns and annotations for tablet users. Mirrors Paperback.

---

## 🚀 Implemented Milestones (Archive)

- ✅ **Double-Page Book Spread Mode** (Aug 2026)
- ✅ **IndexedDB Client Offline Chapter Caching** (Aug 2026)
- ✅ **Multi-Select Bulk Operations & Floating Toolbar** (Aug 2026)
- ✅ **Tachiyomi v2 / Mihon JSON Backup Migration** (Aug 2026)
- ✅ **OPDS 1.2 Catalog Feed Server for E-Readers** (Aug 2026)
- ✅ **AniList GraphQL Live Scrobbler** (Aug 2026)
- ✅ **Automated Cloudflare Turnstile & 2Captcha Bypass Engine** (Aug 2026)
- ✅ **Smart Guided Panel View & Snap-to-Panel** (Aug 2026)
- ✅ **GPU/Canvas Visual Filters (E-Ink, Sharpener, OLED, Sepia, Grayscale)** (Aug 2026)
- ✅ **Private Page Sticky Notes System** (Aug 2026)
- ✅ **Chapter N+1 Silent Background Prefetch Worker** (Aug 2026)
- ✅ **Server-Side Immutable Image Proxy Caching with HTTP 304 ETags** (Aug 2026)
- ✅ **Library View Virtualized Chunk Rendering** (Aug 2026)
- ✅ **Automated Unit Tests + GitHub Actions CI** (Aug 2026)
- ✅ **OPDS 1.2 Upgrade** — catalog search, pagination, cover proxying (Aug 2026)
- ✅ **Offline Storage Rework** — Blob-based, per-series storage, LRU eviction, Download All (Aug 2026)
- ✅ **Local CBZ / ZIP Library Ingestion** — STORAGE_PATH folder scanner, cover streaming (Aug 2026)
- ✅ **MyAnimeList (MAL) & Kitsu Live Scrobblers** — chapter progress sync alongside AniList (Aug 2026)
- ✅ **Incognito / Private Reading Mode** — no history, no scrobbling, no analytics, 👁️ Private badge (Aug 2026)
