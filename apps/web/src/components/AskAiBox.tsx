import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon, toast } from "@writalin/ui";
import type { Vault } from "@writalin/vault";
import { aiApi, ApiError } from "../api";
import { diffChanges, isReplaceAnswer, replaceText } from "../aiEdits";
import { CardText } from "./CardText";

/** Matches the server's limit on how much text one request may send. */
const MAX_CHARS = 58_000;

export interface AskTarget {
  /** The highlighted text and where it is in the note. */
  from: number;
  to: number;
  text: string;
  /** The whole note, for context. */
  note: string;
  /** Where to show the box: just under the highlighted text. */
  x: number;
  y: number;
}

interface Props {
  vault: Vault;
  target: AskTarget;
  /** The note as it is now, to check the highlighted text is still there. */
  currentNote: () => string | null;
  /** Show changes in the note for the person to accept or reject. */
  suggest: (changes: { from: number; to: number; insert: string }[], summary: string) => void;
  /** Put an answer into the note on its own lines, under the highlighted text. */
  addBelow: (md: string, at: number) => void;
  onOpenSettings: () => void;
  onClose: () => void;
}

/** The note around the highlighted text, cut to fit one request. */
function context(note: string, from: number, to: number, budget: number): string {
  if (note.length <= budget) return note;
  const room = Math.max(0, budget - (to - from));
  const start = Math.max(0, Math.min(from - Math.floor(room / 2), note.length - budget));
  return note.slice(start, start + budget);
}

/**
 * "Ask AI" on highlighted text: ask about it, or tell the AI what to change.
 * A question gets its answer here. A change is shown in the note, word by
 * word, for the person to accept or reject, and can only touch the
 * highlighted text. The AI reads the rest of the note when it needs to.
 */
export function AskAiBox({ vault, target, currentNote, suggest, addBelow, onOpenSettings, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const stopRef = useRef<AbortController | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [pos, setPos] = useState({ left: target.x, top: target.y });
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [partial, setPartial] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(vault.settings.aiEnabled);

  // Kept inside the window (and above the phone keyboard), under the text or else above it.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const vv = window.visualViewport;
    const vh = vv ? vv.height + vv.offsetTop : window.innerHeight;
    const r = el.getBoundingClientRect();
    const pad = 8;
    const below = target.y + 8;
    setPos({
      left: Math.max(pad, Math.min(target.x - 24, window.innerWidth - r.width - pad)),
      top: below + r.height + pad <= vh ? below : Math.max(pad, Math.min(target.y - r.height - 32, vh - r.height - pad)),
    });
  }, [target, answer, partial, error, busy]);

  useEffect(() => {
    // Ready for the next question as soon as an answer is in.
    if (enabled && !busy) input.current?.focus({ preventScroll: true });
  }, [enabled, busy]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (stopRef.current) stopRef.current.abort();
      else close.current();
    };
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node) && !stopRef.current) close.current();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown, true);
      stopRef.current?.abort();
    };
  }, []);

  const go = async () => {
    const question = q.trim();
    if (!question || busy) return;
    setBusy(true);
    setError(null);
    setAnswer(null);
    setPartial("");
    const stop = new AbortController();
    stopRef.current = stop;
    try {
      const note = context(target.note, target.from, target.to, MAX_CHARS - target.text.length);
      const r = await aiApi.run("ask", note, question, { edit: "selection", selection: target.text, signal: stop.signal }, setPartial);
      if (!isReplaceAnswer(r.text)) {
        setAnswer(r.text.trim());
        setQ("");
        return;
      }
      // The note may have changed while the AI was writing; find the highlighted text again.
      const now = currentNote();
      if (now == null) return setError("Open the note again to see the changes.");
      let from = target.from;
      if (now.slice(from, from + target.text.length) !== target.text) {
        const all: number[] = [];
        for (let i = now.indexOf(target.text); i >= 0; i = now.indexOf(target.text, i + 1)) all.push(i);
        if (!all.length) return setError("The highlighted text changed while the AI was writing. Highlight it again and try once more.");
        from = all.reduce((best, i) => (Math.abs(i - target.from) < Math.abs(best - target.from) ? i : best));
      }
      const next = replaceText(r.text);
      const changes = diffChanges(target.text, next, from);
      // Deleting whole lines takes their line break too, so no blank line is left behind.
      const end = from + target.text.length;
      if (!next && changes.length === 1 && (from === 0 || now[from - 1] === "\n") && now[end] === "\n") changes[0]!.to = end + 1;
      if (!changes.length) {
        setAnswer("Nothing needed changing.");
        setQ("");
        return;
      }
      suggest(changes, next.trim() ? "" : "Delete the highlighted text");
      onClose();
    } catch (e) {
      if (!stop.signal.aborted) setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
    } finally {
      stopRef.current = null;
      setBusy(false);
      setPartial("");
    }
  };

  const writingChanges = busy && isReplaceAnswer(partial);

  return (
    <div ref={ref} className="w-popover ask-ai" role="dialog" aria-label="Ask AI" style={pos} onContextMenu={(e) => e.preventDefault()}>
      {!enabled ? (
        <div className="ask-ai-off">
          <p className="w-small">AI is off. It only sees the text you send it.</p>
          <button className="w-btn w-btn-primary w-btn-small" onClick={() => { void vault.saveSettings({ aiEnabled: true }); setEnabled(true); }}>Turn on</button>
        </div>
      ) : (
        <>
          <form className="ask-ai-form" onSubmit={(e) => { e.preventDefault(); void go(); }}>
            <Icon name="sparkle" size={16} className="ask-ai-icon" />
            <textarea
              ref={input}
              className="ask-ai-input"
              rows={1}
              value={q}
              placeholder="Ask about it, or say what to change…"
              aria-label="Ask AI about the highlighted text"
              disabled={busy}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void go();
                }
              }}
            />
            {busy ? (
              <button type="button" className="w-btn w-btn-small" onClick={() => stopRef.current?.abort()}>Stop</button>
            ) : (
              <button type="submit" className="w-btn w-btn-primary w-btn-small" disabled={!q.trim()}>Go</button>
            )}
          </form>
          {busy && (
            <div className="ask-ai-answer w-muted" aria-live="polite">
              {writingChanges ? "Writing the changes…" : partial ? <CardText text={partial} /> : "Thinking…"}
            </div>
          )}
          {error && (
            <p className="ai-error ask-ai-error">
              {error} <button className="ai-link" onClick={onOpenSettings}>AI settings</button>
            </p>
          )}
          {answer != null && !busy && (
            <>
              <div className="ask-ai-answer"><CardText text={answer} /></div>
              {answer !== "Nothing needed changing." && (
                <div className="ask-ai-actions">
                  <button className="w-btn w-btn-small" onClick={() => { addBelow(answer, target.to); onClose(); }}>Add below</button>
                  <button className="w-btn w-btn-ghost w-btn-small" onClick={() => void navigator.clipboard.writeText(answer).then(() => toast("Copied."), () => toast("Couldn't copy.", { tone: "warn" }))}>Copy</button>
                </div>
              )}
            </>
          )}
          {!busy && answer == null && !error && <p className="ask-ai-hint w-muted">Only the highlighted text can change, and you approve every change.</p>}
        </>
      )}
    </div>
  );
}
