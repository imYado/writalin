import { suggestions } from "./suggestions";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, drawSelection, dropCursor, highlightActiveLine, keymap, placeholder as placeholderExt, rectangularSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownKeymap, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting, indentOnInput, bracketMatching } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { search, searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { tags as t } from "@lezer/highlight";
import { livePreview, linkClicks } from "./livePreview";
import { writalinCompletions } from "./completions";
import { headingFolding } from "./folding";
import { focusCompartment, focusModeExtension } from "./focusMode";
import { exitInlineMark, makeCloze, toggleWrap } from "./commands";
import { editorHost, type EditorHost } from "./host";
import { printLayout, printCompartment } from "./printLayout";
import { tables } from "./tables";
import { media } from "./media";

const highlight = HighlightStyle.define([
  { tag: t.heading, color: "var(--w-heading)", fontWeight: "650" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.link, color: "var(--w-link)" },
  { tag: t.url, color: "var(--w-text-muted)" },
  { tag: t.monospace, fontFamily: "var(--w-font-mono)" },
  { tag: [t.processingInstruction, t.meta], color: "var(--w-text-muted)" },
  { tag: t.quote, color: "var(--w-text)" },
  { tag: [t.keyword, t.operator], color: "var(--w-accent)" },
  { tag: [t.string, t.special(t.string)], color: "var(--w-tag)" },
  { tag: t.comment, color: "var(--w-text-muted)", fontStyle: "italic" },
  { tag: [t.number, t.bool, t.atom], color: "var(--w-link-unresolved)" },
  { tag: [t.function(t.variableName), t.typeName, t.className], color: "var(--w-link)" },
]);

const formatKeys = keymap.of([
  { key: "Mod-b", run: (v) => toggleWrap(v, "**") },
  { key: "Mod-i", run: (v) => toggleWrap(v, "_") },
  { key: "Mod-Shift-h", run: (v) => toggleWrap(v, "==") },
  { key: "Mod-e", run: (v) => toggleWrap(v, "`") },
  { key: "Mod-Shift-x", run: (v) => toggleWrap(v, "~~") },
  { key: "Mod-Alt-c", run: makeCloze },
]);

export interface WritalinEditorOptions {
  host: EditorHost;
  placeholder?: string;
  focusMode?: boolean;
  printLayout?: boolean;
  onChange?: (doc: string) => void;
  onSelection?: (view: EditorView) => void;
  extra?: Extension[];
}

export function writalinExtensions(o: WritalinEditorOptions): Extension[] {
  return [
    editorHost.of(o.host),
    history(),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    search({ top: true }),
    EditorView.lineWrapping,
    EditorState.allowMultipleSelections.of(true),
    markdown({ base: markdownLanguage, addKeymap: true }),
    syntaxHighlighting(highlight),
    livePreview,
    suggestions,
    tables,
    media,
    linkClicks,
    writalinCompletions,
    headingFolding,
    focusCompartment.of(focusModeExtension(!!o.focusMode)),
    printCompartment.of(printLayout(!!o.printLayout)),
    formatKeys,
    keymap.of([...closeBracketsKeymap, ...completionKeymap, { key: "Enter", run: exitInlineMark }, ...markdownKeymap, ...searchKeymap, ...historyKeymap, ...defaultKeymap, indentWithTab]),
    o.placeholder ? placeholderExt(o.placeholder) : [],
    EditorView.contentAttributes.of({ "aria-label": "Note editor", spellcheck: "true", autocorrect: "on", autocapitalize: "sentences" }),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) o.onChange?.(u.state.doc.toString());
      if (u.selectionSet || u.docChanged) o.onSelection?.(u.view);
    }),
    ...(o.extra ?? []),
  ];
}
