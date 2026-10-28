/** A path inside a vault, always using "/" and never starting with "/". */
export type VaultPath = string;

export interface Frontmatter {
  created?: string;
  updated?: string;
  tags?: string[];
  sources?: string[];
  [key: string]: unknown;
}

export interface WikiLink {
  /** Target note name or path as written, without the heading part. */
  target: string;
  heading?: string;
  alias?: string;
  /** True for `![[...]]` embeds. */
  embed: boolean;
  /** Character offsets of the whole `[[...]]` in the source text. */
  from: number;
  to: number;
}

export interface HeadingInfo {
  level: number;
  text: string;
  /** Character offset of the heading line start. */
  from: number;
  line: number;
}

export type TaskStatus = "todo" | "done";

export interface Task {
  path: VaultPath;
  /** 0-based line number in the note. */
  line: number;
  status: TaskStatus;
  /** Text with Tasks-plugin emoji fields removed. */
  text: string;
  /** The full original line. */
  raw: string;
  due?: string;
  scheduled?: string;
  start?: string;
  doneDate?: string;
  /** HH:MM from the ⏰ field. */
  time?: string;
  tags: string[];
  links: string[];
  indent: string;
  /** Obsidian block id (`^abc` at the end of the line), used to link to a reminder. */
  blockId?: string;
}

/** When a card is next due, in the Spaced Repetition plugin's terms. */
export interface CardSchedule {
  /** YYYY-MM-DD. */
  due: string;
  /** Days between reviews; also the card's FSRS stability. */
  interval: number;
  /** 130 (hardest) to 350 (easiest), the card's FSRS difficulty on the Spaced Repetition plugin's ease scale. */
  ease: number;
}

/** How a review went: Again, Hard, Good or Easy. */
export type CardRating = 1 | 2 | 3 | 4;

export interface Flashcard {
  path: VaultPath;
  line: number;
  question: string;
  answer: string;
  /** 0 for the card as written, 1 for the reversed side of a `:::` or `??` card. */
  side?: 0 | 1;
  /** Undefined for a card that has never been reviewed. */
  schedule?: CardSchedule;
}

export interface NoteMeta {
  path: VaultPath;
  /** File name without extension. */
  name: string;
  frontmatter: Frontmatter;
  tags: string[];
  links: WikiLink[];
  headings: HeadingInfo[];
  tasks: Task[];
  flashcards: Flashcard[];
  mtime: number;
  size: number;
  /** Words in the body. Missing on index entries cached by older versions. */
  words?: number;
}
