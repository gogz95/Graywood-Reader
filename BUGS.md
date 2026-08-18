# ðŸ› ManhuaSync Bug Tracker

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

> **2026-08-13 maintenance:** Server-side Asura URL migration (`asuracomic.net` -> `asurascans.com`), Manhwa18 series-only catalog scrape, honest `contentUnavailable` reader responses, and UI open-to-latest-hosted-chapter are deployed. Re-verify individual Asura "Does not load pages" flags after restart - many were caused by opening chapter 1 when the source only hosts later chapters, or by stale domains. Keep open until spot-checked.

### [BUG-032] [Does not load pages] What a Bountiful Harvest, Demon Lord!
- **Status**: `open`
- **Priority**: `high`
- **Auto-fix**: `ask`
- **File(s)**: `server.ts (Live Source Extractor)`
- **Submitted-By**: Guest Reader (2026-08-13)
- **Description**: Flagged issue: Does not load pages.

Series: What a Bountiful Harvest, Demon Lord! (asura_what-a-bountiful-harvest-demon-lord)
Source: Asura Scans
Flag reason: Does not load pages
- **Steps to Reproduce**:
  1. 1. Open series "What a Bountiful Harvest, Demon Lord!"
2. Trigger reading / metadata load
3. Observe: Does not load pages
- **Expected**: Action completes without error.
- **Actual**: Issue occurs as described.


### [BUG-031] [Does not load pages] Bad Born Blood
- **Status**: `open`
- **Priority**: `high`
- **Auto-fix**: `ask`
- **File(s)**: `server.ts (Live Source Extractor)`
- **Submitted-By**: Guest Reader (2026-08-13)
- **Description**: Flagged issue: Does not load pages.

Series: Bad Born Blood (asura_bad-born-blood)
Source: Asura Scans
Flag reason: Does not load pages
- **Steps to Reproduce**:
  1. 1. Open series "Bad Born Blood"
2. Trigger reading / metadata load
3. Observe: Does not load pages
- **Expected**: Action completes without error.
- **Actual**: Issue occurs as described.


### [BUG-030] [Does not load pages] The Knight King Who Returned with a God
- **Status**: `open`
- **Priority**: `high`
- **Auto-fix**: `ask`
- **File(s)**: `server.ts (Live Source Extractor)`
- **Submitted-By**: Guest Reader (2026-08-13)
- **Description**: Flagged issue: Does not load pages.

Series: The Knight King Who Returned with a God (asura_the-knight-king-who-returned-with-a-god)
Source: Asura Scans
Flag reason: Does not load pages
- **Steps to Reproduce**:
  1. 1. Open series "The Knight King Who Returned with a God"
2. Trigger reading / metadata load
3. Observe: Does not load pages
- **Expected**: Action completes without error.
- **Actual**: Issue occurs as described.


### [BUG-029] [Does not load pages] Regressor Instruction Manual
- **Status**: `open`
- **Priority**: `high`
- **Auto-fix**: `ask`
- **File(s)**: `server.ts (Live Source Extractor)`
- **Submitted-By**: Guest Reader (2026-08-13)
- **Description**: Flagged issue: Does not load pages.

Series: Regressor Instruction Manual (asura_regressor-instruction-manual)
Source: Asura Scans
Flag reason: Does not load pages
- **Steps to Reproduce**:
  1. 1. Open series "Regressor Instruction Manual"
2. Trigger reading / metadata load
3. Observe: Does not load pages
- **Expected**: Action completes without error.
- **Actual**: Issue occurs as described.


### [BUG-028] [Does not load pages] The Demon God
- **Status**: `open`
- **Priority**: `high`
- **Auto-fix**: `ask`
- **File(s)**: `server.ts (Live Source Extractor)`
- **Submitted-By**: Guest Reader (2026-08-13)
- **Description**: Flagged issue: Does not load pages.

Series: The Demon God (asura_the-demon-god)
Source: Asura Scans
Flag reason: Does not load pages
- **Steps to Reproduce**:
  1. 1. Open series "The Demon God"
2. Trigger reading / metadata load
3. Observe: Does not load pages
- **Expected**: Action completes without error.
- **Actual**: Issue occurs as described.


### [BUG-027] [Does not load pages] The Demon God
- **Status**: `open`
- **Priority**: `high`
- **Auto-fix**: `ask`
- **File(s)**: `server.ts (Live Source Extractor)`
- **Submitted-By**: Guest Reader (2026-08-13)
- **Description**: Flagged issue: Does not load pages.

