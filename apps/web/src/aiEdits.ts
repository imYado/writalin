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

/** Whether an answer (or the start of one, while it streams) is edits rather than prose. A short lead-in line or two before `@@edit` is allowed. */
export const isEditAnswer = (text: string) => /^\s*(?:[^\n]{0,200}\n){0,2}\s*(?:```\w*\s*)?@@edit\b/.test(text);

export function parseEdits(text: string): { summary: string; edits: AiEdit[] } | null {
  if (!isEditAnswer(text)) return null;
  const body = text.replace(/^[\s\S]*?@@edit\b[^\n]*\n?/, "").replace(/\n?```\s*$/, "");
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
    // Deleting whole lines takes their line break too, so no blank line is left behind.
    if (!e.replace && doc[at.to] === "\n" && (at.from === 0 || doc[at.from - 1] === "\n")) at.to++;
    changes.push({ ...at, insert: e.replace });
  }
  return { changes, missed };
}

/** Whether an answer (or its start) is a new version of the highlighted text rather than an answer to show. */
export const isReplaceAnswer = (text: string) => /^\s*@@replace\b/.test(text);
/** The new version of the highlighted text from an `@@replace` answer. */
export const replaceText = (text: string) => text.replace(/^\s*@@replace[ \t]*\n?/, "");

/** Words, runs of spaces and single line breaks: what a change is measured in. */
const tokens = (s: string) => s.match(/\n|[^\S\n]+|[^\s]+/g) ?? [];

/**
 * The changes that turn `before` into `after`, word by word, placed at
 * `offset` in the note. Only the parts that differ are changed, so the
 * person sees exactly what the AI changed, and nothing outside `before` can
 * change.
 */
export function diffChanges(before: string, after: string, offset = 0): { from: number; to: number; insert: string }[] {
  if (before === after) return [];
  // Same start and end are left alone; only the middle is compared word by word.
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head++;
  let tail = 0;
  while (tail < before.length - head && tail < after.length - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
  // Back up to whole words so a change never starts or ends mid-word.
  while (head > 0 && /\S/.test(before[head - 1]!) && (/\S/.test(before[head] ?? " ") || /\S/.test(after[head] ?? " "))) head--;
  while (tail > 0 && /\S/.test(before[before.length - tail]!) && (/\S/.test(before[before.length - tail - 1] ?? " ") || /\S/.test(after[after.length - tail - 1] ?? " "))) tail--;
  const a = tokens(before.slice(head, before.length - tail));
  const b = tokens(after.slice(head, after.length - tail));
  const base = offset + head;
  // Too long to compare word by word: one change for the whole middle.
  if (a.length * b.length > 4_000_000) return [{ from: base, to: base + a.join("").length, insert: b.join("") }];
  // Longest common run of tokens (classic table, filled from the end).
  const n = a.length;
  const m = b.length;
  const lcs = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * (m + 1) + j] = a[i] === b[j] ? lcs[(i + 1) * (m + 1) + j + 1]! + 1 : Math.max(lcs[(i + 1) * (m + 1) + j]!, lcs[i * (m + 1) + j + 1]!);
    }
  }
  const changes: { from: number; to: number; insert: string }[] = [];
  let pos = base;
  let i = 0;
  let j = 0;
  let cur: { from: number; to: number; insert: string } | null = null;
  const flush = () => {
    if (cur && (cur.to > cur.from || cur.insert)) changes.push(cur);
    cur = null;
  };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      // A lone space between two changes joins them, so the change reads as one phrase.
      const next = i + 1 < n && j + 1 < m && a[i + 1] !== b[j + 1];
      if (cur && /^[^\S\n]+$/.test(a[i]!) && next) {
        cur.to += a[i]!.length;
        cur.insert += b[j]!;
      } else flush();
      pos += a[i]!.length;
      i++;
      j++;
    } else if (j < m && (i >= n || lcs[i * (m + 1) + j + 1]! >= lcs[(i + 1) * (m + 1) + j]!)) {
      cur ??= { from: pos, to: pos, insert: "" };
      cur.insert += b[j]!;
      j++;
    } else {
      cur ??= { from: pos, to: pos, insert: "" };
      cur.to += a[i]!.length;
      pos += a[i]!.length;
      i++;
    }
  }
  flush();
  return changes;
}
