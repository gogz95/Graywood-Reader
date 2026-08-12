#!/usr/bin/env node
// ============================================================================
// SOURCE RELIABILITY & FUNCTIONALITY AUDIT  (Graywood Reader / kotatsu-parsers)
// ============================================================================
// Reviews every manga "source" registered from the vendored kotatsu-parsers
// repository for reliability & functionality:
//
//   1. INGEST   — walk the cloned Kotlin parser repo and reproduce the
//                 registration logic used by server.ts (annotation + domain),
//                 with an IMPROVED, shared domain extractor so we can detect
//                 how many sources the legacy regex got wrong.
//   2. VALIDATE — syntax-check every baseUrl (dotted hostname, sane TLD, no
//                 underscores / spaces / paths).
//   3. PROBE*   — live-request each chosen source and record HTTP status,
//                 redirect target, Cloudflare/captcha block, and catalog
//                 series-count, to assess real-world functionality.
//
// *Live probing hits external sites; default is a small curated set. Use --all
//  to probe every source (respects --concurrency / --spacing).
//
// Outputs:  scripts/source-audit-report.json
//           scripts/source-audit-report.md
//           console tables (stdout)
//
// Usage:
//   node scripts/source-audit.mjs                              # ingest+validate
//   node scripts/source-audit.mjs --probe                      # ingest + probe default set
//   node scripts/source-audit.mjs --probe --all                # ingest + probe every source
//   node scripts/source-audit.mjs --only asurascans,weebcentral --probe
//   node scripts/source-audit.mjs --lang en --engine madara
//   node scripts/source-audit.mjs --out path/to/report.json
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const args = process.argv.slice(2);

// CLI parsing
const flagVal = (name, dflt = undefined) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : dflt;
};
const flagBool = (name) => args.includes(name);
const DO_PROBE = flagBool('--probe') || flagBool('-p');
const DO_ALL = flagBool('--all');
const ONLY = flagVal('--only')?.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) || [];
const LANG = flagVal('--lang');
const ENGINE = flagVal('--engine');
const OUT = flagVal('--out', path.join(ROOT, 'scripts', 'source-audit-report.json'));
const CONCURRENCY = Math.max(1, Number(flagVal('--concurrency', '6')));
const SPACING_MS = Math.max(0, Number(flagVal('--spacing', '350')));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// NOTE: keep these in sync with the helpers of the same name in server.ts.
const PARSER_CLASS_RX =
  /(?:MadaraParser|MangaThemesiaParser|MangaReaderParser|FoolSlideParser|WpComicsParser|HotComicsParser|Manhwa18Parser|PagedMangaParser)\s*\(/;

function sanitizeParserDomain(raw) {
  if (!raw) return null;
  let d = String(raw).trim().toLowerCase();
  d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/\/.*$/, '')
    .replace(/^www\./, '').replace(/\.$/, '');
  if (!d || d.length < 4 || d.length > 253) return null;
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) return null; // hostname only, no '_'
  if (d.includes('..') || /^-|-$/.test(d) || /--/.test(d)) return null;
  const tld = d.split('.').pop() || '';
  if (tld.length < 2 || tld.length > 24) return null;
  return d;
}

