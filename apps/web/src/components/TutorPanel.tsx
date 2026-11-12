import { useEffect, useRef, useState } from "react";
import { Icon } from "@writalin/ui";
import type { Vault } from "@writalin/vault";
import type { Account } from "../api";
import type { Tutor } from "../useTutor";
import { CardText } from "./CardText";

interface Props {
  vault: Vault;
  account: Account | null | undefined;
  tutor: Tutor;
  /** The PDF the tutor will write on, if one is open. */
  boardName: string | null;
  /** Whether that PDF is an empty one (a board) or a printed one (it gets marked up). */
  boardBlank: boolean;
  /** What the tutor reads beside the board, e.g. "page 3 of Biology.pdf". */
  reading: string | null;
  /** Open an empty PDF on the right to use as the board. */
  onNewBoard: () => void;
  onOpenSettings: () => void;
}

const STARTERS = ["Teach me this page step by step", "Explain it with a drawing", "Give me a worked example", "Quiz me on this"];

/**
 * Tutor mode: you write to the tutor, it answers here in a line or two and
 * does the teaching on the PDF, writing and drawing while you watch.
 */
export function TutorPanel({ vault, account, tutor, boardName, boardBlank, reading, onNewBoard, onOpenSettings }: Props) {
  const [enabled, setEnabled] = useState(vault.settings.aiEnabled);
  const [q, setQ] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const { log, busy } = tutor;

  // Keep the newest message in view.
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);
  useEffect(() => {
    if (!busy) input.current?.focus({ preventScroll: true });
  }, [busy]);

  if (account === undefined) return <p className="w-muted">Checking your account…</p>;
  if (account === null) {
    return (
      <div className="ai-intro">
        <span className="ai-badge"><Icon name="tutor" size={18} /></span>
        <div>
          <h3>Tutor</h3>
          <p className="w-muted w-small">Sign in to use the tutor. It only sees what you ask it to teach.</p>
        </div>
        <a className="w-btn w-btn-primary w-btn-small" href="/login">Sign in</a>
      </div>
    );
  }
  if (!enabled) {
    return (
      <div className="ai-intro">
        <span className="ai-badge"><Icon name="tutor" size={18} /></span>
        <div>
          <h3>Tutor</h3>
          <p className="w-muted w-small">The tutor teaches you on a PDF, writing and drawing live. AI is off until you turn it on.</p>
        </div>
        <button className="w-btn w-btn-primary w-btn-small" onClick={() => { void vault.saveSettings({ aiEnabled: true }); setEnabled(true); }}>
          Turn on
        </button>
      </div>
    );
  }

  const send = (text = q) => {
    if (!text.trim() || busy) return;
    setQ("");
    void tutor.send(text);
  };

  return (
    <div className={`tutor${log.length ? " tutor-started" : ""}`}>
      <p className="tutor-where w-muted w-small">
        {boardName ? (
          <>
            {boardBlank ? "Writes on" : "Marks up"} <b>{boardName}</b>
            {reading ? <> · reads {reading}</> : null}
            {!boardBlank && <> · <button className="ai-link tutor-link" onClick={onNewBoard}>Use a blank PDF instead</button></>}
          </>
        ) : (
          <>The tutor writes on a blank PDF that opens on the right when you ask your first question.</>
        )}
      </p>
      {log.length > 0 ? (
        <div className="tutor-log" ref={list} aria-live="polite">
          {log.map((m) => (
            <div key={m.id} className={`tutor-msg tutor-${m.from}${m.error ? " tutor-error" : ""}`}>
              {m.from === "you" ? m.text : m.text ? <CardText text={m.text} /> : null}
              {m.working && <span className="tutor-working">{m.text ? "Working on the page…" : "Thinking…"}</span>}
              {m.from === "tutor" && !m.working && !!m.drawn && (
                <button className="ai-link tutor-undo" onClick={() => tutor.undo(m.id)}>Take it off the page</button>
              )}
              {m.undone && <span className="tutor-working">Taken off the page.</span>}
            </div>
          ))}
        </div>
      ) : (
        <div className="tutor-starters">
          {STARTERS.map((s) => (
            <button key={s} className="w-chip" onClick={() => send(s)}>{s}</button>
          ))}
        </div>
      )}
      <form className="tutor-ask" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea
          ref={input}
          className="w-input tutor-input"
          rows={1}
          value={q}
          placeholder={log.length ? "Reply to your tutor…" : "What should we learn?"}
          aria-label="Message to your tutor"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        {busy ? (
          <button type="button" className="w-btn" onClick={tutor.stop}>Stop</button>
        ) : (
          <button type="submit" className="w-btn w-btn-primary" disabled={!q.trim()} aria-label="Send"><Icon name="send" size={16} /></button>
        )}
      </form>
      <div className="tutor-foot">
        {log.length > 0 && !busy && <button className="ai-link tutor-link" onClick={tutor.clear}>New lesson</button>}
        <button className="ai-link" onClick={onOpenSettings}>AI settings</button>
      </div>
    </div>
  );
}
