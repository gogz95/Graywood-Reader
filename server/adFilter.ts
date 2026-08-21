// ============================================================================
// AD PROTECTION — known ad-domain filter & DOM ad stripping helpers
// Extracted from server.ts; shared by the scraper/reader pipelines.
// ============================================================================

export const KNOWN_AD_DOMAINS = [
  'googleadservices', 'pagead2', 'googlesyndication', 'doubleclick',
  'ads', 'adn', 'adtech', 'mediavine', 'raptive', 'springboard',
  'content.ad', 'outbrowse', 'taboola', 'revcontent', 'nativo',
  'push', 'popunder', 'click-under', 'interstitial'
];

export function isAdImageSrc(src: string, origin: string): boolean {
  try {
    const url = new URL(src, origin);
    const hostname = url.hostname.toLowerCase();
    for (const d of KNOWN_AD_DOMAINS) { if (hostname.includes(d)) return true; }
    if (/.*[/_](ad|banner|popunder|interstitial|media)(\?|$)/i.test(src)) return true;
    if (hostname.includes('google')) return true;
    return false;
  } catch { return false; }
}

export function stripAdElements($root: any): void {
  const selectors = ['.ad-', '.banner-', '.popunder-', '.overlay-', '[class*=adsbygoogle]', '[id*=ad-]'];
  for (const sel of selectors) { try { $root.find(sel).remove(); } catch {} }
}