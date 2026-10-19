import { StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { editorHost, type EditorHost } from "./host";

/**
 * Images and drawings on a line of their own (`![[pic.png|320]]`) render as
 * blocks you can resize (drag the corner, or pick a size), move (drag the
 * grip to another line) and delete. Drawings are SVG files you draw on in
 * place. The width is Obsidian's `|320` syntax, so files stay compatible.
 */

const MEDIA_LINE_RE = /^!\[\[([^[\]|\n]+?\.(?:png|jpe?g|gif|webp|svg|avif|bmp))(?:\|(\d+)(?:x\d+)?)?\]\]\s*$/i;

export interface MediaLine {
  target: string;
  width?: number;
}

export function parseMediaLine(text: string): MediaLine | null {
  const m = MEDIA_LINE_RE.exec(text);
  if (!m) return null;
  return { target: m[1]!.trim(), width: m[2] ? Number(m[2]) : undefined };
}

export function formatMediaLine(m: MediaLine): string {
  return `![[${m.target}${m.width ? `|${Math.round(m.width)}` : ""}]]`;
}

export const isDrawing = (target: string): boolean => /(^|\/)Drawing [^/]*\.svg$/i.test(target);

// ----- drawings -----

export interface Stroke {
  color: string;
  size: number;
  /** 1 for a pen, lower for a highlighter. */
  opacity: number;
  points: [number, number][];
}

export interface DrawingModel {
  width: number;
  height: number;
  strokes: Stroke[];
}

export const BLANK_DRAWING: DrawingModel = { width: 800, height: 400, strokes: [] };

const r1 = (n: number) => Math.round(n * 10) / 10;

export function drawingToSvg(d: DrawingModel): string {
  const paths = d.strokes
    .filter((s) => s.points.length)
    .map((s) => {
      const pts = s.points.length === 1 ? [s.points[0]!, s.points[0]!] : s.points;
      const path = pts.map(([x, y], i) => `${i ? "L" : "M"}${r1(x)} ${r1(y)}`).join(" ");
      return `  <path d="${path}" fill="none" stroke="${s.color}" stroke-width="${s.size}" stroke-opacity="${s.opacity}" stroke-linecap="round" stroke-linejoin="round"/>`;
    });
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${d.width} ${d.height}" width="${d.width}" height="${d.height}" data-writalin-drawing="1">`,
    ...paths,
    "</svg>",
    "",
  ].join("\n");
}

export function svgToDrawing(svg: string): DrawingModel {
  const box = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  const out: DrawingModel = { width: box ? Number(box[1]) : BLANK_DRAWING.width, height: box ? Number(box[2]) : BLANK_DRAWING.height, strokes: [] };
  for (const m of svg.matchAll(/<path\b([^>]*)\/?>/g)) {
    const attr = (name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(m[1]!)?.[1];
    const nums = (attr("d") ?? "").match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    const points: [number, number][] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) points.push([nums[i]!, nums[i + 1]!]);
    if (!points.length) continue;
    out.strokes.push({ color: attr("stroke") ?? "#222", size: Number(attr("stroke-width") ?? 3), opacity: Number(attr("stroke-opacity") ?? 1), points });
  }
  return out;
}

/** Drawings opened for editing as soon as they appear (just inserted). */
const autoEdit = new Set<string>();
export function editDrawingWhenShown(target: string): void {
  autoEdit.add(target);
}

const urls = new Map<string, Promise<string | null>>();
function mediaUrl(host: EditorHost | null, target: string): Promise<string | null> {
  if (!host) return Promise.resolve(null);
  let p = urls.get(target);
  if (!p) urls.set(target, (p = host.resolveEmbed(target)));
  return p;
}
export function forgetMediaUrl(target: string): void {
  urls.delete(target);
}

// ----- the block widget -----

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function btn(label: string, title: string, onClick: () => void, cls = ""): HTMLButtonElement {
  const b = el("button", `cm-media-btn ${cls}`.trim(), label);
  b.type = "button";
  b.title = title;
  b.setAttribute("aria-label", title);
  b.addEventListener("mousedown", (e) => e.preventDefault());
  b.addEventListener("click", (e) => {
    e.preventDefault();
    onClick();
  });
  return b;
}

/** The media line this widget's DOM currently sits on, re-read at event time. */
function lineOf(view: EditorView, dom: HTMLElement): { from: number; to: number; media: MediaLine } | null {
  let pos: number;
  try {
    pos = view.posAtDOM(dom);
  } catch {
    return null;
  }
  const line = view.state.doc.lineAt(pos);
  const media = parseMediaLine(line.text);
  return media ? { from: line.from, to: line.to, media } : null;
}

const SIZES: [string, number | undefined][] = [["S", 240], ["M", 420], ["L", 620], ["Full", undefined]];

