export interface FuzzyMatch<T> {
  item: T;
  score: number;
  /** Indices in the candidate string that matched. */
  indices: number[];
}

/**
 * Small subsequence fuzzy matcher, tuned for command palettes:
 * consecutive matches and matches at word starts score higher.
 * Returns null when the query is not a subsequence of the candidate.
 */
export function fuzzyScore(query: string, candidate: string): { score: number; indices: number[] } | null {
  const q = query.toLowerCase().trim();
  if (!q) return { score: 0, indices: [] };
  const c = candidate.toLowerCase();
  const indices: number[] = [];
  let score = 0;
  let qi = 0;
  let prev = -2;
  for (let ci = 0; ci < c.length && qi < q.length; ci++) {
    if (c[ci] !== q[qi]) continue;
    let s = 1;
    if (ci === prev + 1) s += 4;
    const before = ci === 0 ? " " : c[ci - 1]!;
    if (/[\s\-_/.#[(]/.test(before)) s += 3;
    if (ci === 0) s += 2;
    score += s;
    indices.push(ci);
    prev = ci;
    qi++;
  }
  if (qi < q.length) return null;
  // Prefer shorter candidates for equal matches.
  score -= c.length * 0.01;
  return { score, indices };
}

export function fuzzyFilter<T>(query: string, items: readonly T[], key: (item: T) => string, limit = 50): FuzzyMatch<T>[] {
  const out: FuzzyMatch<T>[] = [];
  for (const item of items) {
    const m = fuzzyScore(query, key(item));
    if (m) out.push({ item, ...m });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}
