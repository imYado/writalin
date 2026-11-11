import { useEffect, useRef, useState } from "react";
import { Icon, toast, type IconName } from "@writalin/ui";
import { cardsFromText, formatCards, parseQuiz, type QuizQuestion, type Vault } from "@writalin/vault";
import { CardText } from "./CardText";
import type { AiSourceText, WorkspaceAiSource } from "@writalin/workspaces";
import { aiApi, ApiError, type Account, type AiState, type AiTool } from "../api";
import { isEditAnswer, parseEdits, type AiEdit } from "../aiEdits";
import { buildVaultSources, citedNumbers, sourcesFooter, sourceTitle, type CitedSource } from "../vaultSources";

const TOOLS: { id: AiTool; label: string; desc: string; icon: IconName }[] = [
  { id: "explain", label: "Explain simply", desc: "Plain words and an example", icon: "bulb" },
  { id: "summarize", label: "Summarize", desc: "Main idea and key points", icon: "list" },
  { id: "mainpoint", label: "Main point", desc: "One or two sentences", icon: "focus" },
  { id: "steps", label: "Break into steps", desc: "Small tasks as a checklist", icon: "checkSquare" },
  { id: "flashcards", label: "Flashcards", desc: "Question :: Answer cards", icon: "copy" },
  { id: "quiz", label: "Quiz me", desc: "Multiple choice or written", icon: "sparkle" },
  { id: "whereWasI", label: "Where was I?", desc: "Recap and next step", icon: "clock" },
];

/** Text for the AI; `range` marks it as part of the open note (the selection, or all of it), which the AI may edit. */
export type AiSource = AiSourceText & { range?: { from: number; to: number } };

/** One-tap edits, like Notion's: they always come back as changes to approve. */
const QUICK_EDITS = [
  { label: "Fix spelling", q: "Fix spelling, grammar and punctuation. Change nothing else." },
  { label: "Make shorter", q: "Make this shorter and clearer, keeping every key fact." },
  { label: "Simpler words", q: "Rewrite this in simpler words that are easier to read, keeping the meaning." },
  { label: "Make longer", q: "Expand this with more detail and an example where it helps." },
  { label: "Tidy layout", q: "Improve the layout: add headings, bullet points and bold key terms where they help. Keep the wording." },
];

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
  /** Put new text into the note at the cursor (and close the panel so it can be seen). */
  insert: (markdown: string) => void;
  /** Take back what was just inserted. */
  undo?: () => void;
  onOpenSettings: () => void;
  /** Run a tool as soon as the panel can, e.g. picked from the right-click menu. */
  autoRun?: { tool: AiTool; nonce: number; source?: AiSource };
  /** Open the study view for these cards. */
  onStudy: (cards: { question: string; answer: string }[]) => void;
  /** Play a quiz the AI just made. */
  onPlayQuiz: (questions: QuizQuestion[]) => void;
  /** Open a note at a line, for a citation in an answer about all notes. */
  openSource?: (path: string, line: number) => void;
  /** Show the AI's edits in the open note for approval, inside `range`. */
  suggestEdits?: (edits: AiEdit[], range: { from: number; to: number } | undefined, summary: string) => EditResult | null;
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

/** What happened when edits were shown in the note. */
interface EditResult {
  shown: number;
  missed: number;
}

/** An answer shown in the panel, when there's no note open to put it in. */
interface Shown {
  tool: AiTool;
  text: string;
  footer?: string;
  sources?: CitedSource[];
}

/** Old builds kept recent answers on the device; they're no longer shown, so they're deleted. */
function forgetSavedAnswers() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith("writalin.ai.recent.")) localStorage.removeItem(k);
    }
  } catch {
    /* private mode: nothing saved */
  }
}
forgetSavedAnswers();

const doneLabel: Partial<Record<AiTool, string>> = {
  summarize: "Summary", explain: "Explanation", mainpoint: "Main point", steps: "Steps", flashcards: "Flashcards", quiz: "Quiz", whereWasI: "Recap",
};

