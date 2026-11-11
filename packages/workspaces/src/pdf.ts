// The legacy build carries polyfills (e.g. Map.getOrInsertComputed) that
// Safari and older Chrome or Firefox lack; without them pages render blank.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
import { BLANK_PDF_PRODUCER } from "./pdfBlank";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** One printed line of a page, in page units (the page is 100 wide; `y` is the line's top). */
export interface PdfLine {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PdfDoc {
  numPages: number;
  /** An empty PDF made by Writalin: pages can be added to it. */
  blank: boolean;
  /** The printed lines of page `n` with where they are, so the AI can point at them. */
  pageLines(n: number): Promise<PdfLine[]>;
  pageSize(n: number): Promise<{ w: number; h: number }>;
  /** Render page `n` into `el`. Returns a cancel function. */
  render(n: number, el: HTMLElement, opts: { scale: number; cssScale: number; textLayer: boolean }): () => void;
  /** Pages (1-based) whose text contains the query. Text extraction runs in PDF.js's worker. */
  search(query: string): Promise<number[]>;
  pageText(n: number): Promise<string>;
  /**
   * Read a scanned page (one with no text in it) with text recognition. The
   * reader (~10 MB, English) loads the first time; afterwards the page's text
   * is kept, so search and AI find it too.
   */
  ocrPage(n: number): Promise<string>;
  destroy(): Promise<void>;
}

/** Whether this browser's WebAssembly has SIMD, which makes text recognition about twice as fast. */
const wasmSimd = () => {
  try {
    return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  } catch {
    return false;
  }
};

export async function loadPdf(data: ArrayBuffer): Promise<PdfDoc> {
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const info = await pdf.getMetadata().then((m) => m.info as { Producer?: string } | undefined, () => undefined);
  const pageLines = async (n: number): Promise<PdfLine[]> => {
    const page = await pdf.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const u = 100 / vp.width;
    const content = await page.getTextContent();
    const lines: PdfLine[] = [];
    for (const it of content.items) {
      if (!("str" in it) || !it.str.trim()) continue;
      // The item's baseline start, moved into the page's top-left coordinates.
      const [x, base] = vp.convertToViewportPoint(it.transform[4] as number, it.transform[5] as number) as [number, number];
      const h = (it.height || Math.abs(it.transform[3] as number) || 10) * u;
      const piece = { text: it.str, x: x * u, y: base * u - h, w: it.width * u, h };
      const last = lines[lines.length - 1];
      // Pieces on the same baseline, left to right, are one line.
      if (last && Math.abs(last.y + last.h - (piece.y + piece.h)) < Math.max(last.h, h) * 0.5 && piece.x >= last.x) {
        const gap = piece.x - (last.x + last.w);
        last.text += (gap > h * 0.2 && !last.text.endsWith(" ") ? " " : "") + piece.text;
        last.w = Math.max(last.w, piece.x + piece.w - last.x);
        last.y = Math.min(last.y, piece.y);
        last.h = Math.max(last.h, h);
      } else lines.push(piece);
    }
    return lines.map((l) => ({ ...l, text: l.text.replace(/\s+/g, " ").trim() })).filter((l) => l.text);
  };
  const textCache = new Map<number, string>();
  const pageText = async (n: number) => {
    let t = textCache.get(n);
    if (t == null) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      t = content.items.map((i) => ("str" in i ? i.str : "")).join(" ");
      textCache.set(n, t);
    }
    return t;
  };
  const ocrTried = new Set<number>();
  let ocr: Promise<import("tesseract.js").Worker> | null = null;
  const ocrPage = async (n: number) => {
    const known = await pageText(n);
    if (known.trim() || ocrTried.has(n)) return known;
    ocr ??= import("tesseract.js")
      .then((t) =>
        // Served from this site (see the web app's Vite config), not a CDN.
        t.createWorker("eng", t.OEM.LSTM_ONLY, {
          workerPath: "/ocr/worker.min.js",
          corePath: wasmSimd() ? "/ocr/core-simd-lstm.wasm.js" : "/ocr/core-lstm.wasm.js",
          langPath: "/ocr",
        }),
      )
      .catch((e: unknown) => {
        ocr = null;
        throw e;
      });
    const worker = await ocr;
    const page = await pdf.getPage(n);
    // About 200 dpi: sharp enough to read small print, small enough to stay quick.
    const vp = page.getViewport({ scale: Math.min(3, 1700 / page.getViewport({ scale: 1 }).width) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport: vp }).promise;
    const { data } = await worker.recognize(canvas);
    const text = data.text.replace(/\s+/g, " ").trim();
    textCache.set(n, text);
    ocrTried.add(n);
    return text;
  };
  return {
    numPages: pdf.numPages,
    blank: info?.Producer === BLANK_PDF_PRODUCER,
    pageLines,
    async pageSize(n) {
      const page = await pdf.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      return { w: vp.width, h: vp.height };
    },
    render(n, el, { scale, cssScale, textLayer }) {
      let cancelled = false;
      let task: { cancel(): void } | null = null;
      void (async () => {
        const page = await pdf.getPage(n);
        if (cancelled) return;
        const cssVp = page.getViewport({ scale: cssScale });
        const vp = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        canvas.style.width = `${cssVp.width}px`;
        canvas.style.height = `${cssVp.height}px`;
        const render = page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport: vp });
        task = render;
        try {
          await render.promise;
        } catch {
          return;
        }
        if (cancelled) return;
        el.replaceChildren(canvas);
        if (textLayer) {
          const layer = document.createElement("div");
          layer.className = "textLayer";
          el.style.setProperty("--scale-factor", String(cssScale));
          el.style.setProperty("--total-scale-factor", String(cssScale));
          el.append(layer);
          const tl = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: layer, viewport: cssVp });
          await tl.render().catch(() => {});
        }
      })();
      return () => {
        cancelled = true;
        task?.cancel();
      };
    },
    async search(query) {
      const q = query.toLowerCase();
      const out: number[] = [];
      for (let n = 1; n <= pdf.numPages; n++) if ((await pageText(n)).toLowerCase().includes(q)) out.push(n);
      return out;
    },
    pageText,
    ocrPage,
    async destroy() {
      if (ocr) void ocr.then((w) => w.terminate()).catch(() => {});
      await pdf.destroy();
    },
  };
}
