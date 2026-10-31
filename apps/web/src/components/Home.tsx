import { useMemo, useState } from "react";
import type { CardScope, VaultRecord, Vault, WeakDeck } from "@writalin/vault";
import { isSystemNote, studyStats, tagMatches, taskDate, TASKS_PATH } from "@writalin/vault";
import { basename, isHiddenPath, isMarkdown, isoDate, noteName, dirname, type VaultPath } from "@writalin/shared";
import { Icon, toast } from "@writalin/ui";
import { ContributionGraph, useContributions } from "@writalin/workspaces";

interface Props {
  vault: Vault;
  version: number;
  records: VaultRecord[];
  currentId: string;
  onSwitchVault: (rec: VaultRecord | "new-folder" | "new-browser") => void;
  onOpen: (path: VaultPath, opts?: { line?: number }) => void;
  onNewNote: (folder?: string) => void;
  onDelete: (path: VaultPath) => void;
  onZone: (zone: "calendar" | "activity") => void;
  /** Start reviewing today's flashcards, all of them or one tag's or folder's. */
  onStudyDue: (scope?: CardScope) => void;
  /** Practise the hardest cards in one deck, without moving their due dates. */
  onPractise: (weak: WeakDeck) => void;
  /** Today's plan in one go, with the focus timer. */
  onStartStudying: () => void;
  initialTag?: string;
}

