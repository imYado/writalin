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

/** A part of a note that matches a question, for the AI to read. */
export interface Passage {
  path: VaultPath;
  /** The note's name. */
  name: string;
  /** The nearest heading above the passage, if any. */
  heading?: string;
  /** 0-based line in the note file where the passage starts. */
  line: number;
  text: string;
  score: number;
}

/** Words too common to say what a question is about. */
const STOP = new Set(
  ("a an and are as at be been but by can could did do does for from had has have how i if in into is it its me my no not of on or our so that the their them then there these they this to was we were what when where which who why will with would you your " +
    "about any also explain tell give show notes note say says said mean means make made"
  ).split(" "),
);
/** Passages are paragraphs, joined under their heading up to about this many characters. */
const PASSAGE_CHARS = 900;

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(WORD_RE) ?? []).filter((w) => w.length > 1);
}

/**
 * Small inverted index over note names and text. Prefix matching on every
 * query word; all words must match. Pure, so it can run in a Web Worker.
 */
export class SearchIndex {
  private postings = new Map<string, Map<VaultPath, number>>();
  private docs = new Map<VaultPath, { text: string; terms: Set<string>; name: string; lineOffset: number }>();

  /** `lineOffset` is the line in the file where `text` starts (after frontmatter). */
  set(path: VaultPath, name: string, text: string, lineOffset = 0): void {
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
    this.docs.set(path, { text, terms: new Set(counts.keys()), name, lineOffset });
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

  /**
   * The passages that best answer a question, across all notes. Unlike
   * search(), not every word has to match: common words are dropped, rarer
   * words count more, and passages matching more of the question rank higher.
   * Word starts match too, so "cell" finds "cells".
   */
  passages(question: string, opts: { limit?: number; perNote?: number; maxChars?: number } = {}): Passage[] {
    const { limit = 8, perNote = 3, maxChars = 12_000 } = opts;
    const words = [...new Set(tokenize(question).filter((w) => !STOP.has(w)))];
    if (!words.length) return [];
    // How rare each word is across notes, and which notes have it at all.
    const idf = new Map<string, number>();
    const candidates = new Set<VaultPath>();
    for (const w of words) {
      const docs = new Set<VaultPath>();
      for (const [term, p] of this.postings) if (term.startsWith(w)) for (const path of p.keys()) docs.add(path);
      if (!docs.size) continue;
      idf.set(w, Math.log(1 + this.docs.size / docs.size));
      for (const d of docs) candidates.add(d);
    }
    if (!idf.size) return [];
    const scored: Passage[] = [];
    for (const path of candidates) {
      const doc = this.docs.get(path)!;
      const nameTerms = tokenize(doc.name);
      const nameHits = words.filter((w) => nameTerms.some((t) => t.startsWith(w)));
      for (const chunk of chunks(doc.text)) {
        const terms = tokenize(chunk.heading ? `${chunk.heading} ${chunk.text}` : chunk.text);
        let score = 0;
        let matched = 0;
        for (const w of words) {
          const weight = idf.get(w);
          if (!weight) continue;
          const n = terms.reduce((c, t) => c + (t === w ? 1 : t.startsWith(w) ? 0.6 : 0), 0);
          if (n) matched++;
          score += weight * Math.log(1 + n);
        }
        // The note's name is a small hint; the passage itself has to say it.
        if (!matched) continue;
        score += nameHits.reduce((s, w) => s + (idf.get(w) ?? 0) * 0.25, 0);
        score *= matched / words.length;
        scored.push({ path, name: doc.name, heading: chunk.heading, line: chunk.line + doc.lineOffset, text: chunk.text, score });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    const out: Passage[] = [];
    const perPath = new Map<VaultPath, number>();
    let chars = 0;
    for (const p of scored) {
      if (out.length >= limit) break;
      const n = perPath.get(p.path) ?? 0;
      if (n >= perNote || chars + p.text.length > maxChars) continue;
      perPath.set(p.path, n + 1);
      chars += p.text.length;
      out.push(p);
    }
    return out;
  }
}

/** A note body cut into passages: paragraphs, joined while they share a heading and stay short. */
function chunks(body: string): { text: string; line: number; heading?: string }[] {
  const out: { text: string; line: number; heading?: string }[] = [];
  const lines = body.split("\n");
  let heading: string | undefined;
  let buf: string[] = [];
  let start = 0;
  const flush = () => {
    const text = buf.join("\n").trim();
    if (text) out.push({ text, line: start, heading });
    buf = [];
  };
  lines.forEach((raw, i) => {
    const line = raw.replace(/\s*<!--SR:[^>]*-->\s*$/, "");
    const h = /^#{1,6}\s+(.+?)\s*#*$/.exec(line);
    if (h) {
      flush();
      heading = h[1];
      start = i + 1;
      return;
    }
    if (!line.trim() && !buf.length) return;
    if (!line.trim() && buf.join("\n").length >= PASSAGE_CHARS / 2) {
      flush();
      start = i + 1;
      return;
    }
    if (!buf.length) start = i;
    buf.push(line);
    // A very long paragraph is split on a line break.
    if (buf.join("\n").length >= PASSAGE_CHARS) {
      flush();
      start = i + 1;
    }
  });
  flush();
  return out;
}