function extractParserDomain(content, fallbackId) {
  const pick = (raw, via, reliable) => {
    const d = sanitizeParserDomain(raw || '');
    if (!d) return null;
    return { domain: d, baseUrl: `https://${d}`, reliable: !!reliable, via };
  };
  // 1) ConfigKey.Domain("tld") — modern standard for custom parsers.
  const ck = content.match(/ConfigKey\s*\.\s*Domain\s*\(\s*["']([^"']+)["']/);
  if (ck) { const p = pick(ck[1], 'configKey', true); if (p) return p; }
  // 2) Base-class theme constructor: ClassName(context, Source, "tld").
  if (PARSER_CLASS_RX.test(content)) {
    const m = content.match(PARSER_CLASS_RX);
    const start = m.index + m[0].length;
    const slice = content.slice(start, start + 280);
    const literals = slice.match(/["']([^"']+)["']/g) || [];
    for (let i = literals.length - 1; i >= 0; i--) {
      const p = pick(literals[i].slice(1, -1), 'ctor', true);
      if (p) return p;
    }
  }
  // 3) A lone dotted-domain literal elsewhere in the file (validated, uncertain).
  const bare = content.match(/["']((?:[a-z0-9-]+\.)+[a-z]{2,24})["']/i);
  if (bare) { const p = pick(bare[1], 'bare', false); if (p) return p; }
  // 4) Unreliable fallback for parity — flagged so ops can review it.
  return { domain: `${fallbackId}.com`, baseUrl: `https://${fallbackId}.com`, reliable: false, via: 'fallback' };
}
// ---------------------------------------------------------------------------
// Ingest from the vendored repo (mirrors loadKotatsuParsersFromClonedRepo)
// ---------------------------------------------------------------------------
function parsersDir() {
  const legacy = path.join(ROOT, 'kotatsu-parsers', 'src', 'main', 'kotlin', 'org', 'koitharu', 'kotatsu', 'parsers', 'site');
  const redo = path.join(ROOT, 'kotatsu-parsers-redo', 'src', 'main', 'kotlin', 'org', 'koitharu', 'kotatsu', 'parsers', 'site');
  return fs.existsSync(redo) ? redo : (fs.existsSync(legacy) ? legacy : null);
}

const ANNOTATION_RX = /@MangaSourceParser\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"/;

function ingestSources() {
  const dir = parsersDir();
  if (!dir) throw new Error('No kotatsu-parsers repo found under kotatsu-parsers/ or kotatsu-parsers-redo/');
  const seen = new Set();
  const sources = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!e.isFile() || !e.name.endsWith('.kt')) continue;
      const content = fs.readFileSync(full, 'utf-8');
      const m = content.match(ANNOTATION_RX);
      if (!m) continue;
      const id = m[1].toLowerCase();
      if (seen.has(id)) continue;
      seen.add(id);
      const name = m[2];
      const lang = m[3];
      const rel = full.replace(/\\/g, '/');
      let engine = 'custom_html';
      if (rel.includes('/madara/')) engine = 'madara';
      else if (rel.includes('/mangathemesia/') || content.includes('MangaThemesia') || content.includes('MangaReader')) engine = 'mangathemesia';
      else if (rel.includes('/wpcomics/') || content.includes('WpComics')) engine = 'wpcomics';
      else if (rel.includes('/foolslide/')) engine = 'foolslide';
      else if (id === 'mangadex') engine = 'mangadex';
      const ex = extractParserDomain(content, id);
      sources.push({
        id, name, lang, engine,
        baseUrl: ex.baseUrl, domain: ex.domain, baseUrlReliable: ex.reliable, domainVia: ex.via,
        isNsfw: rel.includes('/galleryadults/') || content.includes('isNsfw = true') || content.includes('isAdult = true') || /18|hentai|porn|doujin/i.test(name),
        file: rel,
      });
    }
  })(dir);
  sources.sort((a, b) => a.id.localeCompare(b.id));
  return { dir, sources };
}

// Legacy extraction for comparison (what server.ts did BEFORE this fix):
// only ConfigKey.Domain, otherwise "<id>.com".
function legacyBaseUrl(content, id) {
  const ck = content.match(/ConfigKey\.Domain\(\s*"([^"]+)"/);
  if (ck) { const d = sanitizeParserDomain(ck[1]); if (d) return `https://${d}`; }
  return `https://${id}.com`;
}
// ---------------------------------------------------------------------------
// Live probing
// ---------------------------------------------------------------------------
function detectBlocked(html, status) {
  if (status === 403 || status === 503 || status === 429) {
    if (/Checking your browser|cf-browser-verification|challenge-platform|Attention Required.*Cloudflare|Just a moment|DDoS protection|Please turn JavaScript on/i.test(html)) return 'cloudflare';
  }
  if (status === 403) {
    if (/captcha|recaptcha|hcaptcha|turnstile|cf-turnstile/i.test(html)) return 'captcha';
    if (/blocked|access denied|ip has been banned/i.test(html)) return 'blocked';
  }
  return 'none';
}

