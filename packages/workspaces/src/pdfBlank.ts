/** Written into every blank PDF Writalin makes, so it knows it may add pages to it. */
export const BLANK_PDF_PRODUCER = "Writalin blank";

/**
 * An empty PDF: `pages` white A4 pages and nothing else. What's drawn and
 * written on it is kept beside it, like any PDF's drawings.
 */
export function blankPdf(pages = 1): Uint8Array {
  const n = Math.max(1, Math.min(500, Math.floor(pages)));
  const kids = Array.from({ length: n }, (_, i) => `${4 + i} 0 R`).join(" ");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids}] /Count ${n} /MediaBox [0 0 595 842] >>`,
    `<< /Producer (${BLANK_PDF_PRODUCER}) >>`,
    ...Array.from({ length: n }, () => "<< /Type /Page /Parent 2 0 R /Resources << >> >>"),
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // Plain ASCII, so one byte per character and the offsets above are byte offsets.
  return new TextEncoder().encode(out);
}
