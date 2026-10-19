import type { NoteMeta, Task, VaultPath } from "@writalin/shared";
import { Emitter, isHiddenPath, isMarkdown, isoDate, isoDateTime, joinPath, noteName, normalizePath, sanitizeFileName, dirname, basename, stripExt } from "@writalin/shared";
import type { FileStat, FileStore } from "./fs/types";
import { parseNote } from "./markdown/parse";
import { splitFrontmatter, updateFrontmatter } from "./markdown/frontmatter";
import { rewriteWikiLinks, rewriteMarkdownLinks } from "./markdown/links";
import { newBlockId, toggleTaskLine } from "./markdown/tasks";
import { tagMatches, normalizeTag } from "./markdown/tags";
import { SearchIndex } from "./search";
import { ACTIVITY_PATH, addActivity, emptyActivity, mergeActivity, type ActivityLog } from "./activity";
import { DEFAULT_SETTINGS, SETTINGS_PATH, SCRATCHPAD_PATH, REMINDERS_PATH, SCRATCH_FOLDER, TASKS_PATH, isScratch, isSystemNote, type VaultSettings } from "./settings";

export type VaultEvent =
  | { type: "indexed" }
  | { type: "changed"; path: VaultPath; external: boolean }
  | { type: "created"; path: VaultPath }
  | { type: "deleted"; path: VaultPath }
  | { type: "renamed"; from: VaultPath; to: VaultPath }
  | { type: "settings"; settings: VaultSettings }
  | { type: "activity" };

/** Thrown when a file changed on disk since the editor loaded it. */
export class ConflictError extends Error {
  constructor(public path: VaultPath, public diskText: string, public diskMtime: number) {
    super(`"${path}" was changed by another app.`);
    this.name = "ConflictError";
  }
}

/** Optional persistent cache so re-opening a big vault doesn't re-read every file. */
export interface IndexCache {
  get(path: VaultPath): Promise<{ mtime: number; size: number; meta: NoteMeta; text: string } | undefined>;
  set(path: VaultPath, entry: { mtime: number; size: number; meta: NoteMeta; text: string }): Promise<void>;
  delete(path: VaultPath): Promise<void>;
}

export interface Backlink {
  path: VaultPath;
  /** Line of text around the link. */
  context: string;
}

export class Vault {
  readonly events = new Emitter<VaultEvent>();
  readonly notes = new Map<VaultPath, NoteMeta>();
  readonly files = new Map<VaultPath, FileStat>();
  readonly search = new SearchIndex();
  settings: VaultSettings = { ...DEFAULT_SETTINGS };
  /** mtimes Writalin itself produced, so a refresh doesn't report our own saves as external. */
  private known = new Map<VaultPath, number>();
  private byName = new Map<string, VaultPath[]>();
  /** Words written per day. Saved a few seconds after the last edit. */
  activity: ActivityLog = emptyActivity();
  private activityTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(public readonly store: FileStore, private cache?: IndexCache) {}

  get name(): string {
    return this.store.name;
  }

  async open(): Promise<void> {
    await this.loadSettings();
    await this.loadActivity();
    const stats = await this.store.list();
    await Promise.all(stats.map((s) => this.indexFile(s, false)));
    this.events.emit({ type: "indexed" });
  }

  // ---------- index ----------

  private async indexFile(s: FileStat, emit: boolean): Promise<void> {
    if (isHiddenPath(s.path)) return;
    this.files.set(s.path, s);
    if (!isMarkdown(s.path)) return;
    const cached = await this.cache?.get(s.path);
    let meta: NoteMeta;
    let text: string;
    if (cached && cached.mtime === s.mtime && cached.size === s.size) {
      ({ meta, text } = cached);
    } else {
      text = await this.store.readText(s.path);
      meta = parseNote(s.path, text, s);
      void this.cache?.set(s.path, { mtime: s.mtime, size: s.size, meta, text });
    }
    this.setMeta(meta, text);
    this.known.set(s.path, s.mtime);
    if (emit) this.events.emit({ type: "changed", path: s.path, external: true });
  }

  private setMeta(meta: NoteMeta, text: string): void {
    const prev = this.notes.get(meta.path);
    if (prev) this.unlinkName(prev.path);
    this.notes.set(meta.path, meta);
    const key = meta.name.toLowerCase();
    this.byName.set(key, [...(this.byName.get(key) ?? []), meta.path]);
    this.search.set(meta.path, meta.name, splitFrontmatter(text).body);
  }