Series: The Demon God (asura_the-demon-god)
Source: Asura Scans
Flag reason: Does not load pages
- **Steps to Reproduce**:
  1. 1. Open series "The Demon God"
2. Trigger reading / metadata load
3. Observe: Does not load pages
- **Expected**: Action completes without error.
- **Actual**: Issue occurs as described.


### [BUG-026] [Does not load pages] Terminally-Ill Genius Dark Knight
- **Status**: `open`
- **Priority**: `high`
- **Auto-fix**: `ask`
- **File(s)**: `server.ts (Live Source Extractor)`
- **Submitted-By**: Guest Reader (2026-08-13)
- **Description**: Flagged issue: Does not load pages.

Series: Terminally-Ill Genius Dark Knight (asura_terminally-ill-genius-dark-knight)
Source: Asura Scans
Flag reason: Does not load pages
- **Steps to Reproduce**:
  1. 1. Open series "Terminally-Ill Genius Dark Knight"
2. Trigger reading / metadata load
3. Observe: Does not load pages
- **Expected**: Action completes without error.
- **Actual**: Issue occurs as described.


### [BUG-025] [Does not load pages] Initializing the Sect System
- **Status**: `open`
- **Priority**: `high`
- **Auto-fix**: `ask`
- **File(s)**: `server.ts (Live Source Extractor)`
- **Submitted-By**: Guest Reader (2026-08-13)
- **Description**: Flagged issue: Does not load pages.

Series: Initializing the Sect System (asura_initializing-the-sect-system)
Source: Asura Scans
Flag reason: Does not load pages
- **Steps to Reproduce**:
  1. 1. Open series "Initializing the Sect System"
2. Trigger reading / metadata load
3. Observe: Does not load pages
- **Expected**: Action completes without error.
- **Actual**: Issue occurs as described.


### [BUG-024] [Does not load pages] Kidnapped Dragons
- **Status**: `open`
- **Priority**: `high`
- **Auto-fix**: `ask`
- **File(s)**: `server.ts (Live Source Extractor)`
- **Submitted-By**: Guest Reader (2026-08-13)
- **Description**: Flagged issue: Does not load pages.

Series: Kidnapped Dragons (asura_kidnapped-dragons)
Source: Asura Scans
Flag reason: Does not load pages
- **Steps to Reproduce**:
  1. 1. Open series "Kidnapped Dragons"
2. Trigger reading / metadata load
3. Observe: Does not load pages
- **Expected**: Action completes without error.
- **Actual**: Issue occurs as described.


### [BUG-023] [Does not load pages] Return of the Disaster-Class Hero
- **Status**: `open`
- **Priority**: `high`
- **Auto-fix**: `ask`
- **File(s)**: `server.ts (Live Source Extractor)`
- **Submitted-By**: Guest Reader (2026-08-13)
- **Description**: Flagged issue: Does not load pages.

Series: Return of the Disaster-Class Hero (asura_return-of-the-disaster-class-hero)
Source: Asura Scans
Flag reason: Does not load pages
- **Steps to Reproduce**:
  1. 1. Open series "Return of the Disaster-Class Hero"
2. Trigger reading / metadata load
3. Observe: Does not load pages
- **Expected**: Action completes without error.
- **Actual**: Issue occurs as described.


### [BUG-022] [Does not load pages] Villain To Kill
- **Status**: `open`
- **Priority**: `high`
- **Auto-fix**: `ask`
- **File(s)**: `server.ts (Live Source Extractor)`
- **Submitted-By**: Guest Reader (2026-08-13)
- **Description**: Flagged issue: Does not load pages.

Series: Villain To Kill (asura_villain-to-kill)
Source: Asura Scans
Flag reason: Does not load pages
- **Steps to Reproduce**:
  1. 1. Open series "Villain To Kill"
2. Trigger reading / metadata load
3. Observe: Does not load pages
- **Expected**: Action completes without error.
- **Actual**: Issue occurs as described.


### [BUG-021] [Does not load pages] The Former Supreme
- **Status**: `open`
- **Priority**: `high`
- **Auto-fix**: `ask`
- **File(s)**: `server.ts (Live Source Extractor)`
- **Submitted-By**: Guest Reader (2026-08-13)
- **Description**: Flagged issue: Does not load pages.

