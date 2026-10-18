import { db } from "../_lib/db.js";
import { handler, json, HttpError } from "../_lib/http.js";
import { requireUser } from "../_lib/auth.js";
import { cleanPath, requireVault } from "../_lib/vaults.js";

const MAX_BYTES = 4 * 1024 * 1024;

async function target(req: Request) {
  const user = await requireUser(req);
  const url = new URL(req.url);
  const vault = await requireVault(user, url.searchParams.get("vault"));
  return { vault, path: cleanPath(url.searchParams.get("path")), url };
}

async function current(vault: string, path: string) {
  const rows = await db()`select path, hash, deleted, size, version::text as version from sync_files where vault_id = ${vault} and path = ${path}`;
  const r = rows[0];
  return r ? { path: r.path, hash: r.hash, deleted: r.deleted, size: r.size, version: Number(r.version) } : { path, hash: null, deleted: true, size: 0, version: 0 };
}

export const GET = handler(async (req) => {
  const { vault, path } = await target(req);
  const rows = await db()`select encode(data, 'base64') as data from sync_files where vault_id = ${vault} and path = ${path} and not deleted`;
  if (!rows.length) throw new HttpError(404, "File not found.");
  return new Response(Buffer.from(rows[0]!.data as string, "base64"), {
    headers: { "content-type": "application/octet-stream", "cache-control": "no-store" },
  });
});

/**
 * Upload a file. `base` is the hash this computer last saw; if the server has
 * moved on, nothing is written and the current version comes back with 409.
 */
export const PUT = handler(async (req) => {
  const { vault, path, url } = await target(req);
  const base = url.searchParams.get("base") || null;
  const hash = url.searchParams.get("hash") ?? "";
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new HttpError(400, "Missing content hash.");
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new HttpError(413, "File is too large to sync.");
  const data = buf.toString("base64");
  const sql = db();
  const rows = base
    ? await sql`update sync_files set data = decode(${data}, 'base64'), hash = ${hash}, size = ${buf.length}, deleted = false,
          version = nextval('sync_version_seq'), updated_at = now()
        where vault_id = ${vault} and path = ${path} and hash = ${base} and not deleted
        returning version::text as version`
    : await sql`insert into sync_files (vault_id, path, data, hash, size) values (${vault}, ${path}, decode(${data}, 'base64'), ${hash}, ${buf.length})
        on conflict (vault_id, path) do update set data = excluded.data, hash = excluded.hash, size = excluded.size, deleted = false,
          version = nextval('sync_version_seq'), updated_at = now()
        where sync_files.deleted
        returning version::text as version`;
  if (!rows.length) return json({ ok: false, current: await current(vault, path) }, { status: 409 });
  return json({ ok: true, version: Number(rows[0]!.version) });
});

export const DELETE = handler(async (req) => {
  const { vault, path, url } = await target(req);
  const base = url.searchParams.get("base") ?? "";
  const rows = await db()`update sync_files set deleted = true, data = ''::bytea, size = 0, version = nextval('sync_version_seq'), updated_at = now()
    where vault_id = ${vault} and path = ${path} and hash = ${base} and not deleted returning version::text as version`;
  if (!rows.length) return json({ ok: false, current: await current(vault, path) }, { status: 409 });
  return json({ ok: true, version: Number(rows[0]!.version) });
});
