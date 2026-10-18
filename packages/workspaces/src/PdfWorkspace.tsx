import { useCallback, useEffect, useRef, useState } from "react";
import type { VaultPath } from "@writalin/shared";
import { basename } from "@writalin/shared";
import { pdfQuote } from "@writalin/vault";
import { toast } from "@writalin/ui";
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
export function PdfWorkspace({ vault, path, page: initialPage, insertIntoNote, quality, currentNote }: Props) {
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [page, setPage] = useState(initialPage ?? 1);
  const [thumbs, setThumbs] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<number[]>([]);
  const [sel, setSel] = useState<{ text: string; page: number; x: number; y: number } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

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
              <button key={i} className={`pdf-thumb${page === i + 1 ? " active" : ""}`} onClick={() => goTo(i + 1)}>
                <PdfPage doc={doc} n={i + 1} scale={0.18} textLayer={false} />
                <span>{i + 1}</span>
              </button>
            ))}
          </nav>
        )}
        <div className="ws-scroll pdf-pages" ref={scroller} onMouseUp={onMouseUp} onScroll={() => sel && setSel(null)}>
          {error && <p className="ws-empty">{error}</p>}
          {!doc && !error && <p className="ws-empty w-muted">Opening PDF…</p>}
          {doc && Array.from({ length: doc.numPages }, (_, i) => <PdfPage key={i} doc={doc} n={i + 1} scale={scale} cssZoom={zoom} textLayer />)}
          {sel && (
            <button className="w-btn w-btn-primary w-btn-small pdf-quote-btn" style={{ left: sel.x, top: sel.y - 40 }} onMouseDown={(e) => e.preventDefault()} onClick={quote}>
              Quote in note
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** One page: placeholder until near the viewport, then canvas + selectable text layer. */
function PdfPage({ doc, n, scale, cssZoom = scale, textLayer }: { doc: PdfDoc; n: number; scale: number; cssZoom?: number; textLayer: boolean }) {
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
  return <div ref={ref} className="pdf-page-box" data-page={textLayer ? n : undefined} style={{ width: w, height: h }} aria-label={`Page ${n}`} />;
}
