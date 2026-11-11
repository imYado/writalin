import { StateEffect, StateField, Transaction, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";

/**
 * Text the AI is still writing, shown in the note as it arrives. It's kept out
 * of the undo history and taken out again when the answer is complete, so the
 * finished answer goes in as one change that one Undo removes.
 */
interface Live {
  from: number;
  to: number;
}

const setLive = StateEffect.define<Live | null>();

class Caret extends WidgetType {
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-ai-caret";
    el.setAttribute("aria-hidden", "true");
    return el;
  }
  override ignoreEvent() {
    return true;
  }
}
const caret = Decoration.widget({ widget: new Caret(), side: 1 });
const mark = Decoration.mark({ class: "cm-ai-live" });

const liveField = StateField.define<Live | null>({
  create: () => null,
  update(v, tr) {
    let next = v;
    if (next && tr.docChanged) {
      // Typing at either edge stays outside the AI's text.
      const from = tr.changes.mapPos(next.from, 1);
      next = { from, to: Math.max(from, tr.changes.mapPos(next.to, -1)) };
    }
    for (const e of tr.effects) if (e.is(setLive)) next = e.value;
    return next;
  },
  provide: (f) =>
    EditorView.decorations.compute([f], (state) => {
      const live = state.field(f);
      if (!live) return Decoration.none;
      return Decoration.set(live.to > live.from ? [mark.range(live.from, live.to), caret.range(live.to)] : [caret.range(live.to)]);
    }),
});

export const liveWrite: Extension = liveField;

export interface LiveWriter {
  /** Show the answer so far. */
  write(text: string): void;
  /** Take the unfinished text back out. */
  end(): void;
}

const quiet = Transaction.addToHistory.of(false);

/** Start writing on its own lines after the selection, where a finished answer would go. */
export function startLiveWrite(view: EditorView): LiveWriter | null {
  const { state } = view;
  // Not in a read-only note, and one answer at a time.
  if (state.readOnly || state.field(liveField, false) !== null) return null;
  const line = state.doc.lineAt(state.selection.main.to);
  const at = line.text.trim() ? line.to : state.selection.main.to;
  const lead = line.text.trim() ? "\n\n" : "";
  let open = true;
  const safely = (fn: () => void) => {
    try {
      fn();
    } catch {
      // The note was closed while the AI was writing.
      open = false;
    }
  };
  safely(() => view.dispatch({ changes: { from: at, insert: lead }, effects: setLive.of({ from: at, to: at + lead.length }), annotations: quiet }));
  return {
    write(text) {
      if (!open) return;
      const live = view.state.field(liveField, false);
      if (!live) return void (open = false);
      const body = lead + text;
      const now = view.state.sliceDoc(live.from, live.to);
      if (now === body) return;
      let same = 0;
      const max = Math.min(now.length, body.length);
      while (same < max && now.charCodeAt(same) === body.charCodeAt(same)) same++;
      const end = live.from + body.length;
      safely(() =>
        view.dispatch({
          changes: { from: live.from + same, to: live.to, insert: body.slice(same) },
          effects: [setLive.of({ from: live.from, to: end }), EditorView.scrollIntoView(end, { y: "nearest", yMargin: 48 })],
          annotations: quiet,
        }),
      );
    },
    end() {
      if (!open) return;
      open = false;
      const live = view.state.field(liveField, false);
      if (!live) return;
      safely(() => view.dispatch({ changes: { from: live.from, to: live.to }, effects: setLive.of(null), annotations: quiet }));
    },
  };
}
