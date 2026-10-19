import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type MouseEvent } from "react";
import { NoteEditor, type EditorHost, type NoteEditorHandle, type OutlineItem } from "@writalin/editor";
import { ConflictError, lineCount, splitFrontmatter, type Vault, type Backlink } from "@writalin/vault";
import { debounce, dirname, joinPath, noteName, sanitizeFileName, type VaultPath } from "@writalin/shared";
import { Icon, toast } from "@writalin/ui";

export interface NotePaneHandle {
  editor: NoteEditorHandle | null;
  /** Save now; resolves once the file is written. */
  flush(): Promise<void>;
}

interface Props {
  vault: Vault;
  path: VaultPath;
  host: EditorHost;
  version: number;
  focusMode: boolean;
  printLayout: boolean;
  outlineOpen: boolean;
  /** Jump target after opening (heading text or 0-based line). */
  jump?: { heading?: string; line?: number; nonce: number };
  onRenamed: (to: VaultPath) => void;
  onOpen: (path: VaultPath) => void;
  onTag: (tag: string) => void;
  /** The ⋯ button: export and delete live in a menu under it. */
  onMore: (anchor: DOMRect) => void;
  /** Right-click inside the text. */
  onContextMenu: (e: MouseEvent) => void;
}

const cursorKey = (vault: string, path: string) => `writalin.cursor:${vault}:${path}`;

