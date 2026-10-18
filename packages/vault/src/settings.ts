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
