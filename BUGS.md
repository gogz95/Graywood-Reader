# 🐛 ManhuaSync Bug Tracker

> This file is the single source of truth for known bugs and issues.
> Add new bugs below. The AI will automatically check this file at the start of each session and either fix flagged bugs or ask for permission.

---

## How to Flag a Bug

Copy the template below and fill in the fields:

```
### [BUG-XXX] Short description of the bug
- **Status**: `open` | `in-progress` | `fixed` | `wontfix` | `needs-info`
- **Priority**: `critical` | `high` | `medium` | `low`
- **Auto-fix**: `yes` (fix without asking) | `ask` (ask permission first)
- **File(s)**: path/to/relevant/file.ts
- **Description**: Detailed description of the bug.
- **Steps to Reproduce**: (optional)
  1. Step 1
  2. Step 2
- **Expected**: What should happen.
- **Actual**: What actually happens.
```

---

## Active Bugs

### [BUG-050] [Does not load pages] Mia Has Returned
- **Status**: `open`
- **Priority**: `high`
- **Auto-fix**: `ask`
- **File(s)**: `server.ts (Live Source Extractor)`
- **Submitted-By**: Host Administrator (2026-08-26)
- **Description**: Flagged issue: Does not load pages.

Series: Mia Has Returned (kotatsu_1787654104822_205_miahasreturned)
Source: Aqua Manga
Flag reason: Does not load pages
- **Steps to Reproduce**:
  1. 1. Open series "Mia Has Returned"
2. Trigger reading / metadata load
3. Observe: Does not load pages
- **Expected**: Action completes without error.
- **Actual**: Issue occurs as described.


### [BUG-049] [Does not load pages] My Bias Gets on the Last Train
- **Status**: `open`
- **Priority**: `high`
- **Auto-fix**: `ask`
- **File(s)**: `server.ts (Live Source Extractor)`
- **Submitted-By**: Host Administrator (2026-08-26)
- **Description**: Flagged issue: Does not load pages.

Series: My Bias Gets on the Last Train (kotatsu_1787654104822_201_mybiasgetsonthel)
Source: MangaCute
Flag reason: Does not load pages
- **Steps to Reproduce**:
  1. 1. Open series "My Bias Gets on the Last Train"
2. Trigger reading / metadata load
3. Observe: Does not load pages
- **Expected**: Action completes without error.
- **Actual**: Issue occurs as described.


### [BUG-048] [Missing source] paragonscans.com
- **Status**: `open`
- **Priority**: `high`
- **Auto-fix**: `ask`
- **File(s)**: `server.ts (Live Source Extractor)`
- **Submitted-By**: Host Administrator (2026-08-26)
- **Description**: Flagged issue: Missing source.

Series: paragonscans.com (kotatsu_1787654104826_525_konobijutsubuniw)
Source: ParagonScans
Flag reason: Missing source
- **Steps to Reproduce**:
  1. 1. Open series "paragonscans.com"
2. Trigger reading / metadata load
3. Observe: Missing source
- **Expected**: Action completes without error.
- **Actual**: Issue occurs as described.


### [BUG-047] [Does not load pages] My Wife Is A Demon Queen
- **Status**: `open`
- **Priority**: `high`
- **Auto-fix**: `ask`
- **File(s)**: `server.ts (Live Source Extractor)`
- **Submitted-By**: Darkmodes (2026-08-25)
- **Description**: Flagged issue: Does not load pages.

Series: My Wife Is A Demon Queen (kotatsu_1787654104826_550_mywifeisademonqu)
Source: Mangaxyz
Flag reason: Does not load pages
- **Steps to Reproduce**:
  1. 1. Open series "My Wife Is A Demon Queen"
2. Trigger reading / metadata load
3. Observe: Does not load pages
- **Expected**: Action completes without error.
- **Actual**: Issue occurs as described.


