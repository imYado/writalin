import { db } from "../_lib/db.js";
import { handler, json } from "../_lib/http.js";
import { requireUser } from "../_lib/auth.js";
import { requireVault } from "../_lib/vaults.js";

/** File metadata changed since a cursor (a version number). Contents are fetched separately. */
export const GET = handler(async (req) => {
  const user = await requireUser(req);
  const url = new URL(req.url);
  const vault = await requireVault(user, url.searchParams.get("vault"));
  const since = Math.max(0, Number(url.searchParams.get("since") ?? 0) || 0);
  const rows = await db()`select path, hash, deleted, version::text as version, size
    from sync_files where vault_id = ${vault} and version > ${since} order by version limit 5000`;
  const changes = rows.map((r) => ({ path: r.path, hash: r.hash, deleted: r.deleted, size: r.size, version: Number(r.version) }));
  const cursor = changes.length ? changes[changes.length - 1]!.version : since;
  return json({ changes, cursor, more: rows.length === 5000 });
});
