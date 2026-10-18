import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HostAction } from "@writalin/editor";
import { WORKSPACE_PATH, SCRATCHPAD_PATH, importZip, type Vault, type VaultRecord } from "@writalin/vault";
import { basename, extname, isMarkdown, noteName, type VaultPath } from "@writalin/shared";
import {
  ActionGrid, applyTheme, BottomBar, CommandPalette, findTheme, FocusTimer, Icon, toast, useFocusTimer,
  type BarItem, type Command, type IconName, type Theme,
} from "@writalin/ui";
import { CalendarWorkspace, ImageWorkspace, NoteWorkspace, ScratchpadWorkspace, TasksWorkspace, useVaultVersion, type WorkspaceProps } from "@writalin/workspaces";
import { Home } from "./Home";
import { NotePane, type NotePaneHandle } from "./NotePane";
import { useNoteHost } from "./useNoteHost";
import { SettingsModal } from "./Settings";
import { ThemeEditor, loadCustomThemes } from "./ThemeEditor";
import { exportNote, exportVaultZip, importTarget } from "../export";
import type { Account } from "../api";
import { getSyncLink, runSync } from "../state/sync";

const PdfWorkspace = lazy(() => import("@writalin/workspaces/pdf").then((m) => ({ default: m.PdfWorkspace })));

type TabKind = "tasks" | "calendar" | "scratch" | "pdf" | "image" | "note" | "graph";
interface Tab {
  id: string;
  kind: TabKind;
  path?: VaultPath;
  page?: number;
}

interface Layout {
  note: VaultPath | null;
  view: "home" | "note";
  tabs: Tab[];
  active: string | null;
  leftOpen: boolean;
}

const TAB_META: Record<TabKind, { label: string; icon: IconName }> = {
  tasks: { label: "Tasks", icon: "checkSquare" },
  calendar: { label: "Calendar", icon: "calendar" },
  scratch: { label: "Scratch pad", icon: "scratch" },
  pdf: { label: "PDF", icon: "pdf" },
  image: { label: "Image", icon: "image" },
  note: { label: "Note", icon: "file" },
  graph: { label: "Graph", icon: "graph" },
};

interface Props {
  vault: Vault;
  record: VaultRecord;
  records: VaultRecord[];
  account: Account | null | undefined;
  quality: "low" | "medium" | "high";
  onSwitchVault: (rec: VaultRecord | "new-folder" | "new-browser") => void;
  onAccount: (a: Account | null) => void;
}

