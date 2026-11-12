import { useEffect, useMemo, useRef, useState } from "react";
import { NoteEditor, type EditorHost } from "@writalin/editor";
import type { VaultPath } from "@writalin/shared";
import { debounce, noteName } from "@writalin/shared";
import { splitFrontmatter } from "@writalin/vault";
import type { WorkspaceProps } from "./types";

/** A second note side by side with the main one. */
export function NoteWorkspace({ vault, path, host, openNote }: WorkspaceProps & { path: VaultPath; host: EditorHost }) {
  const [doc, setDoc] = useState<string | null>(null);
  const mtime = useRef(0);
  useEffect(() => {
    let alive = true;
    void vault.read(path).then((r) => {
      mtime.current = r.mtime;
      if (alive) setDoc(splitFrontmatter(r.text).body);
    });
    return () => {
      alive = false;
    };
  }, [vault, path]);
  /** Typing not saved yet, and a save under way: neither is interrupted by a reload. */
  const dirty = useRef(false);
  const saving = useRef(false);
  const [rev, setRev] = useState(0);
  const save = useMemo(
    () =>
      debounce(async (body: string) => {
        saving.current = true;
        dirty.current = false;
        const s = await vault.writeBody(path, body, { expectedMtime: mtime.current }).catch(() => null);
        if (s) mtime.current = s.mtime;
        saving.current = false;
      }, 500),
    [vault, path],
  );
  // The note changed somewhere else (the tutor added a flashcard, the main editor saved): show the new text.
  useEffect(
    () =>
      vault.events.on((e) => {
        if (e.type !== "changed" || e.path !== path || saving.current || dirty.current) return;
        if (vault.files.get(path)?.mtime === mtime.current) return;
        void vault.read(path).then((r) => {
          if (dirty.current || saving.current) return;
          mtime.current = r.mtime;
          setDoc(splitFrontmatter(r.text).body);
          setRev((n) => n + 1);
        }).catch(() => {});
      }),
    [vault, path],
  );
  useEffect(() => () => save.flush(), [save]);
  if (doc == null) return <div className="ws ws-loading">Opening…</div>;
  return (
    <div className="ws ws-note">
      <div className="ws-toolbar">
        <span className="ws-title">{noteName(path)}</span>
        <button className="w-btn w-btn-small" onClick={() => openNote(path)}>Open on the right</button>
      </div>
      <NoteEditor docKey={`side:${path}:${rev}`} initialDoc={doc} host={host} onChange={(body) => { dirty.current = true; save(body); }} />
    </div>
  );
}
