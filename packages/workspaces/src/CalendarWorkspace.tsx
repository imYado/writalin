import { useMemo, useState } from "react";
import type { NoteMeta, Task } from "@writalin/shared";
import { addDays, isoDate, parseIsoDate, startOfWeek, noteName } from "@writalin/shared";
import { formatTaskLine, tagMatches, taskDate } from "@writalin/vault";
import { Modal, toast } from "@writalin/ui";
import type { WorkspaceProps } from "./types";

type View = "month" | "week" | "day";

interface DayItems {
  notes: NoteMeta[];
  tasks: Task[];
}

/** Notes on the day they were created, plus reminders/events (dated task lines). */
export function CalendarWorkspace({ vault, version, openNote, currentNote }: WorkspaceProps) {
  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState(() => new Date());
  const [tag, setTag] = useState("");
  const [adding, setAdding] = useState<string | null>(null);

  const byDay = useMemo(() => {
    const map = new Map<string, DayItems>();
    const get = (d: string) => map.get(d) ?? (map.set(d, { notes: [], tasks: [] }), map.get(d)!);
    for (const n of vault.notes.values()) {
      if (tag && !n.tags.some((t) => tagMatches(t, tag))) continue;
      const created = typeof n.frontmatter.created === "string" ? n.frontmatter.created.slice(0, 10) : isoDate(new Date(n.mtime));
      get(created).notes.push(n);
      for (const t of n.tasks) {
        const d = taskDate(t);
        if (d && (!tag || t.tags.some((x) => tagMatches(x, tag)) || n.tags.some((x) => tagMatches(x, tag)))) get(d).tasks.push(t);
      }
    }
    return map;
  }, [vault, version, tag]);

  const tags = useMemo(() => [...vault.tagCounts().keys()], [vault, version]);
  const today = isoDate();

  const days: Date[] = [];
  if (view === "month") {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = startOfWeek(first);
    for (let i = 0; i < 42; i++) days.push(addDays(start, i));
  } else if (view === "week") {
    const start = startOfWeek(cursor);
    for (let i = 0; i < 7; i++) days.push(addDays(start, i));
  } else days.push(cursor);

  const step = (dir: number) => {
    const d = new Date(cursor);
    if (view === "month") d.setMonth(d.getMonth() + dir);
    else d.setDate(d.getDate() + dir * (view === "week" ? 7 : 1));
    setCursor(d);
  };

  const title =
    view === "month"
      ? cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })
      : view === "week"
        ? `Week of ${startOfWeek(cursor).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
        : cursor.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="ws ws-calendar">
      <div className="ws-toolbar">
        <button className="w-icon-btn" onClick={() => step(-1)} aria-label="Previous">‹</button>
        <button className="w-btn w-btn-small" onClick={() => setCursor(new Date())}>Today</button>
        <button className="w-icon-btn" onClick={() => step(1)} aria-label="Next">›</button>
        <h2 className="cal-title">{title}</h2>
        <div className="w-row cal-views" role="group" aria-label="Calendar view">
          {(["month", "week", "day"] as View[]).map((v) => (
            <button key={v} className="w-chip" aria-pressed={view === v} onClick={() => setView(v)}>{v[0]!.toUpperCase() + v.slice(1)}</button>
          ))}
        </div>
        <select className="w-input" value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Filter by tag">
          <option value="">All tags</option>
          {tags.map((t) => <option key={t} value={t}>#{t}</option>)}
        </select>
      </div>
      <div className={`cal-grid cal-${view}`} role="grid">
        {view !== "day" &&
          days.slice(0, 7).map((d) => (
            <div key={`h${d.getDay()}`} className="cal-dow" role="columnheader">
              {d.toLocaleDateString(undefined, { weekday: "short" })}
            </div>
          ))}
        {days.map((d) => {
          const key = isoDate(d);
          const items = byDay.get(key);
          const outside = view === "month" && d.getMonth() !== cursor.getMonth();
          const limit = view === "month" ? 3 : 50;
          const entries = [
            ...(items?.tasks ?? []).map((t) => ({ kind: "task" as const, t })),
            ...(items?.notes ?? []).map((n) => ({ kind: "note" as const, n })),
          ];
          return (
            <div key={key} role="gridcell" className={`cal-day${outside ? " outside" : ""}${key === today ? " today" : ""}`}>
              <div className="cal-day-head">
                <button className="cal-date" onClick={() => { setCursor(d); setView("day"); }} aria-label={d.toDateString()}>
                  {d.getDate()}
                </button>
                <button className="cal-add" onClick={() => setAdding(key)} aria-label={`Add reminder on ${d.toDateString()}`}>+</button>
              </div>
              <ul className="cal-items">
                {entries.slice(0, limit).map((e) =>
                  e.kind === "task" ? (
                    <li key={`t${e.t.path}${e.t.line}`} className={`cal-task${e.t.status === "done" ? " done" : ""}`}>
                      <button onClick={() => openNote(e.t.path, { line: e.t.line })} title={e.t.text}>
                        {e.t.time && <span className="cal-time">{e.t.time}</span>}
                        {e.t.text.replace(/\[\[([^\]|]+)(\|([^\]]+))?\]\]/g, (_, a, __, b) => b ?? a)}
                      </button>
                    </li>
                  ) : (
                    <li key={`n${e.n.path}`} className="cal-note">
                      <button onClick={() => openNote(e.n.path)} title={e.n.path}>{e.n.name}</button>
                    </li>
                  ),
                )}
                {entries.length > limit && (
                  <li><button className="cal-more" onClick={() => { setCursor(d); setView("day"); }}>+{entries.length - limit} more</button></li>
                )}
              </ul>
            </div>
          );
        })}
      </div>
      {adding && (
        <AddReminder
          date={adding}
          defaultLink={currentNote ? noteName(currentNote) : ""}
          noteNames={[...vault.notes.values()].map((n) => n.name)}
          onClose={() => setAdding(null)}
          onSave={async (line) => {
            const path = vault.files.has("Reminders.md") ? "Reminders.md" : await vault.createNote("Reminders", { folder: "" });
            await vault.append(path, line);
            toast("Reminder added.");
            setAdding(null);
          }}
        />
      )}
    </div>
  );
}

function AddReminder({ date, defaultLink, noteNames, onClose, onSave }: {
  date: string;
  defaultLink: string;
  noteNames: string[];
  onClose: () => void;
  onSave: (line: string) => void;
}) {
  const [text, setText] = useState("");
  const [d, setD] = useState(date);
  const [time, setTime] = useState("");
  const [tags, setTags] = useState("");
  const [link, setLink] = useState(defaultLink);
  const valid = text.trim() && parseIsoDate(d);
  return (
    <Modal title="Add reminder or event" onClose={onClose} width={440}>
      <form
        className="w-col"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSave(formatTaskLine({ text, due: d, time: time || undefined, tags: tags.split(/[\s,]+/).filter(Boolean), link: link || undefined }));
        }}
      >
        <label className="w-field"><span>What</span><input value={text} onChange={(e) => setText(e.target.value)} placeholder="Essay due" required /></label>
        <div className="w-row">
          <label className="w-field"><span>Date</span><input type="date" value={d} onChange={(e) => setD(e.target.value)} required /></label>
          <label className="w-field"><span>Time (optional)</span><input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
        </div>
        <label className="w-field"><span>Tags</span><input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="history exam" /></label>
        <label className="w-field">
          <span>Link to note</span>
          <input list="reminder-notes" value={link} onChange={(e) => setLink(e.target.value)} placeholder="None" />
          <datalist id="reminder-notes">{noteNames.map((n) => <option key={n} value={n} />)}</datalist>
        </label>
        <div className="w-row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="w-btn" onClick={onClose}>Cancel</button>
          <button className="w-btn w-btn-primary" disabled={!valid}>Add</button>
        </div>
      </form>
    </Modal>
  );
}