### [BUG-045] ManhuaPlus catalogue/search returned 0 results after site theme migration
- **Status**: `fixed`
- **Priority**: `high`
- **Auto-fix**: `yes`
- **File(s)**: `server/scrapers/manhuaPlus.ts`, `server/services/crawlerEngine.ts`, `server/scrapers/madaraTheme.ts`
- **Description**: manhuaplus.top migrated off the WordPress Madara theme. The old `/manga/?m_orderby=views` catalogue, wp-admin AJAX chapter endpoint, and `/?s=&post_type=wp-manga` search all return 404, so the Madara-theme list scraper yielded 0 items.
- **Root cause**: scraper hard-coded the retired Madara markup/endpoints.
- **Fixed in**: 2026-08-24 — Rebuilt `manhuaPlus.ts` for the new WPComics-style theme (`/all-manga/{page}/?sort=views` cards at `div.item > figure`, search via `/filter?keyword=`, inline chapter list `#nt_listchapter`); marked its engine configs `madaraWithoutAjax: true`; added WPComics chapter containers to the generic chapter parser. Verified live: scrape + search + latest-chapter extraction.

### [BUG-046] Demonic Scans catalogue pagination param wrong & card markup changed
- **Status**: `fixed`
- **Priority**: `medium`
- **Auto-fix**: `yes`
- **File(s)**: `server/scrapers/demonicScans.ts`
- **Description**: demonicscans.org redesigned; pages past 1 were requested with `?page=N` which the site silently ignores (correct param is `?list=N`), and the old `.item / .box_list .item / .media` selectors no longer match the new `.updates-element` cards.
- **Fixed in**: 2026-08-24 — Rewrote listing parser for `.updates-element` cards with real latest-chapter extraction from `chaptered.php?...&chapter=N`, advanced-search parser for `/advanced.php?search=` (`.advanced-element`), correct `?list=` pagination, honest totalCount from the pagination widget, and URI-encoded cover URLs. Verified live.

---

## Fixed Bugs (Archive)


> Bugs that have been resolved are moved here for historical reference.

### [BUG-044] [Other Fault] ChristinaSiemone Cam Model: Free Live Sex Show & Chat (Popup Ad Injection)
- **Status**: `fixed`
- **Priority**: `high`
- **Auto-fix**: `ask`
- **File(s)**: `server/adFilter.ts`, `server/services/exploreService.ts`, `server/services/crawlerEngine.ts`, `server/services/metadataService.ts`, `src/utils/kotatsuImporter.ts`, `src/utils/metadataHelpers.ts`, `sqlite-db.ts`, `tests/engineParsers.test.ts`
- **Submitted-By**: Darkmodes (2026-08-23)
- **Description**: Flagged issue: Other Fault. Series "ChristinaSiemone Cam Model: Free Live Sex Show & Chat" (`kotatsu_1787348359960_598_nottobemissed`) from source MangaHentai was a sponsored adult cam model popup ad card injected by the site's layout and parsed as a real series.
- **Root cause**:
  1. The ad protection filter lacked heuristic title, URL, and spam pattern checking (`isAdTitle`, `isAdUrl`, `isAdSeries`) to detect sponsored cam/affiliate cards.
  2. DOM parsing in `exploreService.ts` (`parseUniversalCatalogCards`), `crawlerEngine.ts`, and `kotatsuImporter.ts` did not strip ad elements before extracting series cards and links.
  3. `parseGenericChapterListFromHtml` lacked dedicated container scoping and could pick up recommendation/ad links from sidebars.
- **Fixed in**: 2026-08-23 — Implemented `isAdTitle`, `isAdUrl`, and `isAdSeries` guards; added DOM ad element stripping before catalog card, chapter, and image extraction; isolated dedicated chapter wrappers from sidebar recommendations; added Kotatsu backup import ad filtering; and auto-sanitized ad/spam entries on SQLite startup.

