import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { editorHost } from "./host";
import { parseMediaLine } from "./media";

/**
 * Obsidian-style live preview: Markdown stays the document, but syntax marks
 * are hidden on lines the cursor isn't on, and checkboxes, bullets, images and
 * links render in place. The file on disk is never transformed.
 */

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly pos: number) {
    super();
  }
  override eq(o: CheckboxWidget) {
    return o.checked === this.checked && o.pos === this.pos;
  }
  toDOM(view: EditorView) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-task-box";
    box.checked = this.checked;
    box.setAttribute("aria-label", this.checked ? "Mark task not done" : "Mark task done");
    box.addEventListener("mousedown", (e) => e.preventDefault());
    box.addEventListener("click", (e) => {
      e.preventDefault();
      toggleCheckbox(view, this.pos);
    });
    return box;
  }
  override ignoreEvent() {
    return true;
  }
}

export function toggleCheckbox(view: EditorView, markerFrom: number): void {
  const text = view.state.sliceDoc(markerFrom, markerFrom + 3);
  const checked = /\[[xX]\]/.test(text);
  const line = view.state.doc.lineAt(markerFrom);
  const changes = [{ from: markerFrom + 1, to: markerFrom + 2, insert: checked ? " " : "x" }];
  // Match the Tasks plugin: add/remove a ✅ done date.
  if (/📅|⏳|🛫|⏰|✅/u.test(line.text) || checked) {
    const done = /\s*✅️?\s*\d{4}-\d{2}-\d{2}/u.exec(line.text);
    if (checked && done) changes.push({ from: line.from + done.index, to: line.from + done.index + done[0].length, insert: "" });
    if (!checked && !done && /📅|⏳|🛫|⏰/u.test(line.text)) {
      const d = new Date();
      const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      changes.push({ from: line.to, to: line.to, insert: ` ✅ ${today}` });
    }
  }
  view.dispatch({ changes, userEvent: "input.toggle" });
}

class BulletWidget extends WidgetType {
  override eq() {
    return true;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-bullet";
    s.textContent = "•";
    return s;
  }
}

class RuleWidget extends WidgetType {
  override eq() {
    return true;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-hr";
    return s;
  }
}

const embedCache = new Map<string, Promise<string | null>>();

class EmbedWidget extends WidgetType {
  constructor(readonly target: string, readonly alt: string, readonly external: boolean) {
    super();
  }
  override eq(o: EmbedWidget) {
    return o.target === this.target && o.alt === this.alt;
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement("span");
    wrap.className = "cm-embed";
    const host = view.state.facet(editorHost);
    const isImage = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(this.target.split("#")[0]!) || this.external;
    if (!isImage) {
      // Embedded note or PDF: show a link card rather than inlining the content.
      const a = document.createElement("button");
      a.className = "cm-embed-card";
      a.textContent = `↗ ${this.alt || this.target}`;
      a.onclick = () => host?.openLink(this.target, {});
      wrap.append(a);
      return wrap;
    }
    const img = document.createElement("img");
    img.alt = this.alt || this.target;
    img.loading = "lazy";
    img.draggable = false;
    if (this.external) img.src = this.target;
    else if (host) {
      let p = embedCache.get(this.target);
      if (!p) embedCache.set(this.target, (p = host.resolveEmbed(this.target)));
      void p.then((url) => {
        if (url) img.src = url;
        else {
          embedCache.delete(this.target);
          wrap.textContent = `Missing: ${this.target}`;
          wrap.classList.add("cm-embed-missing");
        }
      });
    }
    wrap.append(img);
    return wrap;
  }
  override ignoreEvent() {
    return false;
  }
}

export function clearEmbedCache(): void {
  embedCache.clear();
}

const hide = Decoration.replace({});

function activeLines(state: EditorState): Set<number> {
  const lines = new Set<number>();
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number;
    const b = state.doc.lineAt(r.to).number;
    for (let i = a; i <= b; i++) lines.add(i);
  }
  return lines;
}

