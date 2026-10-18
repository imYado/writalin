const pad = (n: number) => String(n).padStart(2, "0");

/** YYYY-MM-DD in local time. */
export function isoDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local timestamp without timezone noise, e.g. 2026-10-18T10:15. Sorts correctly as a string. */
export function isoDateTime(d: Date = new Date()): string {
  return `${isoDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function parseIsoDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

export function startOfWeek(d: Date, weekStartsOn = 1): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = (r.getDay() - weekStartsOn + 7) % 7;
  r.setDate(r.getDate() - diff);
  return r;
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  return `${pad(m)}:${pad(s % 60)}`;
}
