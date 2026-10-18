import { db } from "./db.js";
import { HttpError } from "./http.js";
import type { User } from "./auth.js";

export async function requireVault(user: User, vaultId: string | null): Promise<string> {
  if (!vaultId || !/^[0-9a-f-]{36}$/i.test(vaultId)) throw new HttpError(400, "Missing vault.");
  const rows = await db()`select id from sync_vaults where id = ${vaultId} and user_id = ${user.id}`;
  if (!rows.length) throw new HttpError(404, "Vault not found.");
  return vaultId;
}

export function cleanPath(raw: string | null): string {
  const p = String(raw ?? "");
  if (!p || p.length > 1024 || p.startsWith("/") || p.split("/").some((s) => s === ".." || s === "" || s === ".")) {
    throw new HttpError(400, "Invalid file path.");
  }
  return p;
}
