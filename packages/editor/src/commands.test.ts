import { describe, expect, it } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import { exitInlineMark, makeCloze, setColor, setHighlight, toggleWrap } from "./commands";
import { editorCommands } from "./obsidian";

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

describe("makeCloze", () => {
  it("wraps the selection in the line's next numbered blank", () => {
    const v = fakeView("The {{c1::heart}} pumps blood", 24, 29);
    makeCloze(v as never);
    expect(v.state.doc.toString()).toBe("The {{c1::heart}} pumps {{c2::blood}}");
    const empty = fakeView("Born in ", 8);
    makeCloze(empty as never);
    expect(empty.state.doc.toString()).toBe("Born in {{c1::}}");
    expect(empty.state.selection.main.head).toBe(14);
  });
});

describe("toggleWrap (Obsidian-style)", () => {
  const run = (doc: string, from: number, to: number, marker: string) => {
    const v = fakeView(doc, from, to);
    toggleWrap(v as never, marker);
    const sel = v.state.selection.main;
    return { doc: v.state.doc.toString(), sel: v.state.sliceDoc(sel.from, sel.to) };
  };

  it("adds a style and keeps the text selected", () => {
    expect(run("hi there", 3, 8, "**")).toEqual({ doc: "hi **there**", sel: "there" });
    expect(run("hi there", 3, 8, "_")).toEqual({ doc: "hi *there*", sel: "there" });
  });

  it("keeps spaces at the edges outside the marks", () => {
    expect(run("hi there you", 2, 9, "**").doc).toBe("hi **there** you");
  });

  it("removes a style whether the marks are selected or not", () => {
    expect(run("hi **there**", 5, 10, "**")).toEqual({ doc: "hi there", sel: "there" });
    expect(run("hi **there**", 3, 12, "**")).toEqual({ doc: "hi there", sel: "there" });
    expect(run("hi ==there==", 3, 12, "==").doc).toBe("hi there");
    expect(run("hi ==🟢 there==", 8, 13, "==").doc).toBe("hi there");
    expect(run("hi *there*", 4, 9, "_").doc).toBe("hi there");
    expect(run("hi _there_", 4, 9, "_").doc).toBe("hi there");
  });

  it("removes the whole style with just the cursor inside", () => {
    expect(run("a **bold** b", 6, 6, "**").doc).toBe("a bold b");
  });

  it("styles the word at the cursor, or adds empty marks between words", () => {
    let v = fakeView("hi there", 5);
    toggleWrap(v as never, "**");
    expect(v.state.doc.toString()).toBe("hi **there**");
    expect(v.state.selection.main.head).toBe(7);
    v = fakeView("a  b", 2);
    toggleWrap(v as never, "**");
    expect(v.state.doc.toString()).toBe("a **** b");
    expect(v.state.selection.main.head).toBe(4);
  });

  it("removes the style from just the selected part", () => {
    expect(run("**one two three**", 6, 9, "**")).toEqual({ doc: "**one** two **three**", sel: "two" });
    expect(run("**one two**", 2, 5, "**").doc).toBe("one **two**");
  });

  it("merges with styled bits the selection touches", () => {
    expect(run("a **b** c", 0, 9, "**").doc).toBe("**a b c**");
    expect(run("plain **bold**", 0, 10, "**").doc).toBe("**plain bold**");
  });

  it("stacks styles and never cuts through another style's marks", () => {
    expect(run("**bold**", 2, 6, "==").doc).toBe("**==bold==**");
    expect(run("**bold** plain", 4, 14, "_").doc).toBe("***bold** plain*");
    expect(run("==**bold**==", 4, 8, "==").doc).toBe("**bold**");
  });
});

describe("setColor on text that's already coloured", () => {
  const doc = 'a <span style="color:#e03131">one two</span> b';
  const at = (t: string) => doc.indexOf(t);
  it("removes colour with the tags selected or from just a part", () => {
    let v = fakeView(doc, 2, at(" b"));
    setColor(v as never, "text", null);
    expect(v.state.doc.toString()).toBe("a one two b");
    v = fakeView(doc, at("two"), at("two") + 3);
    setColor(v as never, "text", null);
    expect(v.state.doc.toString()).toBe('a <span style="color:#e03131">one </span>two b');
  });
  it("recolours just the selected part", () => {
    const v = fakeView(doc, at("one"), at("one") + 3);
    setColor(v as never, "text", "#1c7ed6");
    expect(v.state.doc.toString()).toBe('a <span style="color:#1c7ed6">one</span><span style="color:#e03131"> two</span> b');
  });
});

describe("Obsidian commands", () => {
  const go = (doc: string, from: number, to: number, cmd: keyof typeof editorCommands) => {
    const v = fakeView(doc, from, to);
    editorCommands[cmd](v as never);
    return v;
  };
  it("adds a markdown link around the selection, or around a URL", () => {
    let v = go("see docs", 4, 8, "markdownLink");
    expect(v.state.doc.toString()).toBe("see [docs]()");
    expect(v.state.selection.main.head).toBe(11);
    v = go("https://a.b", 0, 11, "markdownLink");
    expect(v.state.doc.toString()).toBe("[](https://a.b)");
    expect(v.state.selection.main.head).toBe(1);
  });
  it("sets, swaps and removes headings", () => {
    let v = go("Title", 0, 0, "h2");
    expect(v.state.doc.toString()).toBe("## Title");
    editorCommands.h1(v as never);
    expect(v.state.doc.toString()).toBe("# Title");
    editorCommands.body(v as never);
    expect(v.state.doc.toString()).toBe("Title");
    v = go("### T", 0, 0, "heading");
    expect(v.state.doc.toString()).toBe("#### T");
  });
  it("ticks a checkbox, and makes a plain line a checklist item", () => {
    expect(go("- [ ] milk", 3, 3, "toggleCheckbox").state.doc.toString()).toBe("- [x] milk");
    expect(go("milk", 0, 0, "toggleCheckbox").state.doc.toString()).toBe("- [ ] milk");
  });
  it("clears all formatting in the selection", () => {
    const doc = 'a **b** ==c== *d* <span style="color:#e03131">e</span> f';
    expect(go(doc, 0, doc.length, "clearFormatting").state.doc.toString()).toBe("a b c d e f");
    expect(go("x **bold** y", 5, 5, "clearFormatting").state.doc.toString()).toBe("x bold y");
  });
});
