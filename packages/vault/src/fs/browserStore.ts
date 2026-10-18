import type { VaultPath } from "@writalin/shared";
import { MemoryStore } from "./memory";
import { KeyValueDB } from "./idb";

interface StoredEntry {
  data: string | Blob;
  mtime: number;
}

/**
 * Fallback vault for browsers without folder access (Safari, Firefox, mobile):
 * files live in IndexedDB. Users move notes in and out with zip import/export.
 */
export class BrowserStore extends MemoryStore {
  override readonly kind = "browser" as const;
  private db: KeyValueDB<StoredEntry>;

  private constructor(name: string, id: string) {
    super(name);
    this.db = new KeyValueDB<StoredEntry>(`writalin-browser-vault:${id}`, "files");
  }

  static async open(id: string, name: string): Promise<BrowserStore> {
    const s = new BrowserStore(name, id);
    for (const [path, e] of await s.db.entries()) s.files.set(path, e);
    return s;
  }

  protected override async persist(path: VaultPath, e: StoredEntry): Promise<void> {
    await this.db.set(path, e);
  }

  protected override async unpersist(path: VaultPath): Promise<void> {
    await this.db.delete(path);
  }
}
