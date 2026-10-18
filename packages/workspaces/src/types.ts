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
  quality: "low" | "medium" | "high";
}
