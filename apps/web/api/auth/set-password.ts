import { db } from "../_lib/db.js";
import { handler, json, readJson } from "../_lib/http.js";
import { requireUser, validatePassword } from "../_lib/auth.js";
import { hashPassword } from "../_lib/crypto.js";

/** Step 3 (new accounts) or "change password": requires a session from the email code. */
export const POST = handler(async (req) => {
  const user = await requireUser(req);
  const { password } = await readJson<{ password?: string }>(req);
  const hash = await hashPassword(validatePassword(password));
  await db()`update users set password_hash = ${hash}, updated_at = now() where id = ${user.id}`;
  return json({ user: { ...user, hasPassword: true } });
});
