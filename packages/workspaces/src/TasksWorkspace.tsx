import { useEffect, useMemo, useRef, useState } from "react";
import type { Task } from "@writalin/shared";
import { isoDate, addDays, noteName } from "@writalin/shared";
import { taskDate, tagMatches, formatTaskLine, REMINDERS_PATH, TASKS_PATH, isScratch } from "@writalin/vault";
import { Icon, toast } from "@writalin/ui";
import type { WorkspaceProps } from "./types";
import { removeWithUndo } from "./undo";

type Group = "Overdue" | "Today" | "Upcoming" | "No date" | "Done";
/** All tasks, the vault-wide list (Tasks.md), or just the open note's. */
type Scope = "all" | "vault" | "note";

function groupOf(t: Task, today: string): Group {
  if (t.status === "done") return "Done";
  const d = taskDate(t);
  if (!d) return "No date";
  if (d < today) return "Overdue";
  if (d === today) return "Today";
  return "Upcoming";
}

/**
 * Vault-wide tasks (kept in Tasks.md) and each note's own checklist, as
 * cards. Checking or deleting one updates the file it lives in.
 * `focusAdd` changing puts the cursor in the "Add a task" box.
 */
export function TasksWorkspace({ vault, version, openNote, currentNote, appendToNote, flushNote, focusAdd }: WorkspaceProps & { focusAdd?: number }) {
  const [scope, setScope] = useState<Scope>(currentNote ? "note" : "all");
  const [tag, setTag] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftDate, setDraftDate] = useState("");
  const [target, setTarget] = useState<"vault" | "note">(currentNote ? "note" : "vault");
  /** Without an open note (the Tasks zone), pick which note "This note" means. */
  const [picked, setPicked] = useState("");
  const note = currentNote ?? (picked || null);
  const input = useRef<HTMLInputElement>(null);
  const today = isoDate();

  useEffect(() => {
    if (focusAdd) input.current?.focus();
  }, [focusAdd]);
  useEffect(() => {
    if (!note) {
      setScope((s) => (s === "note" ? "all" : s));
      setTarget("vault");
    }
  }, [note]);

  // Reminders live in the Calendar; scratch pads aren't task lists.
  const tasks = useMemo(() => vault.allTasks().filter((t) => t.path !== REMINDERS_PATH && !isScratch(t.path)), [vault, version]);
  const tags = useMemo(() => [...new Set(tasks.flatMap((t) => t.tags.map((x) => x.toLowerCase())))].sort(), [tasks]);
  const notes = useMemo(() => [...vault.notes.values()].filter((n) => n.path !== TASKS_PATH && n.path !== REMINDERS_PATH && !isScratch(n.path)).map((n) => n.path).sort((a, b) => noteName(a).localeCompare(noteName(b))), [vault, version]);
  const counts = {
    all: tasks.filter((t) => t.status === "todo").length,
    vault: tasks.filter((t) => t.status === "todo" && t.path === TASKS_PATH).length,
    note: tasks.filter((t) => t.status === "todo" && t.path === note).length,
  };

  const inScope = (t: Task) => scope === "all" || (scope === "vault" ? t.path === TASKS_PATH : t.path === note);
  const filtered = tasks.filter((t) => inScope(t) && (!tag || t.tags.some((x) => tagMatches(x, tag))));
  const groups = new Map<Group, Task[]>();
  for (const g of ["Overdue", "Today", "Upcoming", "No date", "Done"] as Group[]) groups.set(g, []);
  for (const t of filtered) groups.get(groupOf(t, today))!.push(t);
  for (const list of groups.values()) list.sort((a, b) => (taskDate(a) ?? "9999").localeCompare(taskDate(b) ?? "9999") || (a.time ?? "").localeCompare(b.time ?? ""));

  /** Save the open note first, so a change to its file doesn't race the editor. */
  const settle = async (t: Task) => {
    if (t.path === currentNote) await flushNote?.();
  };
  const toggle = async (t: Task) => {
    await settle(t);
    await vault.toggleTask(t).catch((e) => toast((e as Error).message, { tone: "warn" }));
  };
  const remove = async (t: Task) => {
    await settle(t);
    await removeWithUndo(vault, t.path, "Task", () => vault.deleteTask(t));
  };

  const add = async () => {
    if (!draft.trim()) return;
    const line = formatTaskLine({ text: draft, due: draftDate || undefined, tags: tag ? [tag] : [] });
    if (target === "note" && note) {
      if (note === currentNote && appendToNote) appendToNote(line);
      else await vault.append(note, line);
    } else await vault.appendTo(TASKS_PATH, line);
    setDraft("");
    setDraftDate("");
    input.current?.focus();
  };

  const scopes: { id: Scope; label: string }[] = [
    { id: "all", label: "All" },
    { id: "vault", label: "Vault" },
    ...(note ? [{ id: "note" as const, label: currentNote ? "This note" : noteName(note) }] : []),
  ];

  return (
    <div className="ws ws-tasks">
      <div className="ws-toolbar">
        <div className="w-row" role="group" aria-label="Which tasks">
          {scopes.map((s) => (
            <button key={s.id} className="w-chip" aria-pressed={scope === s.id} onClick={() => { setScope(s.id); if (s.id !== "all") setTarget(s.id); }}>
              {s.label} <span className="w-muted">{counts[s.id]}</span>
            </button>
          ))}
        </div>
        {!currentNote && (
          <select className="w-input" value={picked} onChange={(e) => { setPicked(e.target.value); setScope(e.target.value ? "note" : "all"); setTarget(e.target.value ? "note" : "vault"); }} aria-label="A note's tasks">
            <option value="">Pick a note…</option>
            {notes.map((p) => <option key={p} value={p}>{noteName(p)}</option>)}
          </select>
        )}
        {tags.length > 0 && (
          <select className="w-input" value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Filter by tag">
            <option value="">All tags</option>
            {tags.map((t) => (
              <option key={t} value={t}>#{t}</option>
            ))}
          </select>
        )}
        <label className="ws-check">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show done
        </label>
      </div>
      <form className="ws-quick-add" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <input ref={input} className="w-input" placeholder="Add a task…" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="New task" />
        <input className="w-input" type="date" value={draftDate} onChange={(e) => setDraftDate(e.target.value)} aria-label="Due date" />
        {note && (
          <select className="w-input" value={target} onChange={(e) => setTarget(e.target.value as "vault" | "note")} aria-label="Add to">
            <option value="vault">To vault</option>
            <option value="note">{currentNote ? "To this note" : `To ${noteName(note)}`}</option>
          </select>
        )}
        <button className="w-btn w-btn-primary" disabled={!draft.trim()}><Icon name="plus" size={14} /> Add</button>
      </form>
      <div className="ws-scroll">
        {filtered.length === 0 && (
          <p className="w-muted ws-empty">
            {scope === "note" ? "No tasks in this note yet. Add one above, or type - [ ] in the note." : scope === "vault" ? "No vault tasks yet. They belong to no single note." : "No tasks yet. Add one above."}
          </p>
        )}
        {[...groups].map(([g, list]) => {
          if (g === "Done" && !showDone) return null;
          if (!list.length) return null;
          return (
            <section key={g} className="task-group">
              <h3>{g} <span className="w-muted">{list.length}</span></h3>
              <ul className="task-cards">
                {list.map((t) => (
                  <li key={`${t.path}:${t.line}`} className={`task-card${t.status === "done" ? " done" : ""}`}>
                    <input type="checkbox" checked={t.status === "done"} onChange={() => void toggle(t)} aria-label={`${t.status === "done" ? "Reopen" : "Complete"}: ${t.text}`} />
                    <div className="task-body">
                      <div className="task-text">{t.text.replace(/\s*#[^\s#]+/g, "").replace(/\[\[([^\]|]+)(\|([^\]]+))?\]\]/g, (_, a, __, b) => b ?? a)}</div>
                      <div className="task-meta">
                        {taskDate(t) && <span className={taskDate(t)! < today && t.status !== "done" ? "task-late" : ""}>{friendlyDate(taskDate(t)!, today)}{t.time ? ` · ${t.time}` : ""}</span>}
                        {t.tags.map((x) => <span key={x} className="task-tag">#{x}</span>)}
                        {t.path === TASKS_PATH ? (
                          <span className="task-scope">Vault</span>
                        ) : (
                          <button className="task-source" onClick={() => openNote(t.path, { line: t.line })}>{noteName(t.path)}</button>
                        )}
                      </div>
                    </div>
                    <button className="task-delete" onClick={() => void remove(t)} aria-label={`Delete task: ${t.text}`} title="Delete task">
                      <Icon name="trash" size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

export function friendlyDate(d: string, today = isoDate()): string {
  if (d === today) return "Today";
  if (d === isoDate(addDays(new Date(), 1))) return "Tomorrow";
  if (d === isoDate(addDays(new Date(), -1))) return "Yesterday";
  const date = new Date(`${d}T00:00`);
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
