import { useCallback, useEffect, useRef, useState } from "react";
import type { VaultPath } from "@writalin/shared";
import { basename } from "@writalin/shared";
import { pdfQuote, type PdfHighlight } from "@writalin/vault";
import { Icon, toast } from "@writalin/ui";
import type { AiSourceText, WorkspaceProps } from "./types";
import { loadPdf, type PdfDoc } from "./pdf";
import { pickRelevant } from "./relevance";

interface Props extends WorkspaceProps {
  path: VaultPath;
  /** 1-based page to open at (from a `#page=N` link). */
  page?: number;
}

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

export function PdfWorkspace({ vault, path, page: initialPage, insertIntoNote, quality, currentNote, askAi, registerAiSource, openAi }: Props) {
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

  useEffect(() => {
    let alive = true;
    let loaded: PdfDoc | null = null;
    setDoc(null);
    setError(null);
    void (async () => {
      try {
        const blob = await vault.store.readBinary(path);
        loaded = await loadPdf(await blob.arrayBuffer());
        if (!alive) return void loaded.destroy();
        // Start at "fit width" when the page is wider than the pane, e.g. on a phone.
        const room = (scroller.current?.clientWidth ?? 0) - 32;
        const { w } = await loaded.pageSize(1);
        if (room > 0 && w > room) setZoom(Math.max(0.3, Math.floor((room / w) * 100) / 100));
        if (alive) setDoc(loaded);
        else void loaded.destroy();
      } catch (e) {
        if (alive) setError((e as Error).message || "Couldn't open this PDF.");
      }
    })();
    return () => {
      alive = false;
      void loaded?.destroy();
    };
  }, [vault, path]);

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
    if (window.getSelection()?.toString().trim()) return;
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

  // Track the current page while scrolling.
  useEffect(() => {
    const root = scroller.current;
    if (!root || !doc) return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setPage(Number((visible.target as HTMLElement).dataset.page));
      },
      { root, threshold: [0.25, 0.6] },
    );
    root.querySelectorAll("[data-page]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [doc, zoom]);

  const onMouseUp = () => {
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
        <div className="ws-scroll pdf-pages" ref={scroller} onMouseUp={onMouseUp} onClick={onPagesClick} onScroll={() => { if (sel) setSel(null); if (activeHl) setActiveHl(null); }}>
          {error && <p className="ws-empty">{error}</p>}
          {!doc && !error && <p className="ws-empty w-muted">Opening PDF…</p>}
          {doc && Array.from({ length: doc.numPages }, (_, i) => (
            <PdfPage key={i} doc={doc} n={i + 1} scale={scale} cssZoom={zoom} textLayer highlights={highlights} pick={picked ? { checked: picked.has(i + 1), onToggle: () => togglePick(i + 1) } : undefined} />
          ))}
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
function PdfPage({ doc, n, scale, cssZoom = scale, textLayer, pick, highlights }: {
  doc: PdfDoc;
  n: number;
  scale: number;
  cssZoom?: number;
  textLayer: boolean;
  highlights?: PdfHighlight[];
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
      {pick && (
        <label className="pdf-page-check">
          <input type="checkbox" checked={pick.checked} onChange={pick.onToggle} />
          <span>Page {n}</span>
        </label>
      )}
    </div>
  );
}