export function AiPanel({ vault, account, getSource, workspace, focusWorkspace, canInsert, insert, undo, onOpenSettings, autoRun, onStudy, onPlayQuiz, suggestEdits, openSource }: Props) {
  const [enabled, setEnabled] = useState(vault.settings.aiEnabled);
  const [state, setState] = useState<AiState | null>(null);
  const [busy, setBusy] = useState<AiTool | null>(null);
  /** The answer so far, while it's still being written. */
  const [partial, setPartial] = useState<string | null>(null);
  const partialRef = useRef("");
  const stopRef = useRef<AbortController | null>(null);
  /** A slow step before the answer starts, e.g. reading scanned pages. */
  const [progress, setProgress] = useState<string | null>(null);
  /** Text handed over from elsewhere (a PDF), used instead of the note until cleared. */
  const [pinned, setPinned] = useState<AiSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [question, setQuestion] = useState("");
  /** Read the note, or what's open in the side pane. An empty note starts on the side pane. */
  const [use, setUse] = useState<"note" | "workspace" | "vault">(() => (workspace && !getSource("summarize")?.text.trim() ? "workspace" : "note"));
  const [scope, setScope] = useState(workspace?.defaultScope ?? "page");
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
  const runRef = useRef<(tool: AiTool, from?: AiSource, quick?: string) => Promise<void>>(undefined);
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
          <h3>AI</h3>
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
          <h3>AI</h3>
          <p className="w-muted w-small">Summarize, explain, make flashcards, or edit your note. AI is off until you turn it on, and it only sees the text you send.</p>
        </div>
        <button className="w-btn w-btn-primary w-btn-small" onClick={() => { void vault.saveSettings({ aiEnabled: true }); setEnabled(true); }}>
          Turn on
        </button>
      </div>
    );
  }

  const fromWorkspace = use === "workspace" && !!workspace && !pinned;
  const fromVault = use === "vault" && !pinned;

  /** Ask the AI, streaming the answer in. Returns the answer, or null when it failed or was stopped. */
  const ask = async (tool: AiTool, text: string, q: string | undefined, edit: "auto" | "force" | undefined) => {
    const stop = new AbortController();
    stopRef.current = stop;
    partialRef.current = "";
    try {
      const r = await aiApi.run(tool, text, q, { quizKind, count: quizCount, extra: extra.trim() || undefined, edit, signal: stop.signal }, (soFar) => {
        partialRef.current = soFar;
        setPartial(soFar);
      });
      void aiApi.state().then(setState).catch(() => {});
      return r.text;
    } catch (e) {
      // Stopped: nothing goes into the note.
      if (!stop.signal.aborted) setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
      return null;
    } finally {
      stopRef.current = null;
    }
  };

  /**
   * Put the answer where it belongs: changes are shown in the note to accept
   * or reject; anything new goes straight into the note at the cursor. With no
   * note open, it's shown here to copy.
   */
  const deliver = (tool: AiTool, answer: string, opts: { range?: { from: number; to: number }; footer?: string; sources?: CitedSource[] } = {}) => {
    if (isEditAnswer(answer)) {
      const p = parseEdits(answer);
      if (!p?.edits.length) return setError("The AI didn't suggest any changes. Try saying exactly what to change.");
      const r = suggestEdits?.(p.edits, opts.range, p.summary.split("\n")[0] ?? "");
      if (!r?.shown) setError("The AI's changes didn't match your note. Try again, or select the part to change first.");
      return;
    }
    const cards = tool === "flashcards" ? cardsFromText(answer) : [];
    const body = cards.length ? `### Flashcards\n${formatCards(cards, { divider: true })}` : answer;
    const footer = tool === "vault" ? sourcesFooter(answer, opts.sources ?? []) : opts.footer;
    const full = footer ? `${body}\n\n${footer}` : body;
    if (!canInsert) return setShown({ tool, text: answer, footer, sources: opts.sources });
    const quiz = tool === "quiz" ? parseQuiz(answer) : [];
    const what = doneLabel[tool] ?? "Answer";
    toast(cards.length ? `Added ${cards.length} flashcards.` : `${what} added to your note.`, {
      action: cards.length ? { label: "Study now", run: () => onStudy(cards) } : quiz.length ? { label: "Play quiz", run: () => onPlayQuiz(quiz) } : undo ? { label: "Undo", run: undo } : undefined,
    });
    insert(full);
  };

  /** Ask about all notes: find the passages that match, then ask with them as numbered sources. */
  const runVault = async (q: string) => {
    setError(null);
    setShown(null);
    const { text, sources } = buildVaultSources(vault, q);
    if (!sources.length) return setError("Nothing in your notes matches that question. Try other words, or switch to This note.");
    setBusy("vault");
    try {
      const a = await ask("vault", text, q, undefined);
      if (a == null) return;
      setQuestion("");
      deliver("vault", a, { sources });
    } finally {
      setBusy(null);
      setPartial(null);
    }
  };
  const run = async (tool: AiTool, from?: AiSource, quick?: string) => {
    if (tool === "ask" && fromVault && !from && !quick) return runVault(question.trim());
    setError(null);
    setShown(null);
    let src = from ?? pinned ?? null;
    const q = tool === "ask" ? quick ?? question.trim() : undefined;
    if (!src && fromWorkspace) {
      setBusy(tool);
      src = await workspace!.build(scope, q, setProgress).catch(() => null);
      setProgress(null);
      if (!src) return setBusy(null);
    }
    src ??= getSource(tool);
    // A request works on its own; the tools need some text.
    const text = src?.text.trim() ? src.text : "";
    if (!text && tool !== "ask") {
      setBusy(null);
      return setError("Open a note with some text, or a PDF on the side. You can also just type a request above.");
    }
    // A request about the open note may come back as edits to it.
    const editable = tool === "ask" && !!text && !!src?.range && canInsert;
    if (quick && !editable) {
      setBusy(null);
      return setError("Open a note with some text first. Select a part to edit only that.");
    }
    setBusy(tool);
    try {
      const a = await ask(tool, text, q, editable ? (quick ? "force" : "auto") : undefined);
      if (a == null) return;
      if (tool === "ask" && !quick) setQuestion("");
      deliver(tool, a, { range: editable ? src!.range : undefined, footer: text ? src?.footer : undefined });
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
    : fromVault
      ? "Finds the parts of your notes that answer each question, and links them."
    : fromWorkspace
      ? `Using ${scopeLabel?.replace(/…$/, "").toLowerCase() ?? "it"} of “${workspace!.name}”`
      : noteSrc?.text.trim()
        ? `Using ${noteSrc.label}`
        : "No note text yet. Requests still work.";
  const where = canInsert ? "Answers go into your note at the cursor. Changes to your note wait for you to accept them." : "Open a note to put answers straight into it.";
  /** The answer while it's written; edits show as progress, not raw blocks. */
  const streamView = (text: string) => {
    if (!isEditAnswer(text)) return <div className="ai-result-text">{text}</div>;
    const p = parseEdits(text);
    return (
      <div className="ai-edit">
        <p className="ai-edit-title"><Icon name="sparkle" size={14} /> {p?.summary.split("\n")[0] || "Writing changes…"}</p>
        <p className="w-small w-muted">Writing {p?.edits.length ? `change ${p.edits.length}` : "changes"}…</p>
      </div>
    );
  };
  return (
    <div className="ai-panel">
      <form className="ai-ask" onSubmit={(e) => { e.preventDefault(); void run("ask"); }}>
        <input
          className="w-input"
          autoFocus={matchMedia("(pointer: fine)").matches}
          placeholder={fromVault ? "Ask about everything in your notes…" : canInsert ? "Write, or tell AI what to change…" : "Ask AI anything…"}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          aria-label="Ask AI"
        />
        <button className="w-btn w-btn-primary w-btn-small" disabled={!question.trim() || busy != null}>{busy === "ask" || busy === "vault" ? "…" : "Go"}</button>
      </form>

      {extraOpen ? (
        <label className="ai-extra">
          <span className="w-small w-muted">
            Extra instructions for every request
            {extra && <button type="button" className="ai-link" onClick={() => { setExtra(""); setExtraOpen(false); }}>Clear</button>}
          </span>
          <textarea
            className="w-input"
            rows={2}
            maxLength={1000}
            placeholder="e.g. keep it short, focus on chapter 2, write in French"
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
          />
        </label>
      ) : (
        <button className="ai-link ai-extra-open" onClick={() => setExtraOpen(true)}>
          <Icon name="plus" size={12} /> Add instructions for the AI
        </button>
      )}

      {!pinned && (
        <div className="ai-use" role="group" aria-label="What AI reads">
          <span className="w-small w-muted">Read:</span>
          <button className="w-chip" aria-pressed={use === "note"} onClick={() => setUse("note")}>
            <Icon name="notes" size={13} /> This note
          </button>
          {workspace && (
            <button className="w-chip" aria-pressed={use === "workspace"} onClick={() => setUse("workspace")} title={workspace.name}>
              <Icon name="pdf" size={13} /> <span className="ai-use-name">{workspace.name}</span>
            </button>
          )}
          <button className="w-chip" aria-pressed={use === "vault"} onClick={() => setUse("vault")} title="Answers from all your notes, with links to where each part came from">
            <Icon name="search" size={13} /> All notes
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

      {!fromWorkspace && !fromVault && !pinned && !!noteSrc?.text.trim() && suggestEdits && canInsert && (
        <div className="ai-use ai-quick-edits" role="group" aria-label="Edit with AI">
          <span className="w-small w-muted">Edit:</span>
          {QUICK_EDITS.map((e) => (
            <button key={e.label} className="w-chip" disabled={busy != null} title={e.q} onClick={() => void run("ask", undefined, e.q)}>{e.label}</button>
          ))}
        </div>
      )}

      {!fromVault && (
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
                  {busy === t.id ? "Writing…" : t.id === "quiz" ? `${quizCount} questions · ${quizKind === "choice" ? "multiple choice" : "written"}` : t.desc}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {quizSetup && !fromVault && (
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

      {error && <p className="ai-error" role="alert">{error}</p>}
      {busy && partial != null && <div className="ai-result ai-streaming">{streamView(partial)}</div>}
      {busy && partial == null && (
        <div className="ai-loading" aria-live="polite">
          {progress ? <p className="w-small w-muted ai-progress">{progress}</p> : <><span /><span /><span /></>}
        </div>
      )}
      {busy && (
        <button className="w-btn w-btn-small ai-stop" onClick={() => stopRef.current?.abort()} disabled={partial == null && !!progress}>
          <Icon name="close" size={14} /> Stop
        </button>
      )}
      {!busy && shown && (() => {
        const cards = shown.tool === "flashcards" ? cardsFromText(shown.text) : [];
        const quiz = shown.tool === "quiz" ? parseQuiz(shown.text) : [];
        const full = shown.footer ? `${shown.text}\n\n${shown.footer}` : shown.text;
        return (
          <div className="ai-result">
            {cards.length ? (
              <ul className="ai-cards" aria-label={`${cards.length} flashcards`}>
                {cards.map((c, k) => <li key={k}><b><CardText text={c.question} /></b><CardText text={c.answer} /></li>)}
              </ul>
            ) : (
              <div className="ai-result-text">
                {shown.tool === "vault" ? <CitedText text={shown.text} sources={shown.sources ?? []} onOpen={openSource} /> : shown.text}
              </div>
            )}
            {shown.tool === "vault" && <SourceList answer={shown.text} sources={shown.sources ?? []} onOpen={openSource} />}
            <div className="w-row">
              {quiz.length > 0 && <button className="w-btn w-btn-small" onClick={() => onPlayQuiz(quiz)}><Icon name="play" size={14} /> Play quiz</button>}
              {cards.length > 0 && <button className="w-btn w-btn-small" onClick={() => onStudy(cards)}><Icon name="play" size={14} /> Study now</button>}
              <button className="w-btn w-btn-small" onClick={() => void navigator.clipboard.writeText(full).then(() => toast("Copied."))}><Icon name="copy" size={14} /> Copy</button>
              <button className="w-btn w-btn-ghost w-btn-small" onClick={() => setShown(null)}>Close</button>
            </div>
          </div>
        );
      })()}

      <p className="w-small w-muted ai-where">{where}</p>
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

/** An answer about all notes, with each `[n]` as a link to the passage it cites. */
function CitedText({ text, sources, onOpen }: { text: string; sources: CitedSource[]; onOpen?: (path: string, line: number) => void }) {
  const parts = text.split(/(\[\d{1,2}\])/);
  return (
    <>
      {parts.map((part, i) => {
        const n = /^\[(\d{1,2})\]$/.exec(part)?.[1];
        const s = n ? sources.find((x) => x.n === Number(n)) : undefined;
        if (!s) return part;
        return (
          <button key={i} className="ai-cite" title={`${sourceTitle(s)}, line ${s.line + 1}`} onClick={() => onOpen?.(s.path, s.line)} disabled={!onOpen}>
            {s.n}
          </button>
        );
      })}
    </>
  );
}

/** The passages an answer cited, to open each where it is in its note. */
function SourceList({ answer, sources, onOpen }: { answer: string; sources: CitedSource[]; onOpen?: (path: string, line: number) => void }) {
  const used = citedNumbers(answer).map((n) => sources.find((s) => s.n === n)).filter((s): s is CitedSource => !!s);
  if (!used.length) return null;
  return (
    <div className="ai-sources">
      <span className="w-small w-muted">Sources</span>
      <ul>
        {used.map((s) => (
          <li key={s.n}>
            <button className="ai-source-open" onClick={() => onOpen?.(s.path, s.line)} disabled={!onOpen} title={s.text.slice(0, 300)}>
              <span className="ai-cite" aria-hidden="true">{s.n}</span>
              <span className="ai-source-title">{sourceTitle(s)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
