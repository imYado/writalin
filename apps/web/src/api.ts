import type { RemoteChange, SyncTransport, UploadResult } from "@writalin/vault";

export interface Account {
  id: string;
  email: string;
  hasPassword: boolean;
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/${path}`, { credentials: "same-origin", ...init });
  } catch {
    throw new ApiError(0, "You seem to be offline. Your notes are still saved on this computer.");
  }
  const type = res.headers.get("content-type") ?? "";
  const body = type.includes("json") ? ((await res.json()) as Record<string, unknown>) : null;
  if (!res.ok && res.status !== 409) throw new ApiError(res.status, String(body?.error ?? `Request failed (${res.status}).`), body?.code as string | undefined);
  return body as T;
}

const post = <T>(path: string, data: unknown) =>
  call<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });

export const auth = {
  me: () => call<{ user: Account | null }>("auth/me").then((r) => r.user).catch(() => null),
  requestCode: (email: string) => post<{ ok: true }>("auth/request-code", { email }),
  verifyCode: (email: string, code: string) => post<{ user: Account; needsPassword: boolean }>("auth/verify-code", { email, code }),
  setPassword: (password: string) => post<{ user: Account }>("auth/set-password", { password }),
  login: (email: string, password: string) => post<{ user: Account }>("auth/login", { email, password }),
  logout: () => post<{ ok: true }>("auth/logout", {}),
};

export type AiMode = "builtin" | "own";
export type AiTool = "explain" | "summarize" | "flashcards" | "quiz" | "steps" | "mainpoint" | "whereWasI" | "ask";

export interface AiState {
  mode: AiMode;
  hasOwnKey: boolean;
  /** Last 4 characters of the saved key. The key itself never comes back. */
  keyHint: string | null;
  builtinAvailable: boolean;
  limit: number;
  usedToday: number;
  /** The service the saved key belongs to, its model (null = the service's default) and, for "custom", its address. */
  provider: string;
  model: string | null;
  baseUrl: string | null;
  providers: AiProvider[];
}

export interface AiProvider {
  id: string;
  label: string;
  defaultModel: string;
  keyUrl: string;
}

const del = <T>(path: string) => call<T>(path, { method: "DELETE" });

export const aiApi = {
  state: () => call<AiState>("ai/settings"),
  setMode: (mode: AiMode) => post<AiState>("ai/settings", { mode }),
  saveKey: (key: { apiKey: string; provider: string; model?: string; baseUrl?: string }) => post<AiState>("ai/settings", key),
  setModel: (model: string) => post<AiState>("ai/settings", { model }),
  removeKey: () => del<AiState>("ai/settings"),
  run: (tool: AiTool, text: string, question?: string) => post<{ text: string; model: string }>("ai/run", { tool, text, question }),
};

export interface RemoteVault {
  id: string;
  name: string;
  files: number;
}

export const syncApi = {
  vaults: () => call<{ vaults: RemoteVault[] }>("sync/vaults").then((r) => r.vaults),
  createVault: (name: string) => post<{ vault: RemoteVault }>("sync/vaults", { name }).then((r) => r.vault),
};

/** SyncTransport over the /api/sync endpoints for one remote vault. */
export function httpTransport(vaultId: string): SyncTransport {
  const q = (path: string, extra: Record<string, string> = {}) => new URLSearchParams({ vault: vaultId, path, ...extra }).toString();
  return {
    async changes(since) {
      const all: RemoteChange[] = [];
      let cursor = since;
      for (;;) {
        const r = await call<{ changes: RemoteChange[]; cursor: number; more: boolean }>(`sync/changes?vault=${vaultId}&since=${cursor}`);
        all.push(...r.changes);
        cursor = r.cursor;
        if (!r.more) break;
      }
      return { changes: all, cursor };
    },
    async download(path) {
      const res = await fetch(`/api/sync/file?${q(path)}`, { credentials: "same-origin" });
      if (!res.ok) throw new ApiError(res.status, `Couldn't download ${path}.`);
      return new Uint8Array(await res.arrayBuffer());
    },
    async upload({ path, baseHash, hash, data }) {
      return call<UploadResult>(`sync/file?${q(path, { hash, ...(baseHash ? { base: baseHash } : {}) })}`, {
        method: "PUT",
        headers: { "content-type": "application/octet-stream" },
        body: data as BodyInit,
      });
    },
    async remove({ path, baseHash }) {
      return call<UploadResult>(`sync/file?${q(path, { base: baseHash })}`, { method: "DELETE" });
    },
  };
}
