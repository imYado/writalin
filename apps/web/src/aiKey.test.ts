import { describe, expect, it } from "vitest";
import { detectProvider } from "./aiKey";

describe("detectProvider", () => {
  it("recognises each service's key shape", () => {
    expect(detectProvider("sk-ant-api03-abcdefghijklmnopqrstuvwxyz")).toBe("anthropic");
    expect(detectProvider(" gsk_abcdefghijklmnopqrstuvwxyz0123456789 ")).toBe("groq");
    expect(detectProvider("AIzaSyA1234567890abcdefghijklmnopqrstu")).toBe("gemini");
    expect(detectProvider("xai-abcdefghijklmnopqrstuvwxyz")).toBe("xai");
    expect(detectProvider("sk-or-v1-0123456789abcdef")).toBe("openrouter");
    expect(detectProvider("sk-0123456789abcdef0123456789abcdef")).toBe("deepseek");
    expect(detectProvider("sk-proj-AbCdEf0123456789_xyz")).toBe("openai");
    expect(detectProvider("AbCdEfGhIjKlMnOpQrStUvWxYz012345")).toBe("mistral");
  });

  it("returns null when it can't tell", () => {
    expect(detectProvider("")).toBeNull();
    expect(detectProvider("hello world")).toBeNull();
  });
});
