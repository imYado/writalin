import { describe, expect, it } from "vitest";
import { ACTIVITY_PATH, contributionGrid, countWords, emptyActivity, mergeActivity, notesCreatedByDay, MemoryStore, Vault, type ActivityLog } from "./index";
import { isoDate } from "@writalin/shared";

describe("activity", () => {
  it("counts words, including CJK characters", () => {
    expect(countWords("Hello, world! It's 2026.")).toBe(4);
    expect(countWords("")).toBe(0);
    expect(countWords("日本語 test")).toBe(4);
  });

  it("records words written through the editor, not deletions", async () => {
    const vault = new Vault(new MemoryStore("T", { "A.md": "one two" }));
    await vault.open();
    await vault.writeBody("A.md", "one two three four");
    await vault.writeBody("A.md", "one");
    const today = vault.activity.days[isoDate()]!;
    expect(today.words).toBe(2);
    expect(today.edits).toBe(2);
    await vault.saveActivity();
    const saved = JSON.parse(await vault.store.readText(ACTIVITY_PATH)) as ActivityLog;
    expect(saved.days[isoDate()]!.words).toBe(2);
  });

  it("counts notes by their created date", async () => {
    const vault = new Vault(new MemoryStore("T", {
      "A.md": "---\ncreated: 2026-10-01T09:00\n---\nx",
      "B.md": "---\ncreated: 2026-10-01\n---\ny",
      "C.md": "no frontmatter",
    }));
    await vault.open();
    expect(notesCreatedByDay(vault.notes.values()).get("2026-10-01")).toBe(2);
  });

  it("builds a Monday-first grid with levels and streaks", () => {
    const log = emptyActivity();
    log.days["2026-10-16"] = { words: 10, edits: 1 };
    log.days["2026-10-17"] = { words: 500, edits: 3 };
    const created = new Map([["2026-10-18", 1]]);
    const today = new Date(2026, 9, 18); // Sunday
    const g = contributionGrid(log, created, { today, weekCount: 4 });
    expect(g.weeks).toHaveLength(4);
    expect(g.weeks[0]![0]!.date).toBe("2026-09-21");
    const last = g.weeks[3]!;
    expect(last[6]!.date).toBe("2026-10-18");
    expect(last[5]!.level).toBe(4);
    expect(last[4]!.level).toBeGreaterThan(0);
    expect(g.currentStreak).toBe(3);
    expect(g.longestStreak).toBe(3);
    expect(g.totalWords).toBe(510);
    expect(g.totalNotes).toBe(1);
  });

  it("merges two logs by taking the larger day", () => {
    const a = emptyActivity();
    a.days["2026-01-01"] = { words: 5, edits: 1 };
    const b = emptyActivity();
    b.days["2026-01-01"] = { words: 9, edits: 1 };
    b.days["2026-01-02"] = { words: 1, edits: 1 };
    expect(mergeActivity(a, b).days).toEqual({ "2026-01-01": { words: 9, edits: 1 }, "2026-01-02": { words: 1, edits: 1 } });
  });
});
