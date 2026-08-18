import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const legacyDir = path.join(root, 'kotatsu-parsers', 'src', 'main', 'kotlin', 'org', 'koitharu', 'kotatsu', 'parsers', 'site');
const redoDir = path.join(root, 'kotatsu-parsers-redo', 'src', 'main', 'kotlin', 'org', 'koitharu', 'kotatsu', 'parsers', 'site');
const parsersDir = fs.existsSync(redoDir) ? redoDir : (fs.existsSync(legacyDir) ? legacyDir : null);

if (!parsersDir) {
  console.error('Parsers directory not found under kotatsu-parsers/ or kotatsu-parsers-redo/');
  process.exit(1);
}

const PARSER_CLASS_RX = /(?:MadaraParser|MangaThemesiaParser|MangaReaderParser|FoolSlideParser|WpComicsParser|HotComicsParser|Manhwa18Parser|PagedMangaParser)\s*\(/;

function sanitizeParserDomain(raw) {
  if (!raw) return null;
  let d = String(raw).trim().toLowerCase();
  d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/\/.*$/, '').replace(/^www\./, '').replace(/\.$/, '');
  if (!d || d.length < 4 || d.length > 253) return null;
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) return null;
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
  if (ck) {
    const p = pick(ck[1], 'configKey', true);
    if (p) return p;
  }
  // 2) Base-class theme constructor: ClassName(context, Source, "tld").
  if (PARSER_CLASS_RX.test(content)) {
    const m = content.match(PARSER_CLASS_RX);
    const start = (m.index || 0) + m[0].length;
    const slice = content.slice(start, start + 280);
    const literals = slice.match(/["']([^"']+)["']/g) || [];
    for (let i = literals.length - 1; i >= 0; i--) {
      const p = pick(literals[i].slice(1, -1), 'ctor', true);
      if (p) return p;
    }
  }
  // 3) A lone dotted-domain literal elsewhere in the file (validated; uncertain).
  const bare = content.match(/["']((?:[a-z0-9-]+\.)+[a-z]{2,24})["']/i);
  if (bare) {
    const p = pick(bare[1], 'bare', false);
    if (p) return p;
  }
  // 4) Fallback
  return { domain: `${fallbackId}.com`, baseUrl: `https://${fallbackId}.com`, reliable: false, via: 'fallback' };
}

const annotationRx = /@MangaSourceParser\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"/;
const seen = new Set();
const sources = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.kt')) continue;
    const content = fs.readFileSync(full, 'utf-8');
    const m = content.match(annotationRx);
    if (!m) continue;
    const rawId = m[1];
    const name = m[2];
    const lang = m[3];
    const id = rawId.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    const rel = full.replace(/\\/g, '/');
    let engineType = 'custom_html';
    if (rel.includes('/madara/')) engineType = 'madara';
    else if (rel.includes('/mangathemesia/') || content.includes('MangaThemesia') || content.includes('MangaReader')) engineType = 'mangathemesia';
    else if (rel.includes('/wpcomics/') || content.includes('WpComics')) engineType = 'wpcomics';
    else if (rel.includes('/foolslide/')) engineType = 'foolslide';
    else if (id === 'mangadex') engineType = 'mangadex';

    const isNsfw = rel.includes('/galleryadults/') || content.includes('isNsfw = true') || content.includes('isAdult = true') || /18|hentai|porn|doujin/i.test(name);
    const ex = extractParserDomain(content, id);

    sources.push({
      id,
      name,
      baseUrl: ex.baseUrl,
      engineType,
      lang,
      isNsfw,
    });
  }
}

walk(parsersDir);
sources.sort((a, b) => a.id.localeCompare(b.id));

const outDir = path.join(root, 'server', 'sources');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const targetPath = path.join(outDir, 'catalog.json');
fs.writeFileSync(targetPath, JSON.stringify(sources, null, 2));

console.log(`Compiled ${sources.length} sources into ${targetPath}`);
