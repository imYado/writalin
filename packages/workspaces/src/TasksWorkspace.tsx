import { useEffect, useMemo, useRef, useState } from "react";
import type { Task } from "@writalin/shared";
import { isoDate, addDays, noteName } from "@writalin/shared";
import { taskDate, tagMatches, formatTaskLine } from "@writalin/vault";
import { Icon, toast } from "@writalin/ui";
import type { WorkspaceProps } from "./types";
import { removeWithUndo } from "./undo";

type Group = "Overdue" | "Today" | "Upcoming" | "No date" | "Done";

function groupOf(t: Task, today: string): Group {
  if (t.status === "done") return "Done";
  const d = taskDate(t);
  if (!d) return "No date";
  if (d < today) return "Overdue";
  if (d === today) return "Today";
  return "Upcoming";
}

/**
 * The open note's checklist, as cards. Tasks always belong to a note: adding
 * one appends `- [ ]` to the note, and checking or deleting one edits it there.
 * `focusAdd` changing puts the cursor in the "Add a task" box.
 */
export function TasksWorkspace({ vault, version, currentNote, appendToNote, flushNote, focusAdd }: WorkspaceProps & { focusAdd?: number }) {
  const [tag, setTag] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftDate, setDraftDate] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const today = isoDate();

  useEffect(() => {
    if (focusAdd) input.current?.focus();
  }, [focusAdd]);

  const tasks = useMemo(() => (currentNote ? vault.allTasks().filter((t) => t.path === currentNote) : []), [vault, version, currentNote]);
  const tags = useMemo(() => [...new Set(tasks.flatMap((t) => t.tags.map((x) => x.toLowerCase())))].sort(), [tasks]);
  const open = tasks.filter((t) => t.status === "todo").length;

  const filtered = tasks.filter((t) => !tag || t.tags.some((x) => tagMatches(x, tag)));
  const groups = new Map<Group, Task[]>();
  for (const g of ["Overdue", "Today", "Upcoming", "No date", "Done"] as Group[]) groups.set(g, []);
  for (const t of filtered) groups.get(groupOf(t, today))!.push(t);
  for (const list of groups.values()) list.sort((a, b) => (taskDate(a) ?? "9999").localeCompare(taskDate(b) ?? "9999") || (a.time ?? "").localeCompare(b.time ?? ""));

  /** Save the note first, so a change to its file doesn't race the editor. */
  const toggle = async (t: Task) => {
    await flushNote?.();
    await vault.toggleTask(t).catch((e) => toast((e as Error).message, { tone: "warn" }));
  };
  const remove = async (t: Task) => {
    await flushNote?.();
    await removeWithUndo(vault, t.path, "Task", () => vault.deleteTask(t));
  };

  const add = async () => {
    if (!draft.trim() || !currentNote) return;
    const line = formatTaskLine({ text: draft, due: draftDate || undefined, tags: tag ? [tag] : [] });
    if (appendToNote) appendToNote(line);
    else await vault.append(currentNote, line);
    setDraft("");
    setDraftDate("");
    input.current?.focus();
  };

  if (!currentNote) {
    return (
      <div className="ws ws-tasks">
        <p className="w-muted ws-empty">Tasks belong to a note. Open a note to see and add its tasks.</p>
      </div>
    );
  }

  return (
    <div className="ws ws-tasks">
      <div className="ws-toolbar">
        <span className="ws-title">Tasks in “{noteName(currentNote)}” <span className="w-muted">{open}</span></span>
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
        <input ref={input} className="w-input" placeholder="Add a task to this note…" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="New task" />
        <input className="w-input" type="date" value={draftDate} onChange={(e) => setDraftDate(e.target.value)} aria-label="Due date" />
        <button className="w-btn w-btn-primary" disabled={!draft.trim()}><Icon name="plus" size={14} /> Add</button>
      </form>
      <div className="ws-scroll">
        {filtered.length === 0 && <p className="w-muted ws-empty">No tasks in this note yet. Add one above, or type - [ ] in the note.</p>}
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
