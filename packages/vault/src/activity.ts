import type { NoteMeta } from "@writalin/shared";
import { addDays, isoDate, startOfWeek } from "@writalin/shared";

/** Where the writing log lives. Plain JSON, one entry per day. */
export const ACTIVITY_PATH = ".writalin/activity.json";

export interface DayActivity {
  /** Words added to notes that day (deletions don't subtract). */
  words: number;
  /** Number of saves. */
  edits: number;
  /** Flashcards reviewed, and how many of them were new. */
  cards?: number;
  newCards?: number;
  /** Quizzes finished, and their right answers out of questions. */
  quizzes?: number;
  quizRight?: number;
  quizTotal?: number;
}

const COUNTS = ["words", "edits", "cards", "newCards", "quizzes", "quizRight", "quizTotal"] as const;

export interface ActivityLog {
  version: 1;
  days: Record<string, DayActivity>;
}

export const emptyActivity = (): ActivityLog => ({ version: 1, days: {} });

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu;
const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯]/g;

/** Words in a note body. CJK characters count one each, like most word counters. */
export function countWords(text: string): number {
  const cjk = text.match(CJK)?.length ?? 0;
  const rest = cjk ? text.replace(CJK, " ") : text;
  return (rest.match(WORD)?.length ?? 0) + cjk;
}

export function addActivity(log: ActivityLog, day: string, delta: Partial<DayActivity>): ActivityLog {
  const next: DayActivity = { ...(log.days[day] ?? { words: 0, edits: 0 }) };
  for (const k of COUNTS) if (delta[k]) next[k] = (next[k] ?? 0) + delta[k]!;
  log.days[day] = next;
  return log;
}

/** Merge two logs (e.g. from two computers) by taking the larger count per day. */
export function mergeActivity(a: ActivityLog, b: ActivityLog): ActivityLog {
  const out = emptyActivity();
  for (const [d, v] of Object.entries(a.days)) out.days[d] = { ...v };
  for (const [d, v] of Object.entries(b.days)) {
    const cur = out.days[d];
    if (!cur) {
      out.days[d] = { ...v };
      continue;
    }
    for (const k of COUNTS) if (v[k] != null || cur[k] != null) cur[k] = Math.max(cur[k] ?? 0, v[k] ?? 0);
  }
  return out;
}

/** The day a note was created, from its `created` frontmatter. */
export function createdDay(meta: NoteMeta): string | null {
  const c = meta.frontmatter.created as unknown;
  if (c instanceof Date && !Number.isNaN(c.getTime())) return isoDate(c);
  if (typeof c === "string" && /^\d{4}-\d{2}-\d{2}/.test(c)) return c.slice(0, 10);
  return null;
}

export function notesCreatedByDay(notes: Iterable<NoteMeta>): Map<string, number> {
  const out = new Map<string, number>();
  for (const n of notes) {
    const d = createdDay(n);
    if (d) out.set(d, (out.get(d) ?? 0) + 1);
  }
  return out;
}

export type ActivityMetric = "words" | "notes" | "both";

export interface ContributionCell {
  date: string;
  words: number;
  notes: number;
  /** 0 (nothing) to 4 (a lot), relative to the busiest days in range. */
  level: 0 | 1 | 2 | 3 | 4;
  future: boolean;
}

export interface ContributionSummary {
  /** Columns are weeks (Monday first), rows are weekdays. */
  weeks: ContributionCell[][];
  totalWords: number;
  totalNotes: number;
  activeDays: number;
  currentStreak: number;
  longestStreak: number;
  busiestDay: ContributionCell | null;
}

function score(c: { words: number; notes: number }, metric: ActivityMetric): number {
  if (metric === "words") return c.words;
  if (metric === "notes") return c.notes;
  // A new note is worth about a paragraph.
  return c.words + c.notes * 50;
}

/**
 * GitHub-style contribution grid ending at `today`, `weekCount` weeks wide.
 * Levels rank days against the other active days, so one huge day doesn't
 * wash out the rest.
 */
