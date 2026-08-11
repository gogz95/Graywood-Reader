// Rechecks every registered live source for functionality via the running server.
// For each source domain it finds a representative manga (with a NON-MangaDex live sourceUrl),
// then probes:
//   A) /api/reader/chapters/:mangaId  -> must return a non-fabricated, non-empty chapter list
//   B) /api/reader/chapter-pages      -> must return REAL panel pages (not the placeholder generator)
const BASE = 'http://localhost:3000';

const DOMAINS = [
  'mangadex', 'dynasty', 'asura', 'flame', 'luminous', 'night', 'immortal',
  'manhwabuddy', 'manhuafast', 'kunmanga', 'manhwa18', 'manhuaplus', 'mangatx',
  'topmanhua', 'manhwaclan', 'aquamanga', 'weebcentral', 'atsumoe', 'demonicscans',
];

const PLACEHOLDER_MARK = '/api/reader/panel-image';

async function getJSON(path, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(BASE + path, { signal: ctrl.signal });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(t);
  }
}

function isFabricatedChapterList(list) {
  // Real enumerated chapters have source-prefixed ids (asura_, flame_, dynasty_, <domain>_).
  // The fabricated fallback uses ids like `ch_<mangaId>_<n>`.
  if (!Array.isArray(list) || list.length === 0) return true;
  const sample = list[0];
  return /^ch_m/.test(String(sample.id || ''));
}

async function main() {
  const mangaRes = await getJSON('/api/manga', 20000);
  if (!mangaRes.ok || !Array.isArray(mangaRes.json)) {
    console.log('Could not fetch /api/manga:', mangaRes.status, mangaRes.json);
    return;
  }
  const all = mangaRes.json;

  // Index first usable manga per domain (prefer a non-MangaDex sourceUrl that contains the domain).
  const pick = {};
  for (const m of all) {
    const url = m.sourceUrl || '';
    if (!/^https?:\/\//.test(url)) continue;
    if (/mangadex\.org/i.test(url)) continue; // metadata-only, not a reading source
    for (const d of DOMAINS) {
      if (pick[d]) continue;
      if (url.toLowerCase().includes(d)) pick[d] = m;
    }
  }

  console.log('=== SOURCE RECHECK (via running server) ===\n');
  let pass = 0, fail = 0;

  for (const d of DOMAINS) {
    const m = pick[d];
    const label = `[${d}]`;
    if (!m) {
      console.log(`${label.padEnd(22)} NO live-series found in DB (skipped)`);
      continue;
    }
    const id = m.id;
    const title = (m.title || '').slice(0, 40);
    try {
      // A) chapter list
      const chRes = await getJSON(`/api/reader/chapters/${encodeURIComponent(id)}?order=asc`, 25000);
      const chList = chRes.json;
      const fabricated = isFabricatedChapterList(chList);
      const chCount = Array.isArray(chList) ? chList.length : 0;
      const realChapters = !fabricated && chCount > 0;

      // B) page extraction for the first available chapter
      let probe = 'n/a';
      let realPages = false;
      if (realChapters) {
        const firstNum = chList[0].chapterNumber;
        const pgRes = await getJSON(`/api/reader/chapter-pages?mangaId=${encodeURIComponent(id)}&chapterNumber=${firstNum}`, 30000);
        const pages = pgRes.json?.pages;
        if (Array.isArray(pages) && pages.length > 0) {
          realPages = pages.some((p) => !String(p).includes(PLACEHOLDER_MARK));
          probe = `${pages.length} pages` + (realPages ? ' [REAL]' : ' [placeholder]');
        } else {
          probe = '0 pages';
        }
      } else {
        probe = chCount === 0 ? '0 chapters' : 'fabricated chapters';
      }

      const ok = realChapters && realPages;
      if (ok) pass++; else fail++;
      console.log(
        `${label.padEnd(22)} ${ok ? 'OK ' : 'FAIL'}  chapters=${chCount}${fabricated ? '(fab)' : '(real)'} | pages: ${probe} | ${title}`
      );
    } catch (err) {
      fail++;
      console.log(`${label.padEnd(22)} FAIL  ${err.message} | ${title}`);
    }
  }

  console.log(`\n=== RESULT: ${pass} OK, ${fail} FAIL ===`);
}

main();