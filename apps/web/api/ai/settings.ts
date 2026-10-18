import { handler, HttpError, json, readJson } from "../_lib/http.js";
import { requireUser } from "../_lib/auth.js";
import { db } from "../_lib/db.js";
import { encryptSecret, keyHint } from "../_lib/secrets.js";
import { aiAccount, builtinAvailable, dailyLimit, usedToday, verifyKey, type AiMode } from "../_lib/ai.js";

async function state(userId: string) {
  const acct = await aiAccount(userId);
  return {
    ...acct,
    builtinAvailable: builtinAvailable(),
    limit: dailyLimit(acct.mode),
    usedToday: await usedToday(userId),
  };
}

/** What the Settings screen shows. Never includes the key itself. */
export const GET = handler(async (req) => {
  const user = await requireUser(req);
  return json(await state(user.id));
});

/** Switch mode and/or save your own key (encrypted before it's stored). */
export const POST = handler(async (req) => {
  const user = await requireUser(req);
  const body = await readJson<{ mode?: AiMode; apiKey?: string }>(req, 8 * 1024);
  if (body.mode != null && body.mode !== "builtin" && body.mode !== "own") throw new HttpError(400, "Unknown AI mode.");

  if (body.apiKey != null) {
    const apiKey = String(body.apiKey).trim();
    if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(apiKey)) throw new HttpError(400, "That doesn't look like an Anthropic API key (it starts with sk-ant-).");
    await verifyKey(apiKey);
    const ciphertext = encryptSecret(apiKey, user.id);
    await db()`insert into ai_settings (user_id, mode, key_ciphertext, key_hint, updated_at)
      values (${user.id}, 'own', ${ciphertext}, ${keyHint(apiKey)}, now())
      on conflict (user_id) do update set mode = 'own', key_ciphertext = excluded.key_ciphertext, key_hint = excluded.key_hint, updated_at = now()`;
  } else if (body.mode) {
    await db()`insert into ai_settings (user_id, mode, updated_at) values (${user.id}, ${body.mode}, now())
      on conflict (user_id) do update set mode = excluded.mode, updated_at = now()`;
  }
  return json(await state(user.id));
});

/** Forget your saved key and go back to the built-in AI. */
export const DELETE = handler(async (req) => {
  const user = await requireUser(req);
  await db()`update ai_settings set key_ciphertext = null, key_hint = null, mode = 'builtin', updated_at = now() where user_id = ${user.id}`;
  return json(await state(user.id));
});
