import { useCallback, useEffect, useRef, useState } from "react";
import type { VaultPath } from "@writalin/shared";
import { basename } from "@writalin/shared";
import { pdfQuote, type PdfHighlight, type PdfMark } from "@writalin/vault";
import { Icon, toast } from "@writalin/ui";
import type { AiSourceText, BoardOp, BoardTextSize, PdfBoard, WorkspaceProps } from "./types";
import { loadPdf, type PdfDoc } from "./pdf";
import { blankPdf } from "./pdfBlank";
import { MARK_COLORS, MarkLayer, MarkToolbar, PEN_SIZES, markBottom, markLength, markRoute, pointAlong, newMarkId, primeMarkHtml, type MarkLayerProps, type MarkLive, type MarkTool } from "./pdfMarks";
import { pickRelevant } from "./relevance";

interface Props extends WorkspaceProps {
  path: VaultPath;
  /** 1-based page to open at (from a `#page=N` link). */
  page?: number;
  /** Offer this PDF to the AI tutor as a board to write and draw on; null takes it back. */
  registerBoard?: (board: PdfBoard | null) => void;
}

/** Colours the AI may name, mapped onto the pen colours. */
const BOARD_COLORS: Record<string, string> = {
  black: MARK_COLORS[0]!, red: MARK_COLORS[1]!, blue: MARK_COLORS[2]!, green: MARK_COLORS[3]!, purple: MARK_COLORS[4]!,
  yellow: MARK_COLORS[5]!, orange: MARK_COLORS[5]!,
};
const boardColor = (name: string | undefined, fallback = MARK_COLORS[0]!) => (name && BOARD_COLORS[name.toLowerCase()]) || fallback;
const BOARD_TEXT: Record<BoardTextSize, number> = { s: 1.9, m: 2.5, l: 3.4, xl: 4.6 };
/** Margins the AI's writing keeps to, in page units. */
const BOARD_MARGIN = 8;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * PDF viewer on PDF.js: lazy page rendering, text selection, search, zoom,
 * thumbnails. Selecting text offers "Quote in note", which drops a quote with
 * a link back to the exact page.
 */
type PdfAiTool = Parameters<NonNullable<WorkspaceProps["askAi"]>>[0];
const AI_TOOLS: { id: PdfAiTool; label: string }[] = [
  { id: "summarize", label: "Summarize" },
  { id: "flashcards", label: "Flashcards" },
  { id: "explain", label: "Explain simply" },
  { id: "mainpoint", label: "Main point" },
  { id: "quiz", label: "Quiz me" },
];
/** Matches the server's limit on how much text one request may send. */
const MAX_AI_CHARS = 58_000;
/**
 * A question about many pages sends only the best-matching ones, up to about
 * this much text: answers stay quick, cheap and within small free-tier limits.
 */
const ASK_CHARS = 16_000;
/** Scanned pages read with text recognition per request; each takes a few seconds. */
const MAX_OCR_PAGES = 20;
type AiScope = "page" | "all" | "pick" | "hits" | "selection";

/** Highlighter colors, drawn under the text with multiply so the words stay readable. */
export const PDF_HL_COLORS = [
  { id: "yellow", label: "Yellow", css: "rgba(255, 214, 0, 0.42)" },
  { id: "green", label: "Green", css: "rgba(80, 200, 120, 0.38)" },
  { id: "blue", label: "Blue", css: "rgba(80, 160, 255, 0.36)" },
  { id: "pink", label: "Pink", css: "rgba(255, 105, 180, 0.36)" },
] as const;
const hlCss = (id: string) => (PDF_HL_COLORS.find((c) => c.id === id) ?? PDF_HL_COLORS[0]).css;

type Rect = PdfHighlight["rects"][number];

/** The selection's line boxes on one page, as fractions of the page, with each line's pieces joined. */
function selectionRects(range: Range, pageEl: HTMLElement): Rect[] {
  const box = pageEl.getBoundingClientRect();
  const lines: DOMRect[] = [];
  for (const r of [...range.getClientRects()].sort((a, b) => a.top - b.top || a.left - b.left)) {
    if (r.width < 1 || r.height < 1 || r.bottom < box.top || r.top > box.bottom) continue;
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.top - r.top) < last.height / 2 && r.left - last.right < 6) {
      const left = Math.min(last.left, r.left);
      lines[lines.length - 1] = new DOMRect(left, Math.min(last.top, r.top), Math.max(last.right, r.right) - left, Math.max(last.height, r.height));
    } else lines.push(r);
  }
  return lines.map((r) => [(r.left - box.left) / box.width, (r.top - box.top) / box.height, r.width / box.width, r.height / box.height]);
}

/** [1, 2, 3, 7] → "1–3, 7" */
export function formatPages(pages: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j]! + 1) j++;
    out.push(j > i ? `${pages[i]}–${pages[j]}` : `${pages[i]}`);
    i = j;
  }
  return out.join(", ");
}

