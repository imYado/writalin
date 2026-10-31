import { noteName } from "@writalin/shared";
import type { Vault } from "@writalin/vault";

/** A numbered passage from the student's notes that an answer can cite as `[n]`. */
export interface CitedSource {
  n: number;
  path: string;
  /** The nearest heading above the passage. */
  heading?: string;
  /** 0-based line in the note where the passage starts. */
  line: number;
  text: string;
}

const MAX_SOURCES = 16;
const MAX_CHARS = 24_000;

/**
 * The passages that answer a question, numbered for citing. A follow-up keeps
 * the earlier passages and their numbers, so citations in earlier answers
 * still point to the right place; new passages get the next numbers.
 */
export function buildVaultSources(vault: Vault, question: string, prior: CitedSource[] = []): { text: string; sources: CitedSource[] } {
  const sources = [...prior];
  let next = Math.max(0, ...prior.map((s) => s.n)) + 1;
  for (const p of vault.search.passages(question)) {
    if (sources.length >= MAX_SOURCES) break;
    if (sources.some((s) => s.path === p.path && s.line === p.line)) continue;
    sources.push({ n: next++, path: p.path, heading: p.heading, line: p.line, text: p.text });
  }
  // The newest passages matter most to this question, so older ones are dropped first if it's too long.
  let chars = 0;
  const kept = [...sources].reverse().filter((s) => (chars += s.text.length + 80) <= MAX_CHARS).reverse();
  return { text: kept.map((s) => `[${s.n}] ${sourceTitle(s)}\n${s.text}`).join("\n\n"), sources: kept };
}

export const sourceTitle = (s: CitedSource): string => `“${noteName(s.path)}”${s.heading ? ` › ${s.heading}` : ""}`;

/** The source numbers an answer cites, in order of first use. */
export function citedNumbers(answer: string): number[] {
  return [...new Set([...answer.matchAll(/\[(\d{1,2})\]/g)].map((m) => Number(m[1])))];
}

/** A Sources list for an answer put into a note, linking each cited passage's note (and heading). */
export function sourcesFooter(answer: string, sources: CitedSource[]): string {
  const used = citedNumbers(answer).map((n) => sources.find((s) => s.n === n)).filter((s): s is CitedSource => !!s);
  if (!used.length) return "";
  return `Sources: ${used.map((s) => `[${s.n}] [[${noteName(s.path)}${s.heading ? `#${s.heading}` : ""}]]`).join(" · ")}`;
}