### [BUG-043] Overnight Performance Degradation, Ballooning Auto-Updater & Scraper Leaks
- **Status**: `fixed`
- **Priority**: `high`
- **Auto-fix**: `yes`
- **File(s)**: `server.ts`, `server/routes/progress.ts`, `server/services/imageCache.ts`, `server/services/libraryCacheService.ts`, `server/services/metadataService.ts`, `server/services/crawlerEngine.ts`, `server/services/sourceHealthService.ts`, `src/utils/KotatsuImageLoader.ts`, `src/hooks/useGamepadNavigation.ts`, `src/types.ts`
- **Submitted-By**: Darkmodes (2026-08-23)
- **Description**: After leaving the server running overnight, the application experienced high lag, high memory consumption, and slow response times.
- **Root causes**:
  1. Auto-updater scanned all 2,039 series every 30m without prioritizing active/reading titles; `autoUpdateLogs` had no upper bound.
  2. `GET /api/reader/history` executed 2,039 synchronous SQLite queries in a loop.
  3. `ImageCacheService.pruneDiskCache` read every `.json` file on disk synchronously on random image writes.
  4. `buildLibraryCacheSnapshot` performed 2.4 million string comparisons in an $O(N \times M)$ loop.
  5. In-memory caches (`mangadexMetaCache`, `metadataCache`, `KotatsuImageEngine.pageListCache`) lacked upper capacity bounds and LRU eviction.
  6. `useGamepadNavigation` polled `requestAnimationFrame` continuously at 60-144 FPS even when idle with no gamepad connected.
  7. `KotatsuImageLoader` created un-cleared GC intervals and closures on chapter loads without a `destroy()` cleanup hook.
- **Fixed in**: 2026-08-23 — Prioritized active/reading series batches; capped `autoUpdateLogs` to 100 items; converted `/api/reader/history` to a single indexed SQL lookup; added in-memory disk index and 10m throttling for image cache pruning; pre-indexed library cache sources for $O(1)$ lookups; capped in-memory maps with LRU eviction; optimized gamepad RAF loop to run only when gamepads are attached; and implemented `destroy()` on `KotatsuImageLoader`.

### [BUG-042] Notifications on series with new chapters
- **Status**: `fixed`
- **Priority**: `medium`
- **Auto-fix**: `ask`
- **File(s)**: `src/components/LibraryView.tsx`
- **Submitted-By**: Darkmodes (2026-08-22)
- **Description**: All series in the library with new chapters showed a blinking (`animate-pulse`) "+N New" badge, causing constant CSS animation repaints across many cards and a performance hit.
- **Fixed in**: 2026-08-22 — Removed `animate-pulse` from the new-chapter badge in the library grid card (static badge now).

### [BUG-041] Everything is labeled manhua cn
- **Status**: `fixed`
- **Priority**: `medium`
- **Auto-fix**: `ask`
- **File(s)**: `src/components/LibraryView.tsx`, `src/components/MangaDetailModal.tsx`, `src/components/ChapterListModal.tsx`, `src/components/AutoUpdateView.tsx`, `src/components/OpenApiFinderView.tsx`, `src/components/reader/ReaderHeader.tsx`
- **Submitted-By**: Darkmodes (2026-08-22)
- **Description**: Type badges used two-way ternaries (`type === 'manhwa' ? 'Manhwa' : 'Manhua CN'`), so every non-manhwa series (including Japanese `manga` and `novel`) was labeled 🇨🇳 Manhua.
- **Fixed in**: 2026-08-22 — All type badges updated to four-way labels: 🇯🇵 Manga / 🇰🇷 Manhwa / 🇨🇳 Manhua / 📖 Novel, with matching badge colors.

### [BUG-040] [Other Fault] Solo Backup Leveling
- **Status**: `fixed`
- **Priority**: `high`
- **Auto-fix**: `ask`
- **File(s)**: `database.json`, SQLite `data/manga.db`
- **Submitted-By**: Darkmodes (2026-08-22)
- **Description**: Series "Solo Backup Leveling" (test_backup_series_1) was a leftover test fixture pointing at a non-existent Asura Scans URL (`/comics/solo-backup-leveling`), flagged "Other Fault".
- **Fixed in**: 2026-08-22 — Removed the test fixture entry from both database.json and the canonical SQLite database.

