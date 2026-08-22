# 🗺️ Graywood Reader Feature Roadmap

This document outlines the implemented milestones, architectural enhancements, and future backlog for **Graywood Reader**.

---

- ✅ **Strict 18+ / NSFW Guest Access Lockdown** (Aug 2026)
  - Unauthenticated remote clients and guest users (`usr_guest`) are completely blocked from viewing, browsing, searching, or reading adult explicit content (403 Forbidden with login modal prompts).
- ✅ **Full Router Modularization of `server.ts`** (Aug 2026)
  - Successfully modularized monolithic `server.ts` (~8,200 lines down to ~650 lines) into dedicated domain routers (`manga`, `reader`, `sources`, `explore`, `tracker`, `localLibrary`, `auth`, `admin`, `settings`, `categories`, `progress`, `notes`, `bugs`, `webhooks`, `gdpr`, `opds`).
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
- ✅ **OPDS 2.0 JSON Feed Protocol (`/api/opds/v2/catalog.json`)** (Aug 2026)
- ✅ **Dynamic Client Server Pairing Engine (`src/utils/api.ts`)** (Aug 2026)

---

## 🔮 Future Backlog

### 📱 Mobile & System Architecture Options (Self-Sustained App vs. Central Server)
- **Option A: Standalone Self-Sustained App (Local-First)**
  - Embedded SQLite storage (`wa-sqlite` / OPFS for Web PWA, `@capacitor-community/sqlite` for iOS/Android).
  - Client-side HTML scraper execution in browser/mobile webview with CORS proxy handling.
  - Direct offline chapter panel caching in IndexedDB / native mobile filesystem.
- **Option B: Central Server + Thin Client System (Self-Hosted Host)**
  - Dedicated 24/7 Graywood Reader Host (Docker / Home Server) for continuous background scraping, OPDS 1.2 / 2.0 feeds, and image cache warming.
  - Remote mobile (iOS/Android) and web thin clients communicating over REST, WebSockets / SSE, and OPDS.
- **Option C: Dual-Mode Hybrid Architecture (Recommended Master Plan)**
  - Zero-setup standalone offline reader out-of-the-box with optional server pairing (via URL or QR code) for bidirectional library & progress delta sync.

### 📖 Canvas-Based Landscape Spread Auto-Splitting (Mihon-Style)
- Automatically detect wide landscape double-page scans (`width > height * 1.2`) in manga/webtoon mode and split them into two sequential portrait pages for comfortable mobile viewing.

### 🏷️ Tri-State Category & Tag Filters (`Include` / `Exclude` / `Ignore`)
- Upgrade library and browse genre filters to 3-state logic (`+Include`, `-Exclude`, `Ignore`) to allow fine-grained catalog filtering (e.g. Include `Action` + `Fantasy`, but Exclude `Harem`).

### ⚡ Headless Next.js `buildId` In-Memory Caching
- Cache Next.js `buildId` for scrapers (e.g. FlameComics) in memory with a 10-minute TTL to avoid redundant homepage HTTP requests during batch library updates.

### 📚 EPUB & Light Novel Reflowable Text Viewer
- Integrate a dedicated reflowable text/EPUB reader engine (`epub.js`) with custom typography, font sizing, and chapter navigation for light novels and web novels.

### 🎮 Discord Rich Presence (RPC)
- Broadcast active reading session to Discord ("Reading Solo Leveling — Ch 142" with cover art + elapsed time) for desktop/Electron wrapper.

### 🈳 Interactive Panel OCR & Live Translation Popover
- Client-side OCR for untranslated dialogue bubbles with hover translation popover.

### 🖊️ S Pen / Stylus & Hardware Page Turners
- Pressure-sensitive annotations and Bluetooth page turner keybindings for tablet users.

---

## 🔧 Code Quality & Technical Debt

Issues identified during the 2026-08-21 full code review, ordered by impact.

### 🔴 Critical

- ✅ **Fix MangaDex chapter feed cap** — `refreshSingleMangaMetadata` upgraded to query the `/manga/{id}/aggregate` endpoint to obtain true total chapter numbers across all volumes without a 100-item pagination cap.
- ✅ **Add row-level ownership check on manga write endpoints** — Authenticated `user`-role accounts can only modify series that are unowned or explicitly owned by their account (`canModifyManga`), while `admin` and host requests retain full permissions.
- 🔄 **Continue router extraction from `server.ts`** — `server.ts` reduced from ~8,200 to ~6,680 lines with `categoriesRouter`, `metadataService`, and `mangaRouter` successfully extracted. Next phase: `/api/reader`, `/api/sources` / `/api/explore`, and `/api/ai`.

### 🟠 High Priority

- **Fix `autoBackupService` unencrypted PII** — `createBackupNow()` serializes `userProfiles` (email addresses + scrypt password hashes) in plaintext into `./data/backups/*.json`. Replace with `buildEncryptedProfiles()` from `appState.ts`.
- **Cache FlameComics `buildId`** — `fetchFlameSeriesContext()` fires an extra homepage HTTP request on every call to extract the Next.js `buildId`. Cache it in a module-level variable with a ~5-minute TTL to avoid N+1 fetches during auto-update scans.
- **Replace `KOTATSU_SOURCES.find` with `SOURCE_MAP` in hot loop** — `isSeriesFromDisabledSource()` calls `KOTATSU_SOURCES.find(s => s.id === disabledId)` inside a double loop (disabled sources × manga list). `SOURCE_MAP` already provides O(1) lookup via `getSourceById()`.
- **Optimize `calculateStringSimilarity` in Kotatsu merge engine** — The Levenshtein distance matrix is freshly allocated on every call. During `integrateKotatsuSourcesAndMerge()` this produces up to 400 000 matrix allocations for a 2 000-series library. Pre-build a normalized-title lookup map for O(1) exact matching; use the matrix only as a fallback.

### 🟡 Medium Priority

- ✅ **Fix `verifyAuthToken` base64url signature comparison** — Decodes both signature sides with `Buffer.from(sig, 'base64url')` before executing `crypto.timingSafeEqual`.

- **Fix `circuitBreaker.recordSuccess` resetting `tripCount` to 0** — A single successful HALF_OPEN probe resets the exponential backoff counter, meaning a flaky source always re-trips at 1× cooldown. Keep `tripCount` on success; reset only after N consecutive successes.

- **Fix WeebCentral fake `totalCount`** — `scrapeWeebCentral()` always returns `totalCount = items.length * 100`, breaking pagination in the Browse view. Parse the real count from the response HTML or return `-1` to indicate unknown.

- **`autoBackupService.listLocalBackups` reads every backup file on every list call** — Full JSON parse of every backup file just to extract `seriesCount`. Store the count in the filename suffix or a small `.meta` sidecar at creation time.

- **Remove duplicate `manhuaplus` / `manhuaplusorg` source entries** — Both IDs resolve to `https://manhuaplus.org`, causing duplicate scrape results and double entries in the Source Health Dashboard.

### 🟢 Low Priority / Style

- **`sqlite-db.ts` uses `console.log` instead of structured logger** — SQLite init messages bypass the `data/logs/` rotation files. Switch to `logger.info()`.

- **`logger.ts`: WARN writes to `stderr` instead of `stdout`** — Standard convention for log stream routing: WARN → stdout, ERROR → stderr. Update the `write()` function to route `LogLevel.WARN` to `process.stdout`.
