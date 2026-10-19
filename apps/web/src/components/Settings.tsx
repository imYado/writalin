import { useEffect, useState } from "react";
import type { Vault, VaultSettings } from "@writalin/vault";
import { BUILT_IN_THEMES, Modal, toast, type Theme } from "@writalin/ui";
import { aiApi, ApiError, auth, syncApi, type Account, type AiState, type RemoteVault } from "../api";
import { getSyncLink, linkSync, runSync, unlinkSync } from "../state/sync";

interface Props {
  vault: Vault;
  vaultId: string;
  account: Account | null | undefined;
  customThemes: Theme[];
  onClose: () => void;
  onAccount: (a: Account | null) => void;
  onEditTheme: () => void;
  onImport: (folder: boolean) => void;
  onExportVault: () => void;
  /** Scroll to a section when opening, e.g. from the AI panel. */
  section?: "ai";
}

export function SettingsModal({ vault, vaultId, account, customThemes, onClose, onAccount, onEditTheme, onImport, onExportVault, section }: Props) {
  const [s, setS] = useState<VaultSettings>(vault.settings);
  const set = <K extends keyof VaultSettings>(k: K, v: VaultSettings[K]) => {
    setS((x) => ({ ...x, [k]: v }));
    void vault.saveSettings({ [k]: v });
  };
  useEffect(() => {
    if (section) requestAnimationFrame(() => document.getElementById(`settings-${section}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [section]);
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
              style={{ background: t.tokens.surface, color: t.tokens.text, boxShadow: s.theme === t.id ? `0 0 0 2px ${t.tokens.accent}` : undefined }}
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
      <section className="settings-section">
        <h3>Import and export</h3>
        <p className="w-muted settings-note">Bring in notes, PDFs and images, or an Obsidian vault. Export keeps everything as plain files.</p>
        <div className="w-row">
          <button className="w-btn w-btn-small" onClick={() => onImport(false)}>Import files</button>
          <button className="w-btn w-btn-small" onClick={() => onImport(true)}>Import a folder</button>
          <button className="w-btn w-btn-small" onClick={onExportVault}>Export vault as .zip</button>
        </div>
      </section>
      <AiSection vault={vault} account={account} enabled={s.aiEnabled} onEnabled={(v) => set("aiEnabled", v)} />
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

function AiSection({ account, enabled, onEnabled }: { vault: Vault; account: Account | null | undefined; enabled: boolean; onEnabled: (v: boolean) => void }) {
  const [state, setState] = useState<AiState | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (account && enabled) aiApi.state().then(setState).catch(() => setState(null));
  }, [account, enabled]);

  const act = async (fn: () => Promise<AiState>, done?: string) => {
    setBusy(true);
    setError(null);
    try {
      setState(await fn());
      if (done) toast(done);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-section" id="settings-ai">
      <h3>AI study helper</h3>
      <label className="settings-toggle">
        <input type="checkbox" checked={enabled} onChange={(e) => onEnabled(e.target.checked)} />
        <span>
          <strong>Use AI in this vault</strong>
          <small className="w-muted">Off by default. AI only sees the text you send it, when you press a button.</small>
        </span>
      </label>
      {enabled && !account && <p className="w-muted w-small">Sign in to use AI. Requests go through your account so keys stay on the server.</p>}
      {enabled && account && (
        <>
          <div className="option-cards" role="radiogroup" aria-label="Which AI key to use">
            <button
              role="radio"
              aria-checked={state?.mode !== "own"}
              className="option-card w-glow"
              disabled={busy}
              onClick={() => void act(() => aiApi.setMode("builtin"))}
            >
              <span className="option-title"><span className="option-dot" /> Built-in AI</span>
              <span className="option-desc">
                {state && !state.builtinAvailable ? "Not switched on yet on this server." : `Nothing to set up. Up to ${state?.mode === "builtin" ? state.limit : 40} requests a day.`}
              </span>
            </button>
            <button
              role="radio"
              aria-checked={state?.mode === "own"}
              className="option-card w-glow"
              disabled={busy || (!state?.hasOwnKey && state?.mode !== "own")}
              onClick={() => void act(() => aiApi.setMode("own"))}
              title={!state?.hasOwnKey ? "Save a key below first" : undefined}
            >
              <span className="option-title"><span className="option-dot" /> My own API key</span>
              <span className="option-desc">{state?.hasOwnKey ? `Saved key ••••${state.keyHint}` : "Use your Anthropic key. Save one below."}</span>
            </button>
          </div>
          <form
            className="w-col"
            autoComplete="off"
            onSubmit={(e) => {
              e.preventDefault();
              if (key.trim()) void act(() => aiApi.saveKey(key.trim()), "Key saved and switched on.").then(() => setKey(""));
            }}
          >
            <label className="w-field">
              <span>{state?.hasOwnKey ? "Replace your Anthropic API key" : "Your Anthropic API key"}</span>
              <div className="w-row">
                <input
                  type="password"
                  className="w-input"
                  style={{ flex: 1 }}
                  value={key}
                  placeholder="sk-ant-…"
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => setKey(e.target.value)}
                />
                <button className="w-btn w-btn-primary w-btn-small" disabled={busy || !key.trim()}>{busy ? "Checking…" : "Save key"}</button>
              </div>
            </label>
            <p className="w-muted settings-note">
              Your key is checked with Anthropic, then encrypted (AES-256) on our server. It's never sent back to your browser; only its last 4 characters are shown.
            </p>
            {state?.hasOwnKey && (
              <div>
                <button type="button" className="w-btn w-btn-small w-btn-danger" disabled={busy} onClick={() => void act(() => aiApi.removeKey(), "Key removed.")}>Remove my key</button>
              </div>
            )}
          </form>
          {error && <p className="ai-error" role="alert">{error}</p>}
          {state && <p className="w-muted settings-note">{state.usedToday} of {state.limit} requests used today.</p>}
        </>
      )}
    </section>
  );
}
