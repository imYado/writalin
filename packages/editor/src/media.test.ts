import { describe, expect, it } from "vitest";
import { drawingToSvg, formatMediaLine, isDrawing, parseMediaLine, svgToDrawing } from "./media";

describe("media lines", () => {
  it("reads and writes Obsidian image widths", () => {
    expect(parseMediaLine("![[attachments/cat.png|320]]")).toEqual({ target: "attachments/cat.png", width: 320 });
    expect(parseMediaLine("![[cat.JPG]]")).toEqual({ target: "cat.JPG", width: undefined });
    expect(parseMediaLine("see ![[cat.png]]")).toBeNull();
    expect(parseMediaLine("![[Some note]]")).toBeNull();
    expect(formatMediaLine({ target: "a.png", width: 240.4 })).toBe("![[a.png|240]]");
    expect(formatMediaLine({ target: "a.png" })).toBe("![[a.png]]");
    expect(isDrawing("attachments/Drawing 2026-10-19 0804.svg")).toBe(true);
    expect(isDrawing("attachments/logo.svg")).toBe(false);
  });

  it("round-trips a drawing through SVG", () => {
    const d = { width: 800, height: 400, strokes: [{ color: "#d1242f", size: 4, opacity: 0.35, points: [[1, 2], [10.25, 20.5]] as [number, number][] }] };
    const back = svgToDrawing(drawingToSvg(d));
    expect(back.width).toBe(800);
    expect(back.height).toBe(400);
    expect(back.strokes).toEqual([{ color: "#d1242f", size: 4, opacity: 0.35, points: [[1, 2], [10.3, 20.5]] }]);
  });
});
