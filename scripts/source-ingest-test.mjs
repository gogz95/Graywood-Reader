// Temporary diagnostic: replicate server.ts loadKotatsuParsersFromClonedRepo() logic
// against the vendored kotatsu-parsers repo and report what the scanner would ingest.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const legacyDir = path.join(root, 'kotatsu-parsers', 'src', 'main', 'kotlin', 'org', 'koitharu', 'kotatsu', 'parsers', 'site');
const redoDir = path.join(root, 'kotatsu-parsers-redo', 'src', 'main', 'kotlin', 'org', 'koitharu', 'kotatsu', 'parsers', 'site');
const parsersDir = fs.existsSync(redoDir) ? redoDir : (fs.existsSync(legacyDir) ? legacyDir : null);

if (!parsersDir) {
  console.error('NO parsers dir found');
  process.exit(1);
}

const annotationRx = /@MangaSourceParser\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"/;
const domainRx = /ConfigKey\.Domain\(\s*"([^"]+)"/;

const found = [];
const seen = new Set();
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
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
    const dm = content.match(domainRx);
    const domain = dm ? dm[1] : null;
    // Also try the base-class constructor style: MadaraParser(ctx, Source, "domain.tld")
    const ctorMatch = content.match(/(?:MadaraParser|MangaThemesiaParser|FoolSlideParser|WpComicsParser|MangaReaderParser|HotComicsParser|CustomParser|MangaLoaderContext\s*,\s*\w+\s*,\s*)\s*\([^)]*,\s*["']([^"']+)["']/);
    const domain2 = domain || (ctorMatch ? ctorMatch[1] : null);
    const usedFallback = !domain2;
    const finalDomain = domain2 || `${id}.com`;
    const rel = full.replace(/\\/g, '/');
    let engine = 'custom_html';
    if (rel.includes('/madara/')) engine = 'madara';
    else if (rel.includes('/mangathemesia/') || content.includes('MangaThemesia') || content.includes('MangaReader')) engine = 'mangathemesia';
    else if (rel.includes('/wpcomics/') || content.includes('WpComics')) engine = 'wpcomics';
    else if (rel.includes('/foolslide/')) engine = 'foolslide';
    else if (id === 'mangadex') engine = 'mangadex';
    found.push({ id, name, lang, engine, baseUrl: `https://${finalDomain}`, usedFallback, rel });
  }
}

walk(parsersDir);

const byEngine = {};
for (const s of found) byEngine[s.engine] = (byEngine[s.engine] || 0) + 1;
const byLang = {};
for (const s of found) byLang[s.lang] = (byLang[s.lang] || 0) + 1;

console.log(`parsersDir: ${parsersDir}`);
console.log(`TOTAL ingested: ${found.length}`);
console.log('\nBy engine:', JSON.stringify(byEngine, null, 2));
console.log('By lang:', JSON.stringify(byLang, null, 2));

// English sources
const en = found.filter((s) => s.lang === 'en');
console.log(`\nEN sources: ${en.length}`);
console.log(en.map((s) => `${s.id} (${s.engine}) ${s.baseUrl}`).join('\n'));

fs.writeFileSync(path.join(root, 'scripts', 'ingested-sources.json'), JSON.stringify(found, null, 2));
console.log('\nWrote scripts/ingested-sources.json');

// Reliability metric: how many got a `${id}.com` fallback domain (no reliable domain extracted)
const fallback = found.filter((s) => s.usedFallback);
console.log(`\nRELIABILITY: ${fallback.length}/${found.length} sources used the 'id.com'-style fallback domain`);
console.log(fallback.slice(0, 40).map((s) => `  ${s.id} -> ${s.baseUrl} (${s.engine})`).join('\n'));
