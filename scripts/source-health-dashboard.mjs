#!/usr/bin/env node
// ============================================================================
// SOURCE HEALTH DASHBOARD (CLI & Observability Runner)
// Shows live health status of top manga sources across response time,
// Cloudflare status, circuit breaker states, and catalog readability.
//
// Usage:
//   node scripts/source-health-dashboard.mjs                # Show current catalog stats
//   node scripts/source-health-dashboard.mjs --probe        # Live-probe top 50 sources
//   node scripts/source-health-dashboard.mjs --probe --limit 20
//   node scripts/source-health-dashboard.mjs --lang en --engine madara
//   node scripts/source-health-dashboard.mjs --json
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const args = process.argv.slice(2);

const flagVal = (name, dflt = undefined) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : dflt;
};
const flagBool = (name) => args.includes(name);

const DO_PROBE = flagBool('--probe') || flagBool('-p');
const LIMIT = Math.max(1, Number(flagVal('--limit', '50')));
const LANG = flagVal('--lang');
const ENGINE = flagVal('--engine');
const OUTPUT_JSON = flagBool('--json');
const REPORT_OUT = flagVal('--out', path.join(ROOT, 'scripts', 'source-health-report.json'));

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  bgBlue: '\x1b[44m\x1b[37m',
};

// Load catalog
let catalog = [];
try {
  const raw = fs.readFileSync(path.join(ROOT, 'server', 'sources', 'catalog.json'), 'utf8');
  catalog = JSON.parse(raw);
} catch (e) {
  console.error('Error loading catalog.json:', e.message);
  process.exit(1);
}

// Filter sources
let sources = catalog.filter((s) => s.reliable !== false);
if (LANG) sources = sources.filter((s) => (s.lang || '').toLowerCase() === LANG.toLowerCase());
if (ENGINE) sources = sources.filter((s) => (s.engine || '').toLowerCase() === ENGINE.toLowerCase());

// Sort to prioritize popular / curated English scanlation sources
const topPriorityIds = new Set([
  'asurascans', 'flamecomics', 'weebcentral', 'manhwa18', 'harimanga',
  'manhuaplus', 'mangaread', 'kunmanga', 'ravenscans', 'demonicscans',
  'allporncomic', 'bibimanga', 'toongod', 'hiperdex', 'zinmanga',
  'coffeemanga', 'mangatx', 'manhuafast', 'nightcomic', 'dynasty'
]);

sources.sort((a, b) => {
  const aPrio = topPriorityIds.has(a.id) ? 0 : 1;
  const bPrio = topPriorityIds.has(b.id) ? 0 : 1;
  if (aPrio !== bPrio) return aPrio - bPrio;
  return a.id.localeCompare(b.id);
});

sources = sources.slice(0, LIMIT);

function detectChallengeType(html, status) {
  const norm = (html || '').toLowerCase();
  if (norm.includes('challenges.cloudflare.com') || norm.includes('cf-turnstile')) return 'Turnstile';
  if (status === 403 || status === 503) {
    if (norm.includes('checking your browser') || norm.includes('just a moment') || norm.includes('cf-browser-verification')) return 'Cloudflare DDoS';
    if (norm.includes('access denied') || norm.includes('ip has been banned')) return 'IP Ban';
  }
  if (norm.includes('google.com/recaptcha') || norm.includes('g-recaptcha')) return 'reCAPTCHA';
  return null;
}

async function probeSource(source) {
  const targetUrl = source.baseUrl;
  const startTime = Date.now();
  try {
    const res = await fetch(targetUrl, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': targetUrl + '/',
      },
      signal: AbortSignal.timeout(12000),
      redirect: 'follow',
    });
    const latency = Date.now() - startTime;
    const html = await res.text();
    const challenge = detectChallengeType(html, res.status);

    let statusLabel = 'OK';
    if (challenge) statusLabel = `BLOCKED (${challenge})`;
    else if (res.status >= 500) statusLabel = `DOWN (HTTP ${res.status})`;
    else if (res.status >= 400) statusLabel = `DEGRADED (HTTP ${res.status})`;

    return {
      id: source.id,
      name: source.name,
      engine: source.engine || 'custom',
      lang: source.lang || 'en',
      domain: source.domain,
      status: statusLabel,
      httpStatus: res.status,
      latencyMs: latency,
      challenge: challenge || 'None',
      htmlLength: html.length,
      ok: res.ok && !challenge,
    };
  } catch (err) {
    return {
      id: source.id,
      name: source.name,
      engine: source.engine || 'custom',
      lang: source.lang || 'en',
      domain: source.domain,
      status: `ERROR (${err.name === 'TimeoutError' ? 'Timeout' : err.code || err.message})`,
      httpStatus: 0,
      latencyMs: Date.now() - startTime,
      challenge: 'None',
      htmlLength: 0,
      ok: false,
    };
  }
}

