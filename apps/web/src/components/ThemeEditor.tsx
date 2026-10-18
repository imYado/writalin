import { useEffect, useMemo, useState } from "react";
import { applyTheme, contrastWarnings, findTheme, Modal, parseThemeFile, THEME_TOKENS, toast, type Theme, type ThemeToken } from "@writalin/ui";
import { THEMES_DIR, type Vault } from "@writalin/vault";
import { uid } from "@writalin/shared";
import { download } from "../export";

const isPlainColor = (v: string) => /^#[0-9a-f]{6}$/i.test(v);

/** Every token editable, gradients allowed for backgrounds, live preview and contrast warnings. */
export function ThemeEditor({ vault, base, onClose, onSaved }: { vault: Vault; base: Theme; onClose: () => void; onSaved: (t: Theme) => void }) {
  const [theme, setTheme] = useState<Theme>(() =>
    base.id.startsWith("custom-") ? base : { ...base, id: `custom-${uid()}`, name: `${base.name} (custom)`, tokens: { ...base.tokens } },
  );
  const warnings = useMemo(() => contrastWarnings(theme.tokens), [theme.tokens]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  useEffect(() => () => applyTheme(findTheme(vault.settings.theme)), [vault]);

  const setToken = (k: ThemeToken, v: string) => setTheme((t) => ({ ...t, tokens: { ...t.tokens, [k]: v } }));

  const save = async () => {
    await vault.writeJson(`${THEMES_DIR}/${theme.id}.json`, theme);
    await vault.saveSettings({ theme: theme.id });
    onSaved(theme);
    toast("Theme saved.");
    onClose();
  };

  return (
    <Modal title="Custom theme" onClose={onClose} width={640}>
      <div className="w-row">
        <label className="w-field" style={{ flex: 1 }}>
          <span>Name</span>
          <input value={theme.name} onChange={(e) => setTheme((t) => ({ ...t, name: e.target.value }))} />
        </label>
        <label className="w-field">
          <span>Base</span>
          <select value={theme.base} onChange={(e) => setTheme((t) => ({ ...t, base: e.target.value as Theme["base"] }))}>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
      </div>
      {warnings.length > 0 && (
        <div className="theme-warn" role="status">
          Hard to read: {warnings.map((w) => `${w.label} (${w.ratio}:1)`).join(", ")}. Aim for at least 4.5:1.
        </div>
      )}
      <div className="token-grid">
        {(Object.keys(THEME_TOKENS) as ThemeToken[]).map((k) => {
          const v = theme.tokens[k];
          const isOpacity = k === "focus-dim";
          return (
            <label key={k} className="token-row">
              <span>{THEME_TOKENS[k]}</span>
              {isOpacity ? (
                <input type="range" min={0.1} max={0.8} step={0.05} value={Number(v)} onChange={(e) => setToken(k, e.target.value)} />
              ) : (
                <>
                  <input type="color" value={isPlainColor(v) ? v : "#888888"} onChange={(e) => setToken(k, e.target.value)} aria-label={`${THEME_TOKENS[k]} color`} />
                  <input className="w-input token-text" value={v} onChange={(e) => setToken(k, e.target.value)} aria-label={`${THEME_TOKENS[k]} value`} placeholder="#hex or linear-gradient(…)" />
                </>
              )}
            </label>
          );
        })}
      </div>
      <p className="w-muted settings-note">Tip: backgrounds accept gradients, e.g. linear-gradient(160deg, #fbf5e6, #efe6d2).</p>
      <div className="w-row" style={{ justifyContent: "space-between" }}>
        <div className="w-row">
          <button className="w-btn w-btn-small" onClick={() => download(`${theme.name}.json`, JSON.stringify(theme, null, 2), "application/json")}>Export</button>
          <label className="w-btn w-btn-small">
            Import
            <input
              type="file"
              accept=".json,application/json"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const t = parseThemeFile(await f.text(), `custom-${uid()}`);
                if (t) setTheme({ ...t, id: t.id.startsWith("custom-") ? t.id : `custom-${uid()}` });
                else toast("That file isn't a Writalin theme.", { tone: "warn" });
              }}
            />
          </label>
        </div>
        <div className="w-row">
          <button className="w-btn" onClick={onClose}>Cancel</button>
          <button className="w-btn w-btn-primary" onClick={() => void save()}>Save theme</button>
        </div>
      </div>
    </Modal>
  );
}

export async function loadCustomThemes(vault: Vault): Promise<Theme[]> {
  const out: Theme[] = [];
  for (const f of await vault.store.list()) {
    if (!f.path.startsWith(`${THEMES_DIR}/`) || !f.path.endsWith(".json")) continue;
    const t = parseThemeFile(await vault.store.readText(f.path), f.path.split("/").pop()!.replace(/\.json$/, ""));
    if (t) out.push(t);
  }
  return out;
}
