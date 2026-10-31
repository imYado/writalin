/**
 * Editing commands that work like Obsidian's: markdown links, headings,
 * checkboxes, clearing formatting, list indenting, and wrapping a selection
 * when you type a style mark over it.
 */
import { EditorSelection, type ChangeSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { indentLess, indentMore, redo, undo } from "@codemirror/commands";
import { startCompletion } from "@codemirror/autocomplete";
import { findSpans, insertText, setLinePrefix, toggleWrap } from "./commands";
import { toggleCheckbox } from "./livePreview";

/** `[text](url)`: the selection becomes the text (or the url, if it is one) and the cursor goes where you type next. */
export function insertMarkdownLink(view: EditorView): boolean {
  const { state } = view;
  const tr = state.changeByRange((r) => {
    const text = state.sliceDoc(r.from, r.to);
    if (/^(https?:\/\/|www\.)\S+$/.test(text)) {
      return { changes: { from: r.from, to: r.to, insert: `[](${text})` }, range: EditorSelection.cursor(r.from + 1) };
    }
    const insert = `[${text}]()`;
    // Nothing selected: type the text first; otherwise the URL.
    return { changes: { from: r.from, to: r.to, insert }, range: EditorSelection.cursor(text ? r.from + insert.length - 1 : r.from + 1) };
  });
  view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: "input" }));
  view.focus();
  return true;
}

/** `[[selection]]`, or with nothing selected `[[ ]]` with the note list open. */
export function insertInternalLink(view: EditorView): boolean {
  const r = view.state.selection.main;
  const text = view.state.sliceDoc(r.from, r.to);
  view.dispatch({ changes: { from: r.from, to: r.to, insert: `[[${text}]]` }, selection: { anchor: r.from + 2 + text.length }, userEvent: "input" });
  view.focus();
  setTimeout(() => startCompletion(view), 0);
  return true;
}

const HEADING_RE = /^(\s*)(#{1,6}) /;

/** Make each selected line a heading of this level; 0 makes it body text. The same level again turns it back. */
export function setHeading(view: EditorView, level: number): boolean {
  const { state } = view;
  const changes: ChangeSpec[] = [];
  const seen = new Set<number>();
  for (const r of state.selection.ranges) {
    for (let pos = r.from; pos <= r.to; ) {
      const line = state.doc.lineAt(pos);
      pos = line.to + 1;
      if (seen.has(line.number)) continue;
      seen.add(line.number);
      const m = HEADING_RE.exec(line.text);
      const old = m ? m[2]!.length : 0;
      const next = old === level ? 0 : level;
      const at = line.from + (m ? m[1]!.length : 0);
      changes.push({ from: at, to: at + (m ? old + 1 : 0), insert: next ? `${"#".repeat(next)} ` : "" });
    }
  }
  view.dispatch({ changes, userEvent: "input.format" });
  view.focus();
  return true;
}

/** The phone toolbar's heading button: body → H1 → H2 … → H6 → body. */
export function cycleHeading(view: EditorView): boolean {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const m = HEADING_RE.exec(line.text);
  const level = m ? m[2]!.length : 0;
  return setHeading(view, level >= 6 ? 0 : level + 1);
}

/** Tick or untick the checkbox on each selected line; a line without one becomes a checklist item. */
export function toggleCheckboxStatus(view: EditorView): boolean {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const m = /^(\s*[-*+] )\[[ xX]\]/.exec(line.text);
  if (m) {
    toggleCheckbox(view, line.from + m[1]!.length);
    return true;
  }
  return setLinePrefix(view, "- [ ] ");
}

/** Strip bold, italic, highlight, strikethrough, code and colour from the selection (or the word at the cursor). */
export function clearFormatting(view: EditorView): boolean {
  const { state } = view;
  const tr = state.changeByRange((range) => {
    let { from, to } = range;
    if (range.empty) {
      const w = state.wordAt(range.head);
      if (w) ({ from, to } = w);
    }
    const changes: { from: number; to: number }[] = [];
    for (let n = state.doc.lineAt(from).number, last = state.doc.lineAt(to).number; n <= last; n++) {
      const line = state.doc.line(n);
      for (const kind of ["bold", "italic", "highlight", "strike", "code"] as const) {
        for (const sp of findSpans(line.text, line.from, kind)) {
          if (sp.to <= from || sp.from >= to) continue;
          changes.push({ from: sp.from, to: sp.innerFrom }, { from: sp.innerTo, to: sp.to });
        }
      }
      for (const m of line.text.matchAll(/(<(span|mark) style="[^"]*">)(.*?)(<\/\2>)/g)) {
        const at = line.from + m.index;
        const end = at + m[0].length;
        if (end <= from || at >= to) continue;
        changes.push({ from: at, to: at + m[1]!.length }, { from: end - m[4]!.length, to: end });
      }
    }
    // Overlapping removals (a mark inside another span's marks) would clash; keep the first of each.
    const clean = changes
      .sort((a, b) => a.from - b.from || a.to - b.to)
      .filter((c, i, all) => c.to > c.from && (i === 0 || c.from >= all[i - 1]!.to));
    const set = state.changes(clean);
    return { changes: set, range: EditorSelection.range(set.mapPos(range.anchor, 1), set.mapPos(range.head, -1)) };
  });
  view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: "input.format" }));
  view.focus();
  return true;
}

