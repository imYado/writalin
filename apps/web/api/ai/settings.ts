import { handler, HttpError, json, readJson } from "../_lib/http.js";
import { requireUser } from "../_lib/auth.js";
import { db } from "../_lib/db.js";
import { encryptSecret, keyHint } from "../_lib/secrets.js";
import { aiAccount, builtinAvailable, dailyLimit, usedToday, verifyKey, type AiMode } from "../_lib/ai.js";
import { checkCustomBaseUrl, checkKeyShape, isProvider, PROVIDERS, providerList } from "../_lib/providers.js";

async function state(userId: string) {
  const acct = await aiAccount(userId);
  return {
    ...acct,
    builtinAvailable: builtinAvailable(),
    limit: dailyLimit(acct.mode),
    usedToday: await usedToday(userId),
    providers: providerList(),
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
  const body = await readJson<{ mode?: AiMode; apiKey?: string; provider?: string; model?: string; baseUrl?: string }>(req, 8 * 1024);
  if (body.mode != null && body.mode !== "builtin" && body.mode !== "own") throw new HttpError(400, "Unknown AI mode.");
  const model = body.model != null ? String(body.model).trim().slice(0, 200) || null : null;

  if (body.apiKey != null) {
    const provider = body.provider ?? "anthropic";
    if (!isProvider(provider)) throw new HttpError(400, "Unknown AI service.");
    const apiKey = String(body.apiKey).trim();
    checkKeyShape(provider, apiKey);
    const baseUrl = provider === "custom" ? checkCustomBaseUrl(String(body.baseUrl ?? "")) : PROVIDERS[provider].baseUrl;
    const savedModel = await verifyKey(provider, apiKey, model, baseUrl);
    const ciphertext = encryptSecret(apiKey, user.id);
    await db()`insert into ai_settings (user_id, mode, key_ciphertext, key_hint, provider, model, base_url, updated_at)
      values (${user.id}, 'own', ${ciphertext}, ${keyHint(apiKey)}, ${provider}, ${savedModel}, ${provider === "custom" ? baseUrl : null}, now())
      on conflict (user_id) do update set mode = 'own', key_ciphertext = excluded.key_ciphertext, key_hint = excluded.key_hint,
        provider = excluded.provider, model = excluded.model, base_url = excluded.base_url, updated_at = now()`;
  } else if (body.model != null) {
    // A new model for the key already saved; a wrong name shows up on the next request.
    await db()`update ai_settings set model = ${model}, updated_at = now() where user_id = ${user.id}`;
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
