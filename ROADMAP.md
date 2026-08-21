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

---

## 🔧 Code Quality & Technical Debt

Issues identified during the 2026-08-21 full code review, ordered by impact.

### 🔴 Critical

- **Fix MangaDex chapter feed cap** — `refreshSingleMangaMetadata` fetches the chapter feed with `limit=100`, silently truncating series with 100+ chapters and causing `latestChapter` to be under-reported. Switch to the `/manga/{id}/aggregate` endpoint (returns real totals without pagination).

- **Continue router extraction from `server.ts`** — The file is ~7 800 lines. The router extraction pattern (`authRouter`, `adminRouter`, `settingsRouter`, etc.) needs to extend to the remaining inline route groups: `/api/manga`, `/api/reader`, `/api/explore`, and `/api/tracker`.

- **Add row-level ownership check on manga write endpoints** — Authenticated `user`-role accounts can currently overwrite another user's series row. When `manga.userId` is set, `PATCH`/`PUT` handlers should reject writes from a different user unless the actor is `admin`.

### 🟠 High Priority

- **Fix `autoBackupService` unencrypted PII** — `createBackupNow()` serializes `userProfiles` (email addresses + scrypt password hashes) in plaintext into `./data/backups/*.json`. Replace with `buildEncryptedProfiles()` from `appState.ts`.

- **Cache FlameComics `buildId`** — `fetchFlameSeriesContext()` fires an extra homepage HTTP request on every call to extract the Next.js `buildId`. Cache it in a module-level variable with a ~5-minute TTL to avoid N+1 fetches during auto-update scans.

- **Replace `KOTATSU_SOURCES.find` with `SOURCE_MAP` in hot loop** — `isSeriesFromDisabledSource()` calls `KOTATSU_SOURCES.find(s => s.id === disabledId)` inside a double loop (disabled sources × manga list). `SOURCE_MAP` already provides O(1) lookup via `getSourceById()`.

- **Optimize `calculateStringSimilarity` in Kotatsu merge engine** — The Levenshtein distance matrix is freshly allocated on every call. During `integrateKotatsuSourcesAndMerge()` this produces up to 400 000 matrix allocations for a 2 000-series library. Pre-build a normalized-title lookup map for O(1) exact matching; use the matrix only as a fallback.

### 🟡 Medium Priority

- **Fix `verifyAuthToken` base64url signature comparison** — `Buffer.from(sig)` decodes as UTF-8, not base64url, so `timingSafeEqual` compares mismatched byte encodings. Fix: decode both sides with `Buffer.from(sig, 'base64url')` before comparing.

- **Fix `circuitBreaker.recordSuccess` resetting `tripCount` to 0** — A single successful HALF_OPEN probe resets the exponential backoff counter, meaning a flaky source always re-trips at 1× cooldown. Keep `tripCount` on success; reset only after N consecutive successes.

- **Fix WeebCentral fake `totalCount`** — `scrapeWeebCentral()` always returns `totalCount = items.length * 100`, breaking pagination in the Browse view. Parse the real count from the response HTML or return `-1` to indicate unknown.

- **`autoBackupService.listLocalBackups` reads every backup file on every list call** — Full JSON parse of every backup file just to extract `seriesCount`. Store the count in the filename suffix or a small `.meta` sidecar at creation time.

- **Remove duplicate `manhuaplus` / `manhuaplusorg` source entries** — Both IDs resolve to `https://manhuaplus.org`, causing duplicate scrape results and double entries in the Source Health Dashboard.

### 🟢 Low Priority / Style

- **`sqlite-db.ts` uses `console.log` instead of structured logger** — SQLite init messages bypass the `data/logs/` rotation files. Switch to `logger.info()`.

- **`logger.ts`: WARN writes to `stderr` instead of `stdout`** — Standard convention for log stream routing: WARN → stdout, ERROR → stderr. Update the `write()` function to route `LogLevel.WARN` to `process.stdout`.
