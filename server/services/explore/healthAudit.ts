// ============================================================================
// Source Health Audit & Empty Source Auto-Disable Engine
// ============================================================================

import { SourceDefinition, KOTATSU_SOURCES, disabledSourceIds } from '../../sources/sourcesCatalog';
import { appSettings, saveDatabaseToDisk } from '../../appState';
import { fetchWithChallengeBypass } from '../../captchaSolver';
import { sourceCookieJar, sourceHealthMap, updateSourceHealth } from '../sourceHealthService';
import { parseUniversalCatalogCards, SCRAPER_UA } from './catalogParser';

export let sourceAuditRunning = false;
export let sourceAuditStatus = new Map<string, { total: number; completed: number; status: string }>();

export async function probeSourceSeriesCount(src: SourceDefinition): Promise<{ count: number; error: string | null }> {
  try {
    const origin = new URL(src.baseUrl).origin;
    const catalogPath = (src as any).catalogPath || '/';
    const catalogUrl = `${origin}${catalogPath.startsWith('/') ? '' : '/'}${catalogPath}`;

    const res = await fetchWithChallengeBypass(catalogUrl, {
      headers: { 'User-Agent': SCRAPER_UA, Accept: 'text/html', Referer: origin + '/' },
      enableCloudflareBypass: appSettings.enableCloudflareBypass,
      flareSolverrUrl: appSettings.flareSolverrUrl,
      captchaSolverEnabled: appSettings.captchaSolverEnabled,
      captchaApiKey: appSettings.captchaApiKey,
      timeoutMs: 12000,
      sourceId: src.id,
      onCookieUpdate: (sid, cookies) => sourceCookieJar.setCookies(sid, cookies),
    });

    if (!res.ok || !res.html) {
      updateSourceHealth(src.id, null, res.status || 500, `HTTP ${res.status}`);
      return { count: 0, error: `HTTP ${res.status}` };
    }

    updateSourceHealth(src.id, res.html, res.status || 200);
    const items = parseUniversalCatalogCards(res.html, src, origin, 50);
    return { count: items.length, error: null };
  } catch (err: any) {
    updateSourceHealth(src.id, null, 0, err?.message || 'Network error');
    return { count: 0, error: err?.message || 'Network error' };
  }
}

export async function auditAndDisableEmptySources(concurrency: number = 4): Promise<{
  disabledCount: number;
  disabledSourceIdsList: string[];
}> {
  console.log('[Source Health Audit] Starting background audit of all enabled catalog sources...');
  const disabledList: string[] = [];

  for (const src of KOTATSU_SOURCES) {
    if (disabledSourceIds.has(src.id)) continue;

    const { count, error } = await probeSourceSeriesCount(src);
    if (count === 0) {
      disabledSourceIds.add(src.id);
      disabledList.push(src.id);
      console.warn(`[Source Health Audit] Source "${src.name}" (${src.id}) returned 0 series (${error || 'empty DOM'}); auto-disabled.`);
    } else {
      console.log(`[Source Health Audit] Source "${src.name}" (${src.id}) is HEALTHY (${count} series found).`);
    }

    await new Promise((r) => setTimeout(r, 400));
  }

  if (disabledList.length > 0) {
    (appSettings as any).disabledSourceIds = Array.from(disabledSourceIds);
    saveDatabaseToDisk();
  }

  console.log(`[Source Health Audit] Audit complete. Disabled ${disabledList.length} empty/failing sources.`);
  return { disabledCount: disabledList.length, disabledSourceIdsList: disabledList };
}