async function runDashboard() {
  console.log(`\n${ANSI.bold}${ANSI.bgBlue} GRAYWOOD READER — SOURCE HEALTH DASHBOARD ${ANSI.reset}\n`);
  console.log(`${ANSI.cyan}Monitoring Top ${sources.length} Sources${ANSI.reset} (Total in catalog: ${catalog.length})\n`);

  if (!DO_PROBE) {
    console.log(`${ANSI.dim}Run with --probe to execute live network health checks for each source.${ANSI.reset}\n`);
    const engineCounts = {};
    for (const s of catalog) {
      const eng = s.engine || 'custom';
      engineCounts[eng] = (engineCounts[eng] || 0) + 1;
    }
    console.log(`${ANSI.bold}Engine Distribution:${ANSI.reset}`);
    for (const [eng, count] of Object.entries(engineCounts)) {
      console.log(`  • ${eng.padEnd(16)} : ${count} sources`);
    }
    console.log(`\n${ANSI.bold}Sample Top 15 Sources:${ANSI.reset}`);
    for (const s of sources.slice(0, 15)) {
      console.log(`  • ${s.id.padEnd(20)} [${(s.engine || 'custom').padEnd(12)}] ${s.baseUrl}`);
    }
    console.log(`\n${ANSI.green}Tip: node scripts/source-health-dashboard.mjs --probe --limit 20${ANSI.reset}\n`);
    return;
  }

  console.log(`Live-probing ${sources.length} sources (concurrency: 5)...\n`);

  const results = [];
  const CONCURRENCY = 5;
  for (let i = 0; i < sources.length; i += CONCURRENCY) {
    const chunk = sources.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(chunk.map(probeSource));
    results.push(...chunkResults);
    process.stdout.write(`  Probed ${Math.min(i + CONCURRENCY, sources.length)}/${sources.length} sources...\r`);
  }
  process.stdout.write('\n\n');

  // Format table output
  console.log(`${ANSI.bold}SOURCE               ENGINE       LANG  STATUS                     LATENCY   DOMAIN${ANSI.reset}`);
  console.log(''.padEnd(95, '-'));

  let healthy = 0;
  let degraded = 0;
  let blocked = 0;
  let down = 0;

  for (const r of results) {
    let color = ANSI.green;
    if (r.status.startsWith('OK')) {
      healthy++;
    } else if (r.status.startsWith('BLOCKED')) {
      blocked++;
      color = ANSI.yellow;
    } else if (r.status.startsWith('DEGRADED')) {
      degraded++;
      color = ANSI.yellow;
    } else {
      down++;
      color = ANSI.red;
    }

    const idStr = r.id.padEnd(20).slice(0, 20);
    const engStr = r.engine.padEnd(12).slice(0, 12);
    const langStr = r.lang.toUpperCase().padEnd(5).slice(0, 5);
    const statStr = (color + r.status.padEnd(26).slice(0, 26) + ANSI.reset);
    const latStr = `${r.latencyMs}ms`.padStart(8);
    const domStr = r.domain || '';

    console.log(`${idStr} ${engStr} ${langStr} ${statStr} ${latStr}   ${domStr}`);
  }

  console.log(''.padEnd(95, '-'));
  console.log(`\n${ANSI.bold}Summary:${ANSI.reset} ${ANSI.green}✓ ${healthy} Healthy${ANSI.reset} | ${ANSI.yellow}⚠️ ${degraded} Degraded${ANSI.reset} | ${ANSI.yellow}🛡️ ${blocked} Challenged/Blocked${ANSI.reset} | ${ANSI.red}✗ ${down} Down/Timeout${ANSI.reset}\n`);

  if (OUTPUT_JSON) {
    const reportData = {
      timestamp: new Date().toISOString(),
      total: results.length,
      healthy,
      degraded,
      blocked,
      down,
      sources: results,
    };
    fs.writeFileSync(REPORT_OUT, JSON.stringify(reportData, null, 2), 'utf8');
    console.log(`${ANSI.cyan}Wrote detailed health report to: ${REPORT_OUT}${ANSI.reset}\n`);
  }
}

runDashboard().catch((err) => {
  console.error('Dashboard error:', err);
  process.exit(1);
});