  private unlinkName(path: VaultPath): void {
    const key = noteName(path).toLowerCase();
    const list = (this.byName.get(key) ?? []).filter((p) => p !== path);
    if (list.length) this.byName.set(key, list);
    else this.byName.delete(key);
  }

  private dropFile(path: VaultPath): void {
    this.files.delete(path);
    this.known.delete(path);
    if (this.notes.delete(path)) {
      this.unlinkName(path);
      this.search.remove(path);
      void this.cache?.delete(path);
    }
  }

  /**
   * Pick up changes other apps made (Obsidian, the extension, sync). Cheap
   * enough to call on window focus and on a slow interval.
   */
  async refresh(): Promise<VaultPath[]> {
    const stats = await this.store.list();
    const seen = new Set<VaultPath>();
    const changed: VaultPath[] = [];
    for (const s of stats) {
      if (isHiddenPath(s.path)) continue;
      seen.add(s.path);
      const prev = this.files.get(s.path);
      if (!prev) {
        await this.indexFile(s, false);
        this.events.emit({ type: "created", path: s.path });
        changed.push(s.path);
      } else if (prev.mtime !== s.mtime || prev.size !== s.size) {
        const external = this.known.get(s.path) !== s.mtime;
        await this.indexFile(s, false);
        if (external) {
          this.events.emit({ type: "changed", path: s.path, external: true });
          changed.push(s.path);
        }
      }
    }
    for (const p of [...this.files.keys()]) {
      if (!seen.has(p)) {
        this.dropFile(p);
        this.events.emit({ type: "deleted", path: p });
        changed.push(p);
      }
    }
    return changed;
  }

  // ---------- settings ----------

  async loadSettings(): Promise<VaultSettings> {
    try {
      const raw = JSON.parse(await this.store.readText(SETTINGS_PATH)) as Partial<VaultSettings>;
      this.settings = { ...DEFAULT_SETTINGS, ...raw };
    } catch {
      this.settings = { ...DEFAULT_SETTINGS };
    }
    return this.settings;
  }

  async saveSettings(patch: Partial<VaultSettings>): Promise<void> {
    this.settings = { ...this.settings, ...patch };
    await this.store.write(SETTINGS_PATH, JSON.stringify(this.settings, null, 2) + "\n");
    this.events.emit({ type: "settings", settings: this.settings });
  }

  // ---------- activity ----------

  async loadActivity(): Promise<ActivityLog> {
    const raw = await this.readJson<ActivityLog>(ACTIVITY_PATH);
    this.activity = raw && raw.version === 1 && raw.days ? mergeActivity(emptyActivity(), raw) : emptyActivity();
    return this.activity;
  }

  /** Count words written today. Deleting text never lowers the count. */
  recordWords(words: number, date = isoDate()): void {
    addActivity(this.activity, date, { words: Math.max(0, words), edits: 1 });
    this.events.emit({ type: "activity" });
    clearTimeout(this.activityTimer);
    this.activityTimer = setTimeout(() => void this.saveActivity(), 3000);
  }

  async saveActivity(): Promise<void> {
    clearTimeout(this.activityTimer);
    // Another computer may have written to the log since we read it (sync).
    const disk = await this.readJson<ActivityLog>(ACTIVITY_PATH);
    if (disk?.version === 1 && disk.days) this.activity = mergeActivity(disk, this.activity);
    await this.writeJson(ACTIVITY_PATH, this.activity).catch(() => {});
  }

  async readJson<T>(path: VaultPath): Promise<T | null> {
    try {
      return JSON.parse(await this.store.readText(path)) as T;
    } catch {
      return null;
    }
  }

  async writeJson(path: VaultPath, value: unknown): Promise<void> {
    await this.store.write(path, JSON.stringify(value, null, 2) + "\n");
  }

  // ---------- reading & writing ----------

  async read(path: VaultPath): Promise<{ text: string; mtime: number }> {
    const [text, stat] = await Promise.all([this.store.readText(path), this.store.stat(path)]);
    return { text, mtime: stat?.mtime ?? 0 };
  }

