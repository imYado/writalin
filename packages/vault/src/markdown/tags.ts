import { codeRanges, inRanges } from "./code";

// Obsidian tags: letters, numbers, _ - / and must contain a non-digit.
export const TAG_RE = /(^|[\s(,;])#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu;

export function parseInlineTags(text: string): { tag: string; from: number; to: number }[] {
  const code = codeRanges(text);
  const out: { tag: string; from: number; to: number }[] = [];
  for (const m of text.matchAll(TAG_RE)) {
    const from = m.index + m[1]!.length;
    if (inRanges(code, from)) continue;
    // Skip `[[Note#Heading]]` and URLs: a `#` right after non-space is not matched by the regex.
    out.push({ tag: m[2]!.replace(/\/+$/, ""), from, to: from + 1 + m[2]!.length });
  }
  return out;
}

export function normalizeTag(tag: string): string {
  return tag.replace(/^#/, "").toLowerCase();
}

/** True if `tag` equals `filter` or is nested under it (e.g. `school/history` under `school`). */
export function tagMatches(tag: string, filter: string): boolean {
  const t = normalizeTag(tag);
  const f = normalizeTag(filter);
  return t === f || t.startsWith(f + "/");
}
