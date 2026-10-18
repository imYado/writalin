import { describe, expect, it } from "vitest";
import { initialTimer, secondsLeft, timerReducer } from "./timer";

describe("focus timer", () => {
  it("defaults to 30 minutes and runs to a gentle break prompt", () => {
    let s = initialTimer();
    expect(secondsLeft(s)).toBe(1800);
    s = timerReducer(s, { type: "start" }, 0);
    expect(secondsLeft(s, 60_000)).toBe(1740);
    s = timerReducer(s, { type: "tick" }, 1_800_000);
    expect(s.phase).toBe("break-prompt");
    s = timerReducer(s, { type: "startBreak" }, 1_800_000);
    expect(secondsLeft(s, 1_800_000)).toBe(300);
    s = timerReducer(s, { type: "tick" }, 2_100_000);
    expect(s.phase).toBe("idle");
  });

  it("pauses and resumes without losing time", () => {
    let s = timerReducer(initialTimer(10), { type: "start" }, 0);
    s = timerReducer(s, { type: "pause" }, 120_000);
    expect(secondsLeft(s, 999_999)).toBe(480);
    s = timerReducer(s, { type: "resume" }, 500_000);
    expect(secondsLeft(s, 560_000)).toBe(420);
  });

  it("clamps custom durations", () => {
    expect(timerReducer(initialTimer(), { type: "setDuration", focusMinutes: 0 }).focusMinutes).toBe(1);
  });
});
