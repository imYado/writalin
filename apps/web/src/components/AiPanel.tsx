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

interface Turn {
  /** The question, for a question or a follow-up. */
  q?: string;
  a: string;
  /** Stop was pressed part-way through. */
  stopped?: boolean;
}

/** One answer and its follow-ups, with what was read so follow-ups read the same thing. */
interface Convo {
  id: string;
  tool: AiTool;
  turns: Turn[];
  text: string;
  label: string;
  footer?: string;
  /** Read from the side pane (this scope of this file): a follow-up question re-picks the pages that match it. */
  ws?: { name: string; scope: string };
  at: number;
}

/** Recent answers kept on this device, per vault, so closing the panel loses nothing. */
const RECENT_MAX = 5;
const readRecent = (vaultId: string): Convo[] => {
  try {
    const list = JSON.parse(readPref(`recent.${vaultId}`) ?? "[]") as Convo[];
    return Array.isArray(list) ? list.filter((c) => c && Array.isArray(c.turns) && c.turns.length) : [];
  } catch {
    return [];
  }
};
const writeRecent = (vaultId: string, list: Convo[]) => {
  const slim = list.slice(0, RECENT_MAX).map((c) => ({ ...c, turns: c.turns.slice(-8).map((t) => ({ ...t, a: t.a.slice(0, 20_000) })) }));
  try {
    writePref(`recent.${vaultId}`, slim.length ? JSON.stringify(slim) : "");
  } catch {
    /* full: just not remembered */
  }
};
/** The conversation on screen, kept while the panel is closed. */
const openConvo = new Map<string, string | null>();

const toolLabel = (c: Convo) => (c.tool === "ask" ? c.turns[0]?.q ?? "Question" : TOOLS.find((t) => t.id === c.tool)?.label ?? "Answer");
const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 60 * 24 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

