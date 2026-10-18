import { useEffect, useState } from "react";
import type { Vault, VaultSettings } from "@writalin/vault";
import { BUILT_IN_THEMES, Modal, toast, type Theme } from "@writalin/ui";
import { auth, syncApi, type Account, type RemoteVault } from "../api";
import { getSyncLink, linkSync, runSync, unlinkSync } from "../state/sync";

interface Props {
  vault: Vault;
  vaultId: string;
  account: Account | null | undefined;
  customThemes: Theme[];
  onClose: () => void;
  onAccount: (a: Account | null) => void;
  onEditTheme: () => void;
}

export function SettingsModal({ vault, vaultId, account, customThemes, onClose, onAccount, onEditTheme }: Props) {
  const [s, setS] = useState<VaultSettings>(vault.settings);
  const set = <K extends keyof VaultSettings>(k: K, v: VaultSettings[K]) => {
    setS((x) => ({ ...x, [k]: v }));
    void vault.saveSettings({ [k]: v });
  };
  return (
    <Modal title="Settings" onClose={onClose} width={560}>
      <section className="settings-section">
        <h3>Appearance</h3>
        <div className="theme-picker" role="radiogroup" aria-label="Theme">
          {[...BUILT_IN_THEMES, ...customThemes].map((t) => (
            <button
              key={t.id}
              role="radio"
              aria-checked={s.theme === t.id}
              className="theme-swatch"
              onClick={() => set("theme", t.id)}
              style={{ background: t.tokens.surface, color: t.tokens.text, borderColor: s.theme === t.id ? t.tokens.accent : t.tokens.border }}
            >
              <span className="theme-dot" style={{ background: t.tokens.accent }} />
              {t.name}
            </button>
          ))}
          <button className="theme-swatch theme-swatch-new" onClick={onEditTheme}>+ Custom theme</button>
        </div>
        <div className="w-row">
          <label className="w-field">
            <span>Font</span>
            <select value={s.font} onChange={(e) => set("font", e.target.value as VaultSettings["font"])}>
              <option value="default">Default</option>
              <option value="serif">Serif (long reading)</option>
              <option value="dyslexic">Dyslexia-friendly</option>
            </select>
          </label>
          <label className="w-field">
            <span>Line spacing</span>
            <select value={s.lineHeight} onChange={(e) => set("lineHeight", Number(e.target.value))}>
              <option value={1.5}>Compact</option>
              <option value={1.7}>Comfortable</option>
              <option value={2}>Relaxed</option>
            </select>
          </label>
        </div>
      </section>
      <section className="settings-section">
        <h3>Focus</h3>
        <div className="w-row">
          <label className="w-field">
            <span>Focus timer (minutes)</span>
            <input type="number" min={1} max={180} value={s.timerMinutes} onChange={(e) => Number(e.target.value) > 0 && set("timerMinutes", Number(e.target.value))} />
          </label>
          <label className="w-field">
            <span>Break (minutes)</span>
            <input type="number" min={1} max={60} value={s.breakMinutes} onChange={(e) => Number(e.target.value) > 0 && set("breakMinutes", Number(e.target.value))} />
          </label>
        </div>
      </section>
      <section className="settings-section">
        <h3>Notes</h3>
        <div className="w-row">
          <label className="w-field">
            <span>New notes go in</span>
            <input value={s.newNoteFolder} placeholder="Top level" onChange={(e) => set("newNoteFolder", e.target.value)} />
          </label>
          <label className="w-field">
            <span>Attachments folder</span>
            <input value={s.attachmentsFolder} onChange={(e) => set("attachmentsFolder", e.target.value || "attachments")} />
          </label>
        </div>
      </section>
      <AccountSection vault={vault} vaultId={vaultId} account={account} onAccount={onAccount} />
    </Modal>
  );
}

function AccountSection({ vault, vaultId, account, onAccount }: { vault: Vault; vaultId: string; account: Account | null | undefined; onAccount: (a: Account | null) => void }) {
  const [linked, setLinked] = useState<string | null | undefined>(undefined);
  const [remotes, setRemotes] = useState<RemoteVault[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getSyncLink(vaultId).then((l) => setLinked(l?.remoteId ?? null));
  }, [vaultId]);
  useEffect(() => {
    if (account && linked === null) syncApi.vaults().then(setRemotes).catch(() => setRemotes([]));
  }, [account, linked]);

  if (!account) {
    return (
      <section className="settings-section">
        <h3>Account and sync</h3>
        <p className="w-muted">Sign in to keep this vault in step across your computers. Without an account, everything stays on this device.</p>
        <a className="w-btn w-btn-primary" href="/login">Sign in or create an account</a>
      </section>
    );
  }

  const connect = async (remote: { id?: string; name: string }) => {
    setBusy(true);
    try {
      const l = await linkSync(vaultId, remote);
      setLinked(l.remoteId);
      const r = await runSync(vaultId, vault);
      toast(`Synced: ${r?.pushed.length ?? 0} up, ${r?.pulled.length ?? 0} down.`);
    } catch (e) {
      toast((e as Error).message, { tone: "warn" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-section">
      <h3>Account and sync</h3>
      <p>Signed in as <strong>{account.email}</strong>.</p>
      {linked ? (
        <div className="w-row">
          <span className="w-muted">This vault syncs to your account.</span>
          <button className="w-btn w-btn-small" disabled={busy} onClick={() => void connect({ id: linked, name: vault.name })}>Sync now</button>
          <button className="w-btn w-btn-small" onClick={async () => { await unlinkSync(vaultId); setLinked(null); }}>Stop syncing</button>
        </div>
      ) : (
        <div className="w-col">
          <span className="w-muted">This vault isn't synced yet.</span>
          <div className="w-row">
            <button className="w-btn w-btn-primary w-btn-small" disabled={busy} onClick={() => void connect({ name: vault.name })}>Sync this vault</button>
            {remotes?.map((r) => (
              <button key={r.id} className="w-btn w-btn-small" disabled={busy} onClick={() => void connect({ id: r.id, name: r.name })}>
                Join “{r.name}” ({r.files} files)
              </button>
            ))}
          </div>
          <span className="w-muted settings-note">Files over 4 MB (large PDFs) stay on this computer for now.</span>
        </div>
      )}
      <div className="w-row">
        {!account.hasPassword && <a className="w-btn w-btn-small" href="/login">Create a password</a>}
        <button className="w-btn w-btn-small" onClick={async () => { await auth.logout().catch(() => {}); onAccount(null); }}>Sign out</button>
      </div>
    </section>
  );
}
