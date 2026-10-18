import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { foldAll, unfoldAll } from "@codemirror/language";
import { writalinExtensions } from "./setup";
import type { EditorHost } from "./host";
import { focusCompartment, focusModeExtension } from "./focusMode";
import { printCompartment, printLayout } from "./printLayout";
import { insertText, selectedText, setLinePrefix, toggleWrap } from "./commands";
import { outlineOf, type OutlineItem } from "./outline";

export interface NoteEditorHandle {
  view: EditorView | null;
  insert(text: string, opts?: { block?: boolean; cursorOffset?: number }): void;
  wrap(marker: string): void;
  prefix(prefix: string): void;
  selection(): string;
  /** Replace the selection (used by "Move to note" and AI tools). */
  replaceSelection(text: string): void;
  scrollToPos(pos: number): void;
  scrollToHeading(text: string): void;
  cursor(): number;
  setCursor(pos: number): void;
  focus(): void;
  foldAll(): void;
  unfoldAll(): void;
  outline(): OutlineItem[];
}

export interface NoteEditorProps {
  /** Changing `docKey` loads `initialDoc` fresh (a different note). */
  docKey: string;
  initialDoc: string;
  host: EditorHost;
  onChange: (doc: string) => void;
  onOutline?: (items: OutlineItem[]) => void;
  onSelectionChange?: (text: string) => void;
  focusMode?: boolean;
  printLayout?: boolean;
  placeholder?: string;
  initialCursor?: number;
  className?: string;
}

/** The shared Markdown note editor used by the website and the extension. */
export const NoteEditor = forwardRef<NoteEditorHandle, NoteEditorProps>(function NoteEditor(props, ref) {
  const parent = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Latest callbacks without rebuilding the editor on every render.
  const cb = useRef(props);
  cb.current = props;

  useEffect(() => {
    let outlineTimer: ReturnType<typeof setTimeout> | undefined;
    const state = EditorState.create({
      doc: props.initialDoc,
      selection: props.initialCursor != null ? EditorSelection.cursor(Math.min(props.initialCursor, props.initialDoc.length)) : undefined,
      extensions: writalinExtensions({
        host: {
          noteNames: () => cb.current.host.noteNames(),
          tagNames: () => cb.current.host.tagNames(),
          linkExists: (t) => cb.current.host.linkExists(t),
          openLink: (t, o) => cb.current.host.openLink(t, o),
          openUrl: (u) => cb.current.host.openUrl(u),
          resolveEmbed: (t) => cb.current.host.resolveEmbed(t),
          action: (a) => cb.current.host.action(a),
        },
        placeholder: props.placeholder,
        focusMode: props.focusMode,
        printLayout: props.printLayout,
        onChange: (doc) => {
          cb.current.onChange(doc);
          clearTimeout(outlineTimer);
          outlineTimer = setTimeout(() => viewRef.current && cb.current.onOutline?.(outlineOf(viewRef.current.state)), 250);
        },
        onSelection: (view) => {
          const s = view.state.selection.main;
          cb.current.onSelectionChange?.(view.state.sliceDoc(s.from, s.to));
        },
      }),
    });
    const view = new EditorView({ state, parent: parent.current! });
    viewRef.current = view;
    cb.current.onOutline?.(outlineOf(state));
    if (props.initialCursor != null) view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: "center" }) });
    return () => {
      clearTimeout(outlineTimer);
      view.destroy();
      viewRef.current = null;
    };
    // Only a new note rebuilds the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.docKey]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: focusCompartment.reconfigure(focusModeExtension(!!props.focusMode)) });
  }, [props.focusMode]);
  useEffect(() => {
    viewRef.current?.dispatch({ effects: printCompartment.reconfigure(printLayout(!!props.printLayout)) });
  }, [props.printLayout]);

  useImperativeHandle(
    ref,
    () => ({
      get view() {
        return viewRef.current;
      },
      insert: (text, opts) => viewRef.current && insertText(viewRef.current, text, opts),
      wrap: (m) => viewRef.current && toggleWrap(viewRef.current, m),
      prefix: (p) => viewRef.current && setLinePrefix(viewRef.current, p),
      selection: () => (viewRef.current ? selectedText(viewRef.current) : ""),
      replaceSelection: (text) => {
        const v = viewRef.current;
        if (!v) return;
        v.dispatch(v.state.replaceSelection(text));
      },
      scrollToPos: (pos) => {
        const v = viewRef.current;
        if (!v) return;
        const p = Math.min(pos, v.state.doc.length);
        v.dispatch({ selection: { anchor: p }, effects: EditorView.scrollIntoView(p, { y: "start", yMargin: 60 }) });
        v.focus();
      },
      scrollToHeading: (text) => {
        const v = viewRef.current;
        if (!v) return;
        const h = outlineOf(v.state).find((o) => o.text.toLowerCase() === text.toLowerCase());
        if (h) {
          v.dispatch({ selection: { anchor: h.pos }, effects: EditorView.scrollIntoView(h.pos, { y: "start", yMargin: 60 }) });
          v.focus();
        }
      },
      cursor: () => viewRef.current?.state.selection.main.head ?? 0,
      setCursor: (pos) => viewRef.current?.dispatch({ selection: { anchor: Math.min(pos, viewRef.current.state.doc.length) } }),
      focus: () => viewRef.current?.focus(),
      foldAll: () => viewRef.current && foldAll(viewRef.current),
      unfoldAll: () => viewRef.current && unfoldAll(viewRef.current),
      outline: () => (viewRef.current ? outlineOf(viewRef.current.state) : []),
    }),
    [],
  );

  return <div ref={parent} className={`w-editor ${props.className ?? ""}`} />;
});
