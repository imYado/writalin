import { useEffect, useRef, useState } from "react";
import { Icon, toast, type IconName } from "@writalin/ui";
import { cardsFromText, formatCards, parseQuiz, type QuizQuestion, type Vault } from "@writalin/vault";
import type { AiSourceText, WorkspaceAiSource } from "@writalin/workspaces";
import { aiApi, ApiError, type Account, type AiState, type AiTool } from "../api";

const TOOLS: { id: AiTool; label: string; desc: string; icon: IconName }[] = [
  { id: "explain", label: "Explain simply", desc: "Plain words and an example", icon: "bulb" },
  { id: "summarize", label: "Summarize", desc: "Main idea and key points", icon: "list" },
  { id: "mainpoint", label: "Main point", desc: "One or two sentences", icon: "focus" },
  { id: "steps", label: "Break into steps", desc: "Small tasks as a checklist", icon: "checkSquare" },
  { id: "flashcards", label: "Flashcards", desc: "Question :: Answer cards", icon: "copy" },
  { id: "quiz", label: "Quiz me", desc: "Multiple choice or written", icon: "sparkle" },
  { id: "whereWasI", label: "Where was I?", desc: "Recap and next step", icon: "clock" },
];

export type AiSource = AiSourceText;

interface Props {
  vault: Vault;
  account: Account | null | undefined;
  /** The text to work on: the selection, or the note. `whereWasI` gets text up to the cursor. */
  getSource: (tool: AiTool) => AiSource | null;
  /** What's open in the side pane (a PDF), offered as something else to read. */
  workspace?: WorkspaceAiSource | null;
  /** Switch to reading the side-pane workspace at this scope (its own AI button). */
  focusWorkspace?: { scope: string; nonce: number };
  /** False when no note is open to put the answer in. */
  canInsert: boolean;
  insert: (markdown: string) => void;
  onOpenSettings: () => void;
  /** Run a tool as soon as the panel can, e.g. picked from the right-click menu. */
  autoRun?: { tool: AiTool; nonce: number; source?: AiSource };
  /** Open the study view for these cards. */
  onStudy: (cards: { question: string; answer: string }[]) => void;
  /** Play a quiz the AI just made. */
  onPlayQuiz: (questions: QuizQuestion[]) => void;
}

/** The AI dock panel. Opt-in, signed-in only; the key is used on the server, never here. */
const readPref = (k: string): string | null => {
  try {
    return localStorage.getItem(`writalin.ai.${k}`);
  } catch {
    return null;
  }
};
const writePref = (k: string, v: string) => {
  try {
    if (v) localStorage.setItem(`writalin.ai.${k}`, v);
    else localStorage.removeItem(`writalin.ai.${k}`);
  } catch {
    /* private mode: just not remembered */
  }
};

/** The last `focusWorkspace` request applied, so reopening the panel later doesn't repeat it. */
let appliedFocus = 0;

