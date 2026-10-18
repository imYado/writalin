import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HostAction } from "@writalin/editor";
import { WORKSPACE_PATH, SCRATCHPAD_PATH, importZip, type Vault, type VaultRecord } from "@writalin/vault";
import { basename, extname, isMarkdown, noteName, type VaultPath } from "@writalin/shared";
import {
  ActionGrid, applyTheme, BottomBar, CommandPalette, findTheme, FocusTimer, Icon, toast, useFocusTimer,
  type BarItem, type Command, type GridAction, type IconName, type Theme,
} from "@writalin/ui";
import { ActivityWorkspace, CalendarWorkspace, ImageWorkspace, NoteWorkspace, ScratchpadWorkspace, TasksWorkspace, useVaultVersion, type WorkspaceProps } from "@writalin/workspaces";
import { AiPanel } from "./AiPanel";
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

/** The zones in the left rail. "note" is the writing zone. */
type Zone = "home" | "note" | "calendar" | "tasks" | "activity";
const ZONES: { id: Zone; label: string; icon: IconName; hint: string }[] = [
  { id: "home", label: "Home", icon: "home", hint: "Recent notes, search, today" },
  { id: "note", label: "Write", icon: "pencil", hint: "Your current note" },
  { id: "calendar", label: "Calendar", icon: "calendar", hint: "Reminders and notes by day" },
  { id: "tasks", label: "Tasks", icon: "checkSquare", hint: "Every checklist in one place" },
  { id: "activity", label: "Activity", icon: "activity", hint: "How much you've written" },
];

interface Layout {
  note: VaultPath | null;
  view: Zone;
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
  const [settingsOpen, setSettingsOpen] = useState<false | true | "ai">(false);
  const [dockOpen, setDockOpen] = useState<string | null>(null);
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
      if (l) {
        const note = l.note && vault.files.has(l.note) ? l.note : null;
        const view = ZONES.some((z) => z.id === l.view) && (l.view !== "note" || note) ? l.view : "home";
        setLayout({ ...l, note, view });
      }
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

