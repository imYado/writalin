import { describe, expect, it } from "vitest";
import { latexToText, stripChatter, tidyAiMarkdown } from "./format.js";

describe("tidyAiMarkdown", () => {
  it("turns LaTeX into plain text the editor can show", () => {
    expect(tidyAiMarkdown("Area:\n\\[ A = \\pi r^2 \\]")).toBe("Area:\nA = π r²");
    expect(tidyAiMarkdown("Speed is \\( v = \\frac{d}{t} \\) here")).toBe("Speed is v = d/t here");
    expect(tidyAiMarkdown("$$E = mc^2$$")).toBe("E = mc²");
    expect(tidyAiMarkdown("so $x_1 + x_2 = 5$ works")).toBe("so x₁ + x₂ = 5 works");
  });

  it("leaves money and normal Markdown alone", () => {
    expect(tidyAiMarkdown("It costs $5 and $10.")).toBe("It costs $5 and $10.");
    expect(tidyAiMarkdown("**Main idea**\n- one\n- [ ] two")).toBe("**Main idea**\n- one\n- [ ] two");
  });

  it("flattens headings and footnotes the editor doesn't style", () => {
    expect(tidyAiMarkdown("#### Deep")).toBe("### Deep");
    expect(tidyAiMarkdown("Fact[^1]\n\n[^1]: Source")).toBe("Fact(1)\n\n(1) Source");
  });
});

describe("latexToText", () => {
  it("handles roots, fractions, Greek letters and scripts", () => {
    expect(latexToText("\\sqrt{b^2 - 4ac}")).toBe("√(b² - 4ac)");
    expect(latexToText("\\frac{a+b}{2}")).toBe("(a+b)/2");
    expect(latexToText("\\Delta x \\approx 0")).toBe("Δ x ≈ 0");
    expect(latexToText("H_2O")).toBe("H₂O");
  });
});

describe("stripChatter", () => {
  it("drops lead-ins and sign-offs around the content", () => {
    expect(stripChatter("Sure! Here is the summary:\n\n**Cells are alive.**\n- one")).toBe("**Cells are alive.**\n- one");
    expect(stripChatter("Here are your flashcards:\nA? :: B")).toBe("A? :: B");
    expect(stripChatter("- one\n- two\n\nLet me know if you want more!")).toBe("- one\n- two");
    expect(stripChatter("Okay.\n- one\n\nI hope this helps.")).toBe("- one");
  });
  it("keeps content that only looks similar", () => {
    expect(stripChatter("Here is where cells divide: in the nucleus.")).toBe("Here is where cells divide: in the nucleus.");
    expect(stripChatter("Great Britain is an island.\nIt has three countries.")).toBe("Great Britain is an island.\nIt has three countries.");
    expect(stripChatter("Okay")).toBe("Okay");
  });
});
