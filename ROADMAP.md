# 🗺️ Graywood Reader Feature Roadmap

This document outlines the implemented milestones, architectural enhancements, and future backlog for **Graywood Reader**.

---

## 🏆 Implemented Milestones (Archive)

- ✅ **Strict 18+ / NSFW Guest Access Lockdown** (Aug 2026)
  - Unauthenticated remote clients and guest users (`usr_guest`) are completely blocked from viewing, browsing, searching, or reading adult explicit content (403 Forbidden with login modal prompts).
- ✅ **Full Router Modularization of `server.ts`** (Aug 2026)
  - Successfully modularized monolithic `server.ts` (~8,200 lines down to ~490 lines) into dedicated domain routers (`manga`, `reader`, `sources`, `explore`, `tracker`, `localLibrary`, `auth`, `admin`, `settings`, `categories`, `progress`, `notes`, `bugs`, `webhooks`, `gdpr`, `opds`).
- ✅ **Scheduled Automated Local Backups (`/data/backups/`)** (Aug 2026)
  - Configurable background backup worker with rolling retention limit, PII encryption at rest, and full UI controls in Settings to create, download, delete, and 1-click restore backup snapshots.
- ✅ **Frontend Source Health Dashboard UI** (Aug 2026)
  - Real-time diagnostic monitors across 1,180+ Kotatsu, Madara, and MangaThemesia sources with live latency probes, Cloudflare challenge alerts, and circuit breaker reset controls.
- ✅ **Reading Achievements & "Manga Wrapped" Recap Engine** (Aug 2026)
  - Milestone trophies (🥋 Martial God, 🗡️ Solo Leveler, 📚 Grand Archivist, 🔥 Streak Master, etc.) and Spotify-Wrapped-style recap cards with top genre breakdown and clipboard sharing.
- ✅ **Reader Ambient Atmosphere & White Noise Audio Engine** (Aug 2026)
  - 100% offline procedural Web Audio synthesizer (Rain on Glass, Campfire Crackle, Ocean Waves, Cozy Cafe, and tactile Page-turn SFX) with reader HUD volume and sleep timer.
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
- ✅ **OPDS 2.0 JSON Feed Protocol (`/api/opds/v2/catalog.json`)** (Aug 2026)
- ✅ **AniList, MyAnimeList & Kitsu Live Scrobblers** (Aug 2026)
- ✅ **Automated Cloudflare Turnstile & 2Captcha Bypass Engine** (Aug 2026)
- ✅ **Smart Guided Panel View & Snap-to-Panel** (Aug 2026)
- ✅ **Dynamic Client Server Pairing Engine (`src/utils/api.ts`)** (Aug 2026)
- ✅ **Discord Rich Presence (RPC) Desktop Integration** (Aug 2026)

- ✅ **Canvas Landscape Spread Auto-Splitting (Mihon-Style)** (Aug 2026)
  - Automatically slices double-page spreads into sequential portrait pages with correct Japanese Manga (RTL) and Comic (LTR) reading order.
- ✅ **Tri-State Category & Genre Filtering (`+Include` / `-Exclude` / `Neutral`)** (Aug 2026)
  - 3-state cycling tag pills in Library and Browse views for fine-grained catalog discovery backed by `includeTags` and `excludeTags`.
- ✅ **Headless Next.js `buildId` In-Memory Caching & Deduplication** (Aug 2026)
  - 10-minute TTL cache with atomic pending promise deduplication and automated mirror rotation in `flameComics.ts`.
- ✅ **Real-Time SSE Reading Session Sync** (Aug 2026)
  - Live Server-Sent Events stream (`/api/reader/sync/events`) and client hook `useLiveReadingSessionSync` for instant cross-device continuity.
- ✅ **EPUB & Light Novel Reflowable Text Viewer** (Aug 2026)
  - Full `.epub` ZIP package/manifest/spine parser in `localLibrary.ts` and reflowable typography reader mode in `ReaderView.tsx`.
- ✅ **Komga / Tachiyomi Compatibility API Layer** (Aug 2026)
  - Complete Komga REST API v1 endpoints (`/api/v1/series`, `/api/v1/books`, `/api/v1/libraries`, `/api/v1/readlists`) enabling 3rd-party clients (**Paperback**, **Mihon**, **Panels**, **KOReader**) to connect.
- ✅ **Smart Dynamic Shelves & Playlists** (Aug 2026)
  - Virtual category shelves automatically populated by custom filter rules (*Unread Catch-Up*, *Top Tier Gems*, *Recently Updated*, *Status*).
- ✅ **Community Source Extension Store & Live Selector Debugger** (Aug 2026)
  - Extension Manager modal (`ExtensionManagerModal.tsx`) with community scraper presets and live CSS selector testing sandbox (`/api/extensions/test-selector`).
