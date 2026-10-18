import { handler, HttpError, json, readJson } from "../_lib/http.js";
import { requireUser } from "../_lib/auth.js";
import { AI_TOOLS, MAX_INPUT_CHARS, resolveKey, runTool, takeQuota, type AiTool } from "../_lib/ai.js";

/** Run one study tool on text the person chose. Signed-in only; keys stay on the server. */
export const POST = handler(async (req) => {
  const user = await requireUser(req);
  const body = await readJson<{ tool?: string; text?: string; question?: string }>(req, 300 * 1024);
  const tool = body.tool as AiTool;
  if (!tool || !Object.hasOwn(AI_TOOLS, tool)) throw new HttpError(400, "Unknown AI tool.");
  const text = String(body.text ?? "").trim();
  if (!text) throw new HttpError(400, "There's no text to work with yet.");
  if (text.length > MAX_INPUT_CHARS) throw new HttpError(413, "That's too much text at once. Select a smaller part of the note.");
  const question = tool === "ask" ? String(body.question ?? "").trim().slice(0, 2000) : undefined;
  if (tool === "ask" && !question) throw new HttpError(400, "Type a question first.");

  const { apiKey, mode } = await resolveKey(user.id);
  await takeQuota(user.id, mode);
  const out = await runTool(apiKey, mode, tool, text, question);
  return json(out);
});
