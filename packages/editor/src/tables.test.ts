import { describe, expect, it } from "vitest";
import { parseTable, serializeTable, splitRow } from "./tables";

describe("tables", () => {
  it("splits rows, keeping escaped pipes and pipes in code", () => {
    expect(splitRow("| a | b \\| c | `x|y` |")).toEqual(["a", "b | c", "`x|y`"]);
    expect(splitRow("a | b")).toEqual(["a", "b"]);
  });

  it("parses header, alignment and rows, filling short rows", () => {
    const t = parseTable("| Name | Age | City |\n| :--- | ---: | :-: |\n| Ada | 36 |\n| Alan | 41 | London |")!;
    expect(t.header).toEqual(["Name", "Age", "City"]);
    expect(t.align).toEqual(["left", "right", "center"]);
    expect(t.rows).toEqual([["Ada", "36", ""], ["Alan", "41", "London"]]);
  });

  it("rejects text without a delimiter row", () => {
    expect(parseTable("| a | b |\n| c | d |")).toBeNull();
  });

  it("writes neat Markdown that parses back the same", () => {
    const md = serializeTable({ header: ["Term", "Meaning"], align: [null, "right"], rows: [["Force", "a | push"], ["", "pull"]] });
    expect(md).toBe("| Term  |   Meaning |\n| ----- | --------: |\n| Force | a \\| push |\n|       |      pull |");
    expect(parseTable(md)).toEqual({ header: ["Term", "Meaning"], align: [null, "right"], rows: [["Force", "a | push"], ["", "pull"]] });
  });
});
