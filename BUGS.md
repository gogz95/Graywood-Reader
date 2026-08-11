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

### [BUG-003] Page and chapter counter
- **Status**: `fixed`
- **Priority**: `medium`
- **Auto-fix**: `ask`
- **File(s)**: `server.ts`
- **Submitted-By**: Guest Reader (2026-08-10)
- **Description**: Needs to be able to be turned on or off and more transparent
- **Fixed in**: 2026-08-11 — Added a "Per-Page Number Counter" toggle in Settings → Reader (controls the `showPageNumberOverlay` setting, previously had no UI toggle). Both the persistent chapter/page badge and the per-page counter are now semi-transparent (`bg-slate-900/50` / `bg-slate-950/40` with softened borders & text) and the badge no longer intercepts clicks. Files: `src/components/SettingsModal.tsx`, `src/components/ReaderView.tsx`.

### [BUG-004] Wrong series fetched when entering reading mode
- **Status**: `fixed`
- **Priority**: `high`
- **Auto-fix**: `ask`
- **File(s)`: `server.ts` (`/api/reader/chapter-pages`)
- **Description**: When a series had no `apiId` and direct live-source extraction failed (e.g. 18+ Manhwa18 series blocked by anti-bot), the MangaDex title-search fallback grabbed `searchData.data?.[0]` (the FIRST search result) and silently fetched a completely different series with a similar title.
- **Steps to Reproduce**:
  1. Open a series whose sourceUrl can't be extracted and that has no `apiId`.
  2. Enter reading mode.
  3. A wrong, unrelated series' chapters/pages are shown.
- **Expected**: Only the correct series should be loaded, or a placeholder with the correct title if the source can't be resolved.
- **Actual**: A random/first-match MangaDex series with a similar title is loaded.
- **Fixed in**: 2026-08-11 — MangaDex has been removed as a reading source entirely. It remains available for metadata/enrichment/covers but is **never** used to resolve chapter images. The handler resolves reading from the series' own live source URL, and otherwise falls through to a generated placeholder panel with the correct title. `hasWorkingReaderSource()` in `types.ts` now returns `false` for a series that only has a MangaDex `apiId` without a live source URL. This supersedes the earlier similarity-gated fallback fix.

### [BUG-005] Catalog had no 18+ filtering and showed duplicate series
- **Status**: `fixed`
- **Priority**: `medium`
- **Auto-fix**: `ask`
- **File(s)`: `src/components/BrowseView.tsx`
- **Description**: The "Unified Catalog" mixed 18+/adult series (genres `18+`/`Adult`/`Ecchi`/... and sources like Manhwa18) into the same list with no way to hide or isolate them, and the same series could appear multiple times (across sources or duplicated within a source).
- **Fixed in**: 2026-08-11 — Expanded 18+ detection with a comprehensive `isAdultManga()` helper that checks genres, source name/url, `syncedFromApi`, and `availableSources` (plus many additional adult genre tags). Reworked dedup with `dedupeCatalog()`: keys on `apiId` when present (source-independent), groups same-title entries into buckets, only merges when there is no apiId conflict (two series with DIFFERENT apiIds sharing a title stay separate), and calls `mergeMangaItems()` which unions `availableSources`/`altTitles`/`genres`, keeps the highest chapter & rating, and prefers the readable variant — so duplicates are **merged, not dropped**, and no sources or alt-titles are lost. Files: `src/components/BrowseView.tsx`.

### [BUG-006] MangaDex used for reading when no live source available
- **Status**: `fixed`
- **Priority**: `high`
- **Auto-fix**: `ask`
- **File(s)**: `server.ts` (`/api/reader/chapter-pages`), `src/types.ts` (`hasWorkingReaderSource`)
- **Description**: Series with only a MangaDex `apiId` (no live source) would load MangaDex feed chapters in the reader. This produced wrong content for adult/explicit series excluded from MangaDex reader feeds, and non-existent/chapter-empty reads.
- **Fixed in**: 2026-08-11 — MangaDex reading is permanently disabled (see BUG-004). Exported `isMangaDexSourceLink()` in `types.ts` checks both `sourceName` and `sourceUrl` for MangaDex references. `hasWorkingReaderSource()` now returns `false` for any source that matches `isMangaDexSourceLink()` — including merged entries where the base `availableSources` contain a mix of MangaDex + other sources (the other source is promoted for reading). Server-side guard in `server.ts` blocks `mangadex.org` URLs from entering the live crawler resolution. Metadata features (search, enrichment, covers via `/api/mangadex/*`) remain fully operational.


### [BUG-001] Disabled sources still being toggled via old localStorage state
- **Status**: `fixed`
- **Priority**: `medium`
- **Auto-fix**: `ask`
- **File(s)**: `src/components/KotatsuSourcesView.tsx`, `server.ts`
- **Description**: Stale localStorage keys caused phantom toggle calls. Server disabled states are now master source of truth, persisted in `syncConfig.disabledSources` across server restarts.

### [BUG-002] Night Scans SSL certificate error on image extraction
- **Status**: `fixed`
- **Priority**: `low`
- **Auto-fix**: `ask`
- **File(s)**: `server.ts` (Live Source Extractor)
- **Description**: Extraction check now strictly filters against `disabledSourceIds` so disabled domains are never fetched.
