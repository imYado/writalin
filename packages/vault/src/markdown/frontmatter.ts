import { parseDocument, isMap, YAMLMap, Document } from "yaml";
import type { Frontmatter } from "@writalin/shared";

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export interface SplitNote {
  /** Raw YAML between the fences, or null when the note has no frontmatter. */
  yaml: string | null;
  frontmatter: Frontmatter;
  body: string;
  /** Length of the frontmatter block (including fences) in the original text. */
  bodyOffset: number;
}

export function splitFrontmatter(text: string): SplitNote {
  const m = FM_RE.exec(text);
  if (!m) return { yaml: null, frontmatter: {}, body: text, bodyOffset: 0 };
  const yaml = m[1]!;
  let frontmatter: Frontmatter = {};
  try {
    const doc = parseDocument(yaml);
    const js = doc.toJS() as unknown;
    if (js && typeof js === "object" && !Array.isArray(js)) frontmatter = normalizeFrontmatter(js as Record<string, unknown>);
  } catch {
    // Invalid YAML: keep it verbatim, treat as empty metadata.
  }
  return { yaml, frontmatter, body: text.slice(m[0].length), bodyOffset: m[0].length };
}

function toStringList(v: unknown): string[] | undefined {
  if (v == null) return undefined;
  if (Array.isArray(v)) return v.filter((x) => x != null).map(String);
  if (typeof v === "string") return v.split(/[,\s]+/).filter(Boolean);
  return [String(v)];
}

function normalizeFrontmatter(js: Record<string, unknown>): Frontmatter {
  const fm: Frontmatter = { ...js };
  // Obsidian accepts `tag`/`tags` as a list or a comma/space separated string.
  const tags = toStringList(js.tags ?? js.tag);
  if (tags) fm.tags = tags.map((t) => t.replace(/^#/, ""));
  const sources = toStringList(js.sources);
  if (sources) fm.sources = sources;
  for (const k of ["created", "updated"] as const) {
    const v = js[k];
    if (v instanceof Date) fm[k] = v.toISOString().slice(0, 16);
    else if (v != null) fm[k] = String(v);
  }
  return fm;
}

/**
 * Apply changes to a note's frontmatter while keeping everything else
 * (unknown keys, comments, key order) exactly as the user wrote it.
 * A value of `undefined` deletes the key.
 */
export function updateFrontmatter(text: string, changes: Record<string, unknown>): string {
  const { yaml, body } = splitFrontmatter(text);
  let doc: Document;
  try {
    doc = parseDocument(yaml ?? "");
  } catch {
    doc = new Document({});
  }
  if (doc.errors.length || !(isMap(doc.contents) || doc.contents == null)) {
    // Don't touch YAML we can't parse; prepend nothing and return as is.
    if (yaml != null) return text;
    doc = new Document({});
  }
  if (doc.contents == null) doc.contents = new YAMLMap() as never;
  for (const [k, v] of Object.entries(changes)) {
    if (v === undefined) doc.delete(k);
    else doc.set(k, v);
  }
  const out = doc.toString({ lineWidth: 0 }).replace(/\n$/, "");
  return `---\n${out}\n---\n${body}`;
}

export function joinFrontmatter(frontmatter: Record<string, unknown>, body: string): string {
  return updateFrontmatter(body, frontmatter);
}
