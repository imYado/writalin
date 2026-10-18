import { useCallback, useEffect, useState } from "react";
import { createBrowserVault, listVaults, pickFolderVault, supportsFolderAccess, type Vault, type VaultRecord } from "@writalin/vault";
import { applyTheme, findTheme, qualityTier, Toasts, toast, type QualityTier } from "@writalin/ui";
import { auth, type Account } from "./api";
import { LoginPage } from "./auth/LoginPage";
import { Workspace } from "./components/Workspace";
import { Welcome } from "./components/Welcome";
import { lastVaultId, openVault } from "./state/vaultSession";

function usePath(): [string, (p: string) => void] {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  return [
    path,
    (p) => {
      history.pushState(null, "", p);
      setPath(p);
    },
  ];
}

type VaultState =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "needs-permission"; record: VaultRecord }
  | { kind: "open"; record: VaultRecord; vault: Vault };

export function App() {
  const [path, navigate] = usePath();
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  const [records, setRecords] = useState<VaultRecord[]>([]);
  const [state, setState] = useState<VaultState>({ kind: "loading" });
  const [quality, setQuality] = useState<QualityTier>("medium");

  useEffect(() => {
    void auth.me().then(setAccount);
    void qualityTier().then((q) => {
      setQuality(q);
      document.documentElement.dataset.quality = q;
    });
    applyTheme(findTheme("light"));
  }, []);

  const open = useCallback(async (rec: VaultRecord, fromClick: boolean) => {
    try {
      const r = await openVault(rec, fromClick);
      if ("needsPermission" in r) return setState({ kind: "needs-permission", record: rec });
      lastVaultId.set(rec.id);
      setState({ kind: "open", record: rec, vault: r.vault });
      setRecords(await listVaults());
    } catch (e) {
      toast(`Couldn't open “${rec.name}”: ${(e as Error).message}`, { tone: "warn" });
      setState({ kind: "none" });
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const all = await listVaults().catch(() => []);
      setRecords(all);
      const last = all.find((r) => r.id === lastVaultId.get()) ?? all[0];
      if (last) await open(last, false);
      else setState({ kind: "none" });
    })();
  }, [open]);

  const switchVault = async (choice: VaultRecord | "new-folder" | "new-browser") => {
    try {
      if (choice === "new-folder") return void (await open(await pickFolderVault(), true));
      if (choice === "new-browser") {
        const name = prompt("Name your new vault", "My notes");
        if (name?.trim()) await open(await createBrowserVault(name.trim()), true);
        return;
      }
      await open(choice, true);
    } catch (e) {
      if ((e as DOMException).name !== "AbortError") toast((e as Error).message, { tone: "warn" });
    }
  };

  if (path === "/login") {
    return (
      <>
        <LoginPage
          account={account ?? null}
          onDone={(a) => {
            setAccount(a);
            navigate("/");
          }}
          onSkip={() => navigate("/")}
        />
        <Toasts />
      </>
    );
  }

  return (
    <>
      {state.kind === "loading" && <div className="splash" aria-busy="true"><img src="/icons/icon128.png" className="app-logo" alt="Writalin" width={48} height={48} /></div>}
      {state.kind === "none" && (
        <Welcome
          canPickFolder={supportsFolderAccess()}
          account={account}
          onPickFolder={() => void switchVault("new-folder")}
          onBrowserVault={() => void switchVault("new-browser")}
        />
      )}
      {state.kind === "needs-permission" && (
        <div className="welcome">
          <div className="welcome-card">
            <h1>Welcome back</h1>
            <p className="w-muted">Writalin needs your OK to open “{state.record.name}” again. Choose “Allow on every visit” to skip this next time.</p>
            <button className="w-btn w-btn-primary" onClick={() => void open(state.record, true)}>Open {state.record.name}</button>
            {records.length > 1 && (
              <button className="w-btn w-btn-ghost" onClick={() => setState({ kind: "none" })}>Choose another vault</button>
            )}
          </div>
        </div>
      )}
      {state.kind === "open" && (
        <Workspace
          key={state.record.id}
          vault={state.vault}
          record={state.record}
          records={records}
          account={account}
          quality={quality}
          onSwitchVault={(c) => void switchVault(c)}
          onAccount={setAccount}
        />
      )}
      <Toasts />
    </>
  );
}
