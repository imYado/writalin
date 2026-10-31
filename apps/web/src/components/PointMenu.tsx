import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@writalin/ui";

export interface MenuItem {
  label: string;
  icon?: IconName;
  hint?: string;
  danger?: boolean;
  /** Opens a menu to the side instead (like Obsidian's Format, Paragraph and Insert). */
  submenu?: MenuItem[];
  onClick?: () => void;
}

export interface MenuSection {
  /** Small label above the items; omitted for the first section. */
  title?: string;
  items: MenuItem[];
  /** Short icon-or-letter buttons in one row, like Bold and Italic. */
  row?: { label: string; text: ReactNode; onClick: () => void }[];
}

/**
 * A small menu at a point on screen, kept inside the window.
 * Closes on Escape, a click outside, scrolling or picking an item.
 */
export function PointMenu({ x, y, sections, onClose, label }: { x: number; y: number; sections: MenuSection[]; onClose: () => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 8;
    setPos({
      left: Math.max(pad, Math.min(x, window.innerWidth - r.width - pad)),
      top: y + r.height + pad > window.innerHeight ? Math.max(pad, y - r.height) : y,
    });
    el.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const all = [...(ref.current?.querySelectorAll<HTMLElement>("button") ?? [])];
      const i = all.indexOf(document.activeElement as HTMLElement);
      all[(i + (e.key === "ArrowDown" ? 1 : -1) + all.length) % all.length]?.focus();
    };
    const onScroll = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  const pick = (fn?: () => void) => () => { onClose(); fn?.(); };
  const [sub, setSub] = useState<string | null>(null);
  const item = (it: MenuItem) => (
    <button
      key={it.label}
      className={`point-menu-item w-glow${it.danger ? " danger" : ""}`}
      role="menuitem"
      aria-haspopup={it.submenu ? "menu" : undefined}
      aria-expanded={it.submenu ? sub === it.label : undefined}
      // Keep the editor's selection while using the menu.
      onMouseDown={(e) => e.preventDefault()}
      onMouseEnter={() => setSub(it.submenu ? it.label : null)}
      onClick={it.submenu ? () => setSub((o) => (o === it.label ? null : it.label)) : pick(it.onClick)}
    >
      {it.icon ? <Icon name={it.icon} size={15} /> : <span className="point-menu-gap" />}
      <span>{it.label}</span>
      {it.hint && <kbd>{it.hint}</kbd>}
      {it.submenu && <Icon name="chevronRight" size={14} className="point-menu-more" />}
    </button>
  );
  return (
    <div ref={ref} className="w-popover point-menu" role="menu" aria-label={label} style={pos} onContextMenu={(e) => e.preventDefault()}>
      {sections.map((s, i) => (
        <div key={i} className="point-menu-section">
          {s.title && <div className="point-menu-title">{s.title}</div>}
          {s.row && (
            <div className="point-menu-row">
              {s.row.map((b) => (
                <button key={b.label} className="w-icon-btn point-menu-key" role="menuitem" title={b.label} aria-label={b.label} onClick={pick(b.onClick)}>
                  {b.text}
                </button>
              ))}
            </div>
          )}
          {s.items.map((it) =>
            it.submenu ? (
              <div key={it.label} className="point-menu-parent">
                {item(it)}
                {sub === it.label && <SubMenu items={it.submenu} label={it.label} onPick={pick} />}
              </div>
            ) : (
              item(it)
            ),
          )}
        </div>
      ))}
    </div>
  );
}

/** A menu beside its parent item, flipped to the other side or nudged up when it wouldn't fit. */
function SubMenu({ items, label, onPick }: { items: MenuItem[]; label: string; onPick: (fn?: () => void) => () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<{ left?: string; right?: string; top: number }>({ left: "100%", top: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    const p = parent.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const fitsRight = p.right + r.width + 8 < window.innerWidth;
    const fitsLeft = p.left - r.width - 8 > 0;
    const top = Math.min(0, window.innerHeight - 8 - (p.top + r.height));
    if (fitsRight) setStyle({ left: "calc(100% + 4px)", top });
    else if (fitsLeft) setStyle({ right: "calc(100% + 4px)", top });
    // Phones: no room at the side, so it opens below the item.
    else setStyle({ left: "8px", top: p.height });
  }, []);
  return (
    <div ref={ref} className="w-popover point-menu point-submenu" role="menu" aria-label={label} style={style}>
      {items.map((it) => (
        <button key={it.label} className="point-menu-item w-glow" role="menuitem" onMouseDown={(e) => e.preventDefault()} onClick={onPick(it.onClick)}>
          {it.icon ? <Icon name={it.icon} size={15} /> : <span className="point-menu-gap" />}
          <span>{it.label}</span>
          {it.hint && <kbd>{it.hint}</kbd>}
        </button>
      ))}
    </div>
  );
}
