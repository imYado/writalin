import { marked } from "marked";
import { escapeHtml, noteName, extname } from "@writalin/shared";
import { exportZip, splitFrontmatter, type Vault } from "@writalin/vault";

/** A4 with 20mm margins: the same printable width the editor uses. */
export const PRINT_CSS = `
@page { size: A4; margin: 20mm; }
* { box-sizing: border-box; }
body { font: 11.5pt/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #1f2328; margin: 0; }
main { max-width: 170mm; margin: 0 auto; }
h1, h2, h3, h4 { color: #111418; line-height: 1.3; break-after: avoid; }
h1.title { font-size: 22pt; margin: 0 0 12pt; }
img, svg, table, figure, pre, .callout { break-inside: avoid; }
img { max-width: 100%; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid #d0d0c8; padding: 4pt 6pt; text-align: left; }
blockquote { margin: 0 0 10pt; padding-left: 10pt; border-left: 3px solid #c8c8c0; }
.callout { border-left: 3px solid #3b5bdb; background: #eef2ff; padding: 6pt 10pt; margin: 0 0 10pt; }
.callout-title { font-weight: 600; }
code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 0.9em; background: #f2f2ee; padding: 0 3pt; border-radius: 3pt; }
pre { background: #f2f2ee; padding: 8pt; border-radius: 4pt; overflow: hidden; white-space: pre-wrap; }
pre code { background: none; padding: 0; }
mark { background: #fff3a3; }
.tag { color: #0b6e69; }
a { color: #2f4fc7; }
ul.contains-task-list { list-style: none; padding-left: 1.2em; }
`;

async function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((res) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.readAsDataURL(blob);
  });
}

/** Turn Obsidian-flavoured Markdown into standalone HTML (images inlined). */
export async function noteToHtml(vault: Vault, path: string, text: string, opts: { inlineImages?: boolean } = {}): Promise<string> {
  let body = splitFrontmatter(text).body;
  const embeds = new Map<string, string>();
  for (const m of body.matchAll(/!\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) {
    const target = m[1]!.trim();
    const p = vault.files.has(target) ? target : vault.resolve(target, path);
    if (p && /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(p) && opts.inlineImages !== false) {
      embeds.set(m[0], `<img src="${await toDataUrl(await vault.store.readBinary(p))}" alt="${escapeHtml(noteName(p))}">`);
    } else embeds.set(m[0], `<em>${escapeHtml(target)}</em>`);
  }
  for (const [k, v] of embeds) body = body.split(k).join(v);
  body = body
    .replace(/\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g, (_, t: string, _h, alias?: string) => `<span class="wikilink">${escapeHtml(alias ?? t)}</span>`)
    .replace(/==([^=\n]+)==/g, "<mark>$1</mark>")
    .replace(/(^|\s)#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu, '$1<span class="tag">#$2</span>');
  let html = await marked.parse(body, { gfm: true, breaks: false });
  // Callouts: <blockquote><p>[!note] Title ...
  html = html.replace(/<blockquote>\s*<p>\[!([\w-]+)\][+-]?\s*([^\n<]*)/g, (_, kind: string, title: string) =>
    `<blockquote class="callout callout-${kind.toLowerCase()}"><p><span class="callout-title">${title || kind[0]!.toUpperCase() + kind.slice(1)}</span><br>`,
  );
  // Relative image links (standard markdown) inline too.
  const imgs = [...html.matchAll(/<img src="(?!data:|https?:)([^"]+)"/g)];
  for (const m of imgs) {
    const p = decodeURIComponent(m[1]!);
    if (vault.files.has(p)) html = html.replace(m[0], `<img src="${await toDataUrl(await vault.store.readBinary(p))}"`);
  }
  return html;
}

export function wrapHtml(title: string, inner: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${PRINT_CSS}</style></head><body><main><h1 class="title">${escapeHtml(title)}</h1>${inner}</main></body></html>`;
}

export function download(name: string, data: Blob | string, type = "text/plain"): void {
  const blob = typeof data === "string" ? new Blob([data], { type }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function exportNote(vault: Vault, path: string, format: "md" | "html" | "pdf"): Promise<void> {
  const { text } = await vault.read(path);
  const name = noteName(path);
  if (format === "md") return download(`${name}.md`, text, "text/markdown");
  const html = wrapHtml(name, await noteToHtml(vault, path, text));
  if (format === "html") return download(`${name}.html`, html, "text/html");
  // PDF: print the same A4 layout; the browser's "Save as PDF" writes the file.
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;width:0;height:0;border:0;right:0;bottom:0";
  document.body.append(frame);
  frame.srcdoc = html;
  await new Promise((r) => (frame.onload = r));
  await Promise.all([...frame.contentDocument!.images].map((img) => (img.complete ? null : new Promise((r) => (img.onload = img.onerror = r)))));
  frame.contentWindow!.focus();
  frame.contentWindow!.print();
  setTimeout(() => frame.remove(), 60_000);
}

export async function exportVaultZip(vault: Vault): Promise<void> {
  download(`${vault.name}.zip`, await exportZip(vault.store));
}

/** Where imported files land: notes keep their folders, everything else goes to attachments/. */
export function importTarget(vault: Vault, relPath: string): string {
  const ext = extname(relPath);
  if (ext === ".md" || relPath.startsWith(".writalin/")) return relPath;
  if (relPath.includes("/")) return relPath;
  return `${vault.settings.attachmentsFolder}/${relPath}`;
}
