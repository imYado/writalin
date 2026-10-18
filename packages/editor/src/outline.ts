import type { EditorState } from "@codemirror/state";

export interface OutlineItem {
  level: number;
  text: string;
  pos: number;
  line: number;
}

/** Headings in the document, skipping fenced code. Cheap enough to run per change. */
export function outlineOf(state: EditorState): OutlineItem[] {
  const out: OutlineItem[] = [];
  let fence: string | null = null;
  for (let i = 1; i <= state.doc.lines; i++) {
    const line = state.doc.line(i);
    const f = /^\s*(`{3,}|~{3,})/.exec(line.text);
    if (f) {
      if (!fence) fence = f[1]![0]!;
      else if (f[1]![0] === fence) fence = null;
      continue;
    }
    if (fence) continue;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line.text);
    if (m) out.push({ level: m[1]!.length, text: m[2]!, pos: line.from, line: i });
  }
  return out;
}
