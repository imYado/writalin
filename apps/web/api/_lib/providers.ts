import { HttpError } from "./http.js";

/**
 * AI services someone can bring their own key for. Everything except Anthropic
 * speaks the OpenAI-style chat completions API, so one client covers them all.
 * Default models are a starting point; people can type any model their key can use.
 */
export const PROVIDERS = {
  anthropic: { label: "Anthropic (Claude)", baseUrl: "", defaultModel: "claude-opus-5-5", keyUrl: "https://console.anthropic.com/settings/keys" },
  openai: { label: "OpenAI (ChatGPT)", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini", keyUrl: "https://platform.openai.com/api-keys" },
  gemini: { label: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", defaultModel: "gemini-2.5-flash", keyUrl: "https://aistudio.google.com/apikey" },
  xai: { label: "xAI (Grok)", baseUrl: "https://api.x.ai/v1", defaultModel: "grok-3-mini", keyUrl: "https://console.x.ai" },
  groq: { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", defaultModel: "llama-3.3-70b-versatile", keyUrl: "https://console.groq.com/keys" },
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", defaultModel: "deepseek-chat", keyUrl: "https://platform.deepseek.com/api_keys" },
  mistral: { label: "Mistral", baseUrl: "https://api.mistral.ai/v1", defaultModel: "mistral-small-latest", keyUrl: "https://console.mistral.ai/api-keys" },
  openrouter: { label: "OpenRouter (many models)", baseUrl: "https://openrouter.ai/api/v1", defaultModel: "openrouter/auto", keyUrl: "https://openrouter.ai/keys" },
  custom: { label: "Other (OpenAI-compatible)", baseUrl: "", defaultModel: "", keyUrl: "" },
} as const;

export type ProviderId = keyof typeof PROVIDERS;

export function isProvider(id: unknown): id is ProviderId {
  return typeof id === "string" && Object.hasOwn(PROVIDERS, id);
}

/** What the Settings screen needs to draw the provider picker. */
export function providerList() {
  return Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, defaultModel: p.defaultModel, keyUrl: p.keyUrl }));
}

/**
 * A custom endpoint is fetched by our server, so only public https hosts are
 * allowed: no localhost, private networks or bare IPs.
 */
export function checkCustomBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new HttpError(400, "That address isn't a valid URL.");
  }
  const host = url.hostname.toLowerCase();
  const privateHost =
    host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") ||
    /^[\d.]+$/.test(host) || host.includes(":") || !host.includes(".");
  if (url.protocol !== "https:" || privateHost || url.username || url.password) {
    throw new HttpError(400, "Use a public https address, like https://api.example.com/v1.");
  }
  return url.toString().replace(/\/+$/, "");
}

export function checkKeyShape(provider: ProviderId, key: string): void {
  if (provider === "anthropic" && !/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) {
    throw new HttpError(400, "That doesn't look like an Anthropic API key (it starts with sk-ant-).");
  }
  if (key.length < 8 || key.length > 400 || /\s/.test(key)) throw new HttpError(400, "That doesn't look like an API key. Check that you copied all of it.");
}

interface ChatTarget {
  baseUrl: string;
  apiKey: string;
  model: string;
  label: string;
}

/** The models a key can use, or null when the service doesn't list them. Throws on a rejected key. */
export async function listModels(t: Omit<ChatTarget, "model">): Promise<string[] | null> {
  let res: Response;
  try {
    res = await fetch(`${t.baseUrl}/models`, { headers: { authorization: `Bearer ${t.apiKey}` }, signal: AbortSignal.timeout(15_000), redirect: "error" });
  } catch {
    throw new HttpError(502, `Couldn't reach ${t.label} to check the key. Try again in a moment.`);
  }
  if (res.status === 401 || res.status === 403) throw new HttpError(400, `${t.label} didn't accept that key. Check that you copied all of it.`, "ai_bad_key");
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as { data?: { id?: string }[] } | null;
  const ids = body?.data?.map((m) => String(m.id ?? "").replace(/^models\//, "")).filter(Boolean);
  return ids?.length ? ids : null;
}

/** One OpenAI-style chat completion. */
export async function chat(t: ChatTarget, system: string, user: string, mode: "own" | "builtin"): Promise<{ text: string; model: string }> {
  let res: Response;
  try {
    res = await fetch(`${t.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${t.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: t.model, max_tokens: 4000, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
      signal: AbortSignal.timeout(110_000),
      redirect: "error",
    });
  } catch {
    throw new HttpError(502, `Couldn't reach ${t.label}. Try again in a moment.`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new HttpError(400, `${t.label} rejected your API key. Update it in Settings.`, mode === "own" ? "ai_bad_key" : undefined);
  }
  if (res.status === 404) throw new HttpError(400, `${t.label} doesn't know the model “${t.model}”. Pick another model in Settings.`, "ai_bad_model");
  if (res.status === 429) throw new HttpError(429, `${t.label} says you've hit a rate or credit limit. Wait a minute, or check your account there.`);
  if (!res.ok) {
    console.error(`${t.label} error`, res.status, (await res.text().catch(() => "")).slice(0, 500));
    throw new HttpError(502, `${t.label} is having trouble right now. Try again in a moment.`);
  }
  const body = (await res.json().catch(() => null)) as { model?: string; choices?: { message?: { content?: string | null } }[] } | null;
  const out = body?.choices?.[0]?.message?.content?.trim();
  if (!out) throw new HttpError(502, "The AI returned an empty answer. Try again.");
  return { text: out, model: body?.model ?? t.model };
}