async function fetchOnce(url, timeoutMs) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
      headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,*/*' },
    });
    const body = await res.text();
    return { ok: true, status: res.status, finalUrl: res.url || url, body };
  } catch (e) {
    return { ok: false, status: 0, finalUrl: url, error: e.message || String(e) };
  }
}

function countSeriesLinks(html) {
  const hrefs = html.match(/href=["']([^"']+)["']/gi) || [];
  const re = /\/(manga|series|title|manhwa|manhua|comic|webtoon|reader|comics)\//i;
  return hrefs.filter((h) => re.test(h)).length;
}

function catalogPath(engine) {
  if (engine === 'madara') return '/manga/';
  if (engine === 'mangathemesia') return '/manga/?page=1&order=popular';
  if (engine === 'wpcomics') return '/';
  if (engine === 'foolslide') return '/directory';
  if (engine === 'mangadex') return null;
  return '/series';
}

async function probeSource(src) {
  const base = await fetchOnce(`https://${src.domain}`, 8000);
  let catalog = null;
  const cp = catalogPath(src.engine);
  if (cp && base.ok && base.status === 200) {
    const home = await fetchOnce(`https://${src.domain}${cp}`, 8000);
    catalog = {
      status: home.ok ? home.status : 0,
      seriesLinks: home.ok ? countSeriesLinks(home.body) : 0,
      blocked: home.ok ? detectBlocked(home.body, home.status) : 'none',
      error: home.ok ? undefined : home.error,
    };
  }
  return {
    id: src.id, engine: src.engine, domain: src.domain,
    reachable: base.ok && base.status < 400 ? 'yes' : 'no',
    status: base.ok ? base.status : 0, finalUrl: base.finalUrl,
    blocked: base.ok ? detectBlocked(base.body, base.status) : 'none',
    error: base.ok ? undefined : base.error, catalog: catalog || null,
  };
}

async function probeAll(sources, concurrency, spacing) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < sources.length) {
      const idx = i++;
      const src = sources[idx];
      results.push(await probeSource(src));
      if (spacing > 0) await new Promise((r) => setTimeout(r, spacing));
    }
  }
  const n = Math.max(1, Math.min(concurrency, sources.length));
  await Promise.all(Array.from({ length: n }, worker));
  return results;
}

const DEFAULT_PROBE_IDS = [
  'asurascans', 'flamecomics', 'weebcentral', 'manhwa18', 'manhwa18cc',
  'aquamanga', 'harimanga', 'anisascans', 'manhuaplus', 'manhuaplusorg',
  'mangaread', 'manhwabuddy', 'manhuafast', 'kunmanga', 'topmanhua',
  'manhwaclan', 'atsumoe', 'demonicscans', 'beehentai', 'ravenscans',
  'night', 'hentai20', 'hotcomics', 'daycomics', 'batoto', 'comick',
  'comickfun', 'manhuascan', 'adultwebtoon',
];
// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------
function markdownReport({ dir, sources, invalid, probed }) {
  const lines = [];
  lines.push('# Source Reliability & Functionality Audit');
  lines.push('');
  lines.push(`- Date: ${new Date().toISOString()}`);
  lines.push(`- Parser repo: \`${dir.replace(ROOT + path.sep, '')}\``);
  lines.push(`- Sources ingested: **${sources.length}**`);
  lines.push(`- Reliable baseUrl: **${sources.length - invalid.length}**`);
  lines.push(`- Unreliable baseUrl (fallback/invalid): **${invalid.length}**`);
  lines.push('');
  if (probed) {
    const down = probed.filter((p) => p.reachable === 'no' || p.blocked !== 'none');
    lines.push(`## Live probe (${probed.length} sources, ${down.length} unreachable/blocked)`);
    lines.push('');
    lines.push('| id | engine | reachable | status | blocked | finalUrl | catalog links |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const p of probed) {
      lines.push(`| ${p.id} | ${p.engine} | ${p.reachable} | ${p.status} | ${p.blocked} | ${p.finalUrl} | ${p.catalog?.seriesLinks ?? 'n/a'} |`);
    }
    lines.push('');
  }
  if (invalid.length) {
    lines.push('## Unreliable baseUrl (needs domain fix)');
    lines.push('');
    for (const s of invalid) lines.push(`- \`${s.id}\` → \`${s.domain}\` [via:${s.domainVia}, engine:${s.engine}]`);
  }
  lines.push('');
  lines.push('## Architecture comparison: this web clone vs. Kotatsu (KSP)');
  lines.push('Kotatsu registers sources via the `@MangaSourceParser` Kotlin annotation + a KSP');
  lines.push('annotation processor (`kotatsu-parsers-ksp`) that generates the source registry at');
  lines.push('compile time. Each parser is compiled Kotlin and owns its domain via `ConfigKey.Domain`');
  lines.push('or the base-class constructor — no runtime regex is needed, so domains are always');
  lines.push('authoritative. This Node port cannot compile Kotlin, so it regex-scans `.kt` files and');
  lines.push('must replicate every declaration form (ConfigKey.Domain, base-class constructor, bare');
  lines.push('literal) to avoid registering dead `<id>.com` URLs. `extractParserDomain` is kept in');
  lines.push('sync with server.ts so the audit reflects the live registry.');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const { dir, sources } = ingestSources();

  const scope = sources.filter((s) =>
    (LANG ? s.lang === LANG : true) && (ENGINE ? s.engine === ENGINE : true)
  );
  const invalid = sources.filter(
    (s) => !s.baseUrlReliable || !/^https:\/\/[a-z0-9.-]+\.[a-z]{2,24}\/?$/.test(s.baseUrl)
  );

  // Sources whose baseUrl differs under legacy-vs-improved extraction.
  const fixed = [];
  for (const s of sources) {
    let content;
    try { content = fs.readFileSync(s.file.startsWith(path.sep) ? s.file : path.join(ROOT, s.file), 'utf-8'); } catch { content = ''; }
    if (legacyBaseUrl(content, s.id) !== s.baseUrl) {
      fixed.push({ id: s.id, legacy: legacyBaseUrl(content, s.id), fixed: s.baseUrl, via: s.domainVia });
    }
  }

  console.log(`\nIngested ${sources.length} sources from ${dir.replace(ROOT + path.sep, '')}`);
  console.log(`Reliable baseUrl: ${sources.length - invalid.length} | Unreliable (fallback/invalid): ${invalid.length}`);
  console.log(`\n=== Unreliable baseUrls (${invalid.length}) — sample ===`);
  console.log(invalid.slice(0, 30).map((s) => `  ${s.id.padEnd(26)} -> ${s.domain}  [${s.domainVia}/${s.engine}]`).join('\n'));
  console.log(`\n=== baseUrls corrected vs legacy regex (${fixed.length}) — sample ===`);
  console.log(fixed.slice(0, 25).map((f) => `  ${f.id.padEnd(24)} ${f.legacy}  ->  ${f.fixed}  [${f.via}]`).join('\n'));

  let probeSet = [];
  if (DO_PROBE) {
    if (ONLY.length) probeSet = scope.filter((s) => ONLY.includes(s.id));
    else if (DO_ALL) probeSet = scope.filter((s) => s.id !== 'mangadex');
    else probeSet = scope.filter((s) => DEFAULT_PROBE_IDS.includes(s.id));
    if (probeSet.length === 0) {
      console.log('\nNo sources matched the probe set; falling back to first reliable non-MangaDex sources.');
      probeSet = scope.filter((s) => s.id !== 'mangadex' && s.baseUrlReliable).slice(0, 8);
    }
  }
  const probed = DO_PROBE ? await probeAll(probeSet, CONCURRENCY, SPACING_MS) : null;

  const report = {
    generatedAt: new Date().toISOString(),
    parserRepo: dir.replace(ROOT + path.sep, ''),
    totalIngested: sources.length,
    reliable: sources.length - invalid.length,
    unreliable: invalid.length,
    fixedFromLegacy: fixed.length,
    fixed,
    unreliableSources: invalid.map((s) => ({ id: s.id, domain: s.domain, via: s.domainVia, engine: s.engine, lang: s.lang })),
    probed,
    byEngine: sources.reduce((a, s) => ((a[s.engine] = (a[s.engine] || 0) + 1), a), {}),
    byLang: sources.reduce((a, s) => ((a[s.lang] = (a[s.lang] || 0) + 1), a), {}),
  };

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  fs.writeFileSync(OUT.replace(/\.json$/, '.md'), markdownReport({ dir, sources, invalid, probed }));
  console.log(`\nReport written to ${OUT}`);

      if (probed) {
    console.log(`\n=== LIVE PROBE (${probed.length} sources) ===`);
    for (const p of probed) {
      const links = p.catalog ? String(p.catalog.seriesLinks).padStart(3) : '  -';
      console.log(`  ${p.id.padEnd(20)} ${p.reachable.padEnd(3)} ${String(p.status).padStart(3)} ${p.blocked.padEnd(9)} ${links} links  ${p.finalUrl}${p.error ? '  ERR:' + p.error : ''}`);
    }
  }
}

main().catch((e) => {
  console.error('[source-audit] FATAL:', e?.stack || e);
  process.exit(1);
});