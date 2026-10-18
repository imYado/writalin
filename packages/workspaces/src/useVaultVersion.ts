import { useEffect, useState } from "react";
import type { Vault } from "@writalin/vault";

/** Re-render when the vault index changes (debounced to one frame). */
export function useVaultVersion(vault: Vault | null): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!vault) return;
    let raf = 0;
    return vault.events.on(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setV((n) => n + 1));
    });
  }, [vault]);
  return v;
}