  /**
   * Save a note. Pass the mtime from when the text was loaded: if the file
   * changed on disk since, a ConflictError is thrown instead of overwriting.
   */
  async write(path: VaultPath, text: string, opts: { expectedMtime?: number; touch?: boolean } = {}): Promise<FileStat> {
    path = normalizePath(path);
    if (opts.expectedMtime != null) {
      const disk = await this.store.stat(path);
      if (disk && disk.mtime !== opts.expectedMtime && disk.mtime !== this.known.get(path)) {
        throw new ConflictError(path, await this.store.readText(path), disk.mtime);
      }
    }
    if (opts.touch && isMarkdown(path)) text = updateFrontmatter(text, { updated: isoDateTime() });
    const isNew = !this.files.has(path);
    const stat = await this.store.write(path, text);
    this.known.set(path, stat.mtime);
    this.files.set(path, stat);
    if (isMarkdown(path)) {
      const before = this.notes.get(path)?.words;
      const meta = parseNote(path, text, stat);
      if (opts.touch && (before != null || isNew)) this.recordWords((meta.words ?? 0) - (before ?? 0));
      this.setMeta(meta, text);
      void this.cache?.set(path, { mtime: stat.mtime, size: stat.size, meta, text });
    }
    this.events.emit(isNew ? { type: "created", path } : { type: "changed", path, external: false });
    return stat;
  }

  /**
   * Save just the body of a note (what the editor shows), keeping whatever
   * frontmatter is on disk now. Updates `updated`. Conflicts as in `write`.
   */
  async writeBody(path: VaultPath, body: string, opts: { expectedMtime?: number } = {}): Promise<FileStat> {
    path = normalizePath(path);
    const disk = this.files.has(path) ? await this.store.readText(path).catch(() => "") : "";
    const { yaml } = splitFrontmatter(disk);
    const text = yaml != null ? `---\n${yaml}\n---\n${body}` : body;
    return this.write(path, text, { ...opts, touch: true });
  }

  async writeBinary(path: VaultPath, data: Blob): Promise<VaultPath> {
    path = this.uniquePath(normalizePath(path));
    const stat = await this.store.write(path, data);
    this.files.set(path, stat);
    this.known.set(path, stat.mtime);
    this.events.emit({ type: "created", path });
    return path;
  }

  /** Same path with " 1", " 2"… appended until it doesn't exist. */
  uniquePath(path: VaultPath): VaultPath {
    if (!this.files.has(path)) return path;
    const dir = dirname(path);
    const ext = path.slice(stripExt(path).length);
    const base = stripExt(basename(path));
    for (let i = 1; ; i++) {
      const p = joinPath(dir, `${base} ${i}${ext}`);
      if (!this.files.has(p)) return p;
    }
  }

  async createNote(title: string, opts: { folder?: string; body?: string; tags?: string[]; sources?: string[] } = {}): Promise<VaultPath> {
    const folder = opts.folder ?? this.settings.newNoteFolder;
    const path = this.uniquePath(joinPath(folder, `${sanitizeFileName(title)}.md`));
    const now = isoDateTime();
    const fm: Record<string, unknown> = { created: now, updated: now, tags: opts.tags ?? [] };
    if (opts.sources?.length) fm.sources = opts.sources;
    await this.write(path, updateFrontmatter(opts.body ?? "", fm));
    return path;
  }

  async ensureScratchpad(): Promise<VaultPath> {
    if (!this.files.has(SCRATCHPAD_PATH)) await this.write(SCRATCHPAD_PATH, "");
    return SCRATCHPAD_PATH;
  }

  async delete(path: VaultPath): Promise<void> {
    await this.store.remove(path);
    for (const p of [...this.files.keys()]) if (p === path || p.startsWith(path + "/")) this.dropFile(p);
    this.events.emit({ type: "deleted", path });
  }

