import { useLayoutEffect, useState } from "react";
import { basename, type VaultPath } from "@writalin/shared";
import { Icon, type IconName } from "@writalin/ui";
import type { Vault } from "@writalin/vault";

interface Props {
  vault: Vault;
  version: number;
  onUploadPdf: () => void;
  onOpenPdf: (path: VaultPath) => void;
  onAi: () => void;
  onTasks: () => void;
  onScratch: () => void;
  onCalendar: () => void;
  onImport: () => void;
  onTour: () => void;
}

/**
 * What the side pane shows for a fresh note: the things you can keep next to
 * it while you study, each one click away.
 */
export function StudySide({ vault, version, onUploadPdf, onOpenPdf, onAi, onTasks, onScratch, onCalendar, onImport, onTour }: Props) {
  void version;
  const pdfs = [...vault.files.values()].filter((f) => f.path.toLowerCase().endsWith(".pdf")).sort((a, b) => b.mtime - a.mtime).slice(0, 5);
  const tools: { id: string; icon: IconName; label: string; desc: string; run: () => void }[] = [
    { id: "ai", icon: "sparkle", label: "AI study helper", desc: "Summarize, explain, flashcards, quiz me", run: onAi },
    { id: "tasks", icon: "checkSquare", label: "Tasks", desc: "A checklist for this note", run: onTasks },
    { id: "scratch", icon: "scratch", label: "Scratch pad", desc: "Park stray thoughts so you stay on track", run: onScratch },
    { id: "calendar", icon: "calendar", label: "Calendar", desc: "Deadlines and reminders", run: onCalendar },
    { id: "import", icon: "image", label: "Image or other file", desc: "Pictures, notes or a .zip", run: onImport },
  ];
  return (
    <div className="ws study-home">
      <div className="ws-scroll study-side-scroll">
        <header className="study-side-head">
          <h2>Study side</h2>
          <p className="w-muted">Keep what you're learning from right next to your note.</p>
        </header>

        <button className="study-side-pdf w-glow" data-tour="pdf" onClick={onUploadPdf}>
          <span className="study-side-icon"><Icon name="pdf" size={22} /></span>
          <span>
            <strong>Add a PDF</strong>
            <small>Read it here while you write. Highlight text to quote it or ask AI.</small>
          </span>
          <Icon name="plus" size={18} />
        </button>
        {pdfs.length > 0 && (
          <div className="study-side-recent">
            <span className="w-muted w-small">Your PDFs</span>
            {pdfs.map((f) => (
              <button key={f.path} className="study-side-chip" onClick={() => onOpenPdf(f.path)} title={f.path}>
                <Icon name="pdf" size={14} /> {basename(f.path).replace(/\.pdf$/i, "")}
              </button>
            ))}
          </div>
        )}

        <div className="study-side-grid" data-tour="tools">
          {tools.map((t) => (
            <button key={t.id} className="w-action" onClick={t.run}>
              <Icon name={t.icon} size={18} />
              <span className="w-action-text">
                <span className="w-action-label">{t.label}</span>
                <span className="w-action-desc">{t.desc}</span>
              </span>
            </button>
          ))}
        </div>

        <p className="w-muted w-small study-side-tip">
          Tip: write <code>Question :: Answer</code> in your note to make a flashcard. <button className="ai-link" onClick={onTour}>Show me around</button>
        </p>
      </div>
    </div>
  );
}

export interface TourStep {
  /** CSS selector of the thing to point at; the step is skipped if it isn't on screen. */
  target: string;
  title: string;
  body: string;
}

export const STUDY_TOUR: TourStep[] = [
  { target: ".left-pane", title: "This is your study side", body: "Sources and tools live here, next to your note, so you don't lose your place switching tabs." },
  { target: "[data-tour=pdf]", title: "Add a PDF", body: "Upload a PDF to read beside your note. Highlight text to quote it with a page link, or ask AI about it." },
  { target: ".w-dock-item[title=\"AI\"]", title: "AI study helper", body: "Summarize, explain simply, make flashcards or quiz yourself on your note or a PDF. Add your own AI key in Settings." },
  { target: ".tab-adder", title: "Add more anytime", body: "Use + to open another PDF, tasks for this note, a scratch pad or the calendar." },
  { target: ".right-pane", title: "Write here", body: "Type / for blocks like tables and images. A line like Question :: Answer becomes a flashcard you can study." },
];

const TOUR_KEY = "writalin.tour.study.v1";
export function tourSeen(): boolean {
  try {
    return localStorage.getItem(TOUR_KEY) === "1";
  } catch {
    return true;
  }
}
function markTourSeen() {
  try {
    localStorage.setItem(TOUR_KEY, "1");
  } catch {
    // Private mode: the tour may show again next time, which is fine.
  }
}

/** A few coach marks that point at the real controls, one at a time. */
export function Tour({ steps, onClose }: { steps: TourStep[]; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const live = steps.filter((s) => document.querySelector(s.target));
  const step = live[Math.min(i, live.length - 1)];

  useLayoutEffect(() => {
    if (!step) return;
    const measure = () => setRect(document.querySelector(step.target)?.getBoundingClientRect() ?? null);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [step]);

  const close = () => {
    markTourSeen();
    onClose();
  };
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  if (!step || !rect) return null;
  const last = i >= live.length - 1;
  const pad = 6;
  // Put the card beside the target if there's room, else below or above it.
  const cardW = 300;
  const right = rect.right + 16 + cardW < window.innerWidth;
  const left = rect.left - 16 - cardW > 0;
  const below = rect.bottom + 200 < window.innerHeight;
  const style: React.CSSProperties = right && rect.width < window.innerWidth / 2
    ? { left: rect.right + 16, top: Math.min(Math.max(16, rect.top), window.innerHeight - 220) }
    : left && rect.width < window.innerWidth / 2
      ? { left: rect.left - 16 - cardW, top: Math.min(Math.max(16, rect.top), window.innerHeight - 220) }
      : below
        ? { left: Math.min(Math.max(16, rect.left), window.innerWidth - cardW - 16), top: rect.bottom + 16 }
        : { left: Math.min(Math.max(16, rect.left), window.innerWidth - cardW - 16), top: Math.max(16, rect.top - 200) };

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label="Quick tour">
      <div className="tour-spot" style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} />
      <div className="tour-card" style={{ ...style, width: cardW }}>
        <span className="w-muted w-small">{i + 1} of {live.length}</span>
        <h3>{step.title}</h3>
        <p>{step.body}</p>
        <div className="w-row tour-actions">
          <button className="w-btn w-btn-ghost w-btn-small" onClick={close}>Skip</button>
          {i > 0 && <button className="w-btn w-btn-small" onClick={() => setI(i - 1)}>Back</button>}
          <button className="w-btn w-btn-primary w-btn-small" autoFocus onClick={() => (last ? close() : setI(i + 1))}>{last ? "Got it" : "Next"}</button>
        </div>
      </div>
    </div>
  );
}
