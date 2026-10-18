import { describe, expect, it } from "vitest";
import { computeBreaks } from "./printLayout";

describe("print layout breaks", () => {
  it("starts a new page when the next block doesn't fit", () => {
    const blocks = [0, 1, 2, 3].map((i) => ({ from: i * 10, height: 40, unbreakable: false }));
    expect(computeBreaks(blocks, 100)).toEqual([{ pos: 20, page: 2 }]);
  });

  it("moves an unbreakable image whole to the next page", () => {
    const blocks = [
      { from: 0, height: 70, unbreakable: false },
      { from: 10, height: 50, unbreakable: true },
      { from: 20, height: 20, unbreakable: false },
    ];
    expect(computeBreaks(blocks, 100)).toEqual([{ pos: 10, page: 2 }]);
  });

  it("counts pages a very long paragraph spills over", () => {
    const blocks = [
      { from: 0, height: 250, unbreakable: false },
      { from: 10, height: 80, unbreakable: false },
    ];
    expect(computeBreaks(blocks, 100)).toEqual([{ pos: 10, page: 4 }]);
  });
});
