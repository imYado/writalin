import { StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, showPanel, WidgetType, type DecorationSet, type Panel } from "@codemirror/view";

/**
 * Changes the AI suggests, shown in the note before they're made: the old text
 * struck through in red, the new text in green after it, and a bar to accept or
 * reject them. Nothing changes until the person accepts.
 */
export interface Suggestion {
  id: string;
  from: number;
  to: number;
  insert: string;
}

const setSuggestions = StateEffect.define<Suggestion[]>();
/** What the AI said it changed, shown on the bar. */
const setNote = StateEffect.define<string>();
const noteField = StateField.define<string>({
  create: () => "",
  update: (v, tr) => tr.effects.reduce((n, e) => (e.is(setNote) ? e.value : n), v),
});
const dropSuggestions = StateEffect.define<string[] | null>();

const suggestionField = StateField.define<Suggestion[]>({
  create: () => [],
  update(list, tr) {
    let next = list;
    if (tr.docChanged && list.length) {
      // Typing elsewhere moves the suggestions along; editing inside one drops it.
      next = list.flatMap((s) => {
        let touched = false;
        tr.changes.iterChangedRanges((a, b) => {
          if (a < s.to && b > s.from) touched = true;
        });
        if (touched) return [];
        return [{ ...s, from: tr.changes.mapPos(s.from, 1), to: tr.changes.mapPos(s.to, -1) }];
      });
    }
    for (const e of tr.effects) {
      if (e.is(setSuggestions)) next = e.value;
      if (e.is(dropSuggestions)) next = e.value ? next.filter((s) => !e.value!.includes(s.id)) : [];
    }
    return next;
  },
  provide: (f) => [
    EditorView.decorations.compute([f], (state) => decorationsFor(state.field(f))),
    showPanel.computeN([f], (state) => [state.field(f).length ? barPanel : null]),
  ],
});

class InsertWidget extends WidgetType {
  constructor(readonly s: Suggestion) {
    super();
  }
  override eq(other: InsertWidget) {
    return other.s.id === this.s.id && other.s.insert === this.s.insert;
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement("span");
    wrap.className = "cm-suggest";
    if (this.s.insert) {
      const ins = document.createElement("span");
      ins.className = "cm-suggest-ins";
      ins.textContent = this.s.insert;
      wrap.append(ins);
    }
    const id = this.s.id;
    const btn = (label: string, title: string, run: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "cm-suggest-btn";
      b.textContent = label;
      b.title = title;
      b.setAttribute("aria-label", title);
      b.onmousedown = (e) => e.preventDefault();
      b.onclick = run;
      return b;
    };
    wrap.append(btn("✓", "Accept this change", () => acceptSuggestions(view, [id])), btn("✕", "Reject this change", () => rejectSuggestions(view, [id])));
    return wrap;
  }
  override ignoreEvent() {
    return true;
  }
}

function decorationsFor(list: Suggestion[]): DecorationSet {
  const ranges = [...list]
    .sort((a, b) => a.from - b.from || a.to - b.to)
    .flatMap((s) => [
      ...(s.to > s.from ? [Decoration.mark({ class: "cm-suggest-del" }).range(s.from, s.to)] : []),
      Decoration.widget({ widget: new InsertWidget(s), side: 1 }).range(s.to),
    ]);
  return Decoration.set(ranges, true);
}

function barPanel(view: EditorView): Panel {
  const dom = document.createElement("div");
  dom.className = "cm-suggest-bar";
  const label = document.createElement("span");
  const accept = document.createElement("button");
  accept.className = "cm-suggest-accept";
  accept.textContent = "Accept all";
  accept.onclick = () => acceptSuggestions(view);
  const reject = document.createElement("button");
  reject.textContent = "Reject all";
  reject.onclick = () => rejectSuggestions(view);
  const jump = document.createElement("button");
  jump.textContent = "Show";
  jump.title = "Scroll to the first change";
  jump.onclick = () => {
    const first = [...view.state.field(suggestionField)].sort((a, b) => a.from - b.from)[0];
    if (first) view.dispatch({ effects: EditorView.scrollIntoView(first.from, { y: "center" }) });
  };
  dom.append(label, jump, reject, accept);
  const draw = (state: EditorState) => {
    const n = state.field(suggestionField).length;
    const note = state.field(noteField, false);
    label.textContent = `AI suggests ${n} change${n === 1 ? "" : "s"}${note ? `: ${note}` : ""}`;
  };
  draw(view.state);
  return { dom, top: true, update: (u) => draw(u.state) };
}

