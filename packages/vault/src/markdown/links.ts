import type { WikiLink } from "@writalin/shared";
import { codeRanges, inRanges } from "./code";

export const WIKILINK_RE = /(!?)\[\[([^[\]|#^\n]*)(?:#([^[\]|\n]*))?(?:\|([^[\]\n]*))?\]\]/g;

export function parseWikiLinks(text: string, offset = 0): WikiLink[] {
  const code = codeRanges(text);
  const links: WikiLink[] = [];
  for (const m of text.matchAll(WIKILINK_RE)) {
    if (inRanges(code, m.index)) continue;
    const target = m[2]!.trim();
    if (!target && !m[3]) continue;
    links.push({
      target,
      heading: m[3]?.trim() || undefined,
      alias: m[4]?.trim() || undefined,
      embed: m[1] === "!",
      from: m.index + offset,
      to: m.index + m[0].length + offset,
    });
  }
  return links;
}

export function formatWikiLink(l: Pick<WikiLink, "target" | "heading" | "alias" | "embed">): string {
  return `${l.embed ? "!" : ""}[[${l.target}${l.heading ? `#${l.heading}` : ""}${l.alias ? `|${l.alias}` : ""}]]`;
}

/** Standard markdown links/images: [text](url) and ![alt](url). */
export const MDLINK_RE = /(!?)\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

export interface MarkdownLink {
  text: string;
  url: string;
  image: boolean;
  from: number;
  to: number;
}

export function parseMarkdownLinks(text: string): MarkdownLink[] {
  const code = codeRanges(text);
  const out: MarkdownLink[] = [];
  for (const m of text.matchAll(MDLINK_RE)) {
    if (inRanges(code, m.index)) continue;
    out.push({ image: m[1] === "!", text: m[2]!, url: m[3]!, from: m.index, to: m.index + m[0].length });
  }
  return out;
}

/**
 * Rewrite every wiki link whose target satisfies `matches` so it points to `newTarget`.
 * Headings and aliases are kept. Returns the text unchanged if nothing matched.
 */
export function rewriteWikiLinks(text: string, matches: (target: string) => boolean, newTarget: string): string {
  const links = parseWikiLinks(text).filter((l) => l.target && matches(l.target));
  if (!links.length) return text;
  let out = "";
  let last = 0;
  for (const l of links) {
    out += text.slice(last, l.from) + formatWikiLink({ ...l, target: newTarget });
    last = l.to;
  }
  return out + text.slice(last);
}

/** Rewrite standard markdown links/images whose URL (minus #fragment) equals `oldUrl`. */
export function rewriteMarkdownLinks(text: string, oldUrl: string, newUrl: string): string {
  const enc = (s: string) => s.replace(/ /g, "%20");
  const candidates = new Set([oldUrl, enc(oldUrl)]);
  const links = parseMarkdownLinks(text).filter((l) => candidates.has(decodeSafe(l.url.split("#")[0]!)) || candidates.has(l.url.split("#")[0]!));
  if (!links.length) return text;
  let out = "";
  let last = 0;
  for (const l of links) {
    const frag = l.url.includes("#") ? l.url.slice(l.url.indexOf("#")) : "";
    out += text.slice(last, l.from) + `${l.image ? "!" : ""}[${l.text}](${enc(newUrl)}${frag})`;
    last = l.to;
  }
  return out + text.slice(last);
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
