/** Controls whose background gradient follows the cursor (see styles.css). */
export const GLOW_SELECTOR = ".w-glow, .w-btn, .w-icon-btn, .w-chip, .w-dock-item, .w-action, .w-palette-item";

/**
 * One document-level pointer listener that tells the hovered control where
 * the cursor is, as --mx/--my. Cheap: one rAF-batched style write per frame,
 * and nothing at all on touch or when motion is reduced.
 */
export function installGlow(root: Document = document): () => void {
  if (typeof window === "undefined") return () => {};
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return () => {};
  let frame = 0;
  let last: PointerEvent | null = null;
  const apply = () => {
    frame = 0;
    const e = last;
    if (!e) return;
    const el = (e.target as Element | null)?.closest?.(GLOW_SELECTOR) as HTMLElement | null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    last = e;
    if (!frame) frame = requestAnimationFrame(apply);
  };
  root.addEventListener("pointermove", onMove, { passive: true });
  root.addEventListener("pointerover", onMove, { passive: true });
  return () => {
    root.removeEventListener("pointermove", onMove);
    root.removeEventListener("pointerover", onMove);
    if (frame) cancelAnimationFrame(frame);
  };
}
