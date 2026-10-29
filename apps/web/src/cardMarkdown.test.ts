// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderCardMarkdown } from "./cardMarkdown";

describe("renderCardMarkdown", () => {
  it("renders Markdown, highlights and the cloze blank, without scripts or links", async () => {
    const html = await renderCardMarkdown("The **heart** has ==4== [...] <img src=x onerror=alert(1)> [site](https://a.b)");
    expect(html).toContain("<strong>heart</strong>");
    expect(html).toContain("<mark>4</mark>");
    expect(html).toContain('class="card-blank"');
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("<a ");
    expect(html).toContain("site");
  });

  it("renders math with KaTeX, leaving prices alone", async () => {
    const html = await renderCardMarkdown("Area is $\\pi r^2$, costs $5 and $10\n\n$$E = mc^2$$");
    expect(html).toContain('class="katex"');
    expect(html).toContain("katex-display");
    expect(html).toContain("costs $5 and $10");
  });

  it("shows vault images through the resolver", async () => {
    const seen: string[] = [];
    const html = await renderCardMarkdown("![[heart.png|200]] and ![[missing.png]]", async (t) => (seen.push(t), t === "heart.png" ? "blob:x/1" : null));
    expect(seen).toEqual(["heart.png", "missing.png"]);
    expect(html).toContain('<img src="blob:x/1" alt="heart.png" style="width:200px">');
    expect(html).toContain("<em>![[missing.png]]</em>");
  });
});