/** The note on the right: title, tags, editor, outline and "Linked from". */
export const NotePane = forwardRef<NotePaneHandle, Props>(function NotePane(p, ref) {
  const { vault, path } = p;
  const [loaded, setLoaded] = useState<{ path: string; body: string; nonce: number } | null>(null);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [title, setTitle] = useState(noteName(path));
  const [conflict, setConflict] = useState<ConflictError | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const editor = useRef<NoteEditorHandle>(null);
  const mtime = useRef(0);
  const dirty = useRef(false);
  const latest = useRef("");
  /** The save in flight, so our own write isn't mistaken for someone else's. */
  const saving = useRef<Promise<unknown> | null>(null);
  /** Lines taken by frontmatter: task line numbers count them, the editor doesn't show them. */
  const fmLines = useRef(0);

  const load = useCallback(async () => {
    const r = await vault.read(path);
    mtime.current = r.mtime;
    const split = splitFrontmatter(r.text);
    latest.current = split.body;
    fmLines.current = lineCount(r.text.slice(0, split.bodyOffset));
    dirty.current = false;
    setLoaded({ path, body: latest.current, nonce: Date.now() });
  }, [vault, path]);

  useEffect(() => {
    setLoaded(null);
    setConflict(null);
    setTitle(noteName(path));
    load().catch((e) => toast(`Couldn't open this note: ${(e as Error).message}`, { tone: "warn" }));
  }, [load, path]);

  const save = useMemo(
    () =>
      debounce((body: string, target: string) => {
        setSaveState("saving");
        const run = (async () => {
          try {
            const s = await vault.writeBody(target, body, { expectedMtime: mtime.current });
            mtime.current = s.mtime;
            dirty.current = false;
            setSaveState("saved");
          } catch (e) {
            if (e instanceof ConflictError) setConflict(e);
            setSaveState("error");
          }
        })();
        saving.current = run;
        void run.finally(() => {
          if (saving.current === run) saving.current = null;
        });
      }, 600),
    [vault],
  );

  useEffect(() => () => save.flush(), [save, path]);
  useEffect(() => {
    const onHide = () => save.flush();
    // Warn only if a save is still pending when the tab closes.
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirty.current) {
        save.flush();
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", onUnload);
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [save]);

  // Something else changed this note while it's open: another app, sync, or
  // a task ticked in the side pane. Reload it unless there's unsaved typing.
  useEffect(
    () =>
      vault.events.on((e) => {
        if (e.type !== "changed" || e.path !== path || saving.current) return;
        if (!e.external && vault.files.get(path)?.mtime === mtime.current) return;
        if (!dirty.current) void load();
        else setConflict(new ConflictError(path, "", 0));
      }),
    [vault, path, load],
  );

  useEffect(() => {
    void vault.backlinksWithContext(path).then(setBacklinks);
  }, [vault, path, p.version]);

  // Remember the cursor so "where was I?" is instant.
  useEffect(() => {
    const key = cursorKey(vault.name, path);
    return () => {
      try {
        const pos = editor.current?.cursor();
        if (pos != null) localStorage.setItem(key, String(pos));
      } catch {
        /* ignore */
      }
    };
  }, [vault, path, loaded?.nonce]);

  useEffect(() => {
    if (!p.jump || !loaded) return;
    requestAnimationFrame(() => {
      if (p.jump?.heading) editor.current?.scrollToHeading(p.jump.heading);
      else if (p.jump?.line != null) {
        const view = editor.current?.view;
        if (!view) return;
        const n = Math.min(view.state.doc.lines, Math.max(1, p.jump.line + 1 - fmLines.current));
        editor.current?.scrollToPos(view.state.doc.line(n).from);
      }
    });
  }, [p.jump?.nonce, loaded?.nonce]);

  useImperativeHandle(
    ref,
    () => ({
      get editor() {
        return editor.current;
      },
      flush: async () => {
        save.flush();
        await saving.current;
      },
    }),
    [save],
  );

  const rename = async () => {
    const clean = sanitizeFileName(title);
    if (clean === noteName(path)) return setTitle(noteName(path));
    save.flush();
    const to = joinPath(dirname(path), `${clean}.md`);
    try {
      const updated = await vault.rename(path, to);
      p.onRenamed(to);
      if (updated.length > 1) toast(`Renamed. Updated links in ${updated.length - 1} other note${updated.length > 2 ? "s" : ""}.`);
    } catch (e) {
      toast((e as Error).message, { tone: "warn" });
      setTitle(noteName(path));
    }
  };

  const meta = vault.notes.get(path);
  const initialCursor = (() => {
    try {
      const v = localStorage.getItem(cursorKey(vault.name, path));
      return v ? Number(v) : undefined;
    } catch {
      return undefined;
    }
  })();

  return (
    <div className={`note-pane${p.outlineOpen ? " with-outline" : ""}`}>
      <div className="note-scroll">
        <div className="note-head">
          <input
            className="note-title"
            value={title}
            aria-label="Note title"
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => void rename()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
                editor.current?.focus();
              }
              if (e.key === "Escape") setTitle(noteName(path));
            }}
          />
          <div className="note-sub">
            {dirname(path) && <span className="w-muted">{dirname(path)}</span>}
            {meta?.tags.map((t) => (
              <button key={t} className="note-tag" onClick={() => p.onTag(t)}>#{t}</button>
            ))}
            <span className={`note-save note-save-${saveState}`} aria-live="polite">
              {saveState === "saving" ? "Saving…" : saveState === "error" ? "Not saved" : "Saved"}
            </span>
            <button className="w-icon-btn note-more" onClick={(e) => p.onMore(e.currentTarget.getBoundingClientRect())} title="More" aria-label="More for this note" aria-haspopup="menu">
              <Icon name="more" size={16} />
            </button>
          </div>
        </div>
        {conflict && (
          <div className="note-conflict" role="alert">
            <span>This note changed in another app while you were editing.</span>
            <button className="w-btn w-btn-small" onClick={() => { setConflict(null); void load(); }}>Load their version</button>
            <button
              className="w-btn w-btn-small w-btn-primary"
              onClick={async () => {
                const s = await vault.writeBody(path, latest.current);
                mtime.current = s.mtime;
                dirty.current = false;
                setConflict(null);
                setSaveState("saved");
              }}
            >
              Keep mine
            </button>
          </div>
        )}
        {loaded && loaded.path === path && (
          <div className="note-editor" onContextMenu={p.onContextMenu}>
          <NoteEditor
            ref={editor}
            key={loaded.nonce}
            docKey={`${path}:${loaded.nonce}`}
            initialDoc={loaded.body}
            initialCursor={initialCursor}
            host={p.host}
            focusMode={p.focusMode}
            printLayout={p.printLayout}
            placeholder="Start writing. Type / for blocks, [[ to link a note."
            onOutline={setOutline}
            onChange={(doc) => {
              latest.current = doc;
              dirty.current = true;
              setSaveState("saving");
              save(doc, path);
            }}
          />
          </div>
        )}
        {backlinks.length > 0 && (
          <section className="backlinks" aria-label="Linked from">
            <h2><Icon name="link" size={14} /> Linked from</h2>
            <ul>
              {backlinks.map((b) => (
                <li key={b.path}>
                  <button onClick={() => p.onOpen(b.path)}>{noteName(b.path)}</button>
                  {b.context && <p className="w-muted">{b.context.replace(/\[\[([^\]|#]+)[^\]]*\]\]/g, "$1")}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      {p.outlineOpen && (
        <aside className="outline" aria-label="Outline">
          <h2>Outline</h2>
          {outline.length === 0 && <p className="w-muted">Add headings (#) to see an outline.</p>}
          <ul>
            {outline.map((o, i) => (
              <li key={`${o.pos}-${i}`} style={{ paddingLeft: (o.level - 1) * 12 }}>
                <button onClick={() => editor.current?.scrollToPos(o.pos)}>{o.text}</button>
              </li>
            ))}
          </ul>
          <div className="w-row outline-actions">
            <button className="w-btn w-btn-small" onClick={() => editor.current?.foldAll()}>Collapse all</button>
            <button className="w-btn w-btn-small" onClick={() => editor.current?.unfoldAll()}>Expand all</button>
          </div>
        </aside>
      )}
    </div>
  );
});
