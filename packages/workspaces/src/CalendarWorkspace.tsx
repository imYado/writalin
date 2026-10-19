import { useEffect, useMemo, useState } from "react";
import type { NoteMeta, Task } from "@writalin/shared";
import { addDays, isoDate, parseIsoDate, startOfWeek, noteName } from "@writalin/shared";
import { createdDay, formatTaskLine, isSystemNote, newBlockId, REMINDERS_PATH, tagMatches, taskDate, type Vault } from "@writalin/vault";
import { Icon, Modal, toast } from "@writalin/ui";
import type { WorkspaceProps } from "./types";
import { removeWithUndo } from "./undo";

type View = "month" | "week" | "day";

interface DayItems {
  notes: NoteMeta[];
  tasks: Task[];
}

const linkText = (s: string) => s.replace(/\[\[([^\]|]+)(\|([^\]]+))?\]\]/g, (_, a, __, b) => b ?? a);
const isReminder = (t: Task) => t.path === REMINDERS_PATH;

/**
 * Notes on the day they were created, plus reminders/events (dated task
 * lines). `standalone` is the full-page Calendar zone: bigger grid, and a
 * side panel with the selected day and what's coming up.
 */
export function CalendarWorkspace({ vault, version, openNote, standalone = false, focusDate }: WorkspaceProps & { standalone?: boolean; focusDate?: { date: string; nonce: number } }) {
  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState(() => new Date());
  const [selected, setSelected] = useState(() => isoDate());
  const [tag, setTag] = useState("");
  const [adding, setAdding] = useState<string | null>(null);

  // Opened from a reminder link in a note: show that day.
  useEffect(() => {
    const d = focusDate && parseIsoDate(focusDate.date);
    if (!d) return;
    setCursor(d);
    setSelected(focusDate!.date);
    if (!standalone) setView("day");
  }, [focusDate?.nonce]);

  const byDay = useMemo(() => {
    const map = new Map<string, DayItems>();
    const get = (d: string) => map.get(d) ?? (map.set(d, { notes: [], tasks: [] }), map.get(d)!);
    for (const n of vault.notes.values()) {
      if (tag && !n.tags.some((t) => tagMatches(t, tag))) continue;
      const created = createdDay(n) ?? isoDate(new Date(n.mtime));
      if (!isSystemNote(n.path)) get(created).notes.push(n);
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
    <div className={`ws ws-calendar${standalone ? " cal-standalone" : ""}`}>
      <div className="ws-toolbar">
        <h2 className="cal-title">{title}</h2>
        <div className="cal-nav">
          <button className="w-icon-btn" onClick={() => step(-1)} aria-label="Previous"><Icon name="chevronLeft" size={16} /></button>
          <button className="w-btn w-btn-small" onClick={() => { setCursor(new Date()); setSelected(today); }}>Today</button>
          <button className="w-icon-btn" onClick={() => step(1)} aria-label="Next"><Icon name="chevronRight" size={16} /></button>
        </div>
        <div className="w-row cal-views" role="group" aria-label="Calendar view">
          {(["month", "week", "day"] as View[]).map((v) => (
            <button key={v} className="w-chip" aria-pressed={view === v} onClick={() => setView(v)}>{v[0]!.toUpperCase() + v.slice(1)}</button>
          ))}
        </div>
        <select className="w-input" value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Filter by tag">
          <option value="">All tags</option>
          {tags.map((t) => <option key={t} value={t}>#{t}</option>)}
        </select>
        {standalone && (
          <button className="w-btn w-btn-primary w-btn-small" onClick={() => setAdding(selected)}>
            <Icon name="plus" size={14} /> Reminder
          </button>
        )}
      </div>
      <div className="cal-body">
      <div className={`cal-grid cal-v-${view}`} role="grid">
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
            <div
              key={key}
              role="gridcell"
              aria-selected={standalone ? key === selected : undefined}
              className={`cal-day${outside ? " outside" : ""}${key === today ? " today" : ""}${standalone && key === selected ? " selected" : ""}`}
              onClick={standalone ? (e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains("cal-items")) setSelected(key); } : undefined}
            >
              <div className="cal-day-head">
                <button
                  className="cal-date"
                  onClick={() => (standalone ? setSelected(key) : (setCursor(d), setView("day")))}
                  onDoubleClick={() => { setCursor(d); setView("day"); }}
                  aria-label={d.toDateString()}
                >
                  {d.getDate()}
                </button>
                {standalone && (vault.activity.days[key]?.words ?? 0) > 0 && (
                  <span className="cal-words" title={`${vault.activity.days[key]!.words} words written`}>{compact(vault.activity.days[key]!.words)}w</span>
                )}
                <button className="cal-add" onClick={() => setAdding(key)} aria-label={`Add reminder on ${d.toDateString()}`}>+</button>
              </div>
              <ul className="cal-items">
                {entries.slice(0, limit).map((e) =>
                  e.kind === "task" ? (
                    <li key={`t${e.t.path}${e.t.line}`} className={`cal-task${isReminder(e.t) ? " cal-reminder" : ""}${e.t.status === "done" ? " done" : ""}`}>
                      <button
                        onClick={() => {
                          // Reminders aren't notes: show their day. Dated tasks open their note.
                          if (!isReminder(e.t)) return openNote(e.t.path, { line: e.t.line });
                          setSelected(key);
                          if (!standalone) { setCursor(d); setView("day"); }
                        }}
                        title={e.t.text}
                      >
                        {e.t.time && <span className="cal-time">{e.t.time}</span>}
                        {linkText(e.t.text)}
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
      {standalone && (
        <DayPanel
          date={selected}
          items={byDay.get(selected)}
          words={vault.activity.days[selected]?.words ?? 0}
          upcoming={[...byDay.entries()]
            .filter(([d]) => d > today && d <= isoDate(addDays(new Date(), 14)))
            .sort(([a], [b]) => a.localeCompare(b))
            .flatMap(([d, it]) => it.tasks.filter((t) => t.status === "todo").map((t) => ({ d, t })))
            .slice(0, 12)}
          vault={vault}
          openNote={openNote}
          onAdd={() => setAdding(selected)}
          onToggle={(t) => void vault.toggleTask(t).catch((e) => toast((e as Error).message, { tone: "warn" }))}
          onDelete={(t) => void removeWithUndo(vault, t.path, "Reminder", () => vault.deleteTask(t))}
        />
      )}
      </div>
      {adding && (
        <AddReminder
          date={adding}
          onClose={() => setAdding(null)}
          onSave={async (line) => {
            await vault.appendTo(REMINDERS_PATH, line);
            toast("Reminder added. Type [[ in a note to link to it.");
            setAdding(null);
          }}
        />
      )}
    </div>
  );
}

function compact(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);
}

function DayPanel({ date, items, words, upcoming, vault, openNote, onAdd, onToggle, onDelete }: {
  date: string;
  items: DayItems | undefined;
  words: number;
  upcoming: { d: string; t: Task }[];
  vault: Vault;
  openNote: WorkspaceProps["openNote"];
  onAdd: () => void;
  onToggle: (t: Task) => void;
  onDelete: (t: Task) => void;
}) {
  const day = parseIsoDate(date) ?? new Date();
  const tasks = items?.tasks ?? [];
  const notes = items?.notes ?? [];
  return (
    <aside className="cal-side" aria-label="Selected day">
      <section className="cal-side-card">
        <div className="cal-side-date">
          <span className="cal-side-dow">{day.toLocaleDateString(undefined, { weekday: "long" })}</span>
          <span className="cal-side-day">{day.toLocaleDateString(undefined, { month: "long", day: "numeric" })}</span>
        </div>
        <div className="cal-side-stats">
          <span><b>{tasks.length}</b> reminders</span>
          <span><b>{notes.length}</b> notes</span>
          <span><b>{words}</b> words</span>
        </div>
        {tasks.length + notes.length === 0 ? (
          <p className="w-muted w-small">Nothing on this day.</p>
        ) : (
          <ul className="cal-side-list">
            {tasks.map((t) => {
              const linked = isReminder(t) && t.blockId ? vault.reminderBacklinks(t.blockId) : [];
              return (
                <li key={`t${t.path}${t.line}`} className={`cal-side-task${t.status === "done" ? " done" : ""}`}>
                  <input type="checkbox" checked={t.status === "done"} onChange={() => onToggle(t)} aria-label={`Complete: ${t.text}`} />
                  <div className="cal-side-task-body">
                    {isReminder(t) ? (
                      <span className="cal-side-text">
                        {t.time && <span className="cal-time">{t.time}</span>}
                        {linkText(t.text)}
                      </span>
                    ) : (
                      <button onClick={() => openNote(t.path, { line: t.line })}>
                        {t.time && <span className="cal-time">{t.time}</span>}
                        {linkText(t.text)}
                        <span className="w-muted"> · {noteName(t.path)}</span>
                      </button>
                    )}
                    {linked.length > 0 && (
                      <span className="cal-linked">
                        <Icon name="link" size={12} />
                        {linked.map((p) => <button key={p} className="cal-linked-note" onClick={() => openNote(p)}>{noteName(p)}</button>)}
                      </span>
                    )}
                  </div>
                  {isReminder(t) && (
                    <button className="cal-delete" onClick={() => onDelete(t)} aria-label={`Delete reminder: ${t.text}`} title="Delete reminder">
                      <Icon name="trash" size={14} />
                    </button>
                  )}
                </li>
              );
            })}
            {notes.map((n) => (
              <li key={`n${n.path}`} className="cal-side-note">
                <Icon name="file" size={14} />
                <button onClick={() => openNote(n.path)}>{n.name}</button>
              </li>
            ))}
          </ul>
        )}
        <button className="w-btn w-btn-small" onClick={onAdd}><Icon name="plus" size={14} /> Add to this day</button>
      </section>
      <section className="cal-side-card">
        <h3>Next two weeks</h3>
        {upcoming.length === 0 ? (
          <p className="w-muted w-small">No reminders coming up.</p>
        ) : (
          <ul className="cal-side-list">
            {upcoming.map(({ d, t }) => (
              <li key={`u${t.path}${t.line}`}>
                <span className="cal-side-when">{parseIsoDate(d)!.toLocaleDateString(undefined, { weekday: "short", day: "numeric" })}</span>
                {isReminder(t) ? <span className="cal-side-text">{linkText(t.text)}</span> : <button onClick={() => openNote(t.path, { line: t.line })}>{linkText(t.text)}</button>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}

function AddReminder({ date, onClose, onSave }: {
  date: string;
  onClose: () => void;
  onSave: (line: string) => void;
}) {
  const [text, setText] = useState("");
  const [d, setD] = useState(date);
  const [time, setTime] = useState("");
  const [tags, setTags] = useState("");
  const valid = text.trim() && parseIsoDate(d);
  return (
    <Modal title="Add reminder or event" onClose={onClose} width={440}>
      <form
        className="w-col"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSave(formatTaskLine({ text, due: d, time: time || undefined, tags: tags.split(/[\s,]+/).filter(Boolean), id: newBlockId() }));
        }}
      >
        <label className="w-field"><span>What</span><input value={text} onChange={(e) => setText(e.target.value)} placeholder="Essay due" required /></label>
        <div className="w-row">
          <label className="w-field"><span>Date</span><input type="date" value={d} onChange={(e) => setD(e.target.value)} required /></label>
          <label className="w-field"><span>Time (optional)</span><input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
        </div>
        <label className="w-field"><span>Tags</span><input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="history exam" /></label>
        <p className="w-muted w-small">To connect a note, type [[ in the note and pick this reminder. The calendar then shows the note here.</p>
        <div className="w-row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="w-btn" onClick={onClose}>Cancel</button>
          <button className="w-btn w-btn-primary" disabled={!valid}>Add</button>
        </div>
      </form>
    </Modal>
  );
}
