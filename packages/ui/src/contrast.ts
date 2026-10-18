/** WCAG contrast helpers for the theme editor's readability warnings. */

export function parseColor(input: string): [number, number, number] | null {
  const s = input.trim();
  let m = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (m) {
    let h = m[1]!;
    if (h.length === 3 || h.length === 4) h = [...h.slice(0, 3)].map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  }
  m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(s);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}

/** For gradients, take the first color stop as a fair approximation of the background. */
export function firstColor(value: string): string {
  const m = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/i.exec(value);
  return m ? m[0] : value;
}

function channel(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(fg: string, bg: string): number | null {
  const a = parseColor(firstColor(fg));
  const b = parseColor(firstColor(bg));
  if (!a || !b) return null;
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Text/background pairs that must stay readable (WCAG AA = 4.5:1 for body text). */
export const CONTRAST_PAIRS: [fg: string, bg: string, label: string][] = [
  ["text", "surface", "Body text on the page"],
  ["heading", "surface", "Headings on the page"],
  ["text-muted", "surface", "Secondary text on the page"],
  ["link", "surface", "Links on the page"],
  ["tag", "surface", "Tags on the page"],
  ["panel-text", "panel", "Panel text"],
  ["bar-text", "bar-bg", "Bottom bar"],
  ["timer-text", "timer-bg", "Focus timer"],
  ["accent-text", "accent", "Text on buttons"],
  ["text", "code-bg", "Code"],
];

export function contrastWarnings(tokens: Record<string, string>, min = 4.5): { label: string; ratio: number }[] {
  const out: { label: string; ratio: number }[] = [];
  for (const [fg, bg, label] of CONTRAST_PAIRS) {
    const r = contrastRatio(tokens[fg] ?? "", tokens[bg] ?? "");
    if (r != null && r < min) out.push({ label, ratio: Math.round(r * 100) / 100 });
  }
  return out;
}
