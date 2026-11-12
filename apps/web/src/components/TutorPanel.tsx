import { useEffect, useRef, useState } from "react";
import { Icon } from "@writalin/ui";
import type { QuizQuestion, Vault } from "@writalin/vault";
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
  /** Play a quiz the tutor made. */
  onPlayQuiz: (questions: QuizQuestion[]) => void;
}

/** "3 flashcards and 1 task saved to your note", for what a reply did with the app's tools. */
function savedLine(s: { cards: number; notes: number; tasks: number; timer?: boolean }): string {
  const n = (count: number, one: string) => (count ? `${count} ${one}${count === 1 ? "" : "s"}` : "");
  const parts = [n(s.cards, "flashcard"), n(s.notes, "note line"), n(s.tasks, "task")].filter(Boolean);
  const saved = parts.length ? `${parts.join(", ")} saved to your note.` : "";
  return [saved, s.timer ? "Focus timer started." : ""].filter(Boolean).join(" ");
}

const STARTERS = ["Teach me what's open, step by step", "Explain it with a drawing", "Make flashcards of the key points", "Quiz me"];

/**
 * Tutor mode: you write to the tutor, it talks (aloud, with captions) and
 * does the teaching on the PDF, writing and drawing while you watch. You can
 * pause it, and write again without waiting for it to finish.
 */
export function TutorPanel({ vault, account, tutor, boardName, boardBlank, reading, onNewBoard, onOpenSettings, onPlayQuiz }: Props) {
  const [enabled, setEnabled] = useState(vault.settings.aiEnabled);
  const [q, setQ] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const { log, busy, paused } = tutor;
  /** The student's own instructions for the tutor, edited here and kept with the vault. */
  const [rules, setRules] = useState<string | null>(null);
  const hasRules = !!vault.settings.tutorInstructions?.trim();

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
    if (!text.trim()) return;
    setQ("");
    void tutor.send(text);
  };

  return (
    <div className={`tutor${log.length ? " tutor-started" : ""}`}>
      <p className="tutor-where w-muted w-small">
        {boardName ? (
          <>
            {boardBlank ? "Writes on" : "Marks up"} <b>{boardName}</b>
            {reading ? <> · can use {reading}</> : null}
            {!boardBlank && <> · <button className="ai-link tutor-link" onClick={onNewBoard}>Use a blank PDF instead</button></>}
          </>
        ) : (
          <>Ask about anything. The tutor writes on a blank PDF that opens on the right.</>
        )}
      </p>
      {log.length > 0 ? (
        <div className="tutor-log" ref={list} aria-live="polite">
          {log.map((m) => (
            <div key={m.id} className={`tutor-msg tutor-${m.from}${m.error ? " tutor-error" : ""}`}>
              {m.from === "you" ? m.text : m.text ? <CardText text={m.text} /> : null}
              {m.pointing && <span className="tutor-pointing">Pointing at {m.pointing}</span>}
              {m.queued && <span className="tutor-queued">Waiting for the tutor to finish</span>}
              {m.working && <span className="tutor-working">{paused ? "Paused" : m.text ? "Working on the page…" : "Thinking…"}</span>}
              {m.saved && savedLine(m.saved) && <span className="tutor-working">{savedLine(m.saved)}</span>}
              {m.quiz && !m.working && (
                <button className="w-btn w-btn-small tutor-quiz" onClick={() => onPlayQuiz(m.quiz!)}>
                  <Icon name="play" size={13} /> Play the quiz ({m.quiz.length})
                </button>
              )}
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
          value={tutor.listening ? tutor.heard : q}
          readOnly={tutor.listening}
          placeholder={tutor.listening ? "Listening… say it, then pause" : busy ? "Write your next message…" : log.length ? "Reply to your tutor…" : "What should we learn? Any topic."}
          aria-label="Message to your tutor"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        {tutor.canListen && (
          <button
            type="button"
            className={`w-btn tutor-mic${tutor.listening ? " tutor-mic-on" : ""}`}
            aria-pressed={tutor.listening}
            aria-label={tutor.listening ? "Stop listening and send" : "Talk to your tutor"}
            title={tutor.listening ? "Listening. Tap to send what you said." : "Talk instead of typing. Point at something on the page first and say “I don't understand this”."}
            onClick={tutor.listen}
          >
            <Icon name="mic" size={16} />
          </button>
        )}
        <button type="submit" className="w-btn w-btn-primary" disabled={tutor.listening || !q.trim()} aria-label={busy ? "Send after the tutor finishes" : "Send"} title={busy ? "Sent as soon as the tutor finishes" : "Send"}><Icon name="send" size={16} /></button>
      </form>
      {tutor.micError && <p className="tutor-mic-error w-small" role="alert">{tutor.micError}</p>}
      <div className="tutor-controls">
        {busy && (
          <>
            <button className="w-btn w-btn-small" onClick={paused ? tutor.resume : tutor.pause} aria-pressed={paused}>
              <Icon name={paused ? "play" : "pause"} size={13} /> {paused ? "Resume" : "Pause"}
            </button>
            <button className="w-btn w-btn-small" onClick={tutor.stop}><Icon name="close" size={13} /> Stop</button>
          </>
        )}
        {tutor.canSpeak && (
          <button className="w-btn w-btn-small w-btn-ghost tutor-voice" aria-pressed={tutor.voice} onClick={() => tutor.setVoice(!tutor.voice)} title={tutor.voice ? "The tutor talks aloud, with captions. Tap to mute." : "The tutor is muted. Tap to hear it."}>
            <Icon name={tutor.voice ? "volume" : "volumeOff"} size={14} /> {tutor.voice ? "Voice on" : "Voice off"}
          </button>
        )}
      </div>
      {tutor.canSpeak && tutor.voice && tutor.voices.length > 1 && (
        <label className="tutor-voice-pick w-small w-muted">
          Voice
          <select className="w-input" value={tutor.voiceName} onChange={(e) => tutor.setVoiceName(e.target.value)} aria-label="The tutor's voice">
            <option value="">Chosen for you</option>
            {tutor.voices.map((v) => (
              <option key={`${v.name}|${v.lang}`} value={v.name}>{v.name} ({v.lang})</option>
            ))}
          </select>
        </label>
      )}
      {rules != null && (
        <div className="tutor-rules">
          <label className="w-small w-muted" htmlFor="tutor-rules">Your instructions for the tutor. It follows them in every lesson.</label>
          <textarea
            id="tutor-rules"
            className="w-input"
            rows={3}
            maxLength={1000}
            value={rules}
            placeholder="e.g. I'm in grade 10. Explain in simple English, go slowly, and give one example from real life each time."
            onChange={(e) => setRules(e.target.value)}
          />
          <div className="tutor-rules-actions">
            <button className="w-btn w-btn-primary w-btn-small" onClick={() => { void vault.saveSettings({ tutorInstructions: rules.trim() }); setRules(null); }}>Save</button>
            <button className="w-btn w-btn-ghost w-btn-small" onClick={() => setRules(null)}>Cancel</button>
          </div>
        </div>
      )}
      <div className="tutor-foot">
        {log.length > 0 && !busy && <button className="ai-link tutor-link" onClick={tutor.clear}>New lesson</button>}
        {rules == null && <button className="ai-link tutor-link" onClick={() => setRules(vault.settings.tutorInstructions ?? "")}>{hasRules ? "Your instructions" : "Add your instructions"}</button>}
        <button className="ai-link" onClick={onOpenSettings}>AI settings</button>
      </div>
    </div>
  );
}
