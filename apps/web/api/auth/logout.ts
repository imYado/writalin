import { handler, json } from "../_lib/http.js";
import { clearSessionCookie, endSession } from "../_lib/auth.js";

export const POST = handler(async (req) => {
  await endSession(req);
  return json({ ok: true }, { headers: { "set-cookie": clearSessionCookie() } });
});
