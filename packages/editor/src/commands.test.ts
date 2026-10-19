import { describe, expect, it } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import { exitInlineMark, setColor, setHighlight } from "./commands";

/** A minimal stand-in for EditorView: enough for commands that only read state and dispatch. */
function fakeView(doc: string, anchor: number, head = anchor) {
  const v = {
    state: EditorState.create({ doc, selection: EditorSelection.single(anchor, head) }),
    dispatch(spec: unknown) {
      v.state = (spec as { state?: EditorState }).state ?? v.state.update(spec as never).state;
    },
    focus() {},
  };
  return v;
}

describe("exitInlineMark", () => {
  it("steps past ]] and other closing marks", () => {
    const v = fakeView("See [[Physics]] now", 13);
    expect(exitInlineMark(v as never)).toBe(true);
    expect(v.state.selection.main.head).toBe(15);
    const b = fakeView("a **bold** b", 8);
    expect(exitInlineMark(b as never)).toBe(true);
    expect(b.state.selection.main.head).toBe(10);
  });

  it("leaves a normal Enter alone", () => {
    expect(exitInlineMark(fakeView("plain text", 5) as never)).toBe(false);
    expect(exitInlineMark(fakeView("[[Done]] after", 14) as never)).toBe(false);
  });
});

describe("setColor", () => {
  it("wraps, recolours and removes", () => {
    const v = fakeView("hi there", 3, 8);
    setColor(v as never, "text", "#e03131");
    expect(v.state.doc.toString()).toBe('hi <span style="color:#e03131">there</span>');
    setColor(v as never, "text", "#1c7ed6");
    expect(v.state.doc.toString()).toBe('hi <span style="color:#1c7ed6">there</span>');
    setColor(v as never, "text", null);
    expect(v.state.doc.toString()).toBe("hi there");
    setColor(v as never, "highlight", "#fff3a3");
    expect(v.state.doc.toString()).toBe('hi <mark style="background:#fff3a3">there</mark>');
  });

  it("stacks a highlight on coloured text and swaps only the matching one", () => {
    const v = fakeView("hi there", 3, 8);
    setColor(v as never, "text", "#e03131");
    setColor(v as never, "highlight", "#fff3a3");
    expect(v.state.doc.toString()).toBe('hi <span style="color:#e03131"><mark style="background:#fff3a3">there</mark></span>');
    setColor(v as never, "text", "#1c7ed6");
    expect(v.state.doc.toString()).toBe('hi <span style="color:#1c7ed6"><mark style="background:#fff3a3">there</mark></span>');
    setColor(v as never, "highlight", null);
    expect(v.state.doc.toString()).toBe('hi <span style="color:#1c7ed6">there</span>');
  });

  it("ignores anything that isn't a hex colour", () => {
    const v = fakeView("hi", 0, 2);
    expect(setColor(v as never, "text", "red;position:fixed")).toBe(false);
    expect(v.state.doc.toString()).toBe("hi");
  });
});

describe("setHighlight", () => {
  it("writes Obsidian highlights with a colour emoji, swaps and removes them", () => {
    const v = fakeView("hi there", 3, 8);
    setHighlight(v as never, "");
    expect(v.state.doc.toString()).toBe("hi ==there==");
    setHighlight(v as never, "🟢");
    expect(v.state.doc.toString()).toBe("hi ==🟢 there==");
    setHighlight(v as never, "🔵");
    expect(v.state.doc.toString()).toBe("hi ==🔵 there==");
    expect(v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to)).toBe("there");
    setHighlight(v as never, null);
    expect(v.state.doc.toString()).toBe("hi there");
  });

  it("stacks with bold and text colour", () => {
    const v = fakeView("**word**", 2, 6);
    setColor(v as never, "text", "#e03131");
    setHighlight(v as never, "🟣");
    expect(v.state.doc.toString()).toBe('**<span style="color:#e03131">==🟣 word==</span>**');
  });
});
