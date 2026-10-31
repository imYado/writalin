import { HIGHLIGHT_COLORS, HIGHLIGHT_RE, highlightEmoji } from "./highlight";
import { ChangeSet, EditorSelection, type ChangeSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

type Kind = "bold" | "italic" | "highlight" | "strike" | "code";

/** What each toolbar marker means, and the marker written when adding it. */
const KINDS: Record<string, { kind: Kind; write: string }> = {
  "**": { kind: "bold", write: "**" },
  __: { kind: "bold", write: "**" },
  "*": { kind: "italic", write: "*" },
  _: { kind: "italic", write: "*" },
  "==": { kind: "highlight", write: "==" },
  "~~": { kind: "strike", write: "~~" },
  "`": { kind: "code", write: "`" },
};

/** Inline styles in a line of text, by kind. Italic accepts `*` and `_`, bold `**` and `__`, as in Obsidian. */
const SPAN_RES: Record<Kind, RegExp> = {
  bold: /(\*\*|__)(?=\S)(.*?\S)\1/g,
  italic: /(?<![*\w])\*(?![*\s])(.*?)(?<![\s*])\*(?!\*)|(?<![_\w])_(?![_\s])(.*?)(?<![\s_])_(?![_\w])/g,
  highlight: new RegExp(HIGHLIGHT_RE.source, "g"),
  strike: /~~(?=\S)(.*?\S)~~/g,
  code: /`([^`\n]+)`/g,
};

interface Span {
  kind: Kind;
  /** The whole span, markers included. */
  from: number;
  to: number;
  /** The styled text inside the markers. */
  innerFrom: number;
  innerTo: number;
}

/** The styled spans of a kind in a line, as document positions. Exported for tests. */
export function findSpans(text: string, offset: number, kind: Kind): Span[] {
  const out: Span[] = [];
  for (const m of text.matchAll(SPAN_RES[kind])) {
    const from = offset + m.index;
    const to = from + m[0].length;
    let open: number;
    let close: number;
    if (kind === "bold" || kind === "strike" || kind === "highlight") open = close = 2;
    else open = close = 1;
    // A coloured highlight's emoji belongs to its opening marks.
    if (kind === "highlight") open += highlightEmoji(m[1]!)?.length ?? 0;
    out.push({ kind, from, to, innerFrom: from + open, innerTo: to - close });
  }
  return out;
}

const ALL_KINDS: Kind[] = ["bold", "italic", "highlight", "strike", "code"];
const isSpace = (c: string) => c === " " || c === "\t";
const MARKS_ONLY = /^[*_=~`]*$/;

/**
 * Toggle an inline style (`**`, `*`/`_`, `==`, `~~`, `` ` ``) on each selection,
 * the way Obsidian does: it works whether the selection is just the text or
 * includes the marks around it.
 * - Inside styled text, it removes the style: from all of it when the whole
 *   text (or nothing) is selected, or just from the selected part.
 * - Otherwise it adds the style, merging with styled bits the selection
 *   touches, keeping spaces at the edges outside the marks, and never cutting
 *   through another style's marks.
 */
