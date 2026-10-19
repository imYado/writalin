import type { Vault } from "@writalin/vault";
import type { VaultPath } from "@writalin/shared";
import { toast } from "@writalin/ui";

/**
 * Delete something right away, with an Undo in the toast instead of an
 * "are you sure?" dialog. Undo puts the file back exactly as it was.
 */
export async function removeWithUndo(vault: Vault, path: VaultPath, what: string, remove: () => Promise<void>): Promise<void> {
  const before = await vault.read(path).then((r) => r.text, () => null);
  try {
    await remove();
  } catch (e) {
    toast((e as Error).message, { tone: "warn" });
    return;
  }
  if (before != null) toast(`${what} deleted.`, { action: { label: "Undo", run: () => void vault.write(path, before) } });
}
