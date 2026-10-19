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
  // A plain question needs no note; every other tool works on some text.
  if (!text && tool !== "ask" && tool !== "chat") throw new HttpError(400, "There's no text to work with yet.");
  if (text.length > MAX_INPUT_CHARS) throw new HttpError(413, "That's too much text at once. Select a smaller part of the note.");
  const asking = tool === "ask" || tool === "chat";
  const question = asking ? String(body.question ?? "").trim().slice(0, 2000) : undefined;
  if (asking && !question) throw new HttpError(400, "Type a question first.");

  const target = await resolveKey(user.id);
  await takeQuota(user.id, target.mode);
  const out = await runTool(target, tool === "ask" && !text ? "chat" : tool, text, question);
  return json(out);
});
