import type { BoardOp, BoardTextSize } from "@writalin/workspaces";

/**
 * The tutor's reply is a list of one-line commands (see TUTOR_SYSTEM on the
 * server): `say: …` for the chat, the rest for the board. This turns one
 * line into a step. Anything that isn't a command is taken as something said,
 * so a model that drifts into prose still makes sense.
 */
export type TutorStep = { say: string } | BoardOp | TutorTool;

/** The app's study tools the tutor can use besides the board. */
export type TutorTool =
  | { tool: "card"; question: string; answer: string }
  | { tool: "note"; text: string }
  | { tool: "task"; text: string; due?: string }
  /** One multiple-choice question; the right answer is the first option. */
  | { tool: "quiz"; question: string; options: string[] }
  | { tool: "timer" };

const SIZES = new Set(["s", "m", "l", "xl"]);
const COLORS = new Set(["black", "red", "blue", "green", "purple", "orange", "yellow"]);
const COMMAND = /^(say|write|text|line|arrow|rect|ellipse|circle|draw|highlight|cover|figure|end|page|erase|card|flashcard|note|task|quiz|timer)\b[ \t]*([^:]*?)[ \t]*(?::[ \t]?(.*))?$/i;

export function parseTutorLine(raw: string): TutorStep | null {
  // Models like to dress lines up as list items or code; take that off.
  const line = raw.replace(/^\s*(?:[-*•]\s+|\d+[.)]\s+)?/, "").replace(/^`+|`+$/g, "").trim();
  if (!line || /^```/.test(raw.trim())) return null;
  const m = COMMAND.exec(line);
  if (!m) return { say: line };
  const word = m[1]!.toLowerCase();
  const args = m[2] ?? "";
  const rest = (m[3] ?? "").trim();
  const words = args.split(/[\s,]+/).filter(Boolean);
  const nums = words.map(Number).filter((n) => Number.isFinite(n));
  const size = words.map((w) => w.toLowerCase()).find((w) => SIZES.has(w)) as BoardTextSize | undefined;
  const color = words.map((w) => w.toLowerCase()).find((w) => COLORS.has(w));
  // A sentence that merely starts with a command word ("Page 3 shows…", "End of the proof.") is prose.
  const stray = words.some((w) => !SIZES.has(w.toLowerCase()) && !COLORS.has(w.toLowerCase()) && !Number.isFinite(Number(w)));
  switch (word) {
    case "say":
      return rest || args ? { say: rest ? (args ? `${args}: ${rest}` : rest) : args } : null;
    case "write":
      if (stray || nums.length) return { say: line };
      return rest ? { op: "write", text: rest, size, color } : null;
    case "text":
      if (stray || nums.length < 2 || !rest) return { say: line };
      return { op: "text", x: nums[0]!, y: nums[1]!, text: rest, size, color };
    case "line":
    case "arrow":
      if (stray || nums.length < 4) return { say: line };
      return { op: word, x1: nums[0]!, y1: nums[1]!, x2: nums[2]!, y2: nums[3]!, color };
    case "rect":
    case "highlight":
    case "cover":
      if (stray || nums.length < 4) return { say: line };
      return { op: word, x: nums[0]!, y: nums[1]!, w: nums[2]!, h: nums[3]!, color };
    case "ellipse":
    case "circle": {
      if (stray || nums.length < 3) return { say: line };
      const [cx, cy, rx, ry = rx] = nums as [number, number, number, number?];
      return { op: "ellipse", x: cx - rx, y: cy - ry!, w: rx * 2, h: ry! * 2, color };
    }
    case "draw": {
      // The points come after the colon, or straight after the word.
      const points = [...`${args} ${rest}`.matchAll(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/g)].map((p) => [Number(p[1]), Number(p[2])] as [number, number]);
      return points.length >= 2 ? { op: "draw", points, color } : { say: line };
    }
    case "figure":
      if (stray || rest) return { say: line };
      return { op: "figure", height: nums[0] ?? 30 };
    case "card":
    case "flashcard": {
      // "Question :: Answer"; a model may also write "Question | Answer".
      const parts = rest.split(/\s*::\s*|\s+\|\s+/);
      if (args || parts.length < 2 || !parts[0]!.trim() || !parts.slice(1).join(" ").trim()) return { say: line };
      return { tool: "card", question: parts[0]!.trim(), answer: parts.slice(1).join(" ").trim() };
    }
    case "note":
      return !args && rest ? { tool: "note", text: rest } : { say: line };
    case "task": {
      const due = /^\d{4}-\d{2}-\d{2}$/.test(args) ? args : undefined;
      if (!rest || (args && !due)) return { say: line };
      return { tool: "task", text: rest, due };
    }
    case "quiz": {
      const parts = rest.split(/\s*\|\s*/).map((x) => x.trim()).filter(Boolean);
      if (args || parts.length < 3) return { say: line };
      return { tool: "quiz", question: parts[0]!, options: parts.slice(1, 7) };
    }
    case "timer":
      // "timer", "timer start"; a sentence is not.
      return rest || words.some((w) => !/^(start|on|focus)$/i.test(w)) ? { say: line } : { tool: "timer" };
    case "end":
    case "page":
    case "erase":
      // "page new" and "erase page" are fine; a sentence is not.
      if (rest || words.some((w) => !/^(new|next|page|all|figure|board)$/i.test(w))) return { say: line };
      return { op: word };
  }
  return { say: line };
}

/** The whole lines in what has streamed in so far; the last, unfinished one waits. */
export function completeLines(soFar: string, done = false): string[] {
  const lines = soFar.split("\n");
  if (!done) lines.pop();
  return lines;
}

/** What the tutor says, as plain words a voice can read: no Markdown marks, maths without its symbols. */
export function speakable(text: string): string {
  return text
    .replace(/\$\$?([^$]*)\$\$?/g, (_, m: string) => m.replace(/\\(?:frac|sqrt|times|cdot|rightarrow|to|left|right)\b/g, " ").replace(/[\\{}^_]/g, " "))
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2")
    .replace(/[*_`~#>=]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The language to read a sentence in, guessed from its letters; the browser's own language otherwise. */
export function speechLang(text: string, fallback = "en"): string {
  if (/[\u0600-\u06FF]/.test(text)) return "ar";
  if (/[\u0400-\u04FF]/.test(text)) return "ru";
  if (/[\u3040-\u30FF]/.test(text)) return "ja";
  if (/[\u4E00-\u9FFF]/.test(text)) return "zh";
  if (/[\uAC00-\uD7AF]/.test(text)) return "ko";
  if (/[\u0900-\u097F]/.test(text)) return "hi";
  // Latin letters: the browser's language when it is written in them, else English.
  return /^(ar|ru|uk|bg|ja|zh|ko|hi|fa|he|el|th)\b/i.test(fallback) ? "en" : fallback;
}
