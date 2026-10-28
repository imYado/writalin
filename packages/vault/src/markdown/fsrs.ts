import type { CardRating, CardSchedule } from "@writalin/shared";
import { addDays, isoDate } from "@writalin/shared";

/**
 * FSRS-4.5 scheduling (https://github.com/open-spaced-repetition/fsrs4anki),
 * stored in the Spaced Repetition plugin's `!due,interval,ease` notes so both
 * apps keep reading the same cards:
 * - stability is the interval, since at 90% desired retention FSRS schedules a
 *   card exactly `stability` days out;
 * - difficulty (1 to 10) maps onto ease (350 down to 130);
 * - the last review is `due - interval`.
 * A note written by the plugin's own SM-2 reads the same way, so old cards
 * carry on without losing their history.
 */
const W = [0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474, 0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755] as const;
const DECAY = -0.5;
const FACTOR = 19 / 81;
const MAX_INTERVAL = 36500;
const DAY_MS = 86_400_000;

const w = (i: number) => W[i]!;
const clampD = (d: number) => Math.min(10, Math.max(1, d));
const initDifficulty = (g: CardRating) => clampD(w(4) - (g - 3) * w(5));

export const easeToDifficulty = (ease: number): number => clampD(10 - ((ease - 130) * 9) / 220);
export const difficultyToEase = (d: number): number => Math.round(130 + ((10 - clampD(d)) * 220) / 9);

/** Chance of remembering a card `elapsed` days after a review that left it with this stability. */
export const retrievability = (elapsed: number, stability: number): number => (1 + (FACTOR * elapsed) / stability) ** DECAY;

const dayNumber = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);

function nextMemory(prev: CardSchedule | undefined, g: CardRating, today: string): { stability: number; difficulty: number } {
  if (!prev) return { stability: w(g - 1), difficulty: initDifficulty(g) };
  const s = Math.max(0.1, prev.interval);
  const d = easeToDifficulty(prev.ease);
  const elapsed = Math.max(0, dayNumber(today) - (dayNumber(prev.due) - prev.interval));
  const r = retrievability(elapsed, s);
  const stability =
    g === 1
      ? Math.min(s, w(11) * d ** -w(12) * ((s + 1) ** w(13) - 1) * Math.exp(w(14) * (1 - r)))
      : s * (1 + Math.exp(w(8)) * (11 - d) * s ** -w(9) * (Math.exp(w(10) * (1 - r)) - 1) * (g === 2 ? w(15) : 1) * (g === 4 ? w(16) : 1));
  const difficulty = clampD(w(7) * initDifficulty(3) + (1 - w(7)) * (d - w(6) * (g - 3)));
  return { stability, difficulty };
}

/**
 * The schedule each answer would give, Again to Easy. Hard, Good and Easy
 * are kept at least a day apart so every button means something.
 */
export function scheduleOptions(prev: CardSchedule | undefined, today = new Date()): [CardSchedule, CardSchedule, CardSchedule, CardSchedule] {
  const day = isoDate(today);
  const mems = ([1, 2, 3, 4] as const).map((g) => nextMemory(prev, g, day));
  const days = mems.map((m) => Math.min(MAX_INTERVAL, Math.max(1, Math.round(m.stability))));
  days[2] = Math.max(days[2]!, days[1]! + 1);
  days[3] = Math.max(days[3]!, days[2]! + 1);
  return mems.map((m, i) => ({ due: isoDate(addDays(today, days[i]!)), interval: days[i]!, ease: difficultyToEase(m.difficulty) })) as [CardSchedule, CardSchedule, CardSchedule, CardSchedule];
}

/** The next schedule after answering a card. */
export function nextSchedule(prev: CardSchedule | undefined, rating: CardRating, today = new Date()): CardSchedule {
  return scheduleOptions(prev, today)[rating - 1]!;
}

/** A gap in days as a short label: "3d", "2mo", "1.5y". */
export function formatInterval(days: number): string {
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${Math.round(days / 36.5) / 10}y`;
}
