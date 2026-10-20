import { describe, expect, it } from "vitest";
import { keywords, pickRelevant, rankPages } from "./relevance";

const pages = [
  "Introduction to the course and how grades work.",
  "Mitochondria are the powerhouse of the cell. They make ATP through respiration.",
  "Photosynthesis happens in chloroplasts and makes glucose from light.",
  "Cell division: mitosis makes two identical cells. Mitosis has four phases.",
  "Index and glossary.",
];

describe("relevance", () => {
  it("drops filler words", () => {
    expect(keywords("What is the role of mitochondria in a cell?")).toEqual(["role", "mitochondria", "cell"]);
  });

  it("ranks the pages that use the question's words", () => {
    const s = rankPages("explain how mitosis happens", pages);
    expect(s[3]).toBeGreaterThan(0);
    expect(s[3]).toBeGreaterThan(s[1]!);
    expect(s[0]).toBe(0);
  });

  it("matches simple plurals", () => {
    expect(rankPages("cells", pages)[1]).toBeGreaterThan(0);
  });

  it("keeps to the budget and returns pages in order", () => {
    const got = pickRelevant("mitochondria and mitosis", pages, 200);
    expect(got).toEqual([1, 3]);
    expect(pickRelevant("mitosis", pages, 10_000)).toEqual([2, 3, 4]);
  });

  it("finds nothing for an unrelated question", () => {
    expect(pickRelevant("volcano eruption", pages, 10_000)).toEqual([]);
  });
});
