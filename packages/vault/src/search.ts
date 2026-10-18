import type { VaultPath } from "@writalin/shared";

export interface SearchHit {
  path: VaultPath;
  score: number;
  /** Short excerpt around the first match. */
  snippet: string;
  /** Offset of the first match in the note text. */
  offset: number;
}

const WORD_RE = /[\p{L}\p{N}]+/gu;

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(WORD_RE) ?? []).filter((w) => w.length > 1);
}

/**
 * Small inverted index over note names and text. Prefix matching on every
 * query word; all words must match. Pure, so it can run in a Web Worker.
 */
export class SearchIndex {
  private postings = new Map<string, Map<VaultPath, number>>();
  private docs = new Map<VaultPath, { text: string; terms: Set<string>; name: string }>();

  set(path: VaultPath, name: string, text: string): void {
    this.remove(path);
    const counts = new Map<string, number>();
    for (const t of tokenize(text)) counts.set(t, (counts.get(t) ?? 0) + 1);
    // Name words count heavily so "physics" finds "Physics notes.md" first.
    for (const t of tokenize(name)) counts.set(t, (counts.get(t) ?? 0) + 10);
    for (const [t, c] of counts) {
      let p = this.postings.get(t);
      if (!p) this.postings.set(t, (p = new Map()));
      p.set(path, c);
    }
    this.docs.set(path, { text, terms: new Set(counts.keys()), name });
  }

  remove(path: VaultPath): void {
    const d = this.docs.get(path);
    if (!d) return;
    for (const t of d.terms) {
      const p = this.postings.get(t);
      p?.delete(path);
      if (p && !p.size) this.postings.delete(t);
    }
    this.docs.delete(path);
  }

  search(query: string, limit = 30): SearchHit[] {
    const words = tokenize(query);
    if (!words.length) return [];
    let scores: Map<VaultPath, number> | null = null;
    for (const w of words) {
      const wordScores = new Map<VaultPath, number>();
      for (const [term, p] of this.postings) {
        if (!term.startsWith(w)) continue;
        const exact = term === w ? 2 : 1;
        for (const [path, c] of p) wordScores.set(path, (wordScores.get(path) ?? 0) + c * exact);
      }
      if (!scores) scores = wordScores;
      else {
        const next = new Map<VaultPath, number>();
        for (const [path, s] of scores) {
          const ws = wordScores.get(path);
          if (ws) next.set(path, s + ws);
        }
        scores = next;
      }
      if (!scores.size) return [];
    }
    return [...scores!]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([path, score]) => {
        const text = this.docs.get(path)!.text;
        const lower = text.toLowerCase();
        const offset = Math.max(0, lower.indexOf(words[0]!));
        const start = Math.max(0, offset - 40);
        const snippet = (start > 0 ? "…" : "") + text.slice(start, offset + 80).replace(/\s+/g, " ").trim();
        return { path, score, snippet, offset };
      });
  }
}
