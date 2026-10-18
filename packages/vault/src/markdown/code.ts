/** Ranges of text that are code (fenced blocks, indented fences, inline code, math). */
export type Range = [number, number];

export function codeRanges(text: string): Range[] {
  const ranges: Range[] = [];
  const fence = /^([ \t]*)(`{3,}|~{3,})[^\n]*$/gm;
  let m: RegExpExecArray | null;
  const fences: { at: number; end: number; marker: string }[] = [];
  while ((m = fence.exec(text))) fences.push({ at: m.index, end: m.index + m[0].length, marker: m[2]! });
  let open: { at: number; marker: string } | null = null;
  for (const f of fences) {
    if (!open) open = f;
    else if (f.marker[0] === open.marker[0] && f.marker.length >= open.marker.length) {
      ranges.push([open.at, f.end]);
      open = null;
    }
  }
  if (open) ranges.push([open.at, text.length]);

  const inline = /(`+)[^`\n][\s\S]*?\1/g;
  while ((m = inline.exec(text))) {
    const r: Range = [m.index, m.index + m[0].length];
    if (!inRanges(ranges, r[0])) ranges.push(r);
  }
  const math = /\$\$[\s\S]*?\$\$/g;
  while ((m = math.exec(text))) {
    if (!inRanges(ranges, m.index)) ranges.push([m.index, m.index + m[0].length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  return ranges;
}

export function inRanges(ranges: readonly Range[], pos: number): boolean {
  for (const [a, b] of ranges) {
    if (pos < a) return false;
    if (pos < b) return true;
  }
  return false;
}
