import type { Flashcard, NoteMeta } from "@writalin/shared";
import { dirname } from "@writalin/shared";

/** Which cards to study: those in notes with a tag, or in a folder and its subfolders. */
export interface CardScope {
  tag?: string;
  folder?: string;
}

/** Rough time per card: a known card is quick, a new one takes reading. */
const SECONDS_REVIEW = 8;
const SECONDS_NEW = 20;

/** Minutes a set of cards should take, at least 1. */
export function estimateMinutes(cards: Flashcard[]): number {
  if (!cards.length) return 0;
  const seconds = cards.reduce((s, c) => s + (c.schedule ? SECONDS_REVIEW : SECONDS_NEW), 0);
  return Math.max(1, Math.round(seconds / 60));
}

/** Below this ease (on the Spaced Repetition plugin's 130 to 350 scale) a card counts as hard: it's been missed. */
export const HARD_EASE = 230;

export interface WeakDeck {
  /** `#tag` or the folder's path. */
  label: string;
  scope: CardScope;
  /** The hardest cards in it, hardest first. */
  cards: Flashcard[];
}

/**
 * The tag (or, for untagged notes, folder) with the most hard cards, so
 * there's one clear thing to practise. Cards already due are left out, since
 * they're reviewed anyway. Needs at least two hard cards to suggest anything.
 */
export function weakestDeck(notes: Iterable<NoteMeta>, skip: Set<Flashcard> = new Set(), limit = 10): WeakDeck | null {
  const decks = new Map<string, { scope: CardScope; cards: Flashcard[] }>();
  const add = (label: string, scope: CardScope, card: Flashcard) => {
    let d = decks.get(label);
    if (!d) decks.set(label, (d = { scope, cards: [] }));
    d.cards.push(card);
  };
  for (const n of notes) {
    const hard = n.flashcards.filter((c) => c.schedule && c.schedule.ease < HARD_EASE && !skip.has(c));
    if (!hard.length) continue;
    const folder = dirname(n.path);
    for (const c of hard) {
      if (n.tags.length) for (const t of n.tags) add(`#${t}`, { tag: t }, c);
      else if (folder) add(folder, { folder }, c);
    }
  }
  let best: WeakDeck | null = null;
  let bestEase = Infinity;
  for (const [label, d] of decks) {
    if (d.cards.length < 2) continue;
    const ease = d.cards.reduce((s, c) => s + c.schedule!.ease, 0) / d.cards.length;
    if (!best || d.cards.length > best.cards.length || (d.cards.length === best.cards.length && ease < bestEase)) {
      best = { label, scope: d.scope, cards: d.cards };
      bestEase = ease;
    }
  }
  if (!best) return null;
  return { ...best, cards: [...best.cards].sort((a, b) => a.schedule!.ease - b.schedule!.ease).slice(0, limit) };
}
