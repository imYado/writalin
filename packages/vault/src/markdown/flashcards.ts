import type { Flashcard, VaultPath } from "@writalin/shared";
import { codeRanges, inRanges } from "./code";

/**
 * Cards in the Obsidian Spaced Repetition plugin's syntax:
 * - `Question :: Answer` on one line (spaces optional), `:::` for a card that goes both ways;
 * - several lines of question, a line with just `?` (or `??` both ways), then the answer,
 *   ending at a blank line.
 * The plugin's review notes (`<!--SR:…-->`) are left out of the answer.
 */
const CARD_RE = /^(?![ \t]*[-*+][ \t]+\[)[ \t]*(?:[-*+][ \t]+)?(.+?)[ \t]*(:::?)[ \t]*(.+?)[ \t]*$/;
const SR_NOTE_RE = /\s*<!--SR:[^>]*-->\s*$/;
const MULTI_SEP_RE = /^[ \t]*(\?\??)[ \t]*$/;

/** A one-line card's parts, or null. Shared with the editor so both read cards the same way. */
export function matchCardLine(line: string): { question: string; answer: string; reversed: boolean } | null {
  const m = CARD_RE.exec(line.replace(SR_NOTE_RE, ""));
  if (!m) return null;
  const question = m[1]!.trim();
  const answer = m[3]!.trim();
  // `[key:: value]` is a Dataview field, and `std::vector` style code isn't a card.
  if (!question || !answer || /\[[^\]]*$/.test(question) || /\w$/.test(question) && /^\w/.test(answer) && !/\s/.test(question)) return null;
  return { question, answer, reversed: m[2] === ":::" };
}

export function parseFlashcards(body: string, path: VaultPath, lineOffset = 0): Flashcard[] {
  const code = codeRanges(body);
  const out: Flashcard[] = [];
  const lines = body.split("\n");
  const starts: number[] = [];
  for (let i = 0, pos = 0; i < lines.length; pos += lines[i]!.length + 1, i++) starts.push(pos);
  const blank = (i: number) => i < 0 || i >= lines.length || !lines[i]!.trim();
  const push = (line: number, question: string, answer: string, reversed: boolean) => {
    out.push({ path, line: line + lineOffset, question, answer });
    if (reversed) out.push({ path, line: line + lineOffset, question: answer, answer: question });
  };
  lines.forEach((line, i) => {
    if (inRanges(code, starts[i]!)) return;
    const sep = MULTI_SEP_RE.exec(line);
    if (sep) {
      let q = i;
      while (!blank(q - 1) && !MULTI_SEP_RE.test(lines[q - 1]!)) q--;
      let a = i;
      while (!blank(a + 1) && !MULTI_SEP_RE.test(lines[a + 1]!)) a++;
      if (q === i || a === i) return;
      const question = lines.slice(q, i).join("\n").trim();
      const answer = lines.slice(i + 1, a + 1).join("\n").replace(SR_NOTE_RE, "").trim();
      if (question && answer) push(q, question, answer, sep[1] === "??");
      return;
    }
    const m = matchCardLine(line);
    if (m) push(i, m.question, m.answer, m.reversed);
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
