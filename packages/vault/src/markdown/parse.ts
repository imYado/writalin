import type { NoteMeta, VaultPath } from "@writalin/shared";
import { noteName } from "@writalin/shared";
import { splitFrontmatter } from "./frontmatter";
import { parseWikiLinks } from "./links";
import { parseInlineTags, normalizeTag } from "./tags";
import { parseHeadings } from "./headings";
import { parseTasks } from "./tasks";
import { parseFlashcards } from "./flashcards";
import { countWords } from "../activity";

export function lineCount(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}

/** Extract everything the index needs from a note's text. Pure, so it can run in a worker. */
export function parseNote(path: VaultPath, text: string, stat: { mtime: number; size: number }): NoteMeta {
  const { frontmatter, body, bodyOffset } = splitFrontmatter(text);
  const lineOffset = lineCount(text.slice(0, bodyOffset));
  const tagSet = new Map<string, string>();
  for (const t of frontmatter.tags ?? []) tagSet.set(normalizeTag(t), t);
  for (const t of parseInlineTags(body)) if (!tagSet.has(normalizeTag(t.tag))) tagSet.set(normalizeTag(t.tag), t.tag);
  return {
    path,
    name: noteName(path),
    frontmatter,
    tags: [...tagSet.values()],
    links: parseWikiLinks(body, bodyOffset),
    headings: parseHeadings(body, bodyOffset, lineOffset),
    tasks: parseTasks(body, path, lineOffset),
    flashcards: parseFlashcards(body, path, lineOffset),
    mtime: stat.mtime,
    size: stat.size,
    words: countWords(body),
  };
}
