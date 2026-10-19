import type { Vault } from "@writalin/vault";
import type { VaultPath } from "@writalin/shared";

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
}
