import { useMemo } from "react";
import type { EditorHost, HostAction } from "@writalin/editor";
import type { Vault } from "@writalin/vault";
import { isMarkdown } from "@writalin/shared";

/** The bridge between the shared editor and this vault. */
export function useNoteHost(
  vault: Vault,
  fromPath: () => string | null,
  handlers: {
    openPath: (path: string, opts: { heading?: string; newPane?: boolean; page?: number }) => void;
    createAndOpen: (name: string) => void;
    action: (a: HostAction) => void;
  },
): EditorHost {
  return useMemo<EditorHost>(
    () => ({
      noteNames: () => [...vault.notes.values()].map((n) => n.name).sort(),
      tagNames: () => [...vault.tagCounts().keys()],
      linkExists: (t) => vault.resolve(t, fromPath() ?? "") != null,
      openLink: (target, opts) => {
        const path = vault.resolve(target, fromPath() ?? "");
        if (path) handlers.openPath(path, opts);
        else if (target) handlers.createAndOpen(target);
      },
      openUrl: (url) => {
        if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
          window.open(url, "_blank", "noopener,noreferrer");
          return;
        }
        // Relative link into the vault, e.g. a PDF quote's `attachments/x.pdf#page=4`.
        const [rawPath, hash = ""] = url.split("#");
        let path = rawPath!;
        try {
          path = decodeURIComponent(path);
        } catch {
          /* keep raw */
        }
        const resolved = vault.files.has(path) ? path : vault.resolve(path, fromPath() ?? "");
        if (!resolved) return;
        const page = /page=(\d+)/.exec(hash)?.[1];
        handlers.openPath(resolved, { page: page ? Number(page) : undefined, heading: !isMarkdown(resolved) ? undefined : hash || undefined });
      },
      resolveEmbed: async (target) => {
        const path = vault.files.has(target) ? target : vault.resolve(target, fromPath() ?? "");
        if (!path) return null;
        try {
          return URL.createObjectURL(await vault.store.readBinary(path));
        } catch {
          return null;
        }
      },
      action: (a) => handlers.action(a),
    }),
    // Handlers are read through refs by callers; the host itself is stable per vault.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vault],
  );
}
