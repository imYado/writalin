import { useCallback, useRef, useState } from "react";
import type { PdfBoard } from "@writalin/workspaces";
import { aiApi, ApiError } from "./api";
import { completeLines, parseTutorLine } from "./tutorBoard";

export interface TutorMsg {
  id: string;
  from: "you" | "tutor";
  text: string;
  /** Still talking or drawing. */
  working?: boolean;
  error?: boolean;
  /** How many things this reply put on the board (they can be taken back). */
  drawn?: number;
  undone?: boolean;
  /** What the tutor was reading, e.g. "page 4 of Biology.pdf". */
  using?: string;
}

export interface TutorHost {
  /** The PDF to write and draw on; opens an empty one when there is none. */
  board: () => Promise<PdfBoard | null>;
  /** What the student is studying beside the board, to teach from. */
  material: (board: PdfBoard, question: string) => Promise<{ text: string; label: string } | null>;
}

const newId = () => Math.random().toString(36).slice(2, 10);
/** Matches the server's limit on how much text one request may send, with room for the board. */
const MAX_MATERIAL = 40_000;

/**
 * A tutoring session: the student writes, the tutor answers in the chat and
 * works on the board live. The conversation lives only while the app is open.
 */
export function useTutor(host: TutorHost) {
  const [log, setLog] = useState<TutorMsg[]>([]);
  const [busy, setBusy] = useState(false);
  const hostNow = useRef(host);
  hostNow.current = host;
  const stopRef = useRef<AbortController | null>(null);
  /** What was asked and what the tutor replied (its commands), for the next question. */
  const history = useRef<{ role: "user" | "assistant"; content: string }[]>([]);
  /** The marks each reply added, and the board they are on. */
  const work = useRef(new Map<string, { board: PdfBoard; ids: string[] }>());
  const busyNow = useRef(false);

  const patch = (id: string, change: (m: TutorMsg) => TutorMsg) => setLog((l) => l.map((m) => (m.id === id ? change(m) : m)));

  const send = useCallback(async (question: string) => {
    const q = question.trim();
    if (!q || busyNow.current) return;
    busyNow.current = true;
    setBusy(true);
    const id = newId();
    setLog((l) => [...l, { id: newId(), from: "you", text: q }, { id, from: "tutor", text: "", working: true }]);
    const stop = new AbortController();
    stopRef.current = stop;
    let raw = "";
    try {
      const board = await hostNow.current.board();
      if (!board) throw new ApiError(0, "Open a PDF or a blank PDF first, so there is something to write on.");
      board.begin();
      const [about, material] = await Promise.all([board.describe(), hostNow.current.material(board, q).catch(() => null)]);
      if (material) patch(id, (m) => ({ ...m, using: material.label }));
      const ids: string[] = [];
      work.current.set(id, { board, ids });
      // Lines are carried out one after another, in the order they were written.
      let fed = 0;
      let chain: Promise<void> = Promise.resolve();
      const feed = (lines: string[]) => {
        for (const line of lines.slice(fed)) {
          const step = parseTutorLine(line);
          if (!step) continue;
          chain = chain.then(async () => {
            // Stopped: the rest of the reply is dropped.
            if (stop.signal.aborted) return;
            if ("say" in step) return patch(id, (m) => ({ ...m, text: m.text ? `${m.text}\n${step.say}` : step.say }));
            const added = await board.apply(step);
            if (added.length) {
              ids.push(...added);
              patch(id, (m) => ({ ...m, drawn: ids.length }));
            }
          }).catch(() => {});
        }
        fed = Math.max(fed, lines.length);
      };
      const r = await aiApi.run("tutor", (material?.text ?? "").slice(0, MAX_MATERIAL), q, { board: about, printed: !board.blank, history: history.current.slice(-8), signal: stop.signal }, (soFar) => {
        raw = soFar;
        feed(completeLines(soFar));
      });
      raw = r.text;
      feed(completeLines(r.text, true));
      await chain;
      history.current.push({ role: "user", content: q }, { role: "assistant", content: raw.slice(0, 5000) });
      patch(id, (m) => ({ ...m, working: false, text: m.text || (ids.length ? "It's on the board." : "I have nothing to add.") }));
    } catch (e) {
      const stopped = stop.signal.aborted;
      // Stopped part-way: what's already on the board stays, and the tutor remembers it.
      if (stopped && raw.trim()) history.current.push({ role: "user", content: q }, { role: "assistant", content: raw.slice(0, 5000) });
      const message = stopped ? "" : e instanceof ApiError ? e.message : "Something went wrong. Try again.";
      patch(id, (m) => ({ ...m, working: false, error: !stopped, text: stopped ? m.text || "Stopped." : message }));
    } finally {
      stopRef.current = null;
      busyNow.current = false;
      setBusy(false);
    }
  }, []);

  /** Stop the reply; what is being drawn finishes at once. */
  const stop = useCallback(() => {
    stopRef.current?.abort();
    for (const w of work.current.values()) w.board.hurry();
  }, []);

  /** Take what a reply put on the board back off. */
  const undo = useCallback((id: string) => {
    const w = work.current.get(id);
    if (!w?.ids.length) return;
    w.board.remove(w.ids);
    work.current.delete(id);
    patch(id, (m) => ({ ...m, undone: true, drawn: 0 }));
  }, []);

  const clear = useCallback(() => {
    stop();
    history.current = [];
    work.current.clear();
    setLog([]);
  }, [stop]);

  return { log, busy, send, stop, undo, clear };
}

export type Tutor = ReturnType<typeof useTutor>;
