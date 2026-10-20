import { describe, expect, it } from "vitest";
import {
  splitFrontmatter,
  updateFrontmatter,
  parseWikiLinks,
  rewriteWikiLinks,
  parseInlineTags,
  parseTaskLine,
  toggleTaskLine,
  formatTaskLine,
  parseFlashcards,
  parseQuiz,
  nextSchedule,
  setCardSchedule,
  isDue,
  cardsFromText,
  formatCards,
  parseNote,
  pdfQuote,
  tagMatches,
} from "./index";

describe("frontmatter", () => {
  it("splits and normalizes Obsidian-style frontmatter", () => {
    const text = "---\ncreated: 2026-10-01T09:00\ntags: [history, '#essay']\nsources: https://a.b\n---\n# Hi\n";
    const r = splitFrontmatter(text);
    expect(r.frontmatter.tags).toEqual(["history", "essay"]);
    expect(r.frontmatter.sources).toEqual(["https://a.b"]);
    expect(r.body).toBe("# Hi\n");
  });

  it("accepts a comma separated tags string", () => {
    expect(splitFrontmatter("---\ntags: a, b c\n---\n").frontmatter.tags).toEqual(["a", "b", "c"]);
  });

  it("keeps unknown keys, comments and body when updating", () => {
    const text = "---\n# my comment\naliases: [x]\ncreated: 2026-10-01T09:00\n---\nBody [[link]]\n";
    const out = updateFrontmatter(text, { updated: "2026-10-18T10:00" });
    expect(out).toContain("# my comment");
    expect(out).toContain("aliases: [ x ]");
    expect(out).toContain("updated: 2026-10-18T10:00");
    expect(out.endsWith("Body [[link]]\n")).toBe(true);
    expect(splitFrontmatter(out).frontmatter.created).toBe("2026-10-01T09:00");
  });

  it("adds frontmatter to a note without it", () => {
    const out = updateFrontmatter("Hello\n", { tags: ["a"] });
    expect(out).toBe("---\ntags:\n  - a\n---\nHello\n");
  });

  it("round-trips a note with no changes byte for byte apart from the fence", () => {
    const text = "---\ntitle: X\n---\n> [!note] Callout\n> body\n\n- [ ] task 📅 2026-10-20\n";
    const out = updateFrontmatter(text, {});
    expect(out).toBe(text);
  });

  it("leaves invalid YAML untouched", () => {
    const text = "---\nfoo: [unclosed\n---\nbody";
    expect(updateFrontmatter(text, { a: 1 })).toBe(text);
  });
});

describe("wiki links", () => {
  it("parses targets, headings, aliases and embeds", () => {
    const links = parseWikiLinks("See [[Note A]], [[Note B#Part 2|part two]] and ![[attachments/d.svg]].");
    expect(links.map((l) => [l.target, l.heading, l.alias, l.embed])).toEqual([
      ["Note A", undefined, undefined, false],
      ["Note B", "Part 2", "part two", false],
      ["attachments/d.svg", undefined, undefined, true],
    ]);
  });

  it("ignores links in code", () => {
    expect(parseWikiLinks("`[[nope]]`\n```\n[[nope]]\n```\n[[yes]]").map((l) => l.target)).toEqual(["yes"]);
  });

  it("rewrites matching links and keeps heading and alias", () => {
    const out = rewriteWikiLinks("[[Old]] [[Old#H|a]] [[Other]]", (t) => t === "Old", "New");
    expect(out).toBe("[[New]] [[New#H|a]] [[Other]]");
  });
});

describe("tags", () => {
  it("finds inline tags but not headings, links or numbers", () => {
    const tags = parseInlineTags("# Heading\nText #history and #school/term-1, not #123 or a#b or [[N#h]]\n`#code`");
    expect(tags.map((t) => t.tag)).toEqual(["history", "school/term-1"]);
  });

  it("matches nested tags", () => {
    expect(tagMatches("School/Term", "school")).toBe(true);
    expect(tagMatches("schoolwork", "school")).toBe(false);
  });
});

