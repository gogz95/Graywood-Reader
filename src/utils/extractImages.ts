/**
 * Fix #15: Use the browser's DOMParser instead of a regex, which breaks on
 * attributes after `src`, single-quoted URLs containing `>`, and `data-src`
 * lazy-loading patterns common on manga sites.
 */
export const extractPanelImages = (htmlContent: string): string[] => {
  try {
    const doc = new DOMParser().parseFromString(htmlContent, 'text/html');
    return Array.from(doc.querySelectorAll('img[src]'), (img) => img.getAttribute('src')!).filter(Boolean);
  } catch {
    // Fallback for non-browser environments (SSR / tests)
    const imgRegex = /<img[^>]*src\s*=\s*["']([^"']*)["'][^>]*>/gi;
    const matches = [];
    let match;
    while ((match = imgRegex.exec(htmlContent)) !== null) {
      matches.push(match[1]);
    }
    return matches;
  }
};