Series: The Former Supreme (asura_the-former-supreme)
Source: Asura Scans
Flag reason: Does not load pages
- **Steps to Reproduce**:
  1. 1. Open series "The Former Supreme"
2. Trigger reading / metadata load
3. Observe: Does not load pages
- **Expected**: Action completes without error.
- **Actual**: Issue occurs as described.


### [BUG-020] [Does not load pages] Nano Machine
- **Status**: `open`
- **Priority**: `high`
- **Auto-fix**: `ask`
- **File(s)**: `server.ts (Live Source Extractor)`
- **Submitted-By**: Guest Reader (2026-08-13)
- **Description**: Flagged issue: Does not load pages.

Series: Nano Machine (asura_nano-machine)
Source: Asura Scans
Flag reason: Does not load pages
- **Steps to Reproduce**:
  1. 1. Open series "Nano Machine"
2. Trigger reading / metadata load
3. Observe: Does not load pages
- **Expected**: Action completes without error.
- **Actual**: Issue occurs as described.


### [BUG-019] [Does not load pages] The Academyâ€™s Sashimi Sword Master
- **Status**: `open`
- **Priority**: `high`
- **Auto-fix**: `ask`
- **File(s)**: `server.ts (Live Source Extractor)`
- **Submitted-By**: Guest Reader (2026-08-13)
- **Description**: Flagged issue: Does not load pages.

Series: The Academyâ€™s Sashimi Sword Master (asura_the-academys-sashimi-sword-master)
Source: Asura Scans
Flag reason: Does not load pages
- **Steps to Reproduce**:
  1. 1. Open series "The Academyâ€™s Sashimi Sword Master"
2. Trigger reading / metadata load
3. Observe: Does not load pages
- **Expected**: Action completes without error.
- **Actual**: Issue occurs as described.


### [BUG-018] [Does not load pages] Steel-Eating Player
- **Status**: `open`
- **Priority**: `high`
- **Auto-fix**: `ask`
- **File(s)**: `server.ts (Live Source Extractor)`
- **Submitted-By**: Guest Reader (2026-08-13)
- **Description**: Flagged issue: Does not load pages.

Series: Steel-Eating Player (asura_steel-eating-player)
Source: Asura Scans
Flag reason: Does not load pages
- **Steps to Reproduce**:
  1. 1. Open series "Steel-Eating Player"
2. Trigger reading / metadata load
3. Observe: Does not load pages
- **Expected**: Action completes without error.
- **Actual**: Issue occurs as described.


### [BUG-017] [Does not load pages] Pick Me Up, Infinite Gacha
- **Status**: `open`
- **Priority**: `high`
- **Auto-fix**: `ask`
- **File(s)**: `server.ts (Live Source Extractor)`
- **Submitted-By**: Guest Reader (2026-08-13)
- **Description**: Flagged issue: Does not load pages.

Series: Pick Me Up, Infinite Gacha (asura_pick-me-up-infinite-gacha)
Source: Asura Scans
Flag reason: Does not load pages
- **Steps to Reproduce**:
  1. 1. Open series "Pick Me Up, Infinite Gacha"
2. Trigger reading / metadata load
3. Observe: Does not load pages
- **Expected**: Action completes without error.
- **Actual**: Issue occurs as described.


### [BUG-016] [Does not load pages] The Heavenly Demon Wants a Quiet Life
- **Status**: `open`
- **Priority**: `high`
- **Auto-fix**: `ask`
- **File(s)**: `server.ts (Live Source Extractor)`
- **Submitted-By**: Guest Reader (2026-08-13)
- **Description**: Flagged issue: Does not load pages.

Series: The Heavenly Demon Wants a Quiet Life (asura_the-heavenly-demon-wants-a-quiet-life)
Source: Asura Scans
Flag reason: Does not load pages
- **Steps to Reproduce**:
  1. 1. Open series "The Heavenly Demon Wants a Quiet Life"
2. Trigger reading / metadata load
3. Observe: Does not load pages
- **Expected**: Action completes without error.
- **Actual**: Issue occurs as described.


### [BUG-015] [Does not load pages] The Forgotten Field
- **Status**: `open`
- **Priority**: `high`
- **Auto-fix**: `ask`
- **File(s)**: `server.ts (Live Source Extractor)`
- **Submitted-By**: Guest Reader (2026-08-13)
- **Description**: Flagged issue: Does not load pages.

Series: The Forgotten Field (asura_the-forgotten-field)
Source: Asura Scans
Flag reason: Does not load pages
- **Steps to Reproduce**:
  1. 1. Open series "The Forgotten Field"