describe("tasks", () => {
  it("parses Obsidian Tasks fields", () => {
    const t = parseTaskLine("  - [ ] Essay due 📅 2026-10-20 ⏰ 9:00 ⏫ #history [[Essay notes]]", "a.md", 3)!;
    expect(t).toMatchObject({
      status: "todo",
      due: "2026-10-20",
      time: "09:00",
      tags: ["history"],
      links: ["Essay notes"],
      line: 3,
      indent: "  ",
    });
    expect(t.text).toBe("Essay due #history [[Essay notes]]");
  });

  it("toggles with a done date and back", () => {
    const line = "- [ ] Read ch. 3 📅 2026-10-20";
    const done = toggleTaskLine(line, "2026-10-18");
    expect(done).toBe("- [x] Read ch. 3 📅 2026-10-20 ✅ 2026-10-18");
    expect(toggleTaskLine(done)).toBe(line);
  });

  it("formats new task lines", () => {
    expect(formatTaskLine({ text: "Revise", due: "2026-10-21", time: "18:30", tags: ["bio"], link: "Cells" })).toBe(
      "- [ ] Revise 📅 2026-10-21 ⏰ 18:30 #bio [[Cells]]",
    );
  });
});

describe("flashcards", () => {
  it("parses Q :: A lines but not tasks or dataview fields", () => {
    const cards = parseFlashcards("What is ATP :: Energy currency\n- [ ] a :: b\nkey:: value\n- Capital of France :: Paris", "f.md");
    expect(cards.map((c) => [c.question, c.answer])).toEqual([
      ["What is ATP", "Energy currency"],
      ["Capital of France", "Paris"],
    ]);
  });

  it("reads the Spaced Repetition plugin's other card forms", () => {
    const body = [
      "Capital of France::Paris",
      "Big cat ::: Lion <!--SR:!2026-11-01,3,250-->",
      "std::vector holds items",
      "",
      "What does the",
      "mitochondria do?",
      "?",
      "Makes energy",
      "for the cell <!--SR:!2026-11-02,4,250-->",
      "",
      "Up",
      "??",
      "Down",
    ].join("\n");
    expect(parseFlashcards(body, "f.md").map((c) => [c.line, c.question, c.answer])).toEqual([
      [0, "Capital of France", "Paris"],
      [1, "Big cat", "Lion"],
      [1, "Lion", "Big cat"],
      [4, "What does the\nmitochondria do?", "Makes energy\nfor the cell"],
      [10, "Up", "Down"],
      [10, "Down", "Up"],
    ]);
  });

  it("cleans up AI flashcards into note lines", () => {
    const ai = "Here are your cards:\n1. **What is ATP?** :: The cell's energy currency\n- Mitosis makes::two identical cells\n\nQ: Where is DNA kept?\nA: In the nucleus\n";
    const cards = cardsFromText(ai);
    expect(cards).toEqual([
      { question: "What is ATP?", answer: "The cell's energy currency" },
      { question: "Mitosis makes", answer: "two identical cells" },
      { question: "Where is DNA kept?", answer: "In the nucleus" },
    ]);
    const lines = formatCards(cards);
    expect(parseFlashcards(lines, "f.md")).toHaveLength(3);
    const divided = formatCards(cards, { divider: true });
    expect(divided.split("\n\n---\n\n")).toHaveLength(3);
    expect(parseFlashcards(divided, "f.md")).toHaveLength(3);
  });
});

describe("parseNote", () => {
  it("collects metadata with correct line numbers after frontmatter", () => {
    const text = "---\ntags: [bio]\n---\n# Cells\n- [ ] Learn mitosis #exam\n";
    const meta = parseNote("Bio/Cells.md", text, { mtime: 1, size: text.length });
    expect(meta.name).toBe("Cells");
    expect(meta.tags).toEqual(["bio", "exam"]);
    expect(meta.headings[0]).toMatchObject({ text: "Cells", line: 3 });
    expect(meta.tasks[0]!.line).toBe(4);
    expect(text.split("\n")[meta.tasks[0]!.line]).toBe(meta.tasks[0]!.raw);
  });
});

describe("blocks", () => {
  it("builds a PDF quote linking to the page", () => {
    expect(pdfQuote("Line one\nLine two", "attachments/lecture 3.pdf", 4)).toBe(
      "> Line one\n> Line two\n>\n> [source p.4](attachments/lecture%203.pdf#page=4)\n",
    );
  });
});

