import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "./icons";

export function Modal({ title, onClose, children, width = 520 }: { title: string; onClose: () => void; children: ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("input, button, select, textarea, [tabindex]");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && ref.current) {
        // Keep keyboard focus inside the dialog.
        const els = [...ref.current.querySelectorAll<HTMLElement>("input, button, select, textarea, a[href], [tabindex]:not([tabindex='-1'])")].filter((el) => !el.hasAttribute("disabled"));
        if (!els.length) return;
        const [a, z] = [els[0]!, els[els.length - 1]!];
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          z.focus();
        } else if (!e.shiftKey && document.activeElement === z) {
          e.preventDefault();
          a.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="w-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-modal" role="dialog" aria-modal="true" aria-label={title} ref={ref} style={{ maxWidth: width }}>
        <header className="w-modal-head">
          <h2>{title}</h2>
          <button className="w-icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>
        <div className="w-modal-body">{children}</div>
      </div>
    </div>
  );
}
