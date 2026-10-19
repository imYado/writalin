import { autocompletion, startCompletion, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import { editorHost, type HostAction } from "./host";

interface SlashItem {
  label: string;
  detail?: string;
  keywords?: string;
  /** Markdown to insert; `|` marks where the cursor goes. */
  insert?: string;
  /** Block items replace the whole line when it's otherwise empty. */
  block?: boolean;
  action?: HostAction;
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const SLASH_ITEMS: SlashItem[] = [
  { label: "Heading 1", detail: "Big section title", insert: "# |", block: true, keywords: "title h1" },
  { label: "Heading 2", detail: "Medium section title", insert: "## |", block: true, keywords: "h2 section" },
  { label: "Heading 3", detail: "Small section title", insert: "### |", block: true, keywords: "h3" },
  { label: "Checklist", detail: "A box you can tick off", insert: "- [ ] |", block: true, keywords: "todo task checkbox" },
  { label: "Task with due date", detail: "Shows up in Tasks and Calendar", insert: `- [ ] | 📅 ${today()}`, block: true, keywords: "reminder deadline due" },
  { label: "Bullet list", detail: "Simple list with dots", insert: "- |", block: true, keywords: "ul unordered" },
  { label: "Numbered list", detail: "Steps in order", insert: "1. |", block: true, keywords: "ol ordered" },
  { label: "Quote", detail: "Indented quotation", insert: "> |", block: true, keywords: "blockquote" },
  { label: "Callout: note", detail: "Box for side information", insert: "> [!note] |\n> ", block: true, keywords: "info box" },
  { label: "Callout: tip", detail: "Box for a helpful hint", insert: "> [!tip] |\n> ", block: true, keywords: "hint box" },
  { label: "Callout: warning", detail: "Box for something to watch out for", insert: "> [!warning] |\n> ", block: true, keywords: "caution box" },
  { label: "Callout: question", detail: "Box for an open question", insert: "> [!question] |\n> ", block: true, keywords: "ask box" },
  { label: "Table", detail: "Rows and columns", insert: "| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n| | | |", block: true, keywords: "grid" },
  { label: "Code block", detail: "Monospaced code", insert: "```\n|\n```", block: true, keywords: "pre snippet" },
  { label: "Divider", detail: "Horizontal line", insert: "---\n|", block: true, keywords: "hr rule line" },
  { label: "Flashcard", detail: "Question :: Answer for studying", insert: "| :: Answer", block: true, keywords: "card question answer study spaced repetition" },
  { label: "Link to note", detail: "Connect to another note", insert: "[[|]]", keywords: "wiki page" },
  { label: "Highlight", detail: "Mark important text", insert: "==|==", keywords: "marker" },
  { label: "Math", detail: "LaTeX equation block", insert: "$$\n|\n$$", block: true, keywords: "equation latex formula" },
  { label: "Citation", detail: "Source with author, title, year", action: "insert-citation", keywords: "cite source reference apa mla" },
  { label: "PDF quote", detail: "Quote from a PDF with its page link", action: "insert-pdf-quote", keywords: "highlight pdf page" },
  { label: "Image", detail: "Insert a picture from your computer", action: "insert-image", keywords: "picture photo" },
  { label: "Drawing box", detail: "Sketch something by hand", action: "insert-drawing", keywords: "sketch draw svg" },
  { label: "Start focus timer", detail: "Start a focus session", action: "start-timer", keywords: "pomodoro timer focus" },
];

function applySlash(item: SlashItem) {
  return (view: EditorView, _c: Completion, from: number, to: number) => {
    if (item.action) {
      view.dispatch({ changes: { from, to, insert: "" } });
      view.state.facet(editorHost)?.action(item.action);
      return;
    }
    const raw = item.insert ?? "";
    const cursor = raw.indexOf("|");
    const body = raw.replace("|", "");
    const line = view.state.doc.lineAt(from);
    const lineIsEmpty = view.state.sliceDoc(line.from, from).trim() === "" && view.state.sliceDoc(to, line.to).trim() === "";
    // Block content typed mid-paragraph starts on a new line; on an empty line it replaces the line.
    const prefix = item.block && !lineIsEmpty ? "\n" : "";
    const text = prefix + body;
    const start = item.block && lineIsEmpty ? line.from : from;
    const end = item.block && lineIsEmpty ? line.to : to;
    const anchor = start + prefix.length + (cursor === -1 ? body.length : cursor);
    view.dispatch({ changes: { from: start, to: end, insert: text }, selection: { anchor }, userEvent: "input.complete" });
    // "Link to note" lands inside [[ ]]: show the list of notes straight away.
    if (body.includes("[[")) setTimeout(() => startCompletion(view), 0);
  };
}

function slashSource(ctx: CompletionContext): CompletionResult | null {
  const m = ctx.matchBefore(/(?:^|\s)\/[\w ]{0,20}$/);
  if (!m) return null;
  const slash = m.text.indexOf("/");
  const from = m.from + slash;
  const query = m.text.slice(slash + 1);
  if (query.endsWith("  ")) return null;
  return {
    from,
    options: SLASH_ITEMS.map((it, i) => ({
      label: "/" + it.label,
      displayLabel: it.label,
      detail: it.detail,
      type: it.action ? "function" : "keyword",
      apply: applySlash(it),
      // Keep the hand-picked order (headings and checklists first).
      boost: 99 - i,
      section: it.action ? "Insert" : "Blocks",
    })),
    filter: true,
    validFor: /^\/[\w ]*$/,
  };
}

function wikiSource(ctx: CompletionContext): CompletionResult | null {
  const m = ctx.matchBefore(/!?\[\[[^[\]\n|#]*$/);
  if (!m) return null;
  const host = ctx.state.facet(editorHost);
  if (!host) return null;
  const start = m.from + m.text.indexOf("[[") + 2;
  const closes = ctx.state.sliceDoc(ctx.pos, ctx.pos + 2) === "]]";
  const embed = m.text.startsWith("!");
  const notes: Completion[] = host.noteNames().map((name) => ({
    label: name,
    type: "text",
    section: "Notes",
    apply: (view: EditorView, _c: Completion, from: number, to: number) => {
      const insert = closes ? name : `${name}]]`;
      view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + name.length + 2 }, userEvent: "input.complete" });
    },
  }));
  // Reminders link as `[[Reminders#^id|text]]`, so the calendar can show the note back.
  const reminders: Completion[] = embed
    ? []
    : (host.reminders?.() ?? []).map((r) => ({
        label: r.text,
        detail: r.date ? `Reminder · ${r.date}` : "Reminder",
        type: "variable",
        section: "Reminders",
        apply: (view: EditorView, _c: Completion, from: number, to: number) => {
          const body = `${r.target()}|${r.text.replace(/[[\]|]/g, "")}`;
          const insert = closes ? body : `${body}]]`;
          view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + body.length + 2 }, userEvent: "input.complete" });
        },
      }));
  // Typed a name that isn't a note yet: offer to make it, so the link isn't left dangling.
  const typed = ctx.state.sliceDoc(start, ctx.pos).trim();
  const lower = typed.toLowerCase();
  const create: Completion[] =
    typed && !embed && host.createNote && !host.noteNames().some((n) => n.toLowerCase() === lower)
      ? [{
          label: ctx.state.sliceDoc(start, ctx.pos),
          displayLabel: `Create note “${typed}”`,
          type: "keyword",
          // After the Notes and Reminders sections, so Enter still picks a matching note first.
          section: { name: "New note", rank: 2e9 },
          boost: -50,
          apply: (view: EditorView, _c: Completion, from: number, to: number) => {
            const insert = closes ? typed : `${typed}]]`;
            view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + typed.length + 2 }, userEvent: "input.complete" });
            void host.createNote?.(typed);
          },
        }]
      : [];
  // No validFor: the "Create note" option has to follow what's typed.
  return {
    from: start,
    options: [...notes, ...reminders, ...create],
  };
}

