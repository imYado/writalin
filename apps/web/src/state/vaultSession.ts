import { BrowserStore, FolderStore, KeyValueDB, Vault, folderPermission, saveVault, type IndexCache, type VaultRecord } from "@writalin/vault";
import type { NoteMeta } from "@writalin/shared";

/** IndexedDB cache of parsed notes, so reopening a big vault only re-reads changed files. */
function indexCache(vaultId: string): IndexCache {
  const db = new KeyValueDB<{ mtime: number; size: number; meta: NoteMeta; text: string }>(`writalin-index:${vaultId}`, "notes");
  return {
    get: (p) => db.get(p).catch(() => undefined),
    set: (p, e) => db.set(p, e).catch(() => {}),
    delete: (p) => db.delete(p).catch(() => {}),
  };
}

export type OpenResult = { vault: Vault } | { needsPermission: true };

/**
 * Open a remembered vault. Folder vaults may need permission again; pass
 * `fromClick` when called from a button so Chrome can show its prompt.
 */
export async function openVault(rec: VaultRecord, fromClick: boolean): Promise<OpenResult> {
  let vault: Vault;
  if (rec.kind === "folder") {
    if (!rec.handle) throw new Error("This vault's folder is no longer available.");
    if (!(await folderPermission(rec.handle, fromClick))) return { needsPermission: true };
    vault = new Vault(new FolderStore(rec.handle), indexCache(rec.id));
  } else {
    vault = new Vault(await BrowserStore.open(rec.id, rec.name), indexCache(rec.id));
  }
  await vault.open();
  await saveVault({ ...rec, lastOpened: Date.now() });
  return { vault };
}

const LAST_KEY = "writalin.lastVault";
export const lastVaultId = {
  get: () => {
    try {
      return localStorage.getItem(LAST_KEY);
    } catch {
      return null;
    }
  },
  set: (id: string) => {
    try {
      localStorage.setItem(LAST_KEY, id);
    } catch {
      /* ignore */
    }
  },
};
