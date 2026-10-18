import { Facet } from "@codemirror/state";

/**
 * What the editor needs from the app around it. The website and the
 * extension each provide one, so the editor itself never touches storage.
 */
export interface EditorHost {
  /** Note names for `[[` completion. */
  noteNames(): string[];
  /** Tags for `#` completion. */
  tagNames(): string[];
  /** Whether a `[[target]]` resolves to an existing note or file. */
  linkExists(target: string): boolean;
  /** Open a link target (note, heading or attachment). `newPane` = ctrl/cmd held. */
  openLink(target: string, opts: { heading?: string; newPane?: boolean }): void;
  /** Open an external or relative URL, e.g. a PDF page link. */
  openUrl(url: string): void;
  /** Object URL for an embedded attachment, or null if missing. */
  resolveEmbed(target: string): Promise<string | null>;
  /** Slash-menu actions that need the app (insert drawing, PDF quote, start timer…). */
  action(name: HostAction): void;
}

export type HostAction = "start-timer" | "insert-pdf-quote" | "insert-drawing" | "insert-image" | "insert-citation";

export const editorHost = Facet.define<EditorHost, EditorHost | null>({
  combine: (values) => values[0] ?? null,
});
