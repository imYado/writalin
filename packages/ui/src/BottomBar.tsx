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
export function BottomBar({ items, compact = false }: { items: BarItem[]; compact?: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!openId) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpenId(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenId(null);
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
            onClick={() => {
              if (it.panel) setOpenId((o) => (o === it.id ? null : it.id));
              else {
                setOpenId(null);
                it.onClick?.();
              }
            }}
            title={it.label}
          >
            <Icon name={it.icon} size={compact ? 18 : 20} />
            {!compact && <span>{it.label}</span>}
          </button>
        ))}
      </div>
    </nav>
  );
}

/** A grid of labelled buttons for dock panels (Tools, Insert, Export…). */
export function ActionGrid({ actions }: { actions: { label: string; icon?: IconName; hint?: string; onClick: () => void; disabled?: boolean }[] }) {
  return (
    <div className="w-action-grid">
      {actions.map((a) => (
        <button key={a.label} className="w-action" onClick={a.onClick} disabled={a.disabled} title={a.hint}>
          {a.icon && <Icon name={a.icon} size={16} />}
          <span>{a.label}</span>
          {a.hint && <kbd>{a.hint}</kbd>}
        </button>
      ))}
    </div>
  );
}
