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

/** Inline pairs Enter can step out of, longest first. */
const CLOSERS = ["</span>", "</mark>", "]]", "**", "==", "~~", "`", "_"];

/**
 * Enter with the cursor just before the end of an inline mark (`[[Note|]]`,
 * `**bold|**`, `==hi|==`…) moves past the closing marks instead of breaking
 * the line, so you keep typing after it.
 */
export function exitInlineMark(view: EditorView): boolean {
  const { state } = view;
  const r = state.selection.main;
  if (!r.empty || state.selection.ranges.length > 1) return false;
  const line = state.doc.lineAt(r.head);
  const before = line.text.slice(0, r.head - line.from);
  const after = line.text.slice(r.head - line.from);
  for (const c of CLOSERS) {
    if (!after.startsWith(c)) continue;
    let open: boolean;
    if (c === "]]") open = before.lastIndexOf("[[") > before.lastIndexOf("]]");
    else if (c === "</span>" || c === "</mark>") open = before.lastIndexOf(c === "</span>" ? "<span" : "<mark") > before.lastIndexOf(c);
    else open = before.split(c).length % 2 === 0;
    if (!open) continue;
    // Step over a run of closers, e.g. `**[[Note]]**`.
    let to = r.head + c.length;
    for (let rest = after.slice(c.length), moved = true; moved; ) {
      moved = false;
      for (const d of CLOSERS) {
        if (rest.startsWith(d) && d !== "_") {
          to += d.length;
          rest = rest.slice(d.length);
          moved = true;
          break;
        }
      }
    }
    view.dispatch({ selection: { anchor: to }, scrollIntoView: true, userEvent: "select" });
    return true;
  }
  return false;
}

/** Text colours and highlighter colours offered in the menus. Hex only, so they're safe in a style attribute. */
export const TEXT_COLORS = [
  { name: "Red", value: "#e03131" },
  { name: "Orange", value: "#e8590c" },
  { name: "Green", value: "#2f9e44" },
  { name: "Blue", value: "#1c7ed6" },
  { name: "Purple", value: "#9c36b5" },
  { name: "Gray", value: "#868e96" },
] as const;
export const HIGHLIGHT_COLORS = [
  { name: "Yellow", value: "#fff3a3" },
  { name: "Green", value: "#c3f0c8" },
  { name: "Blue", value: "#c5e3ff" },
  { name: "Pink", value: "#ffd1e8" },
  { name: "Purple", value: "#e5d4ff" },
  { name: "Orange", value: "#ffdcb8" },
] as const;

const COLOR_OPEN_BEFORE = /<(span|mark) style="(?:color|background): ?#[0-9a-fA-F]{3,8}">$/;
const COLOR_CLOSE_AFTER = /^<\/(span|mark)>/;

/**
 * Colour the selection's text (`<span style="color:…">`) or highlight it in a
 * colour (`<mark style="background:…">`). Colour and highlight stack, and
 * picking again over already-coloured text swaps the colour; `null` removes it.
 */
export function setColor(view: EditorView, kind: "text" | "highlight", color: string | null): boolean {
  if (color && !/^#[0-9a-fA-F]{3,8}$/.test(color)) return false;
  const { state } = view;
  const tag = kind === "text" ? "span" : "mark";
  const prop = kind === "text" ? "color" : "background";
  // No space before the colour, so `#e03131` is never read as a #tag.
  const openTag = color ? `<${tag} style="${prop}:${color}">` : "";
  const closeTag = color ? `</${tag}>` : "";
  const tr = state.changeByRange((range) => {
    const line = state.doc.lineAt(range.from);
    // The colour tags hugging the selection, innermost first.
    const opens: { tag: string; from: number; to: number }[] = [];
    for (let before = state.sliceDoc(line.from, range.from), end = range.from; ; ) {
      const m = COLOR_OPEN_BEFORE.exec(before);
      if (!m) break;
      opens.push({ tag: m[1]!, from: end - m[0].length, to: end });
      before = before.slice(0, -m[0].length);
      end -= m[0].length;
    }
    const closes: { tag: string; from: number; to: number }[] = [];
    for (let after = state.sliceDoc(range.to, line.to), start = range.to; ; ) {
      const m = COLOR_CLOSE_AFTER.exec(after);
      if (!m) break;
      closes.push({ tag: m[1]!, from: start, to: start + m[0].length });
      after = after.slice(m[0].length);
      start += m[0].length;
    }
    const k = opens.findIndex((o, i) => o.tag === tag && closes[i]?.tag === tag);
    if (k >= 0) {
      const o = opens[k]!;
      const c = closes[k]!;
      const shift = openTag.length - (o.to - o.from);
      return {
        changes: [
          { from: o.from, to: o.to, insert: openTag },
          { from: c.from, to: c.to, insert: closeTag },
        ],
        range: EditorSelection.range(range.from + shift, range.to + shift),
      };
    }
    if (!color || range.empty) return { range };
    return {
      changes: [
        { from: range.from, insert: openTag },
        { from: range.to, insert: closeTag },
      ],
      range: EditorSelection.range(range.from + openTag.length, range.to + openTag.length),
    };
  });
  view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: "input.format" }));
  view.focus();
  return true;
}
