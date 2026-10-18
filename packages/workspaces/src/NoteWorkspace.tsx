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
  const save = useMemo(
    () =>
      debounce(async (body: string) => {
        const s = await vault.writeBody(path, body, { expectedMtime: mtime.current }).catch(() => null);
        if (s) mtime.current = s.mtime;
      }, 500),
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
      <NoteEditor docKey={`side:${path}`} initialDoc={doc} host={host} onChange={save} />
    </div>
  );
}
