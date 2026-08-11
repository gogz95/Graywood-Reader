// Audit Tailwind color utility usage across the frontend source.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const files = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(tsx|ts|html|css)$/.test(name)) files.push(p);
  }
}
walk(join(root, 'src'));
files.push(join(root, 'index.html'));

const counts = new Map();
const re = /((?:[a-z-]+:)*)((?:bg|text|border|divide|ring|shadow|from|via|to|outline|placeholder|fill|stroke|decoration|caret|accent)-(?:slate|amber|orange|red|rose|pink|fuchsia|purple|violet|indigo|blue|sky|cyan|teal|emerald|green|lime|yellow|white|black|zinc|gray|neutral|stone|warm|truegray|cool|night|paper|sepia|gold|silver|cream|electric)-?\w*(?:-\d{2,3})?(?:\/\d{1,3})?)/g;

for (const f of files) {
  const content = readFileSync(f, 'utf8');
  for (const m of content.matchAll(re)) {
    const key = m[1] + m[2];
    counts.set(key, (counts.get(key) || 0) + 1);
  }
}

const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
console.log('Total unique tokens:', entries.length);
for (const [k, v] of entries) console.log(String(v).padStart(5), k);
