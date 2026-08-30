// ============================================================================
// AD PROTECTION — known ad-domain filter, cam/spam detection & DOM ad stripping
// Shared by scraper, crawler, explore, metadata and import pipelines.
// ============================================================================

export const KNOWN_AD_DOMAINS = [
  'googleadservices', 'pagead2', 'googlesyndication', 'doubleclick',
  'adtech', 'mediavine', 'raptive', 'springboard', 'content.ad', 'outbrowse',
  'taboola', 'revcontent', 'nativo', 'popunder', 'click-under', 'interstitial',
  'exoclick', 'trafficjunky', 'adsterra', 'juicyads', 'ero-advertising',
  'bongacams', 'chaturbate', 'stripchat', 'camsoda', 'livejasmin', 'plugrush',
  'popcash', 'onclick', 'syndication', 'realsrv', 'propellerads', 'hilltopads',
  'a-ads', 'adx', 'admob', 'adform', 'openx', 'yieldmo', 'rubiconproject',
  'trafficfactory', 'adultmoda', 'zergnet', 'mgid', 'adnxs', 'bidswitch',
  'adblade', 'adxpansion', 'popads', 'ad-maven', 'clickadu', 'richpush'
];

export const AD_TITLE_PATTERNS = [
  /\bcam\s*model\b/i,
  /\bfree\s*live\s*sex\s*show\b/i,
  /\blive\s*sex\s*chat\b/i,
  /\bsex\s*chat\b/i,
  /\blive\s*cam\b/i,
  /\bwebcam\s*girl/i,
  /\bchaturbate\b/i,
  /\bstripchat\b/i,
  /\bcamsoda\b/i,
  /\blivejasmin\b/i,
  /\bbongacams\b/i,
  /\bmeet\s*(?:hot\s*)?singles\b/i,
  /\bhot\s*girls?\s*in\s*your\s*area\b/i,
  /\badult\s*dating\b/i,
  /\bfree\s*sex\s*simulator\b/i,
  /\bplay\s*(?:online\s*)?(?:casino|slot|poker)\b/i,
  /\bslot\s*gacor\b/i,
  /\bjudi\s*online\b/i,
  /\bfree\s*coins\b/i,
  /\bclaim\s*(?:free\s*)?bonus\b/i,
  /\bdownload\s*pc\s*game\b/i,
  /\binstall\s*app\s*now\b/i,
  /\bwatch\s*free\s*porn\b/i,
  /\bclick\s*here\s*to\s*(?:watch|play|chat|join)\b/i,
  /\bjoin\s*free\s*now\b/i,
  /\bonlyfans\s*leak\b/i,
  /\bwin\s*real\s*money\b/i,
  /\b18\+\s*(?:game|dating|cam|chat)\b/i,
];

export const AD_URL_PATTERNS = [
  /[?&](?:utm_campaign|utm_source|aff_id|affiliate_id|click_id|track_id|ad_id)=/i,
  /\/clkg\.php|\/out\.php|\/go\.php|\/redirect\.php|\/track\.php/i,
  /\/adclick|\/ads\/|\/popunder\/|\/adbanner\/|\/floating-ad\//i,
  /(?:trafficjunky|exoclick|adsterra|juicyads|ero-advertising|chaturbate|stripchat|bongacams|livejasmin|realsrv|plugrush|popcash|popads)/i,
];

export function isAdTitle(title: string): boolean {
  if (!title || typeof title !== 'string') return false;
  const clean = title.trim();
  if (!clean) return false;
  for (const pattern of AD_TITLE_PATTERNS) {
    if (pattern.test(clean)) return true;
  }
  return false;
}

export function isAdUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  const clean = url.trim().toLowerCase();
  for (const pattern of AD_URL_PATTERNS) {
    if (pattern.test(clean)) return true;
  }
  for (const domain of KNOWN_AD_DOMAINS) {
    if (clean.includes(domain)) return true;
  }
  return false;
}

export const CHAPTER_ONLY_TITLE_PATTERNS = [
  /^(?:Cap[ií]tulo|Chapter|Ch\.)\s*\d+(?:\s*[-–:]\s*|\s+(?:janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|[a-z]+|\d{1,4})|\s*$)/i,
];

export function isChapterOnlyTitle(title: string): boolean {
  if (!title || typeof title !== 'string') return false;
  const clean = title.trim();
  for (const pattern of CHAPTER_ONLY_TITLE_PATTERNS) {
    if (pattern.test(clean)) return true;
  }
  return false;
}

export function isAdSeries(title: string, url?: string, description?: string): boolean {
  if (isAdTitle(title)) return true;
  if (url && isAdUrl(url)) return true;
  if (description) {
    for (const pattern of AD_TITLE_PATTERNS) {
      if (pattern.test(description)) return true;
    }
  }
  return false;
}

export function isAdImageSrc(src: string, origin: string): boolean {
  if (!src || typeof src !== 'string') return false;
  try {
    const url = new URL(src, origin);
    const hostname = url.hostname.toLowerCase();
    for (const d of KNOWN_AD_DOMAINS) {
      if (hostname.includes(d)) return true;
    }
    if (/.*[/_](ad|banner|popunder|interstitial|sponsor|affiliate|promo)(\?|$|_|\.)/i.test(src)) return true;
    if (hostname.includes('google') && !hostname.includes('googleusercontent')) return true;
    return false;
  } catch {
    return isAdUrl(src);
  }
}

export function stripAdElements($root: any): void {
  const selectors = [
    '.ad-', '.banner-', '.popunder-', '.overlay-', '[class*=adsbygoogle]', '[id*=ad-]',
    '.c-ads', '.ads-holder', '.manga-ads', '.sidebar-ad', '.floating-ad', '.ad_box',
    '.ad-container', '.advertisement', '.sponsor-card', '.adsense', '[class*="sponsored"]',
    'iframe[src*="ad"]', 'iframe[src*="track"]', 'a[href*="exoclick"]', 'a[href*="trafficjunky"]',
    'a[href*="chaturbate"]', 'a[href*="stripchat"]', 'a[href*="bongacams"]', 'a[href*="juicyads"]',
    'div[id^="ad_"]', 'div[class^="ad_"]', 'div[id*="zone-"]', 'div[class*="zone-"]'
  ];
  for (const sel of selectors) {
    try {
      $root.find(sel).remove();
    } catch {}
  }
}