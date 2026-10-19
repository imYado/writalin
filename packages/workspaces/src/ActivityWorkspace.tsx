import { useEffect, useMemo, useRef, useState } from "react";
import { activityYears, contributionGrid, createdDay, notesCreatedByDay, type ActivityMetric, type ContributionCell, type ContributionSummary, type Vault } from "@writalin/vault";
import { parseIsoDate } from "@writalin/shared";
import type { WorkspaceProps } from "./types";

const METRICS: { id: ActivityMetric; label: string }[] = [
  { id: "both", label: "Everything" },
  { id: "words", label: "Words" },
  { id: "notes", label: "New notes" },
];

/** `year` shows that calendar year; without it, the weeks up to today. */
export function useContributions(vault: Vault, version: number, weekCount: number, metric: ActivityMetric, year?: number): ContributionSummary {
  // `version` changes on every save; activity changes ride along with it.
  return useMemo(
    () => contributionGrid(vault.activity, notesCreatedByDay(vault.notes.values()), { weekCount, metric, end: year ? new Date(year, 11, 31) : undefined }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vault, version, weekCount, metric, year],
  );
}

const fmt = (n: number) => n.toLocaleString();

function cellLabel(c: ContributionCell): string {
  const d = parseIsoDate(c.date)!.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  if (c.future) return d;
  if (!c.words && !c.notes) return `Nothing written on ${d}`;
  const parts = [];
  if (c.words) parts.push(`${fmt(c.words)} word${c.words === 1 ? "" : "s"}`);
  if (c.notes) parts.push(`${c.notes} new note${c.notes === 1 ? "" : "s"}`);
  return `${parts.join(" and ")} on ${d}`;
}

/** GitHub-style contribution boxes: one square per day, darker = more writing. */
export function ContributionGraph({ summary, onPick }: { summary: ContributionSummary; onPick?: (date: string) => void }) {
  const [hover, setHover] = useState<ContributionCell | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  // On narrow screens start at the newest weeks, like GitHub.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [summary]);
  const months: { col: number; label: string }[] = [];
  summary.weeks.forEach((w, i) => {
    const first = w[0]!;
    const d = parseIsoDate(first.date)!;
    const prev = i > 0 ? parseIsoDate(summary.weeks[i - 1]![0]!.date)! : null;
    if (prev && prev.getMonth() === d.getMonth()) return;
    // A month that starts right after the first column would crowd its label.
    if (months.length && i - months[months.length - 1]!.col < 3) months.pop();
    months.push({ col: i, label: d.toLocaleDateString(undefined, { month: "short" }) });
  });
  return (
    <div className="contrib">
      <div className="contrib-scroll" ref={scroller}>
        <div className="contrib-grid" style={{ gridTemplateColumns: `auto repeat(${summary.weeks.length}, minmax(var(--contrib-cell), 1fr))`, minWidth: summary.weeks.length * 13 + 32 }} role="grid" aria-label="Writing activity">
          <span />
          {summary.weeks.map((_, i) => {
            const m = months.find((x) => x.col === i);
            return <span key={`m${i}`} className="contrib-month">{m && i < summary.weeks.length - 2 ? m.label : ""}</span>;
          })}
          {[0, 1, 2, 3, 4, 5, 6].map((row) => (
            <Row key={row} row={row} summary={summary} onHover={setHover} onPick={onPick} />
          ))}
        </div>
      </div>
      <div className="contrib-foot">
        <span className="contrib-hint" aria-live="polite">{hover ? cellLabel(hover) : "Point at a square to see that day."}</span>
        <span className="contrib-legend" aria-hidden="true">
          Less
          {[0, 1, 2, 3, 4].map((l) => <i key={l} className={`contrib-cell l${l}`} />)}
          More
        </span>
      </div>
    </div>
  );
}

