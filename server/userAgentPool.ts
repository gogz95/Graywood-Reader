// ============================================================================
// SMART USER-AGENT & HEADER ROTATION POOL
// Generates realistic browser fingerprints (Chrome, Firefox, Safari, Edge)
// across Windows, macOS, Linux, Android, and iOS with matching Client Hints.
// ============================================================================

export interface BrowserProfile {
  id: string;
  name: string;
  platform: 'windows' | 'macos' | 'linux' | 'android' | 'ios';
  isMobile: boolean;
  userAgent: string;
  secChUa?: string;
  secChUaMobile: string;
  secChUaPlatform: string;
  acceptLanguage: string;
  acceptHtml: string;
  acceptImage: string;
}

export const BROWSER_PROFILES: BrowserProfile[] = [
  // 1. Chrome 128 on Windows 11 (Desktop)
  {
    id: 'chrome_win11',
    name: 'Chrome 128 on Windows 11',
    platform: 'windows',
    isMobile: false,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    secChUa: '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
    secChUaMobile: '?0',
    secChUaPlatform: '"Windows"',
    acceptLanguage: 'en-US,en;q=0.9',
    acceptHtml: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    acceptImage: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
  },
  // 2. Chrome 128 on macOS (Apple Silicon / Intel)
  {
    id: 'chrome_mac',
    name: 'Chrome 128 on macOS',
    platform: 'macos',
    isMobile: false,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    secChUa: '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
    secChUaMobile: '?0',
    secChUaPlatform: '"macOS"',
    acceptLanguage: 'en-US,en;q=0.9',
    acceptHtml: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    acceptImage: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
  },
  // 3. Firefox 130 on Windows 10/11
  {
    id: 'firefox_win',
    name: 'Firefox 130 on Windows',
    platform: 'windows',
    isMobile: false,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0',
    secChUaMobile: '?0',
    secChUaPlatform: '"Windows"',
    acceptLanguage: 'en-US,en;q=0.5',
    acceptHtml: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/png,image/svg+xml,*/*;q=0.8',
    acceptImage: 'image/avif,image/webp,image/png,image/svg+xml,image/*,*/*;q=0.8',
  },
  // 4. Firefox 130 on macOS
  {
    id: 'firefox_mac',
    name: 'Firefox 130 on macOS',
    platform: 'macos',
    isMobile: false,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:130.0) Gecko/20100101 Firefox/130.0',
    secChUaMobile: '?0',
    secChUaPlatform: '"macOS"',
    acceptLanguage: 'en-US,en;q=0.5',
    acceptHtml: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/png,image/svg+xml,*/*;q=0.8',
    acceptImage: 'image/avif,image/webp,image/png,image/svg+xml,image/*,*/*;q=0.8',
  },
  // 5. Safari 17.5 on macOS Sonoma
  {
    id: 'safari_mac',
    name: 'Safari 17.5 on macOS',
    platform: 'macos',
    isMobile: false,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
    secChUaMobile: '?0',
    secChUaPlatform: '"macOS"',
    acceptLanguage: 'en-US,en;q=0.9',
    acceptHtml: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    acceptImage: 'image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5',
  },
  // 6. Microsoft Edge 128 on Windows 11
  {
    id: 'edge_win',
    name: 'Edge 128 on Windows 11',
    platform: 'windows',
    isMobile: false,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0',
    secChUa: '"Chromium";v="128", "Not;A=Brand";v="24", "Microsoft Edge";v="128"',
    secChUaMobile: '?0',
    secChUaPlatform: '"Windows"',
    acceptLanguage: 'en-US,en;q=0.9',
    acceptHtml: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    acceptImage: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
  },
  // 7. Chrome on Android (Pixel 8 / Galaxy S24)
  {
    id: 'chrome_android',
    name: 'Chrome on Android 14',
    platform: 'android',
    isMobile: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.6613.88 Mobile Safari/537.36',
    secChUa: '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
    secChUaMobile: '?1',
    secChUaPlatform: '"Android"',
    acceptLanguage: 'en-US,en;q=0.9',
    acceptHtml: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    acceptImage: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
  },
  // 8. Mobile Safari on iOS 17 (iPhone 15)
  {
    id: 'safari_ios',
    name: 'Mobile Safari on iOS 17',
    platform: 'ios',
    isMobile: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    secChUaMobile: '?1',
    secChUaPlatform: '"iOS"',
    acceptLanguage: 'en-US,en;q=0.9',
    acceptHtml: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    acceptImage: 'image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5',
  },
];

/**
 * Get a random browser profile from the pool.
 */
export function getRandomBrowserProfile(preferredType?: 'desktop' | 'mobile'): BrowserProfile {
  const filtered = preferredType
    ? BROWSER_PROFILES.filter((p) => (preferredType === 'mobile' ? p.isMobile : !p.isMobile))
    : BROWSER_PROFILES;
  const pool = filtered.length > 0 ? filtered : BROWSER_PROFILES;
  const idx = Math.floor(Math.random() * pool.length);
  return pool[idx];
}

/**
 * Get a deterministic browser profile for a given seed (e.g. source domain/ID).
 * Keeps the browser profile consistent for the same source to avoid fingerprint flipping.
 */
export function getDeterministicBrowserProfile(seed: string): BrowserProfile {
  if (!seed) return BROWSER_PROFILES[0];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  const idx = Math.abs(hash) % BROWSER_PROFILES.length;
  return BROWSER_PROFILES[idx];
}

export interface BrowserHeaderOptions {
  sourceId?: string;
  isImage?: boolean;
  referer?: string;
  customHeaders?: Record<string, string>;
  preferMobile?: boolean;
  rotate?: boolean;
}

/**
 * Generate a complete, realistic browser header dictionary for HTTP requests.
 */
export function getBrowserHeaders(
  targetUrl: string,
  options: BrowserHeaderOptions = {}
): Record<string, string> {
  let origin = '';
  try {
    origin = new URL(targetUrl).origin;
  } catch {
    origin = targetUrl;
  }

  const profile = options.rotate
    ? getRandomBrowserProfile(options.preferMobile ? 'mobile' : undefined)
    : getDeterministicBrowserProfile(options.sourceId || origin);

  const isImage = !!options.isImage;
  const referer = options.referer || (origin.startsWith('http') ? `${origin}/` : '');

  const headers: Record<string, string> = {
    'User-Agent': profile.userAgent,
    'Accept': isImage ? profile.acceptImage : profile.acceptHtml,
    'Accept-Language': profile.acceptLanguage,
    'Accept-Encoding': 'gzip, deflate, br, zstd',
    'Sec-Fetch-Dest': isImage ? 'image' : 'document',
    'Sec-Fetch-Mode': isImage ? 'no-cors' : 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-User': isImage ? '' : '?1',
    'Upgrade-Insecure-Requests': isImage ? '' : '1',
  };

  if (profile.secChUa) {
    headers['Sec-Ch-Ua'] = profile.secChUa;
  }
  if (profile.secChUaMobile) {
    headers['Sec-Ch-Ua-Mobile'] = profile.secChUaMobile;
  }
  if (profile.secChUaPlatform) {
    headers['Sec-Ch-Ua-Platform'] = profile.secChUaPlatform;
  }
  if (referer) {
    headers['Referer'] = referer;
  }

  // Remove empty header strings
  for (const k of Object.keys(headers)) {
    if (!headers[k]) delete headers[k];
  }

  // Merge custom overrides
  if (options.customHeaders) {
    Object.assign(headers, options.customHeaders);
  }

  return headers;
}