  const goZone = useCallback(
    (zone: Zone) => {
      pane.current?.flush();
      if (zone !== "note") return setLayout((l) => ({ ...l, view: zone }));
      if (layout.note) return setLayout((l) => ({ ...l, view: "note" }));
      const recent = [...vault.notes.values()].filter((n) => n.path !== SCRATCHPAD_PATH).sort((a, b) => b.mtime - a.mtime)[0];
      if (recent) openPath(recent.path);
      else void newNote();
    },
    [layout.note, vault, openPath, newNote],
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
      } else if (e.altKey && !mod && /^[1-5]$/.test(e.key)) {
        e.preventDefault();
        goZone(ZONES[Number(e.key) - 1]!.id);
      } else if (e.key === "Escape" && focusMode) setFocusMode(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openTab, newNote, focusMode, goZone]);

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
      { id: "new-note", title: "New note", description: "Start a blank note", icon: "plus", group: "Notes", shortcut: "Alt+N", run: () => void newNote() },
      ...ZONES.map((z, i): Command => ({ id: `zone-${z.id}`, title: `Go to ${z.label}`, description: z.hint, icon: z.icon, group: "Go to", shortcut: `Alt+${i + 1}`, keywords: "zone open", run: () => goZone(z.id) })),
      { id: "ws-scratch", title: "Scratch pad", description: "Park a stray thought without losing your place", icon: "scratch", group: "Go to", shortcut: "Ctrl+/", keywords: "inbox quick", run: () => openTab({ kind: "scratch" }) },
      { id: "ws-tasks", title: "Tasks beside this note", description: "Open Tasks in the side pane", icon: "split", group: "Side pane", run: () => openTab({ kind: "tasks" }) },
      { id: "ws-cal", title: "Calendar beside this note", description: "Open Calendar in the side pane", icon: "split", group: "Side pane", run: () => openTab({ kind: "calendar" }) },
      { id: "close-left", title: "Close side pane", description: "Back to just the note", icon: "close", group: "Side pane", run: () => setLayout((l) => ({ ...l, leftOpen: false })) },
      { id: "focus", title: focusMode ? "Leave focus mode" : "Focus mode", description: "Fade everything but the paragraph you're writing", icon: "focus", group: "Focus", shortcut: "Ctrl+.", run: () => setFocusMode((f) => !f) },
      { id: "timer-start", title: "Start focus timer", description: `${settings.timerMinutes} minutes, then a ${settings.breakMinutes}-minute break`, icon: "play", group: "Focus", keywords: "pomodoro", run: () => timer.dispatch({ type: "start" }) },
      { id: "timer-pause", title: "Pause focus timer", description: "Pick it up again whenever", icon: "pause", group: "Focus", run: () => timer.dispatch({ type: "pause" }) },
      { id: "timer-reset", title: "Stop focus timer", description: "Reset to the start", icon: "reset", group: "Focus", run: () => timer.dispatch({ type: "reset" }) },
      { id: "ai", title: "AI study helper", description: "Explain, summarize, flashcards, quiz, next steps", icon: "sparkle", group: "AI", keywords: "explain summarize flashcards quiz steps where was i", run: () => { goZone("note"); setTimeout(() => setDockOpen("ai"), 60); } },
      { id: "print", title: printLayout ? "Hide page breaks" : "Show page breaks", description: "See where A4 pages end when printed", icon: "printer", group: "View", keywords: "print layout", run: () => setPrintLayout((p) => !p) },
      { id: "outline", title: outlineOpen ? "Hide outline" : "Show outline", description: "Headings of this note, to jump around", icon: "list", group: "View", shortcut: "Ctrl+Shift+O", run: () => setOutlineOpen((o) => !o) },
      { id: "import", title: "Import files", description: "Notes, PDFs, images or a .zip", icon: "import", group: "Import and export", run: () => fileInput.current?.click() },
      { id: "import-folder", title: "Import a folder", description: "Bring in an Obsidian vault or any folder", icon: "folder", group: "Import and export", run: () => folderInput.current?.click() },
      { id: "export-zip", title: "Export vault as .zip", description: "Every note and attachment, as plain files", icon: "export", group: "Import and export", run: () => void exportVaultZip(vault) },
      { id: "settings", title: "Settings", description: "Theme, fonts, timer, AI, account", icon: "settings", group: "Settings", run: () => setSettingsOpen(true) },
      { id: "settings-ai", title: "AI settings", description: "Built-in AI or your own API key", icon: "key", group: "Settings", keywords: "api key anthropic", run: () => setSettingsOpen("ai") },
      { id: "theme-edit", title: "Customize theme", description: "Pick every color yourself", icon: "pencil", group: "Settings", run: () => setThemeEditor(true) },
      ...[...findThemes(customThemes)].map((t): Command => ({ id: `theme-${t.id}`, title: `Theme: ${t.name}`, description: t.base === "dark" ? "Dark theme" : "Light theme", icon: "moon", group: "Settings", run: () => void vault.saveSettings({ theme: t.id }) })),
      ...records.filter((r) => r.id !== record.id).map((r): Command => ({ id: `vault-${r.id}`, title: `Switch to ${r.name}`, description: r.kind === "browser" ? "Vault in this browser" : "Folder vault", icon: "folder", group: "Vaults", run: () => onSwitchVault(r) })),
    ];
    if (layout.note) {
      const p = layout.note;
      list.push(
        { id: "export-pdf", title: "Export note as PDF", description: "A4, ready to print or hand in", icon: "printer", group: "Import and export", run: () => void exportNote(vault, p, "pdf") },
        { id: "export-md", title: "Export note as Markdown", description: "The .md file as it is", icon: "file", group: "Import and export", run: () => void exportNote(vault, p, "md") },
        { id: "export-html", title: "Export note as HTML", description: "A web page", icon: "file", group: "Import and export", run: () => void exportNote(vault, p, "html") },
      );
    }
    for (const f of vault.files.keys()) {
      if (f.endsWith(".pdf")) list.push({ id: `pdf:${f}`, title: basename(f), description: "PDF", icon: "pdf", group: "Files", run: () => openPath(f) });
    }
    for (const n of vault.notes.values()) {
      list.push({ id: `note:${n.path}`, title: n.name, description: [n.path.includes("/") ? n.path.slice(0, n.path.lastIndexOf("/")) : "", n.tags.map((t) => `#${t}`).join(" ")].filter(Boolean).join(" · ") || "Note", icon: "file", group: "Notes", keywords: n.tags.join(" "), run: () => openPath(n.path) });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault, version, focusMode, printLayout, outlineOpen, layout.note, customThemes, records, record.id, goZone, settings]);

  // ----- dock -----
  const ed = () => pane.current?.editor;
  const noNote = !layout.note || layout.view !== "note";
  const bar: BarItem[] = [
    {
      id: "tools",
      label: "Format",
      icon: "tools",
      panel: (close) => (
        <>
          <h3>Text</h3>
          <ActionGrid
            actions={[
              { label: "Bold", desc: "Make it stand out", hint: "Ctrl+B", onClick: () => ed()?.wrap("**") },
              { label: "Italic", desc: "Slanted emphasis", hint: "Ctrl+I", onClick: () => ed()?.wrap("_") },
              { label: "Highlight", desc: "Like a marker pen", hint: "Ctrl+Shift+H", onClick: () => ed()?.wrap("==") },
              { label: "Strikethrough", desc: "Cross it out", onClick: () => ed()?.wrap("~~") },
              { label: "Code", desc: "Monospaced text", hint: "Ctrl+E", onClick: () => ed()?.wrap("`") },
            ].map((x) => ({ ...x, disabled: noNote }))}
          />
          <h3>Structure</h3>
          <ActionGrid
            actions={[
              { label: "Heading 1", desc: "Big section title", onClick: () => ed()?.prefix("# ") },
              { label: "Heading 2", desc: "Medium section title", onClick: () => ed()?.prefix("## ") },
              { label: "Heading 3", desc: "Small section title", onClick: () => ed()?.prefix("### ") },
              { label: "Bullet list", desc: "Points with dots", onClick: () => ed()?.prefix("- ") },
              { label: "Numbered list", desc: "Steps in order", onClick: () => ed()?.prefix("1. ") },
              { label: "Checklist", desc: "Boxes to tick off", onClick: () => ed()?.prefix("- [ ] ") },
              { label: "Quote", desc: "Indented quotation", onClick: () => ed()?.prefix("> ") },
            ].map((x) => ({ ...x, disabled: noNote }))}
          />
          <h3>View</h3>
          <ActionGrid
            actions={[
              { label: focusMode ? "Leave focus mode" : "Focus mode", desc: "Fade all but this paragraph", icon: "focus", hint: "Ctrl+.", onClick: () => { setFocusMode((f) => !f); close(); } },
              { label: outlineOpen ? "Hide outline" : "Outline", desc: "Jump between headings", icon: "list", onClick: () => { setOutlineOpen((o) => !o); close(); } },
              { label: printLayout ? "Hide page breaks" : "Page breaks", desc: "Where A4 pages end", icon: "printer", onClick: () => { setPrintLayout((p) => !p); close(); } },
              { label: "Collapse all", desc: "Fold every section", onClick: () => ed()?.foldAll(), disabled: noNote },
              { label: "Expand all", desc: "Unfold every section", onClick: () => ed()?.unfoldAll(), disabled: noNote },
              { label: "All commands", desc: "Search everything", icon: "search", hint: "Ctrl+K", onClick: () => { close(); setPaletteOpen(true); } },
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
        <AiPanel
          vault={vault}
          account={account}
          getSource={(tool) => {
            const e = ed();
            if (!e || noNote) return null;
            const sel = e.selection();
            const doc = e.view?.state.doc.toString() ?? "";
            if (tool === "whereWasI") return { text: doc.slice(Math.max(0, e.cursor() - 6000), e.cursor()), label: "the text before your cursor" };
            if (sel.trim()) return { text: sel, label: `your selection (${sel.trim().split(/\s+/).length} words)` };
            return { text: doc, label: `the whole note “${noteName(layout.note!)}”` };
          }}
          insert={(md) => ed()?.insert(md, { block: true })}
          onOpenSettings={() => { setDockOpen(null); setSettingsOpen("ai"); }}
        />
      ),
    },
    {
      id: "insert",
      label: "Insert",
      icon: "plus",
      panel: (close) => (
        <ActionGrid
          actions={[
            { label: "Checklist", desc: "A box to tick off", icon: "checkSquare", onClick: () => { ed()?.insert("- [ ] ", { block: true }); close(); } },
            { label: "Task with date", desc: "Shows in Calendar", icon: "calendar", onClick: () => { ed()?.insert(`- [ ]  📅 ${new Date().toISOString().slice(0, 10)}`, { block: true, cursorOffset: 6 }); close(); } },
            { label: "Table", desc: "Rows and columns", icon: "activity", onClick: () => { ed()?.insert("| Column 1 | Column 2 |\n| --- | --- |\n|  |  |", { block: true }); close(); } },
            { label: "Callout", desc: "Box for side info", icon: "bulb", onClick: () => { ed()?.insert("> [!note] ", { block: true }); close(); } },
            { label: "Flashcard", desc: "Question :: Answer", icon: "copy", onClick: () => { ed()?.insert("Question :: Answer", { block: true }); close(); } },
            { label: "Link to note", desc: "Connect two notes", icon: "link", onClick: () => { ed()?.insert("[[]]", { cursorOffset: 2 }); close(); } },
            { label: "Image", desc: "From your computer", icon: "image", onClick: () => { insertImageInput.current?.click(); close(); } },
            { label: "PDF quote", desc: "With a page link", icon: "pdf", onClick: () => { hostAction.current("insert-pdf-quote"); close(); } },
            { label: "Divider", desc: "Horizontal line", icon: "chevronRight", onClick: () => { ed()?.insert("---", { block: true }); close(); } },
          ].map((a): GridAction => ({ ...a, icon: a.icon as IconName, disabled: noNote }))}
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
            { label: "Files", desc: "Notes, PDFs, images, .zip", icon: "file", onClick: () => { fileInput.current?.click(); close(); } },
            { label: "A folder", desc: "Obsidian vault or any folder", icon: "folder", onClick: () => { folderInput.current?.click(); close(); } },
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
            { label: "Note as PDF", desc: "A4, ready to print", icon: "printer", disabled: !layout.note, onClick: () => { void exportNote(vault, layout.note!, "pdf"); close(); } },
            { label: "Note as Markdown", desc: "The plain .md file", icon: "file", disabled: !layout.note, onClick: () => { void exportNote(vault, layout.note!, "md"); close(); } },
            { label: "Note as HTML", desc: "A web page", icon: "file", disabled: !layout.note, onClick: () => { void exportNote(vault, layout.note!, "html"); close(); } },
            { label: "Whole vault", desc: "Everything as a .zip", icon: "folder", onClick: () => { void exportVaultZip(vault); close(); } },
          ]}
        />
      ),
    },
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
  const zone = layout.view === "note" && !layout.note ? "home" : layout.view;
  const zoneMeta = ZONES.find((z) => z.id === zone)!;

  return (
    <div className={`app${focusMode ? " focus-mode" : ""}`}>
      <nav className="rail" aria-label="Zones">
        <button className="rail-logo" onClick={() => goZone("home")} title={vault.name} aria-label="Home">
          <img src="/icons/icon128.png" className="app-logo" alt="" width={44} height={44} />
        </button>
        <div className="rail-zones">
          {ZONES.map((z, i) => (
            <button
              key={z.id}
              className="rail-item w-glow"
              aria-current={zone === z.id ? "page" : undefined}
              onClick={() => goZone(z.id)}
              title={`${z.label} (Alt+${i + 1})`}
            >
              <Icon name={z.icon} size={20} />
              <span>{z.label}</span>
            </button>
          ))}
          <button className="rail-item w-glow" onClick={() => { if (zone !== "note") goZone("note"); openTab({ kind: "scratch" }); }} title="Scratch pad (Ctrl+/)">
            <Icon name="scratch" size={20} />
            <span>Scratch</span>
          </button>
        </div>
        <div className="rail-bottom">
          <button className="rail-item w-glow" onClick={() => setPaletteOpen(true)} title="Commands (Ctrl+K)">
            <Icon name="search" size={20} />
            <span>Search</span>
          </button>
          <button className="rail-item w-glow" onClick={() => setSettingsOpen(true)} title="Settings">
            <Icon name="settings" size={20} />
            <span>Settings</span>
          </button>
          {account ? (
            <button className="rail-item rail-avatar w-glow" onClick={() => setSettingsOpen(true)} title={account.email} aria-label={`Account: ${account.email}`}>
              <span className="avatar">{account.email[0]!.toUpperCase()}</span>
            </button>
          ) : (
            account === null && (
              <a className="rail-item w-glow" href="/login" title="Sign in">
                <Icon name="user" size={20} />
                <span>Sign in</span>
              </a>
            )
          )}
        </div>
      </nav>

      <div className="stage">
        <header className="topbar">
          <div className="topbar-left">
            {zone === "note" && layout.note ? (
              <>
                <span className="topbar-zone w-muted">{vault.name}</span>
                <span className="topbar-crumb">{noteName(layout.note)}</span>
              </>
            ) : (
              <span className="topbar-zone">{zoneMeta.label}</span>
            )}
          </div>
          <FocusTimer timer={timer} onDurationChange={(m) => void vault.saveSettings({ timerMinutes: m })} />
          <div className="topbar-right">
            {syncing !== "off" && (
              <span className={`sync-dot sync-${syncing}`} title={syncing === "busy" ? "Syncing…" : syncing === "error" ? "Sync paused. Will retry." : "Synced"}>
                <Icon name="cloud" size={16} />
              </span>
            )}
            {zone === "note" && (
              <>
                <button className="w-icon-btn" aria-pressed={showLeft} onClick={() => (layout.tabs.length ? setLayout((l) => ({ ...l, leftOpen: !l.leftOpen })) : openTab({ kind: "tasks" }))} aria-label="Side pane" title="Side pane">
                  <Icon name="split" />
                </button>
                <button className="w-icon-btn" aria-pressed={outlineOpen} onClick={() => setOutlineOpen((o) => !o)} aria-label="Outline" title="Outline (Ctrl+Shift+O)">
                  <Icon name="list" />
                </button>
              </>
            )}
            <button className="topbar-search w-glow" onClick={() => setPaletteOpen(true)} aria-label="Search and commands">
              <Icon name="search" size={15} />
              <span>Search or run a command</span>
              <kbd>Ctrl K</kbd>
            </button>
          </div>
        </header>

        <main className="main" key={zone}>
          {zone === "home" && (
            <Home
              vault={vault}
              version={version}
              records={records}
              currentId={record.id}
              onSwitchVault={onSwitchVault}
              onOpen={(p, o) => openPath(p, o)}
              onNewNote={(folder) => void newNote({ folder })}
              onZone={goZone}
              initialTag={homeTag}
              key={homeTag ?? ""}
            />
          )}
          {zone === "calendar" && <div className="zone-full"><CalendarWorkspace {...wsProps} standalone /></div>}
          {zone === "tasks" && (
            <div className="zone-full zone-narrow">
              <header className="zone-head zone-head-pad">
                <div>
                  <h1>Tasks</h1>
                  <p className="w-muted">Every checklist item from every note. Ticking one updates its note.</p>
                </div>
              </header>
              <TasksWorkspace {...wsProps} />
            </div>
          )}
          {zone === "activity" && <ActivityWorkspace {...wsProps} />}
          {zone === "note" && layout.note && (
            <div className={`split${showLeft ? " split-open" : ""}`}>
              {showLeft && (
                <section className="left-pane" aria-label="Side pane">
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

        {(zone === "note" || zone === "home") && <BottomBar items={bar} openId={dockOpen} onOpenChange={setDockOpen} />}
      </div>

      {paletteOpen && <CommandPalette open onClose={() => setPaletteOpen(false)} commands={commands} />}
      {settingsOpen && (
        <SettingsModal
          vault={vault}
          vaultId={record.id}
          account={account}
          customThemes={customThemes}
          section={settingsOpen === "ai" ? "ai" : undefined}
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

