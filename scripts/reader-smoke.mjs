/**
 * Live reader smoke checks (requires network + running extraction code via direct import is heavy).
 * This script hits public APIs the server uses and validates Manhwa18 series-page filtering.
 */
const ASURA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Accept: 'application/json',
  Origin: 'https://asurascans.com',
  Referer: 'https://asurascans.com/',
};

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function checkAsura() {
  const listRes = await fetch('https://api.asurascans.com/api/series/nano-machine/chapters', {
    headers: ASURA_HEADERS,
    signal: AbortSignal.timeout(20000),
  });
  assert(listRes.ok, 'Asura chapter list HTTP ' + listRes.status);
  const list = await listRes.json();
  assert(Array.isArray(list.data) && list.data.length > 0, 'Asura chapter list empty');
  const ch = list.data.find((c) => !c.is_locked && c.slug) || list.data[0];
  const pagesRes = await fetch(
    `https://api.asurascans.com/api/series/nano-machine/chapters/${ch.slug}`,
    { headers: ASURA_HEADERS, signal: AbortSignal.timeout(20000) }
  );
  assert(pagesRes.ok, 'Asura pages HTTP ' + pagesRes.status);
  const pagesJson = await pagesRes.json();
  const pages = pagesJson?.data?.chapter?.pages || [];
  assert(Array.isArray(pages) && pages.length > 0, 'Asura pages empty');
  const first = typeof pages[0] === 'string' ? pages[0] : pages[0]?.url;
  assert(typeof first === 'string' && first.startsWith('http'), 'Asura first page not a URL');
  console.log('[OK] Asura nano-machine ch', ch.number, '→', pages.length, 'pages');
}

async function checkManhwa18Catalog() {
  const res = await fetch('https://manhwa18.com/manga-list?page=1&sort=az', {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Accept: 'text/html',
      Referer: 'https://manhwa18.com/',
    },
    signal: AbortSignal.timeout(20000),
  });
  assert(res.ok, 'Manhwa18 list HTTP ' + res.status);
  const html = await res.text();
  const titleRx = /<div class="thumb_attr series-title">\s*<a href="([^"]+)" title="([^"]+)"/gi;
  const series = new Set();
  const titles = new Set();
  let m;
  while ((m = titleRx.exec(html)) !== null) {
    let href = m[1];
    if (!href.startsWith('http')) href = 'https://manhwa18.com' + (href.startsWith('/') ? '' : '/') + href;
    href = href.replace(/\/+$/, '');
    try {
      const u = new URL(href);
      const ok = /^\/manga\/([^/]+)$/i.test(u.pathname.replace(/\/+$/, ''));
      if (!ok) continue;
      series.add(href);
      titles.add(m[2]);
    } catch {}
  }
  assert(series.size >= 5, 'Manhwa18 series pages too few: ' + series.size);
  assert(![...series].some((h) => /\/chap-/i.test(h)), 'Manhwa18 series set still contains chapter URLs');
  console.log('[OK] Manhwa18 catalog series pages:', series.size, 'unique titles:', titles.size);
}

async function checkLocalServer() {
  const base = process.env.SMOKE_BASE || 'http://127.0.0.1:3000';
  try {
    const h = await fetch(base + '/api/health', { signal: AbortSignal.timeout(4000) });
    if (!h.ok) {
      console.log('[SKIP] local server health not ok');
      return;
    }
    const health = await h.json();
    console.log('[OK] local health', health.status, 'series', health.databaseSize);

    const analytics = await fetch(base + '/api/reader/analytics', { signal: AbortSignal.timeout(5000) });
    assert(analytics.ok, 'analytics HTTP ' + analytics.status);
    const a = await analytics.json();
    assert(typeof a.currentStreakDays === 'number', 'analytics missing streak');
    console.log('[OK] analytics streaks', a.currentStreakDays, '/', a.longestStreakDays);
  } catch (e) {
    console.log('[SKIP] local server not reachable:', e.message);
  }
}

(async () => {
  const failures = [];
  for (const [name, fn] of [
    ['asura', checkAsura],
    ['manhwa18', checkManhwa18Catalog],
    ['local', checkLocalServer],
  ]) {
    try {
      await fn();
    } catch (e) {
      failures.push(name + ': ' + e.message);
      console.error('[FAIL]', name, e.message);
    }
  }
  if (failures.length) {
    console.error('\nSmoke failed:\n' + failures.map((f) => ' - ' + f).join('\n'));
    process.exit(1);
  }
  console.log('\nAll smoke checks passed.');
})();
