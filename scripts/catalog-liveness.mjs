#!/usr/bin/env node
/**
 * catalog-liveness.mjs -- Phase 2: Source liveness scanner
 *
 * Probes every source in server/sources/catalog.json and tags it:
 *   ok         -- HTTP 2xx with meaningful content (> 20 KB)
 *   parked     -- HTTP 2xx but tiny page (< 20 KB, no content markers)
 *   cf-blocked -- Cloudflare challenge detected
 *   dead       -- Network error, DNS failure, or timeout
 *   http-NNN   -- Non-2xx HTTP response
 *
 * Auto-patches catalog.json when a redirect chain resolves to a new domain.
 * Writes results to data/source-health.json.
 *
 * Usage:
 *   node scripts/catalog-liveness.mjs
 *   node scripts/catalog-liveness.mjs --sample 50
 *   node scripts/catalog-liveness.mjs --concurrency 15
 *   node scripts/catalog-liveness.mjs --patch
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const CATALOG_PATH = path.join(ROOT, 'server', 'sources', 'catalog.json');
const OUTPUT_PATH  = path.join(ROOT, 'data', 'source-health.json');
const TIMEOUT_MS   = 8000;
const CONTENT_THRESHOLD = 20000;

const UA = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

const CF_RX = /Just a moment|challenge-platform|cf-browser-verification|Attention Required|DDoS protection/i;
const CONTENT_RX = /class=["'](?:page-item-detail|listupd|bsx|post-title|manga-list|series-list)|post-title|manga-content/i;

const args = process.argv.slice(2);
const sampleArg  = args.findIndex(a => a === '--sample');
const sample     = sampleArg !== -1 ? parseInt(args[sampleArg + 1] || '50', 10) : 0;
const concurrArg = args.findIndex(a => a === '--concurrency');
const CONCURRENCY = concurrArg !== -1 ? parseInt(args[concurrArg + 1] || '20', 10) : 20;
const PATCH = args.includes('--patch');

// Never follow "migrations" onto domain-marketplace / parking pages — those
// redirects mean the original domain lapsed and was bought by a reseller,
// not that the scanlation site moved.
const BAD_TARGET_RX = /expireddomains|hugedomains|sedo|afternic|dan\.com|godaddy|forsale|buydomain|parking|for-sale/i;


const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
console.log(`[Liveness] Loaded ${catalog.length} sources from catalog.json`);

let sources = catalog;
if (sample > 0 && sample < catalog.length) {
  const step = Math.floor(catalog.length / sample);
  sources = catalog.filter((_, i) => i % step === 0).slice(0, sample);
  console.log(`[Liveness] Sampling ${sources.length} sources (every ${step}th)`);
}

async function probeSource(src) {
  const t0 = Date.now();
  let finalUrl = src.baseUrl;
  try {
    const r = await fetch(src.baseUrl, {
      headers: UA,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'follow',
    });
    finalUrl = r.url || src.baseUrl;
    const html = await r.text();
    const ms = Date.now() - t0;

    if (CF_RX.test(html) && !r.ok) {
      return { id: src.id, status: 'cf-blocked', httpStatus: r.status, finalUrl, ms };
    }
    if (!r.ok) {
      return { id: src.id, status: `http-${r.status}`, httpStatus: r.status, finalUrl, ms };
    }
    if (html.length < CONTENT_THRESHOLD && !CONTENT_RX.test(html)) {
      return { id: src.id, status: 'parked', httpStatus: r.status, len: html.length, finalUrl, ms };
    }
    return { id: src.id, status: 'ok', httpStatus: r.status, len: html.length, finalUrl, ms };
  } catch (e) {
    const ms = Date.now() - t0;
    const code = e.cause?.code || e.name || String(e.message || 'UNKNOWN').substring(0, 60);
    return { id: src.id, status: 'dead', error: code, finalUrl: src.baseUrl, ms };
  }
}

async function runPool(tasks, concurrency) {
  const results = [];
  const queue = [...tasks];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    let task;
    while ((task = queue.shift()) !== undefined) {
      results.push(await task());
    }
  });
  await Promise.all(workers);
  return results;
}

const tasks = sources.map(src => () => probeSource(src));
console.log(`[Liveness] Probing ${tasks.length} sources with concurrency=${CONCURRENCY}...`);
const t0Total = Date.now();
const results = await runPool(tasks, CONCURRENCY);
const elapsed = ((Date.now() - t0Total) / 1000).toFixed(1);

const byStatus = {};
for (const r of results) {
  byStatus[r.status] = (byStatus[r.status] || 0) + 1;
}
console.log(`\n[Liveness] Done in ${elapsed}s. Results:`);
for (const [status, count] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${status.padEnd(14)} ${count}`);
}

const domainChanges = [];
for (const r of results) {
  const src = sources.find(s => s.id === r.id);
  if (!src || !r.finalUrl || r.finalUrl === src.baseUrl) continue;
  try {
    const origHost = new URL(src.baseUrl).hostname;
    const finalHost = new URL(r.finalUrl).hostname;
    if (origHost !== finalHost && r.status === 'ok') {
      const newOrigin = new URL(r.finalUrl).origin;
      // Domain-reseller redirects (ExpiredDomains, HugeDomains, GoDaddy
      // parking, ...) mean the domain lapsed — never treat as a migration.
      if (!BAD_TARGET_RX.test(newOrigin)) {
        domainChanges.push({ id: src.id, oldUrl: src.baseUrl, newUrl: newOrigin });
        console.log(`[Liveness] Domain migration: ${src.id}  ${src.baseUrl} -> ${newOrigin}`);
      } else {
        console.log(`[Liveness] Ignoring bogus migration (domain reseller): ${src.id}  ${src.baseUrl} -> ${newOrigin}`);
      }
    }
  } catch {}
}

const output = {
  scannedAt: new Date().toISOString(),
  totalScanned: results.length,
  byStatus,
  domainMigrations: domainChanges,
  sources: results.map(r => ({ ...r, sampledAt: new Date().toISOString() })),
};

if (!fs.existsSync(path.join(ROOT, 'data'))) {
  fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
}
fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
console.log(`\n[Liveness] Results written to ${OUTPUT_PATH}`);

if (PATCH && domainChanges.length > 0) {
  console.log(`\n[Liveness] Patching ${domainChanges.length} domain migrations in catalog.json...`);
  let patchCount = 0;
  for (const change of domainChanges) {
    const entry = catalog.find(s => s.id === change.id);
    if (entry) { entry.baseUrl = change.newUrl; patchCount++; }
  }
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2));
  console.log(`[Liveness] Patched ${patchCount} entries in catalog.json.`);
}

const dead = results.filter(r => r.status === 'dead' || r.status === 'parked');
if (dead.length > 0) {
  console.log(`\n[Liveness] Dead/parked sources (${dead.length}):`);
  for (const r of dead.slice(0, 30)) {
    console.log(`  ${r.id.padEnd(30)} ${r.status}  ${r.error || ''}`);
  }
  if (dead.length > 30) console.log(`  ... and ${dead.length - 30} more`);
}