/** Insert a block on its own lines, e.g. a table or callout. */
export function insertBlock(view: EditorView, text: string, cursorOffset?: number): boolean {
  insertText(view, text, { block: true, cursorOffset });
  return true;
}

/** Inline markup wrapped around the selection (math, comment), or empty with the cursor inside. */
export function wrapWith(view: EditorView, open: string, close = open): boolean {
  const { state } = view;
  const tr = state.changeByRange((r) => ({
    changes: [{ from: r.from, insert: open }, { from: r.to, insert: close }],
    range: EditorSelection.range(r.from + open.length, r.to + open.length),
  }));
  view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: "input.format" }));
  view.focus();
  return true;
}

const AUTOPAIR = new Set(["*", "_", "~", "=", "`", "$"]);

/**
 * Obsidian's "auto pair Markdown syntax": typing `*`, `_`, `~`, `=`, `` ` ``
 * or `$` with text selected wraps the selection instead of replacing it, so
 * selecting a word and typing `**` makes it bold.
 */
export const autoPairMarkdown = EditorView.inputHandler.of((view, _from, _to, text) => {
  if (!AUTOPAIR.has(text) || view.state.readOnly) return false;
  const { selection } = view.state;
  if (selection.ranges.every((r) => r.empty)) return false;
  const tr = view.state.changeByRange((r) =>
    r.empty
      ? { changes: { from: r.from, insert: text }, range: EditorSelection.cursor(r.from + 1) }
      : { changes: [{ from: r.from, insert: text }, { from: r.to, insert: text }], range: EditorSelection.range(r.from + 1, r.to + 1) },
  );
  view.dispatch(view.state.update(tr, { scrollIntoView: true, userEvent: "input.type" }));
  return true;
});

/** Every editing command by name, for toolbars and menus. */
export const editorCommands = {
  undo: (v: EditorView) => undo(v),
  redo: (v: EditorView) => redo(v),
  bold: (v: EditorView) => toggleWrap(v, "**"),
  italic: (v: EditorView) => toggleWrap(v, "*"),
  strikethrough: (v: EditorView) => toggleWrap(v, "~~"),
  highlight: (v: EditorView) => toggleWrap(v, "=="),
  code: (v: EditorView) => toggleWrap(v, "`"),
  math: (v: EditorView) => wrapWith(v, "$"),
  comment: (v: EditorView) => wrapWith(v, "%%"),
  clearFormatting,
  internalLink: insertInternalLink,
  markdownLink: insertMarkdownLink,
  tag: (v: EditorView) => { insertText(v, "#"); setTimeout(() => startCompletion(v), 0); return true; },
  bulletList: (v: EditorView) => setLinePrefix(v, "- "),
  numberedList: (v: EditorView) => setLinePrefix(v, "1. "),
  checklist: (v: EditorView) => setLinePrefix(v, "- [ ] "),
  toggleCheckbox: toggleCheckboxStatus,
  quote: (v: EditorView) => setLinePrefix(v, "> "),
  heading: cycleHeading,
  h1: (v: EditorView) => setHeading(v, 1),
  h2: (v: EditorView) => setHeading(v, 2),
  h3: (v: EditorView) => setHeading(v, 3),
  h4: (v: EditorView) => setHeading(v, 4),
  h5: (v: EditorView) => setHeading(v, 5),
  h6: (v: EditorView) => setHeading(v, 6),
  body: (v: EditorView) => setHeading(v, 0),
  indent: (v: EditorView) => indentMore(v),
  outdent: (v: EditorView) => indentLess(v),
  table: (v: EditorView) => insertBlock(v, "|  |  |\n| --- | --- |\n|  |  |", 2),
  callout: (v: EditorView) => insertBlock(v, "> [!note] "),
  codeBlock: (v: EditorView) => insertBlock(v, "```\n\n```", 4),
  mathBlock: (v: EditorView) => insertBlock(v, "$$\n\n$$", 3),
  horizontalRule: (v: EditorView) => insertBlock(v, "---"),
  footnote: (v: EditorView) => {
    const n = (v.state.doc.toString().match(/\[\^(\d+)\]:/g)?.length ?? 0) + 1;
    const end = v.state.doc.length;
    const head = v.state.selection.main.head;
    v.dispatch({
      changes: [{ from: head, insert: `[^${n}]` }, { from: end, insert: `${v.state.doc.toString().endsWith("\n") ? "" : "\n"}\n[^${n}]: ` }],
      selection: { anchor: end + `[^${n}]`.length + (v.state.doc.toString().endsWith("\n") ? 1 : 2) + `[^${n}]: `.length },
      scrollIntoView: true,
      userEvent: "input",
    });
    v.focus();
    return true;
  },
} satisfies Record<string, (v: EditorView) => boolean>;

export type EditorCommand = keyof typeof editorCommands;
