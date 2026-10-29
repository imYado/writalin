import { useEffect, useMemo, useState } from "react";
import { Modal } from "@writalin/ui";
import { CardText } from "./CardText";

export interface StudyCard {
  question: string;
  answer: string;
  /** A fill-in-the-blank card. */
  cloze?: boolean;
  /** The note line an AI-made cloze card comes from. */
  source?: string;
}

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * Flip through cards one at a time. "Again" puts a card back at the end of the
 * pile, "Got it" takes it out, so a round ends once every card is known.
 * Keys: Space shows the answer, then Space again is Got it and the next card;
 * 1 is Again, 2 is Got it.
 */
export function FlashcardStudy<C extends StudyCard>({
  cards,
  title,
  onClose,
  onReview,
  resolveImage,
}: {
  cards: C[];
  title: string;
  onClose: () => void;
  /** Called once per card per round, with how the first try went, so it can be scheduled. */
  onReview?: (card: C, gotIt: boolean) => void;
  /** Shows images embedded in a card, found from the note the card is in. */
  resolveImage?: (target: string, fromPath: string | undefined) => Promise<string | null>;
}) {
  const [round, setRound] = useState(0);
  const initial = useMemo(() => shuffle(cards), [cards, round]);
  const [queue, setQueue] = useState(initial);
  const [flipped, setFlipped] = useState(false);
  const [missed, setMissed] = useState(0);
  const [reviewed] = useState(() => new Set<C>());
  useEffect(() => {
    setQueue(initial);
    setFlipped(false);
    setMissed(0);
    reviewed.clear();
  }, [initial]);

  const card = queue[0];
  const from = card && "path" in card ? String(card.path) : undefined;
  const resolve = useMemo(() => (resolveImage ? (t: string) => resolveImage(t, from) : undefined), [resolveImage, from]);
  const known = cards.length - queue.length;
  const answer = (gotIt: boolean) => {
    if (!card) return;
    if (!reviewed.has(card)) {
      reviewed.add(card);
      onReview?.(card, gotIt);
    }
    if (!gotIt) setMissed((m) => m + 1);
    setQueue((q) => (gotIt ? q.slice(1) : [...q.slice(1), q[0]!]));
    setFlipped(false);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (flipped) answer(true);
        else setFlipped(true);
      } else if (flipped && e.key === "1") answer(false);
      else if (flipped && e.key === "2") answer(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  return (
    <Modal title={title} onClose={onClose} width={560}>
      <div className="study">
        <div className="study-progress" aria-label={`${known} of ${cards.length} known`}>
          <span style={{ width: `${(known / Math.max(1, cards.length)) * 100}%` }} />
        </div>
        {card ? (
          <>
            <button className={`study-card${flipped ? " flipped" : ""}`} onClick={() => setFlipped((f) => !f)} aria-live="polite">
              <span className="study-side study-front">
                <small>{card.cloze ? "Fill in the blank" : "Question"}</small>
                <CardText text={card.question} resolveImage={resolve} />
              </span>
              <span className="study-side study-back">
                <small>Answer</small>
                <CardText text={card.answer} resolveImage={resolve} />
              </span>
            </button>
            {flipped ? (
              <div className="study-actions">
                <button className="w-btn study-again" onClick={() => answer(false)}>Again <kbd>1</kbd></button>
                <button className="w-btn w-btn-primary" onClick={() => answer(true)}>Got it <kbd>Space</kbd></button>
              </div>
            ) : (
              <div className="study-actions">
                <button className="w-btn w-btn-primary" onClick={() => setFlipped(true)}>Show answer <kbd>Space</kbd></button>
              </div>
            )}
            <p className="w-muted w-small study-count">{queue.length} left · {known} known</p>
          </>
        ) : (
          <div className="study-done">
            <h3>All {cards.length} cards done</h3>
            <p className="w-muted">{missed === 0 ? "You knew every one the first time." : `${missed} retr${missed === 1 ? "y" : "ies"} along the way.`}</p>
            <div className="study-actions">
              <button className="w-btn" onClick={() => setRound((r) => r + 1)}>Study again</button>
              <button className="w-btn w-btn-primary" onClick={onClose}>Done</button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
