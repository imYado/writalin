import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, keyHint } from "./secrets.js";

describe("API key encryption", () => {
  const prev = process.env.AI_KEY_ENCRYPTION_SECRET;
  beforeEach(() => {
    process.env.AI_KEY_ENCRYPTION_SECRET = "test-secret-that-is-long-enough-1234567890";
  });
  afterEach(() => {
    process.env.AI_KEY_ENCRYPTION_SECRET = prev;
  });

  it("round-trips and never stores the key in the clear", () => {
    const blob = encryptSecret("sk-ant-abcdefghijklmnopqrstuvwxyz", "user-1");
    expect(blob.startsWith("v1.")).toBe(true);
    expect(blob).not.toContain("sk-ant");
    expect(decryptSecret(blob, "user-1")).toBe("sk-ant-abcdefghijklmnopqrstuvwxyz");
    expect(encryptSecret("same", "u")).not.toBe(encryptSecret("same", "u"));
  });

  it("won't decrypt for another account or a tampered blob", () => {
    const blob = encryptSecret("sk-ant-secret-value-123456789", "user-1");
    expect(() => decryptSecret(blob, "user-2")).toThrow();
    const parts = blob.split(".");
    parts[3] = parts[3]!.slice(0, -2) + (parts[3]!.endsWith("A") ? "BB" : "AA");
    expect(() => decryptSecret(parts.join("."), "user-1")).toThrow();
  });

  it("refuses to run without a strong server secret", () => {
    process.env.AI_KEY_ENCRYPTION_SECRET = "short";
    expect(() => encryptSecret("x", "u")).toThrow(/isn't set up/);
  });

  it("only shows the last four characters", () => {
    expect(keyHint("sk-ant-1234567890abcd")).toBe("abcd");
  });
});