  /**
   * Rename or move a note or attachment and rewrite every link that pointed
   * at it, so nothing breaks. Returns the paths whose text was updated.
   */
  async rename(from: VaultPath, to: VaultPath): Promise<VaultPath[]> {
    from = normalizePath(from);
    to = normalizePath(to);
    if (from === to) return [];
    if (this.files.has(to)) throw new Error(`"${to}" already exists.`);
    // Work out which link texts point at the file *before* moving it, so resolution is unambiguous.
    const targets = new Map<VaultPath, Set<string>>();
    for (const n of this.notes.values()) {
      const hits = n.links.filter((l) => l.target && this.resolve(l.target, n.path) === from).map((l) => l.target);
      if (hits.length) targets.set(n.path, new Set(hits));
    }
    const mdReferrers = isMarkdown(from) ? [] : [...this.notes.keys()];
    await this.store.rename(from, to);
    const stat = (await this.store.stat(to)) ?? { path: to, mtime: Date.now(), size: 0 };
    this.dropFile(from);
    await this.indexFile(stat, false);

    // If another note shares the new name, links use the full path to stay unambiguous.
    const shared = isMarkdown(to) && (this.byName.get(noteName(to).toLowerCase())?.length ?? 0) > 1;
    const newTarget = isMarkdown(to) ? (shared ? stripExt(to) : noteName(to)) : to;
    const updated: VaultPath[] = [];
    for (const p of new Set([...targets.keys(), ...mdReferrers])) {
      const path = p === from ? to : p;
      const { text } = await this.read(path);
      const t = targets.get(p);
      let next = t ? rewriteWikiLinks(text, (x) => t.has(x), newTarget) : text;
      if (!isMarkdown(from)) next = rewriteMarkdownLinks(next, from, to);
      if (next !== text) {
        await this.write(path, next);
        updated.push(path);
      }
    }
    this.events.emit({ type: "renamed", from, to });
    return updated;
  }

  // ---------- links ----------

  /**
   * Resolve `[[target]]` the way Obsidian does: exact path first, then a note
   * with that name (closest to the linking note wins), then attachments.
   */
  resolve(target: string, fromPath: VaultPath): VaultPath | null {
    const t = normalizePath(target.split("#")[0]!.trim());
    if (!t) return fromPath || null;
    const candidates = [t, `${t}.md`];
    for (const c of candidates) {
      if (this.files.has(c)) return c;
    }
    const lower = t.toLowerCase();
    const byName = this.byName.get(lower.split("/").pop()!);
    if (byName?.length) {
      const exactSuffix = byName.filter((p) => stripExt(p).toLowerCase().endsWith(lower));
      const pool = exactSuffix.length ? exactSuffix : byName;
      const dir = dirname(fromPath);
      return pool.find((p) => dirname(p) === dir) ?? [...pool].sort((a, b) => a.length - b.length)[0]!;
    }
    for (const p of this.files.keys()) {
      const pl = p.toLowerCase();
      if (pl === lower || pl.endsWith("/" + lower)) return p;
    }
    return null;
  }

  backlinks(path: VaultPath): Backlink[] {
    const out: Backlink[] = [];
    for (const n of this.notes.values()) {
      if (n.path === path) continue;
      const hits = n.links.filter((l) => this.resolve(l.target, n.path) === path);
      if (hits.length) out.push({ path: n.path, context: "" });
    }
    return out;
  }

  /** Backlinks with a line of surrounding text, which needs the note text. */
  async backlinksWithContext(path: VaultPath): Promise<Backlink[]> {
    const out: Backlink[] = [];
    for (const b of this.backlinks(path)) {
      const meta = this.notes.get(b.path)!;
      const link = meta.links.find((l) => this.resolve(l.target, b.path) === path)!;
      const { text } = await this.read(b.path).catch(() => ({ text: "" }));
      const start = text.lastIndexOf("\n", link.from - 1) + 1;
      const endIdx = text.indexOf("\n", link.to);
      out.push({ path: b.path, context: text.slice(start, endIdx === -1 ? undefined : endIdx).trim() });
    }
    return out;
  }

  /** Links to notes that don't exist yet. */
  unresolvedLinks(path: VaultPath): string[] {
    const meta = this.notes.get(path);
    return meta ? meta.links.filter((l) => !this.resolve(l.target, path)).map((l) => l.target) : [];
  }

  // ---------- tags & tasks ----------

  tagCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const n of this.notes.values()) for (const t of n.tags) counts.set(normalizeTag(t), (counts.get(normalizeTag(t)) ?? 0) + 1);
    return new Map([...counts].sort((a, b) => b[1] - a[1]));
  }

  notesWithTag(tag: string): NoteMeta[] {
    return [...this.notes.values()].filter((n) => n.tags.some((t) => tagMatches(t, tag)));
  }

  allTasks(): Task[] {
    return [...this.notes.values()].flatMap((n) => n.tasks);
  }

  /**
   * Change a task's line in its note: `edit` returns the new line, or null to
   * remove it. Fails safely if the line was edited elsewhere.
   */
  private async editTaskLine(task: Task, edit: (line: string) => string | null): Promise<void> {
    const { text } = await this.read(task.path);
    const lines = text.split("\n");
    let idx = task.line;
    if (lines[idx]?.replace(/\r$/, "") !== task.raw) idx = lines.findIndex((l) => l.replace(/\r$/, "") === task.raw);
    if (idx === -1) throw new Error("That task was edited elsewhere. Open the note to update it.");
    const cr = lines[idx]!.endsWith("\r") ? "\r" : "";
    const next = edit(lines[idx]!.replace(/\r$/, ""));
    if (next == null) lines.splice(idx, 1);
    else lines[idx] = next + cr;
    await this.write(task.path, lines.join("\n"));
  }

  /** Check or uncheck a task in its note. Fails safely if the line moved. */
  toggleTask(task: Task): Promise<void> {
    return this.editTaskLine(task, toggleTaskLine);
  }

  /** Remove a task (or reminder) line from its note. */
  deleteTask(task: Task): Promise<void> {
    return this.editTaskLine(task, () => null);
  }

  /** The task's block id, adding one to its line if it has none. */
  async ensureBlockId(task: Task, id = newBlockId()): Promise<string> {
    if (task.blockId) return task.blockId;
    await this.editTaskLine(task, (l) => `${l.trimEnd()} ^${id}`);
    return id;
  }

  /** Vault-wide tasks: the checklist in Tasks.md. */
  vaultTasks(): Task[] {
    return this.notes.get(TASKS_PATH)?.tasks ?? [];
  }

  /** Calendar reminders: the dated checklist in Reminders.md. */
  reminders(): Task[] {
    return this.notes.get(REMINDERS_PATH)?.tasks ?? [];
  }

  /** Notes that link to a reminder with `[[Reminders#^id]]`. */
  reminderBacklinks(blockId: string): VaultPath[] {
    const out: VaultPath[] = [];
    for (const n of this.notes.values()) {
      if (n.path === REMINDERS_PATH) continue;
      if (n.links.some((l) => l.heading === `^${blockId}` && this.resolve(l.target, n.path) === REMINDERS_PATH)) out.push(n.path);
    }
    return out;
  }

  /** Append a line to Tasks.md or Reminders.md, creating it first if needed. */
  async appendTo(path: typeof TASKS_PATH | typeof REMINDERS_PATH, line: string): Promise<void> {
    if (!this.files.has(path)) await this.createNote(noteName(path), { folder: "" });
    await this.append(path, line);
  }

  /** Scratch pads, newest first. */
  scratches(): NoteMeta[] {
    return [...this.notes.values()].filter((n) => isScratch(n.path)).sort((a, b) => b.mtime - a.mtime);
  }

  async createScratch(): Promise<VaultPath> {
    const d = new Date();
    const stamp = `${isoDate(d)} ${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
    const path = this.uniquePath(joinPath(SCRATCH_FOLDER, `Scratch ${stamp}.md`));
    await this.write(path, "");
    return path;
  }

  /** Append Markdown to the end of a note (used by "Send to note", tasks, scratchpad moves). */
  async append(path: VaultPath, markdown: string): Promise<void> {
    const { text } = await this.read(path).catch(() => ({ text: "" }));
    const sep = !text || text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
    await this.write(path, text + sep + markdown.replace(/\n*$/, "\n"), { touch: true });
  }

  /** Add a URL/PDF to a note's `sources` frontmatter list if it isn't there. */
  async addSource(path: VaultPath, source: string): Promise<void> {
    const { text } = await this.read(path);
    const sources = splitFrontmatter(text).frontmatter.sources ?? [];
    if (sources.includes(source)) return;
    await this.write(path, updateFrontmatter(text, { sources: [...sources, source] }), { touch: true });
  }

  recentNotes(limit = 12): NoteMeta[] {
    return [...this.notes.values()].filter((n) => !isSystemNote(n.path)).sort((a, b) => b.mtime - a.mtime).slice(0, limit);
  }

  folders(): string[] {
    const set = new Set<string>();
    for (const p of this.files.keys()) {
      let d = dirname(p);
      while (d) {
        set.add(d);
        d = dirname(d);
      }
    }
    return [...set].sort();
  }
}
