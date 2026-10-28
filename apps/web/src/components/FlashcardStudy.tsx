import { useEffect, useMemo, useState } from "react";
import type { CardRating, CardSchedule } from "@writalin/shared";
import { formatInterval, scheduleOptions } from "@writalin/vault";
import { Modal } from "@writalin/ui";

export interface StudyCard {
  question: string;
  answer: string;
  /** Cards saved in a note have a path; AI cards that aren't in a note don't. */
  path?: string;
  schedule?: CardSchedule;
}

const RATINGS: { rating: CardRating; label: string; className: string }[] = [
  { rating: 1, label: "Again", className: "study-again" },
  { rating: 2, label: "Hard", className: "" },
  { rating: 3, label: "Good", className: "w-btn-primary" },
  { rating: 4, label: "Easy", className: "" },
];
/** A missed card comes back after this many others (sooner if fewer are left). */
const RELEARN_GAP = 3;

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * Flip through cards one at a time. "Again" brings a card back a few cards
 * later; Hard, Good and Easy take it out, so a round ends once every card is
 * known. Each button shows when the card would be due next.
 * Keys: Space shows the answer, then Space again is Good; 1 to 4 pick a button.
 */
export function FlashcardStudy<C extends StudyCard>({
  cards,
  title,
  onClose,
  onReview,
}: {
  cards: C[];
  title: string;
  onClose: () => void;
  /** Called once per card per round, with how the first try went, so it can be scheduled. */
  onReview?: (card: C, rating: CardRating) => void;
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
  const known = cards.length - queue.length;
  // Only a card's first answer in a round is scheduled, so only then do the buttons show a date.
  const options = useMemo(() => (card?.path && !reviewed.has(card) ? scheduleOptions(card.schedule) : null), [card, reviewed.size]);
  const answer = (rating: CardRating) => {
    if (!card) return;
    if (!reviewed.has(card)) {
      reviewed.add(card);
      onReview?.(card, rating);
    }
    if (rating === 1) setMissed((m) => m + 1);
    setQueue((q) => {
      const rest = q.slice(1);
      if (rating !== 1) return rest;
      const at = Math.min(RELEARN_GAP, rest.length);
      return [...rest.slice(0, at), q[0]!, ...rest.slice(at)];
    });
    setFlipped(false);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (flipped) answer(3);
        else setFlipped(true);
      } else if (flipped && /^[1-4]$/.test(e.key)) answer(Number(e.key) as CardRating);
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
                <small>Question</small>
                <span>{card.question}</span>
              </span>
              <span className="study-side study-back">
                <small>Answer</small>
                <span>{card.answer}</span>
              </span>
            </button>
            {flipped ? (
              <div className="study-actions study-ratings">
                {RATINGS.map(({ rating, label, className }) => (
                  <button key={rating} className={`w-btn study-rate ${className}`} onClick={() => answer(rating)} aria-keyshortcuts={String(rating)}>
                    <span>{label} <kbd>{rating}</kbd></span>
                    <small>{rating === 1 ? "soon" : options ? formatInterval(options[rating - 1]!.interval) : "\u00a0"}</small>
                  </button>
                ))}
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