class MediaWidget extends WidgetType {
  constructor(readonly media: MediaLine) {
    super();
  }
  override eq(o: MediaWidget) {
    return o.media.target === this.media.target && o.media.width === this.media.width;
  }

  toDOM(view: EditorView): HTMLElement {
    const host = view.state.facet(editorHost);
    const drawing = isDrawing(this.media.target);
    const wrap = el("div", `cm-media${drawing ? " cm-drawing" : ""}`);
    wrap.dataset.target = this.media.target;
    const frame = el("div", "cm-media-frame");
    if (this.media.width) frame.style.width = `${this.media.width}px`;
    const img = el("img", "cm-media-img");
    img.alt = this.media.target.split("/").pop()!;
    img.draggable = false;
    const load = () =>
      void mediaUrl(host, this.media.target).then((url) => {
        if (url) img.src = url;
        else {
          urls.delete(this.media.target);
          frame.replaceChildren(el("span", "cm-embed-missing", `Missing: ${this.media.target}`));
        }
      });
    load();
    frame.append(img);

    // Resize from the corner.
    const handle = el("span", "cm-media-resize");
    handle.title = "Drag to resize";
    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startW = frame.getBoundingClientRect().width;
      const max = view.contentDOM.getBoundingClientRect().width - 8;
      const move = (ev: PointerEvent) => {
        frame.style.width = `${Math.max(80, Math.min(max, startW + ev.clientX - startX))}px`;
      };
      const up = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        const w = frame.getBoundingClientRect().width;
        this.setWidth(view, wrap, w >= max - 4 ? undefined : w);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
    });
    frame.append(handle);

    const bar = el("div", "cm-media-bar");
    const grip = el("span", "cm-media-grip", "⠿");
    grip.title = "Drag to move";
    grip.addEventListener("pointerdown", (e) => this.startMove(view, wrap, grip, e));
    bar.append(grip);
    for (const [label, w] of SIZES) {
      const b = btn(label, label === "Full" ? "Full width" : `Size ${label}`, () => this.setWidth(view, wrap, w), "cm-media-size");
      if (w === this.media.width || (w == null && this.media.width == null)) b.setAttribute("aria-pressed", "true");
      bar.append(b);
    }
    if (drawing) bar.append(btn("✎ Draw", "Draw on this", () => this.openCanvas(view, wrap, frame, img, load), "cm-media-draw"));
    bar.append(btn("Delete", "Remove from note", () => {
      const at = lineOf(view, wrap);
      if (!at) return;
      const end = Math.min(at.to + 1, view.state.doc.length);
      view.dispatch({ changes: { from: at.from, to: end }, userEvent: "delete" });
    }, "cm-media-delete"));
    wrap.append(frame, bar);

    if (drawing && autoEdit.delete(this.media.target)) requestAnimationFrame(() => this.openCanvas(view, wrap, frame, img, load));
    return wrap;
  }

  private setWidth(view: EditorView, wrap: HTMLElement, width: number | undefined) {
    const at = lineOf(view, wrap);
    if (!at) return;
    const insert = formatMediaLine({ target: at.media.target, width });
    if (insert !== view.state.sliceDoc(at.from, at.to)) view.dispatch({ changes: { from: at.from, to: at.to, insert }, userEvent: "input.resize" });
  }

  /** Drag the grip; a line shows where the image will land. */
  private startMove(view: EditorView, wrap: HTMLElement, grip: HTMLElement, e: PointerEvent) {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    wrap.classList.add("cm-media-moving");
    const marker = el("div", "cm-media-drop");
    view.scrollDOM.append(marker);
    let target: number | null = null;
    const place = (ev: PointerEvent) => {
      const pos = view.posAtCoords({ x: ev.clientX, y: ev.clientY }, false);
      const line = view.state.doc.lineAt(pos);
      const block = view.lineBlockAt(line.from);
      const top = view.documentTop + block.top;
      const after = ev.clientY > top + block.height / 2;
      target = after ? line.to + 1 : line.from;
      const y = (after ? block.bottom : block.top) + view.documentTop - view.scrollDOM.getBoundingClientRect().top + view.scrollDOM.scrollTop;
      marker.style.top = `${y - 2}px`;
    };
    const up = () => {
      grip.removeEventListener("pointermove", place);
      grip.removeEventListener("pointerup", up);
      marker.remove();
      wrap.classList.remove("cm-media-moving");
      const at = lineOf(view, wrap);
      if (!at || target == null) return;
      const doc = view.state.doc;
      // Dropping on itself (just above or below) changes nothing.
      if (target >= at.from && target <= at.to + 1) return;
      const text = doc.sliceString(at.from, at.to);
      const cut = at.to < doc.length ? { from: at.from, to: at.to + 1 } : { from: Math.max(0, at.from - 1), to: at.to };
      const paste = target > doc.length ? { from: doc.length, insert: `\n${text}` } : { from: target, insert: `${text}\n` };
      view.dispatch({ changes: [cut, paste], userEvent: "move.drop", scrollIntoView: false });
    };
    grip.addEventListener("pointermove", place);
    grip.addEventListener("pointerup", up);
  }

  /** Swap the picture for a canvas and draw on it; Done saves the SVG. */
  private openCanvas(view: EditorView, wrap: HTMLElement, frame: HTMLElement, img: HTMLImageElement, reload: () => void) {
    if (wrap.classList.contains("cm-drawing-editing")) return;
    const host = view.state.facet(editorHost);
    if (!host?.readText || !host.writeText) return;
    const target = this.media.target;
    wrap.classList.add("cm-drawing-editing");
    void host.readText(target).then((svg) => {
      const model = svg ? svgToDrawing(svg) : { ...BLANK_DRAWING, strokes: [] };
      const pad = new DrawingPad(model, async (done) => {
        await host.writeText!(target, drawingToSvg(done));
        urls.delete(target);
        pad.dom.remove();
        tools.remove();
        img.hidden = false;
        wrap.classList.remove("cm-drawing-editing");
        reload();
      });
      const tools = pad.toolbar();
      img.hidden = true;
      frame.prepend(pad.dom);
      wrap.insertBefore(tools, frame);
      pad.fit();
    });
  }

  override ignoreEvent() {
    return true;
  }
}