function greeting(): string {
  const h = new Date().getHours();
  return h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** Vault switcher, folders, recent notes, tags, search and today's tasks. */
export function Home({ vault, version, records, currentId, onSwitchVault, onOpen, onNewNote, onDelete, onZone, onStudyDue, onPractise, onStartStudying, initialTag }: Props) {
  const activity = useContributions(vault, version, 52, "both");
  const todayWords = vault.activity.days[isoDate()]?.words ?? 0;
  const [q, setQ] = useState("");
  const [tag, setTag] = useState(initialTag ?? "");
  const [folder, setFolder] = useState<string | null>(null);
  const today = isoDate();

  const tags = useMemo(() => [...vault.tagCounts()].slice(0, 40), [vault, version]);
  const folders = useMemo(() => vault.folders().filter((f) => !f.startsWith("attachments")), [vault, version]);
  const hits = useMemo(() => (q.trim() ? vault.search.search(q, 20) : []), [vault, version, q]);
  const notes = useMemo(() => {
    let list = [...vault.notes.values()];
    if (tag) list = list.filter((n) => n.tags.some((t) => tagMatches(t, tag)));
    if (folder != null) list = list.filter((n) => dirname(n.path) === folder);
    return list.filter((n) => !isSystemNote(n.path)).sort((a, b) => b.mtime - a.mtime).slice(0, tag || folder != null ? 200 : 12);
  }, [vault, version, tag, folder]);
  /** "" for every card, `#tag` or `/folder` for one deck. */
  const [deck, setDeck] = useState("");
  const decks = useMemo(() => {
    const withCards = [...vault.notes.values()].filter((n) => n.flashcards.length && !isSystemNote(n.path));
    const tagSet = new Set(withCards.flatMap((n) => n.tags));
    const folderSet = new Set(withCards.map((n) => dirname(n.path)).filter(Boolean));
    return { tags: [...tagSet].sort(), folders: [...folderSet].sort() };
  }, [vault, version]);
  const scope: CardScope = deck.startsWith("#") ? { tag: deck.slice(1) } : deck.startsWith("/") ? { folder: deck.slice(1) } : {};
  const study = useMemo(() => {
    const all = [...vault.notes.values()].flatMap((n) => n.flashcards);
    const queue = vault.studyQueue(scope, today);
    const waiting = vault.dueCards(today, scope).length - queue.length;
    return { total: all.length, due: queue.length, fresh: queue.filter((c) => !c.schedule).length, waiting, ...studyStats(vault.activity) };
  }, [vault, version, today, deck]);
  const [allFiles, setAllFiles] = useState(false);
  /** Imported files (PDFs, images, anything that isn't a note), newest first. */
  const files = useMemo(
    () => [...vault.files.values()].filter((f) => !isMarkdown(f.path) && !isHiddenPath(f.path) && !f.path.startsWith(".writalin/")).sort((a, b) => b.mtime - a.mtime),
    [vault, version],
  );
  const plan = useMemo(() => vault.studyPlan(today), [vault, version, today]);
  const planMinutes = plan.minutes + (plan.weak ? Math.max(1, Math.round((plan.weak.cards.length * 8) / 60)) : 0);
  const dueToday = useMemo(
    () => vault.allTasks().filter((t) => t.status === "todo" && t.path !== TASKS_PATH && taskDate(t) != null && taskDate(t)! <= today).sort((a, b) => (taskDate(a)! + (a.time ?? "")).localeCompare(taskDate(b)! + (b.time ?? ""))),
    [vault, version, today],
  );

  return (
    <div className="home">
      <div className="home-inner">
        <header className="home-head">
          <div>
            <h1 className="home-title">{greeting()}</h1>
            <div className="vault-switch">
            <label className="w-sr-only" htmlFor="vault-select">Vault</label>
            <select
              id="vault-select"
              className="w-input"
              value={currentId}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "new-folder" || v === "new-browser") onSwitchVault(v);
                else onSwitchVault(records.find((r) => r.id === v)!);
              }}
            >
              {records.map((r) => (
                <option key={r.id} value={r.id}>{r.name}{r.kind === "browser" ? " (in browser)" : ""}</option>
              ))}
              <option value="new-folder">Open another folder…</option>
              <option value="new-browser">New vault in this browser…</option>
            </select>
            </div>
          </div>
        </header>

        <div className="home-search w-glow">
          <Icon name="search" />
          <input className="w-input" placeholder="Search notes…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search notes" />
        </div>

        {q.trim() ? (
          <section className="home-section">
            <h2>Results</h2>
            {hits.length === 0 && <p className="w-muted">No notes match “{q}”.</p>}
            <ul className="note-list">
              {hits.map((h) => (
                <li key={h.path}>
                  <button className="w-glow" onClick={() => onOpen(h.path)}>
                    <span className="note-list-name">{noteName(h.path)}</span>
                    <span className="note-list-snippet">{h.snippet}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <>
          <section className="home-card home-activity">
            <div className="home-card-head">
              <div>
                <h2>Your writing</h2>
                <p className="w-muted w-small">
                  {todayWords > 0 ? `${todayWords.toLocaleString()} words today` : "Nothing written yet today"}
                  {activity.currentStreak > 1 ? ` · ${activity.currentStreak}-day streak` : ""}
                </p>
              </div>
              <button className="w-btn w-btn-small w-btn-ghost" onClick={() => onZone("activity")}>
                See all <Icon name="chevronRight" size={14} />
              </button>
            </div>
            <div className="contrib-mini"><ContributionGraph summary={activity} /></div>
          </section>
          <div className="home-grid">
            <section className="home-section">
              <h2 className="home-h2-row">
                {tag ? `#${tag}` : folder != null ? folder || "Top level" : "Recent"}
                {folder != null && <button className="w-btn w-btn-small w-btn-ghost" onClick={() => onNewNote(folder || undefined)}><Icon name="plus" size={14} /> New note here</button>}
              </h2>
              {notes.length === 0 && (
                <p className="w-muted">
                  {vault.notes.size ? "Nothing here yet." : <>Your vault is empty. <button className="w-link" onClick={() => onNewNote()}>Start a new note</button>.</>}
                </p>
              )}
              <ul className="note-list">
                {notes.map((n) => (
                  <li key={n.path} className="note-list-row">
                    <button className="w-glow" onClick={() => onOpen(n.path)}>
                      <span className="note-list-name">{n.name}</span>
                      <span className="note-list-meta">{dirname(n.path) || "—"} · {new Date(n.mtime).toLocaleDateString()}</span>
                    </button>
                    <button className="note-list-del" onClick={() => onDelete(n.path)} aria-label={`Delete ${n.name}`} title="Delete note">
                      <Icon name="trash" size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
            <aside className="home-side">
              <section className="home-section">
                <h2 className="home-h2-row">Today <button className="w-btn w-btn-small w-btn-ghost" onClick={() => onZone("calendar")}>Calendar <Icon name="chevronRight" size={14} /></button></h2>
                {(plan.cards.length > 0 || plan.weak) && (
                  <div className="today-plan">
                    <ul className="today-plan-list">
                      {plan.cards.length > 0 && (
                        <li>
                          <Icon name="copy" size={16} />
                          <span>
                            <strong>{plan.cards.length} card{plan.cards.length === 1 ? "" : "s"} to review</strong>
                            <span className="w-muted w-small">About {plan.minutes} min{plan.fresh ? ` · ${plan.fresh} new` : ""}</span>
                          </span>
                          <button className="w-btn w-btn-small" onClick={() => onStudyDue()}>Review</button>
                        </li>
                      )}
                      {plan.weak && (
                        <li>
                          <Icon name="focus" size={16} />
                          <span>
                            <strong>Practise {plan.weak.label}</strong>
                            <span className="w-muted w-small">{plan.weak.cards.length} cards you often miss</span>
                          </span>
                          <button className="w-btn w-btn-small" onClick={() => onPractise(plan.weak!)}>Practise</button>
                        </li>
                      )}
                    </ul>
                    <button className="w-btn w-btn-primary today-plan-start" onClick={onStartStudying}>
                      <Icon name="play" size={14} /> Start studying · about {planMinutes} min
                    </button>
                  </div>
                )}
                {dueToday.length === 0 ? (
                  <p className="w-muted">{plan.cards.length || plan.weak ? "No tasks due." : "Nothing due. Enjoy the calm."}</p>
                ) : (
                  <ul className="today-list">
                    {dueToday.slice(0, 8).map((t) => (
                      <li key={`${t.path}:${t.line}`}>
                        <input
                          type="checkbox"
                          aria-label={`Complete: ${t.text}`}
                          onChange={() => void vault.toggleTask(t).catch((e) => toast((e as Error).message, { tone: "warn" }))}
                        />
                        <button onClick={() => onOpen(t.path, { line: t.line })}>
                          {t.time && <span className="w-muted">{t.time} </span>}
                          {t.text}
                          {taskDate(t)! < today && <span className="task-late"> · overdue</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              {(study.total > 0 || study.quizzesWeek > 0) && (
                <section className="home-section home-study">
                  <h2 className="home-h2-row">
                    Study
                    {(decks.tags.length > 0 || decks.folders.length > 0) && (
                      <>
                        <label className="w-sr-only" htmlFor="study-deck">Cards to study</label>
                        <select id="study-deck" className="w-input home-study-deck" value={deck} onChange={(e) => setDeck(e.target.value)}>
                          <option value="">All cards</option>
                          {decks.tags.length > 0 && <optgroup label="Tags">{decks.tags.map((t) => <option key={t} value={`#${t}`}>#{t}</option>)}</optgroup>}
                          {decks.folders.length > 0 && <optgroup label="Folders">{decks.folders.map((f) => <option key={f} value={`/${f}`}>{f}</option>)}</optgroup>}
                        </select>
                      </>
                    )}
                  </h2>
                  <div className="home-study-due">
                    <div>
                      <strong>{study.due ? `${study.due} card${study.due === 1 ? "" : "s"} to review` : study.waiting ? "Done for today" : "All caught up"}</strong>
                      <span className="w-muted w-small">
                        {study.due
                          ? study.fresh ? `${study.fresh} new` : "Due today"
                          : study.waiting ? `${study.waiting} more wait for tomorrow (daily limit)` : `${study.total} card${study.total === 1 ? "" : "s"} scheduled for later`}
                      </span>
                    </div>
                    {study.due > 0 && (
                      <button className="w-btn w-btn-primary w-btn-small" onClick={() => onStudyDue(scope)}>
                        <Icon name="play" size={14} /> Review
                      </button>
                    )}
                  </div>
                  <ul className="home-study-stats">
                    <li><strong>{study.streak}</strong><span>day streak</span></li>
                    <li><strong>{study.cardsWeek}</strong><span>cards this week</span></li>
                    <li><strong>{study.quizPercentWeek == null ? "–" : `${study.quizPercentWeek}%`}</strong><span>{study.quizzesWeek ? `right in ${study.quizzesWeek} quiz${study.quizzesWeek === 1 ? "" : "zes"}` : "no quizzes this week"}</span></li>
                  </ul>
                </section>
              )}
              {files.length > 0 && (
                <section className="home-section">
                  <h2>Files</h2>
                  <ul className="note-list file-list">
                    {(allFiles ? files : files.slice(0, 6)).map((f) => (
                      <li key={f.path} className="note-list-row">
                        <button className="w-glow" onClick={() => onOpen(f.path)} title={f.path}>
                          <span className="note-list-name">
                            <Icon name={/\.pdf$/i.test(f.path) ? "pdf" : /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(f.path) ? "image" : "file"} size={14} /> {basename(f.path)}
                          </span>
                          <span className="note-list-meta">{dirname(f.path) || "—"} · {(f.size / 1024 / 1024).toFixed(f.size > 1024 * 1024 ? 1 : 2)} MB</span>
                        </button>
                        <button className="note-list-del" onClick={() => onDelete(f.path)} aria-label={`Delete ${basename(f.path)}`} title="Delete file">
                          <Icon name="trash" size={14} />
                        </button>
                      </li>
                    ))}
                  </ul>
                  {files.length > 6 && <button className="w-link" onClick={() => setAllFiles((a) => !a)}>{allFiles ? "Show fewer" : `Show all ${files.length}`}</button>}
                </section>
              )}
              {folders.length > 0 && (
                <section className="home-section">
                  <h2>Folders</h2>
                  <div className="chip-wrap">
                    <button className="w-chip" aria-pressed={folder === ""} onClick={() => setFolder((f) => (f === "" ? null : ""))}>Top level</button>
                    {folders.map((f) => (
                      <button key={f} className="w-chip" aria-pressed={folder === f} onClick={() => { setFolder((x) => (x === f ? null : f)); setTag(""); }}>
                        <Icon name="folder" size={12} /> {f}
                      </button>
                    ))}
                  </div>
                </section>
              )}
              {tags.length > 0 && (
                <section className="home-section">
                  <h2>Tags</h2>
                  <div className="chip-wrap">
                    {tags.map(([t, n]) => (
                      <button key={t} className="w-chip" aria-pressed={tag === t} onClick={() => { setTag((x) => (x === t ? "" : t)); setFolder(null); }}>
                        #{t} <span className="w-muted">{n}</span>
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </aside>
          </div>
          </>
        )}
      </div>
    </div>
  );
}
