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

---

## 🔮 Future Backlog & Feature Additions

### 🥇 Priority 1: High-Impact Core Reader & Catalog Upgrades

#### 📖 1. Canvas-Based Landscape Spread Auto-Splitting (Mihon-Style)
- **Goal**: Automatically detect double-page spreads (`width > height * 1.25`) in manga mode and split them via an offscreen HTML5 `<canvas>` into two sequential portrait pages (Right-to-Left for Manga, Left-to-Right for Comics).
- **Target Files**: [ReaderView.tsx](file:///e:/Project/Graywood-Reader/src/components/ReaderView.tsx), [KotatsuImageLoader.ts](file:///e:/Project/Graywood-Reader/src/utils/KotatsuImageLoader.ts), [readingMode.ts](file:///e:/Project/Graywood-Reader/src/utils/readingMode.ts).
- **User Impact**: Eliminates tiny unreadable double-spreads on mobile devices and portrait tablets.

#### 🏷️ 2. Tri-State Category & Genre Filtering (`+Include` / `-Exclude` / `Ignore`)
- **Goal**: Upgrade Library and Browse filters to 3-state cycle logic (`+Action`, `+Fantasy`, `-Harem`, `-Mecha`, `Ignore`) for fine-grained catalog discovery.
- **Target Files**: [BrowseView.tsx](file:///e:/Project/Graywood-Reader/src/components/BrowseView.tsx), [LibraryView.tsx](file:///e:/Project/Graywood-Reader/src/components/LibraryView.tsx), [explore.ts](file:///e:/Project/Graywood-Reader/server/routes/explore.ts).
- **User Impact**: Enables precise filtering without unwanted tropes polluting search results.

#### ⚡ 3. Headless Next.js `buildId` In-Memory Caching
- **Goal**: Cache the Next.js `buildId` extracted from scraper landing pages (e.g. FlameComics) in memory with a 10-minute TTL.
- **Target Files**: [flameComics.ts](file:///e:/Project/Graywood-Reader/server/scrapers/flameComics.ts), [crawlerEngine.ts](file:///e:/Project/Graywood-Reader/server/services/crawlerEngine.ts).
- **User Impact**: Eliminates redundant N+1 homepage HTTP requests during batch library update sweeps.

---

### 🥈 Priority 2: Ecosystem, Multi-Device & Content Expansion

#### 🌐 4. Real-Time WebSocket / SSE Reading Session Sync
- **Goal**: Broadcast reading progress, page position, and completed chapters live across active clients via Server-Sent Events (SSE) or WebSockets.
- **Target Files**: [server.ts](file:///e:/Project/Graywood-Reader/server.ts), [progress.ts](file:///e:/Project/Graywood-Reader/server/routes/progress.ts), [useReaderSession.ts](file:///e:/Project/Graywood-Reader/src/hooks/useReaderSession.ts).
- **User Impact**: Seamless device switching (e.g. reading on desktop, picking up phone immediately at exact page).

#### 📚 5. EPUB & Light Novel Reflowable Text Viewer
- **Goal**: Integrate a dedicated reflowable text/EPUB reader engine (`epub.js` or clean HTML DOM parser) with customizable typography (Serif, Sans, OpenDyslexic, line-height, text size, and dark/sepia themes) for web/light novel series.
- **Target Files**: [ReaderView.tsx](file:///e:/Project/Graywood-Reader/src/components/ReaderView.tsx), [localLibrary.ts](file:///e:/Project/Graywood-Reader/server/routes/localLibrary.ts), [types.ts](file:///e:/Project/Graywood-Reader/src/types.ts).
- **User Impact**: Unified reader for both manga adaptations and their original source light novels.

#### 🔌 6. Komga / Tachiyomi / Suwayomi Compatibility API Layer
- **Goal**: Implement standard Komga REST API endpoints (`/api/v1/series`, `/api/v1/books`) and OPDS-PS (Page Streaming) protocols.
- **Target Files**: [opds.ts](file:///e:/Project/Graywood-Reader/server/routes/opds.ts), `server/routes/komgaCompat.ts`.
- **User Impact**: Allows native mobile apps (**Paperback** on iOS, **Mihon / TachiJ2K** on Android, **YACReader**) to use Graywood Reader as their remote sync and storage backend.

#### 📂 7. Smart Dynamic Shelves & Playlists
- **Goal**: Virtual category shelves automatically populated by custom filter rules (e.g. *"Unread Catch-Up"*, *"Completed Top Tier ($>9.0$)"*, *"Updated this Week"*).
- **Target Files**: [categories.ts](file:///e:/Project/Graywood-Reader/server/routes/categories.ts), [ManageCategoriesModal.tsx](file:///e:/Project/Graywood-Reader/src/components/ManageCategoriesModal.tsx), [LibraryView.tsx](file:///e:/Project/Graywood-Reader/src/components/LibraryView.tsx).

---

### 🥉 Priority 3: Hardware Immersion & Advanced Automation

#### 🧩 8. Community Source Extension Store & Live Selector Debugger
- **Goal**: Frontend extension manager on top of [extensionEngine.ts](file:///e:/Project/Graywood-Reader/server/sources/extensionEngine.ts) to install community scraper plugins via GitHub/Gist URLs and test CSS selectors live in the browser.
- **Target Files**: [extensionEngine.ts](file:///e:/Project/Graywood-Reader/server/sources/extensionEngine.ts), `src/components/ExtensionManagerModal.tsx`.

#### 🈳 9. Interactive Panel OCR & Live Translation Popover
- **Goal**: Client-side WebAssembly OCR (Tesseract / Manga OCR) allowing users to box dialogue bubbles on raw Korean/Japanese/Chinese scans and view an instant translation popover.
- **Target Files**: `src/utils/ocrEngine.ts`, [ReaderView.tsx](file:///e:/Project/Graywood-Reader/src/components/ReaderView.tsx).

#### 🖊️ 10. Hardware Page Turners, Gamepad & Stylus / S-Pen Support
- **Goal**: Bluetooth presentation remotes, Nintendo Switch Joy-Con / Gamepad bindings, and Samsung S-Pen air actions for hands-free reading.
- **Target Files**: [ReaderView.tsx](file:///e:/Project/Graywood-Reader/src/components/ReaderView.tsx), `src/hooks/useGamepadNavigation.ts`.

#### 📟 11. E-Ink Display Monochrome Dithering & High-Contrast Mode
- **Goal**: Dedicated 1-bit Floyd-Steinberg dithering canvas shader and zero-animation mode optimized for Boox, Kindle, and Kobo e-reader web browsers.
- **Target Files**: [ReaderView.tsx](file:///e:/Project/Graywood-Reader/src/components/ReaderView.tsx), [types.ts](file:///e:/Project/Graywood-Reader/src/types.ts).

#### 🔐 12. OIDC / Authentik / Keycloak Single Sign-On (SSO)
- **Goal**: OpenID Connect / OAuth2 authentication provider support for unified self-hosted homelab identity management.
- **Target Files**: [security.ts](file:///e:/Project/Graywood-Reader/server/security.ts), [auth.ts](file:///e:/Project/Graywood-Reader/server/routes/auth.ts), [AuthModal.tsx](file:///e:/Project/Graywood-Reader/src/components/AuthModal.tsx).

#### 🔄 13. Automatic Domain Migration Resolver
- **Goal**: Automated mirror fallback when scanlation sites rotate domains (e.g. `.com` $\to$ `.xyz` $\to$ `.to`), automatically migrating series `sourceUrl`s upon consecutive DNS failures.
- **Target Files**: [crawlerEngine.ts](file:///e:/Project/Graywood-Reader/server/services/crawlerEngine.ts), [sourceHealthService.ts](file:///e:/Project/Graywood-Reader/server/services/sourceHealthService.ts).

---

## 📱 Mobile & System Architecture Strategies

### 1. Option A: Standalone Self-Sustained App (Local-First)
- Embedded SQLite storage (`wa-sqlite` / OPFS for Web PWA, `@capacitor-community/sqlite` for iOS/Android).
- Client-side HTML scraper execution in browser/mobile webview with CORS proxy handling.
- Direct offline chapter panel caching in IndexedDB / native mobile filesystem.

### 2. Option B: Central Server + Thin Client System (Self-Hosted Host)
- Dedicated 24/7 Graywood Reader Host (Docker / Home Server) for continuous background scraping, OPDS 1.2 / 2.0 feeds, and image cache warming.
- Remote mobile (iOS/Android) and web thin clients communicating over REST, WebSockets / SSE, and OPDS.

### 3. Option C: Dual-Mode Hybrid Architecture (Recommended Master Plan)
- Zero-setup standalone offline reader out-of-the-box with optional server pairing (via URL or QR code) for bidirectional library & progress delta sync.

---

## 🔧 Code Quality & Maintenance Tracking

### 🟢 Completed / Resolved
- ✅ **Full router modularization** (`server.ts` separated into 17 clean domain routers).
- ✅ **AutoBackupService encryption** (now encrypts PII using `buildEncryptedProfiles()`).
- ✅ **Row-level manga ownership check** (`canModifyManga` implemented).
- ✅ **MangaDex aggregate endpoint integration** (accurate total chapter counters).
- ✅ **Token signature constant-time verification** (`crypto.timingSafeEqual`).
- ✅ **Fast O(1) disabled source lookups** (`SOURCE_MAP` resolution).

### 🟡 In Progress / Scheduled
- 🔄 **FlameComics `buildId` cache** (scheduled with Priority 1 optimizations).
- 🔄 **WeebCentral exact chapter count parser** (improving browse pagination accuracy).
- 🔄 **Structured logger migration in SQLite engine** (standardizing log levels to `logger.info`).
