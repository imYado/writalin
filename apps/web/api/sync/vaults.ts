import { db } from "../_lib/db.js";
import { handler, json, readJson, HttpError } from "../_lib/http.js";
import { requireUser } from "../_lib/auth.js";

/** The signed-in user's synced vaults. */
export const GET = handler(async (req) => {
  const user = await requireUser(req);
  const rows = await db()`select v.id, v.name, v.created_at,
      (select count(*)::int from sync_files f where f.vault_id = v.id and not f.deleted) as files
    from sync_vaults v where v.user_id = ${user.id} order by v.created_at`;
  return json({ vaults: rows });
});

export const POST = handler(async (req) => {
  const user = await requireUser(req);
  const { name } = await readJson<{ name?: string }>(req);
  const n = String(name ?? "").trim().slice(0, 120);
  if (!n) throw new HttpError(400, "Give the vault a name.");
  const rows = await db()`insert into sync_vaults (user_id, name) values (${user.id}, ${n}) returning id, name, created_at`;
  return json({ vault: rows[0] });
});
