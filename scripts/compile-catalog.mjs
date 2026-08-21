#!/usr/bin/env node
/**
 * compile-catalog.mjs — Rebuild server/sources/catalog.json (source registry)
 *
 * Ingests the Kotatsu parser definitions and emits a clean, validated catalog that
 * the server loads at startup (server/sources/sourcesCatalog.ts). This fixes the
 * legacy pipeline which (1) hard-crashed when kotatsu-parsers/ was not present and
 * (2) used a primitive domain extractor that registered dead "<id>.com" URLs.
 *
 * INPUT PRIORITY (first one that resolves wins):
 *   1. --parsers <dir>            explicit Kotlin parser repo dir
 *   2. KOTATSU_PARSERS_DIR env    explicit Kotlin parser repo dir
 *   3. kotatsu-parsers-redo/      vendored repo (site dir auto-detected)
 *   4. kotatsu-parsers/           vendored repo (site dir auto-detected)
 *   5. --snapshot <file>          previously captured scripts/ingested-sources.json
 *   6. existing catalog.json      (refine/validate in place — safe default)
 *
 * DOMAIN CORRECTION:
 *   A curated map (scripts/domain-corrections.json) is applied on top so known
 *   stale / migrated domains (e.g. asuracomic.net -> asurascans.com) are repaired
 *   even when only a snapshot or the existing catalog is available.
 *
 * OUTPUT:
 *   Adds/keeps a `baseUrlReliable` flag per source so operators can tell which
 *   domains were extracted authoritatively vs the unreliable "<id>.com" fallback.
 *
 * MODE: --dry-run by default (prints a diff summary, writes NOTHING).
 *       --write to persist the rebuilt catalog.
 *
 * Usage:
 *   node scripts/compile-catalog.mjs                     # dry-run against existing catalog
 *   node scripts/compile-catalog.mjs --write             # apply
 *   node scripts/compile-catalog.mjs --parsers ../kotatsu-parsers --write
 *   node scripts/compile-catalog.mjs --snapshot scripts/ingested-sources.json --write
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const flagVal = (name, dflt = undefined) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : dflt;
};
const flagBool = (name) => args.includes(name);

const DO_WRITE = flagBool('--write');
const OUT = flagVal('--out', path.join(ROOT, 'server', 'sources', 'catalog.json'));
const CORRECTIONS_PATH = flagVal('--corrections', path.join(ROOT, 'scripts', 'domain-corrections.json'));
const SNAPSHOT_PATH = flagVal('--snapshot', path.join(ROOT, 'scripts', 'ingested-sources.json'));

// Parsers to detect engine type. Kept in sync with the helpers in server.ts / source-audit.mjs.
const PARSER_CLASS_RX =
  /(?:MadaraParser|MangaThemesiaParser|MangaReaderParser|FoolSlideParser|WpComicsParser|HotComicsParser|Manhwa18Parser|PagedMangaParser)\s*\(/;
const ANNOTATION_RX = /@MangaSourceParser\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"/;

/** Validate and normalize a raw hostname; returns a clean dotted domain or null. */
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

