import { marked } from "marked";
import DOMPurify from "dompurify";
import { escapeHtml } from "@writalin/shared";

/** Turns an image embed's target into a URL the page can show, or null. */
export type ResolveImage = (target: string) => Promise<string | null>;

const MATH_RE = /\$\$([\s\S]+?)\$\$|(?<![\\$\w])\$(?![\s$])([^$\n]+?)(?<!\s)\$(?![\w$])/g;
const EMBED_RE = /!\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]|!\[([^\]]*)\]\(([^)\s]+)\)/g;
const SLOT_RE = /⁣(\d+)⁣/g;
const BLANK = "[...]";

let katex: Promise<typeof import("katex").default> | null = null;
const loadKatex = () =>
  (katex ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(([k]) => k.default));

/**
 * A flashcard side as HTML: Markdown, `$math$` and `$$math$$` (KaTeX, loaded
 * only when a card has math), `==highlights==`, image embeds and the cloze
 * blank. The Markdown is sanitized; math and images go in afterwards, as they
 * come from KaTeX and the vault rather than from the text.
 */
export async function renderCardMarkdown(text: string, resolveImage?: ResolveImage): Promise<string> {
  const slots: (() => Promise<string>)[] = [];
  const slot = (render: () => Promise<string>) => `⁣${slots.push(render) - 1}⁣`;
  let src = text.replace(MATH_RE, (_, block?: string, inline?: string) =>
    slot(async () => (await loadKatex()).renderToString((block ?? inline)!.trim(), { displayMode: block != null, throwOnError: false, output: "html" })),
  );
  src = src.replace(EMBED_RE, (whole, wiki?: string, size?: string, alt?: string, url?: string) =>
    slot(async () => {
      const target = (wiki ?? url)!.trim();
      if (/^https?:/i.test(target)) return `<img src="${escapeHtml(target)}" alt="${escapeHtml(alt ?? "")}">`;
      let path = target;
      try {
        path = decodeURIComponent(target);
      } catch {
        /* keep raw */
      }
      const found = await resolveImage?.(path);
      if (!found) return `<em>${escapeHtml(whole)}</em>`;
      const width = /^\d+/.exec(size ?? "")?.[0];
      return `<img src="${escapeHtml(found)}" alt="${escapeHtml(alt ?? target)}"${width ? ` style="width:${width}px"` : ""}>`;
    }),
  );
  src = src
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_, t: string, alias?: string) => alias ?? t)
    .replace(/==([^=\n]+)==/g, "<mark>$1</mark>");
  // Cards sit inside a button, so links and form controls become plain text.
  let html = DOMPurify.sanitize(await marked.parse(src, { gfm: true, breaks: true }), { FORBID_TAGS: ["a", "input", "button", "select", "textarea", "form"] });
  html = html.split(BLANK).join('<span class="card-blank" aria-label="blank">…</span>');
  const filled = await Promise.all(slots.map((r) => r().catch(() => "")));
  return html.replace(SLOT_RE, (_, i: string) => filled[Number(i)] ?? "");
}
