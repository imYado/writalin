/**
 * Focus timer as a tiny state machine. It stores the end timestamp rather
 * than ticking a counter, so it stays right across reloads and sleeping tabs.
 */
export type TimerPhase = "idle" | "focus" | "paused" | "break-prompt" | "break";

export interface TimerState {
  phase: TimerPhase;
  focusMinutes: number;
  breakMinutes: number;
  /** Epoch ms when the running phase ends. */
  endsAt: number | null;
  /** Seconds left when paused. */
  remaining: number;
}

export function initialTimer(focusMinutes = 30, breakMinutes = 5): TimerState {
  return { phase: "idle", focusMinutes, breakMinutes, endsAt: null, remaining: focusMinutes * 60 };
}

export function secondsLeft(s: TimerState, now = Date.now()): number {
  if ((s.phase === "focus" || s.phase === "break") && s.endsAt) return Math.max(0, Math.ceil((s.endsAt - now) / 1000));
  return s.remaining;
}

export type TimerAction =
  | { type: "start" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "reset" }
  | { type: "tick" }
  | { type: "startBreak" }
  | { type: "skipBreak" }
  | { type: "setDuration"; focusMinutes: number; breakMinutes?: number };

export function timerReducer(s: TimerState, a: TimerAction, now = Date.now()): TimerState {
  switch (a.type) {
    case "start":
      return { ...s, phase: "focus", endsAt: now + s.focusMinutes * 60_000, remaining: s.focusMinutes * 60 };
    case "pause":
      if (s.phase !== "focus") return s;
      return { ...s, phase: "paused", remaining: secondsLeft(s, now), endsAt: null };
    case "resume":
      if (s.phase !== "paused") return s;
      return { ...s, phase: "focus", endsAt: now + s.remaining * 1000 };
    case "reset":
      return initialTimer(s.focusMinutes, s.breakMinutes);
    case "tick":
      if (s.phase === "focus" && secondsLeft(s, now) === 0) return { ...s, phase: "break-prompt", endsAt: null, remaining: 0 };
      if (s.phase === "break" && secondsLeft(s, now) === 0) return initialTimer(s.focusMinutes, s.breakMinutes);
      return s;
    case "startBreak":
      return { ...s, phase: "break", endsAt: now + s.breakMinutes * 60_000, remaining: s.breakMinutes * 60 };
    case "skipBreak":
      return initialTimer(s.focusMinutes, s.breakMinutes);
    case "setDuration": {
      const focusMinutes = Math.min(180, Math.max(1, Math.round(a.focusMinutes)));
      const breakMinutes = Math.min(60, Math.max(1, Math.round(a.breakMinutes ?? s.breakMinutes)));
      return s.phase === "idle" ? initialTimer(focusMinutes, breakMinutes) : { ...s, focusMinutes, breakMinutes };
    }
  }
}
