import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./icons";

export interface BarItem {
  id: string;
  label: string;
  icon: IconName;
  onClick?: () => void;
  /** Content shown in a panel above the dock. Receives a close callback. */
  panel?: (close: () => void) => ReactNode;
  active?: boolean;
}

/** One calm dock at the bottom. Panels open upward, one at a time. */
export function BottomBar({ items, compact = false, openId: controlled, onOpenChange }: {
  items: BarItem[];
  compact?: boolean;
  /** Control which panel is open (e.g. open AI from the command palette). */
  openId?: string | null;
  onOpenChange?: (id: string | null) => void;
}) {
  const [own, setOwn] = useState<string | null>(null);
  const openId = controlled !== undefined ? controlled : own;
  const setOpenId = (v: string | null | ((o: string | null) => string | null)) => {
    const next = typeof v === "function" ? v(openId) : v;
    setOwn(next);
    onOpenChange?.(next);
  };
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!openId) return;
    // A window opened from the panel (a quiz, a study session) sits on top of
    // it; using or closing that window shouldn't close the panel underneath.
    const inModal = (t: EventTarget | null) => t instanceof Element && !!t.closest(".w-overlay");
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && !inModal(e.target) && setOpenId(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector(".w-overlay") && setOpenId(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openId]);
  const open = items.find((i) => i.id === openId);
  return (
    <nav className={`w-dock${compact ? " w-dock-compact" : ""}`} aria-label="Main" ref={ref}>
      {open?.panel && (
        <div className="w-dock-panel" role="dialog" aria-label={open.label}>
          {open.panel(() => setOpenId(null))}
        </div>
      )}
      <div className="w-dock-items">
        {items.map((it) => (
          <button
            key={it.id}
            className="w-dock-item"
            aria-pressed={it.active || openId === it.id}
            aria-haspopup={it.panel ? "dialog" : undefined}
            aria-expanded={it.panel ? openId === it.id : undefined}
            // Keep focus in the note, so a phone keyboard stays up while you format.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (it.panel) setOpenId((o) => (o === it.id ? null : it.id));
              else {
                setOpenId(null);
                it.onClick?.();
              }
            }}
            title={it.label}
          >
            <Icon name={it.icon} size={18} />
            {!compact && <span>{it.label}</span>}
          </button>
        ))}
      </div>
    </nav>
  );
}

/** A grid of labelled buttons for dock panels (Tools, Insert, Export…). */
export interface GridAction {
  label: string;
  /** Small second line saying what it does. */
  desc?: string;
  icon?: IconName;
  hint?: string;
  onClick: () => void;
  disabled?: boolean;
}

export function ActionGrid({ actions }: { actions: GridAction[] }) {
  return (
    <div className="w-action-grid">
      {actions.map((a) => (
        <button key={a.label} className="w-action" onMouseDown={(e) => e.preventDefault()} onClick={a.onClick} disabled={a.disabled} title={a.hint}>
          {a.icon && <Icon name={a.icon} size={16} />}
          <span className="w-action-text">
            <span className="w-action-label">{a.label}</span>
            {a.desc && <span className="w-action-desc">{a.desc}</span>}
          </span>
          {a.hint && <kbd>{a.hint}</kbd>}
        </button>
      ))}
    </div>
  );
}
