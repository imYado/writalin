import { db } from "../_lib/db.js";
import { handler, json, readJson, HttpError, clientIp } from "../_lib/http.js";
import { normalizeEmail } from "../_lib/auth.js";
import { randomCode, sha256 } from "../_lib/crypto.js";
import { sendLoginCode } from "../_lib/email.js";

const CODES_PER_HOUR = 5;
const CODES_PER_IP_PER_HOUR = 30;

/** Step 1 of sign-in/sign-up: email a 6-digit code. */
export const POST = handler(async (req) => {
  const body = await readJson<{ email?: string }>(req);
  const email = normalizeEmail(body.email);
  const sql = db();
  const ip = clientIp(req);
  const [counts] = (await sql`select
      count(*) filter (where email = ${email})::int as by_email,
      count(*) filter (where ip = ${ip})::int as by_ip
    from login_codes where purpose = 'login' and created_at > now() - interval '1 hour'`) as [{ by_email: number; by_ip: number }];
  if (counts.by_email >= CODES_PER_HOUR || counts.by_ip >= CODES_PER_IP_PER_HOUR) {
    throw new HttpError(429, "Too many codes requested. Try again in a little while.");
  }
  const code = randomCode();
  // Older unused codes stop working once a new one is sent.
  await sql`update login_codes set used_at = now() where email = ${email} and purpose = 'login' and used_at is null`;
  await sql`insert into login_codes (email, ip, code_hash, expires_at) values (${email}, ${ip}, ${sha256(`${email}:${code}`)}, now() + interval '10 minutes')`;
  await sendLoginCode(email, code);
  return json({ ok: true });
});