2. Trigger reading / metadata load
3. Observe: Does not load pages
- **Expected**: Action completes without error.
- **Actual**: Issue occurs as described.


### [BUG-014] [Does not load pages] Genius Prismatic Mage
- **Status**: `open`
- **Priority**: `high`
- **Auto-fix**: `ask`
- **File(s)**: `server.ts (Live Source Extractor)`
- **Submitted-By**: Guest Reader (2026-08-13)
- **Description**: Flagged issue: Does not load pages.

Series: Genius Prismatic Mage (asura_genius-prismatic-mage)
Source: Asura Scans
Flag reason: Does not load pages
- **Steps to Reproduce**:
  1. 1. Open series "Genius Prismatic Mage"
2. Trigger reading / metadata load
3. Observe: Does not load pages
- **Expected**: Action completes without error.
- **Actual**: Issue occurs as described.


### [BUG-013] [Does not load pages] Terminally-Ill Genius Dark Knight
- **Status**: `open`
- **Priority**: `high`
- **Auto-fix**: `ask`
- **File(s)**: `server.ts (Live Source Extractor)`
- **Submitted-By**: Guest Reader (2026-08-13)
- **Description**: Flagged issue: Does not load pages.

Series: Terminally-Ill Genius Dark Knight (asura_terminally-ill-genius-dark-knight)
Source: Asura Scans
Flag reason: Does not load pages
- **Steps to Reproduce**:
  1. 1. Open series "Terminally-Ill Genius Dark Knight"
2. Trigger reading / metadata load
3. Observe: Does not load pages
- **Expected**: Action completes without error.
- **Actual**: Issue occurs as described.


### [BUG-012] [Does not load pages] Initializing the Sect System
- **Status**: `open`
- **Priority**: `high`
- **Auto-fix**: `ask`
- **File(s)**: `server.ts (Live Source Extractor)`
- **Submitted-By**: Guest Reader (2026-08-13)
- **Description**: Flagged issue: Does not load pages.

Series: Initializing the Sect System (asura_initializing-the-sect-system)
Source: Asura Scans
Flag reason: Does not load pages
- **Steps to Reproduce**:
  1. 1. Open series "Initializing the Sect System"
2. Trigger reading / metadata load
3. Observe: Does not load pages
- **Expected**: Action completes without error.
- **Actual**: Issue occurs as described.


### [BUG-010] Manhwa18
- **Status**: `in-progress`
- **Priority**: `high`
- **Auto-fix**: `ask`
- **File(s)**: `server.ts`
- **Submitted-By**: Guest Reader (2026-08-12)
- **Description**: When reading any series or refreshing metadata only series that comes up is Announcer Raw
- **Steps to Reproduce**:
  1. In Sources click any series automatically pulls up announcer raw 
- **Expected**: Get correct metadata and series 
- **Actual**: Get announcer raw


### [BUG-011] New reading-progress/analytics engine is backend-only â€” UI still shows mock data
- **Status**: `fixed`
- **Priority**: `medium`
- **Auto-fix**: `ask`
- **File(s)**: `server.ts` (`/api/reader/progress`, `/api/reader/history`, `/api/reader/analytics`), `sqlite-db.ts` (`reading_progress`, `reading_activity`), `src/components/AnalyticsModal.tsx`, `src/components/ReaderView.tsx`
- **Submitted-By**: AI code review (2026-08-12)
- **Description**: The staged change added a full per-user reading-progress + per-day activity persistence engine (tables, upserts, and three new endpooints). The endpoints work (verified at runtime: POST `/api/reader/progress` returns `{"success":true}` and GET `/api/reader/history/:mangaId` returns the stored row). However, **no frontend component calls any of these endpoints**. `ReaderView.tsx`/`App.tsx` call `/api/reader/mark-read` + a client-side session store, and `AnalyticsModal.tsx` renders hardcoded mock stats ("14 Days ðŸ”¥", "28 Days", "42.5 hrs", "148 Chapters in 2026") plus a pseudorandom heatmap. So the "real data instead of mock values" promise (sqlite-db.ts:117 comment) is not delivered to the UI.
- **Expected**: The reader saves/resumes progress via `/api/reader/progress` & `/api/reader/history`, and the analytics modal fetches `/api/reader/analytics` and renders real streaks/totals/heatmap.
- **Actual**: Backend persists data but nothing reads/writes it; analytics UI still shows fabricated figures.
- **Fixed in**: 2026-08-13 — AnalyticsModal fetches /api/reader/analytics; ReaderView posts /api/reader/progress (debounced) and resumes from /api/reader/history/:mangaId; modal is mounted from App.tsx.