const COLORS = ["#1f2328", "#d1242f", "#0969da", "#1a7f37", "#8250df", "#f2a900"];

/** A minimal canvas drawing surface: pen, highlighter, eraser, undo, clear. */
class DrawingPad {
  readonly dom: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private color = COLORS[0]!;
  private size = 3;
  private tool: "pen" | "marker" | "eraser" = "pen";
  private undo: Stroke[][] = [];

  constructor(private model: DrawingModel, private onDone: (d: DrawingModel) => void) {
    this.dom = el("canvas", "cm-drawing-canvas");
    this.ctx = this.dom.getContext("2d")!;
    this.dom.style.aspectRatio = `${model.width} / ${model.height}`;
    this.dom.addEventListener("pointerdown", (e) => this.down(e));
  }

  fit() {
    const r = this.dom.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.dom.width = Math.max(1, Math.round(r.width * dpr));
    this.dom.height = Math.max(1, Math.round(r.height * dpr));
    this.redraw();
  }

  private toModel(e: PointerEvent): [number, number] {
    const r = this.dom.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * this.model.width, ((e.clientY - r.top) / r.height) * this.model.height];
  }

  private down(e: PointerEvent) {
    e.preventDefault();
    this.dom.setPointerCapture(e.pointerId);
    this.undo.push(this.model.strokes.slice());
    if (this.tool === "eraser") {
      const erase = (ev: PointerEvent) => {
        const [x, y] = this.toModel(ev);
        const before = this.model.strokes.length;
        this.model.strokes = this.model.strokes.filter((s) => !s.points.some(([px, py]) => Math.hypot(px - x, py - y) < 12 + s.size / 2));
        if (this.model.strokes.length !== before) this.redraw();
      };
      erase(e);
      const up = () => {
        this.dom.removeEventListener("pointermove", erase);
        this.dom.removeEventListener("pointerup", up);
      };
      this.dom.addEventListener("pointermove", erase);
      this.dom.addEventListener("pointerup", up);
      return;
    }
    const marker = this.tool === "marker";
    const stroke: Stroke = { color: this.color, size: marker ? this.size * 4 : this.size, opacity: marker ? 0.35 : 1, points: [this.toModel(e)] };
    this.model.strokes.push(stroke);
    const move = (ev: PointerEvent) => {
      const events = ev.getCoalescedEvents?.() ?? [ev];
      for (const c of events) {
        const p = this.toModel(c);
        const last = stroke.points[stroke.points.length - 1]!;
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 1.2) stroke.points.push(p);
      }
      this.redraw();
    };
    const up = () => {
      this.dom.removeEventListener("pointermove", move);
      this.dom.removeEventListener("pointerup", up);
      this.redraw();
    };
    this.dom.addEventListener("pointermove", move);
    this.dom.addEventListener("pointerup", up);
    this.redraw();
  }

  private redraw() {
    const { ctx } = this;
    const sx = this.dom.width / this.model.width;
    const sy = this.dom.height / this.model.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.dom.width, this.dom.height);
    ctx.setTransform(sx, 0, 0, sy, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const s of this.model.strokes) {
      ctx.globalAlpha = s.opacity;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.size;
      ctx.beginPath();
      s.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      if (s.points.length === 1) ctx.lineTo(s.points[0]![0] + 0.01, s.points[0]![1]);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  toolbar(): HTMLElement {
    const bar = el("div", "cm-drawing-tools");
    const toolBtns: HTMLButtonElement[] = [];
    const pick = (t: DrawingPad["tool"], b: HTMLButtonElement) => {
      this.tool = t;
      for (const x of toolBtns) x.removeAttribute("aria-pressed");
      b.setAttribute("aria-pressed", "true");
    };
    for (const [t, label] of [["pen", "Pen"], ["marker", "Highlighter"], ["eraser", "Eraser"]] as const) {
      const b = btn(label, label, () => pick(t, b));
      if (t === this.tool) b.setAttribute("aria-pressed", "true");
      toolBtns.push(b);
      bar.append(b);
    }
    const swatches = el("span", "cm-drawing-swatches");
    for (const c of COLORS) {
      const s = btn("", `Colour ${c}`, () => {
        this.color = c;
        for (const x of swatches.children) x.removeAttribute("aria-pressed");
        s.setAttribute("aria-pressed", "true");
        if (this.tool === "eraser") pick("pen", toolBtns[0]!);
      }, "cm-drawing-swatch");
      s.style.setProperty("--swatch", c);
      if (c === this.color) s.setAttribute("aria-pressed", "true");
      swatches.append(s);
    }
    bar.append(swatches);
    const sizes = el("span", "cm-drawing-sizes");
    for (const [label, n] of [["Thin", 2], ["Medium", 4], ["Thick", 8]] as const) {
      const b = btn(label, `${label} line`, () => {
        this.size = n;
        for (const x of sizes.children) x.removeAttribute("aria-pressed");
        b.setAttribute("aria-pressed", "true");
      });
      if (n === 4) {
        b.setAttribute("aria-pressed", "true");
        this.size = 4;
      }
      sizes.append(b);
    }
    bar.append(sizes);
    bar.append(
      btn("Undo", "Undo", () => {
        const prev = this.undo.pop();
        if (prev) {
          this.model.strokes = prev;
          this.redraw();
        }
      }),
      btn("Clear", "Clear the drawing", () => {
        this.undo.push(this.model.strokes.slice());
        this.model.strokes = [];
        this.redraw();
      }),
      btn("Taller", "Make the drawing taller", () => {
        this.model.height += 200;
        this.dom.style.aspectRatio = `${this.model.width} / ${this.model.height}`;
        requestAnimationFrame(() => this.fit());
      }),
      btn("Done", "Save the drawing", () => this.onDone(this.model), "cm-media-done"),
    );
    return bar;
  }
}