### [BUG-039] When refreshing metadata
- **Status**: `fixed`
- **Priority**: `medium`
- **Auto-fix**: `ask`
- **File(s)**: `server/routes/manga.ts`, `src/components/MangaDetailModal.tsx`
- **Submitted-By**: Darkmodes (2026-08-21)
- **Description**: When clicking the refresh metadata button on a series, it cleared the custom shelf selection (`categories`).
- **Root cause**:
  1. `POST /api/manga/:id/refresh-metadata` returned raw database items without applying `SqliteDb.applyUserOverlay([refreshed], uid)[0]`. Because shelf category assignments are stored per-user in SQLite table `manga_categories`, the response omitted `categories`.
  2. `MangaDetailModal` applied the response directly to `onUpdateManga`, replacing the series state with `categories: undefined` and resetting active checkboxes.
- **Fixed in**: 2026-08-22 — `POST /api/manga/:id/refresh-metadata` and `POST /api/manga/:id/pull-metadata-from-source` now resolve the request user and apply user shelf overlay; `MangaDetailModal` defensively preserves existing shelf categories during updates.

### [BUG-038] [Other Fault] The Summer at Her House (Wrong metadata loaded on live sources)
- **Status**: `fixed`
- **Priority**: `low`
- **Auto-fix**: `ask`
- **File(s)**: `server/services/metadataService.ts`, `server/routes/manga.ts`, `tests/engineParsers.test.ts`
- **Submitted-By**: Darkmodes (2026-08-21)
- **Description**: Series *The Summer at Her House* (`manhwa18_49b4deb55cd3fa03759fa463`) loaded wrong metadata from MangaDex instead of its Manhwa18 live source.
- **Root cause**:
  1. `refreshSingleMangaMetadata` executed a loose MangaDex fuzzy title search with a 60% similarity threshold whenever `mangaDexId` was unset, allowing unrelated MangaDex series to hijack live scraper series (Manhwa18, Madara, etc.).
  2. The service lacked live HTML series metadata extraction for Manhwa18 and other generic live sources.
- **Fixed in**: 2026-08-22 — Implemented `parseGenericLiveSeriesMetadata` and `fetchLiveSeriesMetadata` to extract real title, cover, synopsis, genres, and latest chapter directly from live source HTML pages; permanently disabled MangaDex fuzzy search hijacking on series with live reading URLs; tightened MangaDex standalone title matching threshold to $\ge 75\%$.

### [BUG-034] Server crashed at boot in production mode (httpServer TDZ ReferenceError)
- **Status**: `fixed`
- **Priority**: `critical`
- **Auto-fix**: `yes`
- **File(s)**: `server.ts`
- **Description**: `httpServer = app.listen(...)` was assigned inside `startServer()` (called at module load) while `let httpServer` was declared ~50 lines LATER in the file. In production mode (when `dist/` exists) the async function body runs synchronously up to `app.listen`, so the assignment hit the temporal dead zone and threw `ReferenceError: Cannot access 'httpServer' before initialization`, killing the process via an unhandled rejection. Dev mode (no `dist/`) survived only because `await import('vite')` deferred the assignment until after module init.
- **Steps to Reproduce**:
  1. `npm run build`
  2. `npm run dev` (or run the bundled server) with `dist/` present
  3. Process exits with the TDZ ReferenceError
- **Expected**: Server boots in both dev and production modes.
- **Actual**: Production boot crashed before serving any request.
- **Fixed in**: 2026-08-18 — Moved the `httpServer` / `isShuttingDown` declarations above `startServer()` with an explanatory comment. Verified boot + `/api/health` with `dist/` present.

### [BUG-035] OPDS `/api/opds/local/:id` route nested inside the series handler (route leak)
- **Status**: `fixed`
- **Priority**: `high`
- **Auto-fix**: `yes`
- **File(s)**: `server/routes/opds.ts`, `server.ts`
- **Description**: `opdsRouter.get('/api/opds/local/:id', ...)` was defined inside the chapter `for` loop of the `/api/opds/series/:id` handler. The route therefore (a) did not exist until the first series feed request and (b) was RE-REGISTERED once per chapter on every series request, leaking handler copies on the router indefinitely (memory growth + route bloat). Additionally, `server.ts` contained duplicate `/api/opds/catalog.xml` and `/api/opds/series/:id` handlers that were fully shadowed by `opdsRouter` (mounted first) — dead code.
- **Fixed in**: 2026-08-18 — Moved `/api/opds/local/:id` to module scope in `opds.ts` and removed the unreachable duplicate OPDS handlers from `server.ts`.

