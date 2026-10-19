import { useEffect, useRef, useState } from "react";
import { Icon, toast, type IconName } from "@writalin/ui";
import { cardsFromText, formatCards, type Vault } from "@writalin/vault";
import type { AiSourceText, WorkspaceAiSource } from "@writalin/workspaces";
import { aiApi, ApiError, type Account, type AiState, type AiTool } from "../api";

const TOOLS: { id: AiTool; label: string; desc: string; icon: IconName }[] = [
  { id: "explain", label: "Explain simply", desc: "Plain words and an example", icon: "bulb" },
  { id: "summarize", label: "Summarize", desc: "Main idea and key points", icon: "list" },
  { id: "mainpoint", label: "Main point", desc: "One or two sentences", icon: "focus" },
  { id: "steps", label: "Break into steps", desc: "Small tasks as a checklist", icon: "checkSquare" },
  { id: "flashcards", label: "Flashcards", desc: "Question :: Answer cards", icon: "copy" },
  { id: "quiz", label: "Quiz me", desc: "5 questions, answers hidden", icon: "sparkle" },
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
  /** False when no note is open to put the answer in. */
  canInsert: boolean;
  insert: (markdown: string) => void;
  onOpenSettings: () => void;
  /** Run a tool as soon as the panel can, e.g. picked from the right-click menu. */
  autoRun?: { tool: AiTool; nonce: number; source?: AiSource };
  /** Open the study view for these cards. */
  onStudy: (cards: { question: string; answer: string }[]) => void;
}

/** The AI dock panel. Opt-in, signed-in only; the key is used on the server, never here. */
export function AiPanel({ vault, account, getSource, workspace, canInsert, insert, onOpenSettings, autoRun, onStudy }: Props) {
  const [enabled, setEnabled] = useState(vault.settings.aiEnabled);
  const [state, setState] = useState<AiState | null>(null);
  const [busy, setBusy] = useState<AiTool | null>(null);
  const [result, setResult] = useState<{ tool: AiTool; text: string; footer?: string } | null>(null);
  /** Text handed over from elsewhere (a PDF), used instead of the note until cleared. */
  const [pinned, setPinned] = useState<AiSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  /** Read the note, or what's open in the side pane. An empty note starts on the side pane. */
  const [use, setUse] = useState<"note" | "workspace">(() => (workspace && !getSource("summarize")?.text.trim() ? "workspace" : "note"));
  const [scope, setScope] = useState(workspace?.defaultScope ?? "page");
  const [asked, setAsked] = useState("");

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
      const r = await aiApi.run(tool, text, tool === "ask" ? question : undefined);
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
          <button key={t.id} className="w-action" disabled={busy != null} onClick={() => void run(t.id)}>
            <Icon name={t.icon} size={16} />
            <span className="w-action-text">
              <span className="w-action-label">{t.label}</span>
              <span className="w-action-desc">{busy === t.id ? "Thinking…" : t.desc}</span>
            </span>
          </button>
        ))}
      </div>

      {busy && <div className="ai-loading" aria-live="polite"><span /><span /><span /></div>}
      {error && <p className="ai-error" role="alert">{error}</p>}
      {result && (() => {
        const cards = result.tool === "flashcards" ? cardsFromText(result.text) : [];
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
