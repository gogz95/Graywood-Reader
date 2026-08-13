export const extractPanelImages = (htmlContent: string): string[] => {
  const imgRegex = /<img[^>]*src\s*=\s*["']([^"']*)["'][^>]*>/gi;
  const matches = [];
  let match;

  while ((match = imgRegex.exec(htmlContent)) !== null) {
    matches.push(match[1]);
  }

  return matches;
};