### [BUG-036] AI endpoints fabricated data when Gemini was unavailable
- **Status**: `fixed`
- **Priority**: `medium`
- **Auto-fix**: `yes`
- **File(s)**: `server.ts`, `src/components/AddEditModal.tsx`
- **Description**: `/api/ai/enrich-metadata` returned invented metadata (`latestChapter: 100/120`, `rating: 8.5/9.0`, generic genres/description) both when no `GEMINI_API_KEY` was configured and when the AI call failed — silently polluting the Add/Edit form. `/api/ai/find-similar` returned fake "recommendations". This contradicted the project's explicit "no fabricated fallbacks" policy (see BUG-007).
- **Fixed in**: 2026-08-18 — Both endpoints now return honest errors/empty results (503 without key, 502 on failure, `[]` for similar); `AddEditModal` surfaces the server error message instead of applying fake data. Also centralized the Gemini model name into a single `GEMINI_MODEL` constant.

### [BUG-037] Reading analytics never reported `favoriteGenre`; duplicate dismissal never wired
- **Status**: `fixed`
- **Priority**: `low`
- **Auto-fix**: `yes`
- **File(s)**: `server.ts`, `src/App.tsx`
- **Description**: `/api/reader/analytics` omitted `favoriteGenre` (required by the `ReadingAnalytics` type), so the Analytics modal always showed it empty. Separately, `DuplicateFinderView` exposes `onDismissDuplicate` and the server has `/api/tracker/dismiss-duplicate`, but `App.tsx` never passed the handler, so dismissing a duplicate was UI-local only and resurfaced on the next scan.
- **Fixed in**: 2026-08-18 — Analytics now computes the user's weighted favorite genre; `App.tsx` wires `handleDismissDuplicate` through to the existing endpoint.

### [BUG-033] App.tsx business logic monolith & blocking confirmation dialogs
- **Status**: `fixed`
- **Priority**: `medium`
- **Auto-fix**: `yes`
- **File(s)**: `src/App.tsx`, `src/hooks/useAuth.ts`, `src/hooks/useRouting.ts`, `src/hooks/useReaderSession.ts`, `src/components/ConfirmModal.tsx`
- **Description**: `App.tsx` contained over 1,100 lines combining auth, profiles, client session reading tracking, routing, and UI modals. Deleting series or resetting the DB used blocking synchronous `window.confirm()`.
- **Fixed in**: 2026-08-18 — Extracted modular custom hooks (`useAuth`, `useRouting`, `useReaderSession`) and created a sleek non-blocking `ConfirmModal` component.

### [BUG-010] Manhwa18 series collapsed to "Announcer Raw"
- **Status**: `fixed`
- **Priority**: `high`
- **Auto-fix**: `ask`
- **File(s)**: `server.ts` (`generateSourceScrapeId`), `sqlite-db.ts` (`rekeyCollidedSourceIds`)
- **Submitted-By**: Guest Reader (2026-08-12)
- **Description**: When clicking any series in the Manhwa18 source or refreshing metadata, every series resolved to "Announcer Raw".
- **Root cause**: The previous ID generator took only the first 16 base64url characters of the URL. Because every Manhwa18 series URL began with `https://manhwa18.com/`, every single series on the site generated the identical ID (`manhwa18_aHR0cHM6Ly9tYW5o`), collapsing the entire site's library into the first entry inserted ("Announcer Raw").
- **Fixed in**: 2026-08-13 — Switched `generateSourceScrapeId` to full-URL SHA-256 hashing and added a startup migration (`rekeyCollidedSourceIds()`) to automatically repair any collided records in SQLite.

