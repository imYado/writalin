import type { Vault } from "@writalin/vault";
import type { VaultPath } from "@writalin/shared";

/** Text handed to the AI, with what it is and a link back to where it came from. */
export interface AiSourceText {
  text: string;
  /** What the text is, for the "Using …" line. */
  label: string;
  /** Markdown added under the result when it goes into the note. */
  footer?: string;
  /** The PDF pages sent, when only some of them were. */
  pages?: number[];
}

/** What the open workspace (e.g. a PDF) offers the AI dock to read. */
export interface WorkspaceAiSource {
  /** Shown on the "Use" choice, e.g. the PDF's file name. */
  name: string;
  /** Parts it can send, e.g. this page, all pages, chosen pages. */
  scopes: { id: string; label: string; disabled?: boolean; hint?: string }[];
  defaultScope: string;
  /** A scope was picked in the dock, e.g. to start ticking pages. */
  onScope?: (scope: string) => void;
  /**
   * Collect the text for a scope; null when there is nothing to send (it says why itself).
   * With a question, a long scope sends only the parts that match it. `progress`
   * hears about slow steps, like reading scanned pages.
   */
  build: (scope: string, question?: string, progress?: (msg: string) => void) => Promise<AiSourceText | null>;
}

/** What every left-pane workspace gets from the app. */
export interface WorkspaceProps {
  vault: Vault;
  /** Bumps whenever the vault index changes, so views re-read it. */
  version: number;
  openNote: (path: VaultPath, opts?: { heading?: string; line?: number }) => void;
  /** Insert Markdown into the note on the right, at the cursor. */
  insertIntoNote: (markdown: string, opts?: { source?: string }) => void;
  /** Path of the note on the right, if any. */
  currentNote: VaultPath | null;
  /** Add Markdown to the end of the open note, through its editor. */
  appendToNote?: (markdown: string) => void;
  /** Save the open note now, before changing its file from outside the editor. */
  flushNote?: () => Promise<void>;
  quality: "low" | "medium" | "high";
  /** Run an AI study tool on text from this workspace; the answer shows in the AI dock. */
  askAi?: (tool: "summarize" | "flashcards" | "explain" | "quiz" | "mainpoint", source: AiSourceText) => void;
  /** Offer this workspace's text to the AI dock while it is open; null takes it back. */
  registerAiSource?: (source: WorkspaceAiSource | null) => void;
  /** Open the AI panel reading this workspace, starting on one of its scopes. */
  openAi?: (scope?: string) => void;
  /** Markdown (with `$math$`) as safe HTML, for text written on a PDF. */
  renderText?: (markdown: string) => Promise<string>;
}

/** Text sizes the AI can write on a board with. */
export type BoardTextSize = "s" | "m" | "l" | "xl";

/**
 * One step of the AI working on a PDF page, like a teacher at a board.
 * Positions are in page units: the page is 100 wide, `(0, 0)` is the top-left
 * corner. Inside a figure they are measured from the figure's top-left.
 */
export type BoardOp =
  /** A line of writing under what's already there; long text wraps. */
  | { op: "write"; text: string; size?: BoardTextSize; color?: string }
  /** Text at a place, e.g. a label in a figure. */
  | { op: "text"; x: number; y: number; text: string; size?: BoardTextSize; color?: string }
  | { op: "line" | "arrow"; x1: number; y1: number; x2: number; y2: number; color?: string }
  | { op: "rect" | "ellipse" | "highlight" | "cover"; x: number; y: number; w: number; h: number; color?: string }
  | { op: "draw"; points: [number, number][]; color?: string }
  /** Keep room for a drawing `height` units tall under the writing; shapes that follow are placed inside it. */
  | { op: "figure"; height: number }
  | { op: "end" }
  /** Carry on on a fresh page. */
  | { op: "page" }
  /** Wipe the page being worked on. */
  | { op: "erase" };

/** A PDF the AI can write and draw on, live. */
export interface PdfBoard {
  path: VaultPath;
  name: string;
  /** An empty PDF (pages can be added) rather than a printed one. */
  blank: boolean;
  /** Start a round of work: picks the page and where the writing carries on. */
  begin(): void;
  /** What's on the page being worked on, for the AI to read. */
  describe(): Promise<string>;
  /** Do one step, drawn or typed out live. Resolves, with the marks it added, once it's on the page. */
  apply(op: BoardOp): Promise<string[]>;
  /** Take marks back off (undo a round of work). */
  remove(ids: string[]): void;
  /** Finish whatever is being drawn at once. */
  hurry(): void;
}
