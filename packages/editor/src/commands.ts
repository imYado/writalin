import { EditorSelection, type ChangeSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/** Wrap each selection in a marker (`**`, `_`, `==`, `` ` ``, `~~`), or unwrap if already wrapped. */
export function toggleWrap(view: EditorView, marker: string): boolean {
  const { state } = view;
  const tr = state.changeByRange((range) => {
    const before = state.sliceDoc(range.from - marker.length, range.from);
    const after = state.sliceDoc(range.to, range.to + marker.length);
    if (before === marker && after === marker) {
      return {
        changes: [
          { from: range.from - marker.length, to: range.from },
          { from: range.to, to: range.to + marker.length },
        ],
        range: EditorSelection.range(range.from - marker.length, range.to - marker.length),
      };
    }
    return {
      changes: [
        { from: range.from, insert: marker },
        { from: range.to, insert: marker },
      ],
      range: EditorSelection.range(range.from + marker.length, range.to + marker.length),
    };
  });
  view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: "input.format" }));
  view.focus();
  return true;
}

const PREFIX_RE = /^(\s*)(#{1,6} |> \[![\w-]+\][^\n]*|> |[-*+] \[[ xX]\] |[-*+] |\d+[.)] )?/;

/** Set (or toggle off) a line prefix such as `# `, `- [ ] `, `> ` on every selected line. */
export function setLinePrefix(view: EditorView, prefix: string): boolean {
  const { state } = view;
  const changes: ChangeSpec[] = [];
  const seen = new Set<number>();
  for (const r of state.selection.ranges) {
    for (let pos = r.from; pos <= r.to; ) {
      const line = state.doc.lineAt(pos);
      if (!seen.has(line.number)) {
        seen.add(line.number);
        const m = PREFIX_RE.exec(line.text)!;
        const indent = m[1]!;
        const existing = m[2] ?? "";
        const next = existing === prefix ? "" : prefix;
        changes.push({ from: line.from + indent.length, to: line.from + indent.length + existing.length, insert: next });
      }
      pos = line.to + 1;
    }
  }
  view.dispatch({ changes, userEvent: "input.format" });
  view.focus();
  return true;
}

/**
 * Insert text at the cursor (replacing the selection). With `block`, the text
 * goes on its own lines after the current line. `cursorOffset` places the
 * cursor relative to the start of `text`; by default it goes after it.
 */
export function insertText(view: EditorView, text: string, opts: { block?: boolean; cursorOffset?: number } = {}): void {
  const { state } = view;
  const sel = state.selection.main;
  let from = sel.from;
  let to = sel.to;
  let lead = "";
  let insert = text;
  if (opts.block) {
    const line = state.doc.lineAt(from);
    if (line.text.trim()) {
      from = to = line.to;
      lead = "\n\n";
    } else {
      to = from;
    }
    if (!insert.endsWith("\n")) insert += "\n";
  }
  const start = from + lead.length;
  const anchor = start + (opts.cursorOffset ?? text.length);
  view.dispatch({ changes: { from, to, insert: lead + insert }, selection: { anchor }, scrollIntoView: true, userEvent: "input" });
  view.focus();
}

export function selectedText(view: EditorView): string {
  const s = view.state.selection.main;
  return view.state.sliceDoc(s.from, s.to);
}
