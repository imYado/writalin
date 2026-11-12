import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PdfMark } from "@writalin/vault";
import { DRAWING_COLORS } from "@writalin/editor";
import { Icon, type IconName } from "@writalin/ui";

/**
 * Drawing, shapes and text on a PDF page. Marks live in page units (the page
 * is 100 wide), so they stay put at any zoom. The pen, highlighter, eraser,
 * colours and sizes are the ones drawings in notes use.
 */
export type MarkTool = "select" | "pen" | "marker" | "eraser" | "text" | "line" | "arrow" | "rect" | "ellipse";

export const MARK_COLORS: readonly string[] = DRAWING_COLORS;
/** Line thickness for Thin, Medium and Thick, in page units. */
export const PEN_SIZES = [0.2, 0.4, 0.8] as const;
/** Text height for Small, Medium and Large, in page units. */
export const TEXT_SIZES = [1.9, 2.5, 3.4] as const;
const MARKER_WIDER = 5;
const MARKER_OPACITY = 0.35;

/** How a mark that was just added shows up: drawn along its length, or typed out. */
export type MarkLive = { draw: number } | { typed: number };

export const newMarkId = (): string => Math.random().toString(36).slice(2, 10);
const r2 = (n: number) => Math.round(n * 100) / 100;

/** A smooth path through the points: curves between midpoints, so quick strokes aren't jagged. */
export function strokePath(points: [number, number][]): string {
  if (!points.length) return "";
  const [x0, y0] = points[0]!;
  if (points.length === 1) return `M${r2(x0)} ${r2(y0)}l0.01 0`;
  if (points.length === 2) return `M${r2(x0)} ${r2(y0)}L${r2(points[1]![0])} ${r2(points[1]![1])}`;
  let d = `M${r2(x0)} ${r2(y0)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i]!;
    const [nx, ny] = points[i + 1]!;
    d += `Q${r2(x)} ${r2(y)} ${r2((x + nx) / 2)} ${r2((y + ny) / 2)}`;
  }
  const [lx, ly] = points[points.length - 1]!;
  return `${d}L${r2(lx)} ${r2(ly)}`;
}

/** A line with an arrowhead at its end, as one path so it can be drawn in one go. */
export function arrowPath(x1: number, y1: number, x2: number, y2: number, size: number): string {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const head = Math.min(len * 0.5, Math.max(1.4, size * 5));
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  // The two barbs, 28° either side of the line.
  const barb = (sign: number) => {
    const cos = Math.cos(sign * 0.49);
    const sin = Math.sin(sign * 0.49);
    return `${r2(x2 - head * (ux * cos - uy * sin))} ${r2(y2 - head * (uy * cos + ux * sin))}`;
  };
  return `M${r2(x1)} ${r2(y1)}L${r2(x2)} ${r2(y2)}M${barb(1)}L${r2(x2)} ${r2(y2)}L${barb(-1)}`;
}

export function moveMark(m: PdfMark, dx: number, dy: number): PdfMark {
  if (m.kind === "stroke") return { ...m, points: m.points.map(([x, y]) => [r2(x + dx), r2(y + dy)] as [number, number]) };
  if (m.kind === "text") return { ...m, x: r2(m.x + dx), y: r2(m.y + dy) };
  return { ...m, x1: r2(m.x1 + dx), y1: r2(m.y1 + dy), x2: r2(m.x2 + dx), y2: r2(m.y2 + dy) };
}

/** The lowest point of a drawn mark (text is measured on screen instead, as it wraps). */
export function markBottom(m: PdfMark): number {
  if (m.kind === "stroke") return m.points.reduce((b, [, y]) => Math.max(b, y), 0);
  if (m.kind === "text") return m.y + m.size * 1.4;
  return Math.max(m.y1, m.y2);
}

/** Rough length of a mark, to pace how long drawing it takes. */
export function markLength(m: PdfMark): number {
  if (m.kind === "stroke") return m.points.reduce((len, p, i) => (i ? len + Math.hypot(p[0] - m.points[i - 1]![0], p[1] - m.points[i - 1]![1]) : 0), 0);
  if (m.kind === "text") return m.text.length;
  const w = Math.abs(m.x2 - m.x1);
  const h = Math.abs(m.y2 - m.y1);
  return m.kind === "line" || m.kind === "arrow" ? Math.hypot(w, h) : m.kind === "ellipse" ? Math.PI * (w + h) / 2 : 2 * (w + h);
}

/** The way a hand goes to draw a mark, as points in page units (the same way round as it is drawn). */
export function markRoute(m: Exclude<PdfMark, { kind: "text" }>): [number, number][] {
  if (m.kind === "stroke") return m.points.length ? m.points : [[0, 0]];
  if (m.kind === "line" || m.kind === "arrow") return [[m.x1, m.y1], [m.x2, m.y2]];
  const x = Math.min(m.x1, m.x2);
  const y = Math.min(m.y1, m.y2);
  const w = Math.abs(m.x2 - m.x1);
  const h = Math.abs(m.y2 - m.y1);
  if (m.kind === "rect") return [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
  if (m.kind === "ellipse") return Array.from({ length: 33 }, (_, i) => [x + w / 2 + (w / 2) * Math.cos((i / 32) * 2 * Math.PI), y + h / 2 + (h / 2) * Math.sin((i / 32) * 2 * Math.PI)] as [number, number]);
  // A filled box (highlight, cover): swept left to right.
  return [[x, y + h / 2], [x + w, y + h / 2]];
}

/** The point a fraction `f` (0 to 1) of the way along a route. */
export function pointAlong(route: [number, number][], f: number): [number, number] {
  const first = route[0] ?? [0, 0];
  if (route.length < 2 || f <= 0) return first;
  const lens = route.slice(1).map((p, i) => Math.hypot(p[0] - route[i]![0], p[1] - route[i]![1]));
  let left = lens.reduce((a, b) => a + b, 0) * Math.min(1, f);
  for (let i = 0; i < lens.length; i++) {
    const len = lens[i]!;
    if (left <= len || i === lens.length - 1) {
      const t = len ? Math.min(1, left / len) : 0;
      return [route[i]![0] + (route[i + 1]![0] - route[i]![0]) * t, route[i]![1] + (route[i + 1]![1] - route[i]![1]) * t];
    }
    left -= len;
  }
  return route[route.length - 1]!;
}

/** Rendered Markdown for text marks, kept so a mark shows at once when it's seen again. */
const htmlCache = new Map<string, string>();
export type RenderText = (markdown: string) => Promise<string>;
/** Render a text ahead of showing it. */
export async function primeMarkHtml(text: string, render: RenderText | undefined): Promise<void> {
  if (!render || htmlCache.has(text)) return;
  try {
    htmlCache.set(text, await render(text));
    if (htmlCache.size > 600) htmlCache.delete(htmlCache.keys().next().value!);
  } catch {
    /* shown as plain text */
  }
}

function MarkShape({ m, live, interactive, selected }: { m: Exclude<PdfMark, { kind: "text" }>; live?: MarkLive; interactive: boolean; selected: boolean }) {
  const drawn = live && "draw" in live ? { className: "pdf-mark-draw", pathLength: 1, style: { animationDuration: `${live.draw}ms` } } : {};
  const line = { fill: "none", stroke: m.color, strokeWidth: m.size, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  // A wider, invisible copy to click or erase: thin lines are hard to hit.
  const hit = { fill: "none", stroke: "transparent", strokeWidth: m.size + 1.8, pointerEvents: "stroke" as const, "data-mark-id": m.id };
  const x = "x1" in m ? Math.min(m.x1, m.x2) : 0;
  const y = "x1" in m ? Math.min(m.y1, m.y2) : 0;
  const w = "x1" in m ? Math.abs(m.x2 - m.x1) : 0;
  const h = "x1" in m ? Math.abs(m.y2 - m.y1) : 0;
  let shape: React.ReactNode;
  let target: React.ReactNode = null;
  switch (m.kind) {
    case "stroke": {
      const d = strokePath(m.points);
      shape = <path d={d} {...line} strokeOpacity={m.opacity} {...drawn} />;
      if (interactive) target = <path d={d} {...hit} />;
      break;
    }
    case "line":
    case "arrow": {
      const d = m.kind === "arrow" ? arrowPath(m.x1, m.y1, m.x2, m.y2, m.size) : `M${m.x1} ${m.y1}L${m.x2} ${m.y2}`;
      shape = <path d={d} {...line} {...drawn} />;
      if (interactive) target = <path d={d} {...hit} />;
      break;
    }
    case "rect":
      shape = <rect x={x} y={y} width={w} height={h} rx={0.4} {...line} {...drawn} />;
      if (interactive) target = <rect x={x} y={y} width={w} height={h} {...hit} />;
      break;
    case "ellipse":
      shape = <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} {...line} {...drawn} />;
      if (interactive) target = <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} {...hit} />;
      break;
    case "box":
      shape = (
        <rect
          x={x} y={y} width={w} height={h} rx={0.3}
          fill={m.fill === "cover" ? "#fff" : m.color}
          fillOpacity={m.fill === "cover" ? 1 : MARKER_OPACITY}
          className={`${m.fill === "cover" ? "" : "pdf-mark-hl"}${live ? " pdf-mark-fade" : ""}`}
        />
      );
      if (interactive) target = <rect x={x} y={y} width={w} height={h} fill="transparent" pointerEvents="all" data-mark-id={m.id} />;
      break;
  }
  return <g className={selected ? "pdf-mark-selected" : undefined}>{shape}{target}</g>;
}

function MarkText({ m, unit, live, editing, selected, interactive, render, onCommit }: {
  m: Extract<PdfMark, { kind: "text" }>;
  unit: number;
  live?: MarkLive;
  editing: boolean;
  selected: boolean;
  interactive: boolean;
  render?: RenderText;
  onCommit: (text: string) => void;
}) {
  const [html, setHtml] = useState<string | undefined>(() => htmlCache.get(m.text));
  const [draft, setDraft] = useState(m.text);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    let alive = true;
    setHtml(htmlCache.get(m.text));
    if (!htmlCache.has(m.text)) void primeMarkHtml(m.text, render).then(() => alive && setHtml(htmlCache.get(m.text)));
    return () => {
      alive = false;
    };
  }, [m.text, render]);
  useEffect(() => {
    if (!editing) return;
    setDraft(m.text);
    const el = box.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
    // Only when typing starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);
  const style: React.CSSProperties = {
    left: m.x * unit,
    top: m.y * unit,
    fontSize: m.size * unit,
    color: m.color,
    width: m.w ? m.w * unit : undefined,
    maxWidth: m.w ? undefined : Math.max(8, 98 - m.x) * unit,
  };
  if (editing) {
    const lines = draft.split("\n");
    return (
      <textarea
        ref={box}
        className="pdf-mark-text pdf-mark-editing"
        style={{ ...style, width: m.w ? m.w * unit : `${Math.max(6, ...lines.map((l) => l.length + 1))}ch` }}
        rows={lines.length}
        value={draft}
        placeholder="Type…"
        aria-label="Text on the page"
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onCommit(draft)}
        onKeyDown={(e) => {
          if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
            e.preventDefault();
            e.currentTarget.blur();
          }
          e.stopPropagation();
        }}
      />
    );
  }
  const typing = live && "typed" in live;
  const cls = `pdf-mark-text${m.note ? " pdf-mark-note" : ""}${selected ? " pdf-mark-selected" : ""}${interactive ? " pdf-mark-hit" : ""}${typing ? " pdf-mark-typing" : ""}`;
  if (typing || html == null) return <div className={cls} style={style} data-mark-id={m.id}>{typing ? m.text.slice(0, live.typed) : m.text}</div>;
  return <div className={`${cls} card-md`} style={style} data-mark-id={m.id} dangerouslySetInnerHTML={{ __html: html }} />;
}

export interface MarkLayerProps {
  /** The tool in hand, or null when the page is only being read. */
  tool: MarkTool | null;
  color: string;
  /** 0, 1 or 2: Thin, Medium, Thick (Small, Medium, Large for text). */
  sizeIndex: number;
  selected: string | null;
  editing: string | null;
  live: Record<string, MarkLive>;
  render?: RenderText;
  onAdd: (m: PdfMark, opts?: { edit?: boolean }) => void;
  onChange: (m: PdfMark) => void;
  onRemove: (id: string) => void;
  onSelect: (id: string | null) => void;
  onEdit: (id: string | null) => void;
}

/** One page's marks, and the surface that takes the pen while a tool is in hand. */
export function MarkLayer({ page, width, height, marks, tool, color, sizeIndex, selected, editing, live, render, onAdd, onChange, onRemove, onSelect, onEdit }: MarkLayerProps & {
  page: number;
  /** The page's size on screen, in CSS pixels. */
  width: number;
  height: number;
  /** This page's marks. */
  marks: PdfMark[];
}) {
  const root = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<PdfMark | null>(null);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const unit = width / 100;
  const units = (height / width) * 100;

  const toUnits = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = root.current!.getBoundingClientRect();
    const u = r.width / 100;
    return [r2((e.clientX - r.left) / u), r2((e.clientY - r.top) / u)];
  };
  const markAt = (e: { clientX: number; clientY: number }): PdfMark | undefined => {
    for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
      if (!root.current?.contains(el)) continue;
      const id = el.closest<HTMLElement | SVGElement>("[data-mark-id]")?.dataset.markId;
      if (id) return marks.find((m) => m.id === id);
    }
    return undefined;
  };
  /** Follow the pointer until it lifts. */
  const track = (el: HTMLElement, id: number, move: (e: PointerEvent) => void, up: () => void) => {
    el.setPointerCapture(id);
    const end = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
      up();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  };

  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!tool || e.button !== 0) return;
    // A click while typing only finishes the text.
    if (editing) return;
    const el = e.currentTarget;
    const [x, y] = toUnits(e);
    if (tool === "text") {
      e.preventDefault();
      const hit = markAt(e);
      if (hit?.kind === "text") return onEdit(hit.id);
      const size = TEXT_SIZES[sizeIndex] ?? TEXT_SIZES[1];
      onAdd({ id: newMarkId(), page, kind: "text", color, size, x, y: r2(y - size * 0.7), text: "" }, { edit: true });
      return;
    }
    e.preventDefault();
    if (tool === "eraser") {
      const erase = (ev: { clientX: number; clientY: number }) => {
        const hit = markAt(ev);
        if (hit) onRemove(hit.id);
      };
      erase(e);
      track(el, e.pointerId, erase, () => {});
      return;
    }
    if (tool === "select") {
      const hit = markAt(e);
      onSelect(hit?.id ?? null);
      if (!hit) return;
      let dx = 0;
      let dy = 0;
      track(el, e.pointerId, (ev) => {
        const [mx, my] = toUnits(ev);
        dx = mx - x;
        dy = my - y;
        setDrag({ id: hit.id, dx, dy });
      }, () => {
        setDrag(null);
        if (Math.hypot(dx, dy) > 0.3) onChange(moveMark(hit, dx, dy));
      });
      return;
    }
    const size = PEN_SIZES[sizeIndex] ?? PEN_SIZES[1];
    const id = newMarkId();
    if (tool === "pen" || tool === "marker") {
      const marker = tool === "marker";
      const points: [number, number][] = [[x, y]];
      const make = (): PdfMark => ({ id, page, kind: "stroke", color, size: marker ? size * MARKER_WIDER : size, opacity: marker ? MARKER_OPACITY : 1, points: points.slice() });
      setDraft(make());
      track(el, e.pointerId, (ev) => {
        for (const c of ev.getCoalescedEvents?.() ?? [ev]) {
          const p = toUnits(c);
          const last = points[points.length - 1]!;
          if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.18) points.push(p);
        }
        setDraft(make());
      }, () => {
        setDraft(null);
        onAdd(make());
      });
      return;
    }
    const make = (x2: number, y2: number): PdfMark => ({ id, page, kind: tool, color, size, x1: x, y1: y, x2, y2 });
    let end: [number, number] = [x, y];
    track(el, e.pointerId, (ev) => {
      end = toUnits(ev);
      setDraft(make(...end));
    }, () => {
      setDraft(null);
      // A click without a drag isn't a shape.
      if (Math.hypot(end[0] - x, end[1] - y) > 0.8) onAdd(make(...end));
    });
  };

  const shown = marks.map((m) => (drag && drag.id === m.id ? moveMark(m, drag.dx, drag.dy) : m));
  const interactive = tool === "select" || tool === "eraser" || tool === "text";
  return (
    <div ref={root} className={`pdf-marks${tool ? ` pdf-marks-on pdf-tool-${tool}` : ""}`}>
      <svg viewBox={`0 0 100 ${r2(units)}`} preserveAspectRatio="none" aria-hidden>
        {shown.map((m) => (m.kind === "text" ? null : <MarkShape key={m.id} m={m} live={live[m.id]} interactive={interactive} selected={selected === m.id} />))}
        {draft && draft.kind !== "text" && <MarkShape m={draft} interactive={false} selected={false} />}
      </svg>
      {tool && (
        <div
          className="pdf-marks-catch"
          onPointerDown={down}
          onDoubleClick={(e) => {
            const hit = markAt(e);
            if (hit?.kind === "text") onEdit(hit.id);
          }}
        />
      )}
      {shown.map((m) =>
        m.kind === "text" ? (
          <MarkText
            key={m.id}
            m={m}
            unit={unit}
            live={live[m.id]}
            editing={editing === m.id}
            selected={selected === m.id}
            interactive={interactive}
            render={render}
            onCommit={(text) => {
              onEdit(null);
              if (!text.trim()) onRemove(m.id);
              else if (text !== m.text) onChange({ ...m, text });
            }}
          />
        ) : null,
      )}
    </div>
  );
}

const TOOLS: { id: MarkTool; label: string; icon: IconName }[] = [
  { id: "select", label: "Move", icon: "pointer" },
  { id: "pen", label: "Pen", icon: "pencil" },
  { id: "marker", label: "Highlighter", icon: "highlighter" },
  { id: "eraser", label: "Eraser", icon: "eraser" },
  { id: "text", label: "Text", icon: "tools" },
  { id: "line", label: "Line", icon: "lineDiag" },
  { id: "arrow", label: "Arrow", icon: "arrowUpRight" },
  { id: "rect", label: "Box", icon: "square" },
  { id: "ellipse", label: "Circle", icon: "circle" },
];
const SIZE_LABELS = ["Thin", "Medium", "Thick"];
const TEXT_SIZE_LABELS = ["Small", "Medium", "Large"];

/** The drawing tools: the same pen, highlighter, eraser, colours and sizes as drawings in notes, plus text and shapes. */
export function MarkToolbar({ tool, onTool, color, onColor, sizeIndex, onSize, canUndo, onUndo, canRedo, onRedo, canDelete, onDelete, onDone }: {
  tool: MarkTool;
  onTool: (t: MarkTool) => void;
  color: string;
  onColor: (c: string) => void;
  sizeIndex: number;
  onSize: (i: number) => void;
  canUndo: boolean;
  onUndo: () => void;
  canRedo: boolean;
  onRedo: () => void;
  /** Something is picked with Move. */
  canDelete: boolean;
  onDelete: () => void;
  onDone: () => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  // Keep the tool in hand in view when the bar scrolls sideways on a narrow pane.
  useLayoutEffect(() => {
    bar.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [tool]);
  const sizes = tool === "text" ? TEXT_SIZE_LABELS : SIZE_LABELS;
  return (
    <div className="pdf-draw-bar" role="toolbar" aria-label="Draw on the PDF" ref={bar}>
      <div className="pdf-draw-scroll">
        {TOOLS.map((t) => (
          <button key={t.id} className="pdf-draw-btn" aria-pressed={tool === t.id} aria-label={t.label} title={t.label} onClick={() => onTool(t.id)}>
            <Icon name={t.icon} size={17} />
          </button>
        ))}
        <span className="pdf-draw-sep" />
        {MARK_COLORS.map((c) => (
          <button key={c} className="pdf-draw-swatch" style={{ "--swatch": c } as React.CSSProperties} aria-pressed={color === c} aria-label={`Colour ${c}`} title="Colour" onClick={() => onColor(c)} />
        ))}
        <span className="pdf-draw-sep" />
        {sizes.map((label, i) => (
          <button key={label} className="pdf-draw-btn pdf-draw-size" aria-pressed={sizeIndex === i} aria-label={label} title={label} onClick={() => onSize(i)}>
            <span style={{ width: 4 + i * 4, height: 4 + i * 4 }} />
          </button>
        ))}
        <span className="pdf-draw-sep" />
        <button className="pdf-draw-btn" disabled={!canUndo} aria-label="Undo" title="Undo" onClick={onUndo}>
          <Icon name="undo" size={17} />
        </button>
        <button className="pdf-draw-btn" disabled={!canRedo} aria-label="Redo" title="Redo" onClick={onRedo}>
          <Icon name="redo" size={17} />
        </button>
        {canDelete && (
          <button className="pdf-draw-btn" aria-label="Delete" title="Delete what's picked" onClick={onDelete}>
            <Icon name="trash" size={17} />
          </button>
        )}
      </div>
      <button className="w-btn w-btn-primary w-btn-small" onClick={onDone}>Done</button>
    </div>
  );
}
