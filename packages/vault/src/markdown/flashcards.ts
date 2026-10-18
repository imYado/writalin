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
