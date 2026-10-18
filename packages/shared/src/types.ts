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
}

export interface Flashcard {
  path: VaultPath;
  line: number;
  question: string;
  answer: string;
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
}
