import { useMemo } from "react";
import type { EditorHost, HostAction } from "@writalin/editor";
import { newBlockId, taskDate, type Vault } from "@writalin/vault";
import { isMarkdown } from "@writalin/shared";
import { toast } from "@writalin/ui";

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
      createNote: async (name) => {
        if (vault.resolve(name, fromPath() ?? "")) return;
        const path = await vault.createNote(name);
        toast(`Made a new note “${name}”.`, { action: { label: "Open", run: () => handlers.openPath(path, {}) } });
      },
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
          const blob = await vault.store.readBinary(path);
          // SVG only renders in an <img> with its proper type.
          const typed = /\.svg$/i.test(path) && blob.type !== "image/svg+xml" ? new Blob([blob], { type: "image/svg+xml" }) : blob;
          return URL.createObjectURL(typed);
        } catch {
          return null;
        }
      },
      action: (a) => handlers.action(a),
      reminders: () =>
        vault.reminders().filter((t) => t.status === "todo").map((t) => ({
          text: t.text,
          date: taskDate(t),
          target: () => {
            // A new id is written to the reminder's line in the background.
            const id = t.blockId ?? newBlockId();
            if (!t.blockId) void vault.ensureBlockId(t, id).catch(() => {});
            return `Reminders#^${id}`;
          },
        })),
      readText: async (target) => {
        const path = vault.files.has(target) ? target : vault.resolve(target, fromPath() ?? "");
        return path ? (await vault.read(path)).text : null;
      },
      writeText: async (target, text) => {
        const path = vault.files.has(target) ? target : vault.resolve(target, fromPath() ?? "") ?? target;
        await vault.write(path, text);
      },
      saveImage: async (file) => {
        const ext = file.type.split("/")[1]?.replace("jpeg", "jpg").replace("svg+xml", "svg") ?? "png";
        const name = file.name && file.name !== "image.png" ? file.name : `Pasted image ${new Date().toISOString().slice(0, 19).replace(/[T:]/g, (c) => (c === "T" ? " " : ""))}.${ext}`;
        return vault.writeBinary(`${vault.settings.attachmentsFolder}/${name}`, file);
      },
    }),
    // Handlers are read through refs by callers; the host itself is stable per vault.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vault],
  );
}
