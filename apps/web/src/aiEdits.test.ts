import { describe, expect, it } from "vitest";
import { isEditAnswer, parseEdits, planEdits } from "./aiEdits";

const answer = `@@edit
Fixed two spelling mistakes and added a summary.
<<<FIND
Mitocondria make energy.
===REPLACE
Mitochondria make energy.
>>>END
<<<FIND
The nucleus  holds DNA
===REPLACE
The nucleus holds DNA
>>>END
<<<FIND
===REPLACE
## Summary
Cells have parts with jobs.
>>>END`;

describe("AI edits", () => {
  it("spots edit answers, also while streaming", () => {
    expect(isEditAnswer("@@ed")).toBe(false);
    expect(isEditAnswer("@@edit\nFix")).toBe(true);
    expect(isEditAnswer("```\n@@edit\n")).toBe(true);
    expect(isEditAnswer("Mitochondria are…")).toBe(false);
  });

  it("parses the summary and blocks", () => {
    const p = parseEdits(answer)!;
    expect(p.summary).toBe("Fixed two spelling mistakes and added a summary.");
    expect(p.edits).toHaveLength(3);
    expect(p.edits[0]).toEqual({ find: "Mitocondria make energy.", replace: "Mitochondria make energy." });
    expect(p.edits[2]!.find).toBe("");
  });

  it("copes with a missing END", () => {
    const p = parseEdits("@@edit\nShorter.\n<<<FIND\nA long line\n===REPLACE\nShort")!;
    expect(p.edits).toEqual([{ find: "A long line", replace: "Short" }]);
  });

  it("plans changes, matching loose spacing and appending at the end", () => {
    const doc = "# Cells\nMitocondria make energy.\nThe nucleus holds\nDNA in cells.\n";
    const { changes, missed } = planEdits(doc, parseEdits(answer)!.edits, { from: 0, to: doc.length });
    expect(missed).toBe(0);
    expect(changes[0]).toEqual({ from: 8, to: 32, insert: "Mitochondria make energy." });
    expect(doc.slice(changes[1]!.from, changes[1]!.to)).toBe("The nucleus holds\nDNA");
    expect(changes[2]).toEqual({ from: doc.length, to: doc.length, insert: "\n## Summary\nCells have parts with jobs." });
  });

  it("prefers the copy inside the selection and counts what it can't find", () => {
    const doc = "cat\n\ncat";
    const { changes, missed } = planEdits(doc, [{ find: "cat", replace: "dog" }, { find: "bird", replace: "x" }], { from: 5, to: 8 });
    expect(changes).toEqual([{ from: 5, to: 8, insert: "dog" }]);
    expect(missed).toBe(1);
  });
});
