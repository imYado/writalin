import type { HeadingInfo } from "@writalin/shared";
import { codeRanges, inRanges } from "./code";

export function parseHeadings(text: string, offset = 0, lineOffset = 0): HeadingInfo[] {
  const code = codeRanges(text);
  const out: HeadingInfo[] = [];
  const re = /^(#{1,6})[ \t]+(.+?)[ \t#]*$/gm;
  for (const m of text.matchAll(re)) {
    if (inRanges(code, m.index)) continue;
    out.push({
      level: m[1]!.length,
      text: m[2]!.trim(),
      from: m.index + offset,
      line: lineAt(text, m.index) + lineOffset,
    });
  }
  return out;
}

export function lineAt(text: string, pos: number): number {
  let n = 0;
  for (let i = 0; i < pos; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/** Same slug rule Obsidian uses for heading matching: compare case-insensitively, ignoring extra spaces. */
export function headingKey(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}
