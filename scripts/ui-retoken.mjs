/**
 * ui-retoken.mjs — one-shot migration of hardcoded Tailwind palette classes
 * to the OmniManga adaptive design tokens (see src/index.css).
 *
 * - Lines containing `NO-THEME` are skipped (literal preview swatches, etc.)
 * - Opacity modifiers and variant prefixes (hover:, focus:, md:, …) preserved.
 * - Decorative -700…-950 tints of semantic palettes are intentionally kept.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === 'data' || name === 'node_modules') continue;
      walk(p);
    } else if (['.tsx'].includes(extname(name))) files.push(p);
  }
})(join(root, 'src'));
files.push(join(root, 'index.html'));

/* ── Exact-string pre-passes (order matters) ─────────────────────────────── */
const exact = [
  ['bg-gradient-to-tr from-amber-500 via-orange-500 to-red-500', 'bg-accent-grad'],
  ['bg-gradient-to-r from-amber-500 via-orange-500 to-red-500', 'bg-accent-grad'],
  ['from-slate-100 via-slate-200 to-slate-400', 'from-primary via-primary to-muted'],
  ['bg-gradient-to-t from-slate-950 via-slate-950/40 to-transparent', 'bg-gradient-to-t from-black/80 via-black/30 to-transparent'],
  ['bg-gradient-to-t from-slate-950 via-transparent to-transparent', 'bg-gradient-to-t from-black/80 via-black/25 to-transparent'],
  ['bg-amber-900/60', 'bg-accent/25'],
  ['to-amber-950/40', 'to-accent/15'],
  ['to-amber-950/20', 'to-accent/5'],
];

/* ── Generic prefix/palette/shade → token map ────────────────────────────── */
const SLATE = {
  bg: { 950: 'app', 900: 'surface', 800: 'elevated', 750: 'elevated', 700: 'elevated', 600: 'elevated', 500: 'elevated' },
  text: { 50: 'primary', 100: 'primary', 200: 'primary', 300: 'secondary', 400: 'secondary', 500: 'muted', 600: 'muted', 900: 'accent-fg', 950: 'accent-fg' },
  border: { 900: 'edge', 800: 'edge', 700: 'edge-strong', 600: 'edge-strong', 500: 'edge-strong' },
  divide: { 800: 'edge', 700: 'edge' },
  placeholder: { 400: 'muted', 500: 'muted', 600: 'muted' },
  ring: { 950: 'app', 900: 'edge', 800: 'edge', 700: 'edge-strong' },
  from: { 950: 'app', 900: 'surface', 800: 'elevated', 50: 'primary', 100: 'primary', 200: 'primary', 300: 'secondary', 400: 'muted' },
  via: { 950: 'app', 900: 'surface', 800: 'elevated', 50: 'primary', 100: 'primary', 200: 'primary', 300: 'secondary', 400: 'muted' },
  to: { 950: 'app', 900: 'surface', 800: 'elevated', 50: 'primary', 100: 'primary', 200: 'primary', 300: 'secondary', 400: 'muted' },
  fill: { 900: 'accent-fg', 950: 'accent-fg' },
  shadow: { 900: 'black', 950: 'black' },
};

const brightRange = [50, 100, 200, 300, 400, 500, 600];
const inBright = (shade) => brightRange.includes(shade);

function mapToken(prefix, palette, shade) {
  if (palette === 'slate') {
    const t = SLATE[prefix]?.[shade];
    return t ? `${prefix}-${t}` : null;
  }
  if (palette === 'amber') {
    if (shade >= 900) return null; // handled by exact pre-passes
    if (prefix === 'bg') return `bg-${shade <= 400 ? 'accent-bright' : shade >= 600 ? 'accent-deep' : 'accent'}`;
    if (prefix === 'to') return `to-${shade <= 400 ? 'accent-bright' : 'accent'}`;
    return `${prefix}-accent`;
  }
  if (palette === 'orange') return inBright(shade) ? `${prefix}-accent-2` : null;
  if (palette === 'red' || palette === 'rose') return inBright(shade) ? `${prefix}-danger` : null;
  if (['emerald', 'green', 'teal', 'lime'].includes(palette)) return inBright(shade) ? `${prefix}-success` : null;
  if (['cyan', 'sky', 'blue'].includes(palette)) return inBright(shade) ? `${prefix}-info` : null;
  if (['purple', 'violet', 'indigo', 'fuchsia', 'pink'].includes(palette)) return inBright(shade) ? `${prefix}-accent-2` : null;
  return null;
}

const PREFIXES = 'bg|text|border|divide|ring|shadow|from|via|to|outline|placeholder|fill|stroke|decoration|caret|accent';
const PALETTES = 'slate|amber|orange|red|rose|pink|fuchsia|purple|violet|indigo|blue|sky|cyan|teal|emerald|green|lime|yellow';
const tokenRe = new RegExp(`(?<![\\w-])((?:${PREFIXES})-(${PALETTES})-(\\d{2,3}))(\\/\\d{1,3})?(?![\\w-])`, 'g');

let totalReplaced = 0;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  let changed = 0;
  const out = src
    .split('\n')
    .map((line) => {
      if (line.includes('NO-THEME')) return line;
      let l = line;
      for (const [from, to] of exact) {
        if (l.includes(from)) {
          l = l.split(from).join(to);
          changed++;
        }
      }
      l = l.replace(tokenRe, (m, whole, palette, shadeStr, opacity) => {
        const prefix = whole.slice(0, whole.indexOf('-'));
        const replacement = mapToken(prefix, palette, Number(shadeStr));
        if (!replacement) return m;
        changed++;
        return replacement + (opacity || '');
      });
      return l;
    })
    .join('\n');

  if (changed > 0) {
    writeFileSync(f, out);
    totalReplaced += changed;
    console.log(`retokened ${String(changed).padStart(4)}  ${f.replace(root, '')}`);
  }
}
console.log(`\nDone — ${totalReplaced} replacements across ${files.length} files.`);