describe("parseQuiz", () => {
  it("reads multiple-choice and written questions with their answer key", () => {
    const md = [
      "### Quiz",
      "1. What makes ATP?",
      "    - A. Ribosomes",
      "    - B. Mitochondria",
      "    - C. Nucleus",
      "    - D. Golgi",
      "",
      "2. Why do cells divide?",
      "",
      "> [!success]- Answers",
      "> 1. B. Mitochondria run respiration.",
      "> 2. To grow and to repair tissue.",
    ].join("\n");
    expect(parseQuiz(md)).toEqual([
      { question: "What makes ATP?", options: ["Ribosomes", "Mitochondria", "Nucleus", "Golgi"], correct: 1, answer: "Mitochondria run respiration." },
      { question: "Why do cells divide?", options: [], correct: -1, answer: "To grow and to repair tissue." },
    ]);
  });

  it("accepts bold letters and a dash after the letter", () => {
    const md = "1. Q?\n   A) one\n   B) two\n\n> [!success]- Answers\n> 1. **A** – because";
    expect(parseQuiz(md)[0]).toMatchObject({ options: ["one", "two"], correct: 0, answer: "because" });
  });
});

describe("flashcard scheduling", () => {
  const day = new Date(2026, 9, 20);
  it("reads the plugin's review notes", () => {
    const [a, b] = parseFlashcards("Sun ::: Star <!--SR:!2026-10-22,3,250!2026-10-30,10,270-->", "f.md");
    expect(a!.schedule).toEqual({ due: "2026-10-22", interval: 3, ease: 250 });
    expect(b!.schedule).toEqual({ due: "2026-10-30", interval: 10, ease: 270 });
    expect(isDue(a!, "2026-10-21")).toBe(false);
    expect(isDue(parseFlashcards("x :: y", "f.md")[0]!)).toBe(true);
  });
  it("stretches the gap when known and shrinks it when missed", () => {
    expect(nextSchedule(undefined, true, day)).toEqual({ due: "2026-10-23", interval: 3, ease: 250 });
    expect(nextSchedule({ due: "2026-10-20", interval: 4, ease: 250 }, true, day).interval).toBe(10);
    expect(nextSchedule({ due: "2026-10-20", interval: 10, ease: 140 }, false, day)).toEqual({ due: "2026-10-21", interval: 1, ease: 130 });
  });
  it("writes the note at the end of a one-line card, keeping the other side", () => {
    const text = "# T\nA :: B\nSun ::: Star <!--SR:!2026-10-22,3,250!2026-10-30,10,270-->";
    const [, , rev] = parseFlashcards(text, "f.md");
    const s = { due: "2026-11-01", interval: 12, ease: 270 };
    expect(setCardSchedule(text, rev!, s)).toBe("# T\nA :: B\nSun ::: Star <!--SR:!2026-10-22,3,250!2026-11-01,12,270-->");
    const [first] = parseFlashcards(text, "f.md");
    expect(setCardSchedule(text, first!, s)!.split("\n")[1]).toBe("A :: B <!--SR:!2026-11-01,12,270-->");
  });
  it("puts a multi-line card's note on the line after its answer, then replaces it", () => {
    const text = "What does it do?\n?\nMakes energy\n\nnext";
    const [card] = parseFlashcards(text, "f.md");
    const once = setCardSchedule(text, card!, { due: "2026-10-23", interval: 3, ease: 250 })!;
    expect(once).toBe("What does it do?\n?\nMakes energy\n<!--SR:!2026-10-23,3,250-->\n\nnext");
    const [again] = parseFlashcards(once, "f.md");
    expect(again).toMatchObject({ answer: "Makes energy", schedule: { interval: 3 } });
    expect(setCardSchedule(once, again!, { due: "2026-11-01", interval: 8, ease: 250 })).toBe("What does it do?\n?\nMakes energy\n<!--SR:!2026-11-01,8,250-->\n\nnext");
  });
  it("finds a card that moved", () => {
    const [card] = parseFlashcards("A :: B", "f.md");
    expect(setCardSchedule("new line\nA :: B", card!, { due: "2026-10-23", interval: 3, ease: 250 })).toBe("new line\nA :: B <!--SR:!2026-10-23,3,250-->");
    expect(setCardSchedule("gone", card!, { due: "2026-10-23", interval: 3, ease: 250 })).toBeNull();
  });
});
