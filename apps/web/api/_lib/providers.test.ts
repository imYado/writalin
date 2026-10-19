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

  it("lists models, without the Gemini models/ prefix", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [{ id: "models/gemini-2.5-flash" }, { id: "x" }] })));
    await expect(listModels(target)).resolves.toEqual(["gemini-2.5-flash", "x"]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 403 })));
    await expect(listModels(target)).rejects.toThrow(/didn't accept that key/);
  });
});
