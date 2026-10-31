import { describe, expect, it } from "vitest";
import { MemoryStore, Vault, ConflictError, exportZip, importZip, splitFrontmatter } from "./index";

async function makeVault(files: Record<string, string>) {
  const store = new MemoryStore("Test", files);
  const vault = new Vault(store);
  await vault.open();
  return { store, vault };
}

describe("Vault", () => {
  it("indexes notes, links, backlinks and tags", async () => {
    const { vault } = await makeVault({
      "A.md": "Links to [[B]] #one",
      "folder/B.md": "---\ntags: [two]\n---\nBack to [[A]]",
      ".writalin/settings.json": '{"timerMinutes": 25}',
      "attachments/x.png": "png",
    });
    expect(vault.settings.timerMinutes).toBe(25);
    expect([...vault.notes.keys()].sort()).toEqual(["A.md", "folder/B.md"]);
    expect(vault.resolve("B", "A.md")).toBe("folder/B.md");
    expect(vault.backlinks("folder/B.md").map((b) => b.path)).toEqual(["A.md"]);
    expect([...vault.tagCounts().keys()].sort()).toEqual(["one", "two"]);
    expect(vault.search.search("back")[0]!.path).toBe("folder/B.md");
    const ctx = await vault.backlinksWithContext("A.md");
    expect(ctx[0]!.context).toBe("Back to [[A]]");
  });

  it("keeps reminders, vault tasks and scratches apart, links reminders both ways, and deletes tasks", async () => {
    const { vault } = await makeVault({
      "Reminders.md": "- [ ] Essay due 📅 2026-10-20 ^r-abc123\n- [ ] Quiz 📅 2026-10-22\n",
      "Tasks.md": "- [ ] Buy pens\n",
      "Scratch/Scratch 1.md": "idea",
      "Essay.md": "Plan for [[Reminders#^r-abc123|Essay due]]\n- [ ] Outline\n",
    });
    const [essay, quiz] = vault.reminders();
    expect(essay!.blockId).toBe("r-abc123");
    expect(essay!.text).toBe("Essay due");
    expect(vault.reminderBacklinks("r-abc123")).toEqual(["Essay.md"]);
    expect(vault.vaultTasks().map((t) => t.text)).toEqual(["Buy pens"]);
    expect(vault.recentNotes().map((n) => n.path)).toEqual(["Essay.md"]);
    expect(vault.scratches().map((n) => n.path)).toEqual(["Scratch/Scratch 1.md"]);

    const id = await vault.ensureBlockId(quiz!);
    expect((await vault.read("Reminders.md")).text).toContain(`Quiz 📅 2026-10-22 ^${id}`);
    await vault.deleteTask(vault.reminders()[0]!);
    expect(vault.reminders().map((t) => t.text)).toEqual(["Quiz"]);

    await vault.appendTo("Tasks.md", "- [ ] Return book");
    expect(vault.vaultTasks().map((t) => t.text)).toEqual(["Buy pens", "Return book"]);
    const scratch = await vault.createScratch();
    expect(scratch.startsWith("Scratch/Scratch ")).toBe(true);
  });

  it("prefers a note in the same folder when names clash", async () => {
    const { vault } = await makeVault({ "x/Note.md": "", "y/Note.md": "", "y/Here.md": "[[Note]]" });
    expect(vault.resolve("Note", "y/Here.md")).toBe("y/Note.md");
    expect(vault.resolve("x/Note", "y/Here.md")).toBe("x/Note.md");
  });

  it("rewrites links on rename", async () => {
    const { vault } = await makeVault({
      "Old.md": "self [[Old#Top]]",
      "Other.md": "see [[Old]] and [[Old|alias]] and ![[pic.png]]",
      "pic.png": "x",
      "Embed.md": "![](pic.png)",
    });
    const updated = await vault.rename("Old.md", "Sub/New name.md");
    expect(updated.sort()).toEqual(["Other.md", "Sub/New name.md"]);
    expect((await vault.read("Other.md")).text).toBe("see [[New name]] and [[New name|alias]] and ![[pic.png]]");
    expect((await vault.read("Sub/New name.md")).text).toBe("self [[New name#Top]]");
    expect(vault.resolve("New name", "Other.md")).toBe("Sub/New name.md");

    await vault.rename("pic.png", "attachments/pic.png");
    expect((await vault.read("Other.md")).text).toContain("![[attachments/pic.png]]");
    expect((await vault.read("Embed.md")).text).toBe("![](attachments/pic.png)");
  });

  it("detects external edits instead of overwriting them", async () => {
    const { store, vault } = await makeVault({ "N.md": "v1" });
    const { mtime } = await vault.read("N.md");
    store.externalWrite("N.md", "edited in Obsidian");
    await expect(vault.write("N.md", "v2", { expectedMtime: mtime })).rejects.toBeInstanceOf(ConflictError);
    expect((await vault.read("N.md")).text).toBe("edited in Obsidian");
  });

  it("does not flag its own saves as conflicts", async () => {
    const { vault } = await makeVault({ "N.md": "v1" });
    const { mtime } = await vault.read("N.md");
    await vault.write("N.md", "v2", { expectedMtime: mtime });
    await vault.write("N.md", "v3", { expectedMtime: mtime });
    expect((await vault.read("N.md")).text).toBe("v3");
  });

  it("refresh picks up external creates, edits and deletes", async () => {
    const { store, vault } = await makeVault({ "A.md": "a", "B.md": "b" });
    store.externalWrite("A.md", "#new");
    store.externalWrite("C.md", "c");
    await store.remove("B.md");
    const changed = await vault.refresh();
    expect(changed.sort()).toEqual(["A.md", "B.md", "C.md"]);
    expect(vault.notes.has("B.md")).toBe(false);
    expect(vault.notes.get("A.md")!.tags).toEqual(["new"]);
  });

  it("creates notes with frontmatter and unique names", async () => {
    const { vault } = await makeVault({ "Lecture.md": "" });
    const p = await vault.createNote("Lecture", { tags: ["bio"] });
    expect(p).toBe("Lecture 1.md");
    const fm = splitFrontmatter((await vault.read(p)).text).frontmatter;
    expect(fm.tags).toEqual(["bio"]);
    expect(fm.created).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it("toggles tasks in the source note", async () => {
    const { vault } = await makeVault({ "T.md": "---\na: 1\n---\n- [ ] one\n- [ ] two 📅 2026-10-20\n" });
    const task = vault.allTasks().find((t) => t.text === "two")!;
    await vault.toggleTask(task);
    const { text } = await vault.read("T.md");
    expect(text.split("\n")[4]).toMatch(/^- \[x\] two 📅 2026-10-20 ✅ \d{4}-\d{2}-\d{2}$/);
  });

  it("appends and records sources", async () => {
    const { vault } = await makeVault({ "R.md": "Intro" });
    await vault.append("R.md", "> quote");
    await vault.addSource("R.md", "https://example.com");
    await vault.addSource("R.md", "https://example.com");
    const { text } = await vault.read("R.md");
    const s = splitFrontmatter(text);
    expect(s.frontmatter.sources).toEqual(["https://example.com"]);
    expect(s.body).toBe("Intro\n\n> quote\n");
  });

  it("round-trips through zip export/import", async () => {
    const { store } = await makeVault({ "A.md": "# A", "attachments/d.svg": "<svg/>", ".writalin/settings.json": "{}" });
    const blob = await exportZip(store);
    const target = new MemoryStore("Copy");
    const written = await importZip(target, await blob.arrayBuffer());
    expect(written.sort()).toEqual([".writalin/settings.json", "A.md", "attachments/d.svg"]);
    expect(await target.readText("A.md")).toBe("# A");
  });
});

describe("flashcard reviews", () => {
  it("writes the next due date beside the card and counts new cards", async () => {
    const { vault } = await makeVault({ "Bio.md": "ATP :: Energy currency\n" });
    const card = vault.notes.get("Bio.md")!.flashcards[0]!;
    const schedule = await vault.reviewCard(card, 3);
    expect(schedule!.interval).toBe(4);
    expect((await vault.read("Bio.md")).text).toBe(`ATP :: Energy currency <!--SR:!${schedule!.due},4,248-->\n`);
    const today = vault.activity.days[Object.keys(vault.activity.days)[0]!]!;
    expect(today).toMatchObject({ cards: 1, newCards: 1 });
  });

  it("builds today's queue by deck, overdue first, within the daily limits", async () => {
    const { vault } = await makeVault({
      "bio/Cells.md": "#bio\nA :: 1\nB :: 2\nC :: 3 <!--SR:!2026-10-02,5,250-->\nD :: 4 <!--SR:!2026-09-01,5,250-->\nE :: 5 <!--SR:!2099-01-01,5,250-->",
      "History.md": "F :: 6",
    });
    const today = "2026-10-20";
    expect(vault.studyQueue({}, today).map((c) => c.question)).toEqual(["D", "C", "A", "B", "F"]);
    expect(vault.studyQueue({ tag: "bio" }, today)).toHaveLength(4);
    expect(vault.studyQueue({ folder: "bio" }, today)).toHaveLength(4);
    await vault.saveSettings({ newCardsPerDay: 1, reviewsPerDay: 1 });
    expect(vault.studyQueue({}, today).map((c) => c.question)).toEqual(["D", "A"]);
    vault.recordStudy({ cards: 2, newCards: 1 }, today);
    expect(vault.studyQueue({}, today)).toEqual([]);
    expect(vault.dueCards(today)).toHaveLength(5);
  });
});

describe("passages for questions about the whole vault", () => {
  it("finds the paragraphs that answer a question, with the file line and heading", async () => {
    const { vault } = await makeVault({
      "Biology/Cells.md": "---\ntags: [bio]\n---\n# Cells\n\nIntro to cells.\n\n## Mitochondria\n\nThe mitochondria make ATP through respiration.\n\n## Nucleus\n\nThe nucleus keeps the DNA.",
      "History.md": "The French revolution began in 1789.",
      "Energy.md": "Plants store energy as glucose.",
    });
    const hits = vault.search.passages("What do my notes say about how mitochondria make energy?");
    expect(hits[0]).toMatchObject({ path: "Biology/Cells.md", heading: "Mitochondria", line: 9, text: "The mitochondria make ATP through respiration." });
    // Not every word has to match: "energy" alone finds the other note.
    expect(hits.map((h) => h.path)).toContain("Energy.md");
    expect(hits.map((h) => h.path)).not.toContain("History.md");
    // Word starts match, and common words alone find nothing.
    expect(vault.search.passages("revolutions")).toEqual([]);
    expect(vault.search.passages("revolution")[0]!.path).toBe("History.md");
    expect(vault.search.passages("what is the")).toEqual([]);
  });
});

describe("study plan", () => {
  it("estimates the time and suggests the deck with the most hard cards, leaving out due ones", async () => {
    const hard = (q: string, ease: number) => `${q} :: x <!--SR:!2099-01-01,3,${ease}-->`;
    const { vault } = await makeVault({
      "Bio.md": ["#bio", hard("A", 150), hard("B", 210), hard("C", 300), "New :: card", "Due :: now <!--SR:!2026-10-01,3,140-->"].join("\n"),
      "Chem.md": ["#chem", hard("D", 140)].join("\n"),
      "maths/Algebra.md": [hard("E", 200), hard("F", 220), hard("G", 160)].join("\n"),
    });
    const plan = vault.studyPlan("2026-10-20");
    expect(plan.cards.map((c) => c.question)).toEqual(["Due", "New"]);
    expect(plan).toMatchObject({ fresh: 1, minutes: 1 });
    expect(plan.weak).toMatchObject({ label: "maths", scope: { folder: "maths" } });
    expect(plan.weak!.cards.map((c) => c.question)).toEqual(["G", "E", "F"]);
  });
});

describe("writeBody", () => {
  it("keeps frontmatter changed elsewhere in the app and bumps updated", async () => {
    const { vault } = await makeVault({ "N.md": "---\ncreated: 2026-01-01T00:00\n---\nold" });
    const { mtime } = await vault.read("N.md");
    await vault.addSource("N.md", "https://x.y");
    await vault.writeBody("N.md", "new body", { expectedMtime: mtime });
    const s = splitFrontmatter((await vault.read("N.md")).text);
    expect(s.body).toBe("new body");
    expect(s.frontmatter.sources).toEqual(["https://x.y"]);
    expect(s.frontmatter.created).toBe("2026-01-01T00:00");
    expect(s.frontmatter.updated).toMatch(/^\d{4}-/);
  });
});
