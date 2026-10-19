export interface VaultSettings {
  /** Focus timer length in minutes. */
  timerMinutes: number;
  breakMinutes: number;
  /** Built-in theme id or a custom theme file name in `.writalin/themes/`. */
  theme: string;
  font: "default" | "dyslexic" | "serif";
  lineHeight: number;
  /** Folder new notes go into ("" = vault root). */
  newNoteFolder: string;
  attachmentsFolder: string;
  showPrintLayout: boolean;
  aiEnabled: boolean;
}

export const DEFAULT_SETTINGS: VaultSettings = {
  timerMinutes: 30,
  breakMinutes: 5,
  theme: "light",
  font: "default",
  lineHeight: 1.7,
  newNoteFolder: "",
  attachmentsFolder: "attachments",
  showPrintLayout: false,
  aiEnabled: false,
};

export const SETTINGS_PATH = ".writalin/settings.json";
export const WORKSPACE_PATH = ".writalin/workspace.json";
export const THEMES_DIR = ".writalin/themes";
export const SCRATCHPAD_PATH = "Scratchpad.md";
/** Vault-wide tasks that don't belong to one note. */
export const TASKS_PATH = "Tasks.md";
/** Calendar reminders. Notes link to one with `[[Reminders#^id|text]]`. */
export const REMINDERS_PATH = "Reminders.md";
/** Scratch pads, one file each. */
export const SCRATCH_FOLDER = "Scratch";

export const isScratch = (path: string): boolean => path === SCRATCHPAD_PATH || path.startsWith(`${SCRATCH_FOLDER}/`);
/** Files Writalin manages itself: kept out of note lists, but still plain Markdown. */
export const isSystemNote = (path: string): boolean => path === TASKS_PATH || path === REMINDERS_PATH || isScratch(path);