export function toggleWrap(view: EditorView, marker: string): boolean {
  const spec = KINDS[marker];
  if (!spec) return false;
  const { kind, write } = spec;
  const { state } = view;
  const doc = state.doc;
  const tr = state.changeByRange((range) => {
    const changes: { from: number; to?: number; insert?: string }[] = [];
    let selFrom = range.from;
    let selTo = range.to;
    const first = doc.lineAt(range.from).number;
    const last = doc.lineAt(range.to).number;
    for (let n = first; n <= last; n++) {
      const line = doc.line(n);
      const a = Math.max(range.from, line.from);
      const b = Math.min(range.to, line.to);
      const text = line.text;
      const at = (pos: number) => text[pos - line.from] ?? "";
      const spans = findSpans(text, line.from, kind);

      if (range.empty) {
        const host = spans.find((sp) => sp.innerFrom <= a && a <= sp.innerTo);
        if (host) {
          changes.push({ from: host.from, to: host.innerFrom }, { from: host.innerTo, to: host.to });
        } else {
          // Put the cursor between the marks.
          return { changes: { from: a, insert: write + write }, range: EditorSelection.cursor(a + write.length) };
        }
        continue;
      }

      let s = a;
      let e = b;
      while (s < e && isSpace(at(s))) s++;
      while (e > s && isSpace(at(e - 1))) e--;
      if (s === e) continue;

      // Already styled: the selection sits inside one span (its text, or the marks too).
      const host = spans.find((sp) => sp.from <= s && e <= sp.to);
      if (host) {
        let is = Math.max(s, host.innerFrom);
        let ie = Math.min(e, host.innerTo);
        // Only other styles' marks left out (`==**bold**==` with "bold" selected) counts as all of it.
        if (MARKS_ONLY.test(doc.sliceString(host.innerFrom, is))) is = host.innerFrom;
        if (MARKS_ONLY.test(doc.sliceString(ie, host.innerTo))) ie = host.innerTo;
        const openText = doc.sliceString(host.from, host.innerFrom);
        const closeText = doc.sliceString(host.innerTo, host.to);
        if (is > host.innerFrom) {
          // Keep the part before styled; spaces go outside the marks.
          let p = is;
          while (p > host.innerFrom && isSpace(at(p - 1))) p--;
          changes.push({ from: p, insert: closeText });
        } else changes.push({ from: host.from, to: host.innerFrom });
        if (ie < host.innerTo) {
          let p = ie;
          while (p < host.innerTo && isSpace(at(p))) p++;
          changes.push({ from: p, insert: openText });
        } else changes.push({ from: host.innerTo, to: host.to });
        if (n === first) selFrom = Math.max(s, host.innerFrom);
        if (n === last) selTo = Math.min(e, host.innerTo);
        continue;
      }

      // Add the style. Grow the selection so it never cuts through marks, and
      // swallow spans of the same style it touches.
      const others = ALL_KINDS.flatMap((k) => findSpans(text, line.from, k));
      for (let grew = true; grew; ) {
        grew = false;
        for (const sp of others) {
          const overlaps = s < sp.to && e > sp.from;
          const covers = s <= sp.from && e >= sp.to;
          const inside = s >= sp.innerFrom && e <= sp.innerTo;
          if (overlaps && !covers && (sp.kind === kind || !inside)) {
            s = Math.min(s, sp.from);
            e = Math.max(e, sp.to);
            grew = true;
          }
        }
      }
      for (const sp of spans) {
        if (sp.from >= s && sp.to <= e) changes.push({ from: sp.from, to: sp.innerFrom }, { from: sp.innerTo, to: sp.to });
      }
      changes.push({ from: s, insert: write }, { from: e, insert: write });
      if (n === first) selFrom = s;
      if (n === last) selTo = e;
    }
    if (!changes.length) return { range };
    changes.sort((x, y) => x.from - y.from || (x.to ?? x.from) - (y.to ?? y.from));
    const set = ChangeSet.of(changes, doc.length);
    const from = set.mapPos(selFrom, 1);
    const to = Math.max(from, set.mapPos(selTo, -1));
    return { changes: set, range: range.empty ? EditorSelection.cursor(set.mapPos(range.head, -1)) : EditorSelection.range(from, to) };
  });
  view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: "input.format" }));
  view.focus();
  return true;
}

/**
 * Turn each selection into a cloze blank, `{{cN::selection}}`, numbered after the
 * line's other blanks so each becomes its own card. With nothing selected, an
 * empty blank goes in with the cursor inside.
 */
