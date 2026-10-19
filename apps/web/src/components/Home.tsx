import { useMemo, useState } from "react";
import type { VaultRecord, Vault } from "@writalin/vault";
import { isSystemNote, tagMatches, taskDate, TASKS_PATH } from "@writalin/vault";
import { isoDate, noteName, dirname, type VaultPath } from "@writalin/shared";
import { Icon, toast } from "@writalin/ui";
import { ContributionGraph, useContributions } from "@writalin/workspaces";

interface Props {
  vault: Vault;
  version: number;
  records: VaultRecord[];
  currentId: string;
  onSwitchVault: (rec: VaultRecord | "new-folder" | "new-browser") => void;
  onOpen: (path: VaultPath, opts?: { line?: number }) => void;
  onNewNote: (folder?: string) => void;
  onDelete: (path: VaultPath) => void;
  onZone: (zone: "calendar" | "activity") => void;
  initialTag?: string;
}

function greeting(): string {
  const h = new Date().getHours();
  return h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** Vault switcher, folders, recent notes, tags, search and today's tasks. */
export function Home({ vault, version, records, currentId, onSwitchVault, onOpen, onNewNote, onDelete, onZone, initialTag }: Props) {
  const activity = useContributions(vault, version, 52, "both");
  const todayWords = vault.activity.days[isoDate()]?.words ?? 0;
  const [q, setQ] = useState("");
  const [tag, setTag] = useState(initialTag ?? "");
  const [folder, setFolder] = useState<string | null>(null);
  const today = isoDate();

  const tags = useMemo(() => [...vault.tagCounts()].slice(0, 40), [vault, version]);
  const folders = useMemo(() => vault.folders().filter((f) => !f.startsWith("attachments")), [vault, version]);
  const hits = useMemo(() => (q.trim() ? vault.search.search(q, 20) : []), [vault, version, q]);
  const notes = useMemo(() => {
    let list = [...vault.notes.values()];
    if (tag) list = list.filter((n) => n.tags.some((t) => tagMatches(t, tag)));
    if (folder != null) list = list.filter((n) => dirname(n.path) === folder);
    return list.filter((n) => !isSystemNote(n.path)).sort((a, b) => b.mtime - a.mtime).slice(0, tag || folder != null ? 200 : 12);
  }, [vault, version, tag, folder]);
  const dueToday = useMemo(
    () => vault.allTasks().filter((t) => t.status === "todo" && t.path !== TASKS_PATH && taskDate(t) != null && taskDate(t)! <= today).sort((a, b) => (taskDate(a)! + (a.time ?? "")).localeCompare(taskDate(b)! + (b.time ?? ""))),
    [vault, version, today],
  );

  return (
    <div className="home">
      <div className="home-inner">
        <header className="home-head">
          <div>
            <h1 className="home-title">{greeting()}</h1>
            <div className="vault-switch">
            <label className="w-sr-only" htmlFor="vault-select">Vault</label>
            <select
              id="vault-select"
              className="w-input"
              value={currentId}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "new-folder" || v === "new-browser") onSwitchVault(v);
                else onSwitchVault(records.find((r) => r.id === v)!);
              }}
            >
              {records.map((r) => (
                <option key={r.id} value={r.id}>{r.name}{r.kind === "browser" ? " (in browser)" : ""}</option>
              ))}
              <option value="new-folder">Open another folder…</option>
              <option value="new-browser">New vault in this browser…</option>
            </select>
            </div>
          </div>
        </header>

        <div className="home-search w-glow">
          <Icon name="search" />
          <input className="w-input" placeholder="Search notes…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search notes" />
        </div>

        {q.trim() ? (
          <section className="home-section">
            <h2>Results</h2>
            {hits.length === 0 && <p className="w-muted">No notes match “{q}”.</p>}
            <ul className="note-list">
              {hits.map((h) => (
                <li key={h.path}>
                  <button className="w-glow" onClick={() => onOpen(h.path)}>
                    <span className="note-list-name">{noteName(h.path)}</span>
                    <span className="note-list-snippet">{h.snippet}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <>
          <section className="home-card home-activity">
            <div className="home-card-head">
              <div>
                <h2>Your writing</h2>
                <p className="w-muted w-small">
                  {todayWords > 0 ? `${todayWords.toLocaleString()} words today` : "Nothing written yet today"}
                  {activity.currentStreak > 1 ? ` · ${activity.currentStreak}-day streak` : ""}
                </p>
              </div>
              <button className="w-btn w-btn-small w-btn-ghost" onClick={() => onZone("activity")}>
                See all <Icon name="chevronRight" size={14} />
              </button>
            </div>
            <div className="contrib-mini"><ContributionGraph summary={activity} /></div>
          </section>
          <div className="home-grid">
            <section className="home-section">
              <h2 className="home-h2-row">
                {tag ? `#${tag}` : folder != null ? folder || "Top level" : "Recent"}
                {folder != null && <button className="w-btn w-btn-small w-btn-ghost" onClick={() => onNewNote(folder || undefined)}><Icon name="plus" size={14} /> New note here</button>}
              </h2>
              {notes.length === 0 && (
                <p className="w-muted">
                  {vault.notes.size ? "Nothing here yet." : <>Your vault is empty. <button className="w-link" onClick={() => onNewNote()}>Start a new note</button>.</>}
                </p>
              )}
              <ul className="note-list">
                {notes.map((n) => (
                  <li key={n.path} className="note-list-row">
                    <button className="w-glow" onClick={() => onOpen(n.path)}>
                      <span className="note-list-name">{n.name}</span>
                      <span className="note-list-meta">{dirname(n.path) || "—"} · {new Date(n.mtime).toLocaleDateString()}</span>
                    </button>
                    <button className="note-list-del" onClick={() => onDelete(n.path)} aria-label={`Delete ${n.name}`} title="Delete note">
                      <Icon name="trash" size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
            <aside className="home-side">
              <section className="home-section">
                <h2 className="home-h2-row">Today <button className="w-btn w-btn-small w-btn-ghost" onClick={() => onZone("calendar")}>Calendar <Icon name="chevronRight" size={14} /></button></h2>
                {dueToday.length === 0 ? (
                  <p className="w-muted">Nothing due. Enjoy the calm.</p>
                ) : (
                  <ul className="today-list">
                    {dueToday.slice(0, 8).map((t) => (
                      <li key={`${t.path}:${t.line}`}>
                        <input
                          type="checkbox"
                          aria-label={`Complete: ${t.text}`}
                          onChange={() => void vault.toggleTask(t).catch((e) => toast((e as Error).message, { tone: "warn" }))}
                        />
                        <button onClick={() => onOpen(t.path, { line: t.line })}>
                          {t.time && <span className="w-muted">{t.time} </span>}
                          {t.text}
                          {taskDate(t)! < today && <span className="task-late"> · overdue</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              {folders.length > 0 && (
                <section className="home-section">
                  <h2>Folders</h2>
                  <div className="chip-wrap">
                    <button className="w-chip" aria-pressed={folder === ""} onClick={() => setFolder((f) => (f === "" ? null : ""))}>Top level</button>
                    {folders.map((f) => (
                      <button key={f} className="w-chip" aria-pressed={folder === f} onClick={() => { setFolder((x) => (x === f ? null : f)); setTag(""); }}>
                        <Icon name="folder" size={12} /> {f}
                      </button>
                    ))}
                  </div>
                </section>
              )}
              {tags.length > 0 && (
                <section className="home-section">
                  <h2>Tags</h2>
                  <div className="chip-wrap">
                    {tags.map(([t, n]) => (
                      <button key={t} className="w-chip" aria-pressed={tag === t} onClick={() => { setTag((x) => (x === t ? "" : t)); setFolder(null); }}>
                        #{t} <span className="w-muted">{n}</span>
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </aside>
          </div>
          </>
        )}
      </div>
    </div>
  );
}
