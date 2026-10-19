import type { Flashcard, VaultPath } from "@writalin/shared";
import { codeRanges, inRanges } from "./code";

/** `Question :: Answer` on one line (Obsidian Spaced Repetition plugin syntax). */
const CARD_RE = /^(?![ \t]*[-*+][ \t]+\[)[ \t]*(?:[-*+][ \t]+)?(.+?)[ \t]+::[ \t]+(.+?)[ \t]*$/;

export function parseFlashcards(body: string, path: VaultPath, lineOffset = 0): Flashcard[] {
  const code = codeRanges(body);
  const out: Flashcard[] = [];
  let pos = 0;
  body.split("\n").forEach((line, i) => {
    if (!inRanges(code, pos)) {
      const m = CARD_RE.exec(line);
      if (m) out.push({ path, line: i + lineOffset, question: m[1]!.trim(), answer: m[2]!.trim() });
    }
    pos += line.length + 1;
  });
  return out;
}

/**
 * Cards from an AI answer, which may number them, bold them or wrap them in
 * bullets. Keeps `Question :: Answer` lines and also accepts `Q: … A: …` pairs.
 */
export function cardsFromText(text: string): { question: string; answer: string }[] {
  const clean = (s: string) => s.replace(/\*\*|__/g, "").replace(/\s+/g, " ").trim();
  const out: { question: string; answer: string }[] = [];
  let pendingQ: string | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+|>\s*)*/, "").trim();
    if (!line || /^```/.test(line)) continue;
    const sep = line.indexOf("::");
    if (sep > 0) {
      const question = clean(line.slice(0, sep));
      const answer = clean(line.slice(sep + 2));
      if (question && answer) out.push({ question, answer });
      pendingQ = null;
      continue;
    }
    const q = /^(?:\*\*)?(?:Q|Question)(?:\*\*)?\s*[:.]\s*(.+)$/i.exec(line);
    const a = /^(?:\*\*)?(?:A|Answer)(?:\*\*)?\s*[:.]\s*(.+)$/i.exec(line);
    if (q) pendingQ = clean(q[1]!);
    else if (a && pendingQ) {
      out.push({ question: pendingQ, answer: clean(a[1]!) });
      pendingQ = null;
    }
  }
  return out;
}

/** Cards as lines the note (and Obsidian's Spaced Repetition plugin) understands. */
export function formatCards(cards: { question: string; answer: string }[], opts: { divider?: boolean } = {}): string {
  // `::` inside a side would split the card in the wrong place.
  const side = (s: string) => s.replace(/::/g, ":").trim();
  // Blank lines around `---` keep it a divider rather than turning the card above into a heading.
  return cards.map((c) => `${side(c.question)} :: ${side(c.answer)}`).join(opts.divider ? "\n\n---\n\n" : "\n");
}
