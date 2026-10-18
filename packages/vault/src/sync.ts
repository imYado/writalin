import type { VaultPath } from "@writalin/shared";
import { isHiddenPath, isoDate, stripExt } from "@writalin/shared";
import type { FileStore } from "./fs/types";

/**
 * Optional cloud sync for signed-in users. The vault folder stays the source
 * of truth on each computer; the server keeps a copy so a second computer
 * can catch up. Every file carries a content hash, and each push says which
 * hash it was based on, so two computers editing the same note never
 * silently overwrite each other: the loser is kept as a "(conflict)" copy.
 */

export interface RemoteChange {
  path: VaultPath;
  hash: string | null;
  deleted: boolean;
  version: number;
  size: number;
}

export interface SyncTransport {
  changes(since: number): Promise<{ changes: RemoteChange[]; cursor: number }>;
  download(path: VaultPath): Promise<Uint8Array>;
  /** Resolves `{ ok: false, current }` when the server's hash isn't `baseHash`. */
  upload(req: { path: VaultPath; baseHash: string | null; hash: string; data: Uint8Array }): Promise<UploadResult>;
  remove(req: { path: VaultPath; baseHash: string }): Promise<UploadResult>;
}

export type UploadResult = { ok: true; version: number } | { ok: false; current: RemoteChange };

/** Per-device bookkeeping: what each file looked like the last time we agreed with the server. */
export interface SyncState {
  cursor: number;
  /** path → hash both sides last agreed on. */
  base: Record<VaultPath, string>;
  /** path → local stat + hash, so unchanged files aren't re-hashed. */
  local: Record<VaultPath, { mtime: number; size: number; hash: string }>;
}

export function emptySyncState(): SyncState {
  return { cursor: 0, base: {}, local: {} };
}

export interface SyncReport {
  pulled: VaultPath[];
  pushed: VaultPath[];
  deletedLocal: VaultPath[];
  deletedRemote: VaultPath[];
  conflicts: VaultPath[];
}

/** Files that never sync: device-specific state and OS clutter. */
export function shouldSync(path: VaultPath): boolean {
  if (path === ".writalin/workspace.json" || path === ".writalin/sync.json") return false;
  if (/(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/.test(path)) return false;
  if (path.startsWith(".writalin/")) return true;
  return !isHiddenPath(path);
}

// Vercel functions accept request bodies up to 4.5 MB; bigger files (large PDFs) stay local for now.
export const MAX_SYNC_FILE_BYTES = 4 * 1024 * 1024;

export async function hashBytes(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function readBytes(store: FileStore, path: VaultPath): Promise<Uint8Array> {
  return new Uint8Array(await (await store.readBinary(path)).arrayBuffer());
}

const TEXT_EXT = /\.(md|txt|json|css|svg|csv|canvas)$/i;

async function writeBytes(store: FileStore, path: VaultPath, data: Uint8Array): Promise<void> {
  await store.write(path, TEXT_EXT.test(path) ? new TextDecoder().decode(data) : new Blob([data as BlobPart]));
}

export function conflictPath(path: VaultPath, existing: (p: VaultPath) => boolean, date = isoDate()): VaultPath {
  const ext = path.slice(stripExt(path).length);
  const base = stripExt(path);
  let p = `${base} (conflict ${date})${ext}`;
  for (let i = 2; existing(p); i++) p = `${base} (conflict ${date} ${i})${ext}`;
  return p;
}

export async function syncVault(store: FileStore, transport: SyncTransport, state: SyncState): Promise<{ state: SyncState; report: SyncReport }> {
  const report: SyncReport = { pulled: [], pushed: [], deletedLocal: [], deletedRemote: [], conflicts: [] };
  const base = { ...state.base };
  const localCache = { ...state.local };

  // 1. Hash local files (only those whose stat changed).
  const local = new Map<VaultPath, string>();
  for (const f of await store.list()) {
    if (!shouldSync(f.path) || f.size > MAX_SYNC_FILE_BYTES) continue;
    const c = localCache[f.path];
    if (c && c.mtime === f.mtime && c.size === f.size) local.set(f.path, c.hash);
    else {
      const hash = await hashBytes(await readBytes(store, f.path));
      localCache[f.path] = { mtime: f.mtime, size: f.size, hash };
      local.set(f.path, hash);
    }
  }
  for (const p of Object.keys(localCache)) if (!local.has(p)) delete localCache[p];

  const keepConflictCopy = async (path: VaultPath, data: Uint8Array) => {
    const cp = conflictPath(path, (p) => local.has(p));
    await writeBytes(store, cp, data);
    local.set(cp, await hashBytes(data));
    report.conflicts.push(cp);
  };

  // 2. Pull what changed on the server since last time.
  const { changes, cursor } = await transport.changes(state.cursor);
  for (const ch of changes) {
    if (!shouldSync(ch.path)) continue;
    const mine = local.get(ch.path);
    const agreed = base[ch.path];
    const localChanged = mine !== agreed;
    // Our own earlier push echoing back, or a version we already have.
    if (!ch.deleted && ch.hash === agreed) continue;
    if (ch.deleted && agreed === undefined) continue;
    if (ch.deleted) {
      if (mine && !localChanged) {
        await store.remove(ch.path);
        local.delete(ch.path);
        delete localCache[ch.path];
        report.deletedLocal.push(ch.path);
      }
      // Edited here but deleted there: keep ours, it will be re-uploaded as new.
      delete base[ch.path];
      continue;
    }
    if (mine === ch.hash) {
      base[ch.path] = ch.hash!;
      continue;
    }
    const data = await transport.download(ch.path);
    if (mine && localChanged) {
      // Both sides edited: the server copy wins the original name, ours becomes a conflict copy.
      await keepConflictCopy(ch.path, await readBytes(store, ch.path));
    }
    await writeBytes(store, ch.path, data);
    local.set(ch.path, ch.hash!);
    base[ch.path] = ch.hash!;
    report.pulled.push(ch.path);
  }

  // 3. Push local edits, creations and deletions.
  for (const [path, hash] of local) {
    if (base[path] === hash) continue;
    const data = await readBytes(store, path);
    const res = await transport.upload({ path, baseHash: base[path] ?? null, hash, data });
    if (res.ok) {
      base[path] = hash;
      report.pushed.push(path);
    } else if (!res.current.deleted && res.current.hash) {
      // Someone pushed in between: keep theirs under the name, ours as a copy, and upload the copy.
      await keepConflictCopy(path, data);
      await writeBytes(store, path, await transport.download(path));
      local.set(path, res.current.hash);
      base[path] = res.current.hash;
      const cp = report.conflicts[report.conflicts.length - 1]!;
      const up = await transport.upload({ path: cp, baseHash: null, hash, data });
      if (up.ok) {
        base[cp] = hash;
        report.pushed.push(cp);
      }
    } else {
      const retry = await transport.upload({ path, baseHash: null, hash, data });
      if (retry.ok) {
        base[path] = hash;
        report.pushed.push(path);
      }
    }
  }
  for (const path of Object.keys(base)) {
    if (local.has(path)) continue;
    const res = await transport.remove({ path, baseHash: base[path]! });
    if (res.ok) report.deletedRemote.push(path);
    delete base[path];
  }

  // Refresh stat cache for anything we wrote.
  for (const p of [...report.pulled, ...report.conflicts]) {
    const s = await store.stat(p);
    if (s) localCache[p] = { mtime: s.mtime, size: s.size, hash: local.get(p)! };
  }
  return { state: { cursor, base, local: localCache }, report };
}
