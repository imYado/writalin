import { describe, expect, it } from "vitest";
import { MemoryStore, Vault } from "@writalin/vault";
import { buildVaultSources, citedNumbers, sourcesFooter } from "./vaultSources";

async function makeVault(files: Record<string, string>) {
  const vault = new Vault(new MemoryStore("Test", files));
  await vault.open();
  return vault;
}

describe("buildVaultSources", () => {
  it("numbers passages for citing and keeps earlier numbers on a follow-up", async () => {
    const vault = await makeVault({
      "Cells.md": "## Mitochondria\n\nThe mitochondria make ATP.",
      "Plants.md": "## Photosynthesis\n\nChloroplasts turn light into glucose.",
    });
    const first = buildVaultSources(vault, "What do mitochondria make?");
    expect(first.sources).toEqual([{ n: 1, path: "Cells.md", heading: "Mitochondria", line: 2, text: "The mitochondria make ATP." }]);
    expect(first.text).toBe("[1] “Cells” › Mitochondria\nThe mitochondria make ATP.");
    const next = buildVaultSources(vault, "and chloroplasts? mitochondria", first.sources);
    expect(next.sources.map((s) => [s.n, s.path])).toEqual([[1, "Cells.md"], [2, "Plants.md"]]);
  });

  it("lists only the cited sources under an inserted answer", () => {
    const sources = [
      { n: 1, path: "Bio/Cells.md", heading: "Mitochondria", line: 2, text: "x" },
      { n: 2, path: "Plants.md", line: 0, text: "y" },
    ];
    expect(citedNumbers("ATP [1]. Glucose [2][1]. Not [9].")).toEqual([1, 2, 9]);
    expect(sourcesFooter("They make ATP [1].", sources)).toBe("Sources: [1] [[Cells#Mitochondria]]");
    expect(sourcesFooter("No citations.", sources)).toBe("");
  });
});
