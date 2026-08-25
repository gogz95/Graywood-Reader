// ============================================================================
// String Similarity Engine (Levenshtein + Token Optimization)
// ============================================================================

export function calculateStringSimilarity(str1: string, str2: string): number {
  if (!str1 || !str2) return 0;
  if (str1 === str2) return 100;

  const normalize = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, '')
      .trim();
  const s1 = normalize(str1);
  const s2 = normalize(str2);

  if (s1 === s2) return 100;
  if (!s1 || !s2) return 0;

  if (s1.includes(s2) || s2.includes(s1)) {
    return 85;
  }

  const words1 = s1.split(/\s+/);
  const words2 = s2.split(/\s+/);
  const t1 = new Set(words1);
  const t2 = new Set(words2);

  let shared = 0;
  t1.forEach((t) => {
    if (t2.has(t)) shared++;
  });
  const tokenSim = (2 * shared) / (t1.size + t2.size);

  if (tokenSim === 1) return 100;

  const len1 = s1.length;
  const len2 = s2.length;
  const matrix: number[][] = Array.from({ length: len1 + 1 }, () => Array(len2 + 1).fill(0));

  for (let i = 0; i <= len1; i++) matrix[i][0] = i;
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  const distance = matrix[len1][len2];
  const maxLen = Math.max(len1, len2);
  const charSim = (1 - distance / maxLen) * 100;

  return Math.round(tokenSim * 50 + charSim * 0.5);
}
