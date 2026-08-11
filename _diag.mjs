// Diagnostic: check raw HTML responses for failing sources
const BASE = 'http://localhost:3000';

async function getJSON(path, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(BASE + path, { signal: ctrl.signal });
    return { ok: res.ok, status: res.status, json: await res.json() };
  } catch (e) {
    return { ok: false, status: 0, json: { error: e.message } };
  } finally {
    clearTimeout(t);
  }
}

async function fetchText(url, extraHeaders = {}) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      ...extraHeaders,
    },
  });
  return { status: res.status, ok: res.ok, text: await res.text() };
}

function extractLinks(html, origin) {
  const rx = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const out = [];
  let m;
  while ((m = rx.exec(html)) !== null) {
    const href = m[1];
    const text = m[2].replace(/<[^>]+>/g, '').trim();
    if (!href || /^(#|javascript:|mailto:|tel:)/i.test(href)) continue;
    out.push({ href, text });
  }
  return out;
}

function extractImages(html, origin) {
  const imgRx = /<img[^>]+(?:data-src|data-lazy-src|src)=["']([^"']+)["'][^>]*>/gi;
  const out = [];
  let m;
  while ((m = imgRx.exec(html)) !== null) {
    out.push(m[1]);
  }
  return out;
}

async function main() {
  // 1. Flame
  console.log('=== FLAME ===');
  const home = await fetchText('https://flamecomics.xyz/');
  console.log('home status:', home.status, 'len:', home.text.length);
  const buildMatch = home.text.match(/\/_next\/static\/([^/]+)\/_buildManifest\.js/);
  console.log('buildId:', buildMatch ? buildMatch[1] : 'none');

  if (buildMatch) {
    const browse = await fetchText(`https://flamecomics.xyz/_next/data/${buildMatch[1]}/browse.json`);
    console.log('browse status:', browse.status);
    if (browse.ok) {
      const bj = JSON.parse(browse.text);
      const series = bj.pageProps?.series || [];
      console.log('series count:', series.length);
      const found = series.find((s) => String(s.series_id || s.id) === 'superhuman-era' || String(s.title || '').toLowerCase().includes('superhuman'));
      console.log('matched series:', found ? { id: found.series_id || found.id, title: found.title } : 'not found');
      // print a few series titles
      console.log('sample series:', series.slice(0, 5).map((s) => s.title || s.series_id || s.id).join(' | '));
    }
  }

  // 2. manhwa18
  console.log('\n=== MANHWA18 ===');
  const mPage = await fetchText('https://manhwa18.com/manga/announcer-raw');
  console.log('status:', mPage.status, 'len:', mPage.text.length);
  const mLinks = extractLinks(mPage.text, 'https://manhwa18.com');
  const chLinks = mLinks.filter((l) => /chapter|chap|ch/i.test(l.href) || /chapter|chap|ch/i.test(l.text));
  console.log('chapter-like links:', chLinks.length);
  chLinks.slice(0, 10).forEach((l) => console.log(' ', l.href, '|', l.text.slice(0, 60)));

  // Try fetching the FIRST real chapter page
  const realCh = chLinks.find((l) => /manga\/announcer-raw\/chap-/i.test(l.href));
  if (realCh) {
    const sample = realCh.href.startsWith('http') ? realCh.href : new URL(realCh.href, 'https://manhwa18.com').href;
    console.log('fetching chapter page:', sample);
    const chPage = await fetchText(sample);
    console.log('chapter page status:', chPage.status, 'len:', chPage.text.length);
    const images = extractImages(chPage.text, 'https://manhwa18.com');
    console.log('images found:', images.length);
    images.slice(0, 10).forEach((src) => console.log(' ', src));
    // Also look for data-src, lazy attributes
    const lazyImages = [];
    const lazyRx = /<img[^>]+(?:data-src|data-lazy-src|data-cfsrc|data-original|data-srcset|srcset)=["']([^"']+)["'][^>]*>/gi;
    let lm;
    while ((lm = lazyRx.exec(chPage.text)) !== null) {
      lazyImages.push(lm[1]);
    }
    console.log('lazy/attr images:', lazyImages.length);
    lazyImages.slice(0, 10).forEach((src) => console.log(' ', src));
  }

  // 3. aquareader
  console.log('\n=== AQUAREADER ===');
  const aPage = await fetchText('https://aquareader.org/read/apotheosis/');
  console.log('status:', aPage.status, 'len:', aPage.text.length);
  if (aPage.ok) {
    const aLinks = extractLinks(aPage.text, 'https://aquareader.org');
    const aChLinks = aLinks.filter((l) => /chapter|chap|ch/i.test(l.href) || /chapter|chap|ch/i.test(l.text));
    console.log('chapter-like links:', aChLinks.length);
    aChLinks.slice(0, 10).forEach((l) => console.log(' ', l.href, '|', l.text.slice(0, 60)));
  }

  // 4. Also test Asura API directly for leveling-up-with-gods
  console.log('\n=== ASURA Leveling Up With Gods ===');
  const slugs = ['leveling-up-with-gods-0e40e9db', 'leveling-up-with-gods', 'leveling-up-with-gods-00dcbf97', 'leveling-up-with-gods-b8509c2a'];
  for (const s of slugs) {
    const r = await fetch(`https://api.asurascans.com/api/series/${s}/chapters`, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json',
        'Origin': 'https://asuracomic.net',
        'Referer': 'https://asuracomic.net/',
      },
    });
    const t = await r.text();
    console.log(`slug=${s} status=${r.status} body=${t.slice(0, 200)}`);
  }
}

main().catch((e) => console.error(e));
