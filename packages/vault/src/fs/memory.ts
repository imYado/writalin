import type { VaultPath } from "@writalin/shared";
import { normalizePath } from "@writalin/shared";
import { FileNotFoundError, type FileStat, type FileStore } from "./types";

interface Entry {
  data: string | Blob;
  mtime: number;
}

/** In-memory store, used for tests and as the base of the browser fallback. */
export class MemoryStore implements FileStore {
  readonly kind: FileStore["kind"] = "memory";
  protected files = new Map<VaultPath, Entry>();
  private clock = 0;

  constructor(public readonly name = "Memory vault", initial: Record<string, string> = {}) {
    for (const [p, t] of Object.entries(initial)) this.files.set(normalizePath(p), { data: t, mtime: this.tick() });
  }

  private tick(): number {
    this.clock = Math.max(this.clock + 1, Date.now());
    return this.clock;
  }

  private statOf(path: VaultPath, e: Entry): FileStat {
    const size = typeof e.data === "string" ? new TextEncoder().encode(e.data).length : e.data.size;
    return { path, mtime: e.mtime, size };
  }

  async list(): Promise<FileStat[]> {
    return [...this.files].map(([p, e]) => this.statOf(p, e));
  }

  async stat(path: VaultPath): Promise<FileStat | null> {
    const e = this.files.get(normalizePath(path));
    return e ? this.statOf(normalizePath(path), e) : null;
  }

  async readText(path: VaultPath): Promise<string> {
    const e = this.files.get(normalizePath(path));
    if (!e) throw new FileNotFoundError(path);
    return typeof e.data === "string" ? e.data : await e.data.text();
  }

  async readBinary(path: VaultPath): Promise<Blob> {
    const e = this.files.get(normalizePath(path));
    if (!e) throw new FileNotFoundError(path);
    return typeof e.data === "string" ? new Blob([e.data]) : e.data;
  }

  async write(path: VaultPath, data: string | Blob): Promise<FileStat> {
    const p = normalizePath(path);
    const e = { data, mtime: this.tick() };
    this.files.set(p, e);
    await this.persist?.(p, e);
    return this.statOf(p, e);
  }

  async rename(from: VaultPath, to: VaultPath): Promise<void> {
    const a = normalizePath(from);
    const b = normalizePath(to);
    // Renaming a folder moves everything below it.
    const moves = [...this.files.keys()].filter((p) => p === a || p.startsWith(a + "/"));
    if (!moves.length) throw new FileNotFoundError(from);
    for (const p of moves) {
      const e = this.files.get(p)!;
      this.files.delete(p);
      await this.unpersist?.(p);
      const np = b + p.slice(a.length);
      this.files.set(np, e);
      await this.persist?.(np, e);
    }
  }

  async remove(path: VaultPath): Promise<void> {
    const a = normalizePath(path);
    for (const p of [...this.files.keys()]) {
      if (p === a || p.startsWith(a + "/")) {
        this.files.delete(p);
        await this.unpersist?.(p);
      }
    }
  }

  async mkdir(): Promise<void> {
    // Folders are implicit in a flat path map.
  }

  /** Simulate another app editing a file (tests). */
  externalWrite(path: VaultPath, text: string): void {
    this.files.set(normalizePath(path), { data: text, mtime: this.tick() + 1000 });
  }

  protected persist?(path: VaultPath, e: Entry): Promise<void>;
  protected unpersist?(path: VaultPath): Promise<void>;
}
