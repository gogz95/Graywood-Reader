import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { canWriteCatalog, rejectCatalogWrite } from '../appState';

// ============================================================================
// BUG TRACKING & BUGS.MD PERSISTENCE
// Extracted from server.ts. Submissions are gated to host/authenticated
// callers (global file state) just like before.
// ============================================================================

export const bugsRouter = Router();

const BUGS_FILE_PATH = path.join(process.cwd(), "BUGS.md");

// Submit Bug Endpoint -> Appends directly to BUGS.md
bugsRouter.post("/api/bugs/submit", (req, res) => {
  // Writing to a repo file is global state: host or authenticated users only
  // (prevents anonymous remote clients from growing BUGS.md without bound).
  if (!canWriteCatalog(req)) return rejectCatalogWrite(res);
  const {
    title,
    priority,
    file,
    description,
    stepsToReproduce,
    expected,
    actual,
    autoFix,
    user,
  } = req.body || {};

  if (!title || !description) {
    return res.status(400).json({ error: "Title and description are required to submit a bug report." });
  }

  try {
    let bugsMarkdown = fs.existsSync(BUGS_FILE_PATH)
      ? fs.readFileSync(BUGS_FILE_PATH, "utf-8")
      : `# 🐛 ManhuaSync Bug Tracker\n\n## Active Bugs\n\n`;

    // Calculate next BUG-XXX ID
    const bugIdMatches = Array.from(bugsMarkdown.matchAll(/\[BUG-(\d+)\]/g));
    let nextNum = 1;
    if (bugIdMatches.length > 0) {
      const nums = bugIdMatches.map((m) => parseInt(m[1], 10)).filter((n) => !isNaN(n));
      if (nums.length > 0) {
        nextNum = Math.max(...nums) + 1;
      }
    }
    const bugId = `BUG-${String(nextNum).padStart(3, '0')}`;

    const formattedSteps = stepsToReproduce
      ? (Array.isArray(stepsToReproduce) ? stepsToReproduce.map((s: string, i: number) => `  ${i + 1}. ${s}`).join('\n') : `  1. ${stepsToReproduce}`)
      : `  1. Open application\n  2. Trigger reported scenario`;

    const newBugEntry = `
### [${bugId}] ${title.trim()}
- **Status**: \`open\`
- **Priority**: \`${priority || 'medium'}\`
- **Auto-fix**: \`${autoFix || 'ask'}\`
- **File(s)**: \`${file || 'server.ts'}\`
- **Submitted-By**: ${user || 'User'} (${new Date().toISOString().substring(0, 10)})
- **Description**: ${description.trim()}
- **Steps to Reproduce**:
${formattedSteps}
- **Expected**: ${expected || 'Action completes without error.'}
- **Actual**: ${actual || 'Issue occurs as described.'}
`;

    // Append under ## Active Bugs section
    if (bugsMarkdown.includes("## Active Bugs")) {
      bugsMarkdown = bugsMarkdown.replace("## Active Bugs", `## Active Bugs\n${newBugEntry}`);
    } else {
      bugsMarkdown += `\n${newBugEntry}`;
    }

    fs.writeFileSync(BUGS_FILE_PATH, bugsMarkdown, "utf-8");
    console.log(`[Bug Tracker Engine] Successfully logged new bug [${bugId}] to BUGS.md: "${title}"`);

    res.status(201).json({
      success: true,
      bugId,
      message: `Bug report [${bugId}] saved successfully to BUGS.md!`,
      entry: newBugEntry,
    });
  } catch (err: any) {
    console.error("[Bug Tracker Engine] Error writing bug to BUGS.md:", err);
    res.status(500).json({ error: "Failed to save bug report to BUGS.md", details: err.message });
  }
});

// GET Bugs from BUGS.md
bugsRouter.get("/api/bugs", (_req, res) => {
  try {
    if (!fs.existsSync(BUGS_FILE_PATH)) {
      return res.json([]);
    }

    const bugsMarkdown = fs.readFileSync(BUGS_FILE_PATH, "utf-8");
    const bugBlocks = bugsMarkdown.split(/###\s+\[BUG-/g).slice(1);

    const bugs = bugBlocks.map((block) => {
      const firstLineEnd = block.indexOf('\n');
      const headerText = block.substring(0, firstLineEnd).trim();
      const idMatch = headerText.match(/^(\d+)\]\s*(.*)/);
      const bugId = idMatch ? `BUG-${idMatch[1]}` : 'BUG-000';
      const title = idMatch ? idMatch[2] : headerText;

      const statusMatch = block.match(/-\s*\*\*Status\*\*:\s*`([^`]+)`/);
      const priorityMatch = block.match(/-\s*\*\*Priority\*\*:\s*`([^`]+)`/);
      const fileMatch = block.match(/-\s*\*\*File\(s\)\*\*:\s*`([^`]+)`/);
      const descMatch = block.match(/-\s*\*\*Description\*\*:\s*([^\n]+)/);

      return {
        id: bugId,
        title,
        status: statusMatch ? statusMatch[1] : 'open',
        priority: priorityMatch ? priorityMatch[1] : 'medium',
        file: fileMatch ? fileMatch[1] : 'unknown',
        description: descMatch ? descMatch[1] : '',
      };
    });

    res.json(bugs);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to read BUGS.md", details: err.message });
  }
});