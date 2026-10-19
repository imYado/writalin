/**
 * Make an AI answer fit what the Writalin editor can show. The prompt asks for
 * this already; this catches what slips through, mostly LaTeX, which the
 * editor doesn't render.
 */

const SYMBOLS: Record<string, string> = {
  times: "×", cdot: "·", div: "÷", pm: "±", mp: "∓", leq: "≤", le: "≤", geq: "≥", ge: "≥", neq: "≠", ne: "≠",
  approx: "≈", equiv: "≡", sim: "∼", propto: "∝", infty: "∞", to: "→", rightarrow: "→", Rightarrow: "⇒", leftarrow: "←",
  leftrightarrow: "↔", Leftrightarrow: "⇔", implies: "⇒", iff: "⇔", in: "∈", notin: "∉", subset: "⊂", subseteq: "⊆",
  cup: "∪", cap: "∩", emptyset: "∅", forall: "∀", exists: "∃", partial: "∂", nabla: "∇", sum: "∑", prod: "∏", int: "∫",
  degree: "°", circ: "°", angle: "∠", perp: "⊥", parallel: "∥", ldots: "…", cdots: "⋯", dots: "…", prime: "′",
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ",
  iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ",
  upsilon: "υ", phi: "φ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
};
const SUP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻", n: "ⁿ", i: "ⁱ", x: "ˣ" };
const SUB: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉", "+": "₊", "-": "₋" };

const script = (s: string, map: Record<string, string>, mark: string) =>
  [...s].every((c) => map[c]) ? [...s].map((c) => map[c]).join("") : `${mark}(${s})`;

/** LaTeX math → readable plain text: `\frac{a}{b}` → `a/b`, `x^2` → `x²`, `\alpha` → `α`. */
export function latexToText(tex: string): string {
  let s = tex.trim();
  for (let i = 0; i < 4; i++) {
    s = s
      .replace(/\\(?:d|t)?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (_, a: string, b: string) => `${/^\w+$/.test(a) ? a : `(${a})`}/${/^\w+$/.test(b) ? b : `(${b})`}`)
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, (_, a: string) => (/^\w+$/.test(a) ? `√${a}` : `√(${a})`))
      .replace(/\\(?:text|mathrm|mathbf|mathit|operatorname|textbf|boldsymbol)\s*\{([^{}]*)\}/g, "$1");
  }
  s = s
    .replace(/\\left|\\right|\\displaystyle|\\,|\;|\\!|\\quad|\\qquad/g, " ")
    .replace(/\\([A-Za-z]+)/g, (m, name: string) => SYMBOLS[name] ?? name)
    .replace(/\^\{([^{}]*)\}/g, (_, a: string) => script(a, SUP, "^"))
    .replace(/\^([\w+-])/g, (_, a: string) => script(a, SUP, "^"))
    .replace(/_\{([^{}]*)\}/g, (_, a: string) => script(a, SUB, "_"))
    .replace(/_(\d)/g, (_, a: string) => script(a, SUB, "_"))
    .replace(/[{}]/g, "")
    .replace(/\\\\/g, "; ")
    .replace(/[ \t]{2,}/g, " ");
  return s.trim();
}

/** Clean an AI answer so everything in it is something the editor shows properly. */
export function tidyAiMarkdown(md: string): string {
  return md
    // Display math on its own: \[ … \] or $$ … $$ → its own line of plain text.
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, m: string) => latexToText(m))
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, m: string) => latexToText(m))
    // Inline math: \( … \) or $…$ (not money like "$5 and $10").
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, m: string) => latexToText(m))
    .replace(/(^|[^\w$\\])\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g, (all, pre: string, m: string) => (/[\\^_{}=]/.test(m) ? pre + latexToText(m) : all))
    // Headings deeper than ### and setext underlines don't match the editor's styles.
    .replace(/^#{4,6}\s/gm, "### ")
    // Footnotes aren't supported: inline the marker as plain text.
    .replace(/\[\^(\w+)\](?!:)/g, "($1)")
    .replace(/^\[\^(\w+)\]:\s*/gm, "($1) ");
}