### [BUG-009, BUG-012–032] Asura Scans "Does not load pages" on older chapters
- **Status**: `fixed`
- **Priority**: `high`
- **Auto-fix**: `ask`
- **File(s)**: `server.ts` (`fetchAsuraChapterList`, `extractLiveDomainChapterPages`), `src/App.tsx` (`handleOpenReader`)
- **Submitted-By**: Guest Reader (2026-08-12 to 2026-08-13)
- **Description**: Series flagged with "Does not load pages" (*Legend of the Northern Blade*, *Initializing the Sect System*, *Terminally-Ill Genius Dark Knight*, *Genius Prismatic Mage*, *The Forgotten Field*, *The Heavenly Demon Wants a Quiet Life*, *Pick Me Up, Infinite Gacha*, *Steel-Eating Player*, *The Academy’s Sashimi Sword Master*, *Nano Machine*, *The Former Supreme*, *Villain To Kill*, *Return of the Disaster-Class Hero*, *Kidnapped Dragons*, *The Demon God*, *Regressor Instruction Manual*, *The Knight King Who Returned with a God*, *Bad Born Blood*, *What a Bountiful Harvest, Demon Lord!*).
- **Root cause**:
  1. Stale mirror domains (`asuracomic.net` instead of `asurascans.com`).
  2. Asura's live API only hosts recent chapters for ongoing series and drops older chapters. When readers launched a series, the reader defaulted to Chapter 1, which returned 404 on Asura.
- **Fixed in**: 2026-08-13 — Deployed server-side Asura URL migration (`asuracomic.net` -> `asurascans.com`), anchored exact chapter resolution via `fetchAsuraChapterList`, honest `contentUnavailable` error signaling, and UI auto-resolution to the lowest/highest currently hosted chapter when chapter 1 is missing.

### [BUG-011] New reading-progress/analytics engine was backend-only — UI still showed mock data
- **Status**: `fixed`
- **Priority**: `medium`
- **Auto-fix**: `ask`
- **File(s)**: `server.ts`, `sqlite-db.ts`, `src/components/AnalyticsModal.tsx`, `src/components/ReaderView.tsx`
- **Submitted-By**: AI code review (2026-08-12)
- **Description**: Backend had progress and analytics endpoints, but `ReaderView` only used `mark-read` and `AnalyticsModal` showed mock stats.
- **Fixed in**: 2026-08-13 — `AnalyticsModal` fetches `/api/reader/analytics`; `ReaderView` posts `/api/reader/progress` (debounced) and resumes from `/api/reader/history/:mangaId`.

### [BUG-007] Wrong chapter silently substituted across sources
- **Status**: `fixed`
- **Priority**: `high`
- **Auto-fix**: `ask`
- **File(s)**: `server.ts`
- **Fixed in**: 2026-08-11 — Removed wrong-chapter fallbacks; missing chapters now return explicit 404/null rather than loading a random chapter.

### [BUG-008] Manual metadata edits disappeared after a metadata refresh
- **Status**: `fixed`
- **Priority**: `high`
- **Auto-fix**: `yes`
- **File(s)**: `server.ts`, `src/components/AddEditModal.tsx`, `sqlite-db.ts`, `src/types.ts`
- **Fixed in**: 2026-08-12 — Added `metadataOverrides` array to `MangaItem` persisted in SQLite.

### [BUG-003] Page and chapter counter
- **Status**: `fixed`
- **Priority**: `medium`
- **Auto-fix**: `ask`
- **File(s)**: `src/components/SettingsModal.tsx`, `src/components/ReaderView.tsx`
- **Fixed in**: 2026-08-11 — Added toggle in Settings and semi-transparent styling.

### [BUG-004] Wrong series fetched when entering reading mode
- **Status**: `fixed`
- **Priority**: `high`
- **Auto-fix**: `ask`
- **File(s)**: `server.ts`
- **Fixed in**: 2026-08-11 — MangaDex reading permanently disabled for live reading feeds; only series' own live source URLs are used.

### [BUG-005] Catalog had no 18+ filtering and showed duplicate series
- **Status**: `fixed`
- **Priority**: `medium`
- **Auto-fix**: `ask`
- **File(s)**: `src/components/BrowseView.tsx`
- **Fixed in**: 2026-08-11 — Added `isAdultManga()` and `dedupeCatalog()` with source-merging.

