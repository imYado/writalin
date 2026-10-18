import type { VaultPath } from "@writalin/shared";

export interface FileStat {
  path: VaultPath;
  mtime: number;
  size: number;
}

/**
 * Everything Writalin needs from storage. Implemented over the File System
 * Access API (a real folder), IndexedDB (fallback for browsers without folder
 * access) and memory (tests).
 */
export interface FileStore {
  readonly kind: "folder" | "browser" | "memory";
  /** Display name of the vault root (folder name). */
  readonly name: string;
  /** Recursively list all files, skipping nothing; callers filter hidden paths. */
  list(): Promise<FileStat[]>;
  stat(path: VaultPath): Promise<FileStat | null>;
  readText(path: VaultPath): Promise<string>;
  readBinary(path: VaultPath): Promise<Blob>;
  /** Write atomically where the backend allows it; creates parent folders. */
  write(path: VaultPath, data: string | Blob): Promise<FileStat>;
  rename(from: VaultPath, to: VaultPath): Promise<void>;
  remove(path: VaultPath): Promise<void>;
  mkdir(path: VaultPath): Promise<void>;
}

export class FileNotFoundError extends Error {
  constructor(public path: VaultPath) {
    super(`File not found: ${path}`);
    this.name = "FileNotFoundError";
  }
}