function tagSource(ctx: CompletionContext): CompletionResult | null {
  const m = ctx.matchBefore(/(?:^|\s)#[\p{L}\p{N}_\-/]*$/u);
  if (!m) return null;
  const host = ctx.state.facet(editorHost);
  if (!host) return null;
  const line = ctx.state.doc.lineAt(ctx.pos);
  // `# ` at line start is a heading, not a tag.
  if (/^#+$/.test(line.text.slice(0, ctx.pos - line.from))) return null;
  const from = m.from + m.text.indexOf("#") + 1;
  return {
    from,
    options: host.tagNames().map((t) => ({ label: t, type: "constant" })),
    validFor: /^[\p{L}\p{N}_\-/]*$/u,
  };
}

/** The app's Ctrl+K commands, after the blocks: picking one removes the `/…` and runs it. */
function commandOptions(ctx: CompletionContext, q: string): Completion[] {
  const cmds = ctx.state.facet(editorHost)?.appCommands?.() ?? [];
  return cmds
    .filter((c) => !q || `${c.title} ${c.description ?? ""} ${c.group} ${c.keywords ?? ""}`.toLowerCase().includes(q))
    .map((c, i) => ({
      label: "/" + (q || c.title),
      displayLabel: c.title,
      detail: c.description,
      type: "function",
      boost: -i / 1000,
      section: { name: `Commands · ${c.group}`, rank: 2e9 + 1 },
      apply: (view: EditorView, _c: Completion, from: number, to: number) => {
        view.dispatch({ changes: { from, to, insert: "" } });
        c.run();
      },
    }));
}

/** Matches slash items on their keywords too (e.g. "/todo" finds Checklist). */
function slashKeywordSource(ctx: CompletionContext): CompletionResult | null {
  const r = slashSource(ctx);
  if (!r) return null;
  const q = ctx.state.sliceDoc(r.from + 1, ctx.pos).toLowerCase().trim();
  if (!q) return { ...r, options: [...r.options, ...commandOptions(ctx, "")], filter: false, validFor: undefined };
  const options = SLASH_ITEMS.filter((it) => `${it.label} ${it.keywords ?? ""}`.toLowerCase().includes(q)).map((it, i) => ({
    label: "/" + q,
    displayLabel: it.label,
    detail: it.detail,
    type: it.action ? "function" : "keyword",
    apply: applySlash(it),
    boost: 99 - i,
    section: it.action ? "Insert" : "Blocks",
  }));
  return { from: r.from, options: [...options, ...commandOptions(ctx, q)], filter: false };
}

export const writalinCompletions = autocompletion({
  override: [slashKeywordSource, wikiSource, tagSource],
  icons: false,
  closeOnBlur: true,
  activateOnTyping: true,
  maxRenderedOptions: 300,
});