const CALLOUT_RE = /^>\s*\[!([\w-]+)\]([+-]?)\s*(.*)$/;
const WIKI_RE = /(!?)\[\[([^[\]|\n]+?)(\|[^[\]\n]*)?\]\]/g;
const TAG_RE = /(^|[\s(,;])(#[\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu;
const HIGHLIGHT_RE = /==([^=\n]+)==/g;

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const active = activeLines(state);
  const decos: Range<Decoration>[] = [];
  const lineDeco = (pos: number, cls: string) => decos.push(Decoration.line({ class: cls }).range(pos));
  const isActive = (pos: number) => active.has(state.doc.lineAt(pos).number);
  const codeRanges: [number, number][] = [];
  const host = state.facet(editorHost);

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name;
        const n = node.node;
        if (/^ATXHeading(\d)$/.test(name)) {
          lineDeco(node.from, `cm-h cm-h${name.slice(-1)}`);
          return;
        }
        if (name === "HeaderMark") {
          if (!isActive(node.from) && n.parent?.name.startsWith("ATXHeading")) {
            const after = state.sliceDoc(node.to, node.to + 1) === " " ? 1 : 0;
            decos.push(hide.range(node.from, node.to + after));
          }
          return;
        }
        if (name === "FencedCode" || name === "CodeBlock") {
          codeRanges.push([node.from, node.to]);
          for (let p = node.from; p <= node.to; ) {
            const line = state.doc.lineAt(p);
            lineDeco(line.from, "cm-codeblock");
            p = line.to + 1;
          }
          return false;
        }
        if (name === "InlineCode") {
          codeRanges.push([node.from, node.to]);
          decos.push(Decoration.mark({ class: "cm-inline-code" }).range(node.from, node.to));
          if (!isActive(node.from)) {
            for (let c = n.firstChild; c; c = c.nextSibling) if (c.name === "CodeMark") decos.push(hide.range(c.from, c.to));
          }
          return false;
        }
        if (name === "EmphasisMark" || name === "StrikethroughMark") {
          if (!isActive(node.from)) decos.push(hide.range(node.from, node.to));
          return;
        }
        if (name === "Emphasis") decos.push(Decoration.mark({ class: "cm-em" }).range(node.from, node.to));
        if (name === "StrongEmphasis") decos.push(Decoration.mark({ class: "cm-strong" }).range(node.from, node.to));
        if (name === "Strikethrough") decos.push(Decoration.mark({ class: "cm-strike" }).range(node.from, node.to));
        if (name === "Blockquote") {
          const first = state.doc.lineAt(node.from);
          const callout = CALLOUT_RE.exec(first.text);
          for (let p = node.from; p <= node.to; ) {
            const line = state.doc.lineAt(p);
            const cls = callout ? `cm-callout cm-callout-${callout[1]!.toLowerCase()}${line.number === first.number ? " cm-callout-title" : ""}` : "cm-quote";
            lineDeco(line.from, cls);
            p = line.to + 1;
          }
          if (callout && !isActive(first.from)) {
            // `> [!warning] Title` → show just the title (or the kind if no title).
            const markEnd = first.from + first.text.indexOf("]") + 1 + (callout[2] ? 1 : 0);
            const titleStart = first.text.length - callout[3]!.length;
            if (callout[3]) decos.push(hide.range(first.from, first.from + titleStart));
            else decos.push(Decoration.replace({ widget: new CalloutLabel(callout[1]!) }).range(first.from, markEnd));
          }
          return;
        }
        if (name === "QuoteMark") {
          if (!isActive(node.from)) {
            const after = state.sliceDoc(node.to, node.to + 1) === " " ? 1 : 0;
            decos.push(hide.range(node.from, node.to + after));
          }
          return;
        }
        if (name === "TaskMarker") {
          const checked = /x/i.test(state.sliceDoc(node.from, node.to));
          decos.push(Decoration.replace({ widget: new CheckboxWidget(checked, node.from) }).range(node.from, node.to));
          if (checked) {
            const line = state.doc.lineAt(node.from);
            if (node.to < line.to) decos.push(Decoration.mark({ class: "cm-task-done" }).range(node.to, line.to));
          }
          return;
        }
        if (name === "ListMark") {
          const text = state.sliceDoc(node.from, node.to);
          const isTask = n.nextSibling?.name === "Task";
          if (isTask && !isActive(node.from)) {
            const after = state.sliceDoc(node.to, node.to + 1) === " " ? 1 : 0;
            decos.push(hide.range(node.from, node.to + after));
          } else if (/^[-*+]$/.test(text) && !isActive(node.from)) {
            decos.push(Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to));
          }
          return;
        }
        if (name === "HorizontalRule") {
          if (!isActive(node.from)) decos.push(Decoration.replace({ widget: new RuleWidget() }).range(node.from, node.to));
          return;
        }
        if (name === "Image") {
          const url = n.getChild("URL");
          if (url && !isActive(node.from)) {
            const raw = state.sliceDoc(url.from, url.to);
            const altM = /^!\[([^\]]*)\]/.exec(state.sliceDoc(node.from, node.to));
            const external = /^[a-z]+:/i.test(raw);
            const target = external ? raw : decodeURIComponentSafe(raw);
            decos.push(Decoration.replace({ widget: new EmbedWidget(target, altM?.[1] ?? "", external) }).range(node.from, node.to));
          }
          return false;
        }
        if (name === "Link") {
          const url = n.getChild("URL");
          const marks = n.getChildren("LinkMark");
          if (url) {
            const href = state.sliceDoc(url.from, url.to);
            const textFrom = marks[0]?.to ?? node.from;
            const textTo = marks[1]?.from ?? node.to;
            const rendered = !isActive(node.from);
            if (textTo > textFrom) decos.push(Decoration.mark({ class: "cm-link", attributes: { "data-href": href, ...(rendered ? { "data-rendered": "1" } : {}) } }).range(textFrom, textTo));
            if (rendered) {
              if (marks[0]) decos.push(hide.range(marks[0].from, marks[0].to));
              if (marks[1]) decos.push(hide.range(marks[1].from, node.to));
            }
          }
          return false;
        }
        if (name === "URL" && n.parent?.name !== "Link" && n.parent?.name !== "Image") {
          decos.push(Decoration.mark({ class: "cm-link", attributes: { "data-href": state.sliceDoc(node.from, node.to) } }).range(node.from, node.to));
        }
        return;
      },
    });

    // Obsidian syntax the Markdown grammar doesn't know: [[links]], #tags, ==highlights==.
    const text = state.sliceDoc(from, to);
    const inCode = (pos: number) => codeRanges.some(([a, b]) => pos >= a && pos < b);
    for (const m of text.matchAll(WIKI_RE)) {
      const start = from + m.index;
      if (inCode(start)) continue;
      const end = start + m[0].length;
      const embed = m[1] === "!";
      const targetFull = m[2]!.trim();
      const [target, heading] = targetFull.split("#") as [string, string | undefined];
      const alias = m[3]?.slice(1);
      if (embed) {
        // Images on a line of their own are blocks (see media.ts).
        if (parseMediaLine(state.doc.lineAt(start).text)) continue;
        if (!isActive(start)) decos.push(Decoration.replace({ widget: new EmbedWidget(target, alias ?? "", false) }).range(start, end));
        continue;
      }
      const exists = !host || !target || host.linkExists(target);
      const reminder = /^reminders$/i.test(target) && heading?.startsWith("^");
      const attrs = { class: `cm-wikilink${exists ? "" : " cm-wikilink-missing"}${reminder ? " cm-reminder-link" : ""}`, attributes: { "data-target": target, "data-heading": heading ?? "" } };
      if (isActive(start)) {
        decos.push(Decoration.mark(attrs).range(start, end));
      } else {
        const shownFrom = alias != null ? start + 2 + m[2]!.length + 1 : start + 2;
        const shownTo = end - 2;
        decos.push(hide.range(start, shownFrom));
        if (shownTo > shownFrom) decos.push(Decoration.mark({ ...attrs, attributes: { ...attrs.attributes, "data-rendered": "1" } }).range(shownFrom, shownTo));
        decos.push(hide.range(shownTo, end));
      }
    }
    for (const m of text.matchAll(TAG_RE)) {
      const start = from + m.index + m[1]!.length;
      if (inCode(start)) continue;
      const line = state.doc.lineAt(start);
      if (start === line.from && /^#+\s/.test(line.text)) continue;
      decos.push(Decoration.mark({ class: "cm-tag", attributes: { "data-tag": m[2]!.slice(1) } }).range(start, start + m[2]!.length));
    }
    for (const m of text.matchAll(HIGHLIGHT_RE)) {
      const start = from + m.index;
      if (inCode(start)) continue;
      const end = start + m[0].length;
      decos.push(Decoration.mark({ class: "cm-highlight" }).range(start, end));
      if (!isActive(start)) {
        decos.push(hide.range(start, start + 2));
        decos.push(hide.range(end - 2, end));
      }
    }
  }
  return Decoration.set(decos, true);
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

