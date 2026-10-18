import { db } from "../_lib/db.js";
import { handler, json, readJson, HttpError } from "../_lib/http.js";
import { createSession, normalizeEmail } from "../_lib/auth.js";
import { verifyPassword } from "../_lib/crypto.js";

const FAILS_PER_15_MIN = 10;

/** Returning users: email + password. */
export const POST = handler(async (req) => {
  const body = await readJson<{ email?: string; password?: string }>(req);
  const email = normalizeEmail(body.email);
  const password = String(body.password ?? "");
  const sql = db();
  const [{ n }] = (await sql`select count(*)::int as n from login_codes where email = ${email} and purpose = 'failed-password' and created_at > now() - interval '15 minutes'`) as [{ n: number }];
  if (n >= FAILS_PER_15_MIN) throw new HttpError(429, "Too many attempts. Sign in with an email code instead, or wait a few minutes.");
  const rows = await sql`select id, email, password_hash from users where email = ${email}`;
  const user = rows[0];
  const ok = user?.password_hash ? await verifyPassword(password, user.password_hash as string) : false;
  if (!user || !ok) {
    // Failed attempts are recorded in login_codes so they share its cleanup and indexes.
    await sql`insert into login_codes (email, code_hash, purpose, expires_at, used_at) values (${email}, '', 'failed-password', now(), now())`;
    throw new HttpError(400, user && !user.password_hash ? "This account doesn't have a password yet. Sign in with an email code." : "Email or password is incorrect.");
  }
  const cookie = await createSession(user.id as string, req);
  return json({ user: { id: user.id, email: user.email, hasPassword: true } }, { headers: { "set-cookie": cookie } });
});
