/**
 * Builders for the Markdown that Writalin inserts. Everything here is plain,
 * Obsidian-readable Markdown so notes stay portable.
 */

export function quoteLines(text: string): string {
  return text
    .trim()
    .split(/\r?\n/)
    .map((l) => (l.trim() ? `> ${l}` : ">"))
    .join("\n");
}

/** A PDF highlight: the quoted text then a link back to the exact page. */
export function pdfQuote(text: string, pdfPath: string, page: number): string {
  const url = `${pdfPath.replace(/ /g, "%20")}#page=${page}`;
  return `${quoteLines(text)}\n>\n> [source p.${page}](${url})\n`;
}

/** A web clip from the extension: quote, then the page title linked to its URL. */
export function webQuote(text: string, url: string, title?: string): string {
  const label = (title || url).replace(/[[\]]/g, "");
  return `${quoteLines(text)}\n>\n> — [${label}](${url})\n`;
}

export function callout(kind: string, title = "", body = ""): string {
  const head = `> [!${kind}]${title ? ` ${title}` : ""}`;
  return body ? `${head}\n${quoteLines(body)}` : `${head}\n> `;
}

export function embed(path: string): string {
  return `![[${path}]]`;
}

export function flashcard(q = "Question", a = "Answer"): string {
  return `${q} :: ${a}`;
}

export function table(cols = 3, rows = 2): string {
  const head = `| ${Array.from({ length: cols }, (_, i) => `Column ${i + 1}`).join(" | ")} |`;
  const sep = `| ${Array.from({ length: cols }, () => "---").join(" | ")} |`;
  const row = `| ${Array.from({ length: cols }, () => " ").join(" | ")} |`;
  return [head, sep, ...Array.from({ length: rows }, () => row)].join("\n");
}