export function Workspace({ vault, record, records, account, quality, onSwitchVault, onAccount }: Props) {
  const version = useVaultVersion(vault);
  const [layout, setLayout] = useState<Layout>({ note: null, view: "home", tabs: [], active: null, leftOpen: false });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [printLayout, setPrintLayout] = useState(vault.settings.showPrintLayout);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [themeEditor, setThemeEditor] = useState(false);
  const [customThemes, setCustomThemes] = useState<Theme[]>([]);
  const [jump, setJump] = useState<{ heading?: string; line?: number; nonce: number } | undefined>();
  const [homeTag, setHomeTag] = useState<string | undefined>();
  const [syncing, setSyncing] = useState<"off" | "idle" | "busy" | "error">("off");
  const [settings, setSettings] = useState(vault.settings);
  const pane = useRef<NotePaneHandle>(null);
  const layoutLoaded = useRef(false);
  const timer = useFocusTimer(settings.timerMinutes, settings.breakMinutes);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const insertImageInput = useRef<HTMLInputElement>(null);

  // ----- settings, theme, layout persistence -----
  useEffect(() => vault.events.on((e) => e.type === "settings" && setSettings(e.settings)), [vault]);
  useEffect(() => {
    void loadCustomThemes(vault).then(setCustomThemes);
  }, [vault]);
  useEffect(() => {
    applyTheme(findTheme(settings.theme, customThemes));
    const root = document.documentElement;
    root.dataset.font = settings.font;
    root.style.setProperty("--w-line-height", String(settings.lineHeight));
  }, [settings, customThemes]);

  useEffect(() => {
    void vault.readJson<Layout>(WORKSPACE_PATH).then((l) => {
      if (l) setLayout({ ...l, note: l.note && vault.files.has(l.note) ? l.note : null, view: l.note && vault.files.has(l.note) ? l.view : "home" });
      layoutLoaded.current = true;
    });
  }, [vault]);
  useEffect(() => {
    if (!layoutLoaded.current) return;
    const t = setTimeout(() => void vault.writeJson(WORKSPACE_PATH, layout).catch(() => {}), 800);
    return () => clearTimeout(t);
  }, [vault, layout]);

  // ----- external changes and sync -----
  useEffect(() => {
    const refresh = () => void vault.refresh().catch(() => {});
    window.addEventListener("focus", refresh);
    const id = setInterval(refresh, 15_000);
    return () => {
      window.removeEventListener("focus", refresh);
      clearInterval(id);
    };
  }, [vault]);

  const doSync = useCallback(async () => {
    if (!account) return setSyncing("off");
    if (!(await getSyncLink(record.id))) return setSyncing("off");
    setSyncing("busy");
    pane.current?.flush();
    try {
      const r = await runSync(record.id, vault);
      if (r?.conflicts.length) toast(`Kept both versions of ${r.conflicts.length} note${r.conflicts.length > 1 ? "s" : ""} edited on two computers.`);
      setSyncing("idle");
    } catch {
      setSyncing("error");
    }
  }, [account, record.id, vault]);
  useEffect(() => {
    void doSync();
    const id = setInterval(() => void doSync(), 60_000);
    return () => clearInterval(id);
  }, [doSync]);

  // ----- navigation -----
  const openTab = useCallback((tab: Omit<Tab, "id">) => {
    setLayout((l) => {
      const existing = l.tabs.find((t) => t.kind === tab.kind && t.path === tab.path);
      if (existing) {
        const tabs = l.tabs.map((t) => (t.id === existing.id ? { ...t, page: tab.page ?? t.page } : t));
        return { ...l, tabs, active: existing.id, leftOpen: true };
      }
      const id = `${tab.kind}:${tab.path ?? ""}:${Date.now()}`;
      return { ...l, tabs: [...l.tabs, { ...tab, id }], active: id, leftOpen: true };
    });
  }, []);

  const openPath = useCallback(
    (path: VaultPath, opts: { heading?: string; newPane?: boolean; page?: number; line?: number } = {}) => {
      if (isMarkdown(path)) {
        if (path === SCRATCHPAD_PATH) return openTab({ kind: "scratch" });
        if (opts.newPane) return openTab({ kind: "note", path });
        pane.current?.flush();
        setLayout((l) => ({ ...l, note: path, view: "note" }));
        if (opts.heading || opts.line != null) setJump({ heading: opts.heading, line: opts.line, nonce: Date.now() });
        return;
      }
      const ext = extname(path);
      if (ext === ".pdf") return openTab({ kind: "pdf", path, page: opts.page });
      if (/^\.(png|jpe?g|gif|webp|svg|avif|bmp)$/.test(ext)) return openTab({ kind: "image", path });
      toast(`Writalin can't open ${ext || "this"} files yet.`);
    },
    [openTab],
  );

  const newNote = useCallback(
    async (opts: { title?: string; folder?: string } = {}) => {
      const path = await vault.createNote(opts.title ?? "Untitled", { folder: opts.folder });
      openPath(path);
    },
    [vault, openPath],
  );

  const insertIntoNote = useCallback(
    (markdown: string, opts: { source?: string } = {}) => {
      const ed = pane.current?.editor;
      if (!ed || !layout.note) return toast("Open a note on the right first.", { tone: "warn" });
      ed.insert(markdown, { block: true });
      if (opts.source) {
        pane.current?.flush();
        setTimeout(() => void vault.addSource(layout.note!, opts.source!).catch(() => {}), 700);
      }
    },
    [layout.note, vault],
  );

  const hostAction = useRef<(a: HostAction) => void>(() => {});
  const host = useNoteHost(vault, () => layout.note, {
    openPath: (p, o) => openPath(p, o),
    createAndOpen: (name) => void newNote({ title: name }),
    action: (a) => hostAction.current(a),
  });
  hostAction.current = (a) => {
    switch (a) {
      case "start-timer":
        timer.dispatch({ type: "start" });
        return toast(`Focus timer started: ${settings.timerMinutes} minutes.`);
      case "insert-image":
        return insertImageInput.current?.click();
      case "insert-pdf-quote": {
        const pdfs = [...vault.files.keys()].filter((p) => p.endsWith(".pdf"));
        if (!pdfs.length) return toast("Import a PDF first, then highlight text in it.");
        openTab({ kind: "pdf", path: pdfs[0] });
        return toast("Select text in the PDF, then choose “Quote in note”.");
      }
      case "insert-drawing":
        return toast("Drawing boxes are coming in a later update.");
      case "insert-citation":
        return pane.current?.editor?.insert("> [!quote] Source\n> Author, *Title* (Year). URL\n", { block: true });
    }
  };

  // ----- keyboard -----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      } else if (mod && e.key === ".") {
        e.preventDefault();
        setFocusMode((f) => !f);
      } else if (mod && e.key === "/") {
        e.preventDefault();
        openTab({ kind: "scratch" });
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        setOutlineOpen((o) => !o);
      } else if (e.altKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        void newNote();
      } else if (e.key === "Escape" && focusMode) setFocusMode(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openTab, newNote, focusMode]);

  // ----- import -----
  const importFiles = async (files: FileList | File[], fromFolder = false) => {
    let n = 0;
    let last: string | null = null;
    for (const f of [...files]) {
      const rel = fromFolder && (f as File & { webkitRelativePath?: string }).webkitRelativePath
        ? (f as File & { webkitRelativePath: string }).webkitRelativePath.split("/").slice(1).join("/")
        : f.name;
      if (!rel || rel.split("/").some((s) => s.startsWith(".") && s !== ".writalin")) continue;
      if (f.name.endsWith(".zip")) {
        n += (await importZip(vault.store, await f.arrayBuffer())).length;
        continue;
      }
      const target = vault.uniquePath(importTarget(vault, rel));
      if (isMarkdown(target)) await vault.write(target, await f.text());
      else await vault.writeBinary(target, f);
      last = target;
      n++;
    }
    await vault.refresh();
    toast(`Imported ${n} file${n === 1 ? "" : "s"}.`);
    if (files.length === 1 && last) openPath(last);
  };

  const insertImage = async (file: File) => {
    const path = await vault.writeBinary(`${settings.attachmentsFolder}/${file.name}`, file);
    insertIntoNote(`![[${path}]]`);
  };

  // ----- commands -----
  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [
      { id: "new-note", title: "New note", group: "Notes", shortcut: "Alt+N", run: () => void newNote() },
      { id: "home", title: "Go home", group: "Navigate", run: () => setLayout((l) => ({ ...l, view: "home" })) },
      { id: "focus", title: focusMode ? "Leave focus mode" : "Start focus mode", group: "Focus", shortcut: "Ctrl+.", run: () => setFocusMode((f) => !f) },
      { id: "timer-start", title: "Start focus timer", group: "Focus", run: () => timer.dispatch({ type: "start" }) },
      { id: "timer-pause", title: "Pause focus timer", group: "Focus", run: () => timer.dispatch({ type: "pause" }) },
      { id: "timer-reset", title: "Stop focus timer", group: "Focus", run: () => timer.dispatch({ type: "reset" }) },
      { id: "print", title: printLayout ? "Hide print layout" : "Show print layout", group: "View", run: () => setPrintLayout((p) => !p) },
      { id: "outline", title: outlineOpen ? "Hide outline" : "Show outline", group: "View", shortcut: "Ctrl+Shift+O", run: () => setOutlineOpen((o) => !o) },
      { id: "close-left", title: "Close left pane", group: "View", run: () => setLayout((l) => ({ ...l, leftOpen: false })) },
      { id: "ws-tasks", title: "Open Tasks", group: "Workspaces", run: () => openTab({ kind: "tasks" }) },
      { id: "ws-cal", title: "Open Calendar", group: "Workspaces", run: () => openTab({ kind: "calendar" }) },
      { id: "ws-scratch", title: "Open Scratch pad", group: "Workspaces", shortcut: "Ctrl+/", run: () => openTab({ kind: "scratch" }) },
      { id: "import", title: "Import files…", group: "Import / export", run: () => fileInput.current?.click() },
      { id: "export-zip", title: "Export vault as .zip", group: "Import / export", run: () => void exportVaultZip(vault) },
      { id: "settings", title: "Settings", group: "Settings", run: () => setSettingsOpen(true) },
      { id: "theme-edit", title: "Customize theme…", group: "Settings", run: () => setThemeEditor(true) },
      ...[...findThemes(customThemes)].map((t) => ({ id: `theme-${t.id}`, title: `Theme: ${t.name}`, group: "Settings", run: () => void vault.saveSettings({ theme: t.id }) })),
      ...records.filter((r) => r.id !== record.id).map((r) => ({ id: `vault-${r.id}`, title: `Switch to vault: ${r.name}`, group: "Vaults", run: () => onSwitchVault(r) })),
    ];
    if (layout.note) {
      const p = layout.note;
      list.push(
        { id: "export-pdf", title: "Export note as PDF", group: "Import / export", run: () => void exportNote(vault, p, "pdf") },
        { id: "export-md", title: "Export note as Markdown", group: "Import / export", run: () => void exportNote(vault, p, "md") },
        { id: "export-html", title: "Export note as HTML", group: "Import / export", run: () => void exportNote(vault, p, "html") },
      );
    }
    for (const f of vault.files.keys()) {
      if (f.endsWith(".pdf")) list.push({ id: `pdf:${f}`, title: `Open PDF: ${basename(f)}`, group: "Files", run: () => openPath(f) });
    }
    for (const n of vault.notes.values()) {
      list.push({ id: `note:${n.path}`, title: n.name, hint: n.path.includes("/") ? n.path.slice(0, n.path.lastIndexOf("/")) : undefined, group: "Notes", keywords: n.tags.join(" "), run: () => openPath(n.path) });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault, version, focusMode, printLayout, outlineOpen, layout.note, customThemes, records, record.id]);

  // ----- dock -----
  const ed = () => pane.current?.editor;
  const bar: BarItem[] = [
    { id: "home", label: "Home", icon: "home", active: layout.view === "home", onClick: () => setLayout((l) => ({ ...l, view: l.view === "home" && l.note ? "note" : "home" })) },
    {
      id: "tools",
      label: "Tools",
      icon: "tools",
      panel: (close) => (
        <>
          <h3>Format</h3>
          <ActionGrid
            actions={[
              { label: "Bold", hint: "Ctrl+B", onClick: () => ed()?.wrap("**") },
              { label: "Italic", hint: "Ctrl+I", onClick: () => ed()?.wrap("_") },
              { label: "Highlight", hint: "Ctrl+Shift+H", onClick: () => ed()?.wrap("==") },
              { label: "Strikethrough", onClick: () => ed()?.wrap("~~") },
              { label: "Code", hint: "Ctrl+E", onClick: () => ed()?.wrap("`") },
              { label: "Heading 1", onClick: () => ed()?.prefix("# ") },
              { label: "Heading 2", onClick: () => ed()?.prefix("## ") },
              { label: "Heading 3", onClick: () => ed()?.prefix("### ") },
              { label: "Bullet list", onClick: () => ed()?.prefix("- ") },
              { label: "Numbered list", onClick: () => ed()?.prefix("1. ") },
              { label: "Checklist", onClick: () => ed()?.prefix("- [ ] ") },
              { label: "Quote", onClick: () => ed()?.prefix("> ") },
            ]}
          />
          <h3 style={{ marginTop: 14 }}>View</h3>
          <ActionGrid
            actions={[
              { label: focusMode ? "Leave focus mode" : "Focus mode", icon: "focus", hint: "Ctrl+.", onClick: () => { setFocusMode((f) => !f); close(); } },
              { label: outlineOpen ? "Hide outline" : "Outline", icon: "list", onClick: () => { setOutlineOpen((o) => !o); close(); } },
              { label: printLayout ? "Hide print layout" : "Print layout", icon: "printer", onClick: () => { setPrintLayout((p) => !p); close(); } },
              { label: "Collapse all", onClick: () => ed()?.foldAll() },
              { label: "Expand all", onClick: () => ed()?.unfoldAll() },
              { label: "All commands", icon: "search", hint: "Ctrl+K", onClick: () => { close(); setPaletteOpen(true); } },
            ]}
          />
        </>
      ),
    },
    {
      id: "ai",
      label: "AI",
      icon: "sparkle",
      panel: () => (
        <div className="w-col">
          <h3>Study helper</h3>
          <p className="w-muted">Explain, summarize, flashcards, “Where was I?” and more are coming next. AI is always opt-in and only sees the text you choose.</p>
        </div>
      ),
    },
    {
      id: "insert",
      label: "Insert",
      icon: "plus",
      panel: (close) => (
        <ActionGrid
          actions={[
            { label: "Checklist", icon: "checkSquare", onClick: () => { ed()?.insert("- [ ] ", { block: true }); close(); } },
            { label: "Table", onClick: () => { ed()?.insert("| Column 1 | Column 2 |\n| --- | --- |\n|  |  |", { block: true }); close(); } },
            { label: "Callout", onClick: () => { ed()?.insert("> [!note] ", { block: true }); close(); } },
            { label: "Flashcard", onClick: () => { ed()?.insert("Question :: Answer", { block: true }); close(); } },
            { label: "Link to note", icon: "link", onClick: () => { ed()?.insert("[[]]", { cursorOffset: 2 }); close(); } },
            { label: "Image", icon: "image", onClick: () => { insertImageInput.current?.click(); close(); } },
            { label: "PDF quote", icon: "pdf", onClick: () => { hostAction.current("insert-pdf-quote"); close(); } },
            { label: "Task with date", icon: "calendar", onClick: () => { ed()?.insert(`- [ ]  📅 ${new Date().toISOString().slice(0, 10)}`, { block: true, cursorOffset: 6 }); close(); } },
            { label: "Divider", onClick: () => { ed()?.insert("---", { block: true }); close(); } },
          ].map((a): { label: string; icon?: IconName; onClick: () => void; disabled: boolean } => ({ ...a, icon: a.icon as IconName | undefined, disabled: !layout.note }))}
        />
      ),
    },
    {
      id: "import",
      label: "Import",
      icon: "import",
      panel: (close) => (
        <ActionGrid
          actions={[
            { label: "Files (notes, PDFs, images, .zip)", icon: "file", onClick: () => { fileInput.current?.click(); close(); } },
            { label: "Folder or Obsidian vault", icon: "folder", onClick: () => { folderInput.current?.click(); close(); } },
          ]}
        />
      ),
    },
    {
      id: "export",
      label: "Export",
      icon: "export",
      panel: (close) => (
        <ActionGrid
          actions={[
            { label: "Note as PDF", icon: "printer", disabled: !layout.note, onClick: () => { void exportNote(vault, layout.note!, "pdf"); close(); } },
            { label: "Note as Markdown", icon: "file", disabled: !layout.note, onClick: () => { void exportNote(vault, layout.note!, "md"); close(); } },
            { label: "Note as HTML", disabled: !layout.note, onClick: () => { void exportNote(vault, layout.note!, "html"); close(); } },
            { label: "Whole vault (.zip)", icon: "folder", onClick: () => { void exportVaultZip(vault); close(); } },
          ]}
        />
      ),
    },
    { id: "settings", label: "Settings", icon: "settings", onClick: () => setSettingsOpen(true) },
  ];

  const wsProps: WorkspaceProps = {
    vault,
    version,
    openNote: (p, o) => openPath(p, o ?? {}),
    insertIntoNote,
    currentNote: layout.note,
    quality,
  };
  const activeTab = layout.tabs.find((t) => t.id === layout.active) ?? layout.tabs[layout.tabs.length - 1];

  const renderTab = (t: Tab) => {
    switch (t.kind) {
      case "tasks": return <TasksWorkspace {...wsProps} />;
      case "calendar": return <CalendarWorkspace {...wsProps} />;
      case "scratch": return <ScratchpadWorkspace {...wsProps} host={host} />;
      case "image": return <ImageWorkspace {...wsProps} path={t.path!} />;
      case "note": return <NoteWorkspace {...wsProps} path={t.path!} host={host} />;
      case "pdf":
        return (
          <Suspense fallback={<div className="ws ws-loading">Loading PDF viewer…</div>}>
            <PdfWorkspace {...wsProps} path={t.path!} page={t.page} />
          </Suspense>
        );
      case "graph": return <div className="ws ws-empty w-muted">The graph view is coming in a later update.</div>;
    }
  };

  const showLeft = layout.leftOpen && layout.tabs.length > 0 && layout.view === "note";

  return (
    <div className={`app${focusMode ? " focus-mode" : ""}`}>
      <header className="topbar">
        <div className="topbar-left">
          <button className="w-btn w-btn-ghost topbar-vault" onClick={() => setLayout((l) => ({ ...l, view: "home" }))} title="Home">
            <img src="/icon.svg" alt="" width={20} height={20} />
            <span>{vault.name}</span>
          </button>
          {layout.view === "note" && layout.note && <span className="topbar-crumb w-muted">/ {noteName(layout.note)}</span>}
        </div>
        <FocusTimer timer={timer} onDurationChange={(m) => void vault.saveSettings({ timerMinutes: m })} />
        <div className="topbar-right">
          {syncing !== "off" && (
            <span className={`sync-dot sync-${syncing}`} title={syncing === "busy" ? "Syncing…" : syncing === "error" ? "Sync paused. Will retry." : "Synced"}>
              <Icon name="cloud" size={16} />
            </span>
          )}
          {layout.view === "note" && (
            <>
              <button className="w-icon-btn" aria-pressed={layout.leftOpen} onClick={() => (layout.tabs.length ? setLayout((l) => ({ ...l, leftOpen: !l.leftOpen })) : openTab({ kind: "tasks" }))} aria-label="Toggle left pane" title="Split view">
                <Icon name="split" />
              </button>
              <button className="w-icon-btn" aria-pressed={outlineOpen} onClick={() => setOutlineOpen((o) => !o)} aria-label="Toggle outline" title="Outline (Ctrl+Shift+O)">
                <Icon name="list" />
              </button>
            </>
          )}
          <button className="w-icon-btn" onClick={() => setPaletteOpen(true)} aria-label="Command palette" title="Commands (Ctrl+K)">
            <Icon name="search" />
          </button>
          {account ? (
            <button className="w-icon-btn" onClick={() => setSettingsOpen(true)} aria-label={`Account: ${account.email}`} title={account.email}>
              <Icon name="user" />
            </button>
          ) : (
            account === null && <a className="w-btn w-btn-small" href="/login">Sign in</a>
          )}
        </div>
      </header>

      <main className="main">
        {layout.view === "home" || !layout.note ? (
          <Home
            vault={vault}
            version={version}
            records={records}
            currentId={record.id}
            onSwitchVault={onSwitchVault}
            onOpen={(p, o) => openPath(p, o)}
            onNewNote={(folder) => void newNote({ folder })}
            initialTag={homeTag}
            key={homeTag ?? ""}
          />
        ) : (
          <div className={`split${showLeft ? " split-open" : ""}`}>
            {showLeft && (
              <section className="left-pane" aria-label="Workspace">
                <div className="tabs" role="tablist">
                  {layout.tabs.map((t) => (
                    <div key={t.id} className={`tab${t.id === activeTab?.id ? " active" : ""}`} role="presentation">
                      <button role="tab" aria-selected={t.id === activeTab?.id} onClick={() => setLayout((l) => ({ ...l, active: t.id }))}>
                        <Icon name={TAB_META[t.kind].icon} size={14} />
                        <span>{t.path ? noteName(t.path) : TAB_META[t.kind].label}</span>
                      </button>
                      <button
                        className="tab-close"
                        aria-label={`Close ${t.path ? basename(t.path) : TAB_META[t.kind].label}`}
                        onClick={() => setLayout((l) => {
                          const tabs = l.tabs.filter((x) => x.id !== t.id);
                          return { ...l, tabs, active: tabs[tabs.length - 1]?.id ?? null, leftOpen: tabs.length > 0 && l.leftOpen };
                        })}
                      >
                        <Icon name="close" size={12} />
                      </button>
                    </div>
                  ))}
                  <TabAdder onAdd={(kind) => openTab({ kind })} />
                </div>
                <div className="tab-body">{activeTab && renderTab(activeTab)}</div>
              </section>
            )}
            <section className="right-pane" aria-label="Note">
              <NotePane
                ref={pane}
                vault={vault}
                path={layout.note}
                host={host}
                version={version}
                focusMode={focusMode}
                printLayout={printLayout}
                outlineOpen={outlineOpen}
                jump={jump}
                onRenamed={(to) => setLayout((l) => ({ ...l, note: to }))}
                onOpen={(p) => openPath(p)}
                onTag={(t) => { setHomeTag(t); setLayout((l) => ({ ...l, view: "home" })); }}
              />
            </section>
          </div>
        )}
      </main>

      <BottomBar items={bar} />

      {paletteOpen && <CommandPalette open onClose={() => setPaletteOpen(false)} commands={commands} />}
      {settingsOpen && (
        <SettingsModal
          vault={vault}
          vaultId={record.id}
          account={account}
          customThemes={customThemes}
          onClose={() => { setSettingsOpen(false); void doSync(); }}
          onAccount={onAccount}
          onEditTheme={() => { setSettingsOpen(false); setThemeEditor(true); }}
        />
      )}
      {themeEditor && (
        <ThemeEditor
          vault={vault}
          base={findTheme(settings.theme, customThemes)}
          onClose={() => setThemeEditor(false)}
          onSaved={(t) => setCustomThemes((xs) => [...xs.filter((x) => x.id !== t.id), t])}
        />
      )}
      <input ref={fileInput} type="file" multiple hidden accept=".md,.markdown,.txt,.pdf,.png,.jpg,.jpeg,.gif,.webp,.svg,.zip" onChange={(e) => { if (e.target.files) void importFiles(e.target.files); e.target.value = ""; }} />
      <input ref={folderInput} type="file" hidden multiple {...({ webkitdirectory: "" } as object)} onChange={(e) => { if (e.target.files) void importFiles(e.target.files, true); e.target.value = ""; }} />
      <input ref={insertImageInput} type="file" hidden accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) void insertImage(f); e.target.value = ""; }} />
    </div>
  );
}

function findThemes(custom: Theme[]): Theme[] {
  return [findTheme("light"), findTheme("dark"), findTheme("midnight"), findTheme("warm-paper"), ...custom];
}

function TabAdder({ onAdd }: { onAdd: (k: TabKind) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="tab-adder">
      <button className="w-icon-btn" aria-label="Open a workspace" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="plus" size={16} />
      </button>
      {open && (
        <div className="w-popover tab-adder-menu" onMouseLeave={() => setOpen(false)}>
          {(["tasks", "calendar", "scratch"] as TabKind[]).map((k) => (
            <button key={k} className="w-action" onClick={() => { onAdd(k); setOpen(false); }}>
              <Icon name={TAB_META[k].icon} size={16} />
              <span>{TAB_META[k].label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