export function PdfWorkspace({ vault, path, page: initialPage, insertIntoNote, quality, currentNote, askAi, registerAiSource, openAi, renderText, registerBoard }: Props) {
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [page, setPage] = useState(initialPage ?? 1);
  const [thumbs, setThumbs] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<number[]>([]);
  /** What `hits` were found for. */
  const [hitsFor, setHitsFor] = useState("");
  const [sel, setSel] = useState<{ text: string; page: number; x: number; y: number; rects: Rect[] } | null>(null);
  const [highlights, setHighlights] = useState<PdfHighlight[]>([]);
  /** A highlight that was clicked, with where to show its menu. */
  const [activeHl, setActiveHl] = useState<{ h: PdfHighlight; x: number; y: number } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  /** Pages ticked in "Choose pages" mode; null when not choosing. */
  const [picked, setPicked] = useState<Set<number> | null>(null);
  /** Bumped to read the file again after pages were added to it. */
  const [rev, setRev] = useState(0);

  // ----- drawing, shapes and text on the pages -----
  const [marks, setMarks] = useState<PdfMark[]>([]);
  const marksNow = useRef<PdfMark[]>([]);
  /** The drawing tool in hand; null while reading. */
  const [tool, setTool] = useState<MarkTool | null>(null);
  const [color, setColor] = useState(MARK_COLORS[0]!);
  const [sizeIndex, setSizeIndex] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  /** Marks being drawn or typed out right now (the AI at work). */
  const [live, setLive] = useState<Record<string, MarkLive>>({});
  const undoStack = useRef<PdfMark[][]>([]);
  const [undoable, setUndoable] = useState(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveMarksNow = useCallback(() => {
    if (!saveTimer.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
    // A text box that is still empty isn't kept.
    void vault.setPdfMarks(path, marksNow.current.filter((m) => m.kind !== "text" || m.text.trim())).catch(() => toast("Couldn't save what you drew. Try again.", { tone: "warn" }));
  }, [vault, path]);
  /** Change what's on the pages; saved a moment later. */
  const commitMarks = useCallback((next: PdfMark[], opts: { undo?: boolean } = {}) => {
    if (opts.undo !== false) {
      undoStack.current.push(marksNow.current);
      if (undoStack.current.length > 100) undoStack.current.shift();
      setUndoable(undoStack.current.length);
    }
    marksNow.current = next;
    setMarks(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(saveMarksNow, 500);
  }, [saveMarksNow]);
  useEffect(() => {
    let alive = true;
    marksNow.current = [];
    setMarks([]);
    undoStack.current = [];
    setUndoable(0);
    setSelected(null);
    setEditing(null);
    void vault.pdfMarks(path).then((m) => {
      if (!alive) return;
      marksNow.current = m;
      setMarks(m);
    }).catch(() => {});
    return () => {
      alive = false;
      saveMarksNow();
    };
  }, [vault, path, saveMarksNow]);
  const undoMark = useCallback(() => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    setUndoable(undoStack.current.length);
    setSelected(null);
    setEditing(null);
    commitMarks(prev, { undo: false });
  }, [commitMarks]);
  const removeMark = useCallback((id: string) => {
    const m = marksNow.current.find((x) => x.id === id);
    if (!m) return;
    // A text box left empty just goes away, with nothing to undo.
    commitMarks(marksNow.current.filter((x) => x.id !== id), { undo: !(m.kind === "text" && !m.text.trim()) });
    setSelected((cur) => (cur === id ? null : cur));
  }, [commitMarks]);
  const markLayer: MarkLayerProps = {
    tool,
    color,
    sizeIndex,
    selected,
    editing,
    live,
    render: renderText,
    onAdd: (m, opts) => {
      commitMarks([...marksNow.current, m]);
      if (opts?.edit) setEditing(m.id);
    },
    onChange: (m) => {
      const before = marksNow.current.find((x) => x.id === m.id);
      // Typing into a new text box is one step with making it.
      commitMarks(marksNow.current.map((x) => (x.id === m.id ? m : x)), { undo: !(before?.kind === "text" && !before.text.trim()) });
    },
    onRemove: removeMark,
    onSelect: setSelected,
    onEdit: setEditing,
  };
  // While drawing: Delete removes what's picked, Ctrl+Z undoes.
  useEffect(() => {
    if (!tool) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("input, textarea, [contenteditable='true'], .cm-editor")) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        removeMark(selected);
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undoMark();
      } else if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tool, selected, removeMark, undoMark]);


  const link = (p?: number) => `${path.replace(/ /g, "%20")}${p ? `#page=${p}` : ""}`;
  /** Page texts, reading scanned pages (no text in them) with text recognition. */
  const readPages = async (pages: number[], progress?: (msg: string) => void): Promise<string[]> => {
    const d = doc!;
    const texts: string[] = [];
    for (const n of pages) texts.push(await d.pageText(n));
    const scanned = pages.map((n, i) => (texts[i]!.trim() ? 0 : n)).filter(Boolean).slice(0, MAX_OCR_PAGES);
    if (!scanned.length) return texts;
    const say = progress ?? ((m: string) => toast(m));
    if (!progress) say(scanned.length > 1 ? `Reading ${scanned.length} scanned pages…` : "Reading the scanned page…");
    for (const [k, n] of scanned.entries()) {
      if (progress) say(scanned.length > 1 ? `Reading scanned page ${k + 1} of ${scanned.length}…` : "Reading the scanned page…");
      try {
        texts[pages.indexOf(n)] = await d.ocrPage(n);
      } catch {
        toast("Couldn't read the scanned pages. Check your connection and try again.", { tone: "warn" });
        break;
      }
    }
    return texts;
  };
  /**
   * Collect the selection, or some pages, with a link back to the source. With a
   * question (`query`) and more pages than fit, only the pages that best match
   * the question are sent.
   */
  const buildSource = async (scope: AiScope, query?: string, progress?: (msg: string) => void): Promise<AiSourceText | null> => {
    if (!doc) return null;
    const name = basename(path);
    if (scope === "selection") {
      if (!sel) return (toast("Highlight some text in the PDF first.", { tone: "warn" }), null);
      return { text: sel.text, label: `your highlighted text on page ${sel.page} of “${name}”`, footer: `[source p.${sel.page}](${link(sel.page)})` };
    }
    const pages =
      scope === "page" ? [page]
      : scope === "all" ? Array.from({ length: doc.numPages }, (_, i) => i + 1)
      : scope === "hits" ? hits
      : [...(picked ?? [])].sort((a, b) => a - b);
    if (!pages.length) return (toast(scope === "hits" ? "Search the PDF first." : "Tick the pages you want first.", { tone: "warn" }), null);
    if (pages.length === 1) {
      const n = pages[0]!;
      const [text = ""] = await readPages([n], progress);
      if (!text.trim()) return (toast("This page has no text to read.", { tone: "warn" }), null);
      return { text, label: `page ${n} of “${name}”`, footer: `[source p.${n}](${link(n)})` };
    }
    // Text first, so a question can be matched against every page before picking.
    const texts: string[] = [];
    for (const n of pages) texts.push(await doc.pageText(n));
    const total = texts.reduce((len, t) => len + t.length + 12, 0);
    let chosen = pages;
    let matched = false;
    if (query?.trim() && total > ASK_CHARS) {
      const best = pickRelevant(query, texts, ASK_CHARS).map((i) => pages[i]!);
      if (best.length) {
        chosen = best;
        matched = true;
      }
    }
    const budget = matched ? ASK_CHARS + 4000 : MAX_AI_CHARS;
    let text = "";
    const sent: number[] = [];
    const chosenTexts = await readPages(chosen.slice(0, 400), progress);
    let blank = 0;
    for (const [i, n] of chosen.entries()) {
      if (text.length >= budget || i >= chosenTexts.length) break;
      if (!chosenTexts[i]!.trim()) {
        blank++;
        continue;
      }
      text += `\n\n[Page ${n}]\n${chosenTexts[i]}`;
      sent.push(n);
    }
    text = text.slice(0, budget).trim();
    if (!text.replace(/\[Page \d+\]/g, "").trim()) return (toast("These pages have no text to read.", { tone: "warn" }), null);
    const cut = !matched && (sent.length < pages.length || text.length >= budget);
    const whole = scope === "all" && !cut && !matched;
    const what = whole ? `all of “${name}”` : `pages ${formatPages(sent)} of “${name}”`;
    return {
      text,
      label: matched
        ? `pages ${formatPages(sent)} of “${name}”, the ones that match your question`
        : blank > 0 ? `${what} (${blank} scanned page${blank > 1 ? "s" : ""} couldn't be read this time)`
        : cut ? `${what} (the rest was too long to send at once)`
        : what,
      footer: whole ? `Source: [${name}](${link()})` : `Source: [${name}, pages ${formatPages(sent)}](${link(sent[0])})`,
      pages: sent,
    };
  };
  /** Send the selection, or some pages, to the AI dock. */
  const runAi = async (tool: PdfAiTool, scope: AiScope) => {
    if (!doc || !askAi) return;
    if (!currentNote) toast("Open a note on the right to keep the answer.", { tone: "warn" });
    const source = await buildSource(scope);
    if (!source) return;
    askAi(tool, source);
    if (scope === "selection") {
      window.getSelection()?.removeAllRanges();
      setSel(null);
    }
  };

  const togglePick = (n: number) =>
    setPicked((cur) => {
      const next = new Set(cur ?? []);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  const startPicking = () => {
    setPicked((cur) => cur ?? new Set([page]));
    setThumbs(true);
  };

  // Offer this PDF to the AI dock, so it can work on it like the AI button here does.
  const latest = useRef({ buildSource, startPicking, picked });
  latest.current = { buildSource, startPicking, picked };
  useEffect(() => {
    if (!registerAiSource || !doc) return;
    registerAiSource({
      name: basename(path),
      defaultScope: sel ? "selection" : "page",
      scopes: [
        { id: "page", label: `This page (${page})` },
        { id: "all", label: `All pages (${doc.numPages})` },
        ...(hits.length > 1 ? [{ id: "hits", label: `Pages with “${hitsFor}” (${hits.length})`, hint: "The pages your search found" }] : []),
        { id: "pick", label: picked?.size ? `Chosen pages (${picked.size})` : "Choose pages…", hint: "Tick pages in the PDF" },
        { id: "selection", label: "Highlighted text", disabled: !sel, hint: sel ? undefined : "Highlight text in the PDF first" },
      ],
      onScope: (scope) => {
        if (scope === "pick" && !latest.current.picked?.size) latest.current.startPicking();
      },
      build: (scope, q, progress) => {
        const l = latest.current;
        // Choosing pages starts with ticking them in the PDF.
        if (scope === "pick" && !l.picked?.size) {
          l.startPicking();
          return Promise.resolve(null);
        }
        return l.buildSource(scope as AiScope, q, progress);
      },
    });
  }, [registerAiSource, doc, path, page, picked, sel, hits, hitsFor]);
  useEffect(() => () => registerAiSource?.(null), [registerAiSource]);

  const docNow = useRef<PdfDoc | null>(null);
  const loadedPath = useRef<string | null>(null);
  /** Told when the file has been read again (after a page was added). */
  const onReload = useRef<(() => void) | null>(null);
  useEffect(() => {
    let alive = true;
    // Reading the same file again (a page was added) keeps the pages on screen meanwhile.
    const fresh = loadedPath.current !== path;
    loadedPath.current = path;
    if (fresh) {
      setDoc(null);
      setError(null);
    }
    void (async () => {
      try {
        const blob = await vault.store.readBinary(path);
        const loaded = await loadPdf(await blob.arrayBuffer());
        if (!alive) return void loaded.destroy();
        if (fresh) {
          // Start at "fit width" when the page is wider than the pane, e.g. on a phone.
          const room = (scroller.current?.clientWidth ?? 0) - 32;
          const { w } = await loaded.pageSize(1);
          if (room > 0 && w > room) setZoom(Math.max(0.3, Math.floor((room / w) * 100) / 100));
          if (!alive) return void loaded.destroy();
        }
        const old = docNow.current;
        docNow.current = loaded;
        setDoc(loaded);
        void old?.destroy();
        onReload.current?.();
      } catch (e) {
        if (alive) setError((e as Error).message || "Couldn't open this PDF.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [vault, path, rev]);
  useEffect(
    () => () => {
      void docNow.current?.destroy();
      docNow.current = null;
      loadedPath.current = null;
    },
    [vault, path],
  );

  useEffect(() => {
    let alive = true;
    setHighlights([]);
    void vault.pdfHighlights(path).then((h) => alive && setHighlights(h)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [vault, path]);

  const saveHighlights = (next: PdfHighlight[]) => {
    setHighlights(next);
    void vault.setPdfHighlights(path, next).catch(() => toast("Couldn't save the highlight. Try again.", { tone: "warn" }));
  };
  const highlight = (color: string) => {
    if (!sel || !sel.rects.length) return;
    const h: PdfHighlight = { id: Math.random().toString(36).slice(2, 10), page: sel.page, rects: sel.rects, text: sel.text, color, created: new Date().toISOString() };
    saveHighlights([...highlights, h]);
    window.getSelection()?.removeAllRanges();
    setSel(null);
  };
  /** A click on highlighted text (with nothing selected) opens that highlight's menu. */
  const onPagesClick = (e: React.MouseEvent) => {
    if (tool || window.getSelection()?.toString().trim()) return;
    const pageEl = (e.target as Element).closest?.<HTMLElement>("[data-page]");
    if (!pageEl) return setActiveHl(null);
    const n = Number(pageEl.dataset.page);
    const box = pageEl.getBoundingClientRect();
    const x = (e.clientX - box.left) / box.width;
    const y = (e.clientY - box.top) / box.height;
    const h = highlights.find((h) => h.page === n && h.rects.some(([l, t, w, hh]) => x >= l && x <= l + w && y >= t && y <= t + hh));
    if (!h) return setActiveHl(null);
    const host = scroller.current!.getBoundingClientRect();
    setActiveHl({ h, x: e.clientX - host.left, y: e.clientY - host.top + scroller.current!.scrollTop });
  };

  const goTo = useCallback((n: number) => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-page="${n}"]`);
    el?.scrollIntoView({ block: "start" });
    setPage(n);
  }, []);

  useEffect(() => {
    if (doc && initialPage) requestAnimationFrame(() => goTo(initialPage));
  }, [doc, initialPage, goTo]);

  /**
   * The current page is the one that fills most of the view; on a tie (two
   * half pages), the one nearer the top. Measured on every scroll, zoom and
   * resize, so it is always the page you are looking at.
   */
  const measure = useRef(0);
  const trackPage = useCallback(() => {
    if (measure.current) return;
    measure.current = requestAnimationFrame(() => {
      measure.current = 0;
      const root = scroller.current;
      if (!root) return;
      const view = root.getBoundingClientRect();
      let best = 0;
      let bestSeen = 0;
      for (const el of root.querySelectorAll<HTMLElement>("[data-page]")) {
        const r = el.getBoundingClientRect();
        if (r.bottom <= view.top) continue;
        if (r.top >= view.bottom) break;
        const seen = Math.min(r.bottom, view.bottom) - Math.max(r.top, view.top);
        if (seen > bestSeen + 1) {
          bestSeen = seen;
          best = Number(el.dataset.page);
        }
      }
      if (best) setPage(best);
    });
  }, []);
  useEffect(() => {
    const root = scroller.current;
    if (!root || !doc) return;
    trackPage();
    const ro = new ResizeObserver(trackPage);
    ro.observe(root);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(measure.current);
      measure.current = 0;
    };
  }, [doc, zoom, trackPage]);

  const onMouseUp = () => {
    if (tool) return;
    const s = window.getSelection();
    const text = s?.toString().replace(/\s+\n/g, "\n").trim() ?? "";
    if (!s || !text) return setSel(null);
    const node = s.anchorNode instanceof Element ? s.anchorNode : s.anchorNode?.parentElement;
    const pageEl = node?.closest<HTMLElement>("[data-page]");
    if (!pageEl) return setSel(null);
    const range = s.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const host = scroller.current!.getBoundingClientRect();
    setActiveHl(null);
    setSel({ text, page: Number(pageEl.dataset.page), x: rect.left - host.left + rect.width / 2, y: rect.top - host.top + scroller.current!.scrollTop, rects: selectionRects(range, pageEl) });
  };

  /** Add an empty page to the end of a blank PDF. Resolves with its number once it's on screen. */
  const addPage = async (): Promise<number | null> => {
    const d = docNow.current;
    if (!d?.blank) return null;
    const n = d.numPages + 1;
    try {
      await vault.replaceBinary(path, new Blob([blankPdf(n) as BlobPart], { type: "application/pdf" }));
    } catch {
      toast("Couldn't add a page. Try again.", { tone: "warn" });
      return null;
    }
    await new Promise<void>((done) => {
      const t = setTimeout(done, 5000);
      onReload.current = () => {
        clearTimeout(t);
        onReload.current = null;
        done();
      };
      setRev((r) => r + 1);
    });
    // Let the new page lay out before anything is written on it.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return docNow.current?.numPages === n ? n : null;
  };

  // ----- the AI at the board -----
  /** Where the AI's writing carries on: the page, how far down, and the figure being drawn. */
  const pen = useRef<{ page: number; y: number; fig: { y0: number; h: number } | null } | null>(null);
  const hurried = useRef(false);
  const pageEl = (n: number) => scroller.current?.querySelector<HTMLElement>(`[data-page="${n}"]`) ?? null;
  /** A page's height in page units (it is 100 wide). */
  const pageUnits = (n: number) => {
    const el = pageEl(n);
    return el && el.offsetWidth ? (el.offsetHeight / el.offsetWidth) * 100 : 141.4;
  };
  /** How far down a page its marks reach, measuring text as it is shown (it wraps). */
  const lowestMark = (n: number) => {
    let low = 0;
    const el = pageEl(n);
    const box = el?.getBoundingClientRect();
    for (const m of marksNow.current) {
      if (m.page !== n) continue;
      const shown = m.kind === "text" && box?.width ? el!.parentElement?.querySelector<HTMLElement>(`.pdf-mark-text[data-mark-id="${m.id}"]`) : null;
      low = Math.max(low, shown ? (shown.getBoundingClientRect().bottom - box!.top) / (box!.width / 100) : markBottom(m));
    }
    return low;
  };
  const wait = (ms: number) => (hurried.current ? Promise.resolve() : new Promise<void>((r) => setTimeout(r, ms)));
  /** Bring a spot on a page into view, so the work can be watched. */
  const follow = (n: number, y: number) => {
    const root = scroller.current;
    const el = pageEl(n);
    if (!root || !el) return;
    const at = el.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop + y * (el.offsetWidth / 100);
    if (at < root.scrollTop + 30 || at > root.scrollTop + root.clientHeight * 0.72) root.scrollTo({ top: Math.max(0, at - root.clientHeight * 0.4), behavior: hurried.current ? "auto" : "smooth" });
  };
  // ----- the tutor's hand: a pen where it writes, a cursor while it moves to the next spot -----
  const hand = useRef<HTMLDivElement>(null);
  const handAt = useRef<{ page: number; x: number; y: number } | null>(null);
  const handIdle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Show the hand at a spot on a page (in page units). */
  const placeHand = (n: number, x: number, y: number, mode: "pen" | "move") => {
    const el = hand.current;
    const root = scroller.current;
    const pg = pageEl(n);
    if (!el || !root || !pg) return;
    const pb = pg.getBoundingClientRect();
    const rb = root.getBoundingClientRect();
    const u = pb.width / 100;
    el.style.transform = `translate(${pb.left - rb.left + root.scrollLeft + x * u}px, ${pb.top - rb.top + root.scrollTop + y * u}px)`;
    el.dataset.mode = mode;
    el.dataset.on = "1";
    handAt.current = { page: n, x, y };
    clearTimeout(handIdle.current);
    handIdle.current = setTimeout(() => {
      delete el.dataset.on;
      handAt.current = null;
    }, 1600);
  };
  /** Glide to where the next thing starts, as a cursor. */
  const moveHand = async (n: number, x: number, y: number) => {
    const el = hand.current;
    if (!el || hurried.current) return;
    const from = handAt.current;
    if (!from) {
      el.style.transition = "none";
      placeHand(n, x, y, "move");
      return wait(140);
    }
    const far = from.page === n ? Math.hypot(x - from.x, y - from.y) : 60;
    if (far < 1.5) return;
    const ms = clamp(far * 9, 160, 460);
    el.style.transition = `transform ${ms}ms ease-in-out`;
    placeHand(n, x, y, "move");
    await wait(ms);
    el.style.transition = "none";
  };
  useEffect(() => () => clearTimeout(handIdle.current), []);
  /** Where typed text has reached, in page units: the end of what is shown so far. */
  const caretOf = (m: PdfMark): [number, number] | null => {
    const pg = pageEl(m.page);
    const shown = pg?.parentElement?.querySelector<HTMLElement>(`.pdf-mark-text[data-mark-id="${m.id}"]`);
    if (!pg || !shown) return null;
    const pb = pg.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(shown);
    const rects = range.getClientRects?.();
    const last = rects && rects.length ? rects[rects.length - 1]! : shown.getBoundingClientRect();
    const u = pb.width / 100;
    if (!u) return null;
    return [((rects && rects.length ? last.right : last.left) - pb.left) / u, (last.bottom - pb.top) / u];
  };
  /** Put a mark on the page the way a hand would: lines drawn along their length, text typed out. */
  const drawLive = async (m: PdfMark) => {
    const setFor = (v: MarkLive | null) =>
      setLive((l) => {
        const next = { ...l };
        if (v) next[m.id] = v;
        else delete next[m.id];
        return next;
      });
    if (m.kind === "text") {
      await primeMarkHtml(m.text, renderText);
      follow(m.page, m.y);
      await moveHand(m.page, m.x, m.y + m.size * 1.1);
      setFor({ typed: 0 });
      commitMarks([...marksNow.current, m], { undo: false });
      follow(m.page, m.y);
      const total = m.text.length;
      const ms = clamp(total * 22, 250, 2200);
      const start = performance.now();
      while (!hurried.current) {
        await new Promise((r) => requestAnimationFrame(r));
        const typed = Math.floor(((performance.now() - start) / ms) * total);
        if (typed >= total) break;
        const caret = caretOf(m);
        if (caret) placeHand(m.page, caret[0], caret[1], "pen");
        setFor({ typed });
      }
      setFor(null);
      // One frame for the finished text (with its formatting) to lay out, so it can be measured.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return;
    }
    const ms = m.kind === "box" ? 260 : clamp(markLength(m) * 14, 260, 1000);
    const route = markRoute(m);
    follow(m.page, markBottom(m));
    await moveHand(m.page, route[0]![0], route[0]![1]);
    setFor({ draw: ms });
    commitMarks([...marksNow.current, m], { undo: false });
    const start = performance.now();
    while (!hurried.current) {
      const f = (performance.now() - start) / ms;
      if (f >= 1) break;
      const [x, y] = pointAlong(route, f);
      placeHand(m.page, x, y, "pen");
      await new Promise((r) => requestAnimationFrame(r));
    }
    const end = route[route.length - 1]!;
    if (!hurried.current) placeHand(m.page, end[0], end[1], "pen");
    setFor(null);
  };
  /** Where the student's own cursor or finger last was on a page, in page units. */
  const pointAt = useRef<{ page: number; x: number; y: number; t: number } | null>(null);
  const pointRest = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** A spot counts once the cursor rests on it (or it is tapped), not while it sweeps across the page on its way elsewhere. */
  const trackPointer = (e: React.PointerEvent) => {
    clearTimeout(pointRest.current);
    const pg = (e.target as Element).closest?.<HTMLElement>("[data-page]");
    if (!pg) return;
    const box = pg.getBoundingClientRect();
    if (!box.width) return;
    const u = box.width / 100;
    const spot = { page: Number(pg.dataset.page), x: (e.clientX - box.left) / u, y: (e.clientY - box.top) / u, t: Date.now() };
    if (e.type === "pointerdown") pointAt.current = spot;
    else pointRest.current = setTimeout(() => (pointAt.current = { ...spot, t: Date.now() }), 280);
  };
  useEffect(() => () => clearTimeout(pointRest.current), []);
  const board: PdfBoard = {
    path,
    name: basename(path),
    blank: !!doc?.blank,
    begin() {
      const d = docNow.current;
      if (!d) return;
      hurried.current = false;
      let p = page;
      // An empty PDF is one long board: carry on after the last thing on it, unless a later page is in view.
      if (d.blank) p = Math.max(p, marksNow.current.reduce((last, m) => Math.max(last, m.page), 1));
      p = clamp(p, 1, d.numPages);
      const low = lowestMark(p);
      pen.current = { page: p, y: low ? low + 2.2 : BOARD_MARGIN, fig: null };
    },
    async describe() {
      const d = docNow.current;
      if (!d) return "";
      if (!pen.current) board.begin();
      const { page: p, y } = pen.current!;
      const high = r1(pageUnits(p));
      const out: string[] = [];
      const on = marksNow.current.filter((m) => m.page === p);
      const texts = on.filter((m) => m.kind === "text").slice(-30);
      const drawn = on.length - on.filter((m) => m.kind === "text").length;
      if (d.blank) {
        out.push(`The board is an empty page, 100 wide and ${high} tall. It is page ${p} of ${d.numPages}; a new page is added when you need one.`);
        out.push(on.length ? `Already on this page (carry on below it, don't write over it):` : "Nothing is on it yet.");
      } else {
        const lines = await d.pageLines(p).catch(() => []);
        out.push(`The board is page ${p} of the printed PDF “${basename(path)}”, 100 wide and ${high} tall. You are writing on top of the print.`);
        if (lines.length) {
          out.push("Its printed lines, each with where it is (x and y are the line's top-left corner):");
          let used = 0;
          for (const l of lines) {
            const row = `[x=${r1(l.x)} y=${r1(l.y)} w=${r1(l.w)} h=${r1(l.h)}] ${l.text}`;
            if ((used += row.length) > 6000) break;
            out.push(row);
          }
        } else out.push("It has no readable text (a scan or a picture).");
        if (on.length) out.push("Already added on top of it:");
      }
      for (const m of texts) if (m.kind === "text") out.push(`text at x=${r1(m.x)} y=${r1(m.y)}: ${m.text.replace(/\s+/g, " ").slice(0, 90)}`);
      if (drawn) out.push(`${drawn} drawn line${drawn > 1 ? "s" : ""} or shape${drawn > 1 ? "s" : ""}.`);
      if (d.blank) out.push(`The next free line is at y=${r1(y)}.`);
      return out.join("\n");
    },
    async apply(op: BoardOp) {
      const d = docNow.current;
      if (!d) return [];
      if (!pen.current) board.begin();
      const at = pen.current!;
      const high = pageUnits(at.page);
      /** Carry on at the top of the next page (only an empty PDF grows). */
      const nextPage = async () => {
        if (!d.blank) return false;
        let n: number | null = at.page + 1;
        if (n > docNow.current!.numPages || marksNow.current.some((m) => m.page === n)) n = await addPage();
        if (!n) return false;
        at.page = n;
        at.y = BOARD_MARGIN;
        at.fig = null;
        goTo(n);
        await wait(250);
        return true;
      };
      const added: string[] = [];
      const put = async (m: PdfMark) => {
        added.push(m.id);
        await drawLive(m);
      };
      // Inside a figure, positions are measured from its top-left corner.
      const dy = at.fig ? at.fig.y0 : 0;
      const X = (x: number) => r1(clamp(x, 0, 100));
      const Y = (y: number) => r1(clamp(y + dy, 0, high));
      const base = { id: newMarkId(), page: at.page, color: boardColor(op.op === "figure" || op.op === "end" || op.op === "page" || op.op === "erase" ? undefined : op.color) };
      /** After something placed freely, the writing carries on below it. */
      const below = (y: number) => {
        if (!at.fig) at.y = Math.max(at.y, y + 1.8);
      };
      switch (op.op) {
        case "write": {
          const text = op.text.trim();
          if (!text) break;
          const size = BOARD_TEXT[op.size ?? "m"];
          const w = 100 - BOARD_MARGIN * 2;
          at.fig = null;
          // About how tall it will be, to start a new page rather than run off this one.
          const rows = Math.max(1, Math.ceil((text.length * size * 0.5) / w));
          if (at.y + rows * size * 1.4 > high - BOARD_MARGIN && at.y > BOARD_MARGIN + 1) await nextPage();
          const m: PdfMark = { ...base, page: at.page, kind: "text", size, x: BOARD_MARGIN, y: r1(at.y), w, text, note: !d.blank || undefined };
          await put(m);
          at.y = Math.max(at.y + size * 1.4, lowestMarkOf(m)) + size * 0.55;
          break;
        }
        case "text": {
          const text = op.text.trim();
          if (!text) break;
          const m: PdfMark = { ...base, kind: "text", size: BOARD_TEXT[op.size ?? "m"], x: X(op.x), y: Y(op.y), text, note: (!d.blank && !at.fig) || undefined };
          await put(m);
          below(lowestMarkOf(m));
          break;
        }
        case "line":
        case "arrow":
          await put({ ...base, kind: op.op, size: PEN_SIZES[1], x1: X(op.x1), y1: Y(op.y1), x2: X(op.x2), y2: Y(op.y2) });
          below(Math.max(op.y1, op.y2) + dy);
          break;
        case "rect":
        case "ellipse":
          await put({ ...base, kind: op.op, size: PEN_SIZES[1], x1: X(op.x), y1: Y(op.y), x2: X(op.x + op.w), y2: Y(op.y + op.h) });
          below(op.y + op.h + dy);
          break;
        case "highlight":
        case "cover":
          await put({ ...base, color: boardColor(op.color, MARK_COLORS[5]!), kind: "box", fill: op.op, size: 0, x1: X(op.x), y1: Y(op.y), x2: X(op.x + op.w), y2: Y(op.y + op.h) });
          break;
        case "draw": {
          if (op.points.length < 2) break;
          // A few points become a smooth curve: fill in between them.
          const points: [number, number][] = [];
          op.points.forEach(([x, y], i) => {
            const prev = op.points[i - 1];
            if (prev) for (let k = 1; k < 4; k++) points.push([X(prev[0] + ((x - prev[0]) * k) / 4), Y(prev[1] + ((y - prev[1]) * k) / 4)]);
            points.push([X(x), Y(y)]);
          });
          await put({ ...base, kind: "stroke", size: PEN_SIZES[1], opacity: 1, points });
          below(Math.max(...op.points.map((pt) => pt[1])) + dy);
          break;
        }
        case "figure": {
          const h = clamp(op.height || 30, 6, high - BOARD_MARGIN * 2);
          if (at.y + h > high - BOARD_MARGIN && at.y > BOARD_MARGIN + 1) await nextPage();
          at.fig = { y0: at.y, h };
          follow(at.page, at.y + h);
          break;
        }
        case "end":
          if (at.fig) at.y = Math.max(at.y, at.fig.y0 + at.fig.h + 2.2);
          at.fig = null;
          break;
        case "page":
          await nextPage();
          break;
        case "erase": {
          const kept = marksNow.current.filter((m) => m.page !== at.page);
          if (kept.length !== marksNow.current.length) commitMarks(kept);
          at.y = BOARD_MARGIN;
          at.fig = null;
          break;
        }
      }
      return added;
    },
    async pointed() {
      const d = docNow.current;
      if (!d) return null;
      const name = basename(path);
      const short = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
      const picked = sel?.text.replace(/\s+/g, " ").trim();
      if (sel && picked) return { at: Date.now(), label: `page ${sel.page}: “${short(picked, 60)}”`, text: `The student selected these words on page ${sel.page} of “${name}”:\n${picked.slice(0, 1200)}` };
      const pt = pointAt.current;
      if (!pt) return null;
      const out = [`The student's cursor is on page ${pt.page} of “${name}”, at x=${r1(pt.x)} y=${r1(pt.y)} (the page is 100 wide).`];
      let label = "";
      const lines = d.blank ? [] : await d.pageLines(pt.page).catch(() => []);
      // How far a line's box is from the cursor (0 when the cursor is on it).
      const off = (l: { x: number; y: number; w: number; h: number }) =>
        Math.max(0, l.y - pt.y, pt.y - (l.y + l.h)) + Math.max(0, l.x - pt.x, pt.x - (l.x + l.w)) * 0.3;
      let at = -1;
      lines.forEach((l, i) => {
        if (l.text.trim() && (at < 0 || off(l) < off(lines[at]!))) at = i;
      });
      const row = (l: { x: number; y: number; w: number; h: number; text: string }) => `[x=${r1(l.x)} y=${r1(l.y)} w=${r1(l.w)} h=${r1(l.h)}] ${l.text}`;
      if (at >= 0 && off(lines[at]!) < 10) {
        out.push(`The printed line under it:\n${row(lines[at]!)}`);
        out.push("That line with the lines around it, in reading order:");
        for (const l of lines.slice(Math.max(0, at - 2), at + 7)) out.push(short(row(l), 220));
        label = lines[at]!.text.trim();
      } else if (!d.blank) out.push("No printed words are under it (a picture, a margin or a gap).");
      const near = marksNow.current
        .filter((m): m is Extract<PdfMark, { kind: "text" }> => m.kind === "text" && m.page === pt.page && Math.abs(m.y - pt.y) < 9)
        .sort((a, b) => Math.abs(a.y - pt.y) - Math.abs(b.y - pt.y))
        .slice(0, 4);
      if (near.length) {
        out.push("Written on the page next to it:");
        for (const m of near) out.push(`text at x=${r1(m.x)} y=${r1(m.y)}: ${short(m.text.replace(/\s+/g, " "), 160)}`);
        label ||= near[0]!.text.replace(/\s+/g, " ");
      }
      return { at: pt.t, label: label ? `page ${pt.page}: “${short(label, 60)}”` : `a spot on page ${pt.page}`, text: out.join("\n").slice(0, 1900) };
    },
    remove(ids) {
      const gone = new Set(ids);
      if (marksNow.current.some((m) => gone.has(m.id))) commitMarks(marksNow.current.filter((m) => !gone.has(m.id)), { undo: false });
      pen.current = null;
    },
    hurry() {
      hurried.current = true;
    },
  };
  /** The bottom of one mark as shown, in page units. */
  function lowestMarkOf(m: PdfMark): number {
    const el = pageEl(m.page);
    const box = el?.getBoundingClientRect();
    const shown = box?.width ? el!.parentElement?.querySelector<HTMLElement>(`.pdf-mark-text[data-mark-id="${m.id}"]`) : null;
    return shown ? (shown.getBoundingClientRect().bottom - box!.top) / (box!.width / 100) : markBottom(m);
  }
  const boardNow = useRef(board);
  boardNow.current = board;
  useEffect(() => {
    if (!registerBoard || !doc) return;
    // One steady handle that always reaches the latest state.
    registerBoard({
      path,
      name: basename(path),
      blank: doc.blank,
      begin: () => boardNow.current.begin(),
      describe: () => boardNow.current.describe(),
      apply: (op) => boardNow.current.apply(op),
      pointed: () => boardNow.current.pointed(),
      remove: (ids) => boardNow.current.remove(ids),
      hurry: () => boardNow.current.hurry(),
    });
    return () => registerBoard(null);
    // Reading the file again (a page was added) keeps the same handle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerBoard, !doc, doc?.blank, path]);

  const quote = () => {
    if (!sel) return;
    if (!currentNote) return toast("Open a note on the right first.", { tone: "warn" });
    insertIntoNote(pdfQuote(sel.text, path, sel.page), { source: path });
    window.getSelection()?.removeAllRanges();
    setSel(null);
    toast(`Quoted page ${sel.page}.`);
  };

  const search = async () => {
    if (!doc || !query.trim()) return setHits([]);
    const found = await doc.search(query);
    setHits(found);
    setHitsFor(query.trim());
    if (found.length) goTo(found[0]!);
    else toast("No matches in this PDF.");
  };

  const scale = zoom * (quality === "low" ? 1 : Math.min(2, window.devicePixelRatio || 1));

  return (
    <div className="ws ws-pdf">
      <div className="ws-toolbar">
        <button className="w-icon-btn" onClick={() => setThumbs((t) => !t)} aria-pressed={thumbs} aria-label="Page thumbnails">▤</button>
        <span className="ws-title" title={path}>{basename(path)}</span>
        <span className="w-muted pdf-page">
          <input
            className="w-input pdf-page-input"
            type="number"
            min={1}
            max={doc?.numPages ?? 1}
            value={page}
            onChange={(e) => goTo(Math.max(1, Math.min(doc?.numPages ?? 1, Number(e.target.value) || 1)))}
            aria-label="Page"
          />
          / {doc?.numPages ?? "…"}
        </span>
        <button className="w-icon-btn" onClick={() => setZoom((z) => Math.max(0.3, +(z - 0.1).toFixed(2)))} aria-label="Zoom out">−</button>
        <span className="w-muted">{Math.round(zoom * 100)}%</span>
        <button className="w-icon-btn" onClick={() => setZoom((z) => Math.min(3, +(z + 0.1).toFixed(2)))} aria-label="Zoom in">+</button>
        <button
          className="w-icon-btn pdf-draw-toggle"
          disabled={!doc}
          aria-pressed={!!tool}
          aria-label="Draw on the PDF"
          title="Draw, add shapes and type on the PDF"
          onClick={() => {
            setSel(null);
            setActiveHl(null);
            setSelected(null);
            setTool((t) => (t ? null : "pen"));
          }}
        >
          <Icon name="pencil" size={17} />
        </button>
        {openAi && (
          <button
            className="w-btn w-btn-small pdf-ai"
            disabled={!doc}
            title="Open the AI panel on this PDF"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => openAi(sel ? "selection" : "page")}
          >
            <Icon name="sparkle" size={14} /> AI
          </button>
        )}
        <form className="pdf-search" onSubmit={(e) => { e.preventDefault(); void search(); }}>
          <input className="w-input" placeholder="Search PDF" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search in PDF" />
          {hits.length > 0 && (
            <button type="button" className="w-btn w-btn-small" onClick={() => goTo(hits[(hits.indexOf(page) + 1) % hits.length] ?? hits[0]!)}>
              Next ({hits.length})
            </button>
          )}
        </form>
      </div>
      {tool && (
        <MarkToolbar
          tool={tool}
          onTool={(t) => { setTool(t); if (t !== "select") setSelected(null); }}
          color={color}
          onColor={(c) => {
            setColor(c);
            // Recolour what's picked.
            const m = selected ? marksNow.current.find((x) => x.id === selected) : undefined;
            if (m && m.color !== c) commitMarks(marksNow.current.map((x) => (x.id === m.id ? { ...x, color: c } : x)));
          }}
          sizeIndex={sizeIndex}
          onSize={setSizeIndex}
          canUndo={undoable > 0}
          onUndo={undoMark}
          canDelete={!!selected}
          onDelete={() => selected && removeMark(selected)}
          onDone={() => { setTool(null); setSelected(null); }}
        />
      )}
      <div className="pdf-body">
        {thumbs && doc && (
          <nav className="pdf-thumbs" aria-label="Pages">
            {Array.from({ length: doc.numPages }, (_, i) => (
              <button
                key={i}
                className={`pdf-thumb${page === i + 1 ? " active" : ""}${picked?.has(i + 1) ? " picked" : ""}`}
                aria-pressed={picked ? picked.has(i + 1) : undefined}
                onClick={() => (picked ? togglePick(i + 1) : goTo(i + 1))}
              >
                <PdfPage doc={doc} n={i + 1} scale={0.18} textLayer={false} />
                <span>{picked && <span className="pdf-thumb-check" aria-hidden>{picked.has(i + 1) ? "✓" : ""}</span>}{i + 1}</span>
              </button>
            ))}
          </nav>
        )}
        <div className="ws-scroll pdf-pages" ref={scroller} onMouseUp={onMouseUp} onClick={onPagesClick} onPointerMove={trackPointer} onPointerDown={trackPointer} onPointerLeave={() => clearTimeout(pointRest.current)} onScroll={() => { trackPage(); if (sel) setSel(null); if (activeHl) setActiveHl(null); }}>
          {error && <p className="ws-empty">{error}</p>}
          {!doc && !error && <p className="ws-empty w-muted">Opening PDF…</p>}
          {doc && Array.from({ length: doc.numPages }, (_, i) => (
            <PdfPage key={i} doc={doc} n={i + 1} scale={scale} cssZoom={zoom} textLayer highlights={highlights} marks={marks} markLayer={markLayer} pick={picked ? { checked: picked.has(i + 1), onToggle: () => togglePick(i + 1) } : undefined} />
          ))}
          <div className="pdf-hand" ref={hand} aria-hidden>
            <svg className="pdf-hand-pen" viewBox="0 0 24 24" width="26" height="26"><path d="M3 21l1.2-4.6L16.6 4a2 2 0 0 1 2.8 0l.6.6a2 2 0 0 1 0 2.8L7.6 19.8z" /><path d="M14.5 6.1l3.4 3.4" /></svg>
            <svg className="pdf-hand-cursor" viewBox="0 0 24 24" width="22" height="22"><path d="M4 3l15 8-6.5 1.8L10 19.5z" /></svg>
          </div>
          {doc?.blank && (
            <button className="w-btn w-btn-small pdf-add-page" onClick={() => void addPage().then((n) => n && requestAnimationFrame(() => goTo(n)))}>
              <Icon name="plus" size={14} /> Add a page
            </button>
          )}
          {activeHl && (
            <div className="pdf-quote-btn" style={{ left: activeHl.x, top: activeHl.y - 48 }} onMouseDown={(e) => e.preventDefault()} onClick={(e) => e.stopPropagation()}>
              {PDF_HL_COLORS.map((c) => (
                <button key={c.id} className="pdf-hl-swatch" style={{ background: c.css }} aria-label={`${c.label} highlight`} aria-pressed={activeHl.h.color === c.id} onClick={() => { saveHighlights(highlights.map((h) => (h.id === activeHl.h.id ? { ...h, color: c.id } : h))); setActiveHl(null); }} />
              ))}
              <button
                className="w-btn w-btn-small"
                onClick={() => {
                  if (!currentNote) return toast("Open a note on the right first.", { tone: "warn" });
                  insertIntoNote(pdfQuote(activeHl.h.text, path, activeHl.h.page), { source: path });
                  toast(`Quoted page ${activeHl.h.page}.`);
                  setActiveHl(null);
                }}
              >
                Quote in note
              </button>
              <button className="w-btn w-btn-small" onClick={() => { saveHighlights(highlights.filter((h) => h.id !== activeHl.h.id)); setActiveHl(null); }}>Remove</button>
            </div>
          )}
          {sel && (
            <div className="pdf-quote-btn" style={{ left: sel.x, top: sel.y - 40 }} onMouseDown={(e) => e.preventDefault()}>
              {sel.rects.length > 0 && PDF_HL_COLORS.map((c) => (
                <button key={c.id} className="pdf-hl-swatch" style={{ background: c.css }} title={`Highlight ${c.label.toLowerCase()}`} aria-label={`Highlight ${c.label.toLowerCase()}`} onClick={() => highlight(c.id)} />
              ))}
              <button className="w-btn w-btn-primary w-btn-small" onClick={quote}>Quote in note</button>
              {askAi && <button className="w-btn w-btn-small" onClick={() => void runAi("explain", "selection")}>Explain</button>}
              {askAi && <button className="w-btn w-btn-small" onClick={() => void runAi("flashcards", "selection")}>Flashcards</button>}
              {openAi && <button className="w-btn w-btn-small" onClick={() => openAi("selection")}>More AI…</button>}
            </div>
          )}
        </div>
      </div>
      {picked && askAi && (
        <div className="pdf-pick-bar" role="toolbar" aria-label="Send chosen pages to AI">
          <span className="pdf-pick-count">
            {picked.size ? <><b>{picked.size}</b> page{picked.size === 1 ? "" : "s"}: {formatPages([...picked].sort((a, b) => a - b))}</> : "Tick the pages you want"}
          </span>
          <button className="w-btn w-btn-ghost w-btn-small" onClick={() => setPicked(new Set(Array.from({ length: doc?.numPages ?? 0 }, (_, i) => i + 1)))}>All</button>
          <button className="w-btn w-btn-ghost w-btn-small" onClick={() => setPicked(new Set())}>Clear</button>
          <span className="pdf-pick-tools">
            {AI_TOOLS.map((t) => (
              <button key={t.id} className="w-btn w-btn-small" disabled={!picked.size} onClick={() => void runAi(t.id, "pick")}>{t.label}</button>
            ))}
          </span>
          <button className="w-icon-btn" aria-label="Stop choosing pages" title="Done" onClick={() => setPicked(null)}>
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

/** One page: placeholder until near the viewport, then canvas + selectable text layer. */
function PdfPage({ doc, n, scale, cssZoom = scale, textLayer, pick, highlights, marks, markLayer }: {
  doc: PdfDoc;
  n: number;
  scale: number;
  cssZoom?: number;
  textLayer: boolean;
  highlights?: PdfHighlight[];
  /** Everything drawn or typed on the PDF, and the tools to add more. */
  marks?: PdfMark[];
  markLayer?: MarkLayerProps;
  /** Shows a checkbox for choosing this page. */
  pick?: { checked: boolean; onToggle: () => void };
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    void doc.pageSize(n).then(setSize);
  }, [doc, n]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && setVisible(true), { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !ref.current) return;
    const cancel = doc.render(n, ref.current, { scale, cssScale: cssZoom, textLayer });
    return cancel;
  }, [visible, doc, n, scale, cssZoom, textLayer]);

  const w = size ? size.w * cssZoom : 600 * cssZoom;
  const h = size ? size.h * cssZoom : 800 * cssZoom;
  const box = <div ref={ref} className="pdf-page-box" data-page={textLayer ? n : undefined} style={{ width: w, height: h }} aria-label={`Page ${n}`} />;
  if (!textLayer) return box;
  return (
    <div className={`pdf-page-wrap${pick?.checked ? " picked" : ""}`}>
      {box}
      <div className="pdf-hl-layer" aria-hidden>
        {highlights?.filter((h) => h.page === n).flatMap((h) =>
          h.rects.map(([l, t, w, hh], k) => (
            <span key={`${h.id}-${k}`} style={{ left: `${l * 100}%`, top: `${t * 100}%`, width: `${w * 100}%`, height: `${hh * 100}%`, background: hlCss(h.color) }} />
          )),
        )}
      </div>
      {markLayer && <MarkLayer {...markLayer} page={n} width={w} height={h} marks={(marks ?? []).filter((m) => m.page === n)} />}
      {pick && (
        <label className="pdf-page-check">
          <input type="checkbox" checked={pick.checked} onChange={pick.onToggle} />
          <span>Page {n}</span>
        </label>
      )}
    </div>
  );
}
