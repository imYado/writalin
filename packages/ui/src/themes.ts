/**
 * Themes are JSON maps from design tokens to CSS values. Every token becomes a
 * CSS custom property (`--w-bg`, `--w-text`…) on the root element, so the
 * website and the extension share one theme system. Any background token may
 * hold a gradient.
 */
export const THEME_TOKENS = {
  bg: "App background",
  surface: "Note page background",
  panel: "Side panels and workspaces",
  "panel-text": "Panel text",
  text: "Body text",
  "text-muted": "Secondary text",
  heading: "Headings",
  accent: "Accent (buttons, active items)",
  "accent-text": "Text on accent",
  link: "Links",
  "link-unresolved": "Links to notes that don't exist yet",
  tag: "Tags",
  highlight: "Highlighted text background",
  selection: "Selection background",
  border: "Borders and dividers",
  "code-bg": "Code background",
  "quote-border": "Quote bar",
  "callout-bg": "Callout background",
  "timer-bg": "Focus timer background",
  "timer-text": "Focus timer text",
  "bar-bg": "Bottom bar background",
  "bar-text": "Bottom bar text",
  "focus-dim": "Opacity of dimmed text in focus mode",
  danger: "Warnings",
  success: "Done / success",
} as const;

export type ThemeToken = keyof typeof THEME_TOKENS;

export interface Theme {
  id: string;
  name: string;
  /** Tells the editor which syntax colors and scrollbars to use. */
  base: "light" | "dark";
  tokens: Record<ThemeToken, string>;
}

const light: Theme = {
  id: "light",
  name: "Light",
  base: "light",
  tokens: {
    bg: "#f4f4f1",
    surface: "#ffffff",
    panel: "#fafaf8",
    "panel-text": "#2b2b2b",
    text: "#1f2328",
    "text-muted": "#5f6368",
    heading: "#111418",
    accent: "#3b5bdb",
    "accent-text": "#ffffff",
    link: "#2f4fc7",
    "link-unresolved": "#7a6ad8",
    tag: "#0b6e69",
    highlight: "#fff3a3",
    selection: "#cfdcff",
    border: "#e2e2dc",
    "code-bg": "#f2f2ee",
    "quote-border": "#c8c8c0",
    "callout-bg": "#eef2ff",
    "timer-bg": "#ffffff",
    "timer-text": "#1f2328",
    "bar-bg": "#ffffff",
    "bar-text": "#30343a",
    "focus-dim": "0.28",
    danger: "#b42318",
    success: "#1e7b34",
  },
};

const dark: Theme = {
  id: "dark",
  name: "Dark",
  base: "dark",
  tokens: {
    bg: "#16171a",
    surface: "#1e1f23",
    panel: "#1a1b1e",
    "panel-text": "#d9d9de",
    text: "#e3e3e8",
    "text-muted": "#a0a2ab",
    heading: "#f4f4f7",
    accent: "#8ea2ff",
    "accent-text": "#10131f",
    link: "#9fb1ff",
    "link-unresolved": "#c3a8ff",
    tag: "#6fd3c9",
    highlight: "#5b4d12",
    selection: "#34406b",
    border: "#2f3036",
    "code-bg": "#26272c",
    "quote-border": "#4a4b52",
    "callout-bg": "#252a3d",
    "timer-bg": "#26272c",
    "timer-text": "#e3e3e8",
    "bar-bg": "#232428",
    "bar-text": "#d9d9de",
    "focus-dim": "0.3",
    danger: "#ff8a80",
    success: "#7fd18b",
  },
};

const midnight: Theme = {
  id: "midnight",
  name: "Midnight",
  base: "dark",
  tokens: {
    bg: "#070b17",
    surface: "#0c1224",
    panel: "#0a0f1f",
    "panel-text": "#c9d2ea",
    text: "#d3dbf0",
    "text-muted": "#8e9abb",
    heading: "#eef2ff",
    accent: "#6d8dff",
    "accent-text": "#050814",
    link: "#8aa4ff",
    "link-unresolved": "#b79cff",
    tag: "#62c6d9",
    highlight: "#3a3510",
    selection: "#22305c",
    border: "#1b2440",
    "code-bg": "#111a33",
    "quote-border": "#2c3a66",
    "callout-bg": "#121c3a",
    "timer-bg": "#111a33",
    "timer-text": "#d3dbf0",
    "bar-bg": "#0f1730",
    "bar-text": "#c9d2ea",
    "focus-dim": "0.3",
    danger: "#ff8f87",
    success: "#79d28b",
  },
};

const warmPaper: Theme = {
  id: "warm-paper",
  name: "Warm Paper",
  base: "light",
  tokens: {
    bg: "#efe6d2",
    surface: "#fbf5e6",
    panel: "#f5ecd8",
    "panel-text": "#4a3a28",
    text: "#4a3626",
    "text-muted": "#7a6550",
    heading: "#3a2a1c",
    accent: "#9a5b2c",
    "accent-text": "#fffaf0",
    link: "#8a4b1f",
    "link-unresolved": "#7d5a8c",
    tag: "#4f6b3a",
    highlight: "#f3dc8f",
    selection: "#ead7b0",
    border: "#e1d3b6",
    "code-bg": "#f1e7d1",
    "quote-border": "#d2bf98",
    "callout-bg": "#f3e7c9",
    "timer-bg": "#fbf5e6",
    "timer-text": "#4a3626",
    "bar-bg": "#fbf5e6",
    "bar-text": "#4a3a28",
    "focus-dim": "0.3",
    danger: "#a3341f",
    success: "#4f7a2a",
  },
};

export const BUILT_IN_THEMES: readonly Theme[] = [light, dark, midnight, warmPaper];

export function findTheme(id: string, custom: readonly Theme[] = []): Theme {
  return [...BUILT_IN_THEMES, ...custom].find((t) => t.id === id) ?? light;
}

/** Write a theme's tokens as CSS custom properties. */
export function applyTheme(theme: Theme, el: HTMLElement = document.documentElement): void {
  for (const [k, v] of Object.entries(theme.tokens)) el.style.setProperty(`--w-${k}`, v);
  el.dataset.theme = theme.id;
  el.dataset.themeBase = theme.base;
  el.style.colorScheme = theme.base;
}

/** Parse a theme file, filling any missing token from the built-in theme of the same base. */
export function parseThemeFile(json: string, fallbackId?: string): Theme | null {
  try {
    const raw = JSON.parse(json) as Partial<Theme>;
    if (!raw || typeof raw !== "object" || !raw.tokens) return null;
    const base = raw.base === "dark" ? "dark" : "light";
    const fill = base === "dark" ? dark : light;
    return {
      id: String(raw.id ?? fallbackId ?? "custom"),
      name: String(raw.name ?? "Custom theme"),
      base,
      tokens: { ...fill.tokens, ...(raw.tokens as Record<string, string>) },
    };
  } catch {
    return null;
  }
}
