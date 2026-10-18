import { createHash, randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual } from "node:crypto";

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 } as const;

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password.normalize("NFKC"), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

/** `scrypt$N$r$p$salt$hash`, so parameters can be raised later without breaking old hashes. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, , , , saltB64, keyB64] = stored.split("$");
  if (alg !== "scrypt" || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const key = await scrypt(password, Buffer.from(saltB64, "base64"));
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Six-digit code, uniformly random. */
export function randomCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}
