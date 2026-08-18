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

_No active bugs._

---

## Fixed Bugs (Archive)

> Bugs that have been resolved are moved here for historical reference.

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
