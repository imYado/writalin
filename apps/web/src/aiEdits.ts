/**
 * The AI's suggested edits to a note: `@@edit`, a one-line summary, then
 * `<<<FIND … ===REPLACE … >>>END` blocks. Turned into document changes the
 * editor shows for approval.
 */

export interface AiEdit {
  /** Text from the note to replace; empty means "add at the end". */
  find: string;
  replace: string;
}

/** Whether an answer (or the start of one, while it streams) is edits rather than prose. */
export const isEditAnswer = (text: string) => /^\s*(?:```\w*\s*)?@@edit\b/.test(text);

export function parseEdits(text: string): { summary: string; edits: AiEdit[] } | null {
  if (!isEditAnswer(text)) return null;
  const body = text.replace(/^\s*(?:```\w*\s*)?@@edit\b[^\n]*\n?/, "").replace(/\n?```\s*$/, "");
  const first = body.indexOf("<<<FIND");
  const summary = (first < 0 ? body : body.slice(0, first)).trim();
  const edits: AiEdit[] = [];
  // A missing >>>END (the answer was cut off, or the model forgot it) ends at the next block.
  const re = /<<<FIND[ \t]*\n?([\s\S]*?)\n?===REPLACE[ \t]*\n?([\s\S]*?)(?:\n?>>>END|(?=\n?<<<FIND)|$)/g;
  for (const m of body.matchAll(re)) {
    const find = m[1]!.replace(/^\n+|\n+$/g, "");
    const replace = m[2]!.replace(/^\n+|\n+$/g, "");
    if (find !== replace) edits.push({ find, replace });
  }
  return { summary, edits };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Where `find` is in `doc`, nearest to `near`; spacing and line breaks may differ. */
export function locate(doc: string, find: string, near: number): { from: number; to: number } | null {
  const hits: { from: number; to: number }[] = [];
  for (let i = doc.indexOf(find); i >= 0 && find; i = doc.indexOf(find, i + 1)) hits.push({ from: i, to: i + find.length });
  if (!hits.length) {
    const words = find.trim().split(/\s+/).filter(Boolean);
    if (!words.length) return null;
    const re = new RegExp(words.map(escape).join("\\s+"), "g");
    for (const m of doc.matchAll(re)) hits.push({ from: m.index!, to: m.index! + m[0].length });
  }
  if (!hits.length) return null;
  return hits.reduce((best, h) => (Math.abs(h.from - near) < Math.abs(best.from - near) ? h : best));
}

/**
 * Document changes for the edits, inside the part of the note that was sent
 * (`range`; the whole note or the selection). Edits whose text can't be found
 * are counted in `missed` and left out.
 */
export function planEdits(doc: string, edits: AiEdit[], range: { from: number; to: number }): { changes: { from: number; to: number; insert: string }[]; missed: number } {
  const changes: { from: number; to: number; insert: string }[] = [];
  let missed = 0;
  const part = doc.slice(range.from, range.to);
  for (const e of edits) {
    if (!e.find.trim()) {
      const sep = !part.length || part.endsWith("\n\n") ? "" : part.endsWith("\n") ? "\n" : "\n\n";
      changes.push({ from: range.to, to: range.to, insert: sep + e.replace });
      continue;
    }
    // Prefer a match inside what was sent; a selection can repeat elsewhere in the note.
    const inside = locate(part, e.find, 0);
    const at = inside ? { from: inside.from + range.from, to: inside.to + range.from } : locate(doc, e.find, range.from);
    if (!at || changes.some((c) => at.from < c.to && at.to > c.from)) {
      missed++;
      continue;
    }
    changes.push({ ...at, insert: e.replace });
  }
  return { changes, missed };
}