function buildMedia(state: EditorState): DecorationSet {
  const out: Range<Decoration>[] = [];
  for (let i = 1; i <= state.doc.lines; i++) {
    const line = state.doc.line(i);
    if (line.length < 7 || line.text.charCodeAt(0) !== 33 /* ! */) continue;
    const media = parseMediaLine(line.text);
    if (media) out.push(Decoration.replace({ widget: new MediaWidget(media), block: true }).range(line.from, line.to));
  }
  return Decoration.set(out);
}

const mediaField = StateField.define<DecorationSet>({
  create: buildMedia,
  update: (deco, tr) => (tr.docChanged ? buildMedia(tr.state) : deco),
  provide: (f) => [EditorView.decorations.from(f), EditorView.atomicRanges.of((view) => view.state.field(f))],
});

/** Paste or drop an image file to save it and put it on its own line. */
const imageInput = EditorView.domEventHandlers({
  paste(e, view) {
    const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
    if (!files.length) return false;
    e.preventDefault();
    void insertImages(view, files, view.state.selection.main.head);
    return true;
  },
  drop(e, view) {
    const files = [...(e.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith("image/"));
    if (!files.length) return false;
    e.preventDefault();
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.head;
    void insertImages(view, files, pos);
    return true;
  },
});

async function insertImages(view: EditorView, files: File[], pos: number) {
  const host = view.state.facet(editorHost);
  if (!host?.saveImage) return;
  const paths = (await Promise.all(files.map((f) => host.saveImage!(f)))).filter((p): p is string => !!p);
  if (!paths.length) return;
  const line = view.state.doc.lineAt(Math.min(pos, view.state.doc.length));
  const block = paths.map((p) => formatMediaLine({ target: p })).join("\n");
  const empty = !line.text.trim();
  const insert = empty ? block : `\n${block}`;
  const at = empty ? line.from : line.to;
  view.dispatch({ changes: { from: at, to: empty ? line.to : at, insert }, selection: { anchor: at + insert.length }, userEvent: "input.paste" });
}

export const media: Extension = [mediaField, imageInput];
