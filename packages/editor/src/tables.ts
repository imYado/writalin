import { StateEffect, StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";

/**
 * Markdown tables shown as real tables. Each cell is an input; typing writes
 * the table back to Markdown straight away (neatly padded, so the file still
 * reads well in Obsidian or a text editor). "Markdown" on the toolbar shows
 * the source until the cursor leaves the table.
 */

export type Align = "left" | "center" | "right" | null;

export interface TableModel {
  header: string[];
  align: Align[];
  rows: string[][];
}

/** Split a table row on unescaped pipes, dropping the outer ones. */
export function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  let code = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (ch === "`") {
      code = !code;
      cur += ch;
    } else if (ch === "|" && !code) {
      cells.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

function parseAlign(cell: string): Align {
  const c = cell.trim();
  const l = c.startsWith(":");
  const r = c.endsWith(":");
  return l && r ? "center" : r ? "right" : l ? "left" : null;
}

export function parseTable(text: string): TableModel | null {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return null;
  const header = splitRow(lines[0]!);
  const delim = splitRow(lines[1]!);
  if (!delim.every((d) => /^:?-+:?$/.test(d.trim()))) return null;
  const width = header.length;
  const fit = (r: string[]) => Array.from({ length: width }, (_, i) => r[i] ?? "");
  return {
    header,
    align: fit(delim).map((d) => (d ? parseAlign(d) : null)),
    rows: lines.slice(2).map((l) => fit(splitRow(l))),
  };
}

const escapeCell = (s: string) => s.replace(/\r?\n/g, " ").replace(/(?<!\\)\|/g, "\\|");

/** Back to Markdown, columns padded to line up. */
export function serializeTable(t: TableModel): string {
  const cols = t.header.length;
  const all = [t.header, ...t.rows].map((r) => Array.from({ length: cols }, (_, i) => escapeCell(r[i] ?? "")));
  const width = Array.from({ length: cols }, (_, i) => Math.max(3, ...all.map((r) => [...r[i]!].length)));
  const pad = (s: string, i: number) => {
    const n = width[i]! - [...s].length;
    const a = t.align[i];
    if (a === "right") return " ".repeat(n) + s;
    if (a === "center") return " ".repeat(Math.floor(n / 2)) + s + " ".repeat(Math.ceil(n / 2));
    return s + " ".repeat(n);
  };
  const line = (r: string[]) => `| ${r.map(pad).join(" | ")} |`;
  const delim = `| ${width
    .map((w, i) => {
      const a = t.align[i];
      const dashes = "-".repeat(Math.max(1, w - (a === "center" ? 2 : a ? 1 : 0)));
      return a === "center" ? `:${dashes}:` : a === "right" ? `${dashes}:` : a === "left" ? `:${dashes}` : dashes;
    })
    .join(" | ")} |`;
  return [line(all[0]!), delim, ...all.slice(1).map(line)].join("\n");
}

// ---------- editor widget ----------

const showSource = StateEffect.define<number>();

class TableWidget extends WidgetType {
  constructor(readonly source: string, readonly from: number) {
    super();
  }

  override eq(o: TableWidget) {
    return o.source === this.source;
  }

  /** Same shape: keep the DOM (and the focused cell) and refresh values. */
  override updateDOM(dom: HTMLElement, _view: EditorView): boolean {
    const t = parseTable(this.source);
    if (!t || dom.dataset.align !== JSON.stringify(t.align)) return false;
    const inputs = dom.querySelectorAll<HTMLInputElement>("input[data-r]");
    if (inputs.length !== (t.rows.length + 1) * t.header.length) return false;
    for (const input of inputs) {
      const r = Number(input.dataset.r);
      const c = Number(input.dataset.c);
      const v = r < 0 ? t.header[c]! : t.rows[r]![c]!;
      if (input.value !== v && document.activeElement !== input) input.value = v;
    }
    (dom as HTMLElement & { _w?: TableWidget })._w = this;
    return true;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("div") as HTMLDivElement & { _w?: TableWidget };
    wrap.className = "cm-table";
    wrap._w = this;
    const t = parseTable(this.source)!;
    wrap.dataset.align = JSON.stringify(t.align);
    const cur = () => wrap._w!;

    /** Find this table in the current doc (positions move as you type above it). */
    const locate = (): { from: number; to: number } | null => {
      const pos = view.posAtDOM(wrap);
      let found: { from: number; to: number } | null = null;
      syntaxTree(view.state).iterate({
        from: pos,
        to: pos + 1,
        enter: (n) => {
          if (n.name === "Table") {
            // Whole lines, matching the range the widget replaces.
            found = { from: view.state.doc.lineAt(n.from).from, to: view.state.doc.lineAt(n.to).to };
            return false;
          }
        },
      });
      return found;
    };

    const commit = (model: TableModel, focus?: { r: number; c: number }) => {
      const at = locate();
      if (!at) return;
      const insert = serializeTable(model);
      if (view.state.sliceDoc(at.from, at.to) === insert) return;
      view.dispatch({ changes: { from: at.from, to: at.to, insert }, userEvent: "input.table" });
      // The DOM is updated synchronously, so the next keystroke lands in the right cell.
      if (focus) focusCell(focus.r, focus.c, at.from);
    };

    const model = (): TableModel => parseTable(cur().source) ?? t;
    const read = (): TableModel => {
      const m = model();
      for (const input of wrap.querySelectorAll<HTMLInputElement>("input[data-r]")) {
        const r = Number(input.dataset.r);
        const c = Number(input.dataset.c);
        if (r < 0) m.header[c] = input.value;
        else if (m.rows[r]) m.rows[r]![c] = input.value;
      }
      return m;
    };

    const focusCell = (r: number, c: number, from?: number) => {
      const sel = `input[data-r="${r}"][data-c="${c}"]`;
      const tables = [...view.dom.querySelectorAll<HTMLElement>(".cm-table")];
      // Same DOM still in place (the usual case): stay in this table.
      let el = tables.find((x) => x === wrap && x.isConnected);
      // Rebuilt after a shape change: find the table at the position we just wrote.
      if (!el && from != null) {
        const start = view.state.doc.lineAt(from).from;
        el = tables.find((x) => (x as HTMLElement & { _w?: TableWidget })._w?.from === start);
      }
      el?.querySelector<HTMLInputElement>(sel)?.focus();
    };

    let active = { r: -1, c: 0 };
    const table = document.createElement("table");
    const cell = (tag: "th" | "td", value: string, r: number, c: number) => {
      const el = document.createElement(tag);
      const a = t.align[c];
      if (a) el.style.textAlign = a;
      const input = document.createElement("input");
      input.value = value;
      input.dataset.r = String(r);
      input.dataset.c = String(c);
      input.setAttribute("aria-label", r < 0 ? `Column ${c + 1} heading` : `Row ${r + 1}, column ${c + 1}`);
      input.spellcheck = true;
      if (a) input.style.textAlign = a;
      input.addEventListener("focus", () => {
        active = { r, c };
        wrap.classList.add("cm-table-active");
      });
      input.addEventListener("blur", () => wrap.classList.remove("cm-table-active"));
      input.addEventListener("input", () => commit(read()));
      input.addEventListener("keydown", (e) => {
        const m = model();
        const rows = m.rows.length;
        const cols = m.header.length;
        if (e.key === "Tab") {
          e.preventDefault();
          let nr = r;
          let nc = c + (e.shiftKey ? -1 : 1);
          if (nc >= cols) { nc = 0; nr++; }
          if (nc < 0) { nc = cols - 1; nr--; }
          if (nr < -1) return;
          if (nr >= rows) {
            const next = read();
            next.rows.push(Array(cols).fill(""));
            return commit(next, { r: nr, c: nc });
          }
          focusCell(nr, nc);
        } else if (e.key === "Enter") {
          e.preventDefault();
          if (r + 1 >= rows) {
            const next = read();
            next.rows.push(Array(cols).fill(""));
            return commit(next, { r: r + 1, c });
          }
          focusCell(r + 1, c);
        } else if (e.key === "ArrowUp" && r > -1) {
          e.preventDefault();
          focusCell(r - 1, c);
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          if (r + 1 < rows) focusCell(r + 1, c);
          else leave(1);
        } else if (e.key === "ArrowUp" && r === -1) {
          e.preventDefault();
          leave(-1);
        } else if (e.key === "Escape") {
          e.preventDefault();
          leave(1);
        }
      });
      el.append(input);
      return el;
    };

    /** Put the editor cursor just before or after the table. */
    const leave = (dir: 1 | -1) => {
      const at = locate();
      if (!at) return;
      const pos = dir > 0 ? Math.min(view.state.doc.length, at.to + 1) : Math.max(0, at.from - 1);
      view.focus();
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    };

    const thead = document.createElement("thead");
    const hr = document.createElement("tr");
    t.header.forEach((h, c) => hr.append(cell("th", h, -1, c)));
    thead.append(hr);
    const tbody = document.createElement("tbody");
    t.rows.forEach((row, r) => {
      const tr = document.createElement("tr");
      row.forEach((v, c) => tr.append(cell("td", v, r, c)));
      tbody.append(tr);
    });
    table.append(thead, tbody);

    const bar = document.createElement("div");
    bar.className = "cm-table-bar";
    const btn = (label: string, title: string, run: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.title = title;
      // Keep focus in the cell so we know which row/column the button means.
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", run);
      bar.append(b);
    };
    btn("+ Row", "Add a row below", () => {
      const m = read();
      const at = Math.max(0, active.r + 1);
      m.rows.splice(at, 0, Array(m.header.length).fill(""));
      commit(m, { r: at, c: active.c });
    });
    btn("+ Column", "Add a column to the right", () => {
      const m = read();
      const at = active.c + 1;
      m.header.splice(at, 0, `Column ${m.header.length + 1}`);
      m.align.splice(at, 0, null);
      m.rows.forEach((row) => row.splice(at, 0, ""));
      commit(m, { r: active.r, c: at });
    });
    btn("− Row", "Delete this row", () => {
      const m = read();
      if (active.r < 0 || !m.rows.length) return;
      m.rows.splice(active.r, 1);
      commit(m, { r: Math.min(active.r, m.rows.length - 1), c: active.c });
    });
    btn("− Column", "Delete this column", () => {
      const m = read();
      if (m.header.length <= 1) return;
      m.header.splice(active.c, 1);
      m.align.splice(active.c, 1);
      m.rows.forEach((row) => row.splice(active.c, 1));
      commit(m, { r: active.r, c: Math.max(0, active.c - 1) });
    });
    btn("Align", "Left, center, right", () => {
      const m = read();
      const order: Align[] = [null, "center", "right"];
      m.align[active.c] = order[(order.indexOf(m.align[active.c] ?? null) + 1) % order.length]!;
      commit(m, active);
    });
    btn("Markdown", "Edit the table as Markdown text", () => {
      const at = locate();
      if (!at) return;
      view.focus();
      view.dispatch({ effects: showSource.of(at.from), selection: { anchor: at.from }, scrollIntoView: true });
    });

    wrap.append(bar, table);
    return wrap;
  }

  override ignoreEvent() {
    // The table handles its own clicks and typing.
    return true;
  }
}

function buildTables(state: EditorState, source: Set<number>): DecorationSet {
  const out: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter: (n) => {
      if (n.name !== "Table") return;
      const from = state.doc.lineAt(n.from).from;
      const to = state.doc.lineAt(n.to).to;
      const text = state.sliceDoc(from, to);
      if (source.has(from)) {
        // Monospace while editing as Markdown, so the columns line up.
        for (let l = state.doc.lineAt(from).number; l <= state.doc.lineAt(to).number; l++) {
          out.push(Decoration.line({ class: "cm-table-source" }).range(state.doc.line(l).from));
        }
        return false;
      }
      if (!parseTable(text)) return false;
      out.push(Decoration.replace({ widget: new TableWidget(text, from), block: true }).range(from, to));
      return false;
    },
  });
  return Decoration.set(out);
}

