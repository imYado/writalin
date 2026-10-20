import { handler, HttpError, json, readJson } from "../_lib/http.js";
import { requireUser } from "../_lib/auth.js";
import { AI_TOOLS, MAX_INPUT_CHARS, resolveKey, runTool, takeQuota, type AiTool, type ToolOptions } from "../_lib/ai.js";

/** Run one study tool on text the person chose. Signed-in only; keys stay on the server. */
export const POST = handler(async (req) => {
  const user = await requireUser(req);
  const body = await readJson<{ tool?: string; text?: string; question?: string; quizKind?: string; count?: number; extra?: string; stream?: boolean; thread?: unknown }>(req, 400 * 1024);
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
    thread: readThread(body.thread),
  };

  const target = await resolveKey(user.id);
  await takeQuota(user.id, target.mode);
  const run = (onDelta?: (piece: string) => void, signal?: AbortSignal) => runTool(target, tool === "ask" && !text ? "chat" : tool, text, question, opts, onDelta, signal);
  if (!body.stream) return json(await run());

  // Streamed: one JSON object per line. `{ delta }` as the answer is written,
  // then `{ done, text, model }` with the tidied whole, or `{ error, code }`.
  const enc = new TextEncoder();
  // Stop in the app cancels the stream; that also stops the AI writing the rest.
  const stopped = new AbortController();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Once the person presses Stop the stream is cancelled; the rest of the answer is dropped.
      const send = (obj: unknown) => {
        try {
          controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
        } catch {
          /* cancelled */
        }
      };
      try {
        const out = await run((delta) => send({ delta }), stopped.signal);
        send({ done: true, ...out });
      } catch (e) {
        if (stopped.signal.aborted) return;
        if (!(e instanceof HttpError)) console.error(e);
        send(e instanceof HttpError ? { error: e.message, code: e.code } : { error: "Something went wrong on our side. Please try again." });
      }
      try {
        controller.close();
      } catch {
        /* cancelled */
      }
    },
    cancel() {
      stopped.abort();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
});

/** Follow-ups: at most 8 earlier turns, each answer and question trimmed to a sane size. */
function readThread(raw: unknown): ToolOptions["thread"] {
  if (!Array.isArray(raw)) return undefined;
  const turns = raw.slice(-8).flatMap((t: unknown) => {
    const { answer, followUp } = (t ?? {}) as { answer?: unknown; followUp?: unknown };
    const a = String(answer ?? "").trim().slice(0, 12_000);
    const q = String(followUp ?? "").trim().slice(0, 2000);
    return a && q ? [{ answer: a, followUp: q }] : [];
  });
  return turns.length ? turns : undefined;
}
