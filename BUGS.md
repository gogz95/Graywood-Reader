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

### [BUG-001] Disabled sources still being toggled via old localStorage state
- **Status**: `open`
- **Priority**: `medium`
- **Auto-fix**: `ask`
- **File(s)**: `src/components/KotatsuSourcesView.tsx`
- **Description**: When the frontend still has old `kotatsu_disabled_sources` in localStorage from a previous session, it can call `/api/kotatsu/sources/toggle` on startup for sources that don't match the current server state. This causes transient inconsistencies visible in the server logs (e.g. sources being toggled ON/OFF unexpectedly shortly after launch).
- **Expected**: Frontend derives disabled state purely from the server response on mount, no localStorage toggle calls at startup.
- **Actual**: Old localStorage keys cause stale toggle API calls shortly after the server starts.

### [BUG-002] Night Scans SSL certificate error on image extraction
- **Status**: `open`
- **Priority**: `low`
- **Auto-fix**: `ask`
- **File(s)**: `server.ts` (Live Source Extractor)
- **Description**: When any series with a `nightscans.net` sourceUrl is opened in the reader, the extractor throws `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` — Node.js cannot verify Night Scans' TLS certificate chain. Night Scans is currently a **disabled** source so this should never be reached, but old database entries may still reference it.
- **Expected**: Disabled source URLs are never fetched by the extractor.
- **Actual**: Extractor is still called for series whose `sourceUrl` points to a disabled source domain.



---

## Fixed Bugs (Archive)

> Bugs that have been resolved are moved here for historical reference.
