import { db } from "../_lib/db.js";
import { handler, json, readJson, HttpError } from "../_lib/http.js";
import { createSession, normalizeEmail } from "../_lib/auth.js";
import { safeEqualHex, sha256 } from "../_lib/crypto.js";

const MAX_ATTEMPTS = 5;

/**
 * Step 2: check the code. Creates the account on first sign-in, then starts a
 * session. `needsPassword` tells the client to show "Create a password".
 */
export const POST = handler(async (req) => {
  const body = await readJson<{ email?: string; code?: string }>(req);
  const email = normalizeEmail(body.email);
  const code = String(body.code ?? "").replace(/\D/g, "");
  if (code.length !== 6) throw new HttpError(400, "Enter the 6-digit code from the email.");
  const sql = db();
  const rows = await sql`select id, code_hash, attempts from login_codes
    where email = ${email} and purpose = 'login' and used_at is null and expires_at > now()
    order by created_at desc limit 1`;
  const row = rows[0];
  if (!row) throw new HttpError(400, "That code has expired. Request a new one.", "expired");
  if ((row.attempts as number) >= MAX_ATTEMPTS) throw new HttpError(429, "Too many tries. Request a new code.", "locked");
  if (!safeEqualHex(sha256(`${email}:${code}`), row.code_hash as string)) {
    await sql`update login_codes set attempts = attempts + 1 where id = ${row.id}`;
    throw new HttpError(400, "That code doesn't match. Check the email and try again.", "mismatch");
  }
  await sql`update login_codes set used_at = now() where id = ${row.id}`;
  const users = await sql`insert into users (email) values (${email})
    on conflict (email) do update set updated_at = users.updated_at
    returning id, email, (password_hash is not null) as has_password`;
  const user = users[0]!;
  const cookie = await createSession(user.id as string, req);
  return json(
    { user: { id: user.id, email: user.email, hasPassword: user.has_password }, needsPassword: !user.has_password },
    { headers: { "set-cookie": cookie } },
  );
});
