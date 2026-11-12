import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { liveWrite, startLiveWrite } from "./liveWrite";

/** A minimal stand-in for EditorView: enough to read state and dispatch. */
function fakeView(doc: string, anchor: number) {
  const v = {
    state: EditorState.create({ doc, selection: EditorSelection.single(anchor), extensions: [history(), liveWrite] }),
    dispatch(spec: unknown) {
      v.state = (spec as { state?: EditorState }).state ?? v.state.update(spec as never).state;
    },
  };
  return v as unknown as EditorView & { state: EditorState };
}
const text = (v: EditorView) => v.state.doc.toString();

describe("live AI writing", () => {
  it("shows the answer as it grows, on its own lines", () => {
    const v = fakeView("One line.\nLast.", 3);
    const w = startLiveWrite(v)!;
    w.write("Hel");
    expect(text(v)).toBe("One line.\n\nHel\nLast.");
    w.write("Hello **there**");
    expect(text(v)).toBe("One line.\n\nHello **there**\nLast.");
    // A reply that restarts replaces what was shown.
    w.write("Hi");
    expect(text(v)).toBe("One line.\n\nHi\nLast.");
  });

  it("takes the unfinished text out again and leaves nothing to undo", () => {
    const v = fakeView("One line.\nLast.", 3);
    const w = startLiveWrite(v)!;
    w.write("Half an ans");
    w.end();
    expect(text(v)).toBe("One line.\nLast.");
    expect(v.state.selection.main.head).toBe(3);
    expect(undo(v)).toBe(false);
    // Nothing more is written once it's over.
    w.write("late");
    expect(text(v)).toBe("One line.\nLast.");
  });

  it("writes on an empty line without adding blank lines", () => {
    const v = fakeView("One.\n", 5);
    const w = startLiveWrite(v)!;
    w.write("Answer");
    expect(text(v)).toBe("One.\nAnswer");
    w.end();
    expect(text(v)).toBe("One.\n");
  });

  it("keeps what the person types beside it", () => {
    const v = fakeView("One.\nLast.", 2);
    const w = startLiveWrite(v)!;
    w.write("Answer");
    v.dispatch({ changes: { from: 0, insert: "My " } });
    w.write("Answer grows");
    expect(text(v)).toBe("My One.\n\nAnswer grows\nLast.");
    w.end();
    expect(text(v)).toBe("My One.\nLast.");
  });

  it("writes one answer at a time", () => {
    const v = fakeView("One.", 0);
    const w = startLiveWrite(v)!;
    expect(startLiveWrite(v)).toBeNull();
    w.end();
    expect(startLiveWrite(v)).not.toBeNull();
  });
});
