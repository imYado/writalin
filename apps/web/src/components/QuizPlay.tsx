import { useEffect, useState } from "react";
import { Modal } from "@writalin/ui";
import type { QuizQuestion } from "@writalin/vault";

/**
 * Play a quiz one question at a time. Multiple choice: pick an option and see
 * at once whether it's right. Written: type an answer, then compare it with
 * the model answer and say whether you got it. Keys: 1–6 pick, Enter goes on.
 */
export function QuizPlay({ questions, title, onClose }: { questions: QuizQuestion[]; title: string; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [typed, setTyped] = useState("");
  const [checked, setChecked] = useState(false);
  /** Right or wrong per question; written ones are marked by you. */
  const [marks, setMarks] = useState<(boolean | null)[]>(() => questions.map(() => null));

  const q = questions[i];
  const choice = !!q && q.options.length > 0;
  const done = i >= questions.length;
  const score = marks.filter(Boolean).length;

  const mark = (right: boolean) => setMarks((m) => m.map((x, k) => (k === i ? right : x)));
  const pick = (k: number) => {
    if (!q || picked != null) return;
    setPicked(k);
    // Without a key there's no telling; show the options and let you go on.
    if (q.correct >= 0) mark(k === q.correct);
  };
  const next = () => {
    setI((n) => n + 1);
    setPicked(null);
    setTyped("");
    setChecked(false);
  };
  const restart = () => {
    setI(0);
    setPicked(null);
    setTyped("");
    setChecked(false);
    setMarks(questions.map(() => null));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement) return;
      if (choice && picked == null && /^[1-6]$/.test(e.key) && Number(e.key) <= q!.options.length) pick(Number(e.key) - 1);
      else if (e.key === "Enter" && choice && picked != null) {
        e.preventDefault();
        next();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  return (
    <Modal title={title} onClose={onClose} width={600}>
      <div className="study quiz">
        <div className="study-progress" aria-label={`Question ${Math.min(i + 1, questions.length)} of ${questions.length}`}>
          <span style={{ width: `${(Math.min(i, questions.length) / Math.max(1, questions.length)) * 100}%` }} />
        </div>
        {done ? (
          <div className="study-done">
            <h3>
              {score} of {questions.length} right
            </h3>
            <p className="w-muted">{score === questions.length ? "Every one. Nice." : "Go through it again to lock in the ones you missed."}</p>
            <div className="study-actions">
              <button className="w-btn" onClick={restart}>Try again</button>
              <button className="w-btn w-btn-primary" onClick={onClose}>Done</button>
            </div>
          </div>
        ) : (
          <>
            <p className="w-muted w-small quiz-count">
              Question {i + 1} of {questions.length} · {choice ? "Multiple choice" : "Write your answer"}
            </p>
            <h3 className="quiz-question">{q!.question}</h3>
            {choice ? (
              <div className="quiz-options" role="list">
                {q!.options.map((o, k) => {
                  const state = picked == null ? "" : k === q!.correct ? " right" : k === picked ? " wrong" : " dim";
                  return (
                    <button key={k} role="listitem" className={`quiz-option${state}`} disabled={picked != null} onClick={() => pick(k)}>
                      <span className="quiz-letter">{String.fromCharCode(65 + k)}</span>
                      <span>{o}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <textarea
                className="w-input quiz-written"
                rows={3}
                autoFocus={matchMedia("(pointer: fine)").matches}
                placeholder="Type your answer…"
                value={typed}
                disabled={checked}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) setChecked(true);
                }}
              />
            )}
            {(picked != null || checked) && (
              <div className={`quiz-feedback${choice && q!.correct >= 0 ? (picked === q!.correct ? " right" : " wrong") : ""}`} aria-live="polite">
                {choice && q!.correct >= 0 && <strong>{picked === q!.correct ? "Right." : `Not quite: it's ${String.fromCharCode(65 + q!.correct)}.`}</strong>}
                {!choice && <small>Model answer</small>}
                {q!.answer && <span>{q!.answer}</span>}
                {!q!.answer && !choice && <span className="w-muted">This quiz has no answer written for this one.</span>}
              </div>
            )}
            <div className="study-actions">
              {choice ? (
                <button className="w-btn w-btn-primary" disabled={picked == null} onClick={next}>
                  {i + 1 < questions.length ? "Next" : "See score"} <kbd>Enter</kbd>
                </button>
              ) : !checked ? (
                <button className="w-btn w-btn-primary" onClick={() => setChecked(true)}>Check answer</button>
              ) : (
                <>
                  <button className="w-btn study-again" onClick={() => { mark(false); next(); }}>Not quite</button>
                  <button className="w-btn w-btn-primary" onClick={() => { mark(true); next(); }}>I got it</button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