export function AiPanel({ vault, account, getSource, workspace, focusWorkspace, canInsert, insert, onOpenSettings, autoRun, onStudy, onPlayQuiz }: Props) {
  const [enabled, setEnabled] = useState(vault.settings.aiEnabled);
  const [state, setState] = useState<AiState | null>(null);
  const [busy, setBusy] = useState<AiTool | null>(null);
  const [result, setResult] = useState<{ tool: AiTool; text: string; footer?: string } | null>(null);
  /** The answer so far, while it's still being written. */
  const [partial, setPartial] = useState<string | null>(null);
  /** Text handed over from elsewhere (a PDF), used instead of the note until cleared. */
  const [pinned, setPinned] = useState<AiSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  /** Read the note, or what's open in the side pane. An empty note starts on the side pane. */
  const [use, setUse] = useState<"note" | "workspace">(() => (workspace && !getSource("summarize")?.text.trim() ? "workspace" : "note"));
  const [scope, setScope] = useState(workspace?.defaultScope ?? "page");
  const [asked, setAsked] = useState("");
  // Quiz style and the extra wishes are remembered on this device.
  const [quizKind, setQuizKind] = useState<"choice" | "written">(() => (readPref("quizKind") === "written" ? "written" : "choice"));
  const [quizCount, setQuizCount] = useState(() => Number(readPref("quizCount")) || 5);
  const [quizSetup, setQuizSetup] = useState(false);
  const [extra, setExtra] = useState(() => readPref("extra") ?? "");
  const [extraOpen, setExtraOpen] = useState(() => !!readPref("extra"));
  useEffect(() => writePref("quizKind", quizKind), [quizKind]);
  useEffect(() => writePref("quizCount", String(quizCount)), [quizCount]);
  useEffect(() => writePref("extra", extra), [extra]);
  useEffect(() => {
    if (!focusWorkspace || focusWorkspace.nonce === appliedFocus || !workspace) return;
    appliedFocus = focusWorkspace.nonce;
    setPinned(null);
    setUse("workspace");
    setScope(focusWorkspace.scope);
    workspace.onScope?.(focusWorkspace.scope);
  }, [focusWorkspace, workspace]);

  useEffect(() => {
    if (account && enabled) void aiApi.state().then(setState).catch(() => {});
  }, [account, enabled]);
  const runRef = useRef<(tool: AiTool, from?: AiSource) => Promise<void>>(undefined);
  const ran = useRef(0);
  useEffect(() => {
    if (!autoRun || ran.current === autoRun.nonce || !account || !enabled) return;
    ran.current = autoRun.nonce;
    setPinned(autoRun.source ?? null);
    void runRef.current?.(autoRun.tool, autoRun.source);
  }, [autoRun, account, enabled]);

  if (account === undefined) return <p className="w-muted">Checking your account…</p>;
  if (account === null) {
    return (
      <div className="ai-intro">
        <span className="ai-badge"><Icon name="sparkle" size={18} /></span>
        <div>
          <h3>Study helper</h3>
          <p className="w-muted w-small">Sign in to use AI. It only sees the text you choose, and only when you ask.</p>
        </div>
        <a className="w-btn w-btn-primary w-btn-small" href="/login">Sign in</a>
      </div>
    );
  }
  if (!enabled) {
    return (
      <div className="ai-intro">
        <span className="ai-badge"><Icon name="sparkle" size={18} /></span>
        <div>
          <h3>Study helper</h3>
          <p className="w-muted w-small">Explain, summarize, flashcards and more. AI is off until you turn it on, and it only sees the text you send.</p>
        </div>
        <button className="w-btn w-btn-primary w-btn-small" onClick={() => { void vault.saveSettings({ aiEnabled: true }); setEnabled(true); }}>
          Turn on
        </button>
      </div>
    );
  }

  const fromWorkspace = use === "workspace" && !!workspace && !pinned;
  const run = async (tool: AiTool, from?: AiSource) => {
    setError(null);
    let src = from ?? pinned ?? null;
    if (!src && fromWorkspace) {
      setBusy(tool);
      src = await workspace!.build(scope).catch(() => null);
      if (!src) return setBusy(null);
    }
    src ??= getSource(tool);
    // A question works on its own; the tools need some text.
    const text = src?.text.trim() ? src.text : "";
    if (!text && tool !== "ask") {
      setBusy(null);
      return setError("Open a note with some text, or a PDF on the side. You can also just ask a question above.");
    }
    setBusy(tool);
    setResult(null);
    try {
      const r = await aiApi.run(tool, text, tool === "ask" ? question : undefined, { quizKind, count: quizCount, extra: extra.trim() || undefined }, setPartial);
      setResult({ tool, text: r.text, footer: text ? src?.footer : undefined });
      if (tool === "ask") {
        setAsked(question);
        setQuestion("");
      }
      void aiApi.state().then(setState).catch(() => {});
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(null);
      setPartial(null);
    }
  };

  runRef.current = run;

  const noteSrc = getSource("summarize");
  const scopeLabel = workspace?.scopes.find((x) => x.id === scope)?.label;
  const using = pinned
    ? `Using ${pinned.label}`
    : fromWorkspace
      ? `Using ${scopeLabel?.replace(/…$/, "").toLowerCase() ?? "it"} of “${workspace!.name}”`
      : noteSrc?.text.trim()
        ? `Using ${noteSrc.label}`
        : "No note text yet. Questions still work.";
  return (
    <div className="ai-panel">
      <div className="ai-head">
        <h3>Study helper</h3>
      </div>

      <form className="ai-ask" onSubmit={(e) => { e.preventDefault(); void run("ask"); }}>
        <input
          className="w-input"
          autoFocus={matchMedia("(pointer: fine)").matches}
          placeholder={fromWorkspace || pinned ? "Ask about this PDF, or anything…" : "Ask AI anything…"}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          aria-label="Ask AI a question"
        />
        <button className="w-btn w-btn-primary w-btn-small" disabled={!question.trim() || busy != null}>{busy === "ask" ? "…" : "Ask"}</button>
      </form>

      {extraOpen ? (
        <label className="ai-extra">
          <span className="w-small w-muted">
            Extra instructions for every answer
            {extra && <button type="button" className="ai-link" onClick={() => { setExtra(""); setExtraOpen(false); }}>Clear</button>}
          </span>
          <textarea
            className="w-input"
            rows={2}
            maxLength={1000}
            placeholder="e.g. make it harder, focus on chapter 2, answer in French"
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
          />
        </label>
      ) : (
        <button className="ai-link ai-extra-open" onClick={() => setExtraOpen(true)}>
          <Icon name="plus" size={12} /> Add instructions for the AI
        </button>
      )}

      {workspace && !pinned && (
        <div className="ai-use" role="group" aria-label="What AI reads">
          <span className="w-small w-muted">Read:</span>
          <button className="w-chip" aria-pressed={use === "note"} onClick={() => setUse("note")}>
            <Icon name="notes" size={13} /> This note
          </button>
          <button className="w-chip" aria-pressed={use === "workspace"} onClick={() => setUse("workspace")} title={workspace.name}>
            <Icon name="pdf" size={13} /> <span className="ai-use-name">{workspace.name}</span>
          </button>
        </div>
      )}
      {fromWorkspace && (
        <div className="ai-use ai-scopes" role="group" aria-label="Which part">
          {workspace!.scopes.map((x) => (
            <button
              key={x.id}
              className="w-chip"
              aria-pressed={scope === x.id}
              disabled={x.disabled}
              title={x.hint}
              onClick={() => {
                setScope(x.id);
                workspace!.onScope?.(x.id);
              }}
            >
              {x.label}
            </button>
          ))}
        </div>
      )}
      <span className="w-muted w-small ai-source">
        {using}
        {pinned && <button className="ai-link" onClick={() => setPinned(null)}>{workspace ? "Choose again" : "Use the note instead"}</button>}
      </span>

      <div className="w-action-grid">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className="w-action"
            disabled={busy != null}
            aria-expanded={t.id === "quiz" ? quizSetup : undefined}
            onClick={() => (t.id === "quiz" ? setQuizSetup((o) => !o) : void run(t.id))}
          >
            <Icon name={t.icon} size={16} />
            <span className="w-action-text">
              <span className="w-action-label">{t.label}</span>
              <span className="w-action-desc">
                {busy === t.id ? "Thinking…" : t.id === "quiz" ? `${quizCount} questions · ${quizKind === "choice" ? "multiple choice" : "written"}` : t.desc}
              </span>
            </span>
          </button>
        ))}
      </div>

      {quizSetup && (
        <div className="ai-quiz-setup">
          <div className="ai-use" role="group" aria-label="Kind of quiz">
            <span className="w-small w-muted">Answer by:</span>
            <button className="w-chip" aria-pressed={quizKind === "choice"} onClick={() => setQuizKind("choice")}>Multiple choice</button>
            <button className="w-chip" aria-pressed={quizKind === "written"} onClick={() => setQuizKind("written")}>Writing</button>
          </div>
          <div className="ai-use" role="group" aria-label="Number of questions">
            <span className="w-small w-muted">Questions:</span>
            {[5, 10, 15].map((n) => (
              <button key={n} className="w-chip" aria-pressed={quizCount === n} onClick={() => setQuizCount(n)}>{n}</button>
            ))}
          </div>
          <button className="w-btn w-btn-primary w-btn-small" disabled={busy != null} onClick={() => { setQuizSetup(false); void run("quiz"); }}>
            <Icon name="sparkle" size={14} /> Make the quiz
          </button>
        </div>
      )}

      {busy && !partial && <div className="ai-loading" aria-live="polite"><span /><span /><span /></div>}
      {busy && partial && <div className="ai-result ai-streaming"><div className="ai-result-text">{partial}</div></div>}
      {error && <p className="ai-error" role="alert">{error}</p>}
      {result && (() => {
        const cards = result.tool === "flashcards" ? cardsFromText(result.text) : [];
        const quiz = result.tool === "quiz" ? parseQuiz(result.text) : [];
        const body = cards.length ? formatCards(cards, { divider: true }) : result.text;
        const markdown = result.tool === "flashcards" && cards.length ? `### Flashcards\n${body}` : body;
        const full = result.footer ? `${markdown}\n\n${result.footer}` : markdown;
        return (
          <div className="ai-result">
            {result.tool === "ask" && asked && <p className="ai-asked w-small w-muted">You asked: {asked}</p>}
            {cards.length ? (
              <ul className="ai-cards" aria-label={`${cards.length} flashcards`}>
                {cards.map((c, i) => <li key={i}><b>{c.question}</b><span>{c.answer}</span></li>)}
              </ul>
            ) : (
              <div className="ai-result-text">{result.text}</div>
            )}
            <div className="w-row">
              {canInsert && <button className="w-btn w-btn-primary w-btn-small" onClick={() => { insert(full); toast(cards.length ? `Added ${cards.length} flashcards to your note.` : "Added to your note."); setResult(null); }}>
                <Icon name="plus" size={14} /> {cards.length ? "Add cards to note" : "Insert into note"}
              </button>}
              {quiz.length > 0 && (
                <button className="w-btn w-btn-small" onClick={() => onPlayQuiz(quiz)}>
                  <Icon name="play" size={14} /> Play quiz
                </button>
              )}
              {cards.length > 0 && (
                <button className="w-btn w-btn-small" onClick={() => onStudy(cards)}>
                  <Icon name="play" size={14} /> Study now
                </button>
              )}
              <button className="w-btn w-btn-small" onClick={() => void navigator.clipboard.writeText(full).then(() => toast("Copied."))}>
                <Icon name="copy" size={14} /> Copy
              </button>
              <button className="w-btn w-btn-ghost w-btn-small" onClick={() => setResult(null)}>Discard</button>
            </div>
          </div>
        );
      })()}

      <div className="ai-foot w-small w-muted">
        <Icon name={state?.mode === "own" ? "key" : "shield"} size={13} />
        {state == null
          ? "Loading…"
          : state.mode === "own"
            ? `Your key ••••${state.keyHint ?? ""} · ${state.usedToday}/${state.limit} today`
            : state.builtinAvailable
              ? `Built-in AI · ${state.usedToday}/${state.limit} today`
              : "Built-in AI isn't switched on yet. Add your own key."}
        <button className="ai-link" onClick={onOpenSettings}>AI settings</button>
      </div>
    </div>
  );
}
