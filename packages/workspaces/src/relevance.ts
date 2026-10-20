/**
 * Pick the pages of a long document that matter most for a question, so the AI
 * reads those instead of the first few dozen pages. Plain BM25 over words:
 * fast, runs in the browser, and needs no index or server.
 */

const STOPWORDS = new Set(
  ("the and for are but not you all any can had her was one our out has have him his how its may new now old see two way who did get let put say she too use what when where which while with this that from they them then than there these those their will would could should about into over under after before also just only very more most some such each other been being does doing were your yours what's whats explain tell give show please make page pages chapter text pdf book about").split(" "),
);

/** Lower-case words of 3+ letters or digits, without common filler words. */
export function keywords(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((w) => !STOPWORDS.has(w));
}

/** A crude stem so "cells" finds "cell" and "dividing" finds "divide". */
const stem = (w: string) => (w.length > 5 ? w.replace(/(ings?|ed|es|s)$/, "") : w.replace(/s$/, ""));

/** BM25 score of each page for the query. Higher is more relevant; 0 means no query word appears. */
export function rankPages(query: string, pages: string[]): number[] {
  const terms = [...new Set(keywords(query).map(stem))];
  if (!terms.length) return pages.map(() => 0);
  const docs = pages.map((p) => {
    const counts = new Map<string, number>();
    const words = keywords(p);
    for (const w of words) {
      const s = stem(w);
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    return { counts, len: words.length };
  });
  const avg = docs.reduce((n, d) => n + d.len, 0) / Math.max(1, docs.length) || 1;
  const k1 = 1.2;
  const b = 0.75;
  return docs.map((d) => {
    let score = 0;
    for (const t of terms) {
      const tf = d.counts.get(t) ?? 0;
      if (!tf) continue;
      const df = docs.filter((x) => x.counts.has(t)).length;
      const idf = Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
      score += (idf * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * d.len) / avg));
    }
    return score;
  });
}

/**
 * The pages (indexes into `pages`) to send for a question, best first until
 * `budget` characters are used, then put back in page order. Pages next to a
 * strong match come along when there's room, since answers often run across a
 * page break. Empty when nothing matches.
 */
export function pickRelevant(query: string, pages: string[], budget: number): number[] {
  const scores = rankPages(query, pages);
  const best = Math.max(0, ...scores);
  if (best <= 0) return [];
  const order = scores
    .map((s, i) => ({ i, s }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i);
  const chosen = new Set<number>();
  let used = 0;
  const take = (i: number) => {
    if (chosen.has(i) || i < 0 || i >= pages.length) return;
    const len = pages[i]!.length + 12;
    if (used + len > budget && chosen.size) return;
    chosen.add(i);
    used += len;
  };
  for (const { i } of order) take(i);
  // Neighbours of the strongest pages, while there's room.
  for (const { i, s } of order) if (s >= best / 2) (take(i + 1), take(i - 1));
  return [...chosen].sort((a, b) => a - b);
}
