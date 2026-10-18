import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
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
  { label: "Heading 1", insert: "# |", block: true, keywords: "title h1" },
  { label: "Heading 2", insert: "## |", block: true, keywords: "h2 section" },
  { label: "Heading 3", insert: "### |", block: true, keywords: "h3" },
  { label: "Checklist", insert: "- [ ] |", block: true, keywords: "todo task checkbox" },
  { label: "Task with due date", insert: `- [ ] | 📅 ${today()}`, block: true, keywords: "reminder deadline due" },
  { label: "Bullet list", insert: "- |", block: true, keywords: "ul unordered" },
  { label: "Numbered list", insert: "1. |", block: true, keywords: "ol ordered" },
  { label: "Quote", insert: "> |", block: true, keywords: "blockquote" },
  { label: "Callout: note", insert: "> [!note] |\n> ", block: true, keywords: "info box" },
  { label: "Callout: tip", insert: "> [!tip] |\n> ", block: true, keywords: "hint box" },
  { label: "Callout: warning", insert: "> [!warning] |\n> ", block: true, keywords: "caution box" },
  { label: "Callout: question", insert: "> [!question] |\n> ", block: true, keywords: "ask box" },
  { label: "Table", insert: "| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n| | | |", block: true, keywords: "grid" },
  { label: "Code block", insert: "```\n|\n```", block: true, keywords: "pre snippet" },
  { label: "Divider", insert: "---\n|", block: true, keywords: "hr rule line" },
  { label: "Flashcard", insert: "| :: Answer", block: true, keywords: "card question answer study spaced repetition" },
  { label: "Link to note", insert: "[[|]]", keywords: "wiki page" },
  { label: "Highlight", insert: "==|==", keywords: "marker" },
  { label: "Math", insert: "$$\n|\n$$", block: true, keywords: "equation latex formula" },
  { label: "Citation", action: "insert-citation", keywords: "cite source reference apa mla" },
  { label: "PDF quote", action: "insert-pdf-quote", keywords: "highlight pdf page" },
  { label: "Image", action: "insert-image", keywords: "picture photo" },
  { label: "Drawing box", action: "insert-drawing", keywords: "sketch draw svg" },
  { label: "Start focus timer", action: "start-timer", keywords: "pomodoro timer focus" },
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
    options: SLASH_ITEMS.map((it) => ({
      label: "/" + it.label,
      displayLabel: it.label,
      detail: it.detail,
      type: it.action ? "function" : "keyword",
      apply: applySlash(it),
      boost: 0,
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
  return {
    from: start,
    options: host.noteNames().map((name) => ({
      label: name,
      type: "text",
      apply: (view: EditorView, _c: Completion, from: number, to: number) => {
        const insert = closes ? name : `${name}]]`;
        view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + name.length + 2 }, userEvent: "input.complete" });
      },
    })),
    validFor: /^[^[\]\n|#]*$/,
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

/** Matches slash items on their keywords too (e.g. "/todo" finds Checklist). */
function slashKeywordSource(ctx: CompletionContext): CompletionResult | null {
  const r = slashSource(ctx);
  if (!r) return null;
  const q = ctx.state.sliceDoc(r.from + 1, ctx.pos).toLowerCase().trim();
  if (!q) return r;
  const options = SLASH_ITEMS.filter((it) => `${it.label} ${it.keywords ?? ""}`.toLowerCase().includes(q)).map((it) => ({
    label: "/" + q,
    displayLabel: it.label,
    type: it.action ? "function" : "keyword",
    apply: applySlash(it),
    section: it.action ? "Insert" : "Blocks",
  }));
  return { from: r.from, options, filter: false };
}

export const writalinCompletions = autocompletion({
  override: [slashKeywordSource, wikiSource, tagSource],
  icons: false,
  closeOnBlur: true,
  activateOnTyping: true,
  maxRenderedOptions: 30,
});
