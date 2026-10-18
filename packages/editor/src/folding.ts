import { foldService, foldGutter, foldKeymap, codeFolding } from "@codemirror/language";
import { keymap } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";

function headingLevel(text: string): number {
  const m = /^(#{1,6})\s/.exec(text);
  return m ? m[1]!.length : 0;
}

/** A heading folds everything up to the next heading of the same or higher level. */
export function headingFoldRange(state: EditorState, lineStart: number): { from: number; to: number } | null {
  const line = state.doc.lineAt(lineStart);
  const level = headingLevel(line.text);
  if (!level) return null;
  let end = state.doc.length;
  let inFence = false;
  for (let i = line.number + 1; i <= state.doc.lines; i++) {
    const l = state.doc.line(i);
    if (/^\s*(`{3,}|~{3,})/.test(l.text)) inFence = !inFence;
    if (inFence) continue;
    const lv = headingLevel(l.text);
    if (lv && lv <= level) {
      end = l.from - 1;
      break;
    }
  }
  // Don't swallow trailing blank lines: keeps the gap before the next heading.
  while (end > line.to && /^\s*$/.test(state.doc.lineAt(end).text)) end = state.doc.lineAt(end).from - 1;
  return end > line.to ? { from: line.to, to: end } : null;
}

export const headingFolding = [
  foldService.of((state, from) => headingFoldRange(state, from)),
  codeFolding({ placeholderText: "…" }),
  foldGutter({
    markerDOM: (open) => {
      const el = document.createElement("span");
      el.className = `cm-fold-marker${open ? "" : " cm-fold-closed"}`;
      el.textContent = open ? "▾" : "▸";
      el.setAttribute("aria-label", open ? "Collapse section" : "Expand section");
      return el;
    },
  }),
  keymap.of(foldKeymap),
];
