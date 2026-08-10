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

### [BUG-003] Page and chapter counter
- **Status**: `open`
- **Priority**: `medium`
- **Auto-fix**: `ask`
- **File(s)**: `server.ts`
- **Submitted-By**: Guest Reader (2026-08-10)
- **Description**: Needs to be able to be turned on or off and more transparent
- **Steps to Reproduce**:
  1. Open application
  2. Trigger reported scenario
- **Expected**: Action completes without error.
- **Actual**: Issue occurs as described.


_No active bugs._

---

## Fixed Bugs (Archive)

> Bugs that have been resolved are moved here for historical reference.

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