- ✅ **Interactive Panel OCR & Live Translation Popover** (Aug 2026)
  - Client-side canvas contrast thresholding and translation popover (`ocrEngine.ts`) for raw dialogue extraction.
- ✅ **Hardware Page Turners, Gamepad & Stylus / S-Pen Support** (Aug 2026)
  - `useGamepadNavigation.ts` hook supporting Nintendo Joy-Cons, Bluetooth remotes, and S-Pen air gestures.
- ✅ **E-Ink Display Monochrome Dithering & High-Contrast Mode** (Aug 2026)
  - Floyd-Steinberg 1-bit error diffusion algorithm and `.e-ink-mode` zero-animation CSS styles.
- ✅ **OIDC / Authentik / Keycloak Single Sign-On (SSO)** (Aug 2026)
  - OpenID Connect endpoints in `auth.ts` and SSO login button in `AuthModal.tsx`.
- ✅ **Automatic Domain Migration Resolver** (Aug 2026)
  - Automated mirror fallback and SQLite database `sourceUrl` updates in `sourceHealthService.ts`.
- ✅ **WeebCentral Exact Chapter Count & Sort Engine** (Aug 2026)
  - Numeric chapter sorting and full chapter list pagination.

---

## 🔮 Strategic Master Plan: 4 Next-Gen Tracks

### 🎯 Track 1: Reader Core Polish & Visual Performance (Active 🟢)
- **Dynamic Webtoon Image Virtualization**:
  - Off-screen image recycling with height preservation for 100+ page chapters to eliminate browser memory bloat and scroll stutter.
- **Fluid Pinch-to-Zoom & Double-Tap Smart Zoom**:
  - Touch gesture pinch-to-zoom, double-tap 2x toggle, keyboard (`+`/`-`/`0`), and desktop `Ctrl + Wheel` zooming with pan clamping.
- **In-Reader Mirror & Alternative Source Switcher**:
  - Instant source swapping modal in HUD and error views to seamlessly fall back to MangaDex or Kotatsu mirrors without leaving the reader.

---

### 🛡️ Track 2: Source Reliability & Resilient Server Download Manager (Upcoming 🟡)
- **Dedicated Background Server Download Manager**:
  - Priority queue with auto-retries on 429/503 HTTP rate limits and bandwidth throttling.
- **Universal `ComicInfo.xml` Standard Compliance**:
  - Automatic bidirectional reading and writing of `ComicInfo.xml` metadata inside local and downloaded `.cbz` archives for 100% interoperability with Komga, Kavita, and Mihon.
- **Per-Domain Leaky-Bucket Rate Limiting**:
  - Dynamic host request scheduling to prevent Cloudflare Turnstile triggers and IP bans.

---

### 📚 Track 3: Smart Dynamic Shelves & Custom Readlists (Upcoming 🟡)
- **Rule-Based Dynamic Virtual Shelves**:
  - Auto-updating smart collections (*"Unread Catch-Up"*, *"High Priority"*, *"Ongoing Manhwa"*, *"Completed Gems"*) backed by custom query criteria.
- **Cross-Series Story Arcs & Readlists**:
  - Chronological multi-series playlists and crossover reading lists with custom chapter order.
- **Granular Multi-User Permissions & Age Ratings**:
  - Per-account age gates (PG vs 18+ strict locks) and independent multi-user reading progress.

---

### 📦 Track 4: Native Packaging & Local-First Browser Distribution (Future ⚪)
- **Capacitor Mobile Shell (Android & iOS)**:
  - Wrap React client with `@capacitor/core` and `@capacitor-community/sqlite` for direct APK and mobile app store distribution.
- **Local-First PWA with Origin Private File System (OPFS)**:
  - In-browser SQLite relational engine (`wa-sqlite`) for zero-server, 100% offline standalone usage.
- **Tauri / Electron Native Desktop Distribution**:
  - Standalone desktop bundle with native tray controls and file system hooks.

---

## 🔧 Code Quality & Maintenance Tracking

### 🟢 Completed / Resolved
- ✅ **Full router modularization** (`server.ts` separated into 17 clean domain routers).
- ✅ **AutoBackupService encryption** (now encrypts PII using `buildEncryptedProfiles()`).
- ✅ **Row-level manga ownership check** (`canModifyManga` implemented).
- ✅ **MangaDex aggregate endpoint integration** (accurate total chapter counters).
- ✅ **Token signature constant-time verification** (`crypto.timingSafeEqual`).
- ✅ **Fast O(1) disabled source lookups** (`SOURCE_MAP` resolution).
- ✅ **FlameComics `buildId` cache & atomic promise deduplication**.
- ✅ **WeebCentral exact chapter count parser & numeric sorter**.
- ✅ **Structured logger migration in SQLite engine** (standardized log levels to `logger.info`).