interface TablesState {
  /** Tables shown as Markdown (by start position) until the cursor leaves them. */
  source: Set<number>;
  deco: DecorationSet;
}

const tablesField = StateField.define<TablesState>({
  create: (state) => ({ source: new Set(), deco: buildTables(state, new Set()) }),
  update(value, tr) {
    let source = value.source;
    let changed = false;
    if (tr.docChanged && source.size) {
      source = new Set([...source].map((p) => tr.changes.mapPos(p)));
      changed = true;
    }
    for (const e of tr.effects) {
      if (e.is(showSource)) {
        source = new Set(source).add(tr.state.doc.lineAt(e.value).from);
        changed = true;
      }
    }
    if (source.size && (tr.selection || tr.docChanged)) {
      // Drop a table from "source" mode once the cursor is outside it.
      const head = tr.state.selection.main.head;
      const keep = new Set<number>();
      syntaxTree(tr.state).iterate({
        enter: (n) => {
          if (n.name !== "Table") return;
          const from = tr.state.doc.lineAt(n.from).from;
          if (source.has(from) && head >= from && head <= n.to) keep.add(from);
          return false;
        },
      });
      if (keep.size !== source.size) {
        source = keep;
        changed = true;
      }
    }
    if (!changed && !tr.docChanged && syntaxTree(tr.startState) === syntaxTree(tr.state)) return value;
    return { source, deco: buildTables(tr.state, source) };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

export const tables: Extension = tablesField;
