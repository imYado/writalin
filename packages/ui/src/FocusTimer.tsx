import { useEffect, useReducer, useRef, useState } from "react";
import { formatDuration } from "@writalin/shared";
import { initialTimer, secondsLeft, timerReducer, type TimerAction, type TimerState } from "./timer";
import { Icon } from "./icons";

const STORAGE_KEY = "writalin.timer";

function load(focusMinutes: number, breakMinutes: number): TimerState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...initialTimer(focusMinutes, breakMinutes), ...(JSON.parse(raw) as TimerState) };
  } catch {
    /* storage unavailable */
  }
  return initialTimer(focusMinutes, breakMinutes);
}

export function useFocusTimer(focusMinutes = 30, breakMinutes = 5) {
  const [state, dispatchRaw] = useReducer((s: TimerState, a: TimerAction) => timerReducer(s, a), undefined, () => load(focusMinutes, breakMinutes));
  const [, force] = useState(0);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [state]);
  useEffect(() => {
    if (state.phase !== "focus" && state.phase !== "break") return;
    const id = setInterval(() => {
      dispatchRaw({ type: "tick" });
      force((n) => n + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [state.phase]);
  useEffect(() => {
    if (state.phase === "idle" && (state.focusMinutes !== focusMinutes || state.breakMinutes !== breakMinutes)) {
      dispatchRaw({ type: "setDuration", focusMinutes, breakMinutes });
    }
  }, [focusMinutes, breakMinutes, state.phase, state.focusMinutes, state.breakMinutes]);
  return { state, seconds: secondsLeft(state), dispatch: dispatchRaw };
}

export type FocusTimerApi = ReturnType<typeof useFocusTimer>;

/** The small pill at the top center. Click to open controls. */
export function FocusTimer({ timer, onDurationChange }: { timer: FocusTimerApi; onDurationChange?: (minutes: number) => void }) {
  const { state, seconds, dispatch } = timer;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const running = state.phase === "focus" || state.phase === "break";
  const total = (state.phase === "break" ? state.breakMinutes : state.focusMinutes) * 60;
  const progress = state.phase === "idle" ? 0 : 1 - seconds / total;
  const label =
    state.phase === "break-prompt" ? "Break time" : state.phase === "break" ? `Break ${formatDuration(seconds)}` : formatDuration(seconds);

  return (
    <div className="w-timer" ref={ref} data-phase={state.phase}>
      <button
        className="w-timer-pill"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Focus timer, ${label}${state.phase === "paused" ? ", paused" : ""}. Open timer controls`}
        style={{ ["--w-progress" as string]: String(progress) }}
      >
        <span className="w-timer-ring" aria-hidden="true" />
        <span className="w-timer-time" aria-live={state.phase === "break-prompt" ? "polite" : "off"}>
          {label}
        </span>
      </button>
      {state.phase === "break-prompt" && !open && (
        <div className="w-timer-toast" role="status">
          <p>Nice focus session. Take a {state.breakMinutes}-minute break?</p>
          <div className="w-row">
            <button className="w-btn w-btn-primary" onClick={() => dispatch({ type: "startBreak" })}>
              Start break
            </button>
            <button className="w-btn" onClick={() => dispatch({ type: "skipBreak" })}>
              Skip
            </button>
          </div>
        </div>
      )}
      {open && (
        <div className="w-popover w-timer-menu" role="dialog" aria-label="Focus timer">
          <div className="w-row">
            {state.phase === "idle" && (
              <button className="w-btn w-btn-primary" onClick={() => dispatch({ type: "start" })}>
                <Icon name="play" size={16} /> Start focus
              </button>
            )}
            {running && state.phase === "focus" && (
              <button className="w-btn" onClick={() => dispatch({ type: "pause" })}>
                <Icon name="pause" size={16} /> Pause
              </button>
            )}
            {state.phase === "paused" && (
              <button className="w-btn w-btn-primary" onClick={() => dispatch({ type: "resume" })}>
                <Icon name="play" size={16} /> Resume
              </button>
            )}
            {state.phase !== "idle" && (
              <button className="w-btn" onClick={() => dispatch({ type: "reset" })}>
                <Icon name="reset" size={16} /> Reset
              </button>
            )}
          </div>
          <label className="w-field">
            <span>Focus length (minutes)</span>
            <input
              type="number"
              min={1}
              max={180}
              value={state.focusMinutes}
              onChange={(e) => {
                const m = Number(e.target.value);
                if (m > 0) {
                  dispatch({ type: "setDuration", focusMinutes: m });
                  onDurationChange?.(m);
                }
              }}
            />
          </label>
          <div className="w-row w-chips">
            {[15, 25, 30, 45, 60].map((m) => (
              <button
                key={m}
                className="w-chip"
                aria-pressed={state.focusMinutes === m}
                onClick={() => {
                  dispatch({ type: "setDuration", focusMinutes: m });
                  onDurationChange?.(m);
                }}
              >
                {m}m
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
