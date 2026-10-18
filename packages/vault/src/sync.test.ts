import { describe, expect, it } from "vitest";
import { MemoryStore, syncVault, emptySyncState, hashBytes, type RemoteChange, type SyncTransport, type SyncState } from "./index";

/** In-memory stand-in for the /api/sync endpoints with the same semantics. */
class FakeServer {
  files = new Map<string, { data: Uint8Array; hash: string | null; deleted: boolean; version: number }>();
  seq = 0;
  transport(): SyncTransport {
    const meta = (path: string): RemoteChange => {
      const f = this.files.get(path)!;
      return { path, hash: f.hash, deleted: f.deleted, version: f.version, size: f.data.length };
    };
    return {
      changes: async (since) => ({
        changes: [...this.files.keys()].filter((p) => this.files.get(p)!.version > since).map(meta),
        cursor: this.seq,
      }),
      download: async (path) => this.files.get(path)!.data,
      upload: async ({ path, baseHash, hash, data }) => {
        const cur = this.files.get(path);
        const curHash = cur && !cur.deleted ? cur.hash : null;
        if (curHash !== baseHash) return { ok: false, current: meta(path) };
        this.files.set(path, { data, hash, deleted: false, version: ++this.seq });
        return { ok: true, version: this.seq };
      },
      remove: async ({ path, baseHash }) => {
        const cur = this.files.get(path);
        if (!cur || cur.hash !== baseHash) return { ok: false, current: meta(path) };
        this.files.set(path, { data: new Uint8Array(), hash: null, deleted: true, version: ++this.seq });
        return { ok: true, version: this.seq };
      },
    };
  }
}

class Device {
  state: SyncState = emptySyncState();
  constructor(public store: MemoryStore, public server: FakeServer) {}
  async sync() {
    const r = await syncVault(this.store, this.server.transport(), this.state);
    this.state = r.state;
    return r.report;
  }
}

describe("sync", () => {
  it("copies a vault to a second computer and keeps them in step", async () => {
    const server = new FakeServer();
    const a = new Device(new MemoryStore("A", { "Note.md": "hello", "attachments/x.svg": "<svg/>", ".writalin/workspace.json": "{}" }), server);
    const b = new Device(new MemoryStore("B"), server);
    expect((await a.sync()).pushed.sort()).toEqual(["Note.md", "attachments/x.svg"]);
    expect((await b.sync()).pulled.sort()).toEqual(["Note.md", "attachments/x.svg"]);
    expect(await b.store.readText("Note.md")).toBe("hello");
    expect(await b.store.stat(".writalin/workspace.json")).toBeNull();

    await b.store.write("Note.md", "hello from B");
    await b.sync();
    await a.sync();
    expect(await a.store.readText("Note.md")).toBe("hello from B");

    await a.store.remove("attachments/x.svg");
    expect((await a.sync()).deletedRemote).toEqual(["attachments/x.svg"]);
    expect((await b.sync()).deletedLocal).toEqual(["attachments/x.svg"]);
  });

  it("keeps both versions when two computers edit the same note", async () => {
    const server = new FakeServer();
    const a = new Device(new MemoryStore("A", { "Essay.md": "v1" }), server);
    const b = new Device(new MemoryStore("B"), server);
    await a.sync();
    await b.sync();
    await a.store.write("Essay.md", "A's edit");
    await b.store.write("Essay.md", "B's edit");
    await a.sync();
    const rb = await b.sync();
    expect(rb.conflicts).toHaveLength(1);
    expect(await b.store.readText("Essay.md")).toBe("A's edit");
    expect(await b.store.readText(rb.conflicts[0]!)).toBe("B's edit");
    // The conflict copy reaches A too, so nothing is lost anywhere.
    await b.sync();
    const ra = await a.sync();
    expect(ra.pulled).toContain(rb.conflicts[0]);
  });

  it("doesn't re-upload unchanged files", async () => {
    const server = new FakeServer();
    const a = new Device(new MemoryStore("A", { "N.md": "x" }), server);
    await a.sync();
    const r = await a.sync();
    expect(r.pushed).toEqual([]);
    expect(await hashBytes(new TextEncoder().encode("x"))).toBe(a.state.base["N.md"]);
  });
});
