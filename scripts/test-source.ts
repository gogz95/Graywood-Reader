#!/usr/bin/env tsx
// ============================================================================
// scripts/test-source.ts — Isolated Scraper & Parser Diagnostic CLI Harness
// Runs 3-step connectivity, metadata extraction, and page resolution checks.
// Usage: npx tsx scripts/test-source.ts <sourceIdOrUrl> [chapterUrl]
// ============================================================================

import { sourceFetch, extractDomainFromUrl } from '../server/network/sourceHttpClient';
import { getRecentTraces } from '../server/diagnostics/traceBuffer';
import { getSourceById, resolveSourceUrl } from '../server/sources/sourcesCatalog';
import { matchLiveDomain } from '../server/services/crawlerEngine';
import { fetchLiveChapterList } from '../server/services/crawler/chapterParser';
import { kotatsuImageEngine } from '../server/services/crawler/sourceDiscovery';
import { isValidPanelImageUrl } from '../server/services/crawler/imageExtractor';

async function main() {
  const arg1 = process.argv[2];
  const arg2 = process.argv[3];

  if (!arg1) {
    console.log(`
Graywood Reader — Isolated Scraper & Parser Diagnostic CLI
===========================================================
Usage:
  npx tsx scripts/test-source.ts <sourceIdOrUrl> [chapterUrl]

Examples:
  npx tsx scripts/test-source.ts asurascans
  npx tsx scripts/test-source.ts https://asurascans.com/comics/solo-leveling-ragnarok
  npx tsx scripts/test-source.ts flamecomics https://flamecomics.xyz/series/solo-leveling-ragnarok/chapter-1
`);
    process.exit(1);
  }

  let sourceId = 'custom';
  let seriesUrl = '';
  let chapterUrl = arg2 || '';

  if (arg1.startsWith('http://') || arg1.startsWith('https://')) {
    seriesUrl = arg1;
    const matched = matchLiveDomain(seriesUrl);
    sourceId = matched?.id || extractDomainFromUrl(seriesUrl).replace(/\./g, '_');
  } else {
    sourceId = arg1.toLowerCase();
    const srcDef = getSourceById(sourceId);
    if (srcDef?.baseUrl) {
      seriesUrl = srcDef.baseUrl;
    } else {
      seriesUrl = `https://${sourceId}.com`;
    }
  }

  const resolvedSeriesUrl = resolveSourceUrl(sourceId, seriesUrl);
  console.log(`\n===========================================================`);
  console.log(`  Source Diagnostic: ${sourceId}`);
  console.log(`  Target URL:        ${resolvedSeriesUrl}`);
  if (chapterUrl) console.log(`  Target Chapter:    ${chapterUrl}`);
  console.log(`===========================================================\n`);

  // ── Step 1: Reachability & Cloudflare Check ─────────────────────────────────
  console.log(`[Step 1/3] Testing Reachability & Cloudflare Challenge...`);
  const step1Start = Date.now();
  let step1Status = 'ok';
  let cfBlocked = false;
  let responseText = '';
  let statusCode = 0;

  try {
    const res = await sourceFetch(resolvedSeriesUrl, { timeoutMs: 12000 });
    statusCode = res.status;
    const latency = Date.now() - step1Start;
    responseText = await res.text();

    const isCfMitigated =
      res.headers.get('cf-mitigated') === 'challenge' ||
      res.headers.get('server')?.toLowerCase().includes('cloudflare');

    const hasChallengeKeywords =
      responseText.includes('cf-browser-verification') ||
      responseText.includes('challenge-platform') ||
      responseText.includes('turnstile') ||
      responseText.includes('Just a moment...');

    if (statusCode === 403 || statusCode === 503 || hasChallengeKeywords) {
      cfBlocked = true;
      step1Status = 'warn';
    }

    console.log(`  Status Code:       ${statusCode}`);
    console.log(`  Latency:           ${latency}ms`);
    console.log(`  Cloudflare:        ${cfBlocked ? 'BLOCKED / Challenge Required' : 'PASSED / Reachable'}`);
  } catch (err: any) {
    step1Status = 'error';
    console.error(`  [Step 1 Error] Connection failed:`, err?.message || err);
  }

  // ── Step 2: Series & Chapter List Parse ────────────────────────────────────
  console.log(`\n[Step 2/3] Parsing Chapter List from Series...`);
  let chapters: any[] = [];
  try {
    chapters = await fetchLiveChapterList(resolvedSeriesUrl, sourceId);
    console.log(`  Total Chapters:    ${chapters.length}`);

    if (chapters.length > 0) {
      const first = chapters[chapters.length - 1]; // usually oldest
      const latest = chapters[0]; // usually newest
      console.log(`  Latest Chapter:    Ch. ${latest.number} — "${latest.title || 'Untitled'}"`);
      console.log(`                     URL: ${latest.url}`);
      console.log(`  First Chapter:     Ch. ${first.number} — "${first.title || 'Untitled'}"`);
      console.log(`                     URL: ${first.url}`);
    } else {
      console.log(`  Notice:            No chapters parsed directly from series URL (might require direct chapter URL).`);
    }
  } catch (err: any) {
    console.error(`  [Step 2 Error] Chapter list parse failed:`, err?.message || err);
  }

  // ── Step 3: Page List Extraction ──────────────────────────────────────────
  console.log(`\n[Step 3/3] Extracting Chapter Panel Images...`);
  let testChapterUrl = chapterUrl;
  let testChapterNum = 1;

  if (!testChapterUrl && chapters.length > 0) {
    testChapterUrl = chapters[0].url;
    testChapterNum = chapters[0].number || 1;
  } else if (!testChapterUrl) {
    testChapterUrl = resolvedSeriesUrl;
  }

  console.log(`  Testing Chapter:   ${testChapterUrl}`);
  let pages: string[] | null = null;
  try {
    pages = await kotatsuImageEngine.getChapterPages(testChapterUrl, sourceId, testChapterNum);
  } catch (err: any) {
    console.error(`  [Step 3 Error] Page extraction failed:`, err?.message || err);
  }

  if (pages && pages.length > 0) {
    const validCount = pages.filter((p) => isValidPanelImageUrl(p)).length;
    console.log(`  Extracted Panels:  ${pages.length} (${validCount} verified image formats)`);
    console.log(`  Sample URLs:`);
    pages.slice(0, 3).forEach((p, i) => console.log(`    [${i + 1}] ${p}`));
  } else {
    console.log(`  Result:            0 pages extracted (source may use JS rendering or active bot mitigation).`);
  }

  // ── Diagnostic Traces ─────────────────────────────────────────────────────
  console.log(`\n--- Diagnostic Trace Buffer (Recent Events) ---`);
  const recentTraces = getRecentTraces({ limit: 10 });
  if (recentTraces.length === 0) {
    console.log(`  (No diagnostic events recorded)`);
  } else {
    console.table(
      recentTraces.map((t) => ({
        stage: t.stage,
        status: t.status,
        domain: t.domain,
        latencyMs: `${t.durationMs}ms`,
        message: t.message?.substring(0, 60) || '',
      }))
    );
  }

  console.log(`\nDiagnostic Finished.`);
}

main().catch((err) => {
  console.error('[CLI Fatal Error]', err);
  process.exit(1);
});
