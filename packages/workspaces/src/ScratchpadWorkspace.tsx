import { useEffect, useMemo, useRef, useState } from "react";
import { NoteEditor, type NoteEditorHandle, type EditorHost } from "@writalin/editor";
import { debounce } from "@writalin/shared";
import { SCRATCHPAD_PATH } from "@writalin/vault";
import { Modal, toast } from "@writalin/ui";
import type { WorkspaceProps } from "./types";

/** One untitled Scratchpad.md for brain dumps. Saved as you type. */
export function ScratchpadWorkspace({ vault, version, host }: WorkspaceProps & { host: EditorHost }) {
  const [text, setText] = useState<string | null>(null);
  const [selection, setSelection] = useState("");
  const [moving, setMoving] = useState(false);
  const ref = useRef<NoteEditorHandle>(null);
  const mtime = useRef(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      await vault.ensureScratchpad();
      const r = await vault.read(SCRATCHPAD_PATH);
      mtime.current = r.mtime;
      if (alive) setText(r.text);
    })();
    return () => {
      alive = false;
    };
  }, [vault]);

  const save = useMemo(
    () =>
      debounce(async (doc: string) => {
        const s = await vault.write(SCRATCHPAD_PATH, doc);
        mtime.current = s.mtime;
      }, 400),
    [vault],
  );
  useEffect(() => () => save.flush(), [save]);
  void version;

  if (text == null) return <div className="ws ws-loading">Opening scratch pad…</div>;

  return (
    <div className="ws ws-scratch">
      {selection.trim() && (
        <div className="ws-floating">
          <button className="w-btn w-btn-small w-btn-primary" onClick={() => setMoving(true)}>Move to note</button>
        </div>
      )}
      <NoteEditor
        ref={ref}
        docKey={`scratch:${vault.name}`}
        initialDoc={text}
        host={host}
        onChange={(d) => save(d)}
        onSelectionChange={setSelection}
        placeholder="Brain dump here. Nothing to organize yet."
      />
      {moving && (
        <MoveToNote
          names={[...vault.notes.values()].filter((n) => n.path !== SCRATCHPAD_PATH).map((n) => ({ name: n.name, path: n.path }))}
          onClose={() => setMoving(false)}
          onMove={async (target, isNew) => {
            const chunk = ref.current?.selection() ?? "";
            if (!chunk.trim()) return;
            const path = isNew ? await vault.createNote(target, { body: chunk + "\n" }) : target;
            if (!isNew) await vault.append(path, chunk);
            ref.current?.replaceSelection("");
            setMoving(false);
            toast(`Moved to ${isNew ? target : path.replace(/\.md$/, "")}.`);
          }}
        />
      )}
    </div>
  );
}

export function MoveToNote({ names, onClose, onMove }: {
  names: { name: string; path: string }[];
  onClose: () => void;
  onMove: (target: string, isNew: boolean) => void;
}) {
  const [q, setQ] = useState("");
  const matches = names.filter((n) => n.name.toLowerCase().includes(q.toLowerCase())).slice(0, 8);
  return (
    <Modal title="Move to note" onClose={onClose} width={420}>
      <input className="w-input" autoFocus placeholder="Note name…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Note name" />
      <ul className="pick-list">
        {q.trim() && !names.some((n) => n.name.toLowerCase() === q.trim().toLowerCase()) && (
          <li><button onClick={() => onMove(q.trim(), true)}>Create “{q.trim()}”</button></li>
        )}
        {matches.map((n) => (
          <li key={n.path}><button onClick={() => onMove(n.path, false)}>{n.name}</button></li>
        ))}
      </ul>
    </Modal>
  );
}