// ---------------------------------------------------------------------------
// Legacy regex domain extractor (for comparison / delta reporting).
// Replicates the primitive logic the server used historically.
// ---------------------------------------------------------------------------
const LEGACY_DOMAIN_RX = /https?:\/\/([^\/\s'"]+)/;
function legacyBaseUrl(content, id) {
  if (!content) return null;
  let m = content.match(/baseUrl\s*=\s*["']([^"']+)["']/);
  if (!m) m = content.match(/baseUrl\s*=\s*["']([^"']+)["']/i);
  if (!m) {
    const parserMatch = content.match(PARSER_CLASS_RX);
    if (parserMatch) {
      const idx = parserMatch.index;
      const window = content.slice(Math.max(0, idx - 400), idx + 400);
      m = window.match(LEGACY_DOMAIN_RX);
    }
  }
    return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Parse a single Kotlin parser file into a source descriptor.
// Returns null if neither annotation nor parser class is found.
// ---------------------------------------------------------------------------
function parseParserFile(filePath, fileContent) {
  const rel = path.relative(path.join(ROOT, 'kotatsu-parsers'), filePath).replace(/\\/g, '/');

  let ann = null;
  const am = fileContent.match(ANNOTATION_RX);
  if (am) {
    ann = { lang: am[1] || 'en', id: am[2] || '', name: am[3] || am[2] || '' };
  }

  const parserMatch = fileContent.match(PARSER_CLASS_RX);
  if (!parserMatch && !ann) return null;

  let baseUrl = null;
  const baseUrlPatterns = [
    /baseUrl\s*=\s*["']([^"']+)["']/,
    /baseUrl\s*=\s*"https?:\/\/([^"']+)"/,
    /"https?:\/\/([^"\s]+)"/,
  ];
  for (const pat of baseUrlPatterns) {
    const m = fileContent.match(pat);
    if (m && m[1]) {
      baseUrl = m[1];
      if (!baseUrl.startsWith('http')) baseUrl = 'https://' + baseUrl;
      break;
    }
  }

  const domain = baseUrl ? sanitizeParserDomain(baseUrl) : null;

  let engine = ann ? ann.id : '';
  if (parserMatch) {
    const cls = parserMatch[0];
    if (/MadaraParser/.test(cls)) engine = engine || 'madara';
    else if (/MangaThemesiaParser/.test(cls)) engine = engine || 'mangathemesia';
    else if (/MangaReaderParser/.test(cls)) engine = engine || 'mangareader';
    else if (/FoolSlideParser/.test(cls)) engine = engine || 'foolslide';
    else if (/WpComicsParser/.test(cls)) engine = engine || 'wpcomics';
    else if (/HotComicsParser/.test(cls)) engine = engine || 'hotcomics';
    else if (/Manhwa18Parser/.test(cls)) engine = engine || 'manhwa18';
    else if (/PagedMangaParser/.test(cls)) engine = engine || 'pagedmanga';
  }

  let id = ann && ann.id ? ann.id : '';
  if (!id) {
    const fname = path.basename(filePath, path.extname(filePath));
    id = fname.replace(/^[^a-zA-Z0-9]+/, '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || domain || '';
  }

  return {
    id,
    name: ann && ann.name ? ann.name : (id || domain || rel),
    baseUrl: baseUrl || (domain ? 'https://' + domain : ''),
    engineType: engine || 'custom_html',
    lang: ann ? ann.lang : 'en',
    isNsfw: /18|hentai|porn|adult/i.test(id),
    baseUrlReliable: !!domain,
        file: rel,
  };
}

// ---------------------------------------------------------------------------
// Locate the Kotatsu parser repo directory.
// ---------------------------------------------------------------------------
function findParserRepo() {
  const explicit = flagVal('--parsers') || process.env.KOTATSU_PARSERS_DIR;
  if (explicit) {
    const p = path.resolve(explicit);
    return fs.existsSync(p) ? p : null;
  }
  for (const candidate of ['kotatsu-parsers', 'kotatsu-parsers-redo']) {
    const p = path.join(ROOT, candidate);
    if (fs.existsSync(path.join(p, 'src'))) return p;
    if (fs.existsSync(path.join(p, 'build', 'src'))) return p;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Walk a Kotlin source dir for .kt files and parse each.
// ---------------------------------------------------------------------------
function ingestFromRepo(repoDir) {
  const srcRoot = fs.existsSync(path.join(repoDir, 'src')) ? path.join(repoDir, 'src') : path.join(repoDir, 'build', 'src');
  const sources = [];
  const scan = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) scan(full);
      else if (entry.isFile() && entry.name.endsWith('.kt')) {
        let content;
        try { content = fs.readFileSync(full, 'utf-8'); } catch { continue; }
        const src = parseParserFile(full, content);
        if (src) sources.push(src);
      }
    }
  };
  scan(srcRoot);
  return { dir: srcRoot, sources };
}

// ---------------------------------------------------------------------------
// Fallback: read a previously captured ingested-sources.json snapshot.
// ---------------------------------------------------------------------------
function ingestFromSnapshot(snapshotPath) {
  if (!fs.existsSync(snapshotPath)) return null;
  const j = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
  const sources = Array.isArray(j) ? j : (j.sources || j.results || []);
  return { dir: snapshotPath, sources: sources.map((s) => ({
    id: s.id || path.basename(s.file || ''),
    name: s.name || s.id || '',
    baseUrl: s.baseUrl || '',
    engineType: s.engine || s.engineType || 'custom_html',
    lang: s.lang || 'en',
    isNsfw: s.isNsfw || false,
        baseUrlReliable: s.baseUrlReliable ?? !!sanitizeParserDomain(s.baseUrl),
    file: s.file || '',
  })) };
}

// ---------------------------------------------------------------------------
// Fallback: refine existing catalog.json in place (validate + correct domains).
// ---------------------------------------------------------------------------
function ingestFromExisting(catalogPath) {
  if (!fs.existsSync(catalogPath)) return null;
  const existing = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
  const sources = Array.isArray(existing) ? existing : (existing.sources || existing.results || []);
  return { dir: catalogPath, sources: sources.map((s) => ({
    id: s.id,
    name: s.name || s.id,
    baseUrl: s.baseUrl || '',
    engineType: s.engineType || s.engine || 'custom_html',
    lang: s.lang || 'en',
    isNsfw: s.isNsfw || false,
        baseUrlReliable: s.baseUrlReliable || !!sanitizeParserDomain(s.baseUrl),
  })) };
}

// ---------------------------------------------------------------------------
// Apply domain corrections from domain-corrections.json
// ---------------------------------------------------------------------------
function loadCorrections() {
  try {
    if (fs.existsSync(CORRECTIONS_PATH)) {
      return JSON.parse(fs.readFileSync(CORRECTIONS_PATH, 'utf-8'));
    }
  } catch (e) {
    console.warn('[compile-catalog] failed to read domain-corrections.json:', e.message);
  }
  return [];
}

function applyCorrections(sources, corrections) {
  const byId = new Map(corrections.map((c) => [c.id.toLowerCase(), c]));
  const byDomain = new Map();
  for (const c of corrections) {
    if (c.baseUrl) {
      const d = sanitizeParserDomain(c.baseUrl);
      if (d) byDomain.set(d, c);
    }
  }
  let applied = 0;
  const corrected = sources.map((s) => {
    const cid = byId.get(s.id.toLowerCase());
    if (cid) {
      applied++;
      return {
        ...s,
        baseUrl: cid.baseUrl || s.baseUrl,
        engineType: cid.engineType || s.engineType,
        name: cid.name || s.name,
        baseUrlReliable: true,
      };
    }
    const sdom = s.baseUrl ? sanitizeParserDomain(s.baseUrl) : null;
    const cdom = sdom ? byDomain.get(sdom) : null;
    if (cdom) {
      applied++;
      return {
        ...s,
        baseUrl: cdom.baseUrl || s.baseUrl,
        engineType: cdom.engineType || s.engineType,
        name: cdom.name || s.name,
        baseUrlReliable: true,
      };
    }
    return s;
  });
    return { sources: corrected, applied };
}

// ---------------------------------------------------------------------------
// Final validation: ensure baseUrl is a clean https URL with a valid hostname.
// ---------------------------------------------------------------------------
function validateSources(sources) {
  return sources.map((s) => {
    let baseUrl = s.baseUrl || '';
    const domain = baseUrl ? sanitizeParserDomain(baseUrl) : null;
    if (domain) {
      baseUrl = 'https://' + domain;
    }
    return {
      id: s.id,
      name: s.name || s.id,
      baseUrl,
      engineType: s.engineType || 'custom_html',
      lang: s.lang || 'en',
      isNsfw: !!s.isNsfw,
      baseUrlReliable: s.baseUrlReliable && !!domain,
    };
  });
}

// ---------------------------------------------------------------------------
// Build final catalog: deduplicated by id (last wins), sorted.
// ---------------------------------------------------------------------------
function buildCatalog(sources) {
  const byId = new Map();
  for (const s of sources) {
    byId.set(s.id, s);
  }
  return Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// Diff reporting (for dry-run)
// ---------------------------------------------------------------------------
function diffCatalog(oldCatalog, newCatalog) {
  const oldMap = new Map(oldCatalog.map((s) => [s.id, s]));
  const added = [];
  const removed = [];
  const changed = [];
  for (const s of newCatalog) {
    const o = oldMap.get(s.id);
    if (!o) added.push(s);
    else if (o.baseUrl !== s.baseUrl || o.engineType !== s.engineType || o.lang !== s.lang || o.name !== s.name) {
      changed.push({ old: o, new: s });
    }
  }
  for (const o of oldCatalog) {
    if (!newCatalog.find((s) => s.id === o.id)) removed.push(o);
  }
    return { added, removed, changed };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  let ingested = null;
  const repo = findParserRepo();
  if (repo) {
    console.log('[compile-catalog] Ingesting from Kotatsu parser repo:', repo);
    ingested = ingestFromRepo(repo);
  } else if (fs.existsSync(SNAPSHOT_PATH)) {
    console.log('[compile-catalog] No parser repo found; ingesting from snapshot:', SNAPSHOT_PATH);
    ingested = ingestFromSnapshot(SNAPSHOT_PATH);
  } else {
    console.log('[compile-catalog] No parser repo or snapshot; refining existing catalog.json');
    ingested = ingestFromExisting(OUT);
  }

  const corrections = loadCorrections();
  console.log('[compile-catalog] Loaded', corrections.length, 'domain corrections');
  const { sources: corrected, applied } = applyCorrections(ingested.sources, corrections);
  console.log('[compile-catalog] Applied', applied, 'domain corrections');

  const validated = validateSources(corrected);
  const newCatalog = buildCatalog(validated);
  const reliable = newCatalog.filter((s) => s.baseUrlReliable).length;
  console.log('[compile-catalog] Total sources:', newCatalog.length, '| Reliable baseUrl:', reliable, '| Unreliable:', newCatalog.length - reliable);

  let oldCatalog = [];
  try {
    if (fs.existsSync(OUT)) oldCatalog = JSON.parse(fs.readFileSync(OUT, 'utf-8'));
  } catch {
    oldCatalog = [];
  }
  const { added, removed, changed } = diffCatalog(oldCatalog, newCatalog);

  console.log('[compile-catalog] Diff: +' + added.length + ' ~' + changed.length + ' -' + removed.length);
  if (added.length > 0) {
    console.log('  ADDED:', added.slice(0, 20).map((s) => s.id).join(', '));
    if (added.length > 20) console.log('   ... and', added.length - 20, 'more');
  }
  if (changed.length > 0) {
    console.log('  CHANGED (sample):');
    changed.slice(0, 20).forEach((c) => {
      console.log('   ', c.old.id, c.old.baseUrl, '->', c.new.baseUrl, '(' + c.old.engineType + '->' + c.new.engineType + ')');
    });
    if (changed.length > 20) console.log('   ... and', changed.length - 20, 'more');
  }
  if (removed.length > 0) {
    console.log('  REMOVED:', removed.slice(0, 20).map((s) => s.id).join(', '));
    if (removed.length > 20) console.log('   ... and', removed.length - 20, 'more');
  }

  if (DO_WRITE) {
    fs.writeFileSync(OUT, JSON.stringify(newCatalog, null, 2), 'utf-8');
    console.log('[compile-catalog] Wrote', newCatalog.length, 'sources to', OUT);
  } else {
    console.log('[compile-catalog] Dry-run only. Pass --write to persist.');
  }
}

main().catch((e) => {
  console.error('[compile-catalog] FATAL:', e?.stack || e);
  process.exit(1);
});
