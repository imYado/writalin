import { useEffect, useState } from "react";
import type { VaultPath } from "@writalin/shared";
import { basename } from "@writalin/shared";
import type { WorkspaceProps } from "./types";

export function ImageWorkspace({ vault, path, insertIntoNote }: WorkspaceProps & { path: VaultPath }) {
  const [url, setUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    let u: string | null = null;
    void vault.store.readBinary(path).then((b) => {
      u = URL.createObjectURL(b);
      setUrl(u);
    });
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [vault, path]);
  return (
    <div className="ws ws-image">
      <div className="ws-toolbar">
        <span className="ws-title">{basename(path)}</span>
        <button className="w-icon-btn" onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))} aria-label="Zoom out">−</button>
        <span className="w-muted">{Math.round(zoom * 100)}%</span>
        <button className="w-icon-btn" onClick={() => setZoom((z) => Math.min(4, z + 0.25))} aria-label="Zoom in">+</button>
        <button className="w-btn w-btn-small" onClick={() => insertIntoNote(`![[${path}]]`)}>Insert in note</button>
      </div>
      <div className="ws-scroll ws-image-stage">
        {url ? <img src={url} alt={basename(path)} style={{ width: `${zoom * 100}%` }} /> : <p className="w-muted">Loading…</p>}
      </div>
    </div>
  );
}
