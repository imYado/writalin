import { useMemo, useState } from "react";
import type { Task } from "@writalin/shared";
import { isoDate, addDays, noteName } from "@writalin/shared";
import { taskDate, tagMatches, formatTaskLine } from "@writalin/vault";
import { toast } from "@writalin/ui";
import type { WorkspaceProps } from "./types";

type Group = "Overdue" | "Today" | "Upcoming" | "No date" | "Done";

function groupOf(t: Task, today: string): Group {
  if (t.status === "done") return "Done";
  const d = taskDate(t);
  if (!d) return "No date";
  if (d < today) return "Overdue";
  if (d === today) return "Today";
  return "Upcoming";
}

/** Every checklist item in the vault as its own card. Checking one updates its note. */
export function TasksWorkspace({ vault, version, openNote }: WorkspaceProps) {
  const [tag, setTag] = useState("");
  const [note, setNote] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftDate, setDraftDate] = useState("");
  const today = isoDate();

  const tasks = useMemo(() => vault.allTasks(), [vault, version]);
  const tags = useMemo(() => [...new Set(tasks.flatMap((t) => t.tags.map((x) => x.toLowerCase())))].sort(), [tasks]);
  const notes = useMemo(() => [...new Set(tasks.map((t) => t.path))].sort(), [tasks]);

  const filtered = tasks.filter((t) => (!tag || t.tags.some((x) => tagMatches(x, tag))) && (!note || t.path === note));
  const groups = new Map<Group, Task[]>();
  for (const g of ["Overdue", "Today", "Upcoming", "No date", "Done"] as Group[]) groups.set(g, []);
  for (const t of filtered) groups.get(groupOf(t, today))!.push(t);
  for (const list of groups.values()) list.sort((a, b) => (taskDate(a) ?? "9999").localeCompare(taskDate(b) ?? "9999") || (a.time ?? "").localeCompare(b.time ?? ""));

  const toggle = async (t: Task) => {
    try {
      await vault.toggleTask(t);
    } catch (e) {
      toast((e as Error).message, { tone: "warn" });
    }
  };

  const add = async () => {
    if (!draft.trim()) return;
    // Quick-added tasks live in the Tasks note so they show everywhere tasks do.
    const path = vault.files.has("Tasks.md") ? "Tasks.md" : await vault.createNote("Tasks", { folder: "" });
    await vault.append(path, formatTaskLine({ text: draft, due: draftDate || undefined, tags: tag ? [tag] : [] }));
    setDraft("");
  };

  return (
    <div className="ws ws-tasks">
      <div className="ws-toolbar">
        <select className="w-input" value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Filter by tag">
          <option value="">All tags</option>
          {tags.map((t) => (
            <option key={t} value={t}>#{t}</option>
          ))}
        </select>
        <select className="w-input" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Filter by note">
          <option value="">All notes</option>
          {notes.map((p) => (
            <option key={p} value={p}>{noteName(p)}</option>
          ))}
        </select>
        <label className="ws-check">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show done
        </label>
      </div>
      <form className="ws-quick-add" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <input className="w-input" placeholder="Add a task…" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="New task" />
        <input className="w-input" type="date" value={draftDate} onChange={(e) => setDraftDate(e.target.value)} aria-label="Due date" />
        <button className="w-btn" disabled={!draft.trim()}>Add</button>
      </form>
      <div className="ws-scroll">
        {[...groups].map(([g, list]) => {
          if (g === "Done" && !showDone) return null;
          if (!list.length) return g === "Today" ? (
            <section key={g} className="task-group"><h3>Today</h3><p className="w-muted ws-empty">Nothing due today.</p></section>
          ) : null;
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
                        <button className="task-source" onClick={() => openNote(t.path, { line: t.line })}>{noteName(t.path)}</button>
                      </div>
                    </div>
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
