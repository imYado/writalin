import { zip, unzip, strToU8, type Zippable } from "fflate";
import { isHiddenPath, normalizePath } from "@writalin/shared";
import type { FileStore } from "./fs/types";

/** Pack the whole vault (including `.writalin/` settings and themes) into a .zip. */
export async function exportZip(store: FileStore): Promise<Blob> {
  const files: Zippable = {};
  for (const f of await store.list()) {
    if (isHiddenPath(f.path) && !f.path.startsWith(".writalin/")) continue;
    const blob = await store.readBinary(f.path);
    files[f.path] = new Uint8Array(await blob.arrayBuffer());
  }
  const data = await new Promise<Uint8Array>((res, rej) => zip(files, { level: 6 }, (err, out) => (err ? rej(err) : res(out))));
  return new Blob([data as BlobPart], { type: "application/zip" });
}

/**
 * Unpack a .zip into the vault. If every entry shares one top folder (as when
 * someone zips "MyVault/"), that folder is stripped. Returns written paths.
 */
export async function importZip(store: FileStore, data: ArrayBuffer, into = ""): Promise<string[]> {
  const entries = await new Promise<Record<string, Uint8Array>>((res, rej) =>
    unzip(new Uint8Array(data), (err, out) => (err ? rej(err) : res(out))),
  );
  const paths = Object.keys(entries).filter((p) => !p.endsWith("/") && !p.startsWith("__MACOSX/"));
  const tops = new Set(paths.map((p) => p.split("/")[0]));
  const strip = tops.size === 1 && paths.every((p) => p.includes("/")) ? [...tops][0]! + "/" : "";
  const written: string[] = [];
  for (const p of paths) {
    const rel = normalizePath(`${into}/${p.slice(strip.length)}`);
    if (!rel) continue;
    const bytes = entries[p]!;
    const isText = /\.(md|txt|json|css|svg|csv)$/i.test(rel);
    await store.write(rel, isText ? new TextDecoder().decode(bytes) : new Blob([bytes as BlobPart]));
    written.push(rel);
  }
  return written;
}

export { strToU8 };