export function AiPanel({ vault, account, getSource, workspace, focusWorkspace, canInsert, insert, onOpenSettings, autoRun, onStudy, onPlayQuiz }: Props) {
  const [enabled, setEnabled] = useState(vault.settings.aiEnabled);
  const [state, setState] = useState<AiState | null>(null);
  const [busy, setBusy] = useState<AiTool | null>(null);
  const vid = `${vault.store.kind}:${vault.store.name}`;
  const [recent, setRecent] = useState<Convo[]>(() => readRecent(vid));
  const [openId, setOpenId] = useState<string | null>(() => openConvo.get(vid) ?? null);
  const convo = recent.find((c) => c.id === openId) ?? null;
  useEffect(() => void openConvo.set(vid, openId), [vid, openId]);
  /** Save a new or longer conversation and show it. */
  const keep = (c: Convo) => {
    setRecent((list) => {
      const next = [c, ...list.filter((x) => x.id !== c.id)];
      writeRecent(vid, next);
      return next;
    });
    setOpenId(c.id);
  };
  const forget = (id: string) => {
    setRecent((list) => {
      const next = list.filter((x) => x.id !== id);
      writeRecent(vid, next);
      return next;
    });
    if (openId === id) setOpenId(null);
  };
  /** The answer so far, while it's still being written. */
  const [partial, setPartial] = useState<string | null>(null);
  const partialRef = useRef("");
  const stopRef = useRef<AbortController | null>(null);
  /** A slow step before the answer starts, e.g. reading scanned pages. */
  const [progress, setProgress] = useState<string | null>(null);
  const [followUp, setFollowUp] = useState("");
  /** Text handed over from elsewhere (a PDF), used instead of the note until cleared. */
  const [pinned, setPinned] = useState<AiSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  /** Read the note, or what's open in the side pane. An empty note starts on the side pane. */
  const [use, setUse] = useState<"note" | "workspace">(() => (workspace && !getSource("summarize")?.text.trim() ? "workspace" : "note"));
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
  /** Ask the AI, streaming the answer in. Returns the answer, or null when it failed or was stopped empty. */
  const ask = async (tool: AiTool, text: string, q: string | undefined, thread?: Turn[], next?: string) => {
    const stop = new AbortController();
    stopRef.current = stop;
    partialRef.current = "";
    // Each earlier answer, then the question that came after it; the last one is the new question.
    const pairs = thread?.map((t, i) => ({ answer: t.a, followUp: (i + 1 < thread.length ? thread[i + 1]!.q : next) ?? "" }));
    try {
      const r = await aiApi.run(tool, text, q, { quizKind, count: quizCount, extra: extra.trim() || undefined, thread: pairs?.slice(-8), signal: stop.signal }, (soFar) => {
        partialRef.current = soFar;
        setPartial(soFar);
      });
      void aiApi.state().then(setState).catch(() => {});
      return { a: r.text } as Turn;
    } catch (e) {
      if (stop.signal.aborted) return partialRef.current.trim() ? ({ a: partialRef.current.trim(), stopped: true } as Turn) : null;
      setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
      return null;
    } finally {
      stopRef.current = null;
    }
  };
  const run = async (tool: AiTool, from?: AiSource) => {
    setError(null);
    let src = from ?? pinned ?? null;
    const q = tool === "ask" ? question.trim() : undefined;
    const ws = !src && fromWorkspace ? { name: workspace!.name, scope } : undefined;
    if (ws) {
      setBusy(tool);
      src = await workspace!.build(scope, q, setProgress).catch(() => null);
      setProgress(null);
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
    setOpenId(null);
    try {
      const turn = await ask(tool, text, q);
      if (!turn) return;
      keep({ id: crypto.randomUUID(), tool, turns: [{ ...turn, q }], text, label: text ? src!.label : "", footer: text ? src?.footer : undefined, ws, at: Date.now() });
      if (tool === "ask") setQuestion("");
    } finally {
      setBusy(null);
      setPartial(null);
    }
  };
  /** Ask more about the answer on screen. */
  const runFollowUp = async (c: Convo) => {
    const q = followUp.trim();
    if (!q) return;
    setError(null);
    setBusy(c.tool);
    let { text, label, footer } = c;
    try {
      // A question about a long PDF re-picks the pages that match the new question.
      if (c.ws && c.tool === "ask" && workspace?.name === c.ws.name) {
        const src = await workspace.build(c.ws.scope, `${q} ${c.turns[0]?.q ?? ""}`, setProgress).catch(() => null);
        setProgress(null);
        if (src?.text.trim()) ({ text, label, footer } = src);
      }
      const turn = await ask(c.tool, text, c.turns[0]?.q, c.turns, q);
      if (!turn) return;
      keep({ ...c, text, label, footer, turns: [...c.turns, { ...turn, q }], at: Date.now() });
      setFollowUp("");
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

      {error && <p className="ai-error" role="alert">{error}</p>}
      {convo && (() => {
        const last = convo.turns[convo.turns.length - 1]!;
        const cards = convo.tool === "flashcards" ? cardsFromText(last.a) : [];
        const quiz = convo.tool === "quiz" ? parseQuiz(last.a) : [];
        const body = cards.length ? formatCards(cards, { divider: true }) : last.a;
        const markdown = convo.tool === "flashcards" && cards.length ? `### Flashcards\n${body}` : body;
        const full = convo.footer ? `${markdown}\n\n${convo.footer}` : markdown;
        return (
          <div className="ai-result">
            {convo.turns.map((t, i) => (
              <div key={i} className="ai-turn">
                {t.q && <p className="ai-asked w-small w-muted">{i ? "Then you asked" : "You asked"}: {t.q}</p>}
                {i === convo.turns.length - 1 && cards.length ? (
                  <ul className="ai-cards" aria-label={`${cards.length} flashcards`}>
                    {cards.map((c, k) => <li key={k}><b>{c.question}</b><span>{c.answer}</span></li>)}
                  </ul>
                ) : (
                  <div className={i < convo.turns.length - 1 ? "ai-result-text ai-earlier" : "ai-result-text"}>{t.a}</div>
                )}
                {t.stopped && <p className="w-small w-muted ai-stopped">Stopped before the end.</p>}
              </div>
            ))}
            {busy && partial != null && <div className="ai-streaming"><div className="ai-result-text">{partial}</div></div>}
            {!busy && (
              <div className="w-row">
                {canInsert && <button className="w-btn w-btn-primary w-btn-small" onClick={() => { insert(full); toast(cards.length ? `Added ${cards.length} flashcards to your note.` : "Added to your note."); setOpenId(null); }}>
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
                <button className="w-btn w-btn-ghost w-btn-small" onClick={() => setOpenId(null)} title="It stays in Recent answers">Close</button>
              </div>
            )}
            {!busy && (
              <form className="ai-ask ai-followup" onSubmit={(e) => { e.preventDefault(); void runFollowUp(convo); }}>
                <input
                  className="w-input"
                  placeholder={convo.tool === "flashcards" ? "e.g. make 5 harder ones" : convo.tool === "quiz" ? "e.g. why is question 2 right?" : "Ask a follow-up…"}
                  value={followUp}
                  onChange={(e) => setFollowUp(e.target.value)}
                  aria-label="Ask a follow-up question"
                />
                <button className="w-btn w-btn-small" disabled={!followUp.trim()}>Ask</button>
              </form>
            )}
            {convo.label && <span className="w-small w-muted">Read {convo.label}</span>}
          </div>
        );
      })()}
      {busy && !convo && partial != null && <div className="ai-result ai-streaming"><div className="ai-result-text">{partial}</div></div>}
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

      {recent.some((c) => c.id !== openId) && (
        <details className="ai-recent">
          <summary className="w-small w-muted">Recent answers</summary>
          <ul>
            {recent.filter((c) => c.id !== openId).map((c) => (
              <li key={c.id}>
                <button className="ai-recent-open" disabled={busy != null} onClick={() => { setError(null); setOpenId(c.id); }}>
                  <span className="ai-recent-title">{toolLabel(c)}</span>
                  <span className="w-small w-muted">{c.turns.length > 1 ? `${c.turns.length} answers · ` : ""}{ago(c.at)}</span>
                </button>
                <button className="w-icon-btn" aria-label="Remove" title="Remove" onClick={() => forget(c.id)}><Icon name="close" size={13} /></button>
              </li>
            ))}
          </ul>
        </details>
      )}

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
