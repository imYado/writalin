import { afterEach, describe, expect, it, vi } from "vitest";
import { chat, checkCustomBaseUrl, checkKeyShape, listModels } from "./providers.js";

const target = { baseUrl: "https://api.example.com/v1", apiKey: "key-12345678", model: "m1", label: "Example" };

describe("AI providers", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("only allows public https addresses for a custom service", () => {
    expect(checkCustomBaseUrl("https://api.example.com/v1/")).toBe("https://api.example.com/v1");
    for (const bad of ["http://api.example.com", "https://localhost:8080", "https://10.0.0.1/v1", "https://[::1]/", "https://intranet", "https://u:p@api.example.com", "nope"]) {
      expect(() => checkCustomBaseUrl(bad), bad).toThrow();
    }
  });

  it("checks key shape per service", () => {
    expect(() => checkKeyShape("anthropic", "AIza-not-claude-key-123")).toThrow(/sk-ant-/);
    expect(() => checkKeyShape("gemini", "AIzaSyExampleExampleExample")).not.toThrow();
    expect(() => checkKeyShape("deepseek", "has space in it")).toThrow();
  });

  it("sends an OpenAI-style chat request and reads the answer", async () => {
    const fetchMock = vi.fn(async () => Response.json({ model: "m1-2026", choices: [{ message: { content: " Hello " } }] }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(chat(target, "sys", "user text", "own")).resolves.toEqual({ text: "Hello", model: "m1-2026" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer key-12345678");
    expect(JSON.parse(init.body as string).messages).toEqual([{ role: "system", content: "sys" }, { role: "user", content: "user text" }]);
  });

  it("turns service errors into plain messages", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
    await expect(chat(target, "s", "u", "own")).rejects.toThrow(/rejected your API key/);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    await expect(chat(target, "s", "u", "own")).rejects.toThrow(/doesn't know the model/);
  });

  it("asks for a shorter answer when the credits don't cover a long one", async () => {
    const low = () => new Response(JSON.stringify({ error: { message: "This request requires more credits, or fewer max_tokens. You requested up to 4000 tokens, but can only afford 1815." } }), { status: 402 });
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => (JSON.parse(init.body as string).max_tokens > 1815 ? low() : Response.json({ choices: [{ message: { content: "Short answer" } }] })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(chat(target, "s", "u", "own")).resolves.toMatchObject({ text: "Short answer" });
    expect(fetchMock.mock.calls.map((c) => JSON.parse(c[1].body as string).max_tokens)).toEqual([4000, 1633]);
    // Nothing left: say so plainly instead of "having trouble".
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "can only afford 12" } }), { status: 402 })));
    await expect(chat(target, "s", "u", "own")).rejects.toThrow(/out of credits/);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Payment required", { status: 402 })));
    await expect(chat(target, "s", "u", "own")).rejects.toThrow(/out of credits/);
  });

  it("falls back to another free model when a free OpenRouter model is busy or gone", async () => {
    const or = { ...target, baseUrl: "https://openrouter.ai/api/v1", model: "vendor/some-model:free" };
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => (JSON.parse(init.body as string).model === "openrouter/free" ? Response.json({ choices: [{ message: { content: "From another free model" } }] }) : new Response("busy", { status: 429 })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(chat(or, "s", "u", "own")).resolves.toMatchObject({ text: "From another free model" });
    expect(fetchMock.mock.calls.map((c) => JSON.parse(c[1].body as string).model)).toEqual(["vendor/some-model:free", "openrouter/free"]);
    // A paid model, or another service, is not rerouted.
    const paid = vi.fn(async () => new Response("busy", { status: 429 }));
    vi.stubGlobal("fetch", paid);
    await expect(chat({ ...or, model: "vendor/paid" }, "s", "u", "own")).rejects.toThrow(/limit/);
    expect(paid).toHaveBeenCalledTimes(1);
  });

  it("lists models, without the Gemini models/ prefix", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [{ id: "models/gemini-2.5-flash" }, { id: "x" }] })));
    await expect(listModels(target)).resolves.toEqual(["gemini-2.5-flash", "x"]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 403 })));
    await expect(listModels(target)).rejects.toThrow(/didn't accept that key/);
  });

  it("streams an answer piece by piece", async () => {
    const sse = 'data: {"model":"m1-x","choices":[{"delta":{"content":"Hel"}}]}\n\ndata: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DONE]\n\n';
    const bytes = new TextEncoder().encode(sse);
    // Split mid-line to check pieces are joined across reads.
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes.slice(0, 30)); c.enqueue(bytes.slice(30)); c.close(); } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200 })));
    const pieces: string[] = [];
    const out = await chat(target, "sys", "hi", "own", (p) => pieces.push(p));
    expect(pieces).toEqual(["Hel", "lo"]);
    expect(out).toEqual({ text: "Hello", model: "m1-x" });
  });
});
