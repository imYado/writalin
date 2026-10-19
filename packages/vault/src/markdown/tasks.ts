import type { Task, VaultPath } from "@writalin/shared";
import { isoDate } from "@writalin/shared";
import { codeRanges, inRanges } from "./code";
import { parseWikiLinks } from "./links";
import { parseInlineTags } from "./tags";

/** `- [ ] text`, `* [x] text`, `1. [ ] text` with any indentation. */
export const TASK_LINE_RE = /^([ \t]*)([-*+]|\d+[.)])[ \t]+\[([ xX])\][ \t]+(.*)$/;

// Obsidian Tasks plugin signifiers, plus ⏰ for a reminder time.
const FIELDS = {
  due: "📅",
  scheduled: "⏳",
  start: "🛫",
  doneDate: "✅",
  created: "➕",
} as const;
const DATE_FIELD_RE = /\s*(📅|⏳|🛫|✅|➕|❌)️?\s*(\d{4}-\d{2}-\d{2})/gu;
const TIME_RE = /\s*⏰️?\s*(\d{1,2}:\d{2})/u;
const PRIORITY_RE = /\s*(🔺|⏫|🔼|🔽|⏬)️?/gu;
const RECUR_RE = /\s*🔁️?\s*[^📅⏳🛫✅➕❌⏰#\[^]*/u;
const BLOCK_ID_RE = /\s+\^([A-Za-z0-9-]+)\s*$/;

export function parseTaskLine(line: string, path: VaultPath, lineNo: number): Task | null {
  const m = TASK_LINE_RE.exec(line);
  if (!m) return null;
  const content = m[4]!;
  const task: Task = {
    path,
    line: lineNo,
    status: m[3] === " " ? "todo" : "done",
    text: "",
    raw: line,
    tags: parseInlineTags(content).map((t) => t.tag),
    links: parseWikiLinks(content).map((l) => l.target),
    indent: m[1]!,
  };
  for (const f of content.matchAll(DATE_FIELD_RE)) {
    const date = f[2]!;
    switch (f[1]) {
      case FIELDS.due: task.due = date; break;
      case FIELDS.scheduled: task.scheduled = date; break;
      case FIELDS.start: task.start = date; break;
      case FIELDS.doneDate: task.doneDate = date; break;
    }
  }
  const block = BLOCK_ID_RE.exec(content);
  if (block) task.blockId = block[1]!;
  const time = TIME_RE.exec(content);
  if (time) task.time = time[1]!.padStart(5, "0");
  task.text = content
    .replace(BLOCK_ID_RE, "")
    .replace(DATE_FIELD_RE, "")
    .replace(TIME_RE, "")
    .replace(PRIORITY_RE, "")
    .replace(RECUR_RE, "")
    .trim();
  return task;
}

export function parseTasks(body: string, path: VaultPath, lineOffset = 0): Task[] {
  const code = codeRanges(body);
  const tasks: Task[] = [];
  let pos = 0;
  const lines = body.split("\n");
  lines.forEach((line, i) => {
    if (!inRanges(code, pos)) {
      const t = parseTaskLine(line.replace(/\r$/, ""), path, i + lineOffset);
      if (t) tasks.push(t);
    }
    pos += line.length + 1;
  });
  return tasks;
}

/** Date the task belongs to on a calendar: due, then scheduled, then start. */
export function taskDate(t: Task): string | undefined {
  return t.due ?? t.scheduled ?? t.start;
}

/**
 * Flip a task line's checkbox. Completing adds `✅ today` (as the Tasks plugin does);
 * reopening removes it.
 */
export function toggleTaskLine(line: string, today = isoDate()): string {
  const m = TASK_LINE_RE.exec(line);
  if (!m) return line;
  const done = m[3] !== " ";
  const prefix = `${m[1]}${m[2]} [${done ? " " : "x"}] `;
  let content = m[4]!;
  if (done) content = content.replace(/\s*✅️?\s*\d{4}-\d{2}-\d{2}/u, "");
  else content = `${content.trimEnd()} ✅ ${today}`;
  return prefix + content;
}

export interface NewTask {
  text: string;
  due?: string;
  time?: string;
  tags?: string[];
  link?: string;
  /** Block id so notes can link to this line. */
  id?: string;
}

/** A short random block id, e.g. `r-k3x9q2`. */
export function newBlockId(prefix = "r"): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

export function formatTaskLine(t: NewTask): string {
  let s = `- [ ] ${t.text.trim()}`;
  if (t.due) s += ` 📅 ${t.due}`;
  if (t.time) s += ` ⏰ ${t.time}`;
  for (const tag of t.tags ?? []) s += ` #${tag.replace(/^#/, "")}`;
  if (t.link) s += ` [[${t.link}]]`;
  if (t.id) s += ` ^${t.id}`;
  return s;
}
