import { KeyValueDB, emptySyncState, syncVault, type SyncReport, type SyncState, type Vault } from "@writalin/vault";
import { httpTransport, syncApi } from "../api";

interface SyncLink {
  remoteId: string;
  state: SyncState;
}

const links = new KeyValueDB<SyncLink>("writalin-sync", "links");

export async function getSyncLink(localVaultId: string): Promise<SyncLink | undefined> {
  return links.get(localVaultId).catch(() => undefined);
}

export async function unlinkSync(localVaultId: string): Promise<void> {
  await links.delete(localVaultId);
}

/** Connect a local vault to a cloud copy (new, or an existing one from another computer). */
export async function linkSync(localVaultId: string, remote: { id?: string; name: string }): Promise<SyncLink> {
  const remoteId = remote.id ?? (await syncApi.createVault(remote.name)).id;
  const link = { remoteId, state: emptySyncState() };
  await links.set(localVaultId, link);
  return link;
}

let running: Promise<SyncReport | null> | null = null;

/** Run one sync pass. Concurrent calls share the same run. */
export function runSync(localVaultId: string, vault: Vault): Promise<SyncReport | null> {
  if (running) return running;
  running = (async () => {
    const link = await getSyncLink(localVaultId);
    if (!link) return null;
    const { state, report } = await syncVault(vault.store, httpTransport(link.remoteId), link.state);
    await links.set(localVaultId, { ...link, state });
    if (report.pulled.length || report.deletedLocal.length || report.conflicts.length) await vault.refresh();
    return report;
  })().finally(() => {
    running = null;
  });
  return running;
}
