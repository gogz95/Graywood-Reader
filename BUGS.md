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

### [BUG-038] [Other Fault] The Summer at Her House
- **Status**: `open`
- **Priority**: `low`
- **Auto-fix**: `ask`
- **File(s)**: `server.ts (Live Source Extractor)`
- **Submitted-By**: Darkmodes (2026-08-21)
- **Description**: Flagged issue: Other Fault.

Series: The Summer at Her House (manhwa18_49b4deb55cd3fa03759fa463)
Source: Manhwa18
Flag reason: Other Fault

Loads wrong metadata for source
- **Steps to Reproduce**:
  1. 1. Open series "The Summer at Her House"
2. Trigger reading / metadata load
3. Observe: Other Fault
- **Expected**: Action completes without error.
- **Actual**: Issue occurs as described.


_No active bugs._

---

## Fixed Bugs (Archive)

> Bugs that have been resolved are moved here for historical reference.

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

