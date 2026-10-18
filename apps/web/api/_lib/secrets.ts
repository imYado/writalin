import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { HttpError } from "./http.js";

/**
 * Encryption for API keys people save to their account. AES-256-GCM with a
 * key derived (HKDF-SHA256) from AI_KEY_ENCRYPTION_SECRET, which lives only in
 * the server environment. The user id is bound in as associated data, so a
 * ciphertext copied onto another account won't decrypt.
 *
 * Format: `v1.<iv>.<tag>.<ciphertext>`, each part base64url.
 */
function key(): Buffer {
  const secret = process.env.AI_KEY_ENCRYPTION_SECRET ?? "";
  if (secret.length < 32) throw new HttpError(503, "Saving your own key isn't set up on this server yet.", "no_encryption_secret");
  return Buffer.from(hkdfSync("sha256", secret, "writalin", "ai-key-v1", 32));
}

export function encryptSecret(plain: string, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptSecret(blob: string, aad: string): string {
  const [v, iv, tag, ct] = blob.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Unknown secret format");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

/** What the browser is allowed to see of a key. */
export function keyHint(apiKey: string): string {
  return apiKey.slice(-4);
}