### [BUG-009] [Does not load pages] Legend of the Northern Blade
- **Status**: `open`
- **Priority**: `high`
- **Auto-fix**: `ask`
- **File(s)**: `server.ts (Live Source Extractor)`
- **Submitted-By**: Guest Reader (2026-08-12)
- **Description**: Flagged issue: Does not load pages.

Series: Legend of the Northern Blade (kotatsu_db_1786481831767_4cra)
Source: Asura Scans
Flag reason: Does not load pages
- **Steps to Reproduce**:
  1. 1. Open series "Legend of the Northern Blade"
2. Trigger reading / metadata load
3. Observe: Does not load pages
- **Expected**: Action completes without error.
- **Actual**: Issue occurs as described.


_No active bugs._

---

## Fixed Bugs (Archive)

> Bugs that have been resolved are moved here for historical reference.

### [BUG-007] Wrong chapter silently substituted across sources (e.g. Omniscient Reader's Viewpoint always loaded chapter 255)
- **Status**: `fixed`
- **Priority**: `high`
- **Auto-fix**: `ask`
- **File(s)**: `server.ts` (`extractLiveDomainChapterPages`, `fetchAsuraChapterList`, `/api/reader/chapters/:mangaId`)
- **Description**: For Asura-series, requesting any chapter that the source no longer hosts (many Asura titles drop older chapters, e.g. Omniscient Reader's Viewpoint only hosts 255+) fell through the broken match chain `exactNumber || slug.includes(number) || chapters[chapters.length-1]` and silently loaded the LAST chapter in the list for every requested chapter. Because the chapter list was also fabricated (`for c in 1..latestChapter`), clicking *any* chapter below the hosted range returned the same wrong chapter (reported as "always loads chapter 255").
- **Root causes fixed**:
  1. Removed every wrong-chapter fallback (`chapters[chapters.length - 1]`, `|| chapters[0]`, `candidates[0]`, `chMatches[n-1]`) â€” a missing chapter now returns `null` (correct-title placeholder) instead of a wrong chapter.
  2. Replaced the broken substring `slug.includes(number)` match with an exact `number` match plus an ANCHORED slug regex (`(?:^|[_-]|ch(?:apter)?[_-]?)N(?:$|[_.-])`) so hashes that merely *contain* a digit no longer match wrong chapters (e.g. requesting chapter 5 no longer matches 255/305).
  3. The chapter-list endpoint now returns each source's REAL chapters (unified `fetchLiveChapterList()` for Asura / Flame / Dynasty / generic HTML sources), so the UI only lists chapters that actually exist on the source.
- **Scope (all sources)**: The same fix is applied to every live-source extractor â€” Asura (official API), Flame (Next.js API), Dynasty (series-page HTML), and the generic universal HTML resolver used by all other registered + unregistered sources. New shared helpers: `normalizeLiveTargetUrl()`, `fetchFlameSeriesContext()`, `mapFlameChapters()`, `fetchFlameChapterList()`, `fetchDynastyChapterList()`, `fetchGenericChapterList()`, `fetchLiveChapterList()`, `matchResolvedChapter()`, `extractPanelImages()` (also adds `data-srcset` handling for lazily-loaded images).
- **Fixed in**: 2026-08-11 â€” Added the shared enumerator/matcher helpers and rewired `extractLiveDomainChapterPages` + `/api/reader/chapters/:mangaId`. Verified with `tsc --noEmit` (clean) and a 15-case logic test across Asura/Flame/Dynasty/generic (missing chapters â†’ NOT FOUND; existing chapters â†’ exact match; substring bug neutralized).

### [BUG-008] Manual metadata edits (title/description/cover/rating/genres) disappeared after a metadata refresh
- **Status**: `fixed`
- **Priority**: `high`
- **Auto-fix**: `yes`
- **File(s)**: `server.ts` (`refreshSingleMangaMetadata`), `src/components/AddEditModal.tsx`, `sqlite-db.ts`, `src/types.ts`
- **Description**: Any metadata edits made through the "Edit Details" modal were silently overwritten the next time metadata was refreshed (single series refresh, bulk `/api/manga/refresh-all-metadata`, or the Settings purge/refresh engine). `refreshSingleMangaMetadata()` mutated `title`, `description`, `coverImage`, and `rating` directly from the live source and appended source `genres`/`altTitles`, clobbering curated values.
- **Expected**: User-customized metadata persists across refreshes.
- **Actual**: Refreshes replaced manual edits with whatever the live source returned.
- **Fixed in**: 2026-08-12 â€” Added an optional `metadataOverrides?: string[]` field to `MangaItem` (persisted to SQLite via a new `metadataOverrides TEXT` column + migration). `AddEditModal` records which metadata fields the user actually changed, and `refreshSingleMangaMetadata` now snapshots those fields up-front and restores them afterward, so live refreshes never overwrite manual edits. `latestChapter` is intentionally excluded so chapter counters keep updating. Verified with `tsc --noEmit` (clean) and a production build (`exit 0`).


### [BUG-003] Page and chapter counter
- **Status**: `fixed`
- **Priority**: `medium`
- **Auto-fix**: `ask`
- **File(s)**: `server.ts`
- **Submitted-By**: Guest Reader (2026-08-10)
- **Description**: Needs to be able to be turned on or off and more transparent
- **Fixed in**: 2026-08-11 â€” Added a "Per-Page Number Counter" toggle in Settings â†’ Reader (controls the `showPageNumberOverlay` setting, previously had no UI toggle). Both the persistent chapter/page badge and the per-page counter are now semi-transparent (`bg-slate-900/50` / `bg-slate-950/40` with softened borders & text) and the badge no longer intercepts clicks. Files: `src/components/SettingsModal.tsx`, `src/components/ReaderView.tsx`.

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
- **Fixed in**: 2026-08-11 â€” MangaDex has been removed as a reading source entirely. It remains available for metadata/enrichment/covers but is **never** used to resolve chapter images. The handler resolves reading from the series' own live source URL, and otherwise falls through to a generated placeholder panel with the correct title. `hasWorkingReaderSource()` in `types.ts` now returns `false` for a series that only has a MangaDex `apiId` without a live source URL. This supersedes the earlier similarity-gated fallback fix.

### [BUG-005] Catalog had no 18+ filtering and showed duplicate series
- **Status**: `fixed`
- **Priority**: `medium`
- **Auto-fix**: `ask`
- **File(s)`: `src/components/BrowseView.tsx`
- **Description**: The "Unified Catalog" mixed 18+/adult series (genres `18+`/`Adult`/`Ecchi`/... and sources like Manhwa18) into the same list with no way to hide or isolate them, and the same series could appear multiple times (across sources or duplicated within a source).
- **Fixed in**: 2026-08-11 â€” Expanded 18+ detection with a comprehensive `isAdultManga()` helper that checks genres, source name/url, `syncedFromApi`, and `availableSources` (plus many additional adult genre tags). Reworked dedup with `dedupeCatalog()`: keys on `apiId` when present (source-independent), groups same-title entries into buckets, only merges when there is no apiId conflict (two series with DIFFERENT apiIds sharing a title stay separate), and calls `mergeMangaItems()` which unions `availableSources`/`altTitles`/`genres`, keeps the highest chapter & rating, and prefers the readable variant â€” so duplicates are **merged, not dropped**, and no sources or alt-titles are lost. Files: `src/components/BrowseView.tsx`.

### [BUG-006] MangaDex used for reading when no live source available
- **Status**: `fixed`
- **Priority**: `high`
- **Auto-fix**: `ask`
- **File(s)**: `server.ts` (`/api/reader/chapter-pages`), `src/types.ts` (`hasWorkingReaderSource`)
- **Description**: Series with only a MangaDex `apiId` (no live source) would load MangaDex feed chapters in the reader. This produced wrong content for adult/explicit series excluded from MangaDex reader feeds, and non-existent/chapter-empty reads.
- **Fixed in**: 2026-08-11 â€” MangaDex reading is permanently disabled (see BUG-004). Exported `isMangaDexSourceLink()` in `types.ts` checks both `sourceName` and `sourceUrl` for MangaDex references. `hasWorkingReaderSource()` now returns `false` for any source that matches `isMangaDexSourceLink()` â€” including merged entries where the base `availableSources` contain a mix of MangaDex + other sources (the other source is promoted for reading). Server-side guard in `server.ts` blocks `mangadex.org` URLs from entering the live crawler resolution. Metadata features (search, enrichment, covers via `/api/mangadex/*`) remain fully operational.


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

