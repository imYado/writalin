import { Compartment, type Extension, type Range } from "@codemirror/state";
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";

/** The paragraph (or list/quote block) around the cursor: lines up to the nearest blank lines. */
function currentBlock(view: EditorView): [number, number] {
  const { doc } = view.state;
  const head = doc.lineAt(view.state.selection.main.head).number;
  let a = head;
  let b = head;
  while (a > 1 && doc.line(a - 1).text.trim() !== "") a--;
  while (b < doc.lines && doc.line(b + 1).text.trim() !== "") b++;
  return [a, b];
}

const dim = Decoration.line({ class: "cm-dimmed" });

const focusPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.viewportChanged) this.decorations = this.build(u.view);
    }
    build(view: EditorView): DecorationSet {
      const [a, b] = currentBlock(view);
      const ranges: Range<Decoration>[] = [];
      for (const { from, to } of view.visibleRanges) {
        for (let pos = from; pos <= to; ) {
          const line = view.state.doc.lineAt(pos);
          if (line.number < a || line.number > b) ranges.push(dim.range(line.from));
          pos = line.to + 1;
        }
      }
      return Decoration.set(ranges);
    }
  },
  { decorations: (v) => v.decorations },
);

export const focusCompartment = new Compartment();

export function focusModeExtension(on: boolean): Extension {
  return on ? focusPlugin : [];
}