/** Show these changes for approval, replacing any shown before. Scrolls to the first one. */
export function suggestChanges(view: EditorView, changes: Omit<Suggestion, "id">[], note = ""): void {
  const list = changes
    .filter((c) => c.from >= 0 && c.to <= view.state.doc.length && c.from <= c.to)
    .sort((a, b) => a.from - b.from)
    // Overlapping changes can't both be made; keep the first.
    .filter((c, i, all) => i === 0 || c.from >= all[i - 1]!.to)
    .map((c, i) => ({ ...c, id: `s${Date.now()}-${i}` }));
  view.dispatch({
    effects: [setSuggestions.of(list), setNote.of(note), ...(list[0] ? [EditorView.scrollIntoView(list[0].from, { y: "center" })] : [])],
  });
}

/** Make the suggested changes (these ones, or all). One undo step takes them back. */
export function acceptSuggestions(view: EditorView, ids?: string[]): void {
  const all = view.state.field(suggestionField, false) ?? [];
  const pick = ids ? all.filter((s) => ids.includes(s.id)) : all;
  if (!pick.length) return;
  view.dispatch({
    changes: pick.map((s) => ({ from: s.from, to: s.to, insert: s.insert })),
    effects: dropSuggestions.of(pick.map((s) => s.id)),
    userEvent: "input.ai",
  });
}

export function rejectSuggestions(view: EditorView, ids?: string[]): void {
  view.dispatch({ effects: dropSuggestions.of(ids ?? null) });
}

export function suggestionCount(state: EditorState): number {
  return state.field(suggestionField, false)?.length ?? 0;
}

export const suggestions: Extension = [
  suggestionField,
  noteField,
  EditorView.baseTheme({
    ".cm-suggest-del": { textDecoration: "line-through", textDecorationColor: "#e03131", color: "#c92a2a", backgroundColor: "rgba(224, 49, 49, 0.10)" },
    ".cm-suggest-ins": { whiteSpace: "pre-wrap", color: "#2b8a3e", backgroundColor: "rgba(47, 158, 68, 0.12)", borderRadius: "3px" },
    "&dark .cm-suggest-del": { color: "#ff8787" },
    "&dark .cm-suggest-ins": { color: "#8ce99a" },
    ".cm-suggest-btn": { margin: "0 0 0 3px", padding: "0 6px", border: "1px solid rgba(127,127,127,0.35)", borderRadius: "6px", background: "transparent", color: "inherit", font: "inherit", fontSize: "12px", lineHeight: "1.5", cursor: "pointer", verticalAlign: "1px" },
    ".cm-suggest-btn:hover": { background: "rgba(127,127,127,0.15)" },
    ".cm-suggest-bar": { display: "flex", alignItems: "center", gap: "6px", padding: "6px 10px", fontSize: "13px", background: "color-mix(in srgb, var(--w-accent, #7950f2) 12%, var(--w-surface, #fff))", borderBottom: "1px solid rgba(127,127,127,0.2)" },
    ".cm-suggest-bar span": { flex: "1", minWidth: "0" },
    ".cm-suggest-bar button": { padding: "3px 10px", border: "1px solid rgba(127,127,127,0.35)", borderRadius: "999px", background: "transparent", color: "inherit", font: "inherit", cursor: "pointer" },
    ".cm-suggest-bar .cm-suggest-accept": { background: "var(--w-accent, #7950f2)", borderColor: "var(--w-accent, #7950f2)", color: "#fff" },
  }),
];
