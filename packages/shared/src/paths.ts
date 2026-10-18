import type { VaultPath } from "./types";

export function normalizePath(p: string): VaultPath {
  const parts: string[] = [];
  for (const part of p.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

export function basename(p: VaultPath): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1);
}

export function dirname(p: VaultPath): VaultPath {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
}

export function extname(p: VaultPath): string {
  const b = basename(p);
  const i = b.lastIndexOf(".");
  return i <= 0 ? "" : b.slice(i).toLowerCase();
}

export function stripExt(p: string): string {
  const ext = extname(p);
  return ext ? p.slice(0, -ext.length) : p;
}

export function noteName(p: VaultPath): string {
  return stripExt(basename(p));
}

export function joinPath(...parts: string[]): VaultPath {
  return normalizePath(parts.filter(Boolean).join("/"));
}

/** Characters not allowed in file names on Windows/macOS, plus link syntax. */
export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || "Untitled";
}

export function isMarkdown(p: VaultPath): boolean {
  return extname(p) === ".md";
}

export function isHiddenPath(p: VaultPath): boolean {
  return p.split("/").some((s) => s.startsWith("."));
}
