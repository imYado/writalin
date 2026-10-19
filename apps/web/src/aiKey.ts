/**
 * Guess the AI service from the shape of a pasted key, so people don't have to
 * know which one they have. Runs in the browser only; the key itself is still
 * checked with the service by the server before it's saved.
 */
export function detectProvider(raw: string): string | null {
  const key = raw.trim();
  if (key.startsWith("sk-ant-")) return "anthropic";
  if (key.startsWith("gsk_")) return "groq";
  if (key.startsWith("AIza")) return "gemini";
  if (key.startsWith("xai-")) return "xai";
  if (key.startsWith("sk-or-")) return "openrouter";
  // DeepSeek keys are sk- and 32 hex characters; OpenAI's are longer.
  if (/^sk-[0-9a-f]{32}$/.test(key)) return "deepseek";
  if (key.startsWith("sk-")) return "openai";
  // Mistral keys are 32 letters and digits with no prefix.
  if (/^[A-Za-z0-9]{32}$/.test(key)) return "mistral";
  return null;
}