class CalloutLabel extends WidgetType {
  constructor(readonly kind: string) {
    super();
  }
  override eq(o: CalloutLabel) {
    return o.kind === this.kind;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-callout-label";
    s.textContent = this.kind.charAt(0).toUpperCase() + this.kind.slice(1);
    return s;
  }
}

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) {
        this.decorations = build(u.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    provide: (p) =>
      EditorView.atomicRanges.of((view) => {
        // Hidden marks behave as one unit for the cursor.
        const value = view.plugin(p);
        return value ? value.decorations : Decoration.none;
      }),
  },
);

/** Click handling for rendered links and tags. */
export const linkClicks = EditorView.domEventHandlers({
  mousedown(e, view) {
    const el = (e.target as HTMLElement).closest<HTMLElement>(".cm-wikilink, .cm-link, .cm-tag");
    if (!el) return false;
    const host = view.state.facet(editorHost);
    if (!host) return false;
    const rendered = el.dataset.rendered === "1";
    // On the line being edited, a plain click places the cursor; Ctrl/Cmd+click always follows.
    if (!rendered && !(e.ctrlKey || e.metaKey)) return false;
    if (el.classList.contains("cm-tag")) return false;
    e.preventDefault();
    if (el.dataset.target != null) host.openLink(el.dataset.target, { heading: el.dataset.heading || undefined, newPane: e.ctrlKey || e.metaKey });
    else if (el.dataset.href) host.openUrl(el.dataset.href);
    return true;
  },
});

