import { Compartment, StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";

/**
 * Print layout preview. Content is already A4 printable width, so a page
 * holds a fixed height of content: 297mm − 2 × 20mm margins = 257mm. We walk
 * the line blocks and drop a subtle dashed marker where each page would
 * break. Images, drawings and tables are unbreakable and move whole to the
 * next page, matching `break-inside: avoid` in the export stylesheet.
 * Paragraphs longer than the space left also start a new page here, which
 * keeps markers between blocks (the export may split them mid-paragraph).
 */
export const PAGE_CONTENT_HEIGHT_MM = 257;
const MM_TO_PX = 96 / 25.4;

class PageBreakWidget extends WidgetType {
  constructor(readonly page: number) {
    super();
  }
  override eq(o: PageBreakWidget) {
    return o.page === this.page;
  }
  toDOM() {
    const el = document.createElement("div");
    el.className = "cm-page-break";
    el.setAttribute("aria-hidden", "true");
    const n = document.createElement("span");
    n.textContent = String(this.page);
    el.append(n);
    return el;
  }
  override get estimatedHeight() {
    return 24;
  }
}

const setBreaks = StateEffect.define<{ pos: number; page: number }[]>();

const breaksField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setBreaks)) {
        value = Decoration.set(e.value.map((b) => Decoration.widget({ widget: new PageBreakWidget(b.page), block: true, side: -1 }).range(b.pos)));
      }
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Compute break positions from line heights. Exported for tests. */
export function computeBreaks(blocks: { from: number; height: number; unbreakable: boolean }[], pageHeight: number): { pos: number; page: number }[] {
  const out: { pos: number; page: number }[] = [];
  let used = 0;
  let page = 1;
  for (const b of blocks) {
    if (used > 0 && used + b.height > pageHeight) {
      page++;
      out.push({ pos: b.from, page });
      used = 0;
    }
    used += b.height;
    // A single block taller than a page spills over several pages.
    while (used > pageHeight && !b.unbreakable) {
      used -= pageHeight;
      page++;
    }
  }
  return out;
}

const measurer = ViewPlugin.fromClass(
  class {
    private pending = false;
    private last = "";
    constructor(readonly view: EditorView) {
      this.schedule();
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.geometryChanged || u.heightChanged) this.schedule();
    }
    schedule() {
      if (this.pending) return;
      this.pending = true;
      this.view.requestMeasure({
        read: (view) => {
          const blocks: { from: number; height: number; unbreakable: boolean }[] = [];
          const { doc } = view.state;
          for (let pos = 0; pos <= doc.length; ) {
            const b = view.lineBlockAt(pos);
            const text = doc.sliceString(b.from, Math.min(b.to, b.from + 200));
            // Skip our own break widgets' height so markers don't shift the layout they measure.
            const widgetH = this.breakAt(b.from) ? 24 : 0;
            blocks.push({ from: b.from, height: Math.max(0, b.height - widgetH), unbreakable: /^\s*\|/.test(text) || /!\[\[|!\[[^\]]*\]\(/.test(text) });
            if (b.to >= doc.length) break;
            pos = b.to + 1;
          }
          return computeBreaks(blocks, PAGE_CONTENT_HEIGHT_MM * MM_TO_PX);
        },
        write: (breaks, view) => {
          this.pending = false;
          const key = breaks.map((b) => `${b.pos}:${b.page}`).join(",");
          if (key !== this.last) {
            this.last = key;
            // Can't dispatch inside a measure cycle; apply right after it.
            queueMicrotask(() => {
              if (this.last === key) view.dispatch({ effects: setBreaks.of(breaks) });
            });
          }
        },
      });
    }
    breakAt(pos: number): boolean {
      let found = false;
      this.view.state.field(breaksField).between(pos, pos, () => {
        found = true;
      });
      return found;
    }
  },
);

export const printCompartment = new Compartment();

export function printLayout(on: boolean): Extension {
  return on ? [breaksField, measurer, EditorView.editorAttributes.of({ class: "cm-print-layout" })] : [];
}