### [BUG-006] MangaDex used for reading when no live source available
- **Status**: `fixed`
- **Priority**: `high`
- **Auto-fix**: `ask`
- **File(s)**: `server.ts`, `src/types.ts`
- **Fixed in**: 2026-08-11 — Safeguarded reading sources to exclude MangaDex.

### [BUG-001] Disabled sources still being toggled via old localStorage state
- **Status**: `fixed`
- **Priority**: `medium`
- **Auto-fix**: `ask`
- **File(s)**: `src/components/KotatsuSourcesView.tsx`, `server.ts`
- **Fixed in**: 2026-08-11 — Server disabled states persisted in `syncConfig.disabledSources`.

### [BUG-002] Night Scans SSL certificate error on image extraction
- **Status**: `fixed`
- **Priority**: `low`
- **Auto-fix**: `ask`
- **File(s)**: `server.ts`
- **Fixed in**: 2026-08-11 — Extraction check strictly filters against disabled source IDs.

### [BUG-033] SSRF DNS rebinding TOCTOU vulnerability
- **Status**: `fixed`
- **Priority**: `high`
- **Auto-fix**: `yes`
- **File(s)**: `server/security.ts`, `tests/security.test.ts`
- **Description**: `assertSafeProxyTarget` resolved DNS and validated IPs, but a subsequent `fetch()` executed its own independent DNS resolution, leaving a TOCTOU window for DNS rebinding attacks.
- **Fixed in**: 2026-08-21 — Implemented custom Undici `Agent` (`ssrfSafeAgent`) with socket connection-level DNS lookup validation in `fetchWithSsrfGuard`.

### [BUG-034] Local library full filesystem rescan and archive unzipping on every page request
- **Status**: `fixed`
- **Priority**: `high`
- **Auto-fix**: `yes`
- **File(s)**: `server/routes/localLibrary.ts`, `tests/localLibrary.test.ts`
- **Description**: `findArchive(id)` called `scanStorage()` on every page stream (`/api/local/library/:id/page/:n`), walking the entire directory tree and opening every CBZ in the library via AdmZip.
- **Fixed in**: 2026-08-21 — Introduced in-memory archive caching with mtime/size change tracking, 60s TTL, O(1) ID lookups, and a `POST /api/local/library/rescan` endpoint.

### [BUG-035] PII encryption failed open to plaintext on cipher errors
- **Status**: `fixed`
- **Priority**: `medium`
- **Auto-fix**: `yes`
- **File(s)**: `server/security.ts`, `tests/security.test.ts`
- **Description**: `encryptPII` caught cipher errors and silently returned raw plaintext without error signaling.
- **Fixed in**: 2026-08-21 — Updated `encryptPII` to throw an explicit `Error` on cipher failure to ensure GDPR compliance (fail-closed).

### [BUG-036] AES key derivation truncated long encryption secrets
- **Status**: `fixed`
- **Priority**: `low`
- **Auto-fix**: `yes`
- **File(s)**: `server/security.ts`, `tests/security.test.ts`
- **Description**: `padEnd(32).slice(0, 32)` silently truncated secrets longer than 32 characters and null-padded short ones without cryptographic domain separation.
- **Fixed in**: 2026-08-21 — Derived a 32-byte key via HKDF-SHA256 with seamless backward-compatible decryption for legacy ciphertexts.

### [BUG-037] Duplicated scraper logic for Flame Comics and Asura Scans
- **Status**: `fixed`
- **Priority**: `medium`
- **Auto-fix**: `yes`
- **File(s)**: `server/scrapers/flameComics.ts`, `server/scrapers/asuraScans.ts`, `server.ts`
- **Description**: Metadata refresh and chapter parsing logic for Flame Comics (Next.js buildId discovery) and Asura Scans (slug token normalization and chapter fetching) were duplicated in multiple places in `server.ts`.
- **Fixed in**: 2026-08-21 — Centralized scraper operations into `server/scrapers/flameComics.ts` and `server/scrapers/asuraScans.ts`.