function Row({ row, summary, onHover, onPick }: {
  row: number;
  summary: ContributionSummary;
  onHover: (c: ContributionCell | null) => void;
  onPick?: (date: string) => void;
}) {
  const label = row % 2 === 0 ? parseIsoDate(summary.weeks[0]![row]!.date)!.toLocaleDateString(undefined, { weekday: "short" }) : "";
  return (
    <>
      <span className="contrib-dow">{label}</span>
      {summary.weeks.map((w) => {
        const c = w[row]!;
        return (
          <button
            key={c.date}
            type="button"
            role="gridcell"
            className={`contrib-cell l${c.level}${c.future ? " future" : ""}`}
            aria-label={cellLabel(c)}
            disabled={c.future}
            onMouseEnter={() => onHover(c)}
            onFocus={() => onHover(c)}
            onMouseLeave={() => onHover(null)}
            onClick={() => onPick?.(c.date)}
          />
        );
      })}
    </>
  );
}

/** The Activity zone: contribution boxes for the past year or any earlier year, with streaks and totals. */
export function ActivityWorkspace({ vault, version, openNote }: WorkspaceProps) {
  const [metric, setMetric] = useState<ActivityMetric>("both");
  const [year, setYear] = useState<number | undefined>();
  const [picked, setPicked] = useState<string | null>(null);
  const summary = useContributions(vault, version, 53, metric, year);
  const thisYear = new Date().getFullYear();
  const years = useMemo(
    () => [...new Set([thisYear, thisYear - 1, ...activityYears(vault.activity, notesCreatedByDay(vault.notes.values()))])].filter((y) => y <= thisYear).sort((a, b) => b - a),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vault, version, thisYear],
  );
  const pickedNotes = useMemo(
    () => (picked ? [...vault.notes.values()].filter((n) => createdDay(n) === picked) : []),
    [vault, version, picked],
  );
  const span = year ? String(year) : "past year";

  return (
    <div className="ws ws-activity">
      <div className="activity-inner">
        <header className="zone-head">
          <div>
            <h1>Activity</h1>
            <p className="w-muted">What you wrote, day by day.</p>
          </div>
        </header>

        <div className="stat-row">
          {year ? (
            <Stat label="Active days" value={fmt(summary.activeDays)} accent />
          ) : (
            <Stat label="Current streak" value={`${summary.currentStreak} day${summary.currentStreak === 1 ? "" : "s"}`} accent />
          )}
          <Stat label="Longest streak" value={`${summary.longestStreak} day${summary.longestStreak === 1 ? "" : "s"}`} />
          <Stat label={`Words, ${span}`} value={fmt(summary.totalWords)} />
          <Stat label={`New notes, ${span}`} value={fmt(summary.totalNotes)} />
        </div>

        <section className="zone-card">
          <div className="activity-controls">
            <div className="w-row" role="group" aria-label="Which year">
              <button className="w-chip" aria-pressed={year == null} onClick={() => setYear(undefined)}>Past year</button>
              {years.map((y) => (
                <button key={y} className="w-chip" aria-pressed={year === y} onClick={() => setYear(y)}>{y}</button>
              ))}
            </div>
            <div className="w-row" role="group" aria-label="What to count">
              {METRICS.map((m) => (
                <button key={m.id} className="w-chip w-chip-quiet" aria-pressed={metric === m.id} onClick={() => setMetric(m.id)}>{m.label}</button>
              ))}
            </div>
          </div>
          <ContributionGraph summary={summary} onPick={setPicked} />
        </section>

        {picked && (
          <section className="zone-card">
            <h3>{parseIsoDate(picked)!.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</h3>
            <p className="w-muted w-small">
              {fmt(vault.activity.days[picked]?.words ?? 0)} words written · {vault.activity.days[picked]?.edits ?? 0} saves
            </p>
            {pickedNotes.length > 0 && (
              <ul className="pick-list">
                {pickedNotes.map((n) => (
                  <li key={n.path}><button className="w-glow" onClick={() => openNote(n.path)}>{n.name}</button></li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`stat${accent ? " stat-accent" : ""}`}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}
