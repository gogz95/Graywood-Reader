# Bug Tracker Rule

## Overview

At the **start of every session**, you MUST read the bug tracker file at:

```
C:/Users/gogz9/antigravity/Remix-ManhuaSync-to-a-reader/BUGS.md
```

## Behavior by Auto-fix Setting

After reading `BUGS.md`, for every bug with **Status: `open`** or **Status: `in-progress`**:

### If `Auto-fix: yes`
- **Fix it immediately** without asking for permission.
- After fixing, update the bug's **Status** to `fixed` and add `- **Fixed in**: <date>` to the entry.
- Move the fixed entry to the **Fixed Bugs (Archive)** section at the bottom of BUGS.md.

### If `Auto-fix: ask`
- **List all such bugs** in a concise summary to the user at the start of the session.
- Ask: *"I found [N] flagged bugs — would you like me to fix them now, or handle them later?"*
- Only proceed if the user approves.

## Priority Order

When fixing multiple bugs, address them in this order:
1. `critical`
2. `high`
3. `medium`
4. `low`

## Flagging New Bugs

When you discover a bug during any session (even if the user didn't mention it), you MAY add it to `BUGS.md` under **Active Bugs** with:
- `Status: open`
- `Auto-fix: ask` (default — never auto-add `yes` without explicit user instruction)
- A clear description, affected file(s), and reproduction steps if known.

Always tell the user when you add a new bug to the tracker.

## When the file doesn't exist

If `BUGS.md` does not exist in the workspace root, silently skip this check and continue normally. Do NOT create the file unless the user asks for a bug tracking system.

## Format Reference

```markdown
### [BUG-XXX] Short description
- **Status**: `open`
- **Priority**: `high`
- **Auto-fix**: `ask`
- **File(s)**: src/components/Foo.tsx
- **Description**: What the bug is.
- **Expected**: What should happen.
- **Actual**: What actually happens.
```
