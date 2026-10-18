import { useEffect, useState } from "react";
import { Emitter, uid } from "@writalin/shared";

interface ToastMsg {
  id: string;
  text: string;
  tone: "info" | "warn";
  action?: { label: string; run: () => void };
}

const bus = new Emitter<ToastMsg>();

/** Gentle, self-dismissing notice. No red badges, no sounds. */
export function toast(text: string, opts: { tone?: "info" | "warn"; action?: ToastMsg["action"] } = {}): void {
  bus.emit({ id: uid(), text, tone: opts.tone ?? "info", action: opts.action });
}

export function Toasts() {
  const [items, setItems] = useState<ToastMsg[]>([]);
  useEffect(
    () =>
      bus.on((t) => {
        setItems((xs) => [...xs.slice(-2), t]);
        setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), t.action ? 8000 : 4000);
      }),
    [],
  );
  return (
    <div className="w-toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`w-toast w-toast-${t.tone}`}>
          <span>{t.text}</span>
          {t.action && (
            <button className="w-btn w-btn-small" onClick={() => { t.action!.run(); setItems((xs) => xs.filter((x) => x.id !== t.id)); }}>
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
