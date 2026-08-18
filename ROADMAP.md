# 🗺️ Graywood Reader Feature Roadmap

This document outlines the planned future features, community requests, and architectural roadmap for **Graywood Reader**.

---

## 🔜 Next Up — Planned (Queued)

The following are explicitly queued as the immediate next features (recorded here so they are tracked):

- 🔔 **Discord & Telegram New-Chapter Webhooks** — Dispatch rich embeds/instant pushes from the live auto-updater scan when it detects new chapters for series in your *Reading* list. *(See Category 3 → 2 below.)*
- 📊 **"Manga Wrapped" Recap + Reading Streaks & Trophies** — Spotify-Wrapped-style yearly/monthly recap, streak counters, and milestone badges driven by the existing `reading_activity` analytics. *(See Category 1 → 1 & 2 below.)*

---

## 🎮 Category 1: Gamification & Fun Additions

### 🏆 1. Reading Achievements, Trophies & Milestones System
- **Milestone Badges**:
  - 🥋 **Martial God**: Read 500+ chapters of Chinese Manhua.
  - 🗡️ **Solo Leveler**: Complete 50+ Korean Manhwa.
  - 🌙 **Night Owl**: Read 10+ chapters between 1:00 AM and 4:00 AM.
  - ⚡ **Binge King**: Read 100+ chapters in a single 24-hour window.
  - 📚 **Grand Archivist**: Track 100+ unique series across your library.
  - 🔥 **Streak Master**: Maintain a 30-day continuous reading streak.
- **Profile Showcase**: Display earned badges on user avatars and in the profile modal.

### 📊 2. "Manga Wrapped" — Annual & Monthly Reading Recap
- **Spotify-Wrapped Style Recap Cards**:
  - Total chapters read and estimated pages turned.
  - Top 3 favorite genres and most binged series.
  - Fastest completed series and reading time heatmap.
  - Peak reading hours analysis.
- **One-Click Shareable Export**: Download high-resolution PNG summary cards for social sharing.

### 🎧 3. Reader Ambient Atmosphere & Soundtrack Engine
- **In-Reader Ambient Audio Mixer**:
  - 🌧️ *Rain on Windowpane*
  - ☕ *Cozy Lo-Fi Coffee Shop*
  - 🌲 *Fantasy Forest & Crackling Campfire*
  - 📖 *Subtle Tactile Page Turn SFX*
- **Controls**: Integrated volume slider, track switcher, and auto-sleep timer in the reader HUD.

### 🈳 4. Interactive Panel OCR & Live Translation Popover
- **On-Demand OCR**: Select or hover over untranslated raw Japanese, Korean, or Chinese dialogue bubbles to run client-side text recognition.
- **Instant Translation**: Display translated English text in a sleek floating popover.

---

## 🌐 Category 3: Cloud & Cross-Platform Integrations

### 🔄 1. MyAnimeList (MAL) & Kitsu Live Scrobblers
- **Multi-Platform Scrobbling**:
  - In addition to AniList GraphQL scrobbling, provide OAuth2 sync for **MyAnimeList** and **Kitsu**.
  - Automatically update chapter numbers and status (`Reading`, `Completed`) across all connected platforms.

### 🔔 2. Discord & Telegram Chapter Release Webhooks
- **Automated New Chapter Notifications**:
  - When the background scanner detects a new chapter for any series in your "Reading" list, dispatch a rich webhook.
  - **Discord Webhook**: Sends an embedded message with series cover art, chapter number, release group, and direct 1-click read link.
  - **Telegram Bot**: Sends instant push notifications to your private Telegram chat or channel.

### 🎮 3. Discord Rich Presence (RPC)
- **Live Status Broadcast**:
  - Broadcast your active reading session to Discord (*"Reading Solo Leveling — Chapter 142"* with series cover artwork and reading elapsed time).

### 📁 4. Local CBZ / CBR / ZIP / PDF Reader Integration
- **Local Directory Ingestion**:
  - Mount a local directory (e.g. `/data/local_manga`) containing `.cbz`, `.cbr`, `.zip`, or `.pdf` files.
  - Automatically parse archive metadata, extract covers, and index chapters for offline reading alongside online scraper sources.

---

## 🚀 Implemented Milestones (Archive)

- ✅ **Double-Page Book Spread Mode (`viewMode: 'double'`)** (Aug 2026)
- ✅ **IndexedDB Client Offline Chapter Caching** (Aug 2026)
- ✅ **Multi-Select Bulk Operations & Floating Toolbar** (Aug 2026)
- ✅ **Tachiyomi v2 / Mihon JSON Backup Migration** (Aug 2026)
- ✅ **OPDS 1.2 Catalog Feed Server for E-Readers** (Aug 2026)
- ✅ **AniList GraphQL Live Scrobbler** (Aug 2026)
- ✅ **Automated Cloudflare Turnstile & 2Captcha Bypass Engine** (Aug 2026)
- ✅ **Smart Guided Panel View & Snap-to-Panel** (Aug 2026)
- ✅ **GPU/Canvas Visual Filters (E-Ink, Line-Art Sharpener, OLED Ultra-Black)** (Aug 2026)
- ✅ **Private Page Sticky Notes System** (Aug 2026)
- ✅ **Chapter N+1 Silent Background Prefetch Worker** (Aug 2026)
- ✅ **Server-Side Immutable Image Proxy Caching with HTTP 304 ETags** (Aug 2026)
- ✅ **Library View Virtualized Chunk Rendering** (Aug 2026)
- ✅ **Automated Unit Tests + GitHub Actions CI** — Vitest + Supertest covering the security/SSRF/rate-limit helpers (`npm test`) (Aug 2026)
- ✅ **OPDS 1.2 Upgrade** — catalog search (`/api/opds/search`), `startIndex`/`maxRecords` pagination, same-origin cover proxying, and browser-usable HTML chapter acquisition links (Aug 2026)
- ✅ **Offline Storage Rework** — Blob-based page storage, per-series storage usage, LRU eviction, and **Download All Chapters** bulk offline download from the chapter list (Aug 2026)
- ✅ **Local CBZ / ZIP Library Ingestion** — `STORAGE_PATH` folder scanner with cover + page streaming and add-to-library endpoints (CBR/PDF detected; full preview limited to ZIP-based archives) (Aug 2026)
