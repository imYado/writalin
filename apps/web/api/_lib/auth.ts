import { db } from "./db.js";
import { HttpError } from "./http.js";
import { randomToken, sha256 } from "./crypto.js";

export const SESSION_COOKIE = "writalin_session";
const SESSION_DAYS = 30;

export interface User {
  id: string;
  email: string;
  hasPassword: boolean;
}

export function normalizeEmail(raw: unknown): string {
  const email = String(raw ?? "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Enter a valid email address.");
  return email;
}

export function validatePassword(raw: unknown): string {
  const p = String(raw ?? "");
  if (p.length < 8) throw new HttpError(400, "Use at least 8 characters.");
  if (p.length > 200) throw new HttpError(400, "That password is too long.");
  return p;
}

function cookie(value: string, maxAge: number): string {
  const secure = process.env.VERCEL_ENV ? "; Secure" : "";
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export async function createSession(userId: string, req: Request): Promise<string> {
  const token = randomToken();
  await db()`insert into sessions (user_id, token_hash, user_agent, expires_at)
    values (${userId}, ${sha256(token)}, ${req.headers.get("user-agent")?.slice(0, 300) ?? null}, now() + ${`${SESSION_DAYS} days`}::interval)`;
  return cookie(token, SESSION_DAYS * 86400);
}

export function clearSessionCookie(): string {
  return cookie("", 0);
}

function readToken(req: Request): string | null {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === SESSION_COOKIE) return v.join("=") || null;
  }
  // The Chrome extension sends the token as a bearer header.
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

export async function currentUser(req: Request): Promise<User | null> {
  const token = readToken(req);
  if (!token) return null;
  const rows = await db()`
    update sessions s set last_seen_at = now()
    from users u
    where s.token_hash = ${sha256(token)} and s.expires_at > now() and u.id = s.user_id
    returning u.id, u.email, (u.password_hash is not null) as has_password`;
  const r = rows[0];
  return r ? { id: r.id as string, email: r.email as string, hasPassword: Boolean(r.has_password) } : null;
}

export async function requireUser(req: Request): Promise<User> {
  const u = await currentUser(req);
  if (!u) throw new HttpError(401, "Please sign in.", "unauthorized");
  return u;
}

export async function endSession(req: Request): Promise<void> {
  const token = readToken(req);
  if (token) await db()`delete from sessions where token_hash = ${sha256(token)}`;
}
