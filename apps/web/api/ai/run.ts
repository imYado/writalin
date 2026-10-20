import { handler, HttpError, json, readJson } from "../_lib/http.js";
import { requireUser } from "../_lib/auth.js";
import { AI_TOOLS, MAX_INPUT_CHARS, resolveKey, runTool, takeQuota, type AiTool, type ToolOptions } from "../_lib/ai.js";

/** Run one study tool on text the person chose. Signed-in only; keys stay on the server. */
export const POST = handler(async (req) => {
  const user = await requireUser(req);
  const body = await readJson<{ tool?: string; text?: string; question?: string; quizKind?: string; count?: number; extra?: string; stream?: boolean }>(req, 300 * 1024);
  const tool = body.tool as AiTool;
  if (!tool || !Object.hasOwn(AI_TOOLS, tool)) throw new HttpError(400, "Unknown AI tool.");
  const text = String(body.text ?? "").trim();
  // A plain question needs no note; every other tool works on some text.
  if (!text && tool !== "ask" && tool !== "chat") throw new HttpError(400, "There's no text to work with yet.");
  if (text.length > MAX_INPUT_CHARS) throw new HttpError(413, "That's too much text at once. Select a smaller part of the note.");
  const asking = tool === "ask" || tool === "chat";
  const question = asking ? String(body.question ?? "").trim().slice(0, 2000) : undefined;
  if (asking && !question) throw new HttpError(400, "Type a question first.");

  const opts: ToolOptions = {
    quizKind: body.quizKind === "written" ? "written" : "choice",
    count: Math.min(20, Math.max(3, Math.round(Number(body.count) || 5))),
    extra: String(body.extra ?? "").trim().slice(0, 1000) || undefined,
  };

  const target = await resolveKey(user.id);
  await takeQuota(user.id, target.mode);
  const run = (onDelta?: (piece: string) => void) => runTool(target, tool === "ask" && !text ? "chat" : tool, text, question, opts, onDelta);
  if (!body.stream) return json(await run());

  // Streamed: one JSON object per line. `{ delta }` as the answer is written,
  // then `{ done, text, model }` with the tidied whole, or `{ error, code }`.
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
      try {
        const out = await run((delta) => send({ delta }));
        send({ done: true, ...out });
      } catch (e) {
        if (!(e instanceof HttpError)) console.error(e);
        send(e instanceof HttpError ? { error: e.message, code: e.code } : { error: "Something went wrong on our side. Please try again." });
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
});
