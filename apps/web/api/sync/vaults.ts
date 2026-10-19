import { db } from "../_lib/db.js";
import { handler, json, readJson, HttpError } from "../_lib/http.js";
import { requireUser } from "../_lib/auth.js";
import { requireVault } from "../_lib/vaults.js";

/** How many synced vaults the list shows; older empty ones are cleaned up. */
const KEEP = 3;

/**
 * The signed-in user's synced vaults, most recently synced first. Old copies
 * with no notes in them (left by "Sync this vault" pressed again) are deleted
 * once they're past the newest few and more than an hour old.
 */
export const GET = handler(async (req) => {
  const user = await requireUser(req);
  const list = async () => db()`select v.id, v.name, v.created_at,
      (select count(*)::int from sync_files f where f.vault_id = v.id and not f.deleted) as files,
      greatest(v.created_at, (select max(f.updated_at) from sync_files f where f.vault_id = v.id)) as last_sync
    from sync_vaults v where v.user_id = ${user.id} order by last_sync desc`;
  let rows = await list();
  const stale = rows.slice(KEEP).filter((r) => r.files === 0 && Date.now() - new Date(r.created_at as string).getTime() > 3_600_000).map((r) => r.id as string);
  if (stale.length) {
    await db()`delete from sync_vaults where user_id = ${user.id} and id = any(${stale}::uuid[])`;
    rows = await list();
  }
  return json({ vaults: rows.map((r) => ({ id: r.id, name: r.name, files: r.files, lastSync: r.last_sync })) });
});

export const POST = handler(async (req) => {
  const user = await requireUser(req);
  const { name } = await readJson<{ name?: string }>(req);
  const n = String(name ?? "").trim().slice(0, 120);
  if (!n) throw new HttpError(400, "Give the vault a name.");
  const rows = await db()`insert into sync_vaults (user_id, name) values (${user.id}, ${n}) returning id, name, created_at`;
  return json({ vault: { ...rows[0], files: 0, lastSync: rows[0]!.created_at } });
});

/** Delete one synced copy and everything in it (only from the server; this computer keeps its notes). */
export const DELETE = handler(async (req) => {
  const user = await requireUser(req);
  const id = await requireVault(user, new URL(req.url).searchParams.get("id"));
  await db()`delete from sync_vaults where id = ${id} and user_id = ${user.id}`;
  return json({ ok: true });
});
