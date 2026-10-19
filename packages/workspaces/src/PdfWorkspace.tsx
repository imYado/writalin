import { useCallback, useEffect, useRef, useState } from "react";
import type { VaultPath } from "@writalin/shared";
import { basename } from "@writalin/shared";
import { pdfQuote } from "@writalin/vault";
import { Icon, toast } from "@writalin/ui";
import type { WorkspaceProps } from "./types";
import { loadPdf, type PdfDoc } from "./pdf";

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
type AiScope = "page" | "all" | "pick" | "selection";

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

export function PdfWorkspace({ vault, path, page: initialPage, insertIntoNote, quality, currentNote, askAi }: Props) {
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [page, setPage] = useState(initialPage ?? 1);
  const [thumbs, setThumbs] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<number[]>([]);
  const [sel, setSel] = useState<{ text: string; page: number; x: number; y: number } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiScope, setAiScope] = useState<AiScope>("page");
  /** Pages ticked in "Choose pages" mode; null when not choosing. */
  const [picked, setPicked] = useState<Set<number> | null>(null);
  const aiMenu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aiOpen) return;
    const onDown = (e: PointerEvent) => { if (!aiMenu.current?.contains(e.target as Node)) setAiOpen(false); };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [aiOpen]);

  const link = (p?: number) => `${path.replace(/ /g, "%20")}${p ? `#page=${p}` : ""}`;
  /** Send the selection, or some pages, to the AI dock with a link back to the source. */
  const runAi = async (tool: PdfAiTool, scope: AiScope) => {
    if (!doc || !askAi) return;
    setAiOpen(false);
    if (!currentNote) toast("Open a note on the right to keep the answer.", { tone: "warn" });
    const name = basename(path);
    if (scope === "selection") {
      if (!sel) return toast("Highlight some text in the PDF first.", { tone: "warn" });
      askAi(tool, { text: sel.text, label: `your highlighted text on page ${sel.page} of “${name}”`, footer: `[source p.${sel.page}](${link(sel.page)})` });
      window.getSelection()?.removeAllRanges();
      return setSel(null);
    }
    const pages =
      scope === "page" ? [page]
      : scope === "all" ? Array.from({ length: doc.numPages }, (_, i) => i + 1)
      : [...(picked ?? [])].sort((a, b) => a - b);
    if (!pages.length) return toast("Tick the pages you want first.", { tone: "warn" });
    if (pages.length === 1) {
      const n = pages[0]!;
      const text = await doc.pageText(n);
      if (!text.trim()) return toast("This page has no text to read. It may be a scanned image.", { tone: "warn" });
      return askAi(tool, { text, label: `page ${n} of “${name}”`, footer: `[source p.${n}](${link(n)})` });
    }
    let text = "";
    const sent: number[] = [];
    for (const n of pages) {
      if (text.length >= MAX_AI_CHARS) break;
      text += `\n\n[Page ${n}]\n${await doc.pageText(n)}`;
      sent.push(n);
    }
    text = text.slice(0, MAX_AI_CHARS).trim();
    if (!text.replace(/\[Page \d+\]/g, "").trim()) return toast("These pages have no text to read. They may be scanned images.", { tone: "warn" });
    const cut = sent.length < pages.length || text.length >= MAX_AI_CHARS;
    const whole = scope === "all" && !cut;
    const what = whole ? `all of “${name}”` : `pages ${formatPages(sent)} of “${name}”`;
    askAi(tool, {
      text,
      label: cut ? `${what} (the rest was too long to send at once)` : what,
      footer: whole ? `Source: [${name}](${link()})` : `Source: [${name}, pages ${formatPages(sent)}](${link(sent[0])})`,
    });
  };

  const togglePick = (n: number) =>
    setPicked((cur) => {
      const next = new Set(cur ?? []);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  const startPicking = () => {
    setAiScope("pick");
    setAiOpen(false);
    setPicked((cur) => cur ?? new Set([page]));
    setThumbs(true);
  };

  useEffect(() => {
    let alive = true;
    let loaded: PdfDoc | null = null;
    setDoc(null);
    setError(null);
    void (async () => {
      try {
        const blob = await vault.store.readBinary(path);
        loaded = await loadPdf(await blob.arrayBuffer());
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
    const rect = s.getRangeAt(0).getBoundingClientRect();
    const host = scroller.current!.getBoundingClientRect();
    setSel({ text, page: Number(pageEl.dataset.page), x: rect.left - host.left + rect.width / 2, y: rect.top - host.top + scroller.current!.scrollTop });
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
        <button className="w-icon-btn" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(2)))} aria-label="Zoom out">−</button>
        <span className="w-muted">{Math.round(zoom * 100)}%</span>
        <button className="w-icon-btn" onClick={() => setZoom((z) => Math.min(3, +(z + 0.1).toFixed(2)))} aria-label="Zoom in">+</button>
        {askAi && (
          <div className="pdf-ai" ref={aiMenu}>
            <button
              className="w-btn w-btn-small"
              aria-expanded={aiOpen}
              disabled={!doc}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (!aiOpen && aiScope === "selection" && !sel) setAiScope("page");
                setAiOpen((o) => !o);
              }}
            >
              <Icon name="sparkle" size={14} /> AI
            </button>
            {aiOpen && (
              <div className="w-popover pdf-ai-menu" role="menu">
                <div className="pdf-ai-scope" role="group" aria-label="What to send">
                  <button className="w-chip" aria-pressed={aiScope === "page"} onClick={() => setAiScope("page")}>This page ({page})</button>
                  <button className="w-chip" aria-pressed={aiScope === "all"} onClick={() => setAiScope("all")}>All pages</button>
                  <button className="w-chip" aria-pressed={aiScope === "pick"} onClick={startPicking}>
                    {picked?.size ? `Chosen pages (${picked.size})` : "Choose pages…"}
                  </button>
                  <button className="w-chip" aria-pressed={aiScope === "selection"} disabled={!sel} title={sel ? undefined : "Highlight text in the PDF first"} onClick={() => setAiScope("selection")}>
                    Highlighted text
                  </button>
                </div>
                {AI_TOOLS.map((t) => (
                  <button key={t.id} className="w-action" role="menuitem" onClick={() => void runAi(t.id, aiScope)}>
                    <span className="w-action-label">{t.label}</span>
                  </button>
                ))}
                <p className="w-muted w-small">The answer opens in the AI panel, ready to add to your note with a link back here.</p>
              </div>
            )}
          </div>
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
        <div className="ws-scroll pdf-pages" ref={scroller} onMouseUp={onMouseUp} onScroll={() => sel && setSel(null)}>
          {error && <p className="ws-empty">{error}</p>}
          {!doc && !error && <p className="ws-empty w-muted">Opening PDF…</p>}
          {doc && Array.from({ length: doc.numPages }, (_, i) => (
            <PdfPage key={i} doc={doc} n={i + 1} scale={scale} cssZoom={zoom} textLayer pick={picked ? { checked: picked.has(i + 1), onToggle: () => togglePick(i + 1) } : undefined} />
          ))}
          {sel && (
            <div className="pdf-quote-btn" style={{ left: sel.x, top: sel.y - 40 }} onMouseDown={(e) => e.preventDefault()}>
              <button className="w-btn w-btn-primary w-btn-small" onClick={quote}>Quote in note</button>
              {askAi && <button className="w-btn w-btn-small" onClick={() => void runAi("explain", "selection")}>Explain</button>}
              {askAi && <button className="w-btn w-btn-small" onClick={() => void runAi("flashcards", "selection")}>Flashcards</button>}
              {askAi && <button className="w-btn w-btn-small" onClick={() => { setAiScope("selection"); setAiOpen(true); }}>More AI…</button>}
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
          <button className="w-icon-btn" aria-label="Stop choosing pages" title="Done" onClick={() => { setPicked(null); setAiScope("page"); }}>
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

/** One page: placeholder until near the viewport, then canvas + selectable text layer. */
function PdfPage({ doc, n, scale, cssZoom = scale, textLayer, pick }: {
  doc: PdfDoc;
  n: number;
  scale: number;
  cssZoom?: number;
  textLayer: boolean;
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
      {pick && (
        <label className="pdf-page-check">
          <input type="checkbox" checked={pick.checked} onChange={pick.onToggle} />
          <span>Page {n}</span>
        </label>
      )}
    </div>
  );
}
