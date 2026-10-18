import type { VaultPath } from "@writalin/shared";
import { normalizePath, isHiddenPath } from "@writalin/shared";
import { FileNotFoundError, type FileStat, type FileStore } from "./types";
import type { DirHandle } from "./fsaTypes";

/**
 * A vault backed by a real folder via the File System Access API.
 *
 * Writes go through `createWritable()`, which Chrome stages in a swap file and
 * swaps into place on `close()`: a crash mid-write never leaves a half-written note.
 */
export class FolderStore implements FileStore {
  readonly kind = "folder" as const;

  constructor(public readonly root: DirHandle) {}

  get name(): string {
    return this.root.name;
  }

  private async dir(parts: string[], create: boolean): Promise<DirHandle> {
    let d = this.root;
    for (const p of parts) d = (await d.getDirectoryHandle(p, { create })) as DirHandle;
    return d;
  }

  private split(path: VaultPath): { dirs: string[]; file: string } {
    const parts = normalizePath(path).split("/");
    const file = parts.pop()!;
    return { dirs: parts, file };
  }

  private async fileHandle(path: VaultPath, create = false): Promise<FileSystemFileHandle> {
    const { dirs, file } = this.split(path);
    try {
      const d = await this.dir(dirs, create);
      return await d.getFileHandle(file, { create });
    } catch (e) {
      if ((e as DOMException)?.name === "NotFoundError" || (e as DOMException)?.name === "TypeMismatchError") throw new FileNotFoundError(path);
      throw e;
    }
  }

  async list(): Promise<FileStat[]> {
    const out: FileStat[] = [];
    const walk = async (d: DirHandle, prefix: string) => {
      for await (const h of d.values()) {
        const path = prefix ? `${prefix}/${h.name}` : h.name;
        if (h.kind === "directory") {
          // Never descend into dependency/VCS folders; `.writalin` is read on demand.
          if (h.name === "node_modules" || h.name === ".git" || h.name === ".trash") continue;
          if (isHiddenPath(h.name) && h.name !== ".writalin") continue;
          await walk(h as DirHandle, path);
        } else {
          const f = await (h as FileSystemFileHandle).getFile();
          out.push({ path, mtime: f.lastModified, size: f.size });
        }
      }
    };
    await walk(this.root, "");
    return out;
  }

  async stat(path: VaultPath): Promise<FileStat | null> {
    try {
      const f = await (await this.fileHandle(path)).getFile();
      return { path: normalizePath(path), mtime: f.lastModified, size: f.size };
    } catch (e) {
      if (e instanceof FileNotFoundError) return null;
      throw e;
    }
  }

  async readText(path: VaultPath): Promise<string> {
    return (await (await this.fileHandle(path)).getFile()).text();
  }

  async readBinary(path: VaultPath): Promise<Blob> {
    return (await this.fileHandle(path)).getFile();
  }

  async write(path: VaultPath, data: string | Blob): Promise<FileStat> {
    const h = await this.fileHandle(path, true);
    const w = await h.createWritable();
    try {
      await w.write(data);
      await w.close();
    } catch (e) {
      await w.abort().catch(() => {});
      throw e;
    }
    const f = await h.getFile();
    return { path: normalizePath(path), mtime: f.lastModified, size: f.size };
  }

  async rename(from: VaultPath, to: VaultPath): Promise<void> {
    const src = this.split(from);
    const dst = this.split(to);
    const srcDir = await this.dir(src.dirs, false);
    let handle: FileSystemHandle;
    try {
      handle = await srcDir.getFileHandle(src.file);
    } catch {
      handle = await srcDir.getDirectoryHandle(src.file);
    }
    const move = (handle as FileSystemHandle & { move?: (dir: FileSystemDirectoryHandle, name: string) => Promise<void> }).move;
    if (move) {
      const dstDir = await this.dir(dst.dirs, true);
      await move.call(handle, dstDir, dst.file);
      return;
    }
    // No native move: copy then delete (files only).
    if (handle.kind !== "file") throw new Error("Moving folders needs a newer version of Chrome.");
    const blob = await (handle as FileSystemFileHandle).getFile();
    await this.write(to, blob);
    await srcDir.removeEntry(src.file);
  }

  async remove(path: VaultPath): Promise<void> {
    const { dirs, file } = this.split(path);
    const d = await this.dir(dirs, false);
    await d.removeEntry(file, { recursive: true });
  }

  async mkdir(path: VaultPath): Promise<void> {
    await this.dir(normalizePath(path).split("/").filter(Boolean), true);
  }
}
