/**
 * Phones: keep the app inside the part of the screen the on-screen keyboard
 * leaves free, so the Format/AI dock sits right above the keyboard instead of
 * behind it. iOS doesn't shrink the page for the keyboard, so we size the app
 * to the visual viewport and mark `kb-open` while the keyboard is up.
 */
export function trackKeyboard(): void {
  const vv = window.visualViewport;
  if (!vv || !matchMedia("(pointer: coarse)").matches) return;
  const root = document.documentElement;
  const update = () => {
    const open = window.innerHeight - vv.height > 120;
    root.classList.toggle("kb-open", open);
    if (open) {
      root.style.setProperty("--vv-h", `${vv.height}px`);
      root.style.setProperty("--vv-top", `${vv.offsetTop}px`);
    } else {
      root.style.removeProperty("--vv-h");
      root.style.removeProperty("--vv-top");
    }
  };
  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
  update();
}
