export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export async function readJson<T>(req: Request, maxBytes = 64 * 1024): Promise<T> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > maxBytes) throw new HttpError(413, "Request too large.");
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, "Request too large.");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, "Expected JSON.");
  }
}

/** Wrap a handler so thrown HttpErrors become JSON responses and anything else a 500. */
export function handler(fn: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    try {
      // Cookie-authenticated endpoints only accept same-origin writes.
      if (req.method !== "GET" && req.method !== "HEAD") assertSameOrigin(req);
      return await fn(req);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, code: e.code }, { status: e.status });
      console.error(e);
      return json({ error: "Something went wrong on our side. Please try again." }, { status: 500 });
    }
  };
}

function assertSameOrigin(req: Request): void {
  const origin = req.headers.get("origin");
  if (!origin) return; // Non-browser clients (and same-origin GET-like fetches in some browsers).
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const allowed = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (host && new URL(origin).host === host) return;
  if (allowed.includes(origin)) return;
  throw new HttpError(403, "Cross-site request blocked.");
}

export function clientIp(req: Request): string {
  return req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}
