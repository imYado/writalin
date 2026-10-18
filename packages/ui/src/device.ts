/**
 * Pick a quality tier from what the device reports, so weaker Chromebooks
 * get fewer animations, smaller PDF renders and capped graphs.
 */
export type QualityTier = "low" | "medium" | "high";

export function detectQualityTier(): QualityTier {
  if (typeof navigator === "undefined") return "medium";
  const cores = navigator.hardwareConcurrency || 2;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (cores <= 2 || mem <= 2) return "low";
  if (reduced || cores <= 4 || mem <= 4) return "medium";
  return "high";
}

/** Measure real frame rate for ~0.5s; drops a tier if the machine is struggling. */
export function measureFps(ms = 500): Promise<number> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== "function") return resolve(60);
    let frames = 0;
    const start = performance.now();
    const step = (t: number) => {
      frames++;
      if (t - start < ms) requestAnimationFrame(step);
      else resolve((frames * 1000) / (t - start));
    };
    requestAnimationFrame(step);
  });
}

export async function qualityTier(): Promise<QualityTier> {
  const tier = detectQualityTier();
  const fps = await measureFps();
  if (fps < 40) return tier === "high" ? "medium" : "low";
  return tier;
}