export function contributionGrid(
  log: ActivityLog,
  created: Map<string, number>,
  opts: { today?: Date; weekCount?: number; metric?: ActivityMetric; end?: Date } = {},
): ContributionSummary {
  const today = opts.today ?? new Date();
  const metric = opts.metric ?? "both";
  const weekCount = opts.weekCount ?? 53;
  const todayIso = isoDate(today);
  // `end` shows an earlier stretch (e.g. a past year); days after today stay "future".
  const start = addDays(startOfWeek(opts.end ?? today), -(weekCount - 1) * 7);

  const cells: ContributionCell[] = [];
  for (let i = 0; i < weekCount * 7; i++) {
    const date = isoDate(addDays(start, i));
    const day = log.days[date];
    cells.push({ date, words: day?.words ?? 0, notes: created.get(date) ?? 0, level: 0, future: date > todayIso });
  }

  const values = cells.filter((c) => !c.future).map((c) => score(c, metric)).filter((v) => v > 0).sort((a, b) => a - b);
  // Level = which quarter of the active days this day ranks in.
  const rank = (v: number) => {
    let lo = 0;
    let hi = values.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (values[mid]! <= v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  for (const c of cells) {
    const v = score(c, metric);
    c.level = c.future || v <= 0 ? 0 : (Math.max(1, Math.ceil((4 * rank(v)) / values.length)) as 1 | 2 | 3 | 4);
  }

  const weeks: ContributionCell[][] = [];
  for (let w = 0; w < weekCount; w++) weeks.push(cells.slice(w * 7, w * 7 + 7));

  const past = cells.filter((c) => !c.future);
  let longest = 0;
  let run = 0;
  for (const c of past) {
    run = score(c, "both") > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  // Today not written yet doesn't break the streak.
  let current = 0;
  for (let i = past.length - 1; i >= 0; i--) {
    const c = past[i]!;
    if (score(c, "both") > 0) current++;
    else if (c.date !== todayIso) break;
  }
  let busiest: ContributionCell | null = null;
  for (const c of past) if (score(c, metric) > 0 && (!busiest || score(c, metric) > score(busiest, metric))) busiest = c;

  return {
    weeks,
    totalWords: past.reduce((n, c) => n + c.words, 0),
    totalNotes: past.reduce((n, c) => n + c.notes, 0),
    activeDays: past.filter((c) => score(c, "both") > 0).length,
    currentStreak: current,
    longestStreak: longest,
    busiestDay: busiest,
  };
}


/** Years with any writing or new notes, newest first. */
export function activityYears(log: ActivityLog, created: Map<string, number>): number[] {
  const years = new Set<number>();
  for (const [d, v] of Object.entries(log.days)) if (v.words > 0 || v.edits > 0) years.add(Number(d.slice(0, 4)));
  for (const [d, n] of created) if (n > 0) years.add(Number(d.slice(0, 4)));
  return [...years].filter((y) => y > 1970).sort((a, b) => b - a);
}

export interface StudyStats {
  /** Days in a row, up to today, with a flashcard review or a quiz. Today not yet counts as kept. */
  streak: number;
  cardsToday: number;
  cardsWeek: number;
  quizzesWeek: number;
  /** Right answers out of questions in the last 7 days' quizzes, or null with none. */
  quizPercentWeek: number | null;
}

export function studyStats(log: ActivityLog, today = new Date()): StudyStats {
  const studied = (d: string) => !!(log.days[d]?.cards || log.days[d]?.quizzes);
  let streak = 0;
  // A streak isn't broken until today ends, so start from yesterday if today is empty.
  for (let d = studied(isoDate(today)) ? today : addDays(today, -1); studied(isoDate(d)); d = addDays(d, -1)) streak++;
  let cardsWeek = 0, quizzesWeek = 0, right = 0, total = 0;
  for (let i = 0; i < 7; i++) {
    const day = log.days[isoDate(addDays(today, -i))];
    cardsWeek += day?.cards ?? 0;
    quizzesWeek += day?.quizzes ?? 0;
    right += day?.quizRight ?? 0;
    total += day?.quizTotal ?? 0;
  }
  return { streak, cardsToday: log.days[isoDate(today)]?.cards ?? 0, cardsWeek, quizzesWeek, quizPercentWeek: total ? Math.round((right / total) * 100) : null };
}