export function makeCloze(view: EditorView): boolean {
  const { state } = view;
  const tr = state.changeByRange((range) => {
    const line = state.doc.lineAt(range.from);
    const used = [...line.text.matchAll(/\{\{c(\d+)::/g)].map((m) => Number(m[1]));
    const open = `{{c${Math.max(0, ...used) + 1}::`;
    return {
      changes: [
        { from: range.from, insert: open },
        { from: range.to, insert: "}}" },
      ],
      range: EditorSelection.range(range.from + open.length, range.to + open.length),
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
export { HIGHLIGHT_COLORS };

/**
 * Highlight the selection as `==text==`, in a colour by putting its emoji
 * first (`==🟢 text==`, as in Obsidian). Inside a highlight already, this
 * swaps its colour; `null` removes the highlight.
 */
export function setHighlight(view: EditorView, emoji: string | null): boolean {
  const { state } = view;
  const tr = state.changeByRange((range) => {
    const line = state.doc.lineAt(range.from);
    for (const m of line.text.matchAll(HIGHLIGHT_RE)) {
      const start = line.from + m.index;
      const end = start + m[0].length;
      if (range.from < start || range.to > end) continue;
      const old = highlightEmoji(m[1]!)?.length ?? 0;
      if (emoji === null) {
        const cut = 2 + old;
        return {
          changes: [{ from: start, to: start + cut }, { from: end - 2, to: end }],
          range: EditorSelection.range(Math.max(start, range.from - cut), Math.max(start, range.to - cut)),
        };
      }
      const insert = emoji ? `${emoji} ` : "";
      const shift = insert.length - old;
      return {
        changes: { from: start + 2, to: start + 2 + old, insert },
        range: EditorSelection.range(range.from + shift, range.to + shift),
      };
    }
    if (emoji === null || range.empty) return { range };
    const open = `==${emoji ? `${emoji} ` : ""}`;
    return {
      changes: [{ from: range.from, insert: open }, { from: range.to, insert: "==" }],
      range: EditorSelection.range(range.from + open.length, range.to + open.length),
    };
  });
  view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: "input.format" }));
  view.focus();
  return true;
}

const COLOR_OPEN_BEFORE = /<(span|mark) style="(?:color|background): ?#[0-9a-fA-F]{3,8}">$/;
const COLOR_CLOSE_AFTER = /^<\/(span|mark)>/;
/** A whole colour tag pair on a line (no same tag nested inside). */
const COLOR_SPAN_RE = /<span style="color: ?#[0-9a-fA-F]{3,8}">((?:(?!<\/?span[ >])[^\n])*)<\/span>/g;
const COLOR_MARK_RE = /<mark style="background: ?#[0-9a-fA-F]{3,8}">((?:(?!<\/?mark[ >])[^\n])*)<\/mark>/g;
/** Only tags and style marks between the selection and the coloured text's edge. */
const TAGS_ONLY = /^(?:<\/?(?:span|mark)[^>]*>|[*_=~`])*$/;
const closeTagOf = (tag: string) => `</${tag}>`;

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
    if (k < 0 && !range.empty) {
      // The selection is inside coloured text, or includes its tags: recolour
      // or uncolour all of it, or split it when only part is selected.
      const re = tag === "span" ? COLOR_SPAN_RE : COLOR_MARK_RE;
      for (const m of line.text.matchAll(re)) {
        const from = line.from + m.index;
        const to = from + m[0].length;
        const innerFrom = from + m[0].indexOf(">") + 1;
        const innerTo = to - closeTagOf(tag).length;
        if (range.from < from || range.to > to) continue;
        let is = Math.max(range.from, innerFrom);
        let ie = Math.min(range.to, innerTo);
        if (TAGS_ONLY.test(state.sliceDoc(innerFrom, is))) is = innerFrom;
        if (TAGS_ONLY.test(state.sliceDoc(ie, innerTo))) ie = innerTo;
        const oldOpen = state.sliceDoc(from, innerFrom);
        const changes: { from: number; to?: number; insert?: string }[] = [];
        if (is > innerFrom) changes.push({ from: is, insert: closeTagOf(tag) + openTag });
        else changes.push({ from, to: innerFrom, insert: openTag });
        if (ie < innerTo) changes.push({ from: ie, insert: closeTag + oldOpen });
        else changes.push({ from: innerTo, to, insert: closeTag });
        const set = ChangeSet.of(changes, state.doc.length);
        const selFrom = Math.max(range.from, innerFrom);
        const selTo = Math.min(range.to, innerTo);
        return { changes: set, range: EditorSelection.range(set.mapPos(selFrom, 1), Math.max(set.mapPos(selFrom, 1), set.mapPos(selTo, -1))) };
      }
    }
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
