import { describe, expect, it } from "vitest";
import { BUILT_IN_THEMES, contrastRatio, contrastWarnings, parseThemeFile } from "./index";

describe("themes", () => {
  it("every built-in theme meets WCAG AA for its text pairs", () => {
    for (const t of BUILT_IN_THEMES) expect([t.id, contrastWarnings(t.tokens)]).toEqual([t.id, []]);
  });

  it("computes contrast, including the first stop of a gradient", () => {
    expect(contrastRatio("#000", "#fff")).toBeCloseTo(21, 0);
    expect(contrastRatio("#000", "linear-gradient(90deg, #ffffff, #000000)")).toBeCloseTo(21, 0);
  });

  it("fills missing tokens when parsing a theme file", () => {
    const t = parseThemeFile('{"name":"Mine","base":"dark","tokens":{"accent":"#f0f"}}', "mine")!;
    expect(t.id).toBe("mine");
    expect(t.tokens.accent).toBe("#f0f");
    expect(t.tokens.text).toBe(BUILT_IN_THEMES[1]!.tokens.text);
  });
});
