import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface PdfDoc {
  numPages: number;
  pageSize(n: number): Promise<{ w: number; h: number }>;
  /** Render page `n` into `el`. Returns a cancel function. */
  render(n: number, el: HTMLElement, opts: { scale: number; cssScale: number; textLayer: boolean }): () => void;
  /** Pages (1-based) whose text contains the query. Text extraction runs in PDF.js's worker. */
  search(query: string): Promise<number[]>;
  pageText(n: number): Promise<string>;
  destroy(): Promise<void>;
}

export async function loadPdf(data: ArrayBuffer): Promise<PdfDoc> {
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
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
  return {
    numPages: pdf.numPages,
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
    destroy: () => pdf.destroy(),
  };
}
