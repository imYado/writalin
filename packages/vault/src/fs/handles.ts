import { uid } from "@writalin/shared";
import { KeyValueDB } from "./idb";
import type { DirHandle, PermissionMode } from "./fsaTypes";

/** A vault the user has opened before, remembered across visits. */
export interface VaultRecord {
  id: string;
  name: string;
  kind: "folder" | "browser";
  /** Present for folder vaults; structured-cloneable so it survives in IndexedDB. */
  handle?: DirHandle;
  lastOpened: number;
}

const db = () => new KeyValueDB<VaultRecord>("writalin-vaults", "vaults");

export async function listVaults(): Promise<VaultRecord[]> {
  const all = (await db().entries()).map(([, v]) => v);
  return all.sort((a, b) => b.lastOpened - a.lastOpened);
}

export async function saveVault(v: VaultRecord): Promise<void> {
  await db().set(v.id, v);
}

export async function forgetVault(id: string): Promise<void> {
  await db().delete(id);
}

export async function pickFolderVault(): Promise<VaultRecord> {
  if (!window.showDirectoryPicker) throw new Error("This browser can't open folders.");
  const handle = (await window.showDirectoryPicker({ id: "writalin-vault", mode: "readwrite" })) as DirHandle;
  // Re-picking a folder we already know keeps its id, so settings and recents carry over.
  for (const v of await listVaults()) {
    if (v.handle && (await v.handle.isSameEntry(handle).catch(() => false))) {
      const updated = { ...v, handle, name: handle.name, lastOpened: Date.now() };
      await saveVault(updated);
      return updated;
    }
  }
  const rec: VaultRecord = { id: uid("v_"), name: handle.name, kind: "folder", handle, lastOpened: Date.now() };
  await saveVault(rec);
  return rec;
}

export async function createBrowserVault(name: string): Promise<VaultRecord> {
  const rec: VaultRecord = { id: uid("b_"), name, kind: "browser", lastOpened: Date.now() };
  await saveVault(rec);
  return rec;
}

/**
 * Chrome forgets folder permission between visits unless the user picked
 * "Allow on every visit". `query` checks silently; `request` must run inside a
 * click handler because it shows a prompt.
 */
export async function folderPermission(handle: DirHandle, request: boolean, mode: PermissionMode = "readwrite"): Promise<boolean> {
  if (!handle.queryPermission) return true;
  if ((await handle.queryPermission({ mode })) === "granted") return true;
  if (!request || !handle.requestPermission) return false;
  return (await handle.requestPermission({ mode })) === "granted";
}
