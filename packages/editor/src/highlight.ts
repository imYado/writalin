/**
 * Coloured highlights the Obsidian way: `==text==` is the normal (yellow)
 * highlight, and a colour emoji right after the opening marks picks another
 * colour, e.g. `==🟢 text==`. Obsidian shows the emoji as-is, so notes stay
 * readable there; here the emoji is hidden and the highlight takes its colour.
 */
export const HIGHLIGHT_COLORS = [
  { name: "Yellow", emoji: "", value: "#fff3a3" },
  { name: "Red", emoji: "🔴", value: "#ffc9c9" },
  { name: "Orange", emoji: "🟠", value: "#ffdcb8" },
  { name: "Green", emoji: "🟢", value: "#c3f0c8" },
  { name: "Blue", emoji: "🔵", value: "#c5e3ff" },
  { name: "Purple", emoji: "🟣", value: "#e5d4ff" },
] as const;

/** Circle and square emoji both work, so either habit from Obsidian carries over. */
const EMOJI_COLORS: Record<string, string> = {
  "🔴": "#ffc9c9", "🟥": "#ffc9c9",
  "🟠": "#ffdcb8", "🟧": "#ffdcb8",
  "🟡": "#fff3a3", "🟨": "#fff3a3",
  "🟢": "#c3f0c8", "🟩": "#c3f0c8",
  "🔵": "#c5e3ff", "🟦": "#c5e3ff",
  "🟣": "#e5d4ff", "🟪": "#e5d4ff",
  "🩷": "#ffd1e8",
  "⚪": "#e9ecef", "⬜": "#e9ecef",
};

/** `==text==`; a single `=` inside is fine (e.g. a colour tag's `style="…"`). */
export const HIGHLIGHT_RE = /==((?:[^=\n]|=(?!=))+)==/g;
const EMOJI_PREFIX_RE = new RegExp(`^(${Object.keys(EMOJI_COLORS).join("|")})\\uFE0F? ?`, "u");

/** The colour emoji at the start of a highlight's text, with the space after it. */
export function highlightEmoji(inner: string): { length: number; color: string } | null {
  const m = EMOJI_PREFIX_RE.exec(inner);
  return m ? { length: m[0].length, color: EMOJI_COLORS[m[1]!]! } : null;
}
