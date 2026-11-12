import { describe, expect, it } from "vitest";
import { completeLines, parseTutorLine } from "./tutorBoard";

describe("parseTutorLine", () => {
  it("reads what the tutor says", () => {
    expect(parseTutorLine("say: Let's look at this: step one.")).toEqual({ say: "Let's look at this: step one." });
    expect(parseTutorLine("Sure! Here is the idea.")).toEqual({ say: "Sure! Here is the idea." });
  });
  it("reads writing with size and colour", () => {
    expect(parseTutorLine("write: Plants make **sugar** from light.")).toEqual({ op: "write", text: "Plants make **sugar** from light.", size: undefined, color: undefined });
    expect(parseTutorLine("write l blue: Photosynthesis")).toEqual({ op: "write", text: "Photosynthesis", size: "l", color: "blue" });
    expect(parseTutorLine("- write: $a^2 + b^2 = c^2$: the rule")).toEqual({ op: "write", text: "$a^2 + b^2 = c^2$: the rule", size: undefined, color: undefined });
  });
  it("reads shapes", () => {
    expect(parseTutorLine("line 10 20 50 20 red")).toEqual({ op: "line", x1: 10, y1: 20, x2: 50, y2: 20, color: "red" });
    expect(parseTutorLine("arrow 10, 5, 30, 12")).toEqual({ op: "arrow", x1: 10, y1: 5, x2: 30, y2: 12, color: undefined });
    expect(parseTutorLine("rect 10 10 30 12.5 green")).toEqual({ op: "rect", x: 10, y: 10, w: 30, h: 12.5, color: "green" });
    expect(parseTutorLine("ellipse 50 15 20 10")).toEqual({ op: "ellipse", x: 30, y: 5, w: 40, h: 20, color: undefined });
    expect(parseTutorLine("circle 50 15 5 blue")).toEqual({ op: "ellipse", x: 45, y: 10, w: 10, h: 10, color: "blue" });
    expect(parseTutorLine("text 44 14 s purple: Leaf")).toEqual({ op: "text", x: 44, y: 14, text: "Leaf", size: "s", color: "purple" });
    expect(parseTutorLine("draw blue: 10,30 30,10 50,30")).toEqual({ op: "draw", points: [[10, 30], [30, 10], [50, 30]], color: "blue" });
    expect(parseTutorLine("highlight 8 12 60 3 yellow")).toEqual({ op: "highlight", x: 8, y: 12, w: 60, h: 3, color: "yellow" });
  });
  it("reads the figure and page commands", () => {
    expect(parseTutorLine("figure 32")).toEqual({ op: "figure", height: 32 });
    expect(parseTutorLine("end")).toEqual({ op: "end" });
    expect(parseTutorLine("page")).toEqual({ op: "page" });
    expect(parseTutorLine("erase page")).toEqual({ op: "erase" });
  });
  it("takes prose that starts with a command word as something said", () => {
    expect(parseTutorLine("Page 3 shows the Calvin cycle.")).toEqual({ say: "Page 3 shows the Calvin cycle." });
    expect(parseTutorLine("End of the proof: we are done.")).toEqual({ say: "End of the proof: we are done." });
    expect(parseTutorLine("Line up the decimals first.")).toEqual({ say: "Line up the decimals first." });
    expect(parseTutorLine("Write the equation yourself: what do you get?")).toEqual({ say: "Write the equation yourself: what do you get?" });
  });
  it("skips blank lines and code fences", () => {
    expect(parseTutorLine("")).toBeNull();
    expect(parseTutorLine("```")).toBeNull();
  });
});

describe("completeLines", () => {
  it("holds back the line still being written", () => {
    expect(completeLines("say: hi\nwrite: The mi")).toEqual(["say: hi"]);
    expect(completeLines("say: hi\nwrite: The mi", true)).toEqual(["say: hi", "write: The mi"]);
  });
});
