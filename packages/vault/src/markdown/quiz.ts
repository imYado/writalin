/**
 * Quizzes written in a note (as the AI makes them):
 *
 *     1. Question?
 *         - A. option
 *         - B. option
 *
 *     > [!success]- Answers
 *     > 1. B. Why.
 *
 * Questions with lettered options are multiple choice; the rest are written
 * answers. The answer key sits in a callout so Obsidian keeps it folded.
 */
export interface QuizQuestion {
  question: string;
  /** Empty for a written question. */
  options: string[];
  /** Index of the right option, or -1 when the key doesn't say. */
  correct: number;
  /** The key's text: the model answer, or why the right option is right. */
  answer: string;
}

const QUESTION_RE = /^\s*(\d+)[.)]\s+(.+)$/;
const OPTION_RE = /^\s*(?:[-*+]\s+)?(?:\[[ xX]\]\s+)?\(?([A-Fa-f])[.)]\s+(.+)$/;
const KEY_LINE_RE = /^\s*>\s*(?:[-*+]\s+)?(\d+)[.)]\s*(.*)$/;
const KEY_LETTER_RE = /^\**\(?([A-Fa-f])\)?(?:[.):]|\*\*|\s|$)\**\s*(?:[-–—:]\s*)?/;

export function parseQuiz(text: string): QuizQuestion[] {
  const lines = text.split("\n");
  const questions = new Map<number, { question: string; options: string[] }>();
  const order: number[] = [];
  const key = new Map<number, string>();
  let current: { question: string; options: string[] } | null = null;
  let inKey = false;
  for (const line of lines) {
    if (/^\s*>/.test(line)) {
      // Any callout or quote after the questions holds the key.
      if (/\[!\w+\][+-]?\s*answers?/i.test(line) || order.length) inKey = true;
      const k = KEY_LINE_RE.exec(line);
      if (inKey && k) key.set(Number(k[1]), k[2]!.trim());
      current = null;
      continue;
    }
    const opt = current && OPTION_RE.exec(line);
    if (opt && /^\s+|^\s*[-*+]\s/.test(line)) {
      current!.options.push(opt[2]!.trim());
      continue;
    }
    const q = QUESTION_RE.exec(line);
    if (q) {
      const n = Number(q[1]);
      current = { question: q[2]!.replace(/\*\*/g, "").trim(), options: [] };
      if (!questions.has(n)) order.push(n);
      questions.set(n, current);
      continue;
    }
    if (line.trim() && current && !current.options.length && /^\s+\S/.test(line)) current.question += ` ${line.trim()}`;
  }
  return order.map((n) => {
    const { question, options } = questions.get(n)!;
    let answer = key.get(n) ?? "";
    let correct = -1;
    if (options.length) {
      const m = KEY_LETTER_RE.exec(answer);
      if (m) {
        correct = m[1]!.toUpperCase().charCodeAt(0) - 65;
        answer = answer.slice(m[0].length).trim();
      }
      if (correct >= options.length) correct = -1;
    }
    return { question, options, correct, answer: answer.replace(/\*\*/g, "") };
  });
